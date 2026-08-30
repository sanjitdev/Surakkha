---
title: "Story 5.1 — /admin/notifications Read View"
type: "feature"
created: "2026-08-30"
status: "in-review"
review_loop_iteration: 1
baseline_commit: "248f4ca741bc3cbbaa9b97e3b6b4efcad2659508"
context: []
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot.
     Cohesive cross-layer story (DB+BE+UI) stays in ONE file. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 4.10 NotificationBell surfaces only the unread rows for the viewer's role. An Admin who wants to audit what the platform emitted — across all roles, all severities, with full metadata — has no read surface.

**Approach:** Add a NEW admin-only `GET /api/notifications/admin/list` endpoint + a NEW `/admin/notifications` web page that renders the 100 most recent rows with severity / date-range filters and an expandable detail panel showing the row's metadata and a link to the underlying incident.

## Boundaries & Constraints

**Always:**

- Admin-only access — non-admin navigation renders the Story 1.6 RBAC denied state; the API returns 403.
- The admin endpoint DROPS the `recipientRole` filter (admin sees all roles) and DROPS the `acknowledgedAt: null` filter (admin sees all states).
- The admin list is read-only. No mark-as-read affordance from this page (the bell already covers that for the actor's role).
- Wire row uses a NEW sibling schema (`AdminNotificationPayload`) that includes `acknowledgedByUserId` and the row's full metadata — admin surfaces are allowed to leak information the operator-facing wire omits.
- The new endpoint reuses the existing `NotificationRepository` slice (extend, don't replace).
- Mockup `_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-30/mockups/key-admin-notifications.html` is the canonical visual reference.

**Ask First:**

- Whether the RBAC action for the new endpoint is `read_all Notification` (new matrix entry) OR an inline role check in the handler (reusing the existing `read Notification` action). Default: new matrix entry `read_all Notification`, granted to Admin only.

**Never:**

- No new socket event (mirrors the 4.10 spec's "NEVER add a `notification:*` socket event" rule). Admin list freshness comes from TanStack `refetchInterval: 30_000` polling.
- No payload column on the Prisma model — the writer (4.9) persists only severity + incidentId + alertId + recipientRole + createdAt + acknowledgedAt + acknowledgedByUserId. The "expandable full payload" affordance surfaces the row's metadata as JSON, NOT a freeform payload blob.
- No audit-log write from the admin read path (read-only surface).
- No mark-as-read POST/PATCH from this page (the bell owns that).
- No retroactive migration / no schema change.

## I/O & Edge-Case Matrix

| Scenario                | Input / State                                                | Expected Output / Behavior                                    | Error Handling |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- | -------------- |
| HAPPY_PATH_ADMIN        | Admin visits `/admin/notifications`; 100 rows exist          | 200 + admin envelope (notifications sorted DESC by createdAt) | N/A            |
| HAPPY_PATH_FILTERED     | Admin passes `?severity=critical&since=2026-08-29T00:00:00Z` | 200 + filtered rows matching severity AND date predicate      | N/A            |
| HAPPY_PATH_EMPTY        | Admin passes filter that matches no rows                     | 200 + `{ notifications: [] }` envelope                        | N/A            |
| RBAC_DENIED_OPERATOR    | Operator calls `/api/notifications/admin/list`               | 403 + `forbidden` body + `rbac_denied` audit emit             | n/a            |
| RBAC_DENIED_TECH        | Technician calls endpoint                                    | 403 + `forbidden` body                                        | n/a            |
| RBAC_DENIED_VIEWER      | Viewer calls endpoint                                        | 403 + `forbidden` body                                        | n/a            |
| UNAUTH                  | No bearer token                                              | 401 upstream (before handler runs)                            | n/a            |
| DB_THROW                | Prisma throws during findMany                                | 500 + `internal_error` body                                   | console.error  |
| EXPAND_ROW_HAS_INCIDENT | Row has `incidentId` set                                     | Row expand panel includes link `/incidents/{incidentId}`      | n/a            |
| EXPAND_ROW_NO_INCIDENT  | Row has `incidentId: null`                                   | Row expand panel hides the link; shows "no incident" hint     | n/a            |
| LIVE_POLL               | TanStack `refetchInterval: 30_000` ticks                     | Re-fetches; new rows appear in the table                      | n/a            |
| ROUTE_NAV_NON_ADMIN     | Operator navigates to `/admin/notifications`                 | `<RbacDenied />` (Story 1.6) renders                          | n/a            |

</frozen-after-approval>

## Code Map

- `_bmad-output/implementation-artifacts/epic-5-context.md` — epic-level context (compile-epic-context output).
- `packages/shared/src/notification.ts:39-91` — existing `NotificationSeveritySchema`, `NotificationPayloadSchema`, `NotificationListEnvelopeSchema`. Story 5.1 ADDS a sibling `AdminNotificationPayloadSchema` (includes `acknowledgedByUserId`) and `AdminNotificationListEnvelopeSchema`.
- `packages/shared/src/rbac.ts:102-345` — RBAC matrix. Story 5.1 ADDS `Admin.read_all.Notification = Y` (all others `N`); lints via `pnpm lint:rbac`.
- `packages/api/src/notifications/notificationRepository.ts:53-118` — `NotificationRow` + `NotificationRepository` interface. Story 5.1 ADDS a `findManyAdmin(args: { severity?, since?, until?, take })` method (no `recipientRole` filter, no `acknowledgedAt: null` filter).
- `packages/api/src/notifications/notificationRouter.ts:341-442` — `buildNotificationRouter` factory. Story 5.1 ADDS the `/api/notifications/admin/list` GET route inside the same factory (single `Router` export, one file). Mirrors the `authorize` + extracted-helper pattern from this file to keep complexity < 12.
- `packages/api/src/notifications/notificationRowToPayload.ts:38-54` — adapter. Story 5.1 ADDS a sibling `adminNotificationRowToPayload(row): AdminNotificationPayload` in the same file.
- `packages/api/src/notifications/routerWiring.ts:40-80` — `mountNotificationRouter`. The 5.1 endpoint is in the same router so the wiring is unchanged.
- `packages/api/src/notifications/notificationRouter.spec.ts:30-105` — existing test rig. Story 5.1 EXTENDS with admin-list cases (mirrors the `startApp` + stub-repo pattern at lines 89-141).
- `packages/web/src/notifications/NotificationsRbacDeniedError.ts:27-32` — existing 4.10 tagged error. Story 5.1 ADDS a sibling `AdminNotificationsRbacDeniedError` (mirror pattern; admin list endpoint is a different surface).
- `packages/web/src/notifications/useNotificationBell.ts` — existing 4.10 hook for the unread bell. Story 5.1 ADDS a sibling `useAdminNotificationList.ts` (different cache key `["admin-notifications", "list", filters]`, `refetchInterval: 30_000`, throws `AdminNotificationsRbacDeniedError` on 403).
- `packages/web/src/admin-notifications/AdminNotificationsPage.tsx` — NEW page component. Renders the table + filter chips + expandable row panel.
- `packages/web/src/admin-notifications/AdminNotificationsPage.spec.tsx` — NEW spec. Mirrors the 4.10 `NotificationBell.spec.tsx` test rig.
- `packages/web/src/main.tsx:222` (line range approximate) — `/admin/*` routes. Story 5.1 INSERTS the `/admin/notifications` route between existing admin routes.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/shared/src/notification.ts` -- ADD `AdminNotificationPayloadSchema` (id, severity, incidentId, alertId, recipientRole, createdAt, acknowledgedAt, acknowledgedByUserId) + `AdminNotificationListEnvelopeSchema` -- admin surface leaks acknowledgedByUserId which the operator-facing wire omits
- [ ] `packages/shared/src/rbac.ts` -- ADD `Admin.read_all.Notification = Y` + `N` for Operator/Technician/Viewer -- new matrix entry so lint:rbac catches drift
- [ ] `packages/api/src/notifications/notificationRepository.ts` -- ADD `findManyAdmin(args: { severity?, since?, until?, take })` to the interface -- extends the existing narrow slice without replacing it
- [ ] `packages/api/src/notifications/notificationRowToPayload.ts` -- ADD `adminNotificationRowToPayload(row): AdminNotificationPayload` -- sibling adapter, mirrors the existing shape
- [ ] `packages/api/src/notifications/notificationRouter.ts` -- ADD `router.get("/api/notifications/admin/list", authorize({ action: "read_all", resource: "Notification" }, audit), handler)` -- the entire handler must stay complexity < 12 via extracted helpers
- [ ] `packages/api/src/notifications/notificationRouter.spec.ts` -- ADD ~10 cases covering the I/O matrix (happy, filtered, empty, 4 × 403, 401, 500, expand-with-incident, expand-without-incident) -- mirrors the existing test rig
- [ ] `packages/web/src/notifications/AdminNotificationsRbacDeniedError.ts` -- NEW tagged error class -- mirrors 4.10's `NotificationsRbacDeniedError`
- [ ] `packages/web/src/notifications/useAdminNotificationList.ts` -- NEW hook (TanStack useQuery, refetchInterval 30s, throws `AdminNotificationsRbacDeniedError` on 403) -- mirrors 4.10's `useNotificationBell` pattern
- [ ] `packages/web/src/admin-notifications/AdminNotificationsPage.tsx` -- NEW page (table + filter chips for severity + date-range selector + expandable row panel with metadata + incident link when incidentId set) -- reuses `_styles.css` mockup tokens
- [ ] `packages/web/src/admin-notifications/AdminNotificationsPage.spec.tsx` -- NEW ~8 cases mirroring KanbanBoard.spec.tsx rig (loading, success, empty, 403 → RbacDenied, 500 → retry, expand with incident, expand without incident, polling)
- [ ] `packages/web/src/main.tsx` -- INSERT `/admin/notifications` route inside `<CurrentRoleProvider><AppShell>` (mirrors the `/admin/users` route pattern) -- admin-only nav surfaces this item

**Acceptance Criteria:**

- Given an Admin visits `/admin/notifications`, when the page renders, then it shows the 100 most recent Notification rows in a table (severity dot, short text from incidentId/severity, recipient role pill, createdAt, acknowledged state), with severity multi-select and date-range filters (last 24h / 7d / 30d / custom).
- Given a row is clicked, when the row expands, then it shows the row's full metadata as JSON (id, severity, incidentId, alertId, recipientRole, createdAt, acknowledgedAt, acknowledgedByUserId) and a link to `/incidents/{incidentId}` if `incidentId` is set; otherwise a "no incident" hint.
- Given an Operator navigates to `/admin/notifications`, when the route resolves, then `<RbacDenied />` from Story 1.6 renders AND `GET /api/notifications/admin/list` returns 403 + `forbidden` body.
- Given `?severity=critical&since=2026-08-29T00:00:00Z` is passed, when the endpoint resolves, then the response contains only rows with `severity = "critical"` AND `createdAt >= since`, ordered by `createdAt DESC`, bounded by `take: 100`.

## Spec Change Log

### Loop 1 — severity multi-select wire shape pinned (bad_spec loopback)

**Triggering finding:** Convergence across all three reviewer layers (Blind Hunter, Edge Case Hunter, Verification Gap). The page renders three severity chips with multi-select affordance (each chip has `aria-pressed` and toggles independently), but the page's filter object passes a SINGLE `severity` value — at `AdminNotificationsPage.tsx:433`, `severity.length === 1 ? { severity: severity[0] as NotificationSeverity } : {}`. When the user selects 2 or 3 severities, the filter DROPS entirely and the api returns ALL rows. The hook's `AdminNotificationFilters.severity` is single-valued (see `useAdminNotificationList.ts:62`), and the router's `adminQuerySchema` accepts a single `severity` (see `notificationRouter.ts:142-146`). The repository's `findManyAdmin.where.severity` is single-valued (see `notificationRepository.ts:118-128`). Net effect: the visual contract says multi-select; the wire contract silently drops multi-select back to "no filter".

**Root cause:** Spec captured the intent ("severity (multi-select)" — line 38; "severity multi-select" AC — line 93) but did NOT pin the wire shape for the multi-select case. Implementation chose single-valued filter object as the easy path; the deviation surfaced only when reviewers traced end-to-end.

**Amendment (non-frozen sections):**

1. Pin the wire shape for severity multi-select as `?severity=critical&severity=warning&severity=info` (repeated `severity` query param). Express + Zod parse `req.query.severity` as `string | string[] | undefined`; coerce to a deduplicated array; pass `{ in: [...] }` (Prisma enum IN-list) into the data layer.
2. Update `AdminNotificationFilters.severity` to `readonly NotificationSeverity[]` (or drop entirely and pass severity as a dedicated array param).
3. Update `findManyAdmin.where.severity` to `readonly severity?: { in: readonly NotificationSeverity[] }` (Prisma's IN-list — `in: [...]`).
4. Update the page's filter construction to pass the full array.
5. Update `buildAdminQueryString` to emit repeated `severity=` params.
6. Update tests to cover 2-chip and 3-chip selection; verify api receives the array.

**Known-bad state avoided:** A future demo where an Admin selects "critical + warning" chips and sees ALL rows (including info) would silently mislead them — the visual chip state and the data layer would diverge. After this loop the chips and the wire are coherent.

**KEEP instructions for re-derivation:**

- KEEP all 4.10 notification work (operator-facing bell, ack, RBAC) untouched.
- KEEP the `AdminNotificationPayload` sibling schema + `acknowledgedByUserId` leakage decision unchanged.
- KEEP the `read_all Notification` matrix entry + lint enforcement.
- KEEP the `parseAdminQueryParams` + `fetchAdminRows` helper-extraction pattern (the handler stays under complexity 10).
- KEEP the existing 11 admin-list router tests; ADD a new "severity multi-select passes array" test that asserts the WHERE clause receives `{ in: [...] }`.
- KEEP the existing `useAdminNotificationList` 30s polling + cache-key-on-filters pattern.
- KEEP the sibling `AdminNotificationsRbacDeniedError` and the page-level `<RbacDenied />` defense-in-depth.
- KEEP the page-level `<RbacRoute>` wrapping (Story 1.6 pattern).
- KEEP the spec's "Severity styling bundle" decision (4.10 SEVERITY_DOT_BG reuse) and the inline panel render pattern (no modal).
- KEEP the existing notificationRouter tests' helper pattern; ADD severity-multi-select coverage.

**Loop counter:** `review_loop_iteration: 1` (was 0).

## Design Notes

**Why a new matrix action vs inline role check:** Adding `read_all Notification` to the matrix keeps the RBAC contract in one place (lint-enforced) instead of scattering `if (req.user.role !== "Admin") return 403` checks across handlers. The inline pattern drifts (one handler does it, another forgets); the matrix pattern is structural. Story 1.5 established this as the load-bearing convention.

**Why a sibling `AdminNotificationPayload` vs extending the existing one:** The operator-facing wire omits `acknowledgedByUserId` because the operator is the actor and shouldn't see "who else acknowledged this." The admin surface is the audit lens — the actor IS the audit trail. Extending the existing schema with an optional `acknowledgedByUserId` would either (a) leak it to the operator (the schema is shared) or (b) require runtime filtering (defensive). A sibling schema keeps each surface's contract honest.

**Why no socket event for the admin list:** The 4.10 spec explicitly forbade adding a `notification:*` socket event. The bell uses 30-second polling. The admin list is a slower-paced surface (audit context, not real-time triage); polling is the right fit. Mirrors the 4.10 decision.

**Why the Prisma `payload` column is NOT added:** The 4.9 writer locked the schema as `severity + incidentId + alertId + recipientRole + createdAt + acknowledgedAt + acknowledgedByUserId`. The spec's "expandable full payload" affordance surfaces the row's metadata as JSON — what's actually persisted — instead of fabricating a freeform payload blob. No retroactive migration; the "payload" in the spec is interpreted as "the row's wire shape, displayed as JSON."

## Verification

**Commands:**

- `pnpm --filter @surakkha/api test -- notificationRouter` -- expected: all 4.10 tests still pass + new 5.1 admin-list cases pass (~10 new).
- `pnpm --filter @surakkha/web test -- AdminNotificationsPage` -- expected: ~8 new cases pass; existing 4.10 bell tests unaffected.
- `pnpm --filter @surakkha/shared test` -- expected: new `AdminNotificationPayloadSchema` parses a row fixture; rejects malformed input.
- `pnpm lint:rbac` -- expected: passes; new `read_all Notification` matrix entry is recognized.
- `pnpm -r typecheck` -- expected: clean; no signature drift on `NotificationRepository` or `buildNotificationRouter`.
- `pnpm --filter @surakkha/web lint` -- expected: passes; new `useAdminNotificationList` + `AdminNotificationsPage` honor the `max-lines` + complexity ceilings.

**Manual checks (if no CLI):**

- Boot api + web; log in as Admin; navigate to `/admin/notifications`; verify the table renders with severity filter chips and date-range selector.
- Log in as Operator; attempt direct navigation to `/admin/notifications`; verify `<RbacDenied />` renders.
- Trigger a notification write (e.g. ack an incident that auto-creates a critical notification); verify it appears in the admin list within 30 seconds (polling).
- Click a row; verify the expand panel shows the row's metadata + a link to `/incidents/{id}` when `incidentId` is set; verify the panel hides the link when `incidentId` is null.
