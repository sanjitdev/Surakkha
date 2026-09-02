# Critique — `packages/api/src/incidents/transitions.{ts,transitionSideEffects.ts}` (state-machine core)

**Date:** 2026-09-02
**Surface:** `packages/api/src/incidents/transitions.ts` (418 LOC) +
`packages/api/src/incidents/transitionSideEffects.ts` (133 LOC)
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/incidents/
├── transitions.ts                  418 LOC   — pure state-machine + projectNextIncident
└── transitionSideEffects.ts        133 LOC   — ownership check + socket emit + invalid-attempt event
```

The transitions surface is the load-bearing incident state machine for
Epic 4.2 (criteria-state-machine core) plus 4.11 (reopen path) plus
5.6 (audit trail on invalid attempts). The state machine is pure —
`transition(input): TransitionResult` returns either `{ ok: true,
next_state, ... }` or `{ ok: false, code: "invalid_state_transition",
from, attempted, at }`. The side-effects module owns the RBAC ownership
check, the post-commit `incident:state_changed` socket emit, and the
`invalid_transition_attempt` audit row + structured log line.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                            |
| --- | ---------------- | ----- | --------------------------------------------------------------- |
| 1   | Visibility       | 3     | Status log + structured audit + observability hooks intact      |
| 2   | Match real world | 4     | Domain language perfect ("transition", "from", "attempted")     |
| 3   | User control     | 2     | Operator / admin has the right transitions; UI gate is layer up |
| 4   | Consistency      | 2     | Mixed rationale styles; Story codes in headers; AC markers      |
| 5   | Error prevention | 4     | Invalid transition typed result; concurrent-mod envelope; etc   |
| 6   | Recognition      | 2     | "Patch (code review 2026-08-27 #16)", "Story 4.11" RESTATE      |
| 7   | Flexibility      | 3     | Static table is one-key to extend; no `case` arms               |
| 8   | Minimalist       | 1     | Headers 5-10× larger than needed; long rationale blocks         |
| 9   | Recoverability   | 3     | Idempotent on first-ack vs re-ack; audit trail on every loss    |
| 10  | Help docs        | 1     | Most rationale is in code comments, NOT in a discoverable doc   |

**Weighted total: 23/40** (slightly higher because the state-machine
separation pure-state / side-effects is exemplary).

## AI-slop detection

### P1 (block merge)

- **P1-1: `transitions.ts` header is 55 lines** of pure rationale —
  restates everything that the type signatures already say. Trims to
  ~7 lines.
- **P1-2: `transitionSideEffects.ts` header is 17 lines** of pure
  rationale — restates the file extraction context ("extracted from
  `transitionHelpers.ts` so the orchestrator stays under the lint
  `max-lines` ceiling (500)").

### P2 (apply before merge)

#### Story codes in headers / inline rationale

- `transitions.ts`: header `Story 4.2`; inline
  `packages/shared/src/incident.ts:8`, `Story 4.11, deferred`,
  `Story 4.2 spec AC2`, `Story 4.11 — for reopen only`,
  `spec-4-2-incident-state-machine.md`, `AC9 time-bookkeeping`,
  `AC9 block`, `reopenPayloadSchema`, `ActionVerb lives next to the
RBAC matrix; IncidentEventType is the audit-log closed set`,
  `transitions.spec.ts walks every cell`, `Story 4.2's state
machine`.
- `transitionSideEffects.ts`: header `Story 4.2`; inline
  `transitionHelpers.ts max-lines: 500`, `Story 5.6 will swap
index.ts's console transport`, `Patch (code review 2026-08-27
#16)`.

These are noise — spec is canonical.

#### Cross-file line refs

- `transitions.ts:46-54`: `packages/shared/src/incident.ts:8` —
  REOPENED semantics doc-block ref.
- `transitions.ts:334-336`: `incidentStateRepository.ts:215-238` —
  production writer.
- `transitionSideEffects.ts:5`: `max-lines: 500` (lint ref, but
  not cross-file).

#### Long narrative rationale blocks (restate the obvious)

- `transitions.ts:65-74` (TRANSITIONS preamble): 9 lines — restates
  the AC2 spec pin.
- `transitions.ts:136-165` (transition function preamble): 30 lines
  restating each verb's pre-conditions.
- `transitions.ts:308-313` (actionToEventType): 5 lines restating
  "kept separate to prevent Story 4.2's state machine from leaking
  RBAC concerns".
