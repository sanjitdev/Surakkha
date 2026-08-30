/**
 * `useAdminNotificationList.spec.tsx` — Story 5.1.
 *
 * Hook-level coverage for the admin notification read path. Mirrors
 * the test rig pattern from `useNotificationBell.spec.tsx` (a bare
 * queryClient probe + `renderHook` via `@testing-library/react`):
 *
 *   - `refetchInterval: 30_000` (TanStack Query config seam — the
 *     `LIVE_POLL` I/O matrix row in the spec).
 *   - The hook's cache key is filter-scoped (severity multi-select
 *     changes the cache slot).
 *   - 403 from the api throws `AdminNotificationsRbacDeniedError`
 *     (the hook-side guarantee for the page's
 *     `<RbacDenied />` fallback).
 *
 * Loop 1 review hardening (VG finding): the previous file did not
 * exist — the LIVE_POLL I/O matrix row had no hook-level coverage
 * (the page spec exercised user-action triggers but not the 30s
 * timer). This file pins the runtime configuration seam.
 *
 * Why a SEPARATE file (vs folded into `AdminNotificationsPage.spec.tsx`):
 *
 *   - The hook is the canonical seam for the read path's RBAC +
 *     polling contract. The page spec exercises the full DOM tree;
 *     the hook spec exercises the query config + queryFn mapping
 *     directly.
 *
 *   - Mirrors `useNotificationBell.spec.tsx` (4.10) — the
 *     TanStack `useQuery` for every read surface gets its own
 *     `use*.spec.ts` file as the canonical hook-level coverage.
 */
import {
  type AdminNotificationListEnvelope,
  type AdminNotificationPayload,
} from "@surakkha/shared/notification";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";

import { AdminNotificationsRbacDeniedError } from "./AdminNotificationsRbacDeniedError";
import {
  ADMIN_NOTIFICATIONS_QUERY_KEY,
  useAdminNotificationList,
} from "./useAdminNotificationList";

const NOTIFICATION_ID_1 = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID_1 = "99999999-9999-4999-8999-999999999991";

const baseAdminNotification = (
  overrides: Partial<AdminNotificationPayload> = {},
): AdminNotificationPayload => ({
  id: NOTIFICATION_ID_1,
  severity: "critical",
  incidentId: INCIDENT_ID_1,
  alertId: null,
  recipientRole: "Operator",
  createdAt: "2026-08-28T12:00:00.000Z",
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  ...overrides,
});

const buildEnvelope = (
  notifications: readonly AdminNotificationPayload[],
): AdminNotificationListEnvelope => ({ notifications });

interface FetchResponse {
  readonly status: number;
  readonly body: unknown;
}

const installFetch = (handler: (url: string, init?: RequestInit) => Promise<FetchResponse>) => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const result = await handler(url, init);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
    });
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

// `QueryClientProvider` is imported in the top-of-file import
// block (above). The test rig above is intentionally side-effect
// free, mirroring the 4.10 `useNotificationBell.spec.tsx` rig.

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

describe("Story 5.1 — useAdminNotificationList read path", () => {
  it("sets refetchInterval: 30_000 — the underlying Query is configured with the 30s poll", async () => {
    // Pin the runtime configuration on the underlying TanStack
    // Query — the spec literally reads "TanStack `refetchInterval:
    // 30_000` ticks". A future regression that flips
    // `refetchInterval` to `false` (or to a constant other than
    // `30_000`) trips this assertion.
    installFetch(async () => ({
      status: 200,
      body: buildEnvelope([
        baseAdminNotification({
          id: NOTIFICATION_ID_1,
          severity: "critical",
          incidentId: INCIDENT_ID_1,
        }),
      ]),
    }));
    const queryClient = buildQueryClient();
    renderHook(() => useAdminNotificationList(), {
      wrapper: wrap(queryClient),
    });
    // Wait for the query to register with the client.
    await waitFor(() => {
      const queries = queryClient.getQueryCache().getAll();
      const target = queries.find(
        (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "admin-notifications",
      );
      if (!target) throw new Error("query not registered yet");
      expect(target.options.refetchInterval).toBe(30_000);
    });
  });

  it("rejects the hook's response shape — a tampered envelope fails the parse and surfaces an Error", async () => {
    // Loop 1 review finding E5 hardening: the hook parses the
    // body through `AdminNotificationListEnvelopeSchema` so a
    // tampered response (or a future adapter drift that drops
    // `acknowledgedByUserId`) fails the parse and surfaces a
    // useful error instead of letting `undefined` propagate.
    installFetch(async () => ({
      status: 200,
      // Omit `acknowledgedByUserId` from the row — a structural
      // drift that the parse step must reject.
      body: {
        notifications: [
          {
            id: NOTIFICATION_ID_1,
            severity: "critical",
            incidentId: INCIDENT_ID_1,
            alertId: null,
            recipientRole: "Operator",
            createdAt: "2026-08-28T12:00:00.000Z",
            acknowledgedAt: null,
          },
        ],
      },
    }));
    const queryClient = buildQueryClient();
    const { result } = renderHook(() => useAdminNotificationList(), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => {
      expect(result.current.query.isError).toBe(true);
    });
    expect(result.current.query.error).toBeInstanceOf(Error);
    expect((result.current.query.error as Error).message).toMatch(/malformed envelope/);
  });

  it("throws AdminNotificationsRbacDeniedError on 403 — the page-level RbacDenied fallback seam", async () => {
    installFetch(async () => ({
      status: 403,
      body: { error: "forbidden" },
    }));
    const queryClient = buildQueryClient();
    const { result } = renderHook(() => useAdminNotificationList(), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => {
      expect(result.current.query.isError).toBe(true);
    });
    expect(result.current.query.error).toBeInstanceOf(AdminNotificationsRbacDeniedError);
  });

  it("buildAdminQueryString emits repeated severity params for multi-select", async () => {
    // Mirror the `LIVE_POLL` config pin above: the URL builder is
    // the seam where the multi-select wire shape is constructed.
    // The companion page spec covers the page-level behavior;
    // this hook-level test pins the wire shape directly.
    const { buildAdminQueryString } = await import("./useAdminNotificationList");
    expect(
      buildAdminQueryString({
        severity: ["critical", "warning"],
        since: "2026-08-28T00:00:00.000Z",
      }),
    ).toMatch(/severity=critical/);
    expect(
      buildAdminQueryString({
        severity: ["critical", "warning"],
        since: "2026-08-28T00:00:00.000Z",
      }),
    ).toMatch(/severity=warning/);
    // Only one `since` param even though the chip row doesn't
    // emit one — the URL builder must not double-encode.
    const out = buildAdminQueryString({
      severity: ["critical"],
      since: "2026-08-28T00:00:00.000Z",
    });
    expect((out.match(/since=/g) ?? []).length).toBe(1);
  });

  it("scope the cache key by filters — a severity change swaps the slot", () => {
    // Pin the filter-keyed cache contract. Two filter objects
    // with the same shape but different arrays produce distinct
    // keys; the chip toggles therefore invalidate the prior
    // entry (TanStack Query does a deep compare on the key).
    const k1 = ADMIN_NOTIFICATIONS_QUERY_KEY({});
    const k2 = ADMIN_NOTIFICATIONS_QUERY_KEY({
      severity: ["critical"],
    });
    const k3 = ADMIN_NOTIFICATIONS_QUERY_KEY({
      severity: ["warning"],
    });
    expect(k1).not.toEqual(k2);
    expect(k2).not.toEqual(k3);
  });
});
