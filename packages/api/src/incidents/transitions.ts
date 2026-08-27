/**
 * Incident state machine — Story 4.2.
 *
 * The pure function `transition(incident, action)` decides the
 * `next_state` for every valid (state, action) pair. **This module
 * does not touch the database, the socket layer, or the audit log**;
 * those are the caller's concern. Keeping the state machine pure
 * means:
 *
 *   - The full `(state × action)` truth table is unit-tested
 *     without a Prisma client (see `transitions.spec.ts`).
 *   - The state machine is deterministic: same inputs always
 *     yield the same output. Tests can pin every cell.
 *   - RBAC is enforced BEFORE this function runs (at the route
 *     via `authorize({ action, resource }, audit)`). The function
 *     itself is role-blind.
 *
 * Locked contract (spec-4-2-incident-state-machine.md):
 *
 *   - `TRANSITIONS` is a `Readonly<Record<IncidentState,
 *     Readonly<Partial<Record<ActionVerb, IncidentState>>>>>`. Every
 *     valid cell is a `(state, action)` key; the value is the
 *     resulting `next_state`. Cells NOT in the table are invalid
 *     transitions.
 *
 *   - INVALID cells return `{ ok: false, code: "invalid_state_
 *     transition", from, attempted, at }`. The route layer maps
 *     this to HTTP 409 + writes an `IncidentEvent` with
 *     `type: "invalid_transition_attempt"` for the audit trail.
 *
 *   - Special-cased decisions (`submit_result` from INSPECTING
 *     to SAFE | UNSAFE | MONITORING) are NOT expressible in the
 *     static `TRANSITIONS` table — the next state depends on the
 *     technician's submitted outcome. The helper takes the
 *     outcome as the third positional argument and resolves it
 *     against the static table.
 *
 * Why a static table (not a hand-written `switch`):
 *
 *   - The Story 4.2 spec AC2 pins the table as a literal object —
 *     it's a code-walk audit target (`transitions.spec.ts` walks
 *     every cell).
 *   - Adding a new verb is a one-key insertion; a `switch` requires
 *     eight new `case` arms (one per state).
 *
 * REOPENED semantics (per `packages/shared/src/incident.ts:8`):
 *
 *   `REOPENED` is a TRANSITION ALIAS, NOT a stored state. The
 *   reopen path (Story 4.11, deferred) writes `state: "OPEN"`,
 *   not `state: "REOPENED"`. The `REOPENED` entry in
 *   `TRANSITIONS` is kept empty so the truth table has 8 rows;
 *   runtime callers that arrive at `REOPENED` (none should —
 *   the reopen writer normalizes to OPEN before calling) are
 *   treated as INVALID for every verb.
 */
import {
  type ActionVerb,
  INCIDENT_STABLE_STATES,
  type IncidentEventType,
  type IncidentPayload,
  type IncidentState,
  type InspectionOutcome,
  type TransitionResult,
} from "@surakkha/shared/incident";

/**
 * The 7-action truth table.
 *
 * Adding a new (state, action) cell? Add the row + the unit-test
 * cell. There is no `default` branch — the `transition()` function
 * returns INVALID for any (state, action) cell NOT in this table,
 * and TypeScript's `noUncheckedIndexedAccess` will yell at compile
 * time if you forget.
 */
export const TRANSITIONS: Readonly<
  Record<IncidentState, Readonly<Partial<Record<ActionVerb, IncidentState>>>>
> = {
  OPEN: {
    acknowledge: "ACKNOWLEDGED",
    assign: "INSPECTING",
  },
  ACKNOWLEDGED: {
    assign: "INSPECTING",
  },
  INSPECTING: {
    // submit_result is special-cased — the next state depends on
    // the technician's submitted outcome (SAFE | UNSAFE | MONITORING).
    // The `transition()` function resolves it at call time.
    submit_result: "UNSAFE", // sentinel — never used directly; see INSPECTING branch below
  },
  SAFE: { resolve: "RESOLVED" },
  UNSAFE: { resolve: "RESOLVED" },
  MONITORING: { resolve: "RESOLVED" },
  RESOLVED: { reopen: "OPEN" },
  REOPENED: {}, // alias — runtime normalizes to OPEN before calling.
};

/**
 * Inputs to `transition()`.
 */
