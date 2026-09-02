/**
 * Pure helper: decides whether a just-committed Alert should
 * auto-create an Incident row, and builds the Incident-write payload.
 *
 * Decision rule (re-exported from `@surakkha/shared`):
 *   - `severity === "warning"` → create.
 *   - `severity === "critical"` → create.
 *   - `severity === "info"` → do NOT create.
 *
 * Called from inside the open `$transaction` callback in
 * `applyTransition`. The P2002 race-catch path returns BEFORE this
 * helper is called, so the second writer does not create a duplicate.
 */
import {
  type IncidentCreatingSeverity,
  type RuleMetric,
  shouldCreateIncident as shouldCreateIncidentShared,
} from "@surakkha/shared";

/** Closed set of severities that auto-create an Incident. */
export type { IncidentCreatingSeverity };

/** Re-export the shared predicate under its local name. */
export const shouldCreateIncident = shouldCreateIncidentShared;

/** Input shape the helper needs from the alert row + transition. */
export interface IncidentFromAlertInput {
  readonly deviceId: string;
  readonly severity: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly openedAt: Date;
}

/** Build the `Incident` row payload from the alert's metadata.
 *  Pure — the caller passes the result to `tx.incident.create`
 *  inside the `$transaction`. */
export const buildIncidentPayload = (
  input: IncidentFromAlertInput,
): {
  readonly deviceId: string;
  readonly severity: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly openedAt: Date;
  readonly state: "OPEN";
  readonly assigneeUserId: null;
  readonly acknowledgedAt: null;
  readonly resolvedAt: null;
} => ({
  deviceId: input.deviceId,
  severity: input.severity,
  metric: input.metric,
  value: input.value,
  openedAt: input.openedAt,
  // Schema defaults to OPEN; passed explicitly for self-documentation.
  state: "OPEN",
  // No assignee / acknowledged / resolved at auto-create time.
  assigneeUserId: null,
  acknowledgedAt: null,
  resolvedAt: null,
});
