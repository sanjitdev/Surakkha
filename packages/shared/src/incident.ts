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

/**
 * Closed subset of `IncidentSeverity` that auto-creates an Incident
 * row from a just-committed Alert (Story 3.6 AC1 + AC2). `info` is
 * excluded — informational alerts do not generate work items.
 *
 * Shared here so both `packages/api` (production: `applyOpenTransition`
 * calls this inside the alert-state `$transaction`) and
 * `packages/db/prisma/alert-debounce.spec.ts` (live test rig mirrors
 * the same gate) import one source of truth.
 */
export type IncidentCreatingSeverity = Extract<IncidentSeverity, "warning" | "critical">;

/**
 * Pure predicate — does a just-committed Alert of `severity` merit
 * an auto-created Incident? No DB or socket side effects.
 *
 * Defence-in-depth: `severity` is typed `string` (Alert.severity is a
 * free-form `String` column, not a Prisma enum), but the closed set
 * of valid values is exactly `IncidentSeverity` — anything outside
 * that set returns `false`.
 */
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
 * the `Action` RBAC enum's incident verbs
 * (`packages/shared/src/rbac.ts:33-47`) 1:1. Drift between the two
 * is caught by the source-walk pin in
 * `packages/api/src/__tests__/incident-actions.schema.spec.ts`
 * (added in 4.2).
 * ========================================================================== */

/**
 * Closed enumeration of valid incident transitions.
 * Mirrors `ActionSchema`'s incident verbs (`acknowledge`, `assign`,
 * `submit_result`, `resolve`, `reopen`).
 */
export const ActionVerbSchema = z.enum([
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
]);
export type ActionVerb = z.infer<typeof ActionVerbSchema>;

/**
 * Closed enumeration of incident-event audit types. Mirrors
 * `IncidentEventType_` in `packages/db/prisma/schema.prisma` 1:1.
 * `invalid_transition_attempt` is the synthetic type written when
 * a transition is rejected (optimistic-concurrency loser or a
 * `TRANSITIONS` table miss).
 */
export const IncidentEventTypeSchema = z.enum([
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
  "invalid_transition_attempt",
]);
export type IncidentEventType = z.infer<typeof IncidentEventTypeSchema>;

/**
 * Full wire row for an Incident. Read by `/api/incidents/:id` (Story 4.2
 * GET endpoint) and consumed by the deferred Story 4.4 detail page +
 * Story 4.3 Kanban column. Field order matches the Prisma
 * `Incident` model — keeping them in lockstep is the source-walk pin
 * `incident-payload.schema.spec.ts`'s job.
 *
 * `assignee_user_id` is nullable (NULL while unassigned).
 * `acknowledged_at` / `resolved_at` are nullable DateTime strings
 * (ISO 8601 with offset). `events` is the embedded timeline —
 * optional on the wire (the deferred UI uses a separate endpoint
 * for the timeline; the embedded form is for the dashboard's
 * "Most recent activity" widget).
 */
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

/**
 * Wire row for an IncidentEvent audit entry. Read by the deferred
 * Story 4.4 detail page timeline.
 */
export const IncidentEventPayloadSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  type: IncidentEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  created_at: ISO8601,
});
export type IncidentEventPayload = z.infer<typeof IncidentEventPayloadSchema>;

/**
 * Result of the pure `transition()` function
 * (`packages/api/src/incidents/transitions.ts`). Either a successful
 * next-state payload or a typed error with the original `from`
 * state and the rejected `attempted` action. The route layer maps
 * the typed error to a 409 response.
 */
export type TransitionResult =
  | {
      readonly ok: true;
      readonly next_state: IncidentState;
      readonly event_type: IncidentEventType;
      /**
       * Event payload for the `IncidentEvent` audit row. Carries
       * the action-specific data:
       *   - `submit_result`: `{ outcome: "safe" | "unsafe", actorUserId }`
       *   - `assign`: `{ assigneeUserId, actorUserId }`
       *   - other verbs: `{ actorUserId }`
       *
       * The route layer passes this through to `IncidentEvent.create`
       * inside the same `$transaction` as the state write.
       */
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
