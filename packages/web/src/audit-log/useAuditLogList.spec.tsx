/**
 * `useAuditLogList.spec.tsx` — Story 5.3.
 *
 * Hook-level coverage for the admin audit log read path. Mirrors
 * `useAdminNotificationList.spec.tsx` (Story 5.1):
 *
 *   - `refetchInterval: 30_000` (TanStack Query config seam).
 *   - `staleTime: 0` — the `refetchInterval` is the source of
 *     truth, not the cache TTL.
 *   - Tampered envelope → `result.current.query.isError === true`
 *     with `Error.message` matching `/malformed envelope/`.
 *   - 403 from the api throws `AdminAuditLogRbacDeniedError`
 *     (the hook-side guarantee for the page's
 *     `<RbacDenied />` fallback).
 *   - `AUDIT_LOG_QUERY_KEY` is filter-scoped — changing
 *     `actorIds` changes the cache slot.
 *
 * Loop 1 review hardening (VG finding): the previous file did
 * not exist — the LIVE_POLL I/O matrix row had no hook-level
 * coverage (the page spec exercised user-action triggers but
 * not the 30s timer or the parse step). This file pins the
 * runtime configuration seam.
 *
 * Why a SEPARATE file (vs folded into `AuditLogPage.spec.tsx`):
 *
 *   - The hook is the canonical seam for the read path's RBAC
 *     + polling contract. The page spec exercises the full DOM
 *     tree; the hook spec exercises the query config + queryFn
 *     mapping directly.
 *
 *   - Mirrors `useAdminNotificationList.spec.tsx` (5.1) and
 *     `useNotificationBell.spec.tsx` (4.10) — the TanStack
 *     `useQuery` for every read surface gets its own
 *     `use*.spec.ts` file as the canonical hook-level coverage.
 */
import { type AuditLogEntry, type AuditLogListEnvelope } from "@surakkha/shared/audit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";

import { AdminAuditLogRbacDeniedError } from "./AdminAuditLogRbacDeniedError";
import { AUDIT_LOG_QUERY_KEY, useAuditLogList } from "./useAuditLogList";

const AUDIT_ID_1 = "c1111111-1111-4111-8111-111111111111";
const ACTOR_A = "00000000-0000-4000-8000-00000000000a";

const baseEntry = (overrides: Partial<AuditLogEntry> & { id: string }): AuditLogEntry => ({
  id: overrides.id,
  actorUserId: ACTOR_A,
  auditAction: "incident_state_changed",
  resource: "Incident",
  resourceId: "99999999-9999-4999-8999-999999999999",
  payload: { from: "OPEN", to: "ACKNOWLEDGED" },
  outcome: "success",
  createdAt: "2026-08-28T11:00:00.000Z",
  ...overrides,
});

const buildEnvelope = (rows: readonly AuditLogEntry[]): AuditLogListEnvelope => ({
  rows: [...rows],
  total: rows.length,
  truncated: false,
});

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

describe("Story 5.3 — useAuditLogList read path", () => {
  it("sets refetchInterval: 30_000 — the underlying Query is configured with the 30s poll", async () => {
    installFetch(async () => ({
      status: 200,
      body: buildEnvelope([baseEntry({ id: AUDIT_ID_1 })]),
    }));
    const queryClient = buildQueryClient();
    renderHook(() => useAuditLogList(), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => {
      const queries = queryClient.getQueryCache().getAll();
      const target = queries.find(
        (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "audit-log",
      );
      if (!target) throw new Error("query not registered yet");
      expect(target.options.refetchInterval).toBe(30_000);
      expect(target.options.staleTime).toBe(0);
    });
  });

  it("rejects the hook's response shape — a tampered envelope fails the parse and surfaces an Error", async () => {
    installFetch(async () => ({
      status: 200,
      // Omit `actorUserId` from the row — a structural drift the
      // parse step must reject.
      body: {
        rows: [
          {
            id: AUDIT_ID_1,
            auditAction: "incident_state_changed",
            resource: "Incident",
            resourceId: null,
            payload: { from: "OPEN" },
            outcome: "success",
            createdAt: "2026-08-28T11:00:00.000Z",
          },
        ],
        total: 1,
        truncated: false,
      },
    }));
    const queryClient = buildQueryClient();
    const { result } = renderHook(() => useAuditLogList(), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => {
      expect(result.current.query.isError).toBe(true);
    });
    expect(result.current.query.error).toBeInstanceOf(Error);
    expect((result.current.query.error as Error).message).toMatch(/malformed envelope/);
  });

  it("throws AdminAuditLogRbacDeniedError on 403 — the page-level RbacDenied fallback seam", async () => {
    installFetch(async () => ({
      status: 403,
      body: { error: "forbidden" },
    }));
    const queryClient = buildQueryClient();
    const { result } = renderHook(() => useAuditLogList(), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => {
      expect(result.current.query.isError).toBe(true);
    });
    expect(result.current.query.error).toBeInstanceOf(AdminAuditLogRbacDeniedError);
  });

  it("scopes the cache key by filters — an actorIds change swaps the slot", () => {
    // Two filter objects with the same shape but different
    // actorIds produce distinct keys; the chip toggle therefore
    // invalidates the prior entry (TanStack Query does a deep
    // compare on the key).
    const k1 = AUDIT_LOG_QUERY_KEY({});
    const k2 = AUDIT_LOG_QUERY_KEY({ actorIds: [ACTOR_A] });
    const k3 = AUDIT_LOG_QUERY_KEY({
      actorIds: ["00000000-0000-4000-8000-00000000000b"],
    });
    expect(k1).not.toEqual(k2);
    expect(k2).not.toEqual(k3);
  });
});
