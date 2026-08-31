/**
 * RBAC denied empty state — Surakkha web (Story 1.6).
 *
 * Visual + behavioural contract: EXPERIENCE.md §RBAC denied — "full-page
 * empty state with a 403-style message: 'You don't have access to this
 * page. Contact an Admin.' and a link back to /dashboard."
 *
 * Rendered in two cases:
 *   1. The route is gated (per `nav.ts`) and the current role lacks
 *      the matching permission.
 *   2. Story 1.5's RBAC middleware on the api returns 403 and the SPA
 *      routes the response to this surface (wired in Story 1.7).
 *
 * Accessibility (EXPERIENCE.md §Accessibility Floor):
 *   - Semantic HTML: `<main>` wraps the content, `<h1>` is the headline
 *   - `role="status"` so the denied reason is announced politely
 *   - Visible focus ring on the back-link (`color.primary`, 2px, 2px
 *     offset — see `{accessibility.focus_ring}` in the design substrate)
 *   - Keyboard reachable: the link is the only interactive element
 *     and lands in the natural tab order
 *
 * The page intentionally avoids the word "403" in the rendered copy —
 * EXPERIENCE.md calls it "403-style" prose, not a literal status code,
 * because end users don't recognise the status. The server still
 * emits the canonical 403 (Story 1.5).
 */
import { Link } from "react-router-dom";

export const RBAC_DENIED_MESSAGE = "You don't have access to this page. Contact an Admin.";

export interface RbacDeniedProps {
  readonly headline?: string;
  readonly message?: string;
  readonly backHref?: string;
  readonly backLabel?: string;
}

export const RbacDenied = ({
  headline = "Access denied",
  message = RBAC_DENIED_MESSAGE,
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
}: RbacDeniedProps) => (
  <main
    data-testid="rbac-denied"
    role="status"
    aria-live="polite"
    className="flex min-h-[60vh] items-center justify-center bg-neutral-page"
  >
    <article className="max-w-md rounded-card border border-neutral-border bg-neutral-surface p-8 text-center shadow-elevation-topbar">
      <h1 className="text-xl font-semibold text-neutral-body">{headline}</h1>
      <p className="mt-3 text-md text-neutral-secondary">{message}</p>
      <Link
        to={backHref}
        data-testid="rbac-denied-back-link"
        className="rbac-denied-back mt-6 inline-flex items-center gap-2 rounded-input bg-primary px-4 py-2 text-md font-medium text-white no-underline hover:bg-primary-hover focus:outline-none"
      >
        {backLabel}
      </Link>
    </article>
  </main>
);
