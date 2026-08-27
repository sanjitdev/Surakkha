/**
 * `IncidentDetailRbacDeniedError.ts` — Story 4.4.
 *
 * Tagged error for RBAC denial on the detail page (mirrors
 * `KanbanRbacDeniedError` from `KanbanBoard.tsx`). The detail
 * page's parent fetch maps a 403 response to this tagged error
 * so the `isError` branch can render `<RbacDenied />` without
 * a separate `error` type union.
 */
export class IncidentDetailRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/incidents/:id");
    this.name = "IncidentDetailRbacDeniedError";
  }
}
