/**
 * RbacRoute — Surakkha web (Story 1.6).
 *
 * Route-level gate that consults the same `NAV_GROUPS` role list the
 * sidebar hides by. On a direct URL hit for a path the current role
 * cannot reach, it renders <RbacDenied /> instead of the wrapped
 * children.
 *
 * Why a thin wrapper (and not a `<Navigate>` redirect): EXPERIENCE.md
 * §RBAC denied mandates a calm empty state, not a redirect — the user
 * typed the URL and deserves to see *why* it didn't work, plus a
 * link back to /dashboard.
 *
 * The server-side authoritative check is Story 1.5's RBAC middleware;
 * this client gate is the visible mirror. Story 1.7's interceptor
 * also routes 403 responses to the same <RbacDenied /> surface.
 */
import { type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";

import { useCurrentRole } from "../auth/CurrentRoleContext";
import { isPathAllowedForRole, NAV_GROUPS } from "../shell/nav";

import { RbacDenied } from "./RbacDenied";

export const RbacRoute = ({ children }: PropsWithChildren) => {
  const role = useCurrentRole();
  const location = useLocation();
  const allowed = isPathAllowedForRole(
    NAV_GROUPS,
    location.pathname,
    role,
  );
  if (allowed) return <>{children}</>;
  return <RbacDenied />;
};