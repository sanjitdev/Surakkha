/**
 * RBAC primitives (ADR 0011, architecture §8.3, FR-20, FR-21, Story 1.1).
 *
 * Canonical authority source for v1. The full role × action × resource
 * matrix is the typed `const` below; the prose explanation lives at
 * `docs/architecture-appendix-rbac.md` and must stay in lockstep.
 *
 * `isAllowed` is fail-closed on any unknown triple. Ownership rules
 * (Technician may only act on assigned incidents) live in the api's
 * authorize middleware, not here.
 */
import { z } from "zod";

export const RoleSchema = z.enum(["Admin", "Operator", "Technician", "Viewer"]);
export type Role = z.infer<typeof RoleSchema>;

/** Action vocabulary mirrors `docs/architecture-appendix-rbac.md` rows.
 *  `read_all` (Story 5.1) is the cross-role audit-lens read — Admin only,
 *  because the surface leaks `acknowledgedByUserId`. */
export const ActionSchema = z.enum([
  "read",
  "read_all",
  "create",
  "update",
  "delete",
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
  "export",
  "manage",
  "drive",
  "acknowledge_banner",
]);
export type Action = z.infer<typeof ActionSchema>;

/** Resources cover every entity surfaced via the api or referenced in
 *  the incident workflow. `Attachment` is added in Story 4.13. */
export const ResourceSchema = z.enum([
  "Device",
  "Reading",
  "Alert",
  "Incident",
  "Rule",
  "User",
  "School",
  "AuditLog",
  "Notification",
  "Simulator",
  "SeverityBanner",
  "Attachment",
]);
export type Resource = z.infer<typeof ResourceSchema>;

export interface RbacTriple {
  readonly subject: Role;
  readonly action: Action;
  readonly resource: Resource;
}

/** Wide-typed triple for handlers that want the fail-closed guarantee
 *  even when the action or resource came from an untrusted source. */
export interface RbacTripleLoose {
  readonly subject: string;
  readonly action: string;
  readonly resource: string;
}

/**
 * The canonical matrix. Every (Role, Action, Resource) triple has an
 * explicit entry. The order of resources within each action block
 * matches the appendix table so a reviewer can read down the column.
 *
 * IMPORTANT: `as const` so the inferred type is the narrowest possible;
 * that is what `tsc` checks against when handler code references an
 * Action or Resource.
 */
const Y = true as const;
const N = false as const;

export const RBAC_MATRIX = {
  Admin: {
    read: {
      Device: Y,
      Reading: Y,
      Alert: Y,
      Incident: Y,
      Rule: Y,
      AuditLog: Y,
      Notification: Y,
      User: Y,
      School: Y,
      SeverityBanner: Y,
      Simulator: N,
      Attachment: Y,
    },
    read_all: {
      Notification: Y,
    },
    create: {
      Device: Y,
      Reading: N,
      Alert: N,
      Incident: N,
      Attachment: Y,
    },
    update: {
      Device: Y,
      Rule: Y,
    },
    delete: {
      Device: Y,
      Rule: Y,
      Attachment: Y,
    },
    acknowledge: {
      Alert: Y,
      Incident: Y,
      Notification: Y,
    },
    assign: {
      Incident: Y,
    },
    submit_result: {
      Incident: N,
    },
    resolve: {
      Incident: Y,
    },
    reopen: {
      Incident: Y,
    },
    export: {
      Reading: Y,
    },
    manage: {
      User: Y,
      School: Y,
    },
    drive: {
      Simulator: Y,
    },
    acknowledge_banner: {
      SeverityBanner: Y,
    },
  },
  Operator: {
    read: {
      Device: Y,
      Reading: Y,
      Alert: Y,
      Incident: Y,
      Rule: Y,
      AuditLog: N,
      Notification: Y,
      User: N,
      School: Y,
      SeverityBanner: N,
      Simulator: N,
      Attachment: Y,
    },
    read_all: {
      Notification: N,
    },
    create: {
      Device: N,
      Reading: N,
      Alert: N,
      Incident: N,
      Attachment: Y,
    },
    update: {
      Device: N,
      Rule: N,
    },
    delete: {
      Device: N,
      Rule: N,
      Attachment: N,
    },
    acknowledge: {
      Alert: Y,
      Incident: Y,
      Notification: Y,
    },
    assign: {
      Incident: Y,
    },
    submit_result: {
      Incident: N,
    },
    resolve: {
      Incident: Y,
    },
    reopen: {
      Incident: N,
    },
    export: {
      Reading: Y,
    },
    manage: {
      User: N,
      School: N,
    },
    drive: {
      Simulator: N,
    },
    acknowledge_banner: {
      SeverityBanner: N,
    },
  },
  Technician: {
    read: {
      Device: Y,
      Reading: Y,
      Alert: Y,
      // Technicians only see incidents where they are the assignee;
      // ownership is enforced by the api's authorize middleware.
      Incident: Y,
      Rule: Y,
      AuditLog: N,
      Notification: Y,
      User: N,
      School: Y,
      SeverityBanner: N,
      Simulator: N,
      Attachment: Y,
    },
    read_all: {
      Notification: N,
    },
    create: {
      Device: N,
      Reading: N,
      Alert: N,
      Incident: N,
      Attachment: Y,
    },
    update: {
      Device: N,
      Rule: N,
    },
    delete: {
      Device: N,
      Rule: N,
      Attachment: N,
    },
    acknowledge: {
      Alert: N,
      Incident: N,
      Notification: Y,
    },
    assign: {
      Incident: N,
    },
    submit_result: {
      Incident: Y,
    },
    resolve: {
      Incident: N,
    },
    reopen: {
      Incident: N,
    },
    export: {
      Reading: N,
    },
    manage: {
      User: N,
      School: N,
    },
    drive: {
      Simulator: N,
    },
    acknowledge_banner: {
      SeverityBanner: N,
    },
  },
  Viewer: {
    read: {
      Device: Y,
      Reading: Y,
      Alert: Y,
      Incident: Y,
      Rule: Y,
      AuditLog: N,
      Notification: N,
      User: N,
      School: Y,
      SeverityBanner: N,
      Simulator: N,
      Attachment: Y,
    },
    read_all: {
      Notification: N,
    },
    create: {
      Device: N,
      Reading: N,
      Alert: N,
      Incident: N,
      Attachment: N,
    },
    update: {
      Device: N,
      Rule: N,
    },
    delete: {
      Device: N,
      Rule: N,
      Attachment: N,
    },
    acknowledge: {
      Alert: N,
      Incident: N,
      Notification: N,
    },
    assign: {
      Incident: N,
    },
    submit_result: {
      Incident: N,
    },
    resolve: {
      Incident: N,
    },
    reopen: {
      Incident: N,
    },
    export: {
      Reading: N,
    },
    manage: {
      User: N,
      School: N,
    },
    drive: {
      Simulator: N,
    },
    acknowledge_banner: {
      SeverityBanner: N,
    },
  },
} as const satisfies Record<Role, Record<Action, Partial<Record<Resource, boolean>>>>;

