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

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { RbacRoute } from "./access/RbacRoute";
import { SimulatorPage } from "./admin/simulator/SimulatorPage";
import { ThresholdsPage } from "./admin/thresholds/ThresholdsPage";
import { apiLogin, configureApiClient } from "./api/apiClient";
import { CurrentRoleProvider } from "./auth/CurrentRoleContext";
import { LoginShell } from "./auth/LoginShell";
import { KpiStat } from "./components/KpiStat";
import { Dashboard } from "./dashboard/Dashboard";
import { KanbanBoard } from "./incidents/KanbanBoard";
import { queryClient } from "./queryClient";
import { AppShell } from "./shell/AppShell";

import "./index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element #root not found in index.html");
}

/**
 * Stub dashboard — removed in Story 2.6; the real `<Dashboard />`
 * four-region shell now renders inside `<AppShell>`. Keeping the
 * old identifier only as a story-history note.
 */

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
 * SeverityCards — Story 1.9 / AC1 + AC3.
 *
 * The "the authenticated shell mounts" surface. Renders one KpiStat per
 * severity so a reviewer can verify the saturated palette, the
 * critical pulse, and the per-severity numeral sizes are wired
 * end-to-end. The grid is `grid-cols-4` at the desktop breakpoint and
 * collapses to `grid-cols-1` on mobile so the cards are inspectable
 * at every viewport.
 */
const SeverityCards = () => (
  <div data-testid="severity-cards">
    <h1 className="mb-4 text-2xl font-semibold text-neutral-body">Severity palette</h1>
    <p className="mb-6 text-md text-neutral-secondary">
      Sample KpiStat cards — Story 1.9 verifies the saturated palette and the critical pulse.
    </p>
    <div data-testid="severity-cards-grid" className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2">
      <KpiStat severity="healthy" label="pH" value="7.2" sub="in range" />
      <KpiStat severity="warning" label="Turbidity" value="4.8 NTU" sub="watch" />
      <KpiStat severity="critical" label="TDS" value="610 ppm" sub="out of range" />
      <KpiStat severity="offline" label="Signal" value="— " sub="last seen 4h ago" />
    </div>
  </div>
);

/**
 * The default api origin. In the docker-compose stack (Story 6.1)
 * the web container reaches the api over the internal network at
 * `http://api:3000`. In `vite dev` the Vite proxy forwards `/auth/*`
 * and `/api/*` to `http://localhost:3000`; for the browser to see
 * the cookie set with `Path=/auth`, the SPA must hit the SAME
 * origin (Vite / nginx proxies it). v1 keeps this single origin —
 * no CORS dance.
 *
 * Empty string means "same origin". The apiClient then prepends
 * `""` to call paths like `/auth/login`, `/api/readings/latest`,
 * `/api/devices`, `/admin/simulator/status`, etc. The previous
 * value `"/api"` broke `/auth/login` by emitting `/api/auth/login`
 * (the api has no such route — it lives at `/auth/login`), and
 * broke the `/api/*` paths by emitting `/api/api/readings/latest`.
 * The nginx config (web/nginx.conf) proxies `/auth/` and `/api/`
 * separately to `http://api:3000`.
 */
const API_ORIGIN = "";
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
      next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    navigate(safeNext, { replace: true });
  };

  return <LoginShell onSubmit={handleSubmit} />;
};

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/"
            element={
              <CurrentRoleProvider>
                <AppShell>
                  <Dashboard />
                </AppShell>
              </CurrentRoleProvider>
            }
          />
          <Route
            path="/dashboard"
            element={
              <CurrentRoleProvider>
                <AppShell>
                  <Dashboard />
                </AppShell>
              </CurrentRoleProvider>
            }
          />
          <Route
            path="/severity-cards"
            element={
              <CurrentRoleProvider>
                <AppShell>
                  <SeverityCards />
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
                  {/* Story 4.3 — the real Kanban board replaces the
                      PageStub. The `KanbanBoard` mounts its own
                      socket subscription (page-scoped) and TanStack
                      Query (cache key `["incidents", "active"]`). */}
                  <KanbanBoard />
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
                    <SimulatorPage />
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
                    <ThresholdsPage />
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
    </QueryClientProvider>
  </StrictMode>,
);
