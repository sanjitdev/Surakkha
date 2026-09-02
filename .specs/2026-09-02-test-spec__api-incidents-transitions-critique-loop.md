# Test spec — `packages/api/src/incidents/{transitions.ts,transitionSideEffects.ts}` critique loop

**Date:** 2026-09-02
**Surface:** `packages/api/src/incidents/transitions.ts` (418 → 209 LOC) +
`packages/api/src/incidents/transitionSideEffects.ts` (133 → 90 LOC)
**Companion critique:** `.impeccable/critique/2026-09-02T27-00-00Z__packages-api-src-incidents-transitions.md` (23/40 weighted, 2 P1 + 22 P2)

This spec pins the load-bearing invariants of the incidents state-machine
core that survived the refactor pass. The header-trim + story-jargon /
"Patch (code review 2026-08-27 #16)" / cross-file line-ref / long-rationale
removal work does NOT change behaviour; this spec verifies that the
state-machine contracts (pure transition step, TRANSITIONS static table +
REOPENED alias, helper split, pre-conditions, time-bookkeeping projection,
ownership check, post-commit socket emit, invalid-attempt audit trail) still
hold.

## Behavioural pins (Given/When/Then)

### State machine core (transitions.ts)

- **B-SM-1**: Given `transition({ incident: { state: "OPEN" }, action: "acknowledge", actorUserId })`, when called, then it returns `{ ok: true, next_state: "ACKNOWLEDGED", event_type: "acknowledge", event_payload: { actorUserId }, at }` — the canonical OPEN → ACKNOWLEDGED cell.
- **B-SM-2**: Given `transition({ incident: { state: "ACKNOWLEDGED" }, action: "acknowledge", actorUserId })`, when called, then it returns `{ ok: false, code: "invalid_state_transition", from: "ACKNOWLEDGED", attempted: "acknowledge", at }` — pre-condition rejects non-OPEN acknowledge BEFORE the static-table lookup.
- **B-SM-3**: Given `transition({ incident: { state: "OPEN" }, action: "submit_result", outcome: "SAFE", actorUserId })`, when called, then it returns `{ ok: true, next_state: "SAFE", event_type: "submit_result", event_payload: { outcome: "SAFE", actorUserId }, at }` — the special-cased submit_result from INSPECTING... wait, OPEN is NOT INSPECTING. So:
- **B-SM-3**: Given `transition({ incident: { state: "INSPECTING" }, action: "submit_result", outcome: "SAFE", actorUserId })`, when called, then it returns `{ ok: true, next_state: "SAFE", event_type: "submit_result", event_payload: { outcome: "SAFE", actorUserId }, at }`.
- **B-SM-4**: Given `transition({ incident: { state: "SAFE" }, action: "submit_result", outcome: "SAFE", actorUserId })`, when called, then it returns `{ ok: false, code: "invalid_state_transition", from: "SAFE", attempted: "submit_result", at }` — `submit_result` requires INSPECTING.
- **B-SM-5**: Given `transition({ incident: { state: "INSPECTING" }, action: "submit_result", actorUserId })` (no `outcome`), when called, then it returns `{ ok: false, code: "invalid_state_transition", from: "INSPECTING", attempted: "submit_result", at }` — defense-in-depth against missing required body fields.
- **B-SM-6**: Given `transition({ incident: { state: "OPEN" }, action: "assign", assigneeUserId: "tech-1", actorUserId: "op-1" })`, when called, then it returns `{ ok: true, next_state: "INSPECTING", event_type: "assign", event_payload: { assigneeUserId: "tech-1", actorUserId: "op-1" }, at }` — the special-cased assign helper captures the assignee in the event payload.
- **B-SM-7**: Given `transition({ incident: { state: "OPEN" }, action: "assign", actorUserId })` (no `assigneeUserId`), when called, then it returns `{ ok: false, code: "invalid_state_transition", from: "OPEN", attempted: "assign", at }` — defense-in-depth against missing required body fields.
- **B-SM-8**: Given `transition({ incident: { state: "ACKNOWLEDGED" }, action: "assign", assigneeUserId: "tech-1", actorUserId })`, when called, then it returns `{ ok: true, next_state: "INSPECTING", ... }` — ACKNOWLEDGED → INSPECTING on `assign` is a valid cell.
- **B-SM-9**: Given `transition({ incident: { state: "SAFE" }, action: "resolve", actorUserId })`, when called, then it returns `{ ok: true, next_state: "RESOLVED", event_type: "resolve", event_payload: { actorUserId }, at }` — the SAFE → RESOLVED table cell.
- **B-SM-10**: Given `transition({ incident: { state: "RESOLVED" }, action: "reopen", actorUserId, reason: "Customer-reported regression" })`, when called, then it returns `{ ok: true, next_state: "OPEN", event_type: "reopen", event_payload: { actorUserId, reason: "Customer-reported regression" }, at }` — the reopen verb embeds the Admin-supplied reason.
- **B-SM-11**: Given `transition({ incident: { state: "OPEN" }, action: "reopen", actorUserId })`, when called, then it returns `{ ok: false, code: "invalid_state_transition", from: "OPEN", attempted: "reopen", at }` — `reopen` requires RESOLVED.
- **B-SM-12**: Given `transition({ incident: { state: "REOPENED" }, action: "acknowledge", actorUserId })`, when called, then it returns `{ ok: false, code: "invalid_state_transition", from: "REOPENED", attempted: "acknowledge", at }` — the empty REOPENED row treats every verb as INVALID (the runtime is expected to normalize REOPENED → OPEN before reaching here, but the function must still defend).
- **B-SM-13**: Given `transition({ incident: { state: "OPEN" }, action: "resolve", actorUserId })`, when called, then it returns `{ ok: false, code: "invalid_state_transition", from: "OPEN", attempted: "resolve", at }` — the static-table cell is missing.