export interface TransitionInput {
  readonly incident: IncidentPayload;
  readonly action: ActionVerb;
  /**
   * Inspection outcome. **Required** when `action === "submit_result"`,
   * **ignored** otherwise. Passing the wrong shape yields a typed
   * error from `transition()`.
   */
  readonly outcome?: InspectionOutcome;
  /**
   * The actor's `User.id`. Captured in the event payload (for
   * `assign`, the actor IS the assignee) — but NOT used to make
   * state-machine decisions. The route layer still resolves the
   * `actorUserId` for the audit trail.
   */
  readonly actorUserId: string | null;
  /**
   * For `assign` only: the `User.id` of the technician being
   * assigned. Required when `action === "assign"`; ignored
   * otherwise. The pure function records it in the event payload
   * so the audit trail captures the assignment target without
   * leaking it into the state machine's truth table.
   */
  readonly assigneeUserId?: string | null;
}

/**
 * Pure state-machine step.
 *
 * Returns:
 *
 *   - `{ ok: true, next_state, event_type, event_payload, at }` for
 *     valid transitions. The route layer is responsible for
 *     actually writing the row + the event.
 *
 *   - `{ ok: false, code: "invalid_state_transition", from,
 *     attempted, at }` for invalid transitions. The route layer
 *     maps this to HTTP 409 + writes an `IncidentEvent` with
 *     `type: "invalid_transition_attempt"` so the audit trail
 *     captures the loser's intent.
 *
 * Edge cases:
 *
 *   - `submit_result` from a non-INSPECTING state is INVALID even
 *     if the (state, submit_result) cell appears in TRANSITIONS —
 *     `submit_result` requires `state === "INSPECTING"`.
 *
 *   - `submit_result` without an `outcome` is INVALID (defense-in-
 *     depth against missing required body fields).
 *
 *   - `assign` without an `assigneeUserId` is INVALID (the
 *     technician to assign must be in the body).
 *
 *   - `reopen` from a non-RESOLVED state is INVALID.
 *
 *   - `acknowledge` from a non-OPEN state is INVALID.
 */
export const transition = (input: TransitionInput): TransitionResult => {
  const { incident, action, actorUserId } = input;
  const from = incident.state;
  const at = new Date().toISOString();
  const ctx = { from, actorUserId, at };

  // Special-cased verbs delegate to helpers so this function stays
  // under the lint complexity ceiling. Each helper encodes the
  // pre-conditions + payload for one verb.
  if (action === "submit_result") {
    return applySubmitResult({ ...ctx, outcome: input.outcome });
  }
  if (action === "assign") {
    return applyAssign({ ...ctx, assignee: input.assigneeUserId });
  }

  // Static-table lookup for the remaining verbs.
  return applyTableTransition({ ...ctx, action });
};

interface SubmitResultCtx {
  readonly from: IncidentState;
  readonly outcome: InspectionOutcome | undefined;
  readonly actorUserId: string | null;
  readonly at: string;
}

/**
 * `submit_result` is special-cased: the next state depends on the
 * technician's submitted outcome. Only valid from `INSPECTING`.
 */
const applySubmitResult = (ctx: SubmitResultCtx): TransitionResult => {
  const { from, outcome, actorUserId, at } = ctx;
  if (from !== "INSPECTING" || outcome === undefined) {
    return {
      ok: false,
      code: "invalid_state_transition",
      from,
      attempted: "submit_result",
      at,
    };
  }
  return {
    ok: true,
    next_state: outcome,
    event_type: "submit_result",
    event_payload: { outcome, actorUserId },
    at,
  };
};

interface AssignCtx {
  readonly from: IncidentState;
  readonly assignee: string | null | undefined;
  readonly actorUserId: string | null;
  readonly at: string;
}

/**
 * `assign` is special-cased: the event payload MUST capture the
 * assignee. The state machine rejects missing assignees and
 * pre-conditions on the from-state explicitly.
 */
const applyAssign = (ctx: AssignCtx): TransitionResult => {
  const { from, assignee, actorUserId, at } = ctx;
  if ((from !== "OPEN" && from !== "ACKNOWLEDGED") || assignee === undefined || assignee === null) {
    return {
      ok: false,
      code: "invalid_state_transition",
      from,
      attempted: "assign",
      at,
    };
  }
  return {
    ok: true,
    next_state: "INSPECTING",
    event_type: "assign",
    event_payload: { assigneeUserId: assignee, actorUserId },
    at,
  };
};

interface TableCtx {
  readonly from: IncidentState;
  readonly action: ActionVerb;
  readonly actorUserId: string | null;
  readonly at: string;
}

/**
 * Table-driven lookup for the remaining verbs (acknowledge,
 * resolve, reopen). Returns the typed INVALID result on every
 * non-table cell.
 */
