/**
 * Tagged 403 error for the active-list fetch path. Both the
 * Kanban board's `queryFn` and the SeverityBanner's `queryFn`
 * throw this class so the cache's error type is stable across
 * consumers. `.name` field must stay stable for `instanceof`
 * checks at the render branch.
 */
export class KanbanRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/incidents/active");
    this.name = "KanbanRbacDeniedError";
  }
}
