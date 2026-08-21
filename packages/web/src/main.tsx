/**
 * Surakkha web — entry point.
 *
 * The router boots the unauthenticated /login surface (Story 1.3) for
 * every visitor; Story 1.4 wires the auth state, Story 1.7 wires the
 * redirect-with-next param, and the AppShell takes over after a
 * successful sign-in.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
