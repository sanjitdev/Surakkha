/**
 * RBAC-denied empty state. Renders a calm `main` with the 403-style
 * message and a back-link whose destination depends on the viewer's
 * role (Technician → /devices; Admin / Operator / Viewer → /dashboard).
 * The back-link is overridable; explicit `backHref` / `backLabel` win
 * over the role-aware default.
 */
import { type Role } from "@surakkha/shared/rbac";
import { Link } from "react-router-dom";

export const RBAC_DENIED_MESSAGE = "You don't have access to this page. Contact an Admin.";

const ROLE_BACK_LABEL: Readonly<Record<Role, { readonly href: string; readonly label: string }>> = {
  Admin: { href: "/dashboard", label: "Back to dashboard" },
  Operator: { href: "/dashboard", label: "Back to dashboard" },
  Technician: { href: "/devices", label: "Back to devices" },
  Viewer: { href: "/dashboard", label: "Back to dashboard" },
};

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
  readonly viewerRole?: Role | null;
}

export const RbacDenied = ({
  headline = "Access denied",
  message = RBAC_DENIED_MESSAGE,
  backHref,
  backLabel,
  viewerRole,
}: RbacDeniedProps) => {
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
