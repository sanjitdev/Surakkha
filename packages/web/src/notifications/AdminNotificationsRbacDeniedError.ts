/**
 * Tagged error for the admin notifications page's 403 path. Same
 * shape as `NotificationsRbacDeniedError` but isolated to the admin
 * surface (the bell's and the admin list's cache identities are
 * distinct, so the error classes are too). The `name` field MUST
 * stay stable — `useAdminNotificationList.spec.tsx` asserts on it as
 * the `instanceof` discriminator.
 */
export class AdminNotificationsRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/notifications/admin/list");
    this.name = "AdminNotificationsRbacDeniedError";
  }
}
