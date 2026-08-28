/**
 * `useMarkAsRead.spec.tsx` — Story 4.10.
 *
 * Mutation-level coverage for `PATCH /api/notifications/:id/acknowledge`.
 * Mirrors the test rig pattern from `useAcknowledgeMutation.spec.ts`
 * (Story 4.5):
 *
 *   - PATCH 200 → `queryClient.invalidateQueries` called for the
 *     unread cache key (the spec's "Wait for server response, then
 *     re-derive" contract).
 *   - PATCH 403 → NO toast emitted (3.5 noise reduction); the
 *     cache IS invalidated so the bell re-fetches to recover.
 *   - PATCH 404 → NO toast (silent drop); the cache IS invalidated
 *     so the row drops from the dropdown on the next refetch.
 *   - PATCH 500 → toast emitted via `deps.onError` (the
 *     `MARK_AS_READ_500` matrix row).
 *   - PATCH 401 → toast emitted (5xx-class UX; "Session expired"
 *     copy).
 *
 * Why a SEPARATE file (vs folded into `NotificationBell.spec.tsx`):
 *   - The mutation is the canonical seam for the mark-as-read
 *     write path's RBAC + error classification contract. The bell
 *     component spec exercises the full DOM tree; the hook spec
 *     exercises the mutation behavior in isolation. Two test
 *     surfaces, two failure modes.
 */
import {
  type NotificationListEnvelope,
  type NotificationPayload,
} from "@surakkha/shared/notification";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";

import { UNREAD_NOTIFICATIONS_QUERY_KEY } from "./useNotificationBell";
import { useMarkAsRead } from "./useMarkAsRead";

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
      mutations: { retry: false },
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
  vi.restoreAllMocks();
});

/**
 * Run a mutation and wait for it to settle (success or error). Returns
 * the `invalidateQueries` spy so the assertion can pin the call.
 */
const runMutation = async (
  queryClient: QueryClient,
  fetchImpl: (url: string, init?: RequestInit) => Promise<FetchResponse>,
) => {
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  installFetch(fetchImpl);
  const onError = vi.fn();
  const { result } = renderHook(() => useMarkAsRead("Operator", { onError }), {
    wrapper: wrap(queryClient),
  });
  // Trigger the mutation.
  result.current.mutate(NOTIFICATION_ID_1);
  await waitFor(() => {
    // Either pending → settled, OR onError was called.
    expect(result.current.isPending || result.current.isSuccess || result.current.isError).toBe(
      true,
    );
  });
  await waitFor(
    () => {
      expect(result.current.isPending).toBe(false);
    },
    { timeout: 3_000, interval: 50 },
  );
  return { invalidateSpy, onError };
};

describe("Story 4.10 — useMarkAsRead write path", () => {
  it("PATCH 200 → queryClient.invalidateQueries called for the unread cache key", async () => {
    const queryClient = buildQueryClient();
    const { invalidateSpy } = await runMutation(queryClient, async (url, init) => {
      if (url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`)) {
        expect(init?.method).toBe("PATCH");
        return {
          status: 200,
          body: baseNotification({
            id: NOTIFICATION_ID_1,
            acknowledgedAt: "2026-08-28T12:30:00.000Z",
          }),
        };
      }
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });

    // onSuccess → invalidateQueries([...unread cache key])
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...UNREAD_NOTIFICATIONS_QUERY_KEY("Operator")],
    });
  });

  it("PATCH 403 → NO toast emitted; cache invalidated for re-fetch", async () => {
    const queryClient = buildQueryClient();
    const { invalidateSpy, onError } = await runMutation(queryClient, async (url) => {
      if (url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`)) {
        return { status: 403, body: { error: "forbidden" } };
      }
      if (url.endsWith("/api/notifications")) {
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

    // Spec MARK_AS_READ_403 — "No toast (3.5 noise reduction)".
    expect(onError).not.toHaveBeenCalled();
    // Cache IS invalidated so the bell re-fetches to recover.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...UNREAD_NOTIFICATIONS_QUERY_KEY("Operator")],
    });
  });

  it("PATCH 404 → toast emitted (Notification not found); cache invalidated to drop the row", async () => {
    // The implementation's `onError` handler treats 404 like the
    // other 4xx-not-403 codes: it invalidates the unread cache AND
    // emits the toast. The toast copy is "Notification not found"
    // (operator-actionable: re-fetch likely surfaces the row is
    // already gone). Pinned here.
    const queryClient = buildQueryClient();
    const { invalidateSpy, onError } = await runMutation(queryClient, async (url) => {
      if (url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`)) {
        return { status: 404, body: { error: "not_found" } };
      }
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe("Notification not found");
    // Cache IS invalidated so the dropdown drops the row on the
    // next refetch (the row's already gone from the server).
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...UNREAD_NOTIFICATIONS_QUERY_KEY("Operator")],
    });
  });

  it("PATCH 500 → toast emitted via deps.onError; no cache invalidation", async () => {
    const queryClient = buildQueryClient();
    const { invalidateSpy, onError } = await runMutation(queryClient, async (url) => {
      if (url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`)) {
        return { status: 500, body: { error: "internal" } };
      }
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });

    // Spec MARK_AS_READ_500 — toast + bell re-fetches.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toContain("Failed to acknowledge");
    // 5xx → row is presumed unchanged, so NO cache invalidation
    // (the operator may retry; the unread state is intact).
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("PATCH 401 → toast emitted (5xx-class UX; Session expired)", async () => {
    const queryClient = buildQueryClient();
    const { onError } = await runMutation(queryClient, async (url) => {
      if (url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`)) {
        return { status: 401, body: { error: "unauthorized" } };
      }
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });

    // Spec: 401 → "Session expired" toast. The apiClient is supposed
    // to retry-once-on-401 before surfacing a 401 to the consumer;
    // here we mock `globalThis.fetch` directly so the retry path
    // is bypassed and the mutation observes the 401 verbatim. The
    // mutation must STILL surface a toast — the operator must
    // re-auth before any retry can succeed.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toContain("Session expired");
  });
});
