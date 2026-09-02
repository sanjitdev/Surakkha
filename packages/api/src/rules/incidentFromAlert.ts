/**
 * Pure helper that decides whether a just-committed Alert should
 * auto-create an Incident row, and builds the Incident-write payload
 * when it should.
 *
 * Decision rule:
 *   - `severity === "warning"` → create (medium-severity work item).
 *   - `severity === "critical"` → create (high-severity work item).
 *   - `severity === "info"` → do NOT create (informational only).
 *   - Any other severity → do NOT create.
 *
 * The helper is pure (no Prisma imports). It is called from inside
 * the `$transaction` callback in `applyTransition.ts` so the Incident
 * row commits atomically with the Alert row + state upsert. The
 * P2002 race-catch path returns BEFORE this helper is called, so
 * the second writer does not create a duplicate incident.
 *
 * What this helper does NOT do:
 *   - Emit a socket event (incident lifecycle is out of scope).
 *   - Touch the Incident state machine.
 *   - Deduplicate across multiple alerts on the same
 *     `(deviceId, metric)` key (reopen path owns this).
 */
import {
  type IncidentCreatingSeverity,
  type RuleMetric,
  shouldCreateIncident as shouldCreateIncidentShared,
} from "@surakkha/shared";

/** Closed set of severities that auto-create an Incident.
 *  Re-exported from `@surakkha/shared/incident.ts` so api and db
 *  share one source of truth. */
export type { IncidentCreatingSeverity };

/** Re-export the shared predicate. Aliased back to the local name so
 *  the call site in `applyTransition.ts` keeps its existing
 *  `shouldCreateIncident(severity)` import path. */
export const shouldCreateIncident = shouldCreateIncidentShared;

/** Input shape the helper needs from the alert row + transition
 *  context. Slim on purpose — the alert row carries `deviceId,
 *  metric` and the `transition` carries `severity, openedAt`. */
export interface IncidentFromAlertInput {
  readonly deviceId: string;
  readonly severity: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly openedAt: Date;
}

/** Build the `Incident` row payload from the alert's metadata.
 *  Pure: no DB write — the caller passes the result to
 *  `tx.incident.create({ data: ... })` inside the `$transaction`.
 *
 *  The `value` is the rule's `metricValue` (the reading that breached
 *  the threshold), NOT a derived or aggregate. */
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
  // Auto-create lands in OPEN. The schema defaults to OPEN, but
  // we pass it explicitly so the call site is self-documenting
  // and the test rig can pin the exact shape.
  state: "OPEN",
  // No assignee / no acknowledged_at / no resolved_at at
  // auto-create time. The Operator / Admin must acknowledge +
  // assign before the Technician can submit a result.
  assigneeUserId: null,
  acknowledgedAt: null,
  resolvedAt: null,
});
