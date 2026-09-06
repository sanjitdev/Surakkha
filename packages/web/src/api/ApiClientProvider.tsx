/**
 * `ApiClientProvider` — single source of truth for the `apiClient`
 * configuration that lives OUTSIDE the login flow.
 *
 * `configureApiClient(...)` must run before ANY `apiFetch` / `apiLogin`
 * call. It runs here on the FIRST render (synchronously, via a
 * `useState` lazy initializer — NOT in `useEffect`) so it fires
 * exactly once at app boot, covering:
 *
 *   - The `/login` submit path (calls `apiLogin`, which also depends
 *     on `configureApiClient()`).
 *   - The protected surface (`<Dashboard />`, Kanban, admin tabs).
 *   - The hard-reload case where the SPA lands directly on
 *     `/admin/thresholds` (or any other protected route) without
 *     ever mounting `/login`.
 *
 * Why synchronously (not `useEffect`): React runs child `useEffect`s
 * BEFORE parent `useEffect`s on the same commit. On a hard reload of
 * `/admin/thresholds`, `<Routes>` mounts `<ThresholdsPage>` in the
 * same commit phase as `<ApiClientProvider>`; `<ThresholdsPage>`'s
 * `useQuery` fires its `queryFn` from the page's `useEffect`, which
 * runs BEFORE this provider's `useEffect`. If the wiring lived in a
 * `useEffect` here, the first `apiFetch` would land with
 * `config === null` and throw
 * `"apiClient: configureApiClient() must run before use"` — the
 * page briefly renders its error UI before the wiring finally
 * catches up. The `useState` lazy initializer runs during render,
 * BEFORE any descendant `useEffect`, closing the race.
 *
 * Earlier attempts wired `configureApiClient` inside `LoginRoute`'s
 * `useEffect` (broke the hard-reload path) or inside
 * `<ProtectedShell />` (broke the login path itself, because
 * `ProtectedShell` is only mounted after `RequireAuth` passes — too
 * late to call `apiLogin`). This component lives above both in the
 * tree so it runs on every page load.
 *
 * `useNavigate` requires a `<BrowserRouter />` parent.
 */
import { type PropsWithChildren, useState } from "react";
import { useNavigate } from "react-router-dom";

import { API_ORIGIN } from "../apiOrigin";

import { configureApiClient } from "./apiClient";

export const ApiClientProvider = ({ children }: PropsWithChildren) => {
  const navigate = useNavigate();
  // Lazy initializer runs synchronously on the first render. The
  // returned value is unused (`null`) — this hook's only purpose is
  // to host the side effect. Returning `null` also documents that
  // this hook owns NO state; the apiClient module owns the config
  // and `tokenStore` owns the access token. Subsequent renders skip
  // the initializer (React preserves the state slot across the
  // StrictMode double-mount and across re-renders), so
  // `configureApiClient` is called exactly once per app lifetime.
  useState<null>(() => {
    configureApiClient({
      apiOrigin: API_ORIGIN,
      navigate: (path) => navigate(path),
      onOffline: () => {
        console.warn("Surakkha: offline detected during token refresh");
      },
    });
    return null;
  });
  return children;
};
