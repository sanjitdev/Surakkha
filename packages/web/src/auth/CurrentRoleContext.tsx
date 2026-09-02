/**
 * `CurrentRoleContext` — provides the authenticated user's role +
 * userId to the route tree. Subscribes to the tokenStore so a fresh
 * login updates the nav immediately. `initialRole` / `initialUserId`
 * are test-only escape hatches that override the live values.
 */
import { type Role } from "@surakkha/shared/rbac";
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react";

import { decodeAccessToken } from "./jwtDecode";
import { useTokenStore } from "./tokenStore";

export interface CurrentRoleContextValue {
  readonly role: Role | null;
  /** The JWT `sub` claim. `null` when no access token is present. */
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
  /** Test-only override for the live role. Production callers leave unset. */
  readonly initialRole?: Role | null;
  /** Test-only override for the live userId. Mirrors `initialRole`. */
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

/** The authenticated user's stable id (`sub`), or `null` if no access token. */
export const useCurrentUserId = (): string | null => useContext(CurrentRoleContext).userId;
