/**
 * apiClient — Surakkha web (Story 1.7).
 *
 * Thin fetch wrapper that:
 *   1. Attaches `Authorization: Bearer <token>` from the tokenStore
 *      on every request.
 *   2. On 401, calls `POST /auth/refresh` exactly once (relies on the
 *      httpOnly `surakkha_refresh` cookie). If the refresh succeeds,
 *      the original request is retried exactly once with the new
 *      access token. If the refresh also fails (401 or network
 *      error), the SPA navigates to `/login?next=<current path>`
 *      (network error path also surfaces the offline state — see
 *      AC4 in epics.md §Story 1.7).
 *   3. Concurrent 401s share a single refresh promise via a module-
 *      scoped lock so we never fan out multiple refresh calls from
 *      parallel queries (Story 1.7: "does not retry refresh more
 *      than once per API call" — we extend that to "once per concurrent
 *      burst" for the same reason).
 *
 * AC mapping (epics.md §Story 1.7):
 *   - AC1: apiClient retries the original request once with the new
 *          access token (this file).
 *   - AC2: refresh failure → `navigate("/login?next=<path>")`
 *          (configured via `configureApiClient`).
 *   - AC3: socket layer uses `refreshSession()` + `getAccessToken()`
 *          to reconnect with a fresh token without unmounting.
 *   - AC4: network error during refresh → `onOffline()` and bail; no
 *          retry loop.
 *
 * The `configureApiClient` injection point keeps the client testable
 * (we override `navigate` + `onOffline` from `main.tsx`) and decouples
 * it from `react-router-dom` so unit tests do not need a Router.
 */
import { AccessTokenSchema, REFRESH_TOKEN_COOKIE } from "@surakkha/shared/auth";

import { readAccessToken, useTokenStore } from "../auth/tokenStore";

const HTTP_UNAUTHORIZED = 401;

/**
 * Configuration injected by the React tree once, on app boot. Tests
 * set these explicitly; production wires them in `main.tsx`.
 */
export interface ApiClientConfig {
  readonly navigate: (path: string) => void;
  readonly onOffline: () => void;
  readonly apiOrigin: string;
}

let config: ApiClientConfig | null = null;

export const configureApiClient = (next: ApiClientConfig): void => {
  config = next;
};

/**
 * Reset the apiClient back to its un-configured state. Used by tests
 * to verify the "no navigate was called" path.
 */
export const _resetApiClientConfig = (): void => {
  config = null;
  inflightRefresh = null;
};

/**
 * Coalesce concurrent refresh attempts into one round-trip. If two
 * queries 401 in the same tick, the second waits on the first's
 * result rather than firing its own refresh.
 */
let inflightRefresh: Promise<string | null> | null = null;

/**
 * Perform the refresh call. Returns the new access token on success
 * or `null` on failure (401 from the api, or a network error).
 */
