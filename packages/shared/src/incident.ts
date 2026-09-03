/**
 * Incident state machine + transition wire types.
 *
 * The 7-state lifecycle (OPEN → ACKNOWLEDGED → INSPECTING → {SAFE |
 * UNSAFE | MONITORING} → RESOLVED, with REOPENED as a transition alias)
 * is the canonical pin for the api transition handler + the web Kanban
 * projection. The Kanban 4-column view is a derived projection, not a
 * stored state.
 */
import { z } from "zod";

const ISO8601 = z.string().datetime({ offset: true });

export const IncidentStateSchema = z.enum([
  "OPEN",
  "ACKNOWLEDGED",
  "INSPECTING",
  "SAFE",
  "UNSAFE",
  "MONITORING",
  "RESOLVED",
  "REOPENED",
]);
export type IncidentState = z.infer<typeof IncidentStateSchema>;

/** The seven stable states (excluding REOPENED, which is a transition alias). */
export const INCIDENT_STABLE_STATES = [
  "OPEN",
  "ACKNOWLEDGED",
  "INSPECTING",
  "SAFE",
  "UNSAFE",
  "MONITORING",
  "RESOLVED",
] as const satisfies readonly IncidentState[];

export const IncidentSeveritySchema = z.enum(["info", "warning", "critical"]);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

/** Closed subset of `IncidentSeverity` that auto-creates an Incident row from a just-committed Alert. */
export type IncidentCreatingSeverity = Extract<IncidentSeverity, "warning" | "critical">;

/** Pure predicate — does a just-committed Alert of `severity` merit an auto-created Incident? */
export const shouldCreateIncident = (severity: string): severity is IncidentCreatingSeverity =>
  severity === "warning" || severity === "critical";

/** Inspection outcome enum — what a Technician submits. */
export const InspectionOutcomeSchema = z.enum(["SAFE", "UNSAFE", "MONITORING"]);
export type InspectionOutcome = z.infer<typeof InspectionOutcomeSchema>;

/** Kanban columns (derived projection). Resolved at render time from IncidentState; never stored. */
export const KanbanColumnSchema = z.enum([
  "OPEN_CRITICAL",
  "OPEN_WARNING",
  "ACKNOWLEDGED",
  "RESOLVED",
]);
export type KanbanColumn = z.infer<typeof KanbanColumnSchema>;

export function projectKanbanColumn(
  state: IncidentState,
  severity: IncidentSeverity,
): KanbanColumn {
  if (state === "RESOLVED" || state === "SAFE" || state === "MONITORING") {
    return "RESOLVED";
  }
  if (state === "ACKNOWLEDGED" || state === "INSPECTING") {
    return "ACKNOWLEDGED";
  }
  if (state === "UNSAFE" || severity === "critical") {
    return "OPEN_CRITICAL";
  }
  return "OPEN_WARNING";
}

/** Closed enumeration of valid incident transitions. */
export const ActionVerbSchema = z.enum([
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
]);
export type ActionVerb = z.infer<typeof ActionVerbSchema>;

/** Closed enumeration of incident-event audit types. */
export const IncidentEventTypeSchema = z.enum([
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
  "invalid_transition_attempt",
]);
export type IncidentEventType = z.infer<typeof IncidentEventTypeSchema>;

/** Full wire row for an Incident. */
export const IncidentPayloadSchema = z.object({
  id: z.string().uuid(),
  device_id: z.string().uuid(),
  severity: IncidentSeveritySchema,
  metric: z.string(),
  value: z.number(),
  opened_at: ISO8601,
  state: IncidentStateSchema,
  assignee_user_id: z.string().uuid().nullable(),
  acknowledged_at: ISO8601.nullable(),
  resolved_at: ISO8601.nullable(),
});
export type IncidentPayload = z.infer<typeof IncidentPayloadSchema>;

/** Wire row for an IncidentEvent audit entry. */
export const IncidentEventPayloadSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  type: IncidentEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  created_at: ISO8601,
});
export type IncidentEventPayload = z.infer<typeof IncidentEventPayloadSchema>;

/** Result of the pure `transition()` function in the api. */
export type TransitionResult =
  | {
      readonly ok: true;
      readonly next_state: IncidentState;
      readonly event_type: IncidentEventType;
      /** Event payload for the `IncidentEvent` audit row. */
      readonly event_payload: {
        readonly outcome?: "SAFE" | "UNSAFE" | "MONITORING";
        readonly assigneeUserId?: string;
        readonly reason?: string;
        readonly actorUserId: string | null;
      };
      readonly at: string;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_state_transition";
      readonly from: IncidentState;
      readonly attempted: ActionVerb;
      readonly at: string;
    };
