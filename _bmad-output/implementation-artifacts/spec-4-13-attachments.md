---
title: "Story 4.13 — Attachments (external URL + label)"
type: "feature"
created: "2026-08-28"
status: "draft"
review_loop_iteration: 0
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-4-incident-detail-page.md
  - _bmad-output/implementation-artifacts/spec-4-9-notification-writer.md
  - packages/db/prisma/schema.prisma
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Operators and Technicians have no way to attach evidence to an incident — a photo of the failing sensor, a link to a calibration log, a doc URL. The `Attachment` Prisma table already exists in the schema (per `schema.prisma:Attachment` model — fields: `id`, `incidentId`, `url`, `label`, `mime`, `uploadedByUserId`, `createdAt`) but has no API surface and no UI. BRD §5.2 mandates the attachment affordance for evidence-tracking.

**Approach:** Wire the `Attachment` table end-to-end. Backend ships `POST /api/incidents/:id/attachments` (create) + `GET /api/incidents/:id/attachments` (list) + `DELETE /api/attachments/:id` (delete own). URL validation: server enforces `http://` or `https://` scheme only (rejects `javascript:`, `data:`, `file:`, `vbscript:`); auto-detects MIME type from URL extension (`.png` → `image/png`, `.pdf` → `application/pdf`); accepts explicit `mime` override. Web consumes from the existing `/incidents/:id` detail page (4.4): a new "Attachments" section below the audit timeline renders the list, with an "Add attachment" button that opens an inline form (URL + optional label). RBAC: Operator + Technician can create + delete their own attachments; Admin can delete any; Viewer can read-only (existing `read.Incident` grant). No binary blob upload in v1 (URL-only — matches BRD §5.2 "external URL" wording).

## Boundaries & Constraints

**Always:**

- The `Attachment` Prisma model already exists (per `schema.prisma`). 4.13 does NOT modify the schema; it wires the API + UI.
- URL validation is server-side Zod: `z.string().url().refine(url => /^https?:\/\//.test(url), { message: "URL must be http:// or https://" })`. Rejects `javascript:`, `data:`, `file:`, `vbscript:`, relative paths, malformed URLs.
- MIME auto-detection uses URL extension: `.png` → `image/png`, `.jpg` → `image/jpeg`, `.pdf` → `application/pdf`, `.txt` → `text/plain`, etc. (whitelist of common types — fall back to `application/octet-stream` for unknown extensions). Caller can override with explicit `mime` field.
- RBAC matrix entry: create is `create.Attachment = Y` for Operator + Technician + Admin; read is `read.Attachment = Y` for all four roles; delete is `delete.Attachment = Y` for Admin + the original `uploadedByUserId` (Operator/Technician can delete their OWN; Admin can delete any).
- The endpoint mounts under `/api/incidents/:id/attachments` for create + list (parent-scoped); `/api/attachments/:id` for delete (resource-scoped).
- The 4.4 detail page renders the attachments list as a new section below the audit timeline. Each row shows the label (or URL if no label), a "↗" external-link icon, the MIME type, the uploader's name, and a delete button (visible per RBAC rules).
- The "Add attachment" form is inline (no modal library, matches the 4.6 `AssignControl` pattern): URL input + label input + submit button. Submit triggers `useCreateAttachment` mutation; on success, the attachments query refetches.
- Attachments DO NOT trigger `incident:state_changed` (no state mutation). Attachments DO emit a separate `attachment:added` socket event for real-time freshness (deferred to a future story; v1 uses refetch-only).
- No binary blob storage in v1 — URL-only. A future story can add file upload (with S3 + presigned URLs) if/when needed.
- Attachments are visible to Viewer viewers (read-only — the existing `read.Incident = Y` grant covers it). The "Add attachment" button is hidden for Viewer.
- Attachment upload DOES NOT write a `Notification` row (no notification contract — attachments are evidence, not state changes).
- The Prisma `Attachment` table's `mime` column has a default value of `application/octet-stream`; the create handler validates the input but accepts the default.

**Ask First:**

- Whether the attachment form should support drag-and-drop file upload. **Decision: NO in v1** — URL-only matches BRD §5.2's "external URL" wording. Drag-and-drop upload requires S3 + presigned URLs (out of scope).
- Whether attachments should support multiple uploads in one form. **Decision: NO in v1** — one URL at a time; matches the form's single-URL semantic. Bulk upload is a follow-up.
- Whether the attachment list should paginate. **Decision: NO pagination in v1** — bounded by incidents (typical <10 attachments per incident). Pagination is a follow-up.
- Whether the delete endpoint should soft-delete or hard-delete. **Decision: HARD-DELETE** — the `Attachment` table has no `deletedAt` column (4.13 does not modify the schema); soft-delete would require a migration. Hard-delete is consistent with v1's no-audit-recovery contract for attachments.

