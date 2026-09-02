/**
 * Tagged error for the bell's `/api/notifications` 403 path. The
 * `name` field MUST stay stable — the bell's `useQuery` error
 * assertion and any future cross-module error-class check rely on it.
 */
export class NotificationsRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/notifications");
    this.name = "NotificationsRbacDeniedError";
  }
}
