# Critique — `packages/api/src/notifications/` (writer + read/admin router)

**Date:** 2026-09-02
**Surface:** `packages/api/src/notifications/` (6 source files, ~1,400 LOC)
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/notifications/
├── notificationWriter.ts      206 LOC   — pure idempotent writer + P2002 catch
├── notificationRepository.ts  220 LOC   — narrow Prisma slice + resolveX adapter
├── notificationRowToPayload.ts 97 LOC   — row → wire adapter (operator + admin)
├── notificationRouter.ts      426 LOC   — GET + PATCH + GET admin/list
├── routerWiring.ts             85 LOC   — lazy repo resolution wrapper
├── index.ts                    17 LOC   — barrel for 4.10 read surface
```

The notifications/ directory is the Epic 4.9 (writer) + 4.10
(operator-facing read + idempotent PATCH ack) + 5.1 (admin audit
lens) read surface. The writer is reused by both
`rules/applyTransition.ts` (auto-create-from-alert path) and the
`submit_result → UNSAFE` transition handler.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                           |
| --- | ---------------- | ----- | -------------------------------------------------------------- |
| 1   | Visibility       | 3     | Status log lines + ack observability log + admin shape check   |
| 2   | Match real world | 3     | Domain matches ops ("acknowledged", "recipient", "lens")       |
| 3   | User control     | 2     | Admin severity chips + since/until range bounds                |
| 4   | Consistency      | 2     | Mixed rationale styles; Loop 1 fix markers; Story/AC noise     |
| 5   | Error prevention | 3     | P2002 catch + cross-role RBAC + Zod range check + shape check  |
| 6   | Recognition      | 2     | Inline "Loop 1 hardening", "Loop 1 fix", patch markers RESTATE |
| 7   | Flexibility      | 2     | Admin filter chip multi-select, admin severity list            |
| 8   | Minimalist       | 1     | Headers 2-4× larger than needed; rationale blocks duplicate    |
| 9   | Recoverability   | 3     | Idempotent PATCH + P2002 race + `wasInserted` flag             |
| 10  | Help docs        | 1     | Most rationale is in code comments, NOT in a discoverable doc  |

**Weighted total: 22/40** (same band as ingest/, shared/, api/, rules/.)

## AI-slop detection

### P1 (block merge)

- **P1-1: `notificationWriter.ts` header is 35 lines** of pure
  rationale — restates what the helper does line-by-line. Trims to
  "Idempotent writer for the Notification table — partial unique
  index `(incidentId, severity) WHERE acknowledgedAt IS NULL` +
  P2002 catch returns the existing row so a double-click emits a
  single row. Two named helpers (`writeWarningNotification` /
  `writeCriticalNotification`) pin `recipientRole: Operator` per
  severity." (~7 lines)

- **P1-2: `notificationRepository.ts` header is 41 lines** of pure
  rationale — restates each interface method + the "why a narrow
  slice" bullet list. Trims to "~7 lines."

- **P1-3: `notificationRowToPayload.ts` header is 33 lines** of pure
  rationale — restates the project pattern, the admin sibling, and
  the `acknowledgedByUserId` audit detail. Trims to "~7 lines."

### P2 (apply before merge)

#### Story codes in headers / inline rationale

- `notificationWriter.ts`: header `Story 4.9`; inline
  `applyTransition.ts:154-164`, `incidentStateRepository.ts:264-281`,
  `rules/applyTransition.ts:131-141`, `alerts/acknowledgeRouter.ts`,
  `Story 3.4 auto-create-from-alert path`, `Story 3.5 linked-alerts
collapse`, `AC`, `idempotent_double_click AC`.
- `notificationRepository.ts`: header `Story 4.10`; inline
  `incidentStateRepository.ts:77-166`, `Story 5.1`, `Story 5.1
schema`, `Story 4.10 schema`, `Loop 1 fix`, `notificationRouter.ts:parseAdminQueryParams`,
  `Story 4.10 — read path`, `Story 4.10 — compare-and-set update`,
  `Story 5.1 — admin-list read path`, `Story 5.1 — filter shape`,
  `Loop 1 hardening (review finding H2/E10)`,
  `resolveIncidentStateRepository at
packages/api/src/incidents/incidentStateRepository.ts:172-191`.
- `notificationRowToPayload.ts`: header `Story 4.10 + Story 5.1`;
  inline `incidentRowToPayload at
