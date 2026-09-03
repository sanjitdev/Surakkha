/**
 * SPA entry. Boots `<LoginShell />` (renders `/login`), wires the
 * router, and gates admin / auditor routes through `<RbacRoute>` so
 * a direct URL hit by a non-permitted role renders `<RbacDenied />`.
 * `configureApiClient` runs once on mount with the router's navigate.
 *
 * Route tree (nested):
 *   /login                 → LoginRoute (public)
 *   <RequireAuth/>         → auth gate (token present + not expired)
 *     <ProtectedShell/>    → CurrentRoleProvider + AppShell (mounts ONCE)
 *       /                  → Dashboard
 *       /dashboard         → Dashboard
 *       /severity-cards    → SeverityCards
 *       /sensors           → PageStub
 *       /incidents         → KanbanBoard
 *       /incidents/:id     → IncidentDetailPage
 *       /alerts            → PageStub
 *       /reports           → RbacRoute → PageStub
 *       /audit             → RbacRoute → AuditLogPage
 *       /admin/simulator   → RbacRoute → SimulatorPage
 *       /admin/notifications → RbacRoute → AdminNotificationsPage
 *       /admin/thresholds  → RbacRoute → ThresholdsPage
 *       /admin/users       → RbacRoute → PageStub
 *       /admin/schools     → RbacRoute → PageStub
 *       * (authed)         → Navigate to /dashboard
 *   * (unauthed)           → Navigate to /login
 *
 * `apiOrigin = ""` means same-origin; Vite / nginx proxies `/auth/`
 * and `/api/` to the api. A non-empty origin would double-prefix
 * (`/api/auth/login`).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { RbacRoute } from "./access/RbacRoute";
import { SimulatorPage } from "./admin/simulator/SimulatorPage";
import { ThresholdsPage } from "./admin/thresholds/ThresholdsPage";
import { AdminNotificationsPage } from "./admin-notifications/AdminNotificationsPage";
import { apiLogin, configureApiClient } from "./api/apiClient";
import { AuditLogPage } from "./audit-log/AuditLogPage";
import { LoginShell } from "./auth/LoginShell";
import { RequireAuth } from "./auth/RequireAuth";
import { KpiStat } from "./components/KpiStat";
import { Dashboard } from "./dashboard/Dashboard";
import { IncidentDetailPage } from "./incidents/IncidentDetailPage";
import { KanbanBoard } from "./incidents/KanbanBoard";
import { queryClient } from "./queryClient";
import { ProtectedShell } from "./shell/ProtectedShell";

import "./index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element #root not found in index.html");
}

const PageStub = ({ name }: { readonly name: string }) => (
  <div data-testid={`page-stub-${name.toLowerCase()}`}>
    <h1 className="text-2xl font-semibold text-neutral-body">{name}</h1>
    <p className="mt-2 text-md text-neutral-secondary">
      Story roadmap wires this surface in a later slice.
    </p>
  </div>
);

/** Severity palette preview (4 cards) — verifies the saturated palette
 *  + critical pulse are wired end-to-end. */
const SeverityCards = () => (
  <div data-testid="severity-cards">
    <h1 className="mb-4 text-2xl font-semibold text-neutral-body">Severity palette</h1>
    <p className="mb-6 text-md text-neutral-secondary">
      Sample KpiStat cards — verifies the saturated palette and the critical pulse.
    </p>
    <div data-testid="severity-cards-grid" className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2">
      <KpiStat severity="healthy" label="pH" value="7.2" sub="in range" />
      <KpiStat severity="warning" label="Turbidity" value="4.8 NTU" sub="watch" />
      <KpiStat severity="critical" label="TDS" value="610 ppm" sub="out of range" />
      <KpiStat severity="offline" label="Signal" value="— " sub="last seen 4h ago" />
    </div>
  </div>
);

const API_ORIGIN = "";
const HTTP_UNAUTHORIZED = 401;

/** Resolve the post-login destination. Prefer `state.from` (set by
 *  `<RequireAuth />` when it bounces an unauthenticated visitor).
 *  Fall back to `?next=` from the URL query string (open-redirect
 *  guarded). Default to `/dashboard` when neither is usable. */
const resolveNextPath = (stateFrom: unknown, search: string): string => {
  if (typeof stateFrom === "string" && stateFrom.startsWith("/") && !stateFrom.startsWith("//")) {
    return stateFrom;
  }
  const params = new URLSearchParams(search);
  const next = params.get("next");
  if (next !== null && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/dashboard";
};

const LoginRoute = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    configureApiClient({
      apiOrigin: API_ORIGIN,
      navigate: (path) => navigate(path),
      onOffline: () => {
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
    const safeNext = resolveNextPath(location.state?.from, location.search);
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
          <Route element={<RequireAuth />}>
            <Route element={<ProtectedShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/severity-cards" element={<SeverityCards />} />
              <Route path="/sensors" element={<PageStub name="Sensors" />} />
              <Route path="/incidents" element={<KanbanBoard />} />
              <Route path="/incidents/:id" element={<IncidentDetailPage />} />
              <Route path="/alerts" element={<PageStub name="Alerts" />} />
              <Route
                path="/reports"
                element={
                  <RbacRoute>
                    <PageStub name="Reports" />
                  </RbacRoute>
                }
              />
              <Route
                path="/audit"
                element={
                  <RbacRoute>
                    <AuditLogPage />
                  </RbacRoute>
                }
              />
              <Route
                path="/admin/simulator"
                element={
                  <RbacRoute>
                    <SimulatorPage />
                  </RbacRoute>
                }
              />
              <Route
                path="/admin/notifications"
                element={
                  <RbacRoute>
                    <AdminNotificationsPage />
                  </RbacRoute>
                }
              />
              <Route
                path="/admin/thresholds"
                element={
                  <RbacRoute>
                    <ThresholdsPage />
                  </RbacRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <RbacRoute>
                    <PageStub name="Users" />
                  </RbacRoute>
                }
              />
              <Route
                path="/admin/schools"
                element={
                  <RbacRoute>
                    <PageStub name="Schools" />
                  </RbacRoute>
                }
              />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
