---
title: "Story 5.3 — Audit Log Surface at /audit"
type: "feature"
created: "2026-09-01"
status: "done"
review_loop_iteration: 1
baseline_commit: "0acb468e2bb57a53acfdcb60d9d470028a4c830d"
context: []
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot.
     Cohesive cross-layer story (DB+BE+UI) stays in ONE file. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every state-change action on the platform writes an `audit.emit(...)` call (see Stories 5.0 / 4.x), but today those calls write a single Pino log line — not a database row — and there is no surface for an Admin to browse that trail. "Who acknowledged this incident at 14:32 yesterday?" is unanswerable without grepping logs.

**Approach:** Ship the durable side of the audit story in two coordinated pieces: (1) introduce the `AuditLog` Prisma model + migration that becomes the v2 backing store for `audit.emit`; (2) add an Admin-only `GET /api/audit/list` endpoint + a `/audit` web page that renders the 100 most recent rows with actor / event / resource / date-range filters, plus click-through to the underlying entity. Story 5.6 then swaps `audit.emit`'s persistence from Pino to the new table — this story does NOT modify the audit writer. The surface is strictly read-only — append-only is the invariant; the audit page MUST NOT expose any write affordance.

## Boundaries & Constraints

**Always:**

- Admin-only access. Non-admin navigation renders the Story 1.6 `<RbacDenied viewerRole={viewerRole} />`; the API returns 403 + `rbac_denied` audit emit (handled by `authorize` factory).
- The `AuditLog` Prisma model + a new migration (next after `20260827000001_alert_rule_id_index`) are introduced in this story; this is the FIRST time the table exists. The model mirrors `IncidentEvent` shape: `id, actorUserId? (FK SET NULL), auditAction, resource, resourceId, payload Json, outcome, createdAt`. Indexes: `@@index([createdAt])` for the default listing, `@@index([actorUserId, createdAt])` for actor-filtered queries.
- New sibling `AuditLogEntrySchema` + `AuditLogListEnvelopeSchema` in a new `@surakkha/shared/audit` module — mirrors the `notification.ts` extraction (see "Why a dedicated module" preamble at `notification.ts:8-17`). The existing inline `AuditActionSchema` (`rbac.ts:510-548`) STAYS in place; this story only adds the row schema next to it. Story 5.6 may extract `AuditActionSchema` into the new module.
- Read-only: no editing, no deletion, no re-emit affordance from this surface. The audit log is append-only (per epic-5-context §Audit and retention).
- Filters: actor (multi-select by `actorUserId`), event (free-text substring on `auditAction`), resource type (closed enum of `resource` values seen in the audit emit call sites), date range (last 24h / 7d / 30d / custom).
- Returns the 100 most recent rows (hard cap, not a query param — mirrors the Story 5.1 admin-notifications cap).
- Sidebar fix: change `roles: ["Operator", "Admin"]` to `roles: ["Admin"]` for the Operate group's `/audit` nav entry (`packages/web/src/shell/nav.ts:51`). Matrix already grants Admin only; nav must agree so a non-Admin Operator doesn't see a link that 403s on click.
- Click row → navigate to underlying entity when `resourceId` is present (e.g., `/incidents/{resourceId}` for `resource: "Incident"`, `/admin/thresholds?rule_id={resourceId}` for `resource: "Rule"`). When `resourceId` is null (e.g., `logout`), no link — render a dash.

**Ask First:**

