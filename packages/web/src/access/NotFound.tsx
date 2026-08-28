/**
 * 404 not-found empty state — Surakkha web (Story 4.4).
 *
 * The detail-page (and any future per-entity page that loads by id)
 * surfaces this component when the api returns 404. Mirrors the
 * `RbacDenied` shape from `access/RbacDenied.tsx` so the two
 * empty-state pages share the same visual language; differs in
 * copy (no RBAC framing — the user is authenticated, just looking
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

const PAGE_BG = "#F5F7F9";
const CARD_BG = "#FFFFFF";
const BORDER = "#E2E8F0";
const HEADLINE = "#0F172A";
const SECONDARY = "#475569";
const PRIMARY = "#1E5BB8";

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
    className="flex min-h-[60vh] items-center justify-center"
    style={{ backgroundColor: PAGE_BG }}
  >
    <article
      data-testid="not-found-card"
      className="max-w-md rounded-card border p-8 text-center"
      style={{
        backgroundColor: CARD_BG,
        borderColor: BORDER,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      <h1 className="text-xl font-semibold" style={{ color: HEADLINE }}>
        {headline}
      </h1>
      <p className="mt-3 text-md" style={{ color: SECONDARY }}>
        {message}
      </p>
      <Link
        to={backHref}
        data-testid="not-found-back-link"
        className="mt-6 inline-flex items-center gap-2 rounded-input px-4 py-2 text-md font-medium text-white no-underline focus:outline-none"
        style={{
          backgroundColor: PRIMARY,
        }}
      >
        {backLabel}
      </Link>
    </article>
  </main>
);
