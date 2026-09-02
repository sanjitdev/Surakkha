# Test spec — `packages/api/src/notifications/` critique loop

**Date:** 2026-09-02
**Surface:** `packages/api/src/notifications/` (refinement of headers + cross-file refs + story jargon + Loop-N hardening markers)
**Companion critique:** `.impeccable/critique/2026-09-02T26-00-00Z__packages-api-src-notifications.md` (22/40, 3 P1 + 33 P2)

This spec pins the load-bearing invariants of the notifications surface
that survived the refactor pass. The header-trim + cross-file / story-
codes / "Loop 1 hardening" removal work does not change behaviour; this
spec verifies that the contracts (idempotent P2002 double-click writer,
compare-and-set idempotent PATCH ack, cross-role RBAC, admin audit
lens, lazy repo resolution, range-bound check) still hold.

## Behavioural pins (Given/When/Then)

### Writer (notificationWriter.ts)

- **B-WR-1**: Given `writeNotification(repo, { severity, incidentId,
alertId })` and a non-null `incidentId`, when called, then it pins
  `recipientRole: "Operator"` (no role leak from the call site).
- **B-WR-2**: Given the first call succeeds, when a SECOND call with
  the same `(incidentId, severity)` arrives before the row is
  acknowledged, then `tx.notification.create` throws P2002 (partial
  unique index gate), and `writeNotification` refetches the active row
  and returns `{ id: existing.id, wasInserted: false }` (idempotent
  double-click).
- **B-WR-3**: Given `writeNotification` and the rare race where the
  active row was acknowledged between the failed INSERT and the
  refetch (so `findFirst` returns `null`), when the fallback path
  runs, then `writeNotification` re-inserts a fresh active row and
  returns `{ wasInserted: true }` (the partial unique index gate just
  opened — a fresh row can land).
