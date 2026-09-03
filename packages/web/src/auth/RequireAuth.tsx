/**
 * Route-level auth gate. Reads `accessToken` synchronously from the
 * persisted `tokenStore` (initialised from `localStorage` in the
 * zustand factory — `tokenStore.ts:readPersisted()`). When the token
 * is missing OR expired, redirects to `/login` with the requested
 * path in `state.from` so `LoginRoute` can bounce the operator back
 * after a successful sign-in.
 *
 * Expiry gate: tokenStore computes `expiresAt = Date.now() + expiresIn*1000`
 * at login time. A persisted token with `expiresAt < Date.now()` is
 * stale — the refresh interceptor in apiClient.ts will fire a 401 and
 * the apiClient's `onSessionLost` callback will navigate to `/login`.
 * Either way, we treat the user as logged-out here.
 *
 * Uses `pathname + search + hash` for `from` (not just pathname) so
 * a deep link to `/incidents/123?foo=bar#notes` lands back at the
 * exact URL the operator was on.
 */
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useTokenStore } from "./tokenStore";

export const RequireAuth = () => {
  const accessToken = useTokenStore((s) => s.accessToken);
  const expiresAt = useTokenStore((s) => s.expiresAt);
  const location = useLocation();

  const now = Date.now();
  const isAuthenticated = accessToken !== null && (expiresAt === null || expiresAt > now);

  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
};
