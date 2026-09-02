/**
 * `auditActionResourceMap.ts` — Story 5.6.
 *
 * Single source of truth for the `AuditAction` → `{ resource,
 * resourceIdKey }` mapping the writer (`auditLogWriter.ts`)
 * applies on every `audit.emit` call. Extracted as a separate
 * module so future per-action customisation (e.g. extracting
 * `deviceId` from a `reading_ingested` payload) lands here
 * without touching the writer.
 *
 * Why a static lookup (vs a switch in the writer):
 *
 *   - A `Record<AuditAction, ...>` with all 24 enum entries lets
 *     `tsc` flag any future drift in `AuditActionSchema` — adding
 *     a value forces an update here at compile time. A `switch`
 *     with `default: "Other"` would silently swallow drift.
 *
 *   - The map is the seam where Story 5.6's spec promises "future
 *     per-action resource customisation would land" — the
 *     `resourceIdKey` field is a forward-compatible hook (the
 *     writer extracts `context[resourceIdKey]` for resource-bound
 *     actions and stores it as `resourceId`).
 *
 * Resource-less actions (`logout`, `rbac_allowed`) map to the
 * canonical `{ resource: "Other", resourceIdKey: null }` default.
 * The writer renders `resourceId: null` when the key is absent /
 * `null`.
 */
import { type AuditLogResource } from "@surakkha/shared/audit";
import { type AuditAction } from "@surakkha/shared/rbac";

/**
 * One row of the action → resource lookup. `resource` is the
 * closed `AuditLogResource` enum the wire schema accepts;
 * `resourceIdKey` is the `context` field the writer will copy
 * into the `resourceId` column (or `null` if the action has no
 * resource binding).
 */
export interface AuditActionResourceEntry {
  readonly resource: AuditLogResource;
  /**
   * The key the writer will look up on the `context` payload to
   * populate `resourceId`. `null` for resource-less actions
   * (`logout`, `rbac_allowed`, `simulator_event` when no device).
   * Trimming + length-zero handling lives in `resolveResourceId`
   * (see F-5.6-D19).
   */
  readonly resourceIdKey: string | null;
}

/**
 * 24-entry lookup. The closed `AuditActionSchema` enum in
 * `@surakkha/shared/rbac` is the authority source — any drift
 * here is a compile error (`Type 'X' is not assignable to type
 * 'AuditAction'` on the key type).
 *
 * Resource-less rows (`logout`, `rbac_allowed`) carry
 * `resourceIdKey: null`. Resource-bound rows name the
 * conventional key the corresponding `audit.emit` call site
 * populates:
 *
 *   - `incident_state_changed` → `incidentId` (from
 *     `transitionHelpers.ts` / `transitionSideEffects.ts`)
 *   - `incident_reopened` → `incidentId`
 *   - `alert_acknowledged` → `alertId`
 *   - `alert_cleared` → `alertId`
 *   - `rule_created` / `rule_archived` → `ruleId`
 *   - `threshold_changed` → `ruleId`
 *   - `device_created` / `device_updated` → `deviceId`
 *   - `notification_emitted` → `notificationId`
 *   - `csv_exported` → `deviceId` (the URL-param of the CSV export)
 *   - `simulator_event` → `deviceId`
 *   - `reading_ingested` → `deviceId`
 *   - `reading_rate_limited` → `deviceId`
 *   - `seq_drop_detected` / `seq_reorder_detected` → `deviceId`
 *   - `token_refresh` / `login_success` / `login_failure` →
 *     `sessionId` when present, else `null`.
 *   - `jwt_secret_rotated` / `cron_run_completed` / `logout` /
 *     `rbac_allowed` / `rbac_denied` / `invalid_state_transition`
 *     → `null` (no resource binding).
 */
export const auditActionResourceMap: Record<AuditAction, AuditActionResourceEntry> = {
  login_success: { resource: "Session", resourceIdKey: "sessionId" },
  login_failure: { resource: "Session", resourceIdKey: "sessionId" },
  logout: { resource: "Other", resourceIdKey: null },
  token_refresh: { resource: "Session", resourceIdKey: "sessionId" },
  rbac_denied: { resource: "Other", resourceIdKey: null },
  invalid_state_transition: { resource: "Incident", resourceIdKey: "incidentId" },
  threshold_changed: { resource: "Rule", resourceIdKey: "ruleId" },
  rule_created: { resource: "Rule", resourceIdKey: "ruleId" },
  rule_archived: { resource: "Rule", resourceIdKey: "ruleId" },
  device_created: { resource: "Device", resourceIdKey: "deviceId" },
  device_updated: { resource: "Device", resourceIdKey: "deviceId" },
  incident_state_changed: { resource: "Incident", resourceIdKey: "incidentId" },
  incident_reopened: { resource: "Incident", resourceIdKey: "incidentId" },
  alert_acknowledged: { resource: "Alert", resourceIdKey: "alertId" },
  alert_cleared: { resource: "Alert", resourceIdKey: "alertId" },
  notification_emitted: { resource: "Notification", resourceIdKey: "notificationId" },
  csv_exported: { resource: "Reading", resourceIdKey: "deviceId" },
  simulator_event: { resource: "Simulator", resourceIdKey: "device_id" },
  jwt_secret_rotated: { resource: "Other", resourceIdKey: null },
  reading_ingested: { resource: "Reading", resourceIdKey: "deviceId" },
  reading_rate_limited: { resource: "Device", resourceIdKey: "deviceId" },
  seq_drop_detected: { resource: "Device", resourceIdKey: "deviceId" },
  seq_reorder_detected: { resource: "Device", resourceIdKey: "deviceId" },
  rbac_allowed: { resource: "Other", resourceIdKey: null },
  cron_run_completed: { resource: "Other", resourceIdKey: null },
};