const performRefresh = async (): Promise<string | null> => {
  if (config === null) {
    throw new Error("apiClient: configureApiClient() must run before use");
  }
  try {
    const res = await fetch(`${config.apiOrigin}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      return null;
    }
    const body: unknown = await res.json();
    const parsed = AccessTokenSchema.safeParse(body);
    if (!parsed.success) return null;
    useTokenStore.getState().setAccessToken({
      token: parsed.data.access_token,
      expiresIn: parsed.data.expires_in,
    });
    return parsed.data.access_token;
  } catch {
    // Network error during refresh — AC4 says we surface offline
    // state and do NOT clear tokens / navigate. The caller will
    // raise onOffline and bubble the original request's failure.
    throw new Error("refresh_network_error");
  }
};

/**
 * Public helper used by the socket layer (Story 1.7 AC3). Returns
 * the current access token, refreshing silently if needed. Returns
 * `null` if refresh fails for a non-network reason (in which case the
 * caller should reconnect without a token; the socket's auth gate
 * will then receive a 401 which the apiClient will handle on the
 * REST surface).
 */
export const refreshSession = async (): Promise<string | null> => {
  if (inflightRefresh !== null) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      return await performRefresh();
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
};

/**
 * Read the current access token synchronously. Used by the socket
 * layer on initial connect.
 */
export const getAccessToken = (): string | null => readAccessToken();

/**
 * The single refresh-cookie name re-exported so the socket layer can
 * reference it without a parallel copy.
 */
export { REFRESH_TOKEN_COOKIE };

interface ApiRequestInit extends Omit<RequestInit, "headers"> {
  readonly headers?: Record<string, string>;
  /** Skip the Authorization header (e.g. POST /auth/login). */
  readonly skipAuth?: boolean;
}

const withJsonContentType = (
  headers: Record<string, string>,
  body: BodyInit | null,
): Record<string, string> => {
  if (body === null || headers["Content-Type"] !== undefined) return headers;
  return { ...headers, "Content-Type": "application/json" };
};

const withBearer = (headers: Record<string, string>, skipAuth: boolean): Record<string, string> => {
  if (skipAuth) return headers;
  const token = readAccessToken();
  if (token === null) return headers;
  return { ...headers, Authorization: `Bearer ${token}` };
};

const buildAuthedHeaders = (init: ApiRequestInit, skipAuth: boolean): Record<string, string> => {
  const base: Record<string, string> = { ...(init.headers ?? {}) };
  const withAuth = withBearer(base, skipAuth);
  return withJsonContentType(withAuth, init.body ?? null);
};

const computeNextPath = (): string => {
  if (typeof window === "undefined") return "/dashboard";
  return `${window.location.pathname}${window.location.search}`;
};

/**
 * Wrapper around fetch that:
 *   - attaches the Bearer token from the store
 *   - on 401, refreshes once, retries the request once
 *   - on refresh failure, navigates to /login?next=<current path>
 *   - on network error during refresh, surfaces offline state without
 *     logging out
 *
 * The `skipAuth` flag is used by the login form (POST /auth/login),
 * which runs before any token exists.
 */
export const apiFetch = async (path: string, init: ApiRequestInit = {}): Promise<Response> => {
  if (config === null) {
    throw new Error("apiClient: configureApiClient() must run before use");
  }
  const url = path.startsWith("http") ? path : `${config.apiOrigin}${path}`;
  const skipAuth = init.skipAuth === true;
  const headers = buildAuthedHeaders(init, skipAuth);

  const first = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });

  if (first.status !== HTTP_UNAUTHORIZED || skipAuth) {
    return first;
  }

  return retryAfterRefresh({ url, init, headers, first });
};

interface RetryArgs {
  readonly url: string;
  readonly init: ApiRequestInit;
  readonly headers: Record<string, string>;
  readonly first: Response;
}

const retryAfterRefresh = async (args: RetryArgs): Promise<Response> => {
  if (config === null) {
    throw new Error("apiClient: configureApiClient() must run before use");
  }
  let newToken: string | null;
  try {
    newToken = await refreshSession();
  } catch (err) {
    if (err instanceof Error && err.message === "refresh_network_error") {
      // AC4: surface offline state, do NOT clear tokens or navigate.
      config.onOffline();
      return args.first;
    }
    throw err;
  }

  if (newToken === null) {
    // AC2: refresh itself 401'd → log out, navigate to /login?next=...
    useTokenStore.getState().clearTokens();
    config.navigate(`/login?next=${encodeURIComponent(computeNextPath())}`);
    return args.first;
  }

  const retryHeaders: Record<string, string> = {
    ...args.headers,
    Authorization: `Bearer ${newToken}`,
  };
  return fetch(args.url, {
    ...args.init,
    headers: retryHeaders,
    credentials: "include",
  });
};

/**
 * POST /auth/login helper. Used by the LoginShell on submit. On
 * success, stores the new access token and returns the parsed body.
 * On failure, returns the Response object so the caller can branch on
 * status (401 = invalid_credentials → surface inline error).
 */
export const apiLogin = async (email: string, password: string): Promise<Response> => {
  if (config === null) {
    throw new Error("apiClient: configureApiClient() must run before use");
  }
  const res = await fetch(`${config.apiOrigin}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    const body: unknown = await res.json();
    const parsed = AccessTokenSchema.safeParse(body);
    if (parsed.success) {
      useTokenStore.getState().setAccessToken({
        token: parsed.data.access_token,
        expiresIn: parsed.data.expires_in,
      });
    }
  }
  return res;
};
