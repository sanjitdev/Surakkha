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
 *
 * Story 6.11 — Riley persona fix. The previous default back-label
 * was "Back to dashboard" for every role; a Viewer who arrived from
 * a deep link into /admin/notifications would land on a generic
 * back-link that didn't reflect their actual nav surface (they may
 * never have visited /dashboard). The `viewerRole` prop lets the
 * caller pass `useCurrentRole()` so the label picks the destination
 * the role actually has — Admins/Operators land on `/dashboard`,
 * Technicians land on `/devices` (their key journey surface), and
 * the fallback stays `/dashboard` when no role is known.
 */
import { type Role } from "@surakkha/shared/rbac";
import { Link } from "react-router-dom";

export const RBAC_DENIED_MESSAGE = "You don't have access to this page. Contact an Admin.";

/**
 * Map the viewer's role to the surface they actually navigate
 * from. Key journeys per EXPERIENCE.md §Personas — Technicians
 * live on /devices; Operators and Viewers on /dashboard. Admins
 * are ops-and-overview, also /dashboard.
 */
const ROLE_BACK_LABEL: Readonly<Record<Role, { readonly href: string; readonly label: string }>> = {
  Admin: { href: "/dashboard", label: "Back to dashboard" },
  Operator: { href: "/dashboard", label: "Back to dashboard" },
  Technician: { href: "/devices", label: "Back to devices" },
  Viewer: { href: "/dashboard", label: "Back to dashboard" },
};

/**
 * Resolve the back-link destination. Explicit props win (Kanban /
 * IncidentDetail pass their own); the role-aware table is the
 * default; the hard-coded `/dashboard` + "Back to dashboard"
 * is the final fallback for legacy / unauthenticated callers.
 *
 * Extracted so the parent `RbacDenied` body stays under the
 * `complexity: 10` ESLint ceiling — the prop destructure alone
 * pushes the inline version over.
 */
const DEFAULT_BACK_HREF = "/dashboard";
const DEFAULT_BACK_LABEL = "Back to dashboard";

const resolveBackTarget = (
  explicitHref: string | undefined,
  explicitLabel: string | undefined,
  role: Role | null | undefined,
): { readonly href: string; readonly label: string } => {
  const roleBack = role !== undefined && role !== null ? ROLE_BACK_LABEL[role] : undefined;
  return {
    href: explicitHref ?? roleBack?.href ?? DEFAULT_BACK_HREF,
    label: explicitLabel ?? roleBack?.label ?? DEFAULT_BACK_LABEL,
  };
};

export interface RbacDeniedProps {
  readonly headline?: string;
  readonly message?: string;
  readonly backHref?: string;
  readonly backLabel?: string;
  /**
   * Story 6.11 — the viewer's role (sourced from `useCurrentRole()`).
   * When provided, the back-link uses the role-aware destination;
   * when omitted (legacy callers, tests), the back-link defaults
   * to the generic `/dashboard` "Back to dashboard" copy.
   */
  readonly viewerRole?: Role | null;
}

export const RbacDenied = ({
  headline = "Access denied",
  message = RBAC_DENIED_MESSAGE,
  backHref,
  backLabel,
  viewerRole,
}: RbacDeniedProps) => {
  // Role-aware default (Story 6.11); callers that pass an explicit
  // backHref/backLabel (the Kanban / IncidentDetail override paths)
  // keep their custom destination. The role lookup is a no-op when
  // the role is null/undefined — falls back to the previous defaults.
  // Extracted to a helper so the parent component's complexity stays
  // under the lint ceiling (the prop destructure alone pushes us
  // over the limit if the resolver is inline).
  const { href: resolvedBackHref, label: resolvedBackLabel } = resolveBackTarget(
    backHref,
    backLabel,
    viewerRole,
  );
  return (
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
          to={resolvedBackHref}
          data-testid="rbac-denied-back-link"
          className="rbac-denied-back mt-6 inline-flex items-center gap-2 rounded-input bg-primary px-4 py-2 text-md font-medium text-white no-underline hover:bg-primary-hover focus:outline-none"
        >
          {resolvedBackLabel}
        </Link>
      </article>
    </main>
  );
};