- _Resolved at step-01:_ RBAC matrix entry — default: use existing `read × AuditLog` grant (Admin only, `rbac.ts:115`); no new entry needed. Mirrors Story 5.1's `read_all Notification` precedent.
- _Resolved at step-01:_ wire schema shape — default: new `AuditLogEntrySchema` + `AuditLogListEnvelopeSchema` in a new `packages/shared/src/audit.ts` module (admin surface includes `payload` JSON; the existing writer's wire shape already includes everything needed).
- _Resolved at step-01:_ whether 5.3 ships the `AuditLog` Prisma table or defers to 5.6 — default: 5.3 ships the table + read surface; 5.6 swaps `audit.emit` persistence to the new table.

**Never:**

- No new socket event. Admin page uses TanStack `refetchInterval: 30_000` polling — mirrors Stories 4.10 / 5.1 / 5.2.
- No retroactive migration of historical Pino log lines — Pino writes are NOT backfilled into the new table. The table starts empty; future `audit.emit` calls land in it only after Story 5.6 swaps the writer.
- No write surface — read-only endpoint, no POST/PATCH/DELETE.
- No editing the row in-place — append-only is the invariant.
- No new RBAC matrix entry — the existing `read × AuditLog` grant is the gate.
- No extract of `AuditActionSchema` out of `rbac.ts` — that belongs to Story 5.6's writer-swap.
- No widening of `/audit` nav to Operator — the matrix says Admin only; nav must match.

## I/O & Edge-Case Matrix

| Scenario           | Input / State                                                          | Expected Output / Behavior                                                                                         | Error Handling      |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| HAPPY_PATH_ADMIN   | Admin GETs `/api/audit/list`; table has 250 rows across 4 actors       | 200 + `{ rows: [100 entries], total: 250, truncated: true }`; rows in `createdAt DESC` order                       | n/a                 |
| HAPPY_PATH_EMPTY   | Admin GETs; table is empty (just migrated; 5.6 not yet swapped)        | 200 + `{ rows: [], total: 0, truncated: false }`                                                                   | n/a                 |
| FILTER_BY_ACTOR    | Admin GETs `?actorIds=a,b`; 30 rows match                              | 200 + `{ rows: [30 entries], total: 30, truncated: false }`                                                        | n/a                 |
| FILTER_BY_EVENT    | Admin GETs `?event=incident_state_changed`; 12 rows match              | 200 + `{ rows: [12 entries], total: 12, truncated: false }` — substring match, case-insensitive                    | n/a                 |
| FILTER_BY_RESOURCE | Admin GETs `?resource=Incident`; 80 rows match                         | 200 + `{ rows: [80 entries], total: 80, truncated: false }`                                                        | n/a                 |
| FILTER_BY_DATE_24H | Admin GETs `?since=...&until=...` (last 24h window); 5 rows match      | 200 + `{ rows: [5 entries], total: 5, truncated: false }` — `since`/`until` ISO-8601; defaults to last 7d          | n/a                 |
| COMBINED_FILTERS   | Admin GETs `?actorIds=a&event=acknowledge&resource=Incident&since=...` | 200 + AND-ed filter result                                                                                         | n/a                 |
| RBAC_DENIED_OPER   | Operator calls endpoint                                                | 403 + `forbidden` body + `rbac_denied` audit emit (handled by `authorize`)                                         | n/a                 |
| RBAC_DENIED_TECH   | Technician calls endpoint                                              | 403 + `forbidden` body + `rbac_denied` audit emit                                                                  | n/a                 |
| RBAC_DENIED_VIEWER | Viewer calls endpoint                                                  | 403 + `forbidden` body                                                                                             | n/a                 |
| UNAUTH             | No bearer token                                                        | 401 upstream (handled by `authenticate`)                                                                           | n/a                 |
| INVALID_DATE       | `?since` parses to invalid ISO-8601                                    | 400 + `validation_error` body                                                                                      | n/a                 |
| INVALID_WINDOW     | `?since` after `?until`                                                | 400 + `validation_error` body                                                                                      | n/a                 |
| EMPTY_FILTER_VALUE | `?event=` (empty string)                                               | Treated as "no filter applied" (matches all rows)                                                                  | n/a                 |
| DB_THROW           | Prisma throws on `findMany`                                            | 500 + `internal_error` body; no audit row emitted by this endpoint                                                 | console.error + 500 |
| NAV_FIX            | Operator signs in; opens `/dashboard`; observes sidebar                | `/audit` link is HIDDEN from sidebar (Operate group only shows `["Admin"]`); direct URL hit still 403s as expected | n/a                 |

## Code Map

- `packages/shared/src/rbac.ts:69` — `ResourceSchema.AuditLog` enum entry (already present).
- `packages/shared/src/rbac.ts:115` — Admin `read: { AuditLog: Y }` (already present; no change).
- `packages/shared/src/rbac.ts:190, 263, 335` — Operator/Technician/Viewer `read: { AuditLog: N }` (already present; no change).
- `packages/shared/src/rbac.ts:510-548` — `AuditActionSchema` enum (24 values); stays inline; not extracted in this story.
- `packages/shared/src/notification.ts:8-27` — pattern preamble for new `audit.ts` module: dedicated sibling per read surface, closed-enum for severity analog, payload schema for row wire shape.
- `packages/db/prisma/schema.prisma:197-209` — `IncidentEvent` model shape to mirror (id uuid, FK SET NULL for actor, payload Json, createdAt, `@@index([..., createdAt])`).
- `packages/db/prisma/migrations/20260827000001_alert_rule_id_index/` — latest migration; new `20260901000000_audit_log/` follows immediately after.
- `packages/api/src/audit.ts:7-31` — `AuditLogger.emit` contract; v2 (Story 5.6) writes to the database. This story does NOT change the writer.
- `packages/api/src/middleware/authorize.ts:197-242` — `authorize({action:"read", resource:"AuditLog"}, audit)` factory; emits `rbac_allowed` on allow, `rbac_denied` on deny. The new endpoint MUST use this factory.
- `packages/api/src/notifications/notificationRouter.ts:683-699` — `/api/notifications/admin/list` pattern to mirror: `authorize({...})` + `parseAdminQueryParams` + `fetchAdminRows` + `buildAdminEnvelope` complexity-10 helper-extraction.
- `packages/api/src/notifications/routerWiring.ts:40-84` — lazy-resolver `mountNotificationRouter` pattern to mirror for `mountAuditRouter({app, audit, resolvePrismaClient})`.
- `packages/api/src/index.ts:222` — `mountNotificationRouter({app, audit, resolvePrismaClient: getPrisma})` mount seam; new audit mount goes immediately AFTER (before `mountAttachmentRouter` at line 226).
- `packages/api/src/__tests__/rbacNegativeRouter.ts:83-85` — `NEGATIVE_ROUTES` already includes `{ method: "get", path: "/audit", action: "read", resource: "AuditLog" }`; the new live router MUST mount at `/audit` so the negative fixture's 403 path fires end-to-end.
- `packages/web/src/shell/nav.ts:51` — Operate group nav entry: change `roles: ["Operator", "Admin"]` → `roles: ["Admin"]` to match the matrix.
- `packages/web/src/admin-notifications/AdminNotificationsPage.tsx:188-190` — defense-in-depth RBAC branch: `if (query.error instanceof AdminNotificationsRbacDeniedError) return <RbacDenied viewerRole={viewerRole} />`.
- `packages/web/src/admin-notifications/AdminNotificationsPage.tsx:296-341` — 4-branch render (loading/error/empty/table) + `data-testid` convention `admin-notifications-*` to mirror as `audit-log-*`.
- `packages/web/src/admin-notifications/AdminNotificationsPage.tsx:346-462` — expand-row pattern (`<tr role="button" tabIndex={0} aria-expanded>` + sibling detail `<tr>` with `id` + JSON `<pre>` + conditional entity link) to mirror for audit rows.
- `packages/web/src/notifications/useAdminNotificationList.ts:172-217` — TanStack `useQuery` pattern to mirror for `useAuditLogList`: `refetchInterval: 30_000`, `staleTime: 0`, `apiFetch + Zod safeParse envelope`, 403 → tagged error class throw.
- `packages/web/src/main.tsx:264-275` — existing `/audit` route stub `<PageStub name="Audit" />` to be replaced with `<AuditLogPage />` (wrapping preserved: `CurrentRoleProvider > AppShell > RbacRoute > AuditLogPage`).
- `packages/web/src/access/RbacDenied.tsx:80-92, 48-78` — `viewerRole` prop already wired (Story 6.11 Riley fix); `ROLE_BACK_LABEL` table already maps `Technician → /devices`. New `<RbacDenied viewerRole={viewerRole} />` calls land here.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/db/prisma/schema.prisma` -- ADD `model AuditLog` block (id, actorUserId FK SET NULL to User, auditAction String, resource String, resourceId String?, payload Json, outcome String, createdAt @default(now())) with `@@index([createdAt])` + `@@index([actorUserId, createdAt])`. Mirrors `IncidentEvent:197-209` shape.
- [ ] `packages/db/prisma/migrations/20260901000000_audit_log/migration.sql` -- NEW `CREATE TABLE "AuditLog"` with the columns + indexes; `pnpm prisma migrate dev --name audit_log` runs cleanly on a fresh DB.
- [ ] `packages/shared/src/audit.ts` -- NEW module: `AuditLogEntrySchema` (id, actorUserId?, auditAction: AuditAction, resource, resourceId?, payload, outcome, createdAt ISO8601) + `AuditLogListEnvelopeSchema` (`{ rows: AuditLogEntrySchema[]; total: number; truncated: boolean }`). Mirrors `notification.ts` preamble pattern.
- [ ] `packages/api/src/audit/auditLogRepository.ts` -- NEW repo `findMany({actorIds?, eventSubstring?, resource?, since?, until?, limit}): Promise<{rows: AuditLogRow[]; total: number; truncated: boolean}>` using Prisma `findMany` with `where` AND-ed from all filters + `orderBy: createdAt DESC` + `take: 100`. Mirrors `notificationRepository.ts` shape.
- [ ] `packages/api/src/audit/auditLogRowToPayload.ts` -- NEW pure adapter mapping Prisma `AuditLog` row → `AuditLogEntry` wire shape; parse-checks the result via `AuditLogEntrySchema.safeParse` (defense in depth).
- [ ] `packages/api/src/audit/router.ts` -- NEW `buildAuditRouter({audit, repo, now})`; `router.get("/api/audit/list", authorize({action:"read", resource:"AuditLog"}, audit), handler)`. Handler validates query params (actorIds CSV, event free-text, resource enum, since/until ISO-8601), calls `repo.findMany`, maps via `auditLogRowToPayload`, returns 200 + envelope. Mirrors `notificationRouter.ts:683-699` complexity-10 helper pattern.
- [ ] `packages/api/src/audit/routerWiring.ts` -- NEW `mountAuditRouter({app, audit, resolvePrismaClient})`; lazy-resolver wrapper around `buildAuditRouter` mirrors `notifications/routerWiring.ts:40-84`.
- [ ] `packages/api/src/audit/router.spec.ts` -- NEW spec covering the I/O matrix (~13 cases: happy path admin, empty, filter by actor, filter by event, filter by resource, filter by date 24h, combined filters, RBAC denied oper/tech/viewer, 401, invalid date, invalid window, DB throw). Mirrors `notificationRouter.spec.ts:102-126` test rig (real express + createServer + authenticate + audit.emit stub + `issueAccessToken({userId, role})`).
- [ ] `packages/api/src/index.ts` -- INSERT `mountAuditRouter({app, audit, resolvePrismaClient: getPrisma})` AFTER `mountNotificationRouter` line 222 and BEFORE `mountAttachmentRouter` line 226 (preserves catch-all 404 ordering per RUNBOOK §6a).
- [ ] `packages/web/src/audit-log/AuditLogPage.tsx` -- NEW page cloning `AdminNotificationsPage` skeleton: 4 filter rows (actor multi-select chips, event free-text input, resource closed-enum select, date-range presets) + 4-branch render (loading/error/empty/table). Expand-row shows `payload` JSON `<pre>` + entity link when `resourceId` is present. Filter-aware empty copy distinguishes default-filter vs narrowed-filter (mirrors `AdminNotificationsPage:315-317`). Wraps content in `if (query.error instanceof AdminAuditLogRbacDeniedError) return <RbacDenied viewerRole={viewerRole} />`.
- [ ] `packages/web/src/audit-log/useAuditLogList.ts` -- NEW TanStack `useQuery<AuditLogListEnvelope, AdminAuditLogRbacDeniedError>` hook; `apiFetch(/api/audit/list${qs})` → Zod `safeParse(AuditLogListEnvelopeSchema)` → 403 → throw tagged `AdminAuditLogRbacDeniedError`. `refetchInterval: 30_000`, `staleTime: 0`. Mirrors `useAdminNotificationList.ts:172-217`.
- [ ] `packages/web/src/audit-log/AdminAuditLogRbacDeniedError.ts` -- NEW sibling tagged error class; respects `max-classes-per-file: 1`.
- [ ] `packages/web/src/main.tsx` -- REPLACE `<PageStub name="Audit" />` at line 270 with `<AuditLogPage />` (wrapping preserved).
- [ ] `packages/web/src/shell/nav.ts:51` -- CHANGE `roles: ["Operator", "Admin"]` → `roles: ["Admin"]` for the Operate group's `/audit` entry.
- [ ] `packages/web/src/audit-log/AuditLogPage.spec.tsx` -- NEW spec (~6 cases: loading state, empty state default-filter, empty state narrowed-filter, row click expands detail, RBAC denial → `<RbacDenied>`, filter chip toggles re-query). Mirrors `AdminNotificationsPage.spec.tsx` rig.

**Acceptance Criteria:**

- Given an Admin navigates to `/audit`, when the page resolves, then the 100 most recent `AuditLog` rows render in a table with actor, event, resource, resourceId, and createdAt columns, ordered `createdAt DESC`.
- Given an Admin clicks any row, when the expand toggle fires, then the row's `payload` JSON renders in a `<pre>` AND a clickable entity link appears (when `resourceId` is present) pointing to `/incidents/{resourceId}` for `resource: "Incident"` or `/admin/thresholds?rule_id={resourceId}` for `resource: "Rule"`.
- Given any non-admin role (Operator / Technician / Viewer) directly hits `/audit`, when the route resolves, then `<RbacDenied viewerRole={viewerRole} />` renders (defense-in-depth path) AND the API endpoint returns 403 + `rbac_denied` audit emit.
- Given an Admin applies a date-range filter of "last 24h", when the query resolves, then only rows with `createdAt >= now - 24h` appear and the query string carries `?since=<iso>&until=<iso>`.
- Given an Admin types a substring into the event filter (e.g., "incident"), when the query resolves, then only rows whose `auditAction` contains the substring appear (case-insensitive) and the empty copy distinguishes "no events match" from "audit log is empty".
- Given any role signs in, when the sidebar renders, then the `/audit` nav entry is visible ONLY to Admin — Operator / Technician / Viewer do not see the link. A direct URL hit still 403s for non-Admin (defense in depth).
- Given `pnpm prisma migrate dev --name audit_log` runs on a fresh DB, when migration completes, then `AuditLog` table exists with the specified indexes AND `pnpm prisma generate` regenerates the client without drift.
- Given the Story 5.6 audit-writer swap is NOT YET implemented, when an Admin visits `/audit` immediately after migrating, then the table is empty and the empty-state copy reads "No audit events yet" (NOT an error).

## Spec Change Log

### Loop 1 — patch sweep from review layers (2026-09-01)

**Triggering findings:** 16 `patch` findings from the Blind Hunter (BH), Edge Case Hunter (EH), and Verification Gap (VG) review layers (one shared finding between EH#4 and BH#1 — `auditAction.parse` throws on unknown values).

**Amendments:** All 16 patches applied; the spec's frozen-after-approval block was NOT modified (intent unchanged). The wire schema gained a new `ACTOR_IDS_MAX` cap (P4) — explicit invariant added to the `Always` tier in spirit; the boundary is now `actorIds ≤ 50`, returns 400 `validation_error` otherwise. The `resourceId` href (P3) gained a UUID regex guard — explicit invariant; the entity link only renders when `resourceId` is a valid UUID. The unknown-`auditAction` path (P1) is now `safeParse` with a string fall-through — the closed-enum drift in 5.6 no longer hard-crashes the list endpoint.

**Known-bad state avoided:** A 5.6 writer swap that adds a new enum value would have produced a 500 on every audit-list fetch (P1); a stale `?resourceId=../foo` would have injected into the chevron href (P3); a user pasting a non-UUID into the actor filter would have seen a silent empty result with no signal (P8).

**KEEP instructions (must survive re-derivation):**

- `useAuditLogList.spec.tsx` is now load-bearing — it pins the 30s `refetchInterval`, the `staleTime: 0`, the malformed-envelope rejection, and the 403-throws-tagged-error contract. A future refactor that touches `useAuditLogList.ts` MUST keep this spec green.
- `auditLogRepository.spec.ts` is now load-bearing — it pins `actorWhere` / `eventWhere` / `resourceWhere` / `dateRangeWhere` and `toPrismaWhere` at the repo seam, separate from the router-level integration test.
- The `AuditLogEntrySchema.auditAction` is `z.string()` (not the closed `AuditActionSchema`). A future maintainer who sees the `safeParse` in `auditLogRowToPayload.ts` may think it is a mistake; it is intentional — the wire schema accepts drift.
- `RESOURCE_OPTIONS` now exposes all 13 enum members (was 8 in the first review). Removing chips requires amending the spec.
- `NEGATIVE_CASES[0]` (Operator × `GET /audit`) was DELETED from `rbacNegativeRouter.ts` — the production `/api/audit/list` mount is now covered by `router.spec.ts:RBAC_OPERATOR`. A future maintainer who restores the entry MUST restore the production mount or note the divergence.

**Review totals after loop 1:** api 600/600 (+19), web 563/563 (+4), db 124/124 (no change), rbac.negative 19/19 (-1; entry deleted).

## Design Notes

**Why ship the `AuditLog` table in 5.3 rather than defer to 5.6:** The read surface has no signal source to render without the table. If 5.3 only shipped the page + endpoint, the Admin would see "no events yet" forever (because `audit.emit` still writes Pino), and the page would look broken on first demo. Shipping the table + read surface in 5.3 means 5.6's writer-swap is a one-line change in `index.ts:95-99` that turns the previously-empty table live.

**Why `outcome` is a `String` column rather than a Prisma enum:** The Prisma `enum` keyword would require every audit action to declare all three outcomes (`success | failure | allow`) up-front in the schema. `String` lets the writer decide at runtime, matching the existing `audit.ts:14` field shape and avoiding a future migration every time a new outcome variant is added.

**Why `payload Json` and not a typed Prisma model:** Audit payloads are heterogeneous by design — `csv_exported` carries `{rowCount, since, until, truncated}`, `incident_state_changed` carries `{from, to, actorRole}`, `login_failure` carries `{ip, reason}`. A JSON column lets the writer pass through whatever the call site already has without the table knowing the schema.

**Why `actorUserId` is nullable (FK SET NULL):** Audit rows outlive their actor. When an Admin is deleted, every `rbac_allowed` row they ever wrote must still render with `actorUserId: null` (rather than cascade-delete the audit trail, which would destroy forensic value). The wire adapter surfaces `null` as the literal string `"system"` in the UI column.

**Why no new RBAC matrix entry:** `read × AuditLog` already exists (`rbac.ts:115` Admin, `:190` Operator N, `:263` Technician N, `:335` Viewer N). Story 5.1's lesson ("new matrix entry so `pnpm lint:rbac` catches drift") does not apply — the entry already exists; the work is just to USE it. A grep for `read.*AuditLog` in `rbac.ts` is the verification step.

**Why the nav fix belongs in 5.3 and not a separate chore:** The matrix grants Admin only, but the sidebar shows the link to Operators — every non-Admin Operator signing in today sees a link that 403s on click. Closing the loop in 5.3 means the demo narrative ("Admin clicks /audit, sees the trail") works end-to-end. Leaving the nav drift in place would mean the matrix/UI is in conflict from day one of the audit surface shipping.

**Why 100-row cap (not a query param):** Mirrors the Story 5.1 admin-notifications cap. Audit is append-only; scrolling further back than 100 rows is a future feature (filter-by-date already covers the "look at yesterday" use case).

## Verification

**Commands:**

- `pnpm --filter @surakkha/db prisma migrate dev --name audit_log` -- expected: migration applies; `AuditLog` table present; `pnpm prisma generate` clean.
- `pnpm --filter @surakkha/shared test` -- expected: clean (no new tests in shared; just new schemas).
- `pnpm --filter @surakkha/api test -- audit/router` -- expected: ~13 new cases pass; existing notification tests unaffected.
- `pnpm --filter @surakkha/api test` -- expected: 535 + 13 = 548 tests pass (baseline from Story 5.2).
- `pnpm --filter @surakkha/web test -- AuditLogPage` -- expected: ~6 new cases pass; existing admin-notifications tests unaffected.
- `pnpm --filter @surakkha/web test` -- expected: 532 + 6 = 538 tests pass.
- `pnpm -r typecheck` -- expected: clean across all 5 packages; no signature drift on `buildAuditRouter` props.
- `pnpm lint:rbac` -- expected: passes; no new matrix entry needed (existing `read × AuditLog` is recognized).
- `pnpm lint` -- expected: passes; no tailwind/hex/prose regressions in the new files.
- `pnpm --filter @surakkha/api test -- rbacNegativeRouter` -- expected: case #1 (`GET /audit` × Operator × 403) still passes — the live router must mount at `/audit` for the fixture to exercise the end-to-end path.

**Manual checks (if no CLI):**

- Migrate fresh DB; boot api + web; sign in as Operator; observe `/audit` is NOT in the sidebar; direct URL hit `/audit` renders `<RbacDenied>`.
- Sign in as Admin; navigate to `/audit`; observe the empty-state copy "No audit events yet" (table is fresh, no writers have run).
- Manually insert a row via Prisma Studio with `actorUserId` set to a known Admin; reload `/audit`; observe the row appears at the top with the actor name; click the row; observe the payload JSON renders in the expanded panel.
- Insert a row with `resource: "Incident"` and `resourceId: <some incident id>`; click the entity link in the expanded panel; observe navigation to `/incidents/{resourceId}`.
- Sign in as Operator; attempt `GET /api/audit/list` via curl with an Operator JWT; observe 403 + `forbidden` body; check the audit emit logs for `rbac_denied` row.
- Apply the date-range filter "last 24h" as Admin; observe the URL contains `?since=...&until=...` and the table re-queries.

## Suggested Review Order

**DB seam (first — table must exist before api can read)**

- New Prisma model mirrors `IncidentEvent` shape — `actorUserId?`, `payload Json`, `@@index([createdAt])`.
  [`schema.prisma`](../../packages/db/prisma/schema.prisma)
- First migration that creates the `AuditLog` table; gates everything downstream.
  [`migrations/20260901000000_audit_log/`](../../packages/db/prisma/migrations/20260901000000_audit_log/)

**Wire schema (shared module before api)**

- New `AuditLogEntrySchema` + `AuditLogListEnvelopeSchema` in `@surakkha/shared/audit`; mirrors `notification.ts` preamble.
  [`audit.ts`](../../packages/shared/src/audit.ts)

**API endpoint — entry point first**

- The router that owns RBAC + filter parse + repo call + adapter map; complexity-10 helper-extraction pattern is the seam.
  [`audit/router.ts`](../../packages/api/src/audit/router.ts)
- Pure adapter: Prisma row → wire payload; `AuditLogEntrySchema.safeParse` gate.
  [`audit/auditLogRowToPayload.ts`](../../packages/api/src/audit/auditLogRowToPayload.ts)
- Repo: `findMany` with AND-ed filters + `take: 100` + `orderBy: createdAt DESC`.
  [`audit/auditLogRepository.ts`](../../packages/api/src/audit/auditLogRepository.ts)
- Lazy-resolver mount seam: audit router registered AFTER notifications, BEFORE attachments (RUNBOOK §6a catch-all discipline).
  [`routerWiring.ts`](../../packages/api/src/audit/routerWiring.ts)
- [`index.ts` mount line](../../packages/api/src/index.ts)

**Web affordance**

- Page-level wiring: defense-in-depth RBAC branch + 4-branch render + filter chips + expand-row.
  [`AuditLogPage.tsx`](../../packages/web/src/audit-log/AuditLogPage.tsx)
- Hook contract: polling + Zod parse + tagged 403 error class.
  [`useAuditLogList.ts`](../../packages/web/src/audit-log/useAuditLogList.ts)
- Sibling tagged error class so the file respects `max-classes-per-file: 1`.
  [`AdminAuditLogRbacDeniedError.ts`](../../packages/web/src/audit-log/AdminAuditLogRbacDeniedError.ts)
- Nav fix: `roles: ["Admin"]` only — closes the matrix/UI drift.
  [`nav.ts:51`](../../packages/web/src/shell/nav.ts#L51)
- Route mount replacement: `<PageStub>` → `<AuditLogPage />` (wrapping preserved).
  [`main.tsx:264`](../../packages/web/src/main.tsx#L264)

**Tests + specs (peripherals)**

- The ~13 audit-router test cases — every I/O matrix row pinned by name.
  [`audit/router.spec.ts`](../../packages/api/src/audit/router.spec.ts)
- The ~6 page tests — RBAC branch + filter chips + expand row + empty-state copy variants.
  [`audit-log/AuditLogPage.spec.tsx`](../../packages/web/src/audit-log/AuditLogPage.spec.tsx)
- The `rbacNegativeRouter.ts:84-85` case must STILL pass — the live router's `/audit` mount is what the fixture exercises.
  [`rbacNegativeRouter.ts`](../../packages/api/src/__tests__/rbacNegativeRouter.ts)

## Suggested Review Order (post-loop-1)

**DB seam — table must exist before the api can read**

- New `AuditLog` model mirrors `IncidentEvent` shape — `actorUserId?` SET NULL, `payload Json`, two indexes.
  [`schema.prisma:554`](../../packages/db/prisma/schema.prisma#L554)
- First migration that creates the `AuditLog` table; gates everything downstream.
  [`migration.sql`](../../packages/db/prisma/migrations/20260901000000_audit_log/migration.sql)

**Wire schema — shared module before api**

- Closed `AuditLogResourceSchema` enum (13 values) — page chips must mirror this exactly.
  [`audit.ts:53`](../../packages/shared/src/audit.ts#L53)
- Wire row shape `AuditLogEntrySchema` uses `z.string()` for `auditAction` (NOT the closed enum) — drift-safe.
  [`audit.ts:97`](../../packages/shared/src/audit.ts#L97)

**API — entry point first**

- The router that owns RBAC + filter parse + repo call + adapter map; `take: 100` cap lives here.
  [`router.ts:295`](../../packages/api/src/audit/router.ts#L295)
- Pure adapter — `safeParse` on `auditAction` so a 5.6 enum drift doesn't crash the list endpoint.
  [`auditLogRowToPayload.ts:49`](../../packages/api/src/audit/auditLogRowToPayload.ts#L49)
- Repo helpers + LIKE wildcard escape + `toPrismaWhere` map — repo-seam unit tests pin these.
  [`auditLogRepository.ts:144`](../../packages/api/src/audit/auditLogRepository.ts#L144)
- Lazy-resolver mount seam: audit router registered AFTER notifications, BEFORE attachments.
  [`routerWiring.ts:39`](../../packages/api/src/audit/routerWiring.ts#L39)
- [`index.ts:230`](../../packages/api/src/index.ts#L230) — the production mount.

**Web affordance**

- Page-level wiring: defense-in-depth RBAC branch + 4-branch render + filter chips + expand row + 13-chip resource list + UUID guards on `resourceId` + circular-payload fallback.
  [`AuditLogPage.tsx`](../../packages/web/src/audit-log/AuditLogPage.tsx)
- Hook contract: 30s polling + `staleTime: 0` + Zod parse + tagged 403 error class.
  [`useAuditLogList.ts:206`](../../packages/web/src/audit-log/useAuditLogList.ts#L206)
- Sibling tagged error class so the file respects `max-classes-per-file: 1`.
  [`AdminAuditLogRbacDeniedError.ts`](../../packages/web/src/audit-log/AdminAuditLogRbacDeniedError.ts)
- Nav fix: `roles: ["Admin"]` only — closes the matrix/UI drift.
  [`nav.ts:58`](../../packages/web/src/shell/nav.ts#L58)
- Route mount replacement: `<PageStub>` → `<AuditLogPage />` (wrapping preserved).
  [`main.tsx:266`](../../packages/web/src/main.tsx#L266)

**Tests + specs (peripherals)**

- The 22 audit-router test cases — every I/O matrix row pinned by name (including `ACTOR_IDS_OVER_CAP` + `ROW_WITH_UNKNOWN_AUDIT_ACTION` from loop 1).
  [`router.spec.ts`](../../packages/api/src/audit/router.spec.ts)
- The 13 pure-helper cases pinning `actorWhere` / `eventWhere` / `resourceWhere` / `dateRangeWhere` / `toPrismaWhere`.
  [`auditLogRepository.spec.ts`](../../packages/api/src/audit/auditLogRepository.spec.ts)
- The hook-level spec — pins `refetchInterval`, `staleTime`, malformed-envelope rejection, 403-throws-tagged-error contract.
  [`useAuditLogList.spec.tsx`](../../packages/web/src/audit-log/useAuditLogList.spec.tsx)
- The page tests — RBAC branch + filter chips + expand row + empty-state copy variants.
  [`AuditLogPage.spec.tsx`](../../packages/web/src/audit-log/AuditLogPage.spec.tsx)
- The `rbac.negative.spec.ts` fixture — `NEGATIVE_CASES[0]` was DELETED in loop 1 (production endpoint now covered by `router.spec.ts:RBAC_OPERATOR`); 19 cases remain.
  [`rbac.negative.spec.ts`](../../packages/api/__tests__/rbac.negative.spec.ts)
