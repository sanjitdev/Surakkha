/**
 * RBAC primitives (ADR 0011, architecture §8.3, FR-20, FR-21, Story 1.1).
 *
 * The full role × action × resource matrix is the **canonical authority
 * source** for v1. It is defined as a typed `const` in this file and exported
 * as `RBAC_MATRIX`. The prose explanation lives at
 * `docs/architecture-appendix-rbac.md` and must stay in lockstep — every cell
 * there has exactly one corresponding entry here.
 *
 * The matrix shape is `Record<Role, Record<Action, Record<Resource, boolean>>>`
 * so:
 *   - `isAllowed({ subject, action, resource })` is a single hash lookup
 *     (fail-closed on missing keys),
 *   - `tsc` refuses to compile any handler that passes an `Action` or
 *     `Resource` not registered here,
 *   - `pnpm lint:rbac` (Story 1.1 AC: "CI lint that fails when handler code
 *     references an action not in the matrix") detects string drift.
 *
 * Every grant is explicit. There is no implicit "Admin can do everything."
 * The negative test register (Story 1.8) cross-references row numbers in
 * `docs/architecture-appendix-rbac.md`.
 */
import { z } from "zod";

export const RoleSchema = z.enum(["Admin", "Operator", "Technician", "Viewer"]);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Action vocabulary mirrors the rows of `docs/architecture-appendix-rbac.md`.
 * The verb `manage` covers CRUD on User + School; `drive` is the simulator
 * control verb; `acknowledge_banner` is the SeverityBanner dismiss verb.
 */
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
  "manage",
  "drive",
  "acknowledge_banner",
]);
export type Action = z.infer<typeof ActionSchema>;

/**
 * Resources cover every entity surfaced via the api or referenced in the
 * incident workflow. `School` and `severity_banner` were added in Story 1.1
 * to bring the TS enum into 1:1 alignment with the appendix.
 */
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
]);
export type Resource = z.infer<typeof ResourceSchema>;

export interface RbacTriple {
  readonly subject: Role;
  readonly action: Action;
  readonly resource: Resource;
}

/**
 * Wide-typed triple used by handlers that want the fail-closed guarantee
 * even when the action or resource came from an untrusted source (e.g. a
 * string parsed from a URL parameter). Anything outside the matrix yields
 * `false` without throwing.
 */
export interface RbacTripleLoose {
  readonly subject: string;
  readonly action: string;
  readonly resource: string;
}

/**
 * The canonical matrix. Every (Role, Action, Resource) triple must have an
 * explicit entry. The order of resources within each action block matches
 * the appendix table so a reviewer can read down the column.
 *
 * IMPORTANT: this is a `const` with `as const` so the inferred type is the
 * narrowest possible; that is what `tsc` checks against when handler code
 * references an Action or Resource.
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
    },
    create: {
      Device: Y,
      Reading: N,
      Alert: N,
      Incident: N,
    },
    update: {
      Device: Y,
      Rule: Y,
    },
    delete: {
      Device: Y,
      Rule: Y,
    },
    acknowledge: {
      Alert: Y,
      Incident: Y,
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
    },
    create: {
      Device: N,
      Reading: N,
      Alert: N,
      Incident: N,
    },
    update: {
      Device: N,
      Rule: N,
    },
    delete: {
      Device: N,
      Rule: N,
    },
    acknowledge: {
      Alert: Y,
      Incident: Y,
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
      // ownership is enforced by Story 1.7 (middleware reads
      // `req.user.id === incident.assignee_user_id`).
      Incident: Y,
      Rule: Y,
      AuditLog: N,
      Notification: Y,
      User: N,
      School: Y,
      SeverityBanner: N,
      Simulator: N,
    },
    create: {
      Device: N,
      Reading: N,
      Alert: N,
      Incident: N,
    },
    update: {
      Device: N,
      Rule: N,
    },
    delete: {
      Device: N,
      Rule: N,
    },
    acknowledge: {
      Alert: N,
      Incident: N,
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
    },
    create: {
      Device: N,
      Reading: N,
      Alert: N,
      Incident: N,
    },
    update: {
      Device: N,
      Rule: N,
    },
    delete: {
      Device: N,
      Rule: N,
    },
    acknowledge: {
      Alert: N,
      Incident: N,
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
 * Fail-closed predicate. Consults RBAC_MATRIX; returns false on any unknown
 * (subject, action, resource) triple. ADR 0011 + FR-21 + FR-24.
 *
 * Note: ownership rules (Technician may only act on assigned incidents) live
 * in `packages/api/src/middleware/authorize.ts`, not here. This predicate is
 * the role-level first gate.
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
export type RbacExpectedStatus =
  | typeof RBAC_STATUS_FORBIDDEN
  | typeof RBAC_STATUS_UNAUTHORIZED;

/**
 * Negative-row registry. The cross-references here let Story 1.8's negative
 * tests pinpoint the appendix row each case covers. Keep this list in sync
 * with `docs/architecture-appendix-rbac.md` §"Negative test cases (Story 1.8)".
 */
export interface RbacNegativeCase {
  readonly index: number;
  readonly endpoint: string;
  readonly subject: Role;
  readonly expected: RbacExpectedStatus;
  /** Section anchor in `docs/architecture-appendix-rbac.md`. */
  readonly appendixRow: string;
}

export const RBAC_NEGATIVE_CASES: readonly RbacNegativeCase[] = [
  { index: 1, endpoint: "GET /audit", subject: "Operator", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "AuditLog · read" },
  { index: 2, endpoint: "POST /incidents", subject: "Viewer", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "Incident · create" },
  { index: 3, endpoint: "GET /incidents/{id}", subject: "Technician", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "Incident · read (not assignee)" },
  { index: 4, endpoint: "POST /incidents/{id}/submit_result", subject: "Viewer", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "Incident · submit_result" },
  { index: 5, endpoint: "POST /admin/simulator/{device_id}/scenario", subject: "Operator", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "Simulator · drive" },
  { index: 6, endpoint: "GET /devices/{device_id}/export.csv", subject: "Technician", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "Reading · export" },
  { index: 7, endpoint: "GET /banners/active", subject: "Operator", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "SeverityBanner · read" },
  { index: 8, endpoint: "POST /admin/thresholds/{rule_id}", subject: "Viewer", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "Rule · update" },
  { index: 9, endpoint: "POST /admin/users", subject: "Operator", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "User · manage" },
  { index: 10, endpoint: "POST /incidents/{id}/submit_result", subject: "Technician", expected: RBAC_STATUS_FORBIDDEN, appendixRow: "Incident · submit_result (not assignee)" },
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
  // Story 2.2 — ingest seam emits these when the 10-step driver completes.
  // `reading_ingested` fires on every accepted frame, `reading_rate_limited`
  // fires when the rate-cap step rejects a frame, `seq_drop_detected` fires
  // when a gap between consecutive `seq` values is observed, and
  // `seq_reorder_detected` fires when a late frame arrives
  // (`seq < last_seen`). The gap vs reorder distinction matters for
  // triage: a gap means frames were lost in transit; a reorder means a
  // late retransmit, the per-frame data is intact.
  "reading_ingested",
  "reading_rate_limited",
  "seq_drop_detected",
  "seq_reorder_detected",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;