### TRANSITIONS table (closed-lookup invariant)

- **B-TBL-1**: Given `TRANSITIONS`, when iterated, then every `IncidentState` (8 rows including `REOPENED`) is present as a key — `Readonly<Record<IncidentState, ...>>` enforces this at compile time.
- **B-TBL-2**: Given `TRANSITIONS["REOPENED"]`, when read, then it is `{}` (the alias pin — the truth table has 8 rows; no `case` arms needed).
- **B-TBL-3**: Given `TRANSITIONS["INSPECTING"]["submit_result"]`, when read, then it is `"UNSAFE"` — the sentinel value; `applySubmitResult` resolves the next state from the `outcome` argument instead of from the table.
- **B-TBL-4**: Given a `from`/`action` cell not in `TRANSITIONS`, when `transition()` is called with it, then it returns the typed INVALID result.

### actionToEventType (closed-enum exhaustiveness)

- **B-AE-1**: Given `actionToEventType("acknowledge")`, when called, then it returns `"acknowledge"`.
- **B-AE-2**: Given `actionToEventType("assign")`, when called, then it returns `"assign"`.
- **B-AE-3**: Given `actionToEventType("submit_result")`, when called, then it returns `"submit_result"`.
- **B-AE-4**: Given `actionToEventType("resolve")`, when called, then it returns `"resolve"`.
- **B-AE-5**: Given `actionToEventType("reopen")`, when called, then it returns `"reopen"`.
- **B-AE-6**: Given a future verb added to `ActionVerb`, when `actionToEventType` is compiled, then TypeScript catches the missing `case` at compile time (no `default` branch — exhaustiveness is the pin).

### projectNextIncident (test-only time-bookkeeping mirror)

- **B-PR-1**: Given `projectNextIncident({ current: { state: "OPEN", acknowledged_at: null, resolved_at: null, ... }, nextState: "ACKNOWLEDGED", at: "2026-09-02T00:00:00Z", assigneeUserId: null })`, when called, then `acknowledged_at` is `"2026-09-02T00:00:00Z"` (first transition out of OPEN stamps it).
- **B-PR-2**: Given `projectNextIncident({ current: { state: "ACKNOWLEDGED", acknowledged_at: "2026-09-01T00:00:00Z", ... }, nextState: "INSPECTING", at: "2026-09-02T00:00:00Z", assigneeUserId: "tech-1" })`, when called, then `acknowledged_at` is preserved at `"2026-09-01T00:00:00Z"` (already-stamped value persists).
- **B-PR-3**: Given `projectNextIncident({ current: { state: "SAFE", resolved_at: null, ... }, nextState: "RESOLVED", at: "2026-09-02T00:00:00Z", assigneeUserId: null })`, when called, then `resolved_at` is `"2026-09-02T00:00:00Z"` (only stamped on RESOLVED).
- **B-PR-4**: Given `projectNextIncident({ current: { state: "RESOLVED", resolved_at: "2026-09-01T00:00:00Z", ... }, nextState: "OPEN", at: "2026-09-02T00:00:00Z", assigneeUserId: null })`, when called, then `resolved_at` is `null` (RESOLVED → OPEN clears it).
- **B-PR-5**: Given `projectNextIncident({ current: { state: "OPEN", assignee_user_id: null, ... }, nextState: "INSPECTING", at, assigneeUserId: "tech-1" })`, when called, then `assignee_user_id` is `"tech-1"` (assign verb mutates the assignee).
- **B-PR-6**: Given `projectNextIncident({ current: { state: "OPEN", assignee_user_id: "tech-1", ... }, nextState: "ACKNOWLEDGED", at, assigneeUserId: null })`, when called, then `assignee_user_id` is preserved at `"tech-1"` (non-assign verb preserves the current value).