- **B-WR-4**: Given `writeNotification(repo, { incidentId: null, ... })`,
  when called, then it skips the idempotency fast path and inserts a
  non-indexed row (no `incidentId` means the partial unique index
  doesn't apply; the row still lands but isn't dedup'd).
- **B-WR-5**: Given `writeNotification` and a non-P2002 error (any
  other DB / network / Prisma exception), when `isPrismaP2002(err)`
  returns false, then `writeNotification` RE-THROWS the original error
  (caller sees the real failure; no silent suppression).
- **B-WR-6**: Given `writeCriticalNotification(repo, { incidentId,
alertId })`, when called, then it delegates to `writeNotification`
  with `severity: "critical"`.
- **B-WR-7**: Given `writeWarningNotification(repo, { incidentId,
alertId })`, when called, then it delegates to `writeNotification`
  with `severity: "warning"`.
- **B-WR-8**: Given `isPrismaP2002(err)` and `err.code === "P2002"`,
  when called, then it returns `true`.
- **B-WR-9**: Given `isPrismaP2002(err)` and `err` is null OR non-
  object OR `err.code !== "P2002"`, when called, then it returns
  `false`.

### Repository + adapter (notificationRepository.ts)

- **B-REPO-1**: Given `resolveNotificationRepository(prisma)` and the
  real Prisma client (post-`prisma generate` against the Story 5.1
  schema), when called, then it returns a `NotificationRepository`
  exposing `findMany`, `findManyAdmin`, `findUnique`, `updateMany`
  slices.
- **B-REPO-2**: Given `resolveNotificationRepository(prisma)` and a
  Prisma client where `client.notification.findManyAdmin` is
  `undefined`, when called, then it throws
  `Error("Prisma client missing `notification.findManyAdmin`extension;
run`prisma generate` against the Story 5.1 schema.")` — fail loud
  on a stale client (silent fallback would apply operator filters the
  admin endpoint DROPS).
- **B-REPO-3**: Given `findMany` with `where: { recipientRole:
"Operator", acknowledgedAt: null }`, when called, then it returns
  the operator-scoped unread list ordered `createdAt DESC` and
  bounded by `take` (no already-acknowledged rows leak into the
  wire payload).
- **B-REPO-4**: Given `findManyAdmin` with `where: { severity: { in:
["warning", "critical"] }, since: ..., until: ... }`, when called,
  then it returns the full audit trail (no `recipientRole` filter, no
  `acknowledgedAt: null` filter) for the requested severities + date
  range.
- **B-REPO-5**: Given `updateMany({ where: { id, acknowledgedAt: null },
data: { acknowledgedAt, acknowledgedByUserId }})` and the row is
  already-acknowledged, when called, then it returns `{ count: 0 }`
  (the predicate is the serialization point — the concurrent writer
  lost).

### Row-to-payload (notificationRowToPayload.ts)

- **B-RTP-1**: Given `notificationRowToPayload(row)`, when called,
  then the returned `NotificationPayload` has `createdAt` as an ISO
  8601 string and `acknowledgedAt` as either `null` or an ISO 8601
  string (Date → string conversion at the wire boundary).
- **B-RTP-2**: Given `notificationRowToPayload(row)`, when called,
  then `acknowledgedByUserId` is INTENTIONALLY DROPPED from the
  operator-facing payload (the field is implementation detail; the
  DB column persists it for admin audit use).
- **B-RTP-3**: Given `adminNotificationRowToPayload(row)`, when
  called, then the returned `AdminNotificationPayload` includes
  `acknowledgedByUserId` (audit detail surface).
- **B-RTP-4**: Given the admin envelope built from `rows.map(adminNotificationRowToPayload)`,
  when `AdminNotificationListEnvelopeSchema.safeParse(envelope)` runs,
  then it returns `{ success: true }` (the schema's `safeParse`
  rejects a response that lacks the field — defense in depth against
  a future router regression that swaps the adapter back).

### Router (notificationRouter.ts)

- **B-RT-1**: Given `GET /api/notifications` and the actor's
  `req.user.role === "Operator"`, when the handler runs, then it
  queries `findMany({ where: { recipientRole: "Operator",
acknowledgedAt: null }, orderBy: { createdAt: "desc" }, take: 50 })`
  and returns `{ notifications: [...] }` with HTTP 200.
- **B-RT-2**: Given `GET /api/notifications` and `req.user.role` is
  undefined OR not in `VALID_RECIPIENT_ROLES`, when the handler runs,
  then it returns 500 with `{ error: "internal_error" }` (defensive
  guard — a future role slipping past the matrix surface 500 rather
  than passing an unknown value to the Prisma enum filter).
- **B-RT-3**: Given `PATCH /api/notifications/:id/acknowledge` and a
  path `:id` that fails `idPathSchema.safeParse`, when the handler
  runs, then it returns 400 with `{ error: "validation_error",
issues: [...] }` (Zod issues exposed for the client).
- **B-RT-4**: Given `PATCH /:id/acknowledge` and the fetched row's
  `recipientRole` differs from the actor's role, when
  `enforceCrossRoleRecipient` runs, then it:
  1. Emits an `auditAction: "rbac_denied"` audit row with
     `reason: "cross_role_recipient"`, `notification_id: row.id`,
     `recipient_role: row.recipientRole`
  2. Returns 403 with `{ error: "forbidden", required_role:
row.recipientRole }` (the actor knows which role CAN ack this row)
- **B-RT-5**: Given `PATCH /:id/acknowledge` and the FIRST ack
  (row not yet acknowledged), when `applyAck` runs, then it returns
  `count: 1` (compare-and-set succeeded), and the response body's
  `acknowledgedAt` matches the `acknowledgedAt` field set by
  `updateMany`. The log emits `first=true`.
- **B-RT-6**: Given `PATCH /:id/acknowledge` and the SECOND ack
  (already-acknowledged row), when `applyAck` runs, then it returns
  `count: 0` (the `acknowledgedAt: null` predicate failed; no row
  updated), the router re-fetches the row, and the handler returns
  200 with the existing row's `acknowledgedAt` (NOT a 409). The log
  emits `first=false`.
- **B-RT-7**: Given `PATCH /:id/acknowledge` and the row vanished
  between `findUnique` and `refetchRow` (vanishingly rare race),
  when `refetchRow` runs, then it returns `null` and the handler
  responds with HTTP 404 (defensive — structurally impossible under
  `onDelete: SetNull` for Incident / Alert FKs).
- **B-RT-8**: Given `GET /api/notifications/admin/list` with query
  `?severity=warning&severity=critical&since=2026-09-01T00:00:00Z
&until=2026-10-01T00:00:00Z`, when the handler runs, then it:
  1. Dedupes the multi-valued severity into
     `["warning", "critical"]`
  2. Coerces strings via `NotificationSeveritySchema`
  3. Builds `AdminNotificationFilters = { severity: { in:
["warning", "critical"] }, since: 2026-09-01, until: 2026-10-01 }`
  4. Calls `findManyAdmin` with `take: 100`
  5. Returns the strict-validated envelope
- **B-RT-9**: Given `GET /admin/list` and `since >= until` (the
  range-bound check), when `parseAdminQueryParams` runs, then it
  returns 400 with `{ error: "invalid_range", message: "`since`must
be strictly less than`until`" }` (would otherwise yield an empty
  result silently).
- **B-RT-10**: Given `GET /admin/list` and the admin envelope shape
  check fails (e.g. `acknowledgedByUserId` omitted by a future router
  regression), when `buildAdminEnvelope` runs, then it returns 500
  with `{ error: "internal_error" }` and `console.error` logs the
  parse failure (meaningful signal for ops).

### Router wiring (routerWiring.ts)

- **B-WIRE-1**: Given `mountNotificationRouter` and `DATABASE_URL`
  unset at api boot, when the mount is called, then it does NOT throw
  (lazy resolution — first request fails, then per-handler catch
  surfaces 500).
- **B-WIRE-2**: Given `mountNotificationRouter`'s first `repo.notification.findMany`
  call, when it runs, then `ensureRepo()` resolves the Prisma client
  via the injected `resolvePrismaClient`, narrows via
  `resolveNotificationRepository`, and caches the result for the
  second call (no re-resolve per request).
- **B-WIRE-3**: Given `mountNotificationRouter`'s `repo.notification.updateMany`
  call, when it runs, then the wrapper delegates to the cached repo
  (the same seam path the other three methods use).

### Index (index.ts)

- **B-IDX-1**: Given the public surface of `notifications/`, when
  imported, then it exposes `NotificationRepository`,
  `NotificationRow`, `resolveNotificationRepository`,
  `buildNotificationRouter`, `NotificationRouterDeps`. The writer
  is internal-only (no barrel for `writeNotification` /
  `writeCriticalNotification` / `writeWarningNotification` /
  `NotificationWriterRepository`).

## Static / lint pins (Property/Required value)

- **S-1**: All 6 modified source files in
  `packages/api/src/notifications/` have NO `/** ... */` block
  opening longer than 7 lines.
- **S-2**: No file in `packages/api/src/notifications/` contains
  `F-P` (fix-history markers removed).
- **S-3**: No file in `packages/api/src/notifications/` contains a
  line reference of the form `\w+\.ts:\d+` (cross-file line refs
  removed).
- **S-4**: No file in `packages/api/src/notifications/` contains
  `Story 3.4`, `Story 3.5`, `Story 4.9`, `Story 4.10`, `Story 5.1`,
  or any 4.x code (story-jargon in source removed; the spec is the
  canonical record).
- **S-5**: No file in `packages/api/src/notifications/` contains
  `Loop 1 fix`, `Loop 1 hardening`, `review finding H2/E10`,
  `IncidentEventRowToPayload` (legacy pattern names removed).
- **S-6**: `notificationRouter.ts`'s `NOTIFICATION_TAKE_LIMIT = 50`
  - `ADMIN_NOTIFICATION_TAKE_LIMIT = 100` are preserved exactly
    (load-bearing for the dropdown / table "no pagination in v1" pin).
- **S-7**: `notificationWriter.ts`'s `PRISMA_P2002 = "P2002"`
  constant is preserved exactly (Prisma's unique-constraint
  violation code).
- **S-8**: `notificationRepository.ts`'s `findManyAdmin` lazy-throw
  in `resolveNotificationRepository` is preserved exactly (fail-loud
  pin for a future Prisma regeneration that drops the extension).
- **S-9**: `pnpm tsc -b` runs green on `packages/api`.
- **S-10**: `pnpm eslint src/notifications` runs green.

## Behaviour / Must-NOT (negative pins)

- **N-1**: When `writeNotification` is called with a non-P2002
  error, it MUST NOT silently suppress — the error re-throws.
- **N-2**: When `writeNotification`'s P2002 catch fires and the
  refetched row exists, it MUST NOT insert a new row — the existing
  row is returned with `wasInserted: false`.
- **N-3**: When `findManyAdmin` is missing on the Prisma client
  (extension dropped), `resolveNotificationRepository` MUST throw
  — silently falling back to `findMany` would apply operator filters
  the admin endpoint DROPS.
- **N-4**: When `PATCH /:id/acknowledge` is called and the row is
  already-acknowledged, the router MUST NOT return 409 — it returns
  200 with the existing row.
- **N-5**: When `parseAdminQueryParams` is called with `since >=
until`, the handler MUST return 400 with `invalid_range` (the
  silent-empty-result bug is the surface this guards against).
- **N-6**: When `enforceCrossRoleRecipient` denies the actor, the
  audit emit MUST fire BEFORE the 403 (operators can read the audit
  trail and see why).
- **N-7**: When `notificationRowToPayload` runs, it MUST drop
  `acknowledgedByUserId` from the operator-facing wire payload —
  that field is admin-only audit detail.
- **N-8**: When `buildAdminEnvelope` runs and the strict-shape
  validation fails, it MUST return 500 (not 200) — the admin-facing
  payload MUST NOT lack `acknowledgedByUserId`.
- **N-9**: When `mountNotificationRouter` is called and the api
  has no `DATABASE_URL` at boot, it MUST NOT throw — the wrapper
  defers resolution until first request.
- **N-10**: When `isPrismaP2002` is called on an error whose shape
  varies across Prisma versions, it MUST rely ONLY on the `code`
  field — no `meta`, no `clientVersion`, no `message` checks
  (those drift across versions).

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/notifications
cd packages/api && npx vitest run src/notifications
```

Existing specs (must stay green):

- `notificationWriter.spec.ts` — P2002 catch + double-click
  idempotency + race-acknowledged-between fallback
- `notificationRepository.spec.ts` — slice adapter + lazy throw +
  findManyAdmin extension check
- `notificationRowToPayload.spec.ts` — wire shape (operator +
  admin) + `acknowledgedByUserId` partition
- `notificationRouter.spec.ts` — GET + PATCH (idempotent re-ack +
  cross-role RBAC) + GET admin/list (severity chips + range check)

The contract surfaces verified here are load-bearing for downstream
consumers:

- `writeWarningNotification` (writer) → `applyTransition.ts`'s
  auto-create-from-alert path
- `writeCriticalNotification` (writer) → `submit_result → UNSAFE`
  transition handler
- `findMany` (router) → operator dropdown surface
- `findManyAdmin` (router) → admin audit lens
- `PATCH /:id/acknowledge` (router) → operator / technician
  acknowledge flow (idempotent on network-blip retry)
- `findUnique + updateMany` (repository) → compare-and-set ack
- `notificationRowToPayload` (row → payload) → operator wire shape
- `adminNotificationRowToPayload` (row → payload) → admin wire
  shape
- `mountNotificationRouter` (wiring) → api boot path
