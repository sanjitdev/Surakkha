/**
 * Tagged 404 error for the detail page. The page's `isError`
 * branch renders `<NotFound />` on this class; 5xx / generic
 * paths stay separate.
 */
export class IncidentDetailNotFoundError extends Error {
  constructor() {
    super("incident not found");
    this.name = "IncidentDetailNotFoundError";
  }
}