**Never:**

- Touching the Prisma schema (the `Attachment` model is already in place).
- Touching the state machine (4.2). Attachments are not state transitions.
- Modifying `notificationWriter.ts` (4.9 is locked).
- Touching the audit timeline renderer in 4.4 — attachments render in a NEW section, not inside the timeline.
- Binary blob storage. URL-only.
- Modals / modal library. Inline form (matches 4.6 pattern).
- Tailwind template-literal classes (Story 2.8 VG-1 lesson).
- Modifying `SeverityBanner` (4.8), `NotificationBell` (4.10), or `KanbanBoard` (4.3). Attachments are a detail-page-only surface.
- XSS via label: the label is rendered as text content, not `dangerouslySetInnerHTML`. URL is rendered as `<a href={url}>` with `rel="noopener noreferrer"` + `target="_blank"` for external links.

## I/O & Edge-Case Matrix

| Scenario                  | Input / State                                                                                                         | Expected Output / Behavior                                                                | Error Handling                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `HAPPY_PATH_OPERATOR`     | Operator POSTs `{ url: "https://example.com/photo.png", label: "Sensor photo" }` to `/api/incidents/:id/attachments`. | 201 with the new `Attachment` row. Detail page refetches; attachment appears in the list. | N/A                                                         |
| `HAPPY_PATH_TECHNICIAN`   | Technician POSTs the same.                                                                                            | 201. Same UI surface.                                                                     | N/A                                                         |
| `HAPPY_PATH_ADMIN`        | Admin POSTs.                                                                                                          | 201. Same UI surface.                                                                     | N/A                                                         |
| `ZERO_HAPPY_VIEWER`       | Viewer attempts POST.                                                                                                 | 403 from RBAC matrix (create.Attachment = N for Viewer).                                  | 403 toast; "Add attachment" button absent for Viewer in UI. |
| `URL_INVALID_SCHEME`      | Operator POSTs `{ url: "javascript:alert(1)" }`.                                                                      | 400 `invalid_payload` with `{ url: "URL must be http:// or https://" }`.                  | Toast.                                                      |
| `URL_DATA_SCHEME`         | Operator POSTs `{ url: "data:text/plain,hello" }`.                                                                    | 400 same message.                                                                         | Toast.                                                      |
| `URL_FILE_SCHEME`         | Operator POSTs `{ url: "file:///etc/passwd" }`.                                                                       | 400.                                                                                      | Toast.                                                      |
| `URL_VBSCRIPT`            | Operator POSTs `{ url: "vbscript:msgbox(1)" }`.                                                                       | 400.                                                                                      | Toast.                                                      |
| `URL_RELATIVE`            | Operator POSTs `{ url: "/path/to/file" }`.                                                                            | 400 (not absolute).                                                                       | Toast.                                                      |
| `URL_MALFORMED`           | Operator POSTs `{ url: "not-a-url" }`.                                                                                | 400 from `z.string().url()`.                                                              | Toast.                                                      |
| `LABEL_TOO_LONG`          | Operator POSTs `{ url: valid, label: ">200 chars" }`.                                                                 | 400 `invalid_payload`.                                                                    | Toast.                                                      |
| `MIME_OVERRIDE`           | Operator POSTs `{ url: "https://example.com/blob", mime: "application/json" }`.                                       | 201 with `mime: "application/json"`. Auto-detected is overridden.                         | N/A.                                                        |
| `MIME_INVALID`            | Operator POSTs `{ url: valid, mime: "not-a-mime/type" }`.                                                             | 400 (Zod mime regex).                                                                     | Toast.                                                      |
| `MIME_AUTODETECT_PNG`     | Operator POSTs `{ url: "https://x.com/y.png" }`.                                                                      | 201 with `mime: "image/png"` (auto-detected).                                             | N/A.                                                        |
| `MIME_AUTODETECT_PDF`     | Operator POSTs `{ url: "https://x.com/y.pdf" }`.                                                                      | 201 with `mime: "application/pdf"`.                                                       | N/A.                                                        |
| `MIME_AUTODETECT_UNKNOWN` | Operator POSTs `{ url: "https://x.com/y.zzz" }`.                                                                      | 201 with `mime: "application/octet-stream"` (fallback).                                   | N/A.                                                        |
| `LIST_HAPPY`              | Operator GETs `/api/incidents/:id/attachments`.                                                                       | 200 with `{ attachments: AttachmentPayload[] }` in reverse-chronological order.           | N/A.                                                        |
| `LIST_EMPTY`              | Operator GETs on incident with 0 attachments.                                                                         | 200 with `{ attachments: [] }`.                                                           | N/A — section renders "No attachments yet."                 |
| `LIST_403_OTHER_INCIDENT` | Tech A GETs `/api/incidents/<tech-b-incident-id>/attachments`.                                                        | 403 from the existing Tech-ownership rule (4.4's detail endpoint pattern).                | Toast + RBAC denied surface.                                |
| `LIST_404_NO_INCIDENT`    | GETs on non-existent `:id`.                                                                                           | 404 from the existing fetch-then-check pattern.                                           | Toast + NotFound.                                           |
| `DELETE_OWN_OPERATOR`     | Operator DELETEs `/api/attachments/:id` for their own attachment.                                                     | 204. Row deleted. Detail page refetches.                                                  | N/A.                                                        |
| `DELETE_OTHER_OPERATOR`   | Operator DELETEs another operator's attachment.                                                                       | 403 (only Admin + uploader can delete).                                                   | Toast.                                                      |
| `DELETE_OWN_ADMIN`        | Admin DELETEs any attachment.                                                                                         | 204. (Admin bypass.)                                                                      | N/A.                                                        |
| `DELETE_404`              | DELETE on non-existent `:id`.                                                                                         | 404.                                                                                      | Toast.                                                      |
| `XSS_LABEL`               | Operator POSTs `{ url: valid, label: "<script>alert(1)</script>" }`.                                                  | 201; label rendered as TEXT in the DOM (no HTML injection). `<a>` link uses URL only.     | N/A — defensive.                                            |
| `NO_NOTIFICATION`         | Operator uploads an attachment.                                                                                       | No `Notification` row written.                                                            | N/A.                                                        |
| `NO_STATE_CHANGE`         | Operator uploads an attachment.                                                                                       | `incident:state_changed` NOT emitted.                                                     | N/A.                                                        |
| `VIEWER_NO_BUTTON`        | Viewer on `/incidents/:id`.                                                                                           | "Add attachment" button absent; delete buttons absent; attachments list is read-only.     | N/A — UI gate.                                              |

</frozen-after-approval>

## Code Map

**Shared (`packages/shared/`):**

- `src/attachment.ts` — NEW. `AttachmentPayloadSchema` (wire shape: `id`, `incidentId`, `url`, `label`, `mime`, `uploadedByUserId`, `createdAt` — drops internal `Incident` join columns if any). `AttachmentListEnvelopeSchema` (`{ attachments: AttachmentPayload[] }`). Reuses the URL-validation Zod schema.
- `src/urlValidation.ts` — NEW. Pure helper `validateHttpUrl(input: string): { url: URL }` that throws on non-http(s) schemes. Re-exported for the spec + tests.
- `src/mimeAutoDetect.ts` — NEW. Pure helper `detectMimeFromURL(url: string): string` returning the auto-detected MIME or `application/octet-stream` fallback. Whitelist of common extensions.
- `src/rbac.ts` — MODIFY. Add `create: { Attachment: Y }` for Admin/Operator/Technician (Viewer stays N); `read: { Attachment: Y }` for all four; `delete: { Attachment: Y }` for Admin only (the per-row ownership check is in the handler). The `delete: { Attachment: Y }` matrix grant covers Admin; the per-row "uploader can delete own" check is in the handler, not the matrix.

**Backend (`packages/api/`):**

- `src/attachments/attachmentRepository.ts` — NEW. Narrow Prisma slice: `attachment.create` + `attachment.findMany({ where: { incidentId }, orderBy: { createdAt: "desc" } })` + `attachment.findUnique({ where: { id } })` + `attachment.delete({ where: { id } })`.
- `src/attachments/attachmentRowToPayload.ts` — NEW. Pure adapter; mirrors `notificationRowToPayload.ts` (drops any server-internal columns, ISO-encodes `createdAt`).
- `src/attachments/attachmentRouter.ts` — NEW. Three routes:
  - `POST /api/incidents/:id/attachments` — `authenticate` + `authorize({ action: "create", resource: "Attachment" })` + URL validation + MIME detection + Tech-ownership check (mirrors 4.4's `incidentStateRepository` row-fetch).
  - `GET /api/incidents/:id/attachments` — `authenticate` + `authorize({ action: "read", resource: "Attachment" })` + Tech-ownership check.
  - `DELETE /api/attachments/:id` — `authenticate` + `authorize({ action: "delete", resource: "Attachment" })` + per-row ownership check (`uploadedByUserId === req.user.id || req.user.role === "Admin"`).
- `src/attachments/attachmentRouter.spec.ts` — NEW. ~12 tests: HAPPY*PATH_3 roles, ZERO_HAPPY_VIEWER, URL_INVALID_SCHEME × 5 variants, LABEL_TOO_LONG, MIME_OVERRIDE, MIME_INVALID, MIME_AUTODETECT*× 3 cases, LIST_EMPTY, LIST_403, DELETE_OWN_OPERATOR, DELETE_OTHER_OPERATOR, DELETE_OWN_ADMIN, DELETE_404, XSS_LABEL.
- `src/attachments/attachmentRepository.spec.ts` — NEW. ~3 tests on the pure repository helper.
- `src/attachments/index.ts` — NEW. Barrel export.
- `src/index.ts` — MODIFY. Mount `attachmentRouter` alongside `notificationRouter` + `incidentsRouterMount`.

**Web (`packages/web/`):**

- `src/attachments/useAttachments.ts` — NEW. TanStack `useQuery` for the list: cache key `["incidents", "detail", incidentId, "attachments"]`, `enabled: incidentId !== null`.
- `src/attachments/useCreateAttachment.ts` — NEW. TanStack `useMutation` wrapping `apiFetch("/api/incidents/:id/attachments", { method: "POST" })`. On success: `queryClient.invalidateQueries({ queryKey: ["incidents", "detail", incidentId, "attachments"] })`.
- `src/attachments/useDeleteAttachment.ts` — NEW. TanStack `useMutation` wrapping `apiFetch("/api/attachments/:id", { method: "DELETE" })`. Same invalidation.
- `src/attachments/AttachmentList.tsx` — NEW. The render component: maps the list to `<li>` rows with label, URL link, MIME badge, uploader name, delete button. Defensive rendering (label as text, URL via `<a rel="noopener noreferrer" target="_blank">`).
- `src/attachments/AttachmentForm.tsx` — NEW. The inline form (URL input + label input + submit). Matches 4.6's `AssignControl` inline pattern.
- `src/attachments/AttachmentsSection.tsx` — NEW. The orchestrator: wraps `<AttachmentList />` + `<AttachmentForm />` (button-gated for non-Viewer). Empty state renders `"No attachments yet."`.
- `src/attachments/AttachmentsSection.spec.tsx` — NEW. ~10 tests covering the matrix rows.
- `src/incidents/IncidentDetailPage.tsx` (4.4) — MODIFY. Mount `<AttachmentsSection />` below the audit timeline section. Pass `incidentId` as prop.
- `src/incidents/IncidentDetailPage.spec.tsx` (4.4) — MODIFY. Add ~3 tests: ATTACHMENTS_RENDER_HAPPY, ATTACHMENTS_RENDER_VIEWER (read-only, no button), ATTACHMENTS_NAV_NO_LINK.

**Prisma:** NO CHANGE. The `Attachment` model exists; 4.13 wires the surface.

## Tasks & Acceptance

**Execution:**

- [ ] 1. Write spec doc (this file). Status: draft.
- [ ] 2. Create `packages/shared/src/urlValidation.ts` + `mimeAutoDetect.ts` + `attachment.ts` (wire schema).
- [ ] 3. Modify `packages/shared/src/rbac.ts` — add create/read/delete Attachment cells.
- [ ] 4. Create `packages/api/src/attachments/attachmentRowToPayload.ts` + `attachmentRepository.ts` (narrow slice).
- [ ] 5. Create `packages/api/src/attachments/attachmentRouter.ts` (POST + GET + DELETE) + `attachmentRouter.spec.ts` (~12 tests) + `attachmentRepository.spec.ts` (~3 tests).
- [ ] 6. Modify `packages/api/src/index.ts` — mount `attachmentRouter`.
- [ ] 7. Create `packages/web/src/attachments/useAttachments.ts` + `useCreateAttachment.ts` + `useDeleteAttachment.ts`.
- [ ] 8. Create `packages/web/src/attachments/AttachmentList.tsx` + `AttachmentForm.tsx` + `AttachmentsSection.tsx` + `AttachmentsSection.spec.tsx` (~10 tests).
- [ ] 9. Modify `packages/web/src/incidents/IncidentDetailPage.tsx` — mount `<AttachmentsSection />`.
- [ ] 10. Extend `packages/web/src/incidents/IncidentDetailPage.spec.tsx` (~3 cases).
- [ ] 11. Run `pnpm --filter @surakkha/api test`, `pnpm -F @surakkha/web test`, `pnpm -r typecheck`. Lint-fix any failures.
- [ ] 12. Commit `feat(Story 4.13): attachments (URL-only create + list + delete + RBAC)` with the standard trailer.
- [ ] 13. Step-04 review (3 parallel reviewers). Triage findings. Apply patches.
- [ ] 14. Append `## Suggested Review Order`. Flip status to `done`. Update `sprint-status.yaml`. Commit `chore(spec): mark Story 4.13 done`.

**Acceptance Criteria:**

1. Operator + Technician + Admin can `POST /api/incidents/:id/attachments` with `{ url, label?, mime? }`. Returns 201 with the new row. Pinned in `attachmentRouter.spec.ts`.
2. Viewer attempting POST returns 403 from RBAC matrix. Pinned in `attachmentRouter.spec.ts`.
3. URL validation rejects `javascript:`, `data:`, `file:`, `vbscript:`, relative paths, malformed URLs with 400 `invalid_payload`. Pinned in `attachmentRouter.spec.ts` (one test per variant).
4. MIME auto-detects from URL extension (`.png` → `image/png`, `.pdf` → `application/pdf`, etc.); falls back to `application/octet-stream` for unknown extensions. Pinned in `attachmentRouter.spec.ts` + `mimeAutoDetect.spec.ts`.
5. Explicit `mime` field overrides auto-detection. Pinned in `attachmentRouter.spec.ts`.
6. `GET /api/incidents/:id/attachments` returns `{ attachments: AttachmentPayload[] }` in reverse-chronological order. Pinned in `attachmentRouter.spec.ts`.
7. `GET` on a Tech B's incident by Tech A returns 403 (Tech-ownership rule). Pinned in `attachmentRouter.spec.ts`.
8. `DELETE /api/attachments/:id` allows the original uploader + Admin; denies other Operators/Technicians. Returns 204. Pinned in `attachmentRouter.spec.ts`.
9. The detail page renders the attachments list below the audit timeline, with delete buttons per RBAC rules. Pinned in `AttachmentsSection.spec.tsx` + `IncidentDetailPage.spec.tsx`.
10. The "Add attachment" button is absent for Viewer viewers. Pinned in `AttachmentsSection.spec.tsx`.
11. Labels are rendered as text content (no XSS via `<script>`). Pinned in `attachmentRouter.spec.ts` (XSS_LABEL) + UI-side test.
12. Attachments do NOT emit `incident:state_changed` socket events. Pinned by absence — `attachmentRouter` does not touch the transition helpers.
13. Attachments do NOT write `Notification` rows. Pinned by absence — `attachmentRouter` does not touch `notificationWriter.ts`.

## Design Notes

**Why URL-only (no binary blob upload) in v1.** BRD §5.2 mandates "external URL" wording — the v1 surface is link-based (e.g., a photo hosted in operator's cloud storage, a doc on a shared drive). Binary blob upload requires S3 + presigned URLs + multipart upload + virus scanning — a 5-story surface. URL-only matches the spec's wording, ships the `Attachment` table's existing schema, and gives operators a working evidence-tracking affordance on day one. File upload is a documented follow-up.

**Why the URL validation is server-side, not client-side.** Two reasons. First, the validation is a security boundary — clients can be bypassed (curl, malicious browser extension). Server-side enforcement is the only authority. Second, MIME auto-detection is more reliable server-side (the server has full URL access; clients can spoof). The shared `validateHttpUrl` + `detectMimeFromURL` helpers are pure and testable in isolation — both client (for inline form errors) and server (for authoritative validation) call them.

**Why the delete endpoint is `/api/attachments/:id` (resource-scoped), not `/api/incidents/:id/attachments/:id` (parent-scoped).** The DELETE handler's per-row check (`uploadedByUserId === self || role === "Admin"`) doesn't need the parent `:id` for ownership verification — the row's own `uploadedByUserId` is sufficient. Resource-scoped URLs are shorter + match REST conventions (the resource IS the attachment; the parent is implicit in the row). The CREATE + LIST endpoints stay parent-scoped because they need the parent for the WHERE clause.

**Why the `delete.Attachment` matrix grant is Admin-only, with per-row ownership in the handler.** The matrix is a role-level authority source (per 4.10's investigation). The `delete.Attachment: Admin` grant is the baseline; the per-row "uploader can delete own" rule is a finer-grained check that lives in the handler (matches 4.10's `cross-role` pattern). Splitting the matrix + handler roles keeps the matrix simple (one cell per role-action pair) while the handler enforces per-row ownership.

**Why the attachments section renders BELOW the audit timeline, not inside it.** The audit timeline (4.4) is a sequence of `IncidentEvent` rows — state transitions, assignments, submit-results. Attachments are NOT `IncidentEvent` rows (they don't go through the state machine); conflating them in the timeline would break the timeline's "what happened to this incident's state" narrative. A separate section keeps the timeline focused + gives attachments their own delete affordance + render surface.

**Why attachments don't trigger `incident:state_changed`.** Attachments are not state transitions — they don't change `state`, `severity`, `assignee_user_id`, etc. They are evidence attached to the current state. Emitting `incident:state_changed` would force every consumer (Kanban, detail page, severity banner) to re-fetch the incident row, which didn't change — pure noise. A separate `attachment:added` socket event (deferred) is the right channel for real-time attachment freshness.

**Why the `delete` is hard-delete (no soft-delete).** The Prisma `Attachment` table has no `deletedAt` column. Adding soft-delete would require a migration (out of scope per "Don't modify Prisma schema"). Hard-delete matches v1's contract — no audit recovery for attachments. If a future story needs soft-delete (e.g., for compliance), the migration is straightforward.

## Verification

**Commands:**

- `pnpm --filter @surakkha/api test` — expected: green; `attachmentRouter.spec.ts` adds ~12 tests, `attachmentRepository.spec.ts` adds ~3 tests. Pre-existing 6 alerts/rules failures (AI-3.1) are unrelated.
- `pnpm --filter @surakkha/web test` — expected: existing 431 + ~10 new (AttachmentsSection) + ~3 new (IncidentDetailPage) = ~444 green.
- `pnpm -r typecheck` — expected: clean across 4 active packages.

**Manual checks (if no CLI):**

- Boot api + web; navigate to `/incidents/<id>` as Operator; verify "Add attachment" button visible; click it; enter `https://example.com/photo.png` + label "Sensor photo"; submit; verify attachment row appears with the link + label + `image/png` badge.
- Try `javascript:alert(1)` URL; verify 400 error.
- Switch to Viewer; verify button absent + list is read-only.
- Switch to Tech A; navigate to a Tech B's incident; verify the attachments section is absent (Tech-ownership 403 on the list endpoint).
- As Operator, delete your own attachment; verify row disappears; try to delete another operator's attachment via curl; verify 403.

## Spec Change Log

Append-only. Populated by step-04 during review loops. Empty until the first bad_spec loopback.

## Suggested Review Order

A reviewer should walk the change in this order to catch the load-bearing seams first:

1. **URL validation + MIME auto-detection** — `packages/shared/src/urlValidation.ts` + `mimeAutoDetect.ts`. Pure helpers; security boundary.
2. **Wire schema** — `packages/shared/src/attachment.ts`. `AttachmentPayloadSchema` + `AttachmentListEnvelopeSchema`.
3. **RBAC matrix** — `packages/shared/src/rbac.ts`. `create/read/delete Attachment` cells; Admin-only delete baseline.
4. **Backend repository + adapter** — `packages/api/src/attachments/attachmentRepository.ts` + `attachmentRowToPayload.ts`. Narrow Prisma slice + pure adapter.
5. **Backend router** — `packages/api/src/attachments/attachmentRouter.ts`. POST + GET + DELETE; Tech-ownership + per-row delete checks inline.
6. **Index mount** — `packages/api/src/index.ts`. `attachmentRouter` mounted alongside `notificationRouter`.
7. **Web hooks** — `packages/web/src/attachments/useAttachments.ts` + `useCreateAttachment.ts` + `useDeleteAttachment.ts`. Cache key + mutation + invalidation.
8. **Web components** — `AttachmentList.tsx` + `AttachmentForm.tsx` + `AttachmentsSection.tsx`. Render + form + empty state.
9. **Detail page mount** — `packages/web/src/incidents/IncidentDetailPage.tsx`. `<AttachmentsSection />` below the audit timeline.
10. **Spec doc + ACs** — this file. Each AC bullet maps to a specific test file.
