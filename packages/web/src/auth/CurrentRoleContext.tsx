/**
 * CurrentRole context — Surakkha web (Story 1.6, 1.7).
 *
 * Provides the authenticated user's role + userId to the route tree.
 * Story 1.6 introduced the context with a static `initialRole` prop.
 * Story 1.7 wires it to the live access token: the role + userId are
 * decoded from the JWT held in the tokenStore and the context
 * subscribes to token changes so a fresh login updates the nav
 * immediately.
 *
 * Wire contract:
 *   - `<CurrentRoleProvider>` wraps the AppShell tree (no props —
 *     the role comes from the tokenStore).
 *   - `<CurrentRoleProvider initialRole={...} initialUserId={...}>`
 *     are test-only escape hatches that override the live values.
 *     Story 1.6 / 1.8 tests use them to render a specific role + id
 *     without going through login.
 *   - `useCurrentRole()` returns `Role | null` from the nearest
 *     provider. Returns `null` when no access token is present, which
 *     is the "unauthenticated" state — the route gate then renders
 *     `<RbacDenied />` or redirects to `/login` via the apiClient
 *     interceptor.
 *   - `useCurrentUserId()` returns `string | null` from the nearest
 *     provider. The hook is the seam Story 4.12 uses to thread the
 *     authenticated user id through the Kanban socket helper
 *     (`useKanbanBoardSocket.ts`) so the helper can enforce the
 *     `assignee_user_id === self` filter on `incident:state_changed`
 *     for Technician viewers.
 */
import { type Role } from "@surakkha/shared/rbac";
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react";

import { decodeAccessToken } from "./jwtDecode";
import { useTokenStore } from "./tokenStore";

export interface CurrentRoleContextValue {
  readonly role: Role | null;
  /**
   * Story 4.12 — the authenticated user's id (the JWT `sub`).
   * `null` when no access token is present (unauthenticated).
   * Used by helpers that need the actor's stable id (e.g. the
   * Kanban socket's `TECH_FILTER_DROP` guard).
   */
  readonly userId: string | null;
}

const CurrentRoleContext = createContext<CurrentRoleContextValue>({
  role: null,
  userId: null,
});

interface LiveAuth {
  readonly role: Role | null;
  readonly userId: string | null;
}

const readLiveAuth = (): LiveAuth => {
  const token = useTokenStore.getState().accessToken;
  if (token === null) return { role: null, userId: null };
  const decoded = decodeAccessToken(token);
  return { role: decoded.role, userId: decoded.userId };
};

export interface CurrentRoleProviderProps extends PropsWithChildren {
  /**
   * Test-only override for the live role. When provided, this value
   * wins over the tokenStore; production callers leave it unset.
   */
  readonly initialRole?: Role | null;
  /**
   * Story 4.12 — test-only override for the live userId. When
   * provided, this value wins over the tokenStore; production
   * callers leave it unset. Mirrors `initialRole`'s pattern so the
   * two test-only escape hatches share an `initial*` naming
   * convention.
   */
  readonly initialUserId?: string | null;
}

export const CurrentRoleProvider = ({
  initialRole,
  initialUserId,
  children,
}: CurrentRoleProviderProps) => {
  const [live, setLive] = useState<LiveAuth>(() => readLiveAuth());

  useEffect(() => {
    if (initialRole !== undefined || initialUserId !== undefined) return;
    setLive(readLiveAuth());
    const unsubscribe = useTokenStore.subscribe(() => {
      setLive(readLiveAuth());
    });
    return unsubscribe;
  }, [initialRole, initialUserId]);

  const role: Role | null = initialRole === undefined ? live.role : initialRole;
  const userId: string | null = initialUserId === undefined ? live.userId : initialUserId;
  return (
    <CurrentRoleContext.Provider value={{ role, userId }}>{children}</CurrentRoleContext.Provider>
  );
};

export const useCurrentRole = (): Role | null => useContext(CurrentRoleContext).role;

/**
 * Story 4.12 — the authenticated user's stable id, or `null` when
 * no access token is present. Mirrors `useCurrentRole` so callers
 * that need both values can subscribe independently (each hook
 * returns a primitive so React's reference-equality bail-out
 * keeps re-renders cheap).
 */
export const useCurrentUserId = (): string | null => useContext(CurrentRoleContext).userId;
