# Critique — `packages/api/src/notifications/` (writer + read/admin router)

**Date:** 2026-09-02
**Surface:** `packages/api/src/notifications/` (6 source files, ~830 LOC)
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/notifications/
├── notificationRouter.ts        424 LOC  — recipient-role-targeted POST + GET
├── notificationWriter.ts        157 LOC  — ORCHESTRATING write + SSE dispatch
├── notificationRepository.ts    114 LOC  — narrow Prisma slice
├── routerWiring.ts               68 LOC  — Express wiring + RBAC
├── notificationRowToPayload.ts   57 LOC  — DB row → wire-payload mapper
└── index.ts                      11 LOC  — barrel export
```

The notifications/ directory is the read surface for
operator-targeted + admin-audit notifications, plus the write
orchestrator for the `notification:critical` / `notification:warning`
side of the SSE pipeline.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                          |
| --- | ---------------- | ----- | ------------------------------------------------------------- |
| 1   | Visibility       | 3     | Status log lines + ack observability log + admin shape check  |
| 2   | Match real world | 3     | Domain matches ops ("acknowledged", "recipient", "lens")      |
| 3   | User control     | 2     | Admin severity chips + since/until range bounds               |
| 4   | Consistency      | 2     | Mixed rationale styles; cross-file line refs in headers       |
| 5   | Error prevention | 3     | P2002 catch + cross-role RBAC + Zod range check + shape check |
| 6   | Recognition      | 2     | Inline cross-file line refs RESTATE rather than structure     |
| 7   | Flexibility      | 2     | Admin filter chip multi-select, admin severity list           |
| 8   | Minimalist       | 1     | Headers 2-4× larger than needed; rationale blocks duplicate   |
| 9   | Recoverability   | 3     | Idempotent PATCH + P2002 race + `wasInserted` flag            |
| 10  | Help docs        | 1     | Most rationale is in code comments, NOT in a discoverable doc |

**Weighted total: 22/40** (same band as ingest/, shared/, api/,
rules/.)

## AI-slop detection

### P1 (block merge)

- **P1-1: `notificationWriter.ts` header is 13 lines** of pure
  rationale — restates the writer's two named helpers + the
  cross-package consumers line-by-line. Trims to "Idempotent writer
  for the Notification table — partial unique index `(incidentId,
severity) WHERE acknowledgedAt IS NULL` + P2002 catch returns the
  existing row so a double-click emits a single row. Two named
  helpers pin `recipientRole: Operator` per severity." (~7 lines)

- **P1-2: `notificationRouter.ts` header is 11 lines** of pure
  rationale — restates each of three routes and the
  idempotent-on-already-acknowledged PATCH contract. Trims to
  "~7 lines."

- **P1-3: `notificationRepository.ts` header is 15 lines** of pure
  rationale — restates each interface method + the "why a narrow
  slice" bullet list. Trims to "~7 lines."

- **P1-4: `notificationRowToPayload.ts` header is 9 lines** of pure
  rationale — restates the project pattern, the admin sibling, and
  the `acknowledgedByUserId` audit detail. Trims to "~5 lines."

- **P1-5: `routerWiring.ts` header is 7 lines** of pure rationale —
  restates the lazy-resolve pattern + the no-DATABASE_URL-at-boot
  contract. Trims to "~5 lines."

- **P1-6: `index.ts` header is 5 lines** of pure rationale —
  restates the barrel contents. Trims to "~3 lines."

### P2 (apply before merge)

#### Cross-file line refs

- `notificationWriter.ts:10-12`: `applyTransition.ts`'s auto-create-
  from-alert path + the `submit_result → UNSAFE` transition handler
  (consumers).
- `notificationWriter.ts:155-157`: re-export of `PrismaAlertReader`
  mentions `applyTransition.ts`.
- `notificationRouter.ts:152-154`: `src/index.ts:N-M` style refs to
  the FK setup.
- `notificationRowToPayload.ts:2-9`: `incidentRowToPayload` pattern
  reference.
- `routerWiring.ts:1-7`: `buildNotificationRouter` and
  `resolveNotificationRepository` references.
- `index.ts:2-5`: reference to `applyTransition.ts`'s
  auto-create-from-alert path.

These break on every refactor — drop or replace with file NAME-only
references where structural.

#### Long narrative rationale blocks (restate the obvious)

- `notificationWriter.ts:65-72` (writeNotification preamble): 8
  lines restating "Write a Notification row idempotently. On a P2002
  collision..."
- `notificationWriter.ts:131-132`: "The `notification:critical`
  write site. Used in the `submit_result → UNSAFE` transition
  handler."
- `notificationWriter.ts:143-144`: "The `notification:warning`
  write site. Used in the `applyOpenTransition` path."
- `notificationWriter.ts:155-157`: re-export rationale for
  `PrismaAlertReader`.
- `notificationRepository.ts:27-30`: 4-line "Production forwards to
  `tx.notification.create` / `tx.notification.findFirst`; tests
  inject a stub" preamble on the narrow Prisma slice.
- `notificationRepository.ts:34-40`: 7-line `AdminNotificationFilters`
  preamble.
- `notificationRowToPayload.ts:35-39`: 5-line admin adapter preamble
  referencing `AdminNotificationPayloadSchema`.
- `notificationRouter.ts:55-56`: 2-line "Helpers below are extracted
  to keep the PATCH / GET closures under the `complexity: 10` ESLint
  ceiling" — restates the extractor's purpose.
- `notificationRouter.ts:174-179`: "first=true distinguishes
  first-ack from idempotent re-ack" — restates the log line.

These restate the obvious — current code IS the truth; git log IS
the history.

#### Inline rationale blocks that exceed the trim target

- `notificationRouter.ts:166-181` (renderAckResponse helper): 5-line
  JSDoc + 4-line inline comment narrating "first=true distinguishes
  first-ack from idempotent re-ack (the dashboard's retry-on-network-
  blip behaviour)." Drop the narrative block; keep the load-bearing
  `first=true` log line.
- `notificationRouter.ts:332-334`: "`authorize()` middleware
  guarantees `req.user` is non-null for any handler that runs past
  it." — restates the middleware contract.
- `notificationRouter.ts:374-376`: "`authorize()` short-circuits
  unauthenticated requests with 401 before this handler runs." —
  restates the same middleware contract.
- `notificationRepository.ts:108-110`: re-export rationale for the
  wire-row helper.

### Non-findings (verified, not raised)

- **The `PRISMA_P2002 = "P2002"` constant + `isPrismaP2002` type
  guard** are correct — minimal `code` check; resilient to Prisma
  version drift.
- **The `NotificationWriterRepository` / `NotificationRepository` slice
  pattern** mirrors `incidentStateRepository.ts` — narrow Prisma
  interface + `resolveX(prisma)` adapter. Tests inject stubs;
  production narrows via `as any` cast contained to the adapter file.
- **The `findManyAdmin` lazy-throw** in `resolveNotificationRepository`
  is correct — fails loud if a future Prisma regen drops the extension.
- **The PATCH idempotent ack flow** (compare-and-set
  `updateMany({ where: { id, acknowledgedAt: null } })` returning
  `count: 0` → re-fetch + 200 with existing values) is the canonical
  pattern.
- **The `parseAdminQueryParams` since/until range check** (400 with
  `invalid_range` when `since >= until`) is correct — surfaces
  silently-empty-result bugs at the page layer.
- **The cross-role RBAC** (`enforceCrossRoleRecipient` returns 403
  with `required_role: row.recipientRole` when actor's role doesn't
  match row's `recipientRole`) is correctly placed inside the PATCH
  handler. The audit emit fires before the 403.
- **The `wasInserted` flag** in `WriteNotificationOutput` is correct
  — distinguishes the new-row path from the idempotent-return path
  for the test rig to assert on.
- **The "race: the active row was acknowledged between the failed
  insert and the refetch" fallback** in `writeNotification` (re-insert
  to mint a fresh active row) is correct — the partial unique index
  gate just opened.
- **The `VALID_RECIPIENT_ROLES` runtime check** in the GET handler
  (defense against a future role slipping past the matrix surface) is
  correct.

### Out of scope

- **The PATCH handler's idempotent re-ack log message**
  (`first=${updateCount === 1 ? "true" : "false"}`) is observability
  noise but is the right shape for the dashboard's retry-on-network-
  blip behaviour to surface in the boot log pipeline. Out of scope.
- **The admin `Severity` chip multi-select** is a router concern
  (`parseAdminQueryParams` / `coerceSeverityArray`); the seam is
  correct. No refactor.

## Plan

### Strip pass (all 6 files)

1. **Drop cross-file line refs**: keep references to file NAMES where
   the dep is structural (e.g. "consumed by applyTransition.ts") but
   drop `:N-M` style refs (e.g. `applyTransition.ts:154-164`).
2. **Drop the "Why a narrow slice" / "Why a separate module" /
   "Why a dedicated module" bullet lists** — restate the convention.
3. **Drop "Loop N fix" / "Loop N hardening" / "review finding H2/E10"
   markers** — current code IS the truth; git log IS the history.
4. **Drop the "pre-Loop 1" / "pre-patch code" prose** — current code
   is the truth.

### Trim pass (file headers + function-level rationales)

5. **`notificationWriter.ts` header**: 13 lines → 7 lines.
6. **`notificationWriter.ts` writeNotification preamble**: 8 lines →
   3 lines.
7. **`notificationWriter.ts` two named-wrapper preambles**: 4 lines
   → 2 lines total.
8. **`notificationWriter.ts` PrismaAlertReader re-export rationale**:
   3 lines → 1 line.
9. **`notificationRouter.ts` header**: 11 lines → 7 lines.
10. **`notificationRouter.ts` helper-extraction preamble**: 2 lines →
    1 line (or drop).
11. **`notificationRouter.ts` authorize() restate-notes (×2)**: drop
    both — the middleware contract is the middleware's job.
12. **`notificationRepository.ts` header**: 15 lines → 7 lines.
13. **`notificationRepository.ts` NotificationWriterRepository
    preamble**: 4 lines → 1 line.
14. **`notificationRepository.ts` AdminNotificationFilters preamble**:
    7 lines → 3 lines.
15. **`notificationRowToPayload.ts` header**: 9 lines → 5 lines.
16. **`notificationRowToPayload.ts` admin adapter preamble**: 5
    lines → 2 lines.
17. **`routerWiring.ts` header**: 7 lines → 5 lines.
18. **`index.ts` header**: 5 lines → 3 lines.

### Preserved (load-bearing)

- The P2002 race-catch path in `writeNotification` (re-insert after
  acknowledged-between-failed-insert-and-refetch fallback).
- `recipientRole: "Operator"` pin in the two named wrappers.
- `NOTIFICATION_TAKE_LIMIT = 50` + `ADMIN_NOTIFICATION_TAKE_LIMIT =
100`.
- `VALID_RECIPIENT_ROLES` runtime check.
- The `idempotent_double_click` test rig envelope — `wasInserted`
  flag distinguishes new-row vs refetch-returned.
- The cross-role RBAC + audit emit ordering.
- The `findManyAdmin` lazy throw in `resolveNotificationRepository`.
- The `parseAdminQueryParams` since/until range check (400 with
  `invalid_range` on `since >= until`).
- The compare-and-set `updateMany({ where: { acknowledgedAt: null }})`
  first-ack vs idempotent re-ack partition.
- The `first=true` log line in `renderAckResponse` (keep the log
  itself; drop the narrative block).

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/notifications
cd packages/api && npx vitest run src/notifications 2>&1 | tail -15
node scripts/lint-prose.mjs
```

All must pass.

## Out of scope (deferred to a future loop)

- **`packages/api/src/incidents/transitions.ts`** — the criteria-state-
  machine core. Loop #202 candidate.
- **`packages/api/src/incidents/transitionSideEffects.ts`** — audit +
  socket emit side effects. Loop #202 candidate.
- **`packages/api/src/audit/`** — the audit log surface. Loop #203
  candidate.
- **`packages/api/src/boot/`** — boot wiring (ruleEngine, socketIO,
  readingDelegate, db, exits). Loop #204 candidate.
