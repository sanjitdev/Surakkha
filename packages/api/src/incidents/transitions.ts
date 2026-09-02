/**
 * Incident state machine — pure step for the criteria-state-machine
 * core. `transition(input): TransitionResult` returns either
 * `{ ok: true, next_state, ... }` or
 * `{ ok: false, code: "invalid_state_transition", from, attempted, at }`.
 * No Prisma, no socket, no audit — those are the caller's concern.
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

/** The 8-row truth table. Cells NOT in the table are invalid.
 *  `submit_result` from INSPECTING is special-cased in
 *  `applySubmitResult` because the next state depends on the
 *  technician's submitted outcome. `REOPENED` is an empty alias —
 *  the reopen writer normalizes to OPEN before reaching here. */
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
    submit_result: "UNSAFE", // sentinel — never used directly; see applySubmitResult
  },
  SAFE: { resolve: "RESOLVED" },
  UNSAFE: { resolve: "RESOLVED" },
  MONITORING: { resolve: "RESOLVED" },
  RESOLVED: { reopen: "OPEN" },
  REOPENED: {},
};

export interface TransitionInput {
  readonly incident: IncidentPayload;
  readonly action: ActionVerb;
  /** Required when `action === "submit_result"`, ignored otherwise. */
  readonly outcome?: InspectionOutcome;
  /** Actor's `User.id`. Captured in the event payload, NOT used to
   *  make state-machine decisions — RBAC is enforced upstream. */
  readonly actorUserId: string | null;
  /** For `assign` only: the technician being assigned. Required
   *  when `action === "assign"`, ignored otherwise. */
  readonly assigneeUserId?: string | null;
  /** For `reopen` only: the Admin-supplied comment explaining the
   *  reopen. Length-validated at the route layer; the pure
   *  function embeds the value into `event_payload.reason`. */
  readonly reason?: string | null;
}

export const transition = (input: TransitionInput): TransitionResult => {
  const { incident, action, actorUserId } = input;
  const from = incident.state;
  const at = new Date().toISOString();
  const ctx = { from, actorUserId, at };

  if (action === "submit_result") {
    return applySubmitResult({ ...ctx, outcome: input.outcome });
  }
  if (action === "assign") {
    return applyAssign({ ...ctx, assignee: input.assigneeUserId });
  }
  return applyTableTransition({ ...ctx, action, reason: input.reason ?? null });
};

interface SubmitResultCtx {
  readonly from: IncidentState;
  readonly outcome: InspectionOutcome | undefined;
  readonly actorUserId: string | null;
  readonly at: string;
}

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
  readonly reason: string | null;
}

const applyTableTransition = (ctx: TableCtx): TransitionResult => {
  const { from, action, actorUserId, at, reason } = ctx;
  if (action === "acknowledge" && from !== "OPEN") {
    return { ok: false, code: "invalid_state_transition", from, attempted: action, at };
  }
  if (action === "reopen" && from !== "RESOLVED") {
    return { ok: false, code: "invalid_state_transition", from, attempted: action, at };
  }

  const cell = TRANSITIONS[from];
  const next = cell[action];
  if (next === undefined) {
    return { ok: false, code: "invalid_state_transition", from, attempted: action, at };
  }

  const eventType = actionToEventType(action);
  return {
    ok: true,
    next_state: next,
    event_type: eventType,
    event_payload:
      action === "reopen" && reason !== null ? { actorUserId, reason } : { actorUserId },
    at,
  };
};

/** Closed-enum switch so TypeScript catches a missed verb when
 *  `ActionVerb` grows. */
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

/** Pure test-only mirror of the production writer's
 *  time-bookkeeping logic. `acknowledged_at` stamps on the first
 *  non-OPEN/reopened transition; `resolved_at` clears on
 *  RESOLVED → OPEN; `assignee_user_id` only mutates on `assign`. */
export interface ProjectNextIncidentInput {
  readonly current: IncidentPayload;
  readonly nextState: IncidentState;
  readonly at: string;
  readonly assigneeUserId: string | null;
}

export const projectNextIncident = (input: ProjectNextIncidentInput): IncidentPayload => {
  const { current, nextState, at, assigneeUserId } = input;
  const ackedAt =
    current.acknowledged_at ?? (nextState !== "OPEN" && nextState !== "REOPENED" ? at : null);
  const resolvedAt =
    nextState === "RESOLVED"
      ? at
      : nextState === "OPEN" && current.state === "RESOLVED"
        ? null
        : current.resolved_at;
  const newAssignee =
    nextState === "INSPECTING" && assigneeUserId !== null
      ? assigneeUserId
      : current.assignee_user_id;
  return {
    id: current.id,
    device_id: current.device_id,
    severity: current.severity,
    metric: current.metric,
    value: current.value,
    opened_at: current.opened_at,
    state: nextState,
    assignee_user_id: newAssignee,
    acknowledged_at: ackedAt,
    resolved_at: resolvedAt,
  };
};

/** Re-export so the route + repo layers don't reach into
 *  `@surakkha/shared` directly. */
export { INCIDENT_STABLE_STATES };
