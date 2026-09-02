/**
 * Incident state machine (ADR 0009, architecture §5.1).
 *
 * Source of truth for the 7-state lifecycle:
 *   OPEN → ACKNOWLEDGED → INSPECTING → {SAFE | UNSAFE | MONITORING} → RESOLVED
 *   RESOLVED → OPEN (REOPENED via Admin comment of severity=critical)
 *
 * The Kanban 4-column view (AR-9) is a derived projection over this enum, not a
 * stored state. One source of truth — no epic renumbers or renames a state.
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

/** Closed subset of `IncidentSeverity` that auto-creates an Incident
 *  row from a just-committed Alert. `info` is excluded — informational
 *  alerts do not generate work items. */
export type IncidentCreatingSeverity = Extract<IncidentSeverity, "warning" | "critical">;

/** Pure predicate — does a just-committed Alert of `severity` merit
 *  an auto-created Incident? No DB or socket side effects.
 *  `severity` is typed `string` (Alert.severity is a free-form
 *  `String` column, not a Prisma enum); anything outside
 *  `IncidentSeverity` returns `false`. */
export const shouldCreateIncident = (severity: string): severity is IncidentCreatingSeverity =>
  severity === "warning" || severity === "critical";

/** Inspection outcome enum — what a Technician submits in Story 4.7. */
export const InspectionOutcomeSchema = z.enum(["SAFE", "UNSAFE", "MONITORING"]);
export type InspectionOutcome = z.infer<typeof InspectionOutcomeSchema>;

/**
 * Kanban columns (derived projection, AR-9).
 * Resolved at render time from IncidentState; never stored on the row.
 */
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
  // OPEN / UNSAFE — split by severity per UX-DR-9
  if (state === "UNSAFE" || severity === "critical") {
    return "OPEN_CRITICAL";
  }
  return "OPEN_WARNING";
}

/* ============================================================================
 * Story 4.2 — Incident state machine types.
 *
 * `ActionVerb` is the closed vocabulary of state transitions; mirrors
 * `ActionSchema`'s incident verbs 1:1. Drift between the two is caught
 * by the source-walk pin in the api's `incident-actions.schema.spec.ts`.
 * ========================================================================== */

/** Closed enumeration of valid incident transitions. */
export const ActionVerbSchema = z.enum([
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
]);
export type ActionVerb = z.infer<typeof ActionVerbSchema>;

/** Closed enumeration of incident-event audit types. Mirrors the Prisma
 *  `IncidentEventType_` enum 1:1. `invalid_transition_attempt` is the
 *  synthetic type written when a transition is rejected
 *  (optimistic-concurrency loser or a `TRANSITIONS` table miss). */
export const IncidentEventTypeSchema = z.enum([
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
  "invalid_transition_attempt",
]);
export type IncidentEventType = z.infer<typeof IncidentEventTypeSchema>;

/** Full wire row for an Incident. Field order matches the Prisma
 *  `Incident` model. `assignee_user_id` is nullable (NULL while
 *  unassigned); `acknowledged_at` / `resolved_at` are nullable
 *  ISO 8601 with offset. */
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

/** Result of the pure `transition()` function in the api. Either a
 *  successful next-state payload or a typed error with the original
 *  `from` state and the rejected `attempted` action. The route layer
 *  maps the typed error to a 409 response. */
export type TransitionResult =
  | {
      readonly ok: true;
      readonly next_state: IncidentState;
      readonly event_type: IncidentEventType;
      /** Event payload for the `IncidentEvent` audit row. Carries
       *  action-specific data:
       *   - `submit_result`: `{ outcome, actorUserId }`
       *   - `assign`: `{ assigneeUserId, actorUserId }`
       *   - other verbs: `{ actorUserId }` */
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
