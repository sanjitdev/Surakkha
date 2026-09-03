/**
 * `RequireAuth` — token-presence + expiry gate contract.
 *
 * Coverage matrix (each branch pinned by at least one assertion):
 *
 *   Row 1 — authenticated (token present, expiresAt in the future):
 *           `<Outlet/>` renders the child route.
 *   Row 2 — unauthenticated (accessToken === null):
 *           `<Navigate to="/login" replace state={{from: <path>}}/>`.
 *   Row 3 — stale (accessToken present but expiresAt <= now):
 *           same redirect as Row 2; the expiry check runs BEFORE
 *           the outlet render so a JWT past its `exp` cannot slip
 *           through the gate even if the refresh interceptor
 *           hasn't fired yet.
 *   Row 4 — `from` preserves `pathname + search + hash`:
 *           a deep-link bounce-back lands at the exact URL the
 *           operator was on (not just the path).
 *
 * Test rig: `MemoryRouter` + a child sentinel so the test can
 * distinguish "Outlet rendered" from "Navigate redirected".
 * `useTokenStore` is reset between cases via `_resetTokenStore`
 * (test-only escape hatch in `tokenStore.ts`).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { _resetTokenStore, useTokenStore } from "./tokenStore";

import { RequireAuth } from "./RequireAuth";

const OutletSentinel = () => <div data-testid="outlet-child">protected child</div>;

/** A `/login` route that reads `state.from` via `useLocation()` and
 *  renders it as a test-id. Lets the deep-link bounce-back test
 *  observe the exact value `<Navigate />` carries across. */
const LoginSentinel = () => {
  const location = useLocation();
  const from =
    typeof location.state === "object" && location.state !== null
      ? (location.state as { from?: unknown }).from
      : undefined;
  return (
    <div data-testid="login-redirect" data-from={typeof from === "string" ? from : ""}>
      redirected to login
    </div>
  );
};

/** Build a router where `/protected/*` + `/dashboard` are gated by
 *  `RequireAuth` and `/login` is the redirect target. The test
 *  renders a child route via `<Routes>` inside the gate so we can
 *  confirm the Outlet was reached. */
const buildRouter = (initialPath: string) => (
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/login" element={<LoginSentinel />} />
      <Route element={<RequireAuth />}>
        <Route path="/protected" element={<OutletSentinel />} />
        <Route path="/dashboard" element={<OutletSentinel />} />
      </Route>
    </Routes>
  </MemoryRouter>
);

describe("RequireAuth — auth gate contract", () => {
  afterEach(() => {
    cleanup();
    _resetTokenStore();
  });

  beforeEach(() => {
    _resetTokenStore();
  });

  it("renders Outlet when accessToken is present and not expired", () => {
    useTokenStore.getState().setAccessToken({
      token: "valid.jwt.token",
      expiresIn: 3600, // 1h from now
    });
    render(buildRouter("/protected"));
    expect(screen.getByTestId("outlet-child")).toBeInTheDocument();
    expect(screen.queryByTestId("login-redirect")).toBeNull();
  });

  it("redirects to /login when accessToken is null", async () => {
    // accessToken is null (the reset above).
    render(buildRouter("/dashboard"));
    // `<Navigate />` is async — it renders the source route first,
    // then triggers the navigation on the next tick. `waitFor` lets
    // the router flush the redirect to `/login`.
    await waitFor(() => {
      expect(screen.getByTestId("login-redirect")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("outlet-child")).toBeNull();
  });

  it("redirects to /login when the token is expired (expiresAt <= now)", async () => {
    useTokenStore.setState({
      accessToken: "stale.jwt.token",
      expiresAt: Date.now() - 1000, // 1s in the past
    });
    render(buildRouter("/protected"));
    await waitFor(() => {
      expect(screen.getByTestId("login-redirect")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("outlet-child")).toBeNull();
  });

  it("preserves pathname + search + hash in state.from for deep-link bounce-back", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["/protected", "/protected"],
      ["/protected?foo=bar", "/protected?foo=bar"],
      ["/protected#notes", "/protected#notes"],
      ["/protected?foo=bar#notes", "/protected?foo=bar#notes"],
    ];
    for (const [requestPath, expectedFrom] of cases) {
      cleanup();
      _resetTokenStore();
      render(buildRouter(requestPath));
      const sentinel = screen.getByTestId("login-redirect");
      expect(sentinel.getAttribute("data-from")).toBe(expectedFrom);
    }
  });
});