const applyTableTransition = (ctx: TableCtx): TransitionResult => {
  const { from, action, actorUserId, at } = ctx;
  // acknowledge is ONLY valid from OPEN. The TRANSITIONS table
  // also allows it from REOPENED, but the writer normalizes
  // REOPENED to OPEN before reaching here — so REOPENED should
  // never appear at runtime.
  if (action === "acknowledge" && from !== "OPEN") {
    return { ok: false, code: "invalid_state_transition", from, attempted: action, at };
  }
  // reopen is ONLY valid from RESOLVED.
  if (action === "reopen" && from !== "RESOLVED") {
    return { ok: false, code: "invalid_state_transition", from, attempted: action, at };
  }

  const cell = TRANSITIONS[from];
  const next = cell[action];
  if (next === undefined) {
    return { ok: false, code: "invalid_state_transition", from, attempted: action, at };
  }

  // The event_type mirrors the ActionVerb 1:1 — kept as a switch
  // so TypeScript catches a missed verb when a new ActionVerb is
  // added.
  const eventType = actionToEventType(action);
  return {
    ok: true,
    next_state: next,
    event_type: eventType,
    // Default event_payload is `{ actorUserId }` for verbs that
    // carry no operator-supplied data. submit_result + assign
    // already returned their own payloads in their helpers.
    event_payload: { actorUserId },
    at,
  };
};

/**
 * Map an `ActionVerb` to its `IncidentEventType`. The two enums
 * are 1:1 — kept separate to prevent Story 4.2's state machine
 * from leaking RBAC concerns (ActionVerb lives next to the RBAC
 * matrix; IncidentEventType is the audit-log closed set).
 */
const actionToEventType = (action: ActionVerb): IncidentEventType => {
  switch (action) {
    case "acknowledge":
      return "acknowledge";
    case "assign":
      return "assign";
    case "submit_result":
      return "submit_result";
    case "resolve":
      return "resolve";
    case "reopen":
      return "reopen";
  }
};

/**
 * Project the next-state `IncidentPayload` (wire-row shape) for a
 * successful transition. Pure: same input → same output.
 *
 * Used by the repository layer's writer to assemble the updated
 * row before the `tx.incident.update` call. The pure version
 * keeps the live-Prisma test rig honest — the test asserts that
 * `projectNextIncident(incident, "ACKNOWLEDGED", ...)` produces
 * exactly the row the writer commits.
 *
 * Time semantics (per spec-4-2-incident-state-machine.md §"Time
 * bookkeeping"):
 *
 *   - `acknowledged_at` is stamped on the FIRST transition out of
 *     OPEN (i.e. when `next_state` is anything other than OPEN).
 *     Once stamped, it persists across subsequent transitions
 *     (INSPECTING, SAFE, UNSAFE, MONITORING, RESOLVED).
 *
 *   - `resolved_at` is stamped only when `next_state === "RESOLVED"`.
 *
 *   - `assignee_user_id` is taken from the `assigneeUserId`
 *     argument (only set on `assign`). For all other verbs, the
 *     current value is preserved.
 */
/**
 * Input shape for `projectNextIncident`. Args-as-object keeps the
 * function under the lint `max-params` ceiling (4 fields here
 * would trip it).
 */
export interface ProjectNextIncidentInput {
  readonly current: IncidentPayload;
  readonly nextState: IncidentState;
  readonly at: string;
  readonly assigneeUserId: string | null;
}

/**
 * Project the next `IncidentPayload` from the current row + the
 * transition outcome. Used by the route layer's post-update
 * projection (e.g. for the `incident:state_changed` socket emit)
 * so the wire payload reflects the committed state.
 */
export const projectNextIncident = (input: ProjectNextIncidentInput): IncidentPayload => {
  const { current, nextState, at, assigneeUserId } = input;
  const ackedAt =
    current.acknowledged_at ?? (nextState !== "OPEN" && nextState !== "REOPENED" ? at : null);
  const resolvedAt = nextState === "RESOLVED" ? at : current.resolved_at;
  return {
    id: current.id,
    device_id: current.device_id,
    severity: current.severity,
    metric: current.metric,
    value: current.value,
    opened_at: current.opened_at,
    state: nextState,
    assignee_user_id: assigneeUserId !== null ? assigneeUserId : current.assignee_user_id,
    acknowledged_at: ackedAt,
    resolved_at: resolvedAt,
  };
};

/**
 * Re-export the stable states array for callers that don't want
 * to reach into `@surakkha/shared` directly. The route + repo
 * layers use this for the live-Prisma test rig's coverage matrix.
 */
export { INCIDENT_STABLE_STATES };
