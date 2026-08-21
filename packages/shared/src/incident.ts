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