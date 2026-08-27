/**
 * `IncidentDetailNotFoundError.ts` — Story 4.4.
 *
 * Tagged error for not-found responses on the detail page.
 * Distinct from a generic `Error` so the parent page can
 * render `<NotFound />` for 404s while keeping the generic
 * 500/empty path separate.
 */
export class IncidentDetailNotFoundError extends Error {
  constructor() {
    super("incident not found");
    this.name = "IncidentDetailNotFoundError";
  }
}
