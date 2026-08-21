/**
 * Surakkha web — entry point.
 *
 * The router boots the unauthenticated /login surface (Story 1.3) for
 * every visitor; Story 1.4 wires the auth state, Story 1.7 wires the
 * redirect-with-next param, and the AppShell takes over after a
 * successful sign-in.
 *
 * Story 1.6 wiring:
 *   - `CurrentRoleProvider` wraps the authenticated routes. The stub
 *     role is `null` until Story 1.4 lands the real sign-in flow.
 *   - Operate- and Admin-gated routes (`/reports`, `/audit`, `/admin/*`)
 *     are wrapped in `<RbacRoute>` so a direct URL hit renders
 *     `<RbacDenied />` for a role that lacks the permission.
 *   - Monitor routes are unguarded — any authenticated role can read.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { RbacRoute } from "./access/RbacRoute";
import { CurrentRoleProvider } from "./auth/CurrentRoleContext";
import { LoginShell } from "./auth/LoginShell";
import { AppShell } from "./shell/AppShell";

import "./index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element #root not found in index.html");
}

/**
 * Stub dashboard — Story 1.7 replaces with the real KPI band + map +
 * live readings. Keeping a single placeholder route so the shell has
 * something to render inside `<Outlet />`.
 */
const DashboardStub = () => (
  <div data-testid="dashboard-stub">
    <h1 className="text-2xl font-semibold text-neutral-body">Dashboard</h1>
    <p className="mt-2 text-md text-neutral-secondary">
      Story 1.7 fills this in with the KPI band + map + live readings.
    </p>
  </div>
);

/**
 * Generic page placeholder for routes whose content lives in later
 * stories. Renders a quiet stub so the shell has the right vertical
 * rhythm and the test suite can assert the route renders without
 * crashing.
 */
const PageStub = ({ name }: { readonly name: string }) => (
  <div data-testid={`page-stub-${name.toLowerCase()}`}>
    <h1 className="text-2xl font-semibold text-neutral-body">{name}</h1>
    <p className="mt-2 text-md text-neutral-secondary">
      Story roadmap wires this surface in a later slice.
    </p>
  </div>
);

/**
 * Stub submit handler for Story 1.3. Story 1.4 replaces this with a
 * real `POST /auth/login` call; the contract (`(email, password) =>
 * Promise<void>`) is the boundary the LoginShell already speaks.
 */
const STUB_SIGN_IN_LATENCY_MS = 250;
const STUB_SIGN_IN = async (_email: string, _password: string): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, STUB_SIGN_IN_LATENCY_MS));
  throw new Error("Sign-in is not available in this build.");
};

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginShell onSubmit={STUB_SIGN_IN} />} />
        <Route
          path="/"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <DashboardStub />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/dashboard"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <DashboardStub />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/sensors"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <PageStub name="Sensors" />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/incidents"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <PageStub name="Incidents" />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/alerts"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <PageStub name="Alerts" />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/reports"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <RbacRoute>
                  <PageStub name="Reports" />
                </RbacRoute>
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/audit"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <RbacRoute>
                  <PageStub name="Audit" />
                </RbacRoute>
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/admin/simulator"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <RbacRoute>
                  <PageStub name="Simulator" />
                </RbacRoute>
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/admin/notifications"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <RbacRoute>
                  <PageStub name="Notifications" />
                </RbacRoute>
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/admin/thresholds"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <RbacRoute>
                  <PageStub name="Thresholds" />
                </RbacRoute>
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/admin/users"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <RbacRoute>
                  <PageStub name="Users" />
                </RbacRoute>
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/admin/schools"
          element={
            <CurrentRoleProvider initialRole={null}>
              <AppShell>
                <RbacRoute>
                  <PageStub name="Schools" />
                </RbacRoute>
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);