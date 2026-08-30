/**
 * `AdminNotificationsRbacDeniedError` — Story 5.1.
 *
 * Tagged error for the admin notifications page's 403 path.
 * Mirrors `NotificationsRbacDeniedError` (4.10) — same pattern,
 * same `name`-field stability invariant, but isolated to the
 * admin surface.
 *
 * Why a new class (not reusing `NotificationsRbacDeniedError`):
 *
 *   - The operator-facing bell's cache identity ([`UNREAD_NOTIFICATIONS_QUERY_KEY`])
 *     and the admin-facing list's cache identity ([`ADMIN_NOTIFICATIONS_QUERY_KEY`])
 *     are distinct. Reusing the same error class would force the
 *     bell's `useQuery<…, NotificationsRbacDeniedError>` and the
 *     admin page's `useQuery<…, AdminNotificationsRbacDeniedError>`
 *     to share the SAME type — a future refactor that distorts
 *     the bell's error contract would silently propagate to the
 *     admin page. Two classes keep the cross-cutting decision
 *     explicit.
 *
 *   - The class identity doubles as a trace label — operations
 *     logs that name the error class can distinguish "the bell
 *     got 403" from "the admin page got 403" without scanning
 *     the URL.
 *
 *   - 5 lines of code; the cross-module isolation cost is small
 *     (zero), and the indirection benefit (independent evolution)
 *     is large.
 *
 * The `name` field MUST stay stable — `useAdminNotificationList.spec.tsx`
 * asserts on it as the `instanceof` discriminator.
 */
export class AdminNotificationsRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/notifications/admin/list");
    this.name = "AdminNotificationsRbacDeniedError";
  }
}
