/**
 * `auditActionResourceMap.ts` — Story 5.6.
 *
 * `AuditAction` → `{ resource, resourceIdKey }` lookup the
 * writer applies on every `audit.emit`. Closed enum at
 * `@surakkha/shared/rbac` makes any missing entry a compile
 * error here.
 *
 * Resource-less rows (`logout`, `rbac_allowed`, `rbac_denied`,
 * `jwt_secret_rotated`, `cron_run_completed`) map to
 * `{ resource: "Other", resourceIdKey: null }`. The writer
 * extracts `context[resourceIdKey]` for resource-bound actions
 * and stores it as `resourceId`.
 */
import { type AuditLogResource } from "@surakkha/shared/audit";
import { type AuditAction } from "@surakkha/shared/rbac";

interface AuditActionResourceEntry {
  readonly resource: AuditLogResource;
  /**
   * `context` key the writer copies into `resourceId`. `null`
   * for resource-less actions. Whitespace-trim + zero-length
   * collapse to `null` lives in `resolveResourceBinding`
   * (F-5.6-D19).
   */
  readonly resourceIdKey: string | null;
}

/**
 * Resource-less actions map to `{ resource: "Other", resourceIdKey: null }`.
 * Session-bound (`login_*`, `token_refresh`) carry `sessionId` when present.
 * `simulator_event` is snake_case (`device_id`) — matches the wire payload
 * `simulatorRouter.ts:407` populates. All other resource-bound actions use
 * camelCase singular: `{ entity }Id` for the per-entity id the emit site
 * carries.
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
