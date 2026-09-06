/**
 * `ApiClientProvider` — single source of truth for the `apiClient`
 * configuration that lives OUTSIDE the login flow.
 *
 * `configureApiClient(...)` must run before ANY `apiFetch` / `apiLogin`
 * call. It runs here on mount so it fires exactly once at app boot,
 * covering:
 *
 *   - The `/login` submit path (calls `apiLogin`, which also depends
 *     on `configureApiClient()`).
 *   - The protected surface (`<Dashboard />`, Kanban, admin tabs).
 *   - The hard-reload case where the SPA lands directly on
 *     `/dashboard` without ever mounting `/login`.
 *
 * Earlier attempts wired `configureApiClient` inside `LoginRoute`'s
 * `useEffect` (broke the hard-reload path) or inside
 * `<ProtectedShell />` (broke the login path itself, because
 * `ProtectedShell` is only mounted after `RequireAuth` passes — too
 * late to call `apiLogin`). This component lives above both in the
 * tree so it runs exactly once on every page load.
 *
 * `useNavigate` comes from `react-router-dom` — this component MUST
 * be rendered inside `<BrowserRouter>`.
 */
import { type PropsWithChildren, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { API_ORIGIN } from "../apiOrigin";

import { configureApiClient } from "./apiClient";

export const ApiClientProvider = ({ children }: PropsWithChildren) => {
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

  return children;
};