### INCIDENT_STABLE_STATES re-export

- **B-RE-1**: Given `import { INCIDENT_STABLE_STATES } from "./transitions.js"`, when the re-export is read, then it equals the value from `@surakkha/shared/incident` (single source of truth; the route + repo layers don't reach into shared directly).

### Side-effects: runOwnershipCheck (transitionSideEffects.ts)

- **B-OC-1**: Given `runOwnershipCheck({ ownerId: "tech-1", req: { user: { id: "tech-1", role: "Technician" } }, res, audit })`, when called, then it returns `false` (the actor IS the assignee — no denial).
- **B-OC-2**: Given `runOwnershipCheck({ ownerId: "tech-1", req: { user: { id: "tech-2", role: "Technician" } }, res, audit })`, when called, then it emits a structured `rbac_denied` audit row (BEFORE the 403), responds 403 with `{ error: "forbidden", required_role: "Technician" }`, and returns `true`.
- **B-OC-3**: Given `runOwnershipCheck({ ownerId, req: { user: undefined }, res, audit })`, when called, then it responds 401 with `{ error: "unauthorized" }` and returns `true` (no user attached → 401).

### Side-effects: emitStateChanged (transitionSideEffects.ts)

- **B-SC-1**: Given `emitStateChanged({ deps: { broadcast: { to: () => ({ emit: spy }) } }, incidentId: "inc-1", fromState: "OPEN", toState: "ACKNOWLEDGED", at: "2026-09-02T00:00:00Z", actorUserId: "op-1" })`, when called, then it calls `deps.broadcast.to("incident:inc-1")` and emits `"incident:state_changed"` with `{ incident_id, from_state, to_state, changed_at, actor_user_id }`.
- **B-SC-2**: Given `emitStateChanged({ deps: { broadcast: undefined }, ... })`, when called, then it returns without throwing (the optional broadcast is the seam that lets tests run without Socket.IO).

### Side-effects: writeInvalidAttemptEvent (transitionSideEffects.ts)

- **B-IA-1**: Given `writeInvalidAttemptEvent({ deps, incidentId, actorUserId, from: "RESOLVED", attempted: "acknowledge", at })`, when called, then it emits a structured `invalid_state_transition` audit log with `context: { incidentId, from, attempted, at }` BEFORE the row write (the audit log is the immediate observability hook; the row is the durable audit trail).
- **B-IA-2**: Given `writeInvalidAttemptEvent` and the row write fails (Prisma error), when the catch fires, then it logs the error to `console.error` and DOES NOT re-throw (the route has already decided to 409; a failed event write must not block the response).
- **B-IA-3**: Given `writeInvalidAttemptEvent` and the row write succeeds, when called, then it writes ONE `IncidentEvent` row with `type: "invalid_transition_attempt"` and `payload: { from, attempted, at }`.

## Static / lint pins (Property/Required value)

### File shape

- **P-FS-1**: `transitions.ts` file header MUST be ≤ 10 lines (was 55). Current: 9 lines.
- **P-FS-2**: `transitionSideEffects.ts` file header MUST be ≤ 10 lines (was 17). Current: 6 lines.
- **P-FS-3**: Neither file MUST contain any `Story 4.2` / `Story 4.11` / `Story 5.6` string.
- **P-FS-4**: Neither file MUST contain any `Patch (code review 2026-08-27 #N)` string.
- **P-FS-5**: Neither file MUST contain any cross-file line-number reference (`packages/shared/src/incident.ts:8`, `incidentStateRepository.ts:215-238`).
- **P-FS-6**: Neither file MUST contain any `AC2` / `AC9` / `AC9 block` / `AC9 time-bookkeeping` string.

### TRANSITIONS table

- **P-TBL-1**: `TRANSITIONS` MUST be typed `Readonly<Record<IncidentState, Readonly<Partial<Record<ActionVerb, IncidentState>>>>>` — a closed-lookup pattern (adding a new `ActionVerb` or `IncidentState` triggers a compile error if the table doesn't account for it).
- **P-TBL-2**: `TRANSITIONS["REOPENED"]` MUST equal `{}` — the alias pin.

### actionToEventType

- **P-AE-1**: `actionToEventType` MUST be a `switch` statement with NO `default` branch — TypeScript exhaustiveness is the pin.
- **P-AE-2**: `actionToEventType` MUST handle every member of `ActionVerb` (5 cases for v1).

### Helper split

- **P-HS-1**: `transition()` MUST delegate to one of `applySubmitResult` / `applyAssign` / `applyTableTransition` — the helper split keeps `transition()` under the lint complexity ceiling.
- **P-HS-2**: `applySubmitResult`, `applyAssign`, `applyTableTransition` MUST each encode the pre-conditions for ONE verb — the helper-per-verb split.

### Time-bookkeeping projection

- **P-PR-1**: `projectNextIncident` MUST be a pure function (no Prisma, no IO, no side effects) — same input always yields same output.
- **P-PR-2**: `projectNextIncident` MUST stamp `acknowledged_at` on the FIRST transition out of OPEN/REOPENED (not on subsequent transitions).
- **P-PR-3**: `projectNextIncident` MUST stamp `resolved_at` only when `next_state === "RESOLVED"`.
- **P-PR-4**: `projectNextIncident` MUST clear `resolved_at` on RESOLVED → OPEN (the reopen path).
- **P-PR-5**: `projectNextIncident` MUST mutate `assignee_user_id` only when `nextState === "INSPECTING"` AND `assigneeUserId !== null`.

### Side-effects audit ordering

- **P-SO-1**: `runOwnershipCheck` MUST emit the `rbac_denied` audit row BEFORE the 403 response (operators can read the audit trail).
- **P-SO-2**: `writeInvalidAttemptEvent` MUST emit the structured `invalid_state_transition` audit log BEFORE the `IncidentEvent` row write.
- **P-SO-3**: `writeInvalidAttemptEvent` MUST wrap the row write in a `try/catch` — a failed write does NOT re-throw (the route has decided to 409).

### Lint

- **P-LINT-1**: `npx eslint packages/api/src/incidents/transitions.ts packages/api/src/incidents/transitionSideEffects.ts` MUST exit 0.
- **P-LINT-2**: `npx tsc -b packages/api` MUST exit 0.

## Negative pins (Behaviour / Must NOT happen)

- **N-1**: `transition()` MUST NOT touch Prisma, the socket layer, or the audit log — the function is pure (test coverage matrix walks every cell without a Prisma client).
- **N-2**: `transition()` MUST NOT do RBAC enforcement — RBAC lives at the route layer via `authorize({ action, resource }, audit)` BEFORE `transition()` runs.
- **N-3**: `TRANSITIONS` MUST NOT use a `switch` statement — the static table is the canonical pin per the spec; a `switch` would require eight new `case` arms per verb.
- **N-4**: `applyTableTransition` MUST NOT silently accept `acknowledge` from `REOPENED` — the runtime normalizes REOPENED → OPEN before reaching here, but the function still pre-conditions on `from !== "OPEN"` to defend.
- **N-5**: `projectNextIncident` MUST NOT mutate the input `current` object — the function returns a fresh `IncidentPayload` (test rig asserts identity separation).
- **N-6**: `emitStateChanged` MUST NOT throw when `deps.broadcast === undefined` — the optional broadcast is the seam that lets tests run without Socket.IO.
- **N-7**: `writeInvalidAttemptEvent` MUST NOT be called inside the route's `$transaction` — a failed event write must not roll back the row write (the audit is outside the DB transaction).

## Verification commands

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/incidents/transitions.ts packages/api/src/incidents/transitionSideEffects.ts
npx --prefix packages/api vitest run packages/api/src/incidents/transitions.spec.ts
```

The existing `transitions.spec.ts` walks the full `(state × action)`
truth table (29 cases) and pins AC9 time-bookkeeping — it is the
load-bearing coverage matrix for `transition()` and
`projectNextIncident()`. The 4 mutation hooks on the api side
(acknowledge / assign / submit_result / reopen handlers in
`transitionHelpers.ts`) are downstream of these modules and out of
scope for this critique loop.

## Out of scope (deferred to a future loop)

- `packages/api/src/audit/` — the audit log surface.
- `packages/api/src/boot/` — boot wiring (ruleEngine, socketIO,
  readingDelegate, db, exits).
- `packages/api/src/middleware/idempotency.ts` — the
  `Idempotency-Key` middleware.
