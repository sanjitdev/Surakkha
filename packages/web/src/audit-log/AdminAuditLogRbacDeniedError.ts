/**
 * Tagged error for the admin audit log 403 path. Sibling of
 * `AdminNotificationsRbacDeniedError`; isolated so cache-identity
 * drift in one surface does not silently propagate to the other.
 * The `name` field is the `instanceof` discriminator in the spec.
 */
export class AdminAuditLogRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/audit/list");
    this.name = "AdminAuditLogRbacDeniedError";
  }
}
