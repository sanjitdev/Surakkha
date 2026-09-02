/**
 * Tagged 403 error for the detail page. The parent fetch maps
 * a 403 response to this class; the page's `isError` branch
 * renders `<RbacDenied />`.
 */
export class IncidentDetailRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/incidents/:id");
    this.name = "IncidentDetailRbacDeniedError";
  }
}
