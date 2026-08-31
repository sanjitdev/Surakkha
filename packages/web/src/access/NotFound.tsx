/**
 * 404 not-found empty state — Surakkha web (Story 4.4).
 *
 * The detail-page (and any future per-entity page that loads by id)
 * surfaces this component when the api returns 404. Mirrors the
 * `RbacDenied` shape from `access/RbacDenied.tsx` so the two
 * empty-state pages share the same visual language; differs in
 * copy (no RBAC framing — the user is authenticated and is looking
 * for an entity that doesn't exist).
 *
 * Why a dedicated component (and not a re-use of `RbacDenied`):
 * the 404 case is read-side ("the resource you asked for doesn't
 * exist"); the RBAC case is auth-side ("you can't see it"). They
 * carry different operator actions — 404 should send the user
 * back to the index; RBAC should send the user back to the
 * dashboard. Keeping them as separate components lets the future
 * 404 surfaces (e.g., a future device-detail page that also
 * 404s) reuse `NotFound` without inheriting the RBAC framing.
 *
 * The headline + message are overridable so the future "device
 * not found" / "alert not found" pages can localize without
 * copying the component.
 */
import { Link } from "react-router-dom";

export interface NotFoundProps {
  readonly headline?: string;
  readonly message?: string;
  readonly backHref?: string;
  readonly backLabel?: string;
}

export const NotFound = ({
  headline = "Not found",
  message = "The item you requested could not be found.",
  backHref = "/incidents",
  backLabel = "Back to incidents",
}: NotFoundProps) => (
  <main
    data-testid="not-found"
    role="status"
    aria-live="polite"
    className="flex min-h-[60vh] items-center justify-center bg-neutral-page"
  >
    <article className="max-w-md rounded-card border border-neutral-border bg-neutral-surface p-8 text-center shadow-elevation-topbar">
      <h1 className="text-xl font-semibold text-neutral-body">{headline}</h1>
      <p className="mt-3 text-md text-neutral-secondary">{message}</p>
      <Link
        to={backHref}
        data-testid="not-found-back-link"
        className="mt-6 inline-flex items-center gap-2 rounded-input bg-primary px-4 py-2 text-md font-medium text-white no-underline hover:bg-primary-hover focus:outline-none"
      >
        {backLabel}
      </Link>
    </article>
  </main>
);
