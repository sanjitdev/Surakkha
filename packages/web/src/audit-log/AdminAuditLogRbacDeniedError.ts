/**
 * `AdminAuditLogRbacDeniedError` — Story 5.3.
 *
 * Tagged error for the admin audit log page's 403 path.
 * Mirrors `AdminNotificationsRbacDeniedError` (Story 5.1):
 * same pattern, same `name`-field stability invariant, but
 * isolated to the audit log surface.
 *
 * Why a new class (not reusing `AdminNotificationsRbacDeniedError`):
 *
 *   - The admin notification list's cache identity
 *     ([`ADMIN_NOTIFICATIONS_QUERY_KEY`]) and the admin audit
 *     log list's cache identity ([`AUDIT_LOG_QUERY_KEY`]) are
 *     distinct. Reusing the same error class would force both
 *     hooks to share the SAME `useQuery<…, XxxError>` type — a
 *     future refactor that distorts one surface's error
 *     contract would silently propagate to the other. Two
 *     classes keep the cross-cutting decision explicit.
 *
 *   - The class identity doubles as a trace label — operations
 *     logs that name the error class can distinguish "the
 *     notifications page got 403" from "the audit log page got
 *     403" without scanning the URL.
 *
 *   - 5 lines of code; the cross-module isolation cost is small
 *     (zero), and the indirection benefit (independent evolution)
 *     is large.
 *
 * The `name` field MUST stay stable — `useAuditLogList.spec.tsx`
 * asserts on it as the `instanceof` discriminator.
 */
export class AdminAuditLogRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/audit/list");
    this.name = "AdminAuditLogRbacDeniedError";
  }
}
