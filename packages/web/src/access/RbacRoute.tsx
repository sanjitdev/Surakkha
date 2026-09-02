/**
 * Route-level RBAC gate. Renders children when the viewer's role
 * is permitted for the current path (per `NAV_GROUPS`); otherwise
 * renders `<RbacDenied />` with a role-aware back-link.
 */
import { type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";

import { useCurrentRole } from "../auth/CurrentRoleContext";
import { isPathAllowedForRole, NAV_GROUPS } from "../shell/nav";

import { RbacDenied } from "./RbacDenied";

export const RbacRoute = ({ children }: PropsWithChildren) => {
  const role = useCurrentRole();
  const location = useLocation();
  const allowed = isPathAllowedForRole(NAV_GROUPS, location.pathname, role);
  if (allowed) return <>{children}</>;
  return <RbacDenied viewerRole={role} />;
};