packages/api/src/incidents/incidentStateRepository.ts:341-365`,
  `4.4 incident detail page`, `incidentEventRowToPayload`,
  `Story 5.1 — the admin-facing wire-row adapter`,
  `AdminNotificationPayloadSchema`, `PR review checklist's "sibling
adapters in the same module" convention`.
- `notificationRouter.ts`: header mentions "the dashboard's retry-on-
  network-blip behaviour"; inline `Story 4.10's mount block`,
  `Story 4.10's spec AC`, `Parse Admin List routing upgrade v N (loop
hardening)`, "Loop 1" references, "chip toggle off", "no
  pagination in v1 — see spec", cross-file refs.
- `routerWiring.ts`: header `Story 4.10`; inline
  `buildIncidentsRouterMount pattern at
packages/api/src/incidents/routerWiring.ts:132-165`,
  `db/prisma.ts`, `max-lines: 500`, `Story 4.10's mount block pushed
that file past`.
- `index.ts`: header `Story 4.10`; inline `4.9 lives in the same
directory`, `4.10 read surface`, `incidentStateRepository.ts
import`.

These are noise — spec is canonical.

#### Cross-file line refs

- `notificationWriter.ts:17-18`: `applyTransition.ts:154-164`,
  `incidentStateRepository.ts:264-281`.
- `notificationWriter.ts:28-30`: `rules/applyTransition.ts:131-141`,
  `alerts/acknowledgeRouter.ts`.
- `notificationWriter.ts:43-44`: `rules/applyTransition.ts:131-141`.
- `notificationRepository.ts:5-7`:
  `incidentStateRepository.ts:77-166`.
- `notificationRepository.ts:135`: `notificationRouter.ts:parseAdminQueryParams`.
- `notificationRepository.ts:174`:
  `resolveIncidentStateRepository at
packages/api/src/incidents/incidentStateRepository.ts:172-191`.
- `notificationRowToPayload.ts:5-9`:
  `incidentStateRepository.ts:341-365`.
- `routerWiring.ts:5-7`: `packages/api/src/incidents/routerWiring.ts:132-165`.
- `routerWiring.ts:34-38`: `buildIncidentsRouterMount at
packages/api/src/incidents/routerWiring.ts:132` + `db/prisma.ts`.

These break on every refactor — drop or replace with file NAME-only
references where structural.

#### Long narrative rationale blocks (restate the obvious)

- `notificationWriter.ts:96-105` (writeNotification preamble): 10
  lines restating "Write a Notification row idempotently. On a P2002
  collision..."
- `notificationWriter.ts:39-46` (PRISMA_P2002 + isPrismaP2002 rationale):
  7 lines restating "this is a type guard mirroring `rules/...`."
- `notificationWriter.ts:169-200`: 30 lines of two named-wrapper
  preambles.
- `notificationRepository.ts:96-103` (4-method interface preamble):
  7 lines.
- `notificationRepository.ts:178-189` (Loop 1 hardening): 12 lines
  restating "if a future Prisma regeneration drops the extension,
  we MUST fail loud."
- `notificationRowToPayload.ts:64-78` (admin adapter preamble): 14
  lines.
- `notificationRowToPayload.ts:14-32` (Why a separate module): 18
  lines restating the "row-to-payload" convention.
- `routerWiring.ts:11-17`: 7 lines "Lives outside `index.ts` because
  Story 4.10's mount block pushed that file past..." — git tracks
  the move.
- `notificationRouter.ts:1-11`: 11 lines restating "three routes on
  /api/notifications".

#### "Loop N hardening" / "Loop N fix" markers

- `notificationRepository.ts:77-82`: "Loop 1 fix: the wire carries the
  multi-select as repeated `?severity` query params..." — restates
  what the `coerceSeverityArray` helper does in the file.
- `notificationRepository.ts:178-189`: "Loop 1 hardening (review
  finding H2/E10): `findManyAdmin` is a NEW extension method..." —
  12 lines restating "fail loud if missing."
- `notificationRouter.ts:191-195`: "De-duplicate + drop empties; a
  chip toggle off means 'all severities'..."

#### Pre-patch / pre-Loop code references

- `notificationRepository.ts:79-82`: "Passing `severity: singleValue`
  (the pre-Loop 1 shape) silently dropped the filter when 2-3 chips
  were active." — git tracks the change.

#### "[Review][Patch] F-A8" / `Patch (code review...)` markers

None found in this surface.

### Non-findings (verified, not raised)

- **The `PRISMA_P2002 = "P2002"` constant + `isPrismaP2002` type
  guard** are correct — minimal `code` check; resilient to Prisma
  version drift.
