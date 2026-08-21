/**
 * Surakkha web — entry point.
 *
 * Story 1.3 (Login Shell) replaces the unauthenticated view. For now the
 * app boots into the authenticated layout shell (Story 1.2b) so the
 * sidebar/topbar is reachable from the first render. Auth state lands
 * in Story 1.4; the role prop is hardcoded to null today and Story 1.5
 * wires it from the JWT claims.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

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

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <AppShell currentRole={null}>
              <DashboardStub />
            </AppShell>
          }
        />
        <Route
          path="/dashboard"
          element={
            <AppShell currentRole={null}>
              <DashboardStub />
            </AppShell>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