- `transitions.ts:329-360` (projectNextIncident preamble): 31 lines
  restating time-bookkeeping semantics. **THIS IS THE BIGGEST** —
  bullet list of acknowledged_at / resolved_at / assignee_user_id
  rules that the function body restates 1:1.
- `transitions.ts:361-365` (ProjectNextIncidentInput preamble): 5
  lines restating "args-as-object keeps the function under the lint
  `max-params` ceiling".
- `transitions.ts:372-377` (test-only projectNextIncident preamble):
  5 lines restating "not called by the production route layer".
- `transitions.ts:412-417` (INCIDENT_STABLE_STATES re-export): 5
  lines restating "callers that don't want to reach into
  `@surakkha/shared` directly".
- `transitionSideEffects.ts:34-37` (runOwnershipCheck preamble): 4
  lines restating "Run the canonical `requireOwner` shape inline".

#### "Patch (code review...)" markers

- `transitionSideEffects.ts:106-110`: "Patch (code review 2026-08-27
  #16): emit a structured audit log alongside the IncidentEvent
  row." — 5 lines for "the audit emit happens before the row write."
  Git tracks this.

### Non-findings (verified, not raised)

- **The `TRANSITIONS: Readonly<Record<IncidentState, ...>>` table**
  is correct. Closed-lookup pattern: `Readonly<Partial<Record<...>>>`
  rejects missing keys at compile time. A new verb is a one-key
  insertion; a `switch` would require eight new `case` arms.
- **The REOPENED-as-alias semantics** (runtime normalizes to OPEN
  before reaching `transition()`) is correct. The empty object on
  `REOPENED` keeps the truth table 8-row.
- **The `applySubmitResult` / `applyAssign` / `applyTableTransition`
  helper split** is correct — keeps `transition()` under the lint
  complexity ceiling. Each helper encodes one verb.
- **The pre-conditions on `acknowledge` (only from OPEN) and
  `reopen` (only from RESOLVED)** are explicit INVALID returns
  BEFORE the static-table lookup. Correct.
- **The `submit_result` special case** (next state = `outcome`)
  is correctly handled outside the static table.
- **The `actionToEventType` switch** (`switch (action) { case "acknowledge": ... }`)
  is correctly exhaustive — TypeScript catches a missed verb when
  `ActionVerb` grows.
- **The `projectNextIncident` time-bookkeeping logic**
  (acknowledged_at stamped on first non-OPEN/reopened transition;
  resolved_at cleared on RESOLVED → OPEN; assignee_user_id only
  mutated on `assign`) is correct. This is the test-only mirror of
  the production writer.
- **The `runOwnershipCheck` denial path** emits a `rbac_denied`
  audit row before the 403 (operators can read the audit trail).
- **The `emitStateChanged` post-commit socket emit** on
  `incident:${incidentId}` is the canonical detail-page refresh
  surface.
- **The `writeInvalidAttemptEvent` audit emit BEFORE the row
  write** is correct — the structured log is the immediate
  observability hook; the row is the durable audit trail.
- **The `try/catch` around the `IncidentEvent` row write** in
  `writeInvalidAttemptEvent` is correct — the route has already
  decided to 409; a failed event write should not block the
  response.

### Out of scope

- **The live-Prisma test rig's coverage matrix** that uses
  `INCIDENT_STABLE_STATES` is downstream of this module. Out of
  scope.
- **The `transitionHelpers.ts` orchestrator** (mentioned in
  `transitionSideEffects.ts` header) was already partially refined
  in loop `7841fb3` (`transitionHelpers.ts:188` deleted). Out of
  scope for this loop.

## Plan

### Strip pass (both files)

1. **Drop the `Story 4.2` / `Story 4.11` / `Story 5.6` codes** from
   file headers.
2. **Drop inline AC refs** (`Story 4.2 spec AC2`, `AC9`, `AC9
time-bookkeeping`, `AC9 block`, `Story 4.2's state machine`,
   `Story 4.11's deferral`).
3. **Drop the cross-file line ref `packages/shared/src/incident.ts:8`** —
   replace with a file NAME-only ref if structural.
4. **Drop the "extracted from `transitionHelpers.ts`" rationale** in
   `transitionSideEffects.ts` header — git tracks the move.
5. **Drop the "Patch (code review 2026-08-27 #16)"** marker in
   `transitionSideEffects.ts:106-110` — current code IS the truth.
