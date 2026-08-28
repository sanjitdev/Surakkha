/**
 * `useNotificationBell.spec.tsx` — Story 4.10.
 *
 * Hook-level coverage for the unread notification read path. Mirrors
 * the test rig pattern from `useConnectionState.spec.tsx` (a bare
 * component probe + `renderHook` via `@testing-library/react`):
 *
 *   - `refetchInterval: 30_000` while `enabled === true`
 *     (TanStack Query ticks; a second fetch fires).
 *   - `enabled === false` when viewerRole is `Viewer`
 *     (no fetch fires — the `RBAC_NO_FETCH` matrix row).
 *   - `queryFn` throws `NotificationsRbacDeniedError` on 403
 *     (the `GET_403` matrix row's hook-side guarantee).
 *   - `enabled === false` when no JWT (unauthenticated).
 *
 * Why a SEPARATE file (vs folded into `NotificationBell.spec.tsx`):
 *
 *   - The hook is the canonical seam for the read path's RBAC +
 *     polling contract. The bell component spec exercises the
 *     full DOM tree; the hook spec exercises the query config +
 *     queryFn mapping directly. Two test surfaces, two failure
 *     modes.
 *
 *   - Mirrors `useAcknowledgeMutation.spec.ts` (Story 4.5) and
 *     `useKanbanBoardSocket.spec.ts` (Story 4.3) — every
 *     TanStack `useQuery` / `useMutation` in this codebase
 *     gets its own `use*.spec.ts` file as the canonical
 *     hook-level coverage.
 */
import {
  type NotificationListEnvelope,
  type NotificationPayload,
} from "@surakkha/shared/notification";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { NotificationsRbacDeniedError } from "./NotificationsRbacDeniedError";
import { useNotificationBell } from "./useNotificationBell";

const NOTIFICATION_ID_1 = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID_1 = "99999999-9999-4999-8999-999999999991";

const baseNotification = (overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
  id: NOTIFICATION_ID_1,
  severity: "critical",
  incidentId: INCIDENT_ID_1,
  alertId: null,
  recipientRole: "Operator",
  createdAt: "2026-08-28T12:00:00.000Z",
  acknowledgedAt: null,
  ...overrides,
});

const buildEnvelope = (
  notifications: readonly NotificationPayload[],
): NotificationListEnvelope => ({ notifications });

interface FetchResponse {
  readonly status: number;
  readonly body: unknown;
}

const installFetch = (handler: (url: string, init?: RequestInit) => Promise<FetchResponse>) => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const result = await handler(url, init);
    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as unknown as typeof fetch;
};

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });

const wrap =
  (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  _resetApiClientConfig();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Story 4.10 — useNotificationBell read path", () => {
  it("sets refetchInterval: 30_000 — the underlying Query is configured with the 30s poll", async () => {
    // Pin the runtime configuration on the underlying TanStack
    // Query — the spec literally reads "TanStack `refetchInterval:
    // 30_000` ticks while the dropdown is closed". The runtime
    // second-fetch assertion under fake timers is exercised in
    // `NotificationBell.spec.tsx`'s POLL_TICK row (where the fetch
    // is end-to-end through the apiClient + happy-dom). This
    // hook-level test pins the configuration seam — a future
    // regression that flips `refetchInterval` to `false` (or to a
    // constant other than `30_000`) will trip this assertion.
    let getCount = 0;
    installFetch(async (url, init) => {
      if (url.endsWith("/api/notifications") && (init?.method ?? "GET") === "GET") {
        getCount += 1;
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "critical",
              incidentId: INCIDENT_ID_1,
            }),
          ]),
        };
      }
      return { status: 404, body: {} };
    });
    const queryClient = buildQueryClient();
    renderHook(() => useNotificationBell("Operator"), { wrapper: wrap(queryClient) });

    // Read the live query out of the cache by the same key the hook
    // publishes (`["notifications", "unread", role]`).
    await waitFor(() => {
      const q = queryClient.getQueryCache().find({
        queryKey: ["notifications", "unread", "Operator"],
      }) as unknown as {
        readonly options: { readonly refetchInterval: number | false; readonly enabled: boolean };
      };
      expect(q).toBeDefined();
      // TanStack Query v5 stores the configured options on the
      // underlying `Query` instance — `q.options.refetchInterval`
      // is the load-bearing pin: the spec says "refetchInterval:
      // 30_000"; the runtime value MUST be that.
      expect(q.options.refetchInterval).toBe(30_000);
      expect(q.options.enabled).toBe(true);
    });
    // Belt-and-suspenders: at least one GET fired on mount.
    await waitFor(() => {
      expect(getCount).toBeGreaterThanOrEqual(1);
    });
  });

  it("enabled === false for Viewer: NO fetch fires (RBAC_NO_FETCH)", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    installFetch(async (url) => {
      fetchSpy(url);
      return { status: 404, body: {} };
    });
    const queryClient = buildQueryClient();
    renderHook(() => useNotificationBell("Viewer"), { wrapper: wrap(queryClient) });

    // Let any scheduled fetches flush.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    // TanStack Query never mounted the fetch — confirm.
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/notifications"))).toBe(false);
  });

  it("queryFn throws NotificationsRbacDeniedError on 403", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return { status: 403, body: { error: "forbidden" } };
      }
      return { status: 404, body: {} };
    });
    const queryClient = buildQueryClient();
    const { result } = renderHook(() => useNotificationBell("Operator"), {
      wrapper: wrap(queryClient),
    });
    // Wait for the query to settle into the error state.
    await waitFor(() => {
      expect(result.current.query.error).toBeInstanceOf(NotificationsRbacDeniedError);
    });
    // Belt-and-suspenders: the class identity matters for the
    // bell's `instanceof` guard (`GET_403` UI contract fix).
    const err = result.current.query.error;
    expect(err).toBeInstanceOf(NotificationsRbacDeniedError);
    expect((err as NotificationsRbacDeniedError).name).toBe("NotificationsRbacDeniedError");
  });

  it("enabled === false when no JWT — no fetch fires (unauthenticated, treated as Viewer)", async () => {
    vi.useFakeTimers();
    // The hook's `enabled` gate is purely `viewerRole !== "Viewer"`.
    // The "no JWT" path is enforced by the upstream `NotificationBell`
    // component, which maps `useCurrentRole() === null → Viewer`
    // BEFORE calling this hook (see NotificationBell.tsx:315-319).
    // We exercise the equivalent code path here: the hook receives
    // `"Viewer"` and the `enabled: false` branch is load-bearing.
    //
    // The 30s `refetchInterval` MUST also evaluate to `false` when
    // `enabled` is false — TanStack's `refetchInterval` config is a
    // function `(query) => number | false` here so we can pin both
    // branches of that ternary in the same test rig.
    const fetchSpy = vi.fn();
    installFetch(async (url) => {
      fetchSpy(url);
      return { status: 404, body: {} };
    });
    const queryClient = buildQueryClient();
    renderHook(() => useNotificationBell("Viewer"), { wrapper: wrap(queryClient) });
    // Let any scheduled fetches flush.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // Drive a polling tick past the 30s boundary — a non-Viewer
    // role WOULD fire a second fetch here; Viewer must not.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/notifications"))).toBe(false);
  });
});
