/**
 * Shared parent-route layout for every authenticated surface. Mounts
 * `CurrentRoleProvider` once per session so the `useTokenStore`
 * subscription in `CurrentRoleContext` binds once (not 13× per
 * navigation), and renders `AppShell` once so the sidebar's
 * `drawerOpen` state and breakpoint listener survive navigation.
 *
 * Replaces the duplicated `<CurrentRoleProvider><AppShell>` wrapper
 * that previously appeared inline in every `<Route element={…}>`
 * in `main.tsx`. `<Outlet />` mounts the matched child route inside
 * the AppShell canvas.
 */
import { Outlet } from "react-router-dom";

import { CurrentRoleProvider } from "../auth/CurrentRoleContext";

import { AppShell } from "./AppShell";

export const ProtectedShell = () => (
  <CurrentRoleProvider>
    <AppShell>
      <Outlet />
    </AppShell>
  </CurrentRoleProvider>
);
