/**
 * RBAC primitives (ADR 0011, architecture §8.3, FR-20, FR-21).
 *
 * The full role × action × resource matrix lives at
 * `docs/architecture-appendix-rbac.md` (Story 1.1 deliverable) and is the
 * canonical source. This file re-exports the enums the api middleware and the
 * frontend route guard both type-check against — so a new role or action in
 * the matrix requires editing only this file.
 */
import { z } from "zod";

export const RoleSchema = z.enum(["Admin", "Operator", "Technician", "Viewer"]);
export type Role = z.infer<typeof RoleSchema>;

export const ActionSchema = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
  "export",
  "manage_rules",
  "manage_devices",
  "manage_users",
  "control_simulator",
  "view_audit_log",
]);
export type Action = z.infer<typeof ActionSchema>;

export const ResourceSchema = z.enum([
  "dashboard",
  "reading",
  "alert",
  "incident",
  "rule",
  "device",
  "user",
  "audit_log",
  "notification",
  "report",
  "simulator",
]);
export type Resource = z.infer<typeof ResourceSchema>;

export interface RbacTriple {
  readonly subject: Role;
  readonly action: Action;
  readonly resource: Resource;
}

/**
 * Predicate stub. The full matrix is filled in by Story 1.1
 * (`docs/architecture-appendix-rbac.md`) and consumed by the api's
 * `authorize.ts` middleware. This stub returns `false` for every triple so an
 * unconfigured deployment is fail-closed.
 */
export function isAllowed(_triple: RbacTriple): boolean {
  return false;
}

/** Audit action enum — Story 5.6 + ADR 0012 closed enumeration. */
export const AuditActionSchema = z.enum([
  "login_success",
  "login_failure",
  "logout",
  "token_refresh",
  "rbac_denied",
  "invalid_state_transition",
  "threshold_changed",
  "rule_created",
  "rule_archived",
  "device_created",
  "device_updated",
  "incident_state_changed",
  "incident_reopened",
  "alert_acknowledged",
  "alert_cleared",
  "notification_emitted",
  "csv_exported",
  "simulator_event",
  "jwt_secret_rotated",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;