/**
 * Fail-closed predicate. Returns false on any unknown (subject,
 * action, resource) triple.
 */
export function isAllowed(triple: RbacTriple): boolean;
export function isAllowed(triple: RbacTripleLoose): boolean;
export function isAllowed(triple: RbacTriple | RbacTripleLoose): boolean {
  const row = RBAC_MATRIX[triple.subject as Role];
  if (!row) return false;
  const cell = (row as Record<string, unknown>)[triple.action];
  if (typeof cell !== "object" || cell === null) return false;
  return (cell as Record<string, boolean>)[triple.resource] === true;
}

/** HTTP status codes used by Story 1.8's negative tests. */
export const RBAC_STATUS_FORBIDDEN = 403;
export const RBAC_STATUS_UNAUTHORIZED = 401;
export type RbacExpectedStatus = typeof RBAC_STATUS_FORBIDDEN | typeof RBAC_STATUS_UNAUTHORIZED;

/** Negative-row registry — cross-references to `docs/architecture-appendix-rbac.md`
 *  let Story 1.8's negative tests pinpoint the appendix row each case covers. */
export interface RbacNegativeCase {
  readonly index: number;
  readonly endpoint: string;
  readonly subject: Role;
  readonly expected: RbacExpectedStatus;
  /** Section anchor in `docs/architecture-appendix-rbac.md`. */
  readonly appendixRow: string;
}

export const RBAC_NEGATIVE_CASES: readonly RbacNegativeCase[] = [
  {
    index: 1,
    endpoint: "GET /audit",
    subject: "Operator",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "AuditLog · read",
  },
  {
    index: 2,
    endpoint: "POST /incidents",
    subject: "Viewer",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "Incident · create",
  },
  {
    index: 3,
    endpoint: "GET /incidents/{id}",
    subject: "Technician",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "Incident · read (not assignee)",
  },
  {
    index: 4,
    endpoint: "POST /incidents/{id}/submit_result",
    subject: "Viewer",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "Incident · submit_result",
  },
  {
    index: 5,
    endpoint: "POST /admin/simulator/{device_id}/scenario",
    subject: "Operator",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "Simulator · drive",
  },
  {
    index: 6,
    endpoint: "GET /devices/{device_id}/export.csv",
    subject: "Technician",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "Reading · export",
  },
  {
    index: 7,
    endpoint: "GET /banners/active",
    subject: "Operator",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "SeverityBanner · read",
  },
  {
    index: 8,
    endpoint: "POST /admin/thresholds/{rule_id}",
    subject: "Viewer",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "Rule · update",
  },
  {
    index: 9,
    endpoint: "POST /admin/users",
    subject: "Operator",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "User · manage",
  },
  {
    index: 10,
    endpoint: "POST /incidents/{id}/submit_result",
    subject: "Technician",
    expected: RBAC_STATUS_FORBIDDEN,
    appendixRow: "Incident · submit_result (not assignee)",
  },
];

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
  // Ingest seam (Story 2.2) emits these on the 10-step driver
  // completion: `reading_ingested` per accepted frame, `reading_rate_limited`
  // on rate-cap rejection, `seq_drop_detected` on gap between consecutive
  // seq values, `seq_reorder_detected` on late retransmit.
  "reading_ingested",
  "reading_rate_limited",
  "seq_drop_detected",
  "seq_reorder_detected",
  // `rbac_allowed` (paired with `rbac_denied` on the failure branch) —
  // dashboards count permitted vs denied attempts.
  "rbac_allowed",
  // Hourly retention cron (Story 5.5) emits `cron_run_completed` on
  // every tick with `outcome: "success"` or `"failure"`.
  "cron_run_completed",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;
