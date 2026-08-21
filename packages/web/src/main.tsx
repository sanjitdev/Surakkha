/**
 * Surakkha web — entry point.
 *
 * The router boots the unauthenticated /login surface (Story 1.3) for
 * every visitor; Story 1.4 + 1.7 wire the auth state and the
 * redirect-with-next param, and the AppShell takes over after a
 * successful sign-in.
 *
 * Story 1.6 wiring:
 *   - `CurrentRoleProvider` wraps the authenticated routes and reads
 *     the role from the access token (Story 1.7: decoded from the
 *     JWT held in the tokenStore, no prop needed).
 *   - Operate- and Admin-gated routes (`/reports`, `/audit`, `/admin/*`)
 *     are wrapped in `<RbacRoute>` so a direct URL hit renders
 *     `<RbacDenied />` for a role that lacks the permission.
 *   - Monitor routes are unguarded — any authenticated role can read.
 *
 * Story 1.7 wiring:
 *   - `configureApiClient()` runs once on mount with the router's
 *     navigate + a no-op `onOffline` (the real offline surface lands
 *     in Story 2.9, AC: "Connection State + Offline UX").
 *   - `signIn(email, password)` POSTs to /auth/login via the apiClient,
 *     on success navigates to `?next=<path>` (default /dashboard).
 *   - The `*` catch-all redirects to /login when no route matches.
 */

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";

import { RbacRoute } from "./access/RbacRoute";
import { apiLogin, configureApiClient } from "./api/apiClient";
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
 * The default api origin. In the docker-compose stack (Story 6.1)
 * the web container reaches the api over the internal network at
 * `http://api:3000`. In `vite dev` the Vite proxy forwards `/auth/*`
 * and `/api/*` to `http://localhost:3000`; for the browser to see
 * the cookie set with `Path=/auth`, we hit the same origin (Vite
 * proxies it). v1 keeps this single origin — no CORS dance.
 */
const API_ORIGIN = "/api";
const HTTP_UNAUTHORIZED = 401;

/**
 * Sign-in handler for the LoginShell. Reads `?next=` from the URL so
 * a 401-driven redirect can land the user back where they were
 * (Story 1.7 AC2). On 401 we surface a friendly inline error.
 *
 * The apiLogin helper stores the access token in the tokenStore; the
 * CurrentRoleProvider re-renders automatically and the AppShell
 * picks up the new role on the next render cycle.
 */
const LoginRoute = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Configure the apiClient with the router's navigate + the
    // (currently no-op) offline callback. The real offline surface
    // lands in Story 2.9.
    configureApiClient({
      apiOrigin: API_ORIGIN,
      navigate: (path) => navigate(path),
      onOffline: () => {
        // TODO(Story 2.9): replace with the UX-DR-11 offline banner.
        // For now we log so an integration test can assert the call.
        console.warn("Surakkha: offline detected during token refresh");
      },
    });
  }, [navigate]);

  const handleSubmit = async (email: string, password: string): Promise<void> => {
    const res = await apiLogin(email, password);
    if (!res.ok) {
      if (res.status === HTTP_UNAUTHORIZED) {
        throw new Error("Invalid email or password.");
      }
      throw new Error("Sign-in is not available. Try again later.");
    }
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const safeNext =
      next !== null && next.startsWith("/") && !next.startsWith("//")
        ? next
        : "/dashboard";
    navigate(safeNext, { replace: true });
  };

  return <LoginShell onSubmit={handleSubmit} />;
};

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          path="/"
          element={
            <CurrentRoleProvider>
              <AppShell>
                <DashboardStub />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/dashboard"
          element={
            <CurrentRoleProvider>
              <AppShell>
                <DashboardStub />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/sensors"
          element={
            <CurrentRoleProvider>
              <AppShell>
                <PageStub name="Sensors" />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/incidents"
          element={
            <CurrentRoleProvider>
              <AppShell>
                <PageStub name="Incidents" />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/alerts"
          element={
            <CurrentRoleProvider>
              <AppShell>
                <PageStub name="Alerts" />
              </AppShell>
            </CurrentRoleProvider>
          }
        />
        <Route
          path="/reports"
          element={
            <CurrentRoleProvider>
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
            <CurrentRoleProvider>
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
            <CurrentRoleProvider>
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
            <CurrentRoleProvider>
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
            <CurrentRoleProvider>
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
            <CurrentRoleProvider>
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
            <CurrentRoleProvider>
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