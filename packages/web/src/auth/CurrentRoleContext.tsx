/**
 * CurrentRole context — Surakkha web (Story 1.6).
 *
 * Provides the authenticated user's role to the route tree. Story 1.6
 * uses a stub provider (no real auth yet) so the route gate can render
 * <RbacDenied /> for direct URL hits; Story 1.4 + 1.7 wire the real
 * sign-in flow and update the provider with the JWT-decoded role.
 *
 * Wire contract:
 *   - `<CurrentRoleProvider role={...}>` wraps the AppShell tree
 *   - `useCurrentRole()` returns `Role | null` from the nearest provider
 *   - Default value is `null` so tests / unauthenticated callers
 *     degrade to "no role" rather than "every role"
 */
import { type Role } from "@surakkha/shared/rbac";
import { createContext, type PropsWithChildren, useContext } from "react";

export interface CurrentRoleContextValue {
  readonly role: Role | null;
}

const CurrentRoleContext = createContext<CurrentRoleContextValue>({
  role: null,
});

export interface CurrentRoleProviderProps extends PropsWithChildren {
  readonly initialRole: Role | null;
}

export const CurrentRoleProvider = ({
  initialRole,
  children,
}: CurrentRoleProviderProps) => (
  <CurrentRoleContext.Provider value={{ role: initialRole }}>
    {children}
  </CurrentRoleContext.Provider>
);

export const useCurrentRole = (): Role | null =>
  useContext(CurrentRoleContext).role;