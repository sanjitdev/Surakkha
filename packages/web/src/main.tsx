/**
 * SPA entry. Boots `<LoginShell />` (renders `/login`), wires the
 * router, and gates admin / auditor routes through `<RbacRoute>` so
 * a direct URL hit by a non-permitted role renders `<RbacDenied />`.
 * `configureApiClient` runs once on mount with the router's navigate.
 *
 * `apiOrigin = ""` means same-origin; Vite / nginx proxies `/auth/`
 * and `/api/` to the api. A non-empty origin would double-prefix
 * (`/api/auth/login`).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { RbacRoute } from "./access/RbacRoute";
import { SimulatorPage } from "./admin/simulator/SimulatorPage";
import { ThresholdsPage } from "./admin/thresholds/ThresholdsPage";
import { AdminNotificationsPage } from "./admin-notifications/AdminNotificationsPage";
import { apiLogin, configureApiClient } from "./api/apiClient";
import { AuditLogPage } from "./audit-log/AuditLogPage";
import { CurrentRoleProvider } from "./auth/CurrentRoleContext";
import { LoginShell } from "./auth/LoginShell";
import { KpiStat } from "./components/KpiStat";
import { Dashboard } from "./dashboard/Dashboard";
import { IncidentDetailPage } from "./incidents/IncidentDetailPage";
import { KanbanBoard } from "./incidents/KanbanBoard";
import { queryClient } from "./queryClient";
import { AppShell } from "./shell/AppShell";

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

const API_ORIGIN = "";
const HTTP_UNAUTHORIZED = 401;

const LoginRoute = () => {
  const navigate = useNavigate();

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
                  <KanbanBoard />
                </AppShell>
              </CurrentRoleProvider>
            }
          />
          <Route
            path="/incidents/:id"
            element={
              <CurrentRoleProvider>
                <AppShell>
                  <IncidentDetailPage />
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
                    <AuditLogPage />
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
                    <AdminNotificationsPage />
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