- **The `NotificationWriterRepository` / `NotificationRepository` slice
  pattern** mirrors `incidentStateRepository.ts` — narrow Prisma
  interface + `resolveX(prisma)` adapter. Tests inject stubs;
  production narrows via `as any` cast contained to the adapter file.
- **The `findManyAdmin` lazy-throw** in `resolveNotificationRepository`
  is correct — falls loud if a future Prisma regen drops the extension.
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
- **The "Pre-Loop 1 severity: singleValue shape silently dropped"
  reference** is git's job. Drop it as AI-slop (it restates the
  current code).

## Plan

### Strip pass (all 6 files)

1. **Drop every "Story X.Y" reference** from headers and inline
   rationale.
2. **Drop every AC / FR / ADR / AR / Loop 1 / "review finding"**
   code. Where the prose encodes a load-bearing rule (e.g. "the
   PATCH is idempotent on already-acknowledged rows"), keep the rule
   without the §ref.
3. **Drop cross-file line refs**: `applyTransition.ts:154-164`,
   `incidentStateRepository.ts:264-281`,
   `rules/applyTransition.ts:131-141`,
   `alerts/acknowledgeRouter.ts`,
   `incidentStateRepository.ts:77-166`,
   `notificationRouter.ts:parseAdminQueryParams`,
   `resolveIncidentStateRepository at
packages/api/src/incidents/incidentStateRepository.ts:172-191`,
   `incidentStateRepository.ts:341-365`, `4.4 incident detail page`,
   `incidentEventRowToPayload`, `db/prisma.ts`,
   `packages/api/src/incidents/routerWiring.ts:132-165`,
   `buildIncidentsRouterMount at
packages/api/src/incidents/routerWiring.ts:132`.
   Keep references to file NAMES where the dep is structural.
4. **Drop the "Why a narrow slice" / "Why a separate module" /
   "Why a dedicated module" bullet lists** — restate the convention.
5. **Drop "Loop N fix" / "Loop N hardening" / "review finding H2/E10"
   markers** — current code IS the truth; git log IS the history.
6. **Drop the "pre-Loop 1" / "pre-patch code" prose** — current code
   is the truth.

### Trim pass (file headers + function-level rationales)

7. **`notificationWriter.ts` header**: 35 lines → 7 lines.
8. **`notificationWriter.ts` PRISMA_P2002 + isPrismaP2002 rationale**:
   7 lines → 1 line.
9. **`notificationWriter.ts:96-105` writeNotification preamble**: 10
   lines → 4 lines. Drop the "open-coded (not imported from
   `@prisma/client`)" prose.
10. **`notificationWriter.ts:169-200` two named-wrapper preambles**:
    30 lines → 4 lines.
11. **`notificationRepository.ts` header**: 41 lines → 7 lines.
12. **`notificationRepository.ts:64-93` AdminNotificationFilters
    preamble**: 30 lines → 6 lines.
13. **`notificationRepository.ts:96-103` narrow slice preamble**: 7
    lines → 1 line.
14. **`notificationRepository.ts:178-189` "Loop 1 hardening"**:
    12 lines → 4 lines.
15. **`notificationRowToPayload.ts` header**: 33 lines → 7 lines.
16. **`notificationRowToPayload.ts:63-78` admin adapter preamble**: 14
    lines → 3 lines.
17. **`routerWiring.ts` header**: 17 lines → 6 lines.
18. **`index.ts` header**: 9 lines → 4 lines.

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

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/notifications
cd packages/api && npx vitest run src/notifications
```

Existing specs (must stay green):

- `notificationWriter.spec.ts` — P2002 catch + double-click idempotency
- `notificationRepository.spec.ts` — slice adapter + lazy throw
- `notificationRowToPayload.spec.ts` — wire shape (operator + admin)
- `notificationRouter.spec.ts` — GET + PATCH + GET admin/list full
  coverage

## Out of scope (deferred to a future loop)

- **`packages/api/src/incidents/transitions.ts`** — the criteria-state-
  machine core. Loop #202 candidate.
- **`packages/api/src/incidents/transitionSideEffects.ts`** — audit +
  socket emit side effects. Loop #202 candidate.
- **`packages/api/src/audit/`** — the audit log surface. Loop #203
  candidate.
- **`packages/api/src/boot/`** — boot wiring (ruleEngine, socketIO,
  readingDelegate, db, exits). Loop #204 candidate.
