/**
 * `NotificationsRbacDeniedError` — Story 4.10.
 *
 * Tagged error for the bell's `/api/notifications` 403 path.
 * Mirrors the pattern of `KanbanRbacDeniedError` (4.3) and
 * `SeverityBanner`'s reuse of the same class (4.8).
 *
 * Why a new class (not reusing `KanbanRbacDeniedError`):
 *
 *   - Cross-module isolation. The Kanban's `instanceof
 *     KanbanRbacDeniedError` check at `KanbanBoard.tsx:225` is
 *     load-bearing for the SeverityBanner's cache-error assertion
 *     (`SeverityBanner.spec.tsx:458-461`). Coupling the bell's RBAC
 *     semantics to that class would either (a) introduce a
 *     circular import between `notifications/` and `incidents/`
 *     modules or (b) require the bell to import from
 *     `incidents/KanbanRbacDeniedError` — a leaky boundary.
 *
 *   - The shared invariant is "throw the same HTTP status (403)";
 *     the class identity is per-module. A new class is 5 lines
 *     and keeps the modules decoupled.
 *
 *   - The `name` field MUST stay stable — both the bell's
 *     `useQuery` error assertion in `useNotificationBell.spec.ts`
 *     and any future cross-module error-class check rely on it.
 */
export class NotificationsRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/notifications");
    this.name = "NotificationsRbacDeniedError";
  }
}
