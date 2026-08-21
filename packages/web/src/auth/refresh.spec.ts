/**
 * Story 1.7 — 401 Refresh Flow.
 *
 * Coverage (epics.md §Story 1.7):
 *   AC1: 401 → POST /auth/refresh → original request retried once
 *        with the new access token. Verified by stubbing fetch and
 *        counting call order.
 *   AC2: refresh also 401 → navigate to /login?next=<current path>.
 *   AC4: network error during refresh → onOffline() fires, no logout,
 *        no retry loop. Original 401 is surfaced to the caller.
 *
 * The socket layer (AC3) is covered by `socketClient.spec.ts` —
 * separate file because it stubs `socket.io-client` rather than fetch.
 *
 * The interceptor is `apiClient.ts` in `src/api/`. Tests configure it
 * with a navigate + onOffline spy and reset between cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiFetch,
  configureApiClient,
  _resetApiClientConfig,
} from "../api/apiClient";
import { _resetTokenStore, useTokenStore } from "./tokenStore";

/**
 * Tiny JWT-builder so the tests can mint role-bearing access tokens
 * without bringing in a JWT library.
 *
 * Format: base64url(`{header}`).base64url(`{payload}`).<signature>
 * The signature is irrelevant here because we decode payload only.
 */
const TEST_HEADER = { alg: "HS256", typ: "JWT" };
const b64url = (input: string): string => {
  const base64 =
    typeof globalThis.btoa === "function"
      ? globalThis.btoa(input)
      : Buffer.from(input, "utf-8").toString("base64");
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};
const mintToken = (payload: Record<string, unknown>): string =>
  `${b64url(JSON.stringify(TEST_HEADER))}.${b64url(JSON.stringify(payload))}.sig`;

const setToken = (token: string): void => {
  useTokenStore.getState().setAccessToken({ token, expiresIn: 28800 });
};

const ORIGINAL_FETCH = globalThis.fetch;

const installFetch =
  (handler: (url: string, init: RequestInit) => Promise<Response>) => {
    globalThis.fetch = handler as unknown as typeof fetch;
  };

describe("Story 1.7 — 401 refresh interceptor (AC1)", () => {
  beforeEach(() => {
    _resetApiClientConfig();
    _resetTokenStore();
    configureApiClient({
      apiOrigin: "https://api.test",
      navigate: () => undefined,
      onOffline: () => undefined,
    });
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    _resetApiClientConfig();
    _resetTokenStore();
  });

  it("attaches the Bearer header on the first call", async () => {
    setToken(mintToken({ sub: "u1", role: "Admin", exp: 9999999999 }));
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    installFetch(async (url, init) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, headers });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await apiFetch("/devices");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers["Authorization"]).toMatch(/^Bearer /);
  });

  it("refreshes once and retries the original request exactly once on 401", async () => {
    const oldToken = mintToken({
      sub: "u1",
      role: "Viewer",
      exp: 1,
    });
    setToken(oldToken);
    const newToken = mintToken({
      sub: "u1",
      role: "Viewer",
      exp: 9999999999,
    });

    const fetchCalls: Array<{ url: string; auth: string | null }> = [];
    installFetch(async (url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const auth = headers["Authorization"] ?? null;
      fetchCalls.push({ url, auth });
      if (url.endsWith("/devices")) {
        if (auth === `Bearer ${oldToken}`) {
          return new Response("{}", { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/auth/refresh")) {
        return new Response(
          JSON.stringify({
            access_token: newToken,
            token_type: "Bearer",
            expires_in: 28800,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const res = await apiFetch("/devices");
    expect(res.status).toBe(200);

    // 1) GET /devices (with old token → 401)
    // 2) POST /auth/refresh
    // 3) GET /devices (with new token → 200)
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[0]?.url.endsWith("/devices")).toBe(true);
    expect(fetchCalls[0]?.auth).toBe(`Bearer ${oldToken}`);
    expect(fetchCalls[1]?.url.endsWith("/auth/refresh")).toBe(true);
    expect(fetchCalls[2]?.url.endsWith("/devices")).toBe(true);
    expect(fetchCalls[2]?.auth).toBe(`Bearer ${newToken}`);
    expect(useTokenStore.getState().accessToken).toBe(newToken);
  });

  it("does NOT retry refresh more than once for a single API call", async () => {
    setToken(mintToken({ sub: "u1", role: "Viewer", exp: 1 }));
    let refreshCalls = 0;
    installFetch(async (url) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return new Response("{}", { status: 401 });
      }
      // /devices always 401s — refresh itself fails, no retry loop.
      return new Response("{}", { status: 401 });
    });

    await apiFetch("/devices");
    expect(refreshCalls).toBe(1);
  });
});

describe("Story 1.7 — refresh failure routes to /login?next=<current> (AC2)", () => {
  beforeEach(() => {
    _resetApiClientConfig();
    _resetTokenStore();
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    _resetApiClientConfig();
    _resetTokenStore();
  });

  it("navigates to /login?next=<current path> when refresh also returns 401", async () => {
    const navigate = vi.fn();
    setToken(mintToken({ sub: "u1", role: "Viewer", exp: 1 }));
    configureApiClient({
      apiOrigin: "https://api.test",
      navigate,
      onOffline: () => undefined,
    });
    installFetch(async (url) => {
      if (url.endsWith("/auth/refresh")) {
        return new Response("{}", { status: 401 });
      }
      return new Response("{}", { status: 401 });
    });

    // Simulate a URL the SPA is currently on.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/audit", search: "" },
    });

    await apiFetch("/devices");

    expect(navigate).toHaveBeenCalledTimes(1);
    const callArg = navigate.mock.calls[0]?.[0] as string;
    expect(callArg.startsWith("/login?next=")).toBe(true);
    expect(decodeURIComponent(callArg.split("next=")[1] ?? "")).toBe("/audit");
    // Tokens cleared (the SPA starts from a clean slate on /login).
    expect(useTokenStore.getState().accessToken).toBeNull();
  });
});

describe("Story 1.7 — network error during refresh (AC4)", () => {
  beforeEach(() => {
    _resetApiClientConfig();
    _resetTokenStore();
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    _resetApiClientConfig();
    _resetTokenStore();
  });

  it("fires onOffline and surfaces the original 401 without logging out", async () => {
    const navigate = vi.fn();
    const onOffline = vi.fn();
    setToken(mintToken({ sub: "u1", role: "Viewer", exp: 1 }));
    configureApiClient({
      apiOrigin: "https://api.test",
      navigate,
      onOffline,
    });

    installFetch(async (url) => {
      if (url.endsWith("/auth/refresh")) {
        // Simulate a network failure (TypeError from fetch).
        throw new TypeError("NetworkError when attempting to fetch resource.");
      }
      return new Response("{}", { status: 401 });
    });

    const res = await apiFetch("/devices");
    expect(res.status).toBe(401);
    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    // Token preserved — the SPA can recover when the network returns.
    expect(useTokenStore.getState().accessToken).not.toBeNull();
  });
});