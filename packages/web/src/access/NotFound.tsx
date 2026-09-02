/**
 * 404 not-found empty state. Mirrors `RbacDenied`'s visual language
 * but carries different operator copy: 404 routes back to the
 * index, RBAC routes back to the role's key journey surface.
 * `headline` / `message` / `backHref` / `backLabel` are overridable
 * so future per-entity 404s (devices, alerts) can localise without
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
