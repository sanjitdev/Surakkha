/**
 * CurrentRole context — Surakkha web (Story 1.6, 1.7).
 *
 * Provides the authenticated user's role to the route tree.
 * Story 1.6 introduced the context with a static `initialRole` prop.
 * Story 1.7 wires it to the live access token: the role is decoded
 * from the JWT held in the tokenStore and the context subscribes to
 * token changes so a fresh login updates the nav immediately.
 *
 * Wire contract:
 *   - `<CurrentRoleProvider>` wraps the AppShell tree (no props —
 *     the role comes from the tokenStore).
 *   - `<CurrentRoleProvider initialRole={...}>` is a test-only escape
 *     hatch that overrides the live role. Story 1.6 / 1.8 tests use
 *     it to render a specific role without going through login.
 *   - `useCurrentRole()` returns `Role | null` from the nearest
 *     provider. Returns `null` when no access token is present, which
 *     is the "unauthenticated" state — the route gate then renders
 *     `<RbacDenied />` or redirects to `/login` via the apiClient
 *     interceptor.
 */
import { type Role } from "@surakkha/shared/rbac";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

import { decodeAccessToken } from "./jwtDecode";
import { useTokenStore } from "./tokenStore";

export interface CurrentRoleContextValue {
  readonly role: Role | null;
}

const CurrentRoleContext = createContext<CurrentRoleContextValue>({
  role: null,
});

const readLiveRole = (): Role | null => {
  const token = useTokenStore.getState().accessToken;
  if (token === null) return null;
  return decodeAccessToken(token).role;
};

export interface CurrentRoleProviderProps extends PropsWithChildren {
  /**
   * Test-only override for the live role. When provided, this value
   * wins over the tokenStore; production callers leave it unset.
   */
  readonly initialRole?: Role | null;
}

export const CurrentRoleProvider = ({
  initialRole,
  children,
}: CurrentRoleProviderProps) => {
  const [liveRole, setLiveRole] = useState<Role | null>(() => readLiveRole());

  useEffect(() => {
    if (initialRole !== undefined) return;
    setLiveRole(readLiveRole());
    const unsubscribe = useTokenStore.subscribe(() => {
      setLiveRole(readLiveRole());
    });
    return unsubscribe;
  }, [initialRole]);

  const role: Role | null = initialRole === undefined ? liveRole : initialRole;
  return (
    <CurrentRoleContext.Provider value={{ role }}>
      {children}
    </CurrentRoleContext.Provider>
  );
};

export const useCurrentRole = (): Role | null =>
  useContext(CurrentRoleContext).role;