6. **Drop the "Story 4.11" reopen comments** in `transitions.ts` —
   keep "reopen" as a verb; the spec captures the 4.11 work.

### Trim pass (function-level rationale)

7. **`transitions.ts` header**: 55 lines → 7 lines.
8. **`transitions.ts:65-74` (TRANSITIONS preamble)**: 9 lines → 3 lines.
9. **`transitions.ts:98-134` (TransitionInput fields)**: 28 lines of
   per-field rationale → inline comments only (5 lines).
10. **`transitions.ts:136-165` (transition() preamble)**: 30 lines
    restating each verb's pre-condition → 6 lines.
11. **`transitions.ts:174-177` (helper-delegation comment)**: 4
    lines → drop entirely (the call site IS self-documenting).
12. **`transitions.ts:308-313` (actionToEventType preamble)**: 5
    lines → 2 lines.
13. **`transitions.ts:329-360` (projectNextIncident preamble)**: 31
    lines of bullet-list time-bookkeeping rules → drop entirely (the
    function body is the canonical truth; the test rig asserts on
    the projection).
14. **`transitions.ts:361-365` (ProjectNextIncidentInput args-as-
    object rationale)**: 5 lines → drop.
15. **`transitions.ts:372-377` (test-only projectNextIncident
    preamble)**: 5 lines → drop (the JSDoc on the function header
    already says it's test-only).
16. **`transitions.ts:412-417` (INCIDENT_STABLE_STATES re-export
    preamble)**: 5 lines → drop.
17. **`transitionSideEffects.ts` header**: 17 lines → 6 lines.
18. **`transitionSideEffects.ts:34-37` (runOwnershipCheck preamble)**:
    4 lines → 2 lines.

### Preserved (load-bearing)

- The `TRANSITIONS` static table + `REOPENED` empty-row alias.
- The `applySubmitResult` / `applyAssign` / `applyTableTransition`
  helper split (keeps `transition()` under complexity).
- The pre-conditions on `acknowledge` (OPEN only) and `reopen`
  (RESOLVED only).
- The `submit_result` special case (next_state = outcome).
- The `actionToEventType` switch (closed-enum exhaustiveness pin).
- The `projectNextIncident` time-bookkeeping logic (test-only
  mirror of the production writer).
- The `runOwnershipCheck` denial audit emit BEFORE the 403.
- The `emitStateChanged` post-commit `incident:state_changed`
  socket emit on `incident:${incidentId}`.
- The `writeInvalidAttemptEvent` audit emit BEFORE the row write +
  `try/catch` around the row write (route has already decided 409).

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/incidents/transitions.ts src/incidents/transitionSideEffects.ts
cd packages/api && npx vitest run src/incidents/transitions.spec.ts src/incidents/transitionSideEffects.spec.ts
```

Existing specs (must stay green):

- `transitions.spec.ts` — full `(state × action)` truth table + AC9
  time-bookkeeping block + INVALID-return pins.
- (No spec for `transitionSideEffects.ts` — covered by `router.spec.ts`
  end-to-end.)

The contract surfaces verified here are load-bearing for downstream
consumers:

- `transition(input)` → `transitionHelpers.ts` orchestrator → row
  write + audit event
- `TRANSITIONS` table → incident-detail-page state-machine UI
- `applySubmitResult` special case → `submit_result` handler
- `applyAssign` special case → `assign` handler
- `applyTableTransition` → `acknowledge` / `resolve` / `reopen`
  handlers
- `actionToEventType` → audit-log event-type closed set
- `projectNextIncident` → `transitions.spec.ts` AC9 mirror pin
- `INCIDENT_STABLE_STATES` re-export → live-Prisma test rig
- `runOwnershipCheck` → `submit_result` 403 path
- `emitStateChanged` → incident detail page refresh
- `writeInvalidAttemptEvent` → audit trail for typed state-machine
  misses + DB-layer concurrent-mod losses

## Out of scope (deferred to a future loop)

- **`packages/api/src/audit/`** — the audit log surface. Loop #203
  candidate.
- **`packages/api/src/boot/`** — boot wiring (ruleEngine, socketIO,
  readingDelegate, db, exits). Loop #204 candidate.
- **`packages/api/src/middleware/idempotency.ts`** — the
  `Idempotency-Key` middleware. Loop #205 candidate (the web side
  already refined, but the api middleware could use a header-trim).
