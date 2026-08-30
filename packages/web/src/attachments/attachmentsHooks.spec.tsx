/**
 * `attachmentsHooks.spec.tsx` — Story 4.13.
 *
 * Mutation- + cache-level coverage for the three attachments
 * hooks (`useAttachments`, `useCreateAttachment`,
 * `useDeleteAttachment`). Mirrors the test rig pattern from
 * `useMarkAsRead.spec.tsx` (Story 4.10):
 *
 *   - `useAttachments` — TanStack `useQuery` against
 *     `GET /api/incidents/:id/attachments`. The query key is
 *     `ATTACHMENTS_QUERY_KEY(incidentId)` — pinned by AC contract
 *     so a future regression that mutates the key (e.g., drops
 *     the `"attachments"` suffix and collides with the row
 *     cache) fails here.
 *   - `useCreateAttachment` — `useMutation` over
 *     `POST /api/incidents/:id/attachments`. Success →
 *     `queryClient.invalidateQueries({ queryKey: cacheKey })`.
 *   - `useDeleteAttachment` — `useMutation` over
 *     `DELETE /api/attachments/:id`. Success → same invalidation.
 *
 * The "no socket / no notification" contract is enforced at the
 * BACKEND (see `attachmentRouter.spec.ts`); these tests pin the
 * WEB side: the section's invalidation-on-success contract.
 *
 * Why a SEPARATE file (vs folded into AttachmentsSection.spec.tsx):
 *   - The hooks are the canonical seam for the cache key +
 *     invalidation contract. The section component spec exercises
 *     the DOM tree; the hooks spec exercises the mutation/cache
 *     behavior in isolation. Two test surfaces, two failure
 *     modes — a regression that swapped the cache key from
 *     `["incidents","detail",id,"attachments"]` to a different
 *     prefix would fail HERE before the section's refetch could
 *     surface it as a UI bug.
 */
import { type AttachmentListEnvelope, type AttachmentPayload } from "@surakkha/shared/attachment";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";

import { ATTACHMENTS_QUERY_KEY, useAttachments } from "./useAttachments";
import { useCreateAttachment } from "./useCreateAttachment";
import { useDeleteAttachment } from "./useDeleteAttachment";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT_ID = "22222222-2222-4222-8222-222222222201";

const baseAttachment = (overrides: Partial<AttachmentPayload> = {}): AttachmentPayload => ({
  id: ATTACHMENT_ID,
  incident_id: INCIDENT_ID,
  url: "https://example.com/photo.png",
  label: "Sensor photo",
  mime: "image/png",
  uploaded_by_user_id: null,
  created_at: "2026-08-28T00:00:00.000Z",
  ...overrides,
});

const buildEnvelope = (attachments: readonly AttachmentPayload[]): AttachmentListEnvelope => ({
  attachments,
});

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
 * `useAttachments` — cache key + fetch behavior.
 *
 * The cache key is the contract surface: a regression that
 * dropped the `"attachments"` suffix would collide with the
 * detail-page row cache (TanStack would resolve the query
 * against the row data and return the wrong shape). The key is
 * pinned here as a value-equality assertion on the exported
 * `ATTACHMENTS_QUERY_KEY(incidentId)` factory.
 */
describe("Story 4.13 — AC: useAttachments cache identity", () => {
  it("ATTACHMENTS_QUERY_KEY returns the canonical detail-page cache prefix", () => {
    // The key shape is `["incidents", "detail", incidentId,
    // "attachments"]`. Pinned so a regression that drops the
    // "attachments" suffix (collides with the row cache) fails
    // here.
    const key = ATTACHMENTS_QUERY_KEY(INCIDENT_ID);
    expect(key).toEqual(["incidents", "detail", INCIDENT_ID, "attachments"]);
  });

  it("ATTACHMENTS_QUERY_KEY is stable for the same incidentId (factory purity)", () => {
    // Two calls with the same id must produce equal arrays
    // (TanStack uses referential equality on the key tuple).
    const a = ATTACHMENTS_QUERY_KEY(INCIDENT_ID);
    const b = ATTACHMENTS_QUERY_KEY(INCIDENT_ID);
    expect(a).toEqual(b);
  });

  it("ATTACHMENTS_QUERY_KEY differs across incident ids (no cross-incident cache leakage)", () => {
    // Two different ids must produce different keys (a regression
    // that hard-coded the id or dropped it from the prefix
    // would fail here).
    const a = ATTACHMENTS_QUERY_KEY("id-a");
    const b = ATTACHMENTS_QUERY_KEY("id-b");
    expect(a).not.toEqual(b);
  });

  it("useAttachments fires GET /api/incidents/:id/attachments on mount", async () => {
    let observedUrl: string | null = null;
    installFetch(async (url) => {
      observedUrl = url;
      return { status: 200, body: buildEnvelope([baseAttachment()]) };
    });

    const queryClient = buildQueryClient();
    const { result } = renderHook(() => useAttachments(INCIDENT_ID), {
      wrapper: wrap(queryClient),
    });

    await waitFor(() => {
      expect(result.current.attachments.length).toBe(1);
    });
    expect(observedUrl).toBe(`https://api.test/api/incidents/${INCIDENT_ID}/attachments`);
  });
});

/**
 * `useCreateAttachment` — invalidation contract on success.
 *
 * On 201 the mutation calls
 * `queryClient.invalidateQueries({ queryKey: ATTACHMENTS_QUERY_KEY(id) })`
 * so the section refetches the new row. A regression that
 * omitted the invalidation would leave the row out of the
 * dropdown until the next manual refetch.
 */
describe("Story 4.13 — AC: useCreateAttachment invalidation", () => {
  it("POST 201 invalidates the attachments cache key", async () => {
    const queryClient = buildQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    installFetch(async (url, init) => {
      if (init?.method === "POST") {
        return { status: 201, body: baseAttachment() };
      }
      return { status: 200, body: buildEnvelope([]) };
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useCreateAttachment(INCIDENT_ID, { onError }), {
      wrapper: wrap(queryClient),
    });

    result.current.mutate({ url: "https://example.com/x.png" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // The invalidation was called with the canonical cache key
    // (exact-value match — TanStack uses deep-equal on the
    // queryKey array).
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ATTACHMENTS_QUERY_KEY(INCIDENT_ID),
    });
  });

  it("POST 400 surfaces the 'Invalid URL or payload' toast (no invalidation)", async () => {
    const queryClient = buildQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    installFetch(async (url, init) => {
      if (init?.method === "POST") {
        return { status: 400, body: { error: "invalid_payload" } };
      }
      return { status: 200, body: buildEnvelope([]) };
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useCreateAttachment(INCIDENT_ID, { onError }), {
      wrapper: wrap(queryClient),
    });

    result.current.mutate({ url: "https://example.com/x" });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(onError).toHaveBeenCalledWith("Invalid URL or payload");
    // 4xx: no invalidation (the row wasn't created, the list is
    // unchanged).
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("POST 403 surfaces the 'Not authorized' toast (no invalidation)", async () => {
    const queryClient = buildQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    installFetch(async (url, init) => {
      if (init?.method === "POST") {
        return { status: 403, body: { error: "forbidden" } };
      }
      return { status: 200, body: buildEnvelope([]) };
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useCreateAttachment(INCIDENT_ID, { onError }), {
      wrapper: wrap(queryClient),
    });

    result.current.mutate({ url: "https://example.com/x" });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(onError).toHaveBeenCalledWith("Not authorized");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

/**
 * `useDeleteAttachment` — invalidation contract on success
 * AND on 403/404 (defensive — refetch surfaces the truth).
 */
describe("Story 4.13 — AC: useDeleteAttachment invalidation", () => {
  it("DELETE 204 invalidates the attachments cache key (server is source of truth)", async () => {
    const queryClient = buildQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    installFetch(async (url, init) => {
      if (init?.method === "DELETE") {
        return { status: 204, body: null };
      }
      return { status: 200, body: buildEnvelope([]) };
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useDeleteAttachment(INCIDENT_ID, { onError }), {
      wrapper: wrap(queryClient),
    });

    result.current.mutate(ATTACHMENT_ID);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ATTACHMENTS_QUERY_KEY(INCIDENT_ID),
    });
  });

  it("DELETE 403 invalidates AND surfaces 'Not authorized' toast (defensive refetch)", async () => {
    // A cross-row RBAC denial (Operator trying to delete another
    // Operator's attachment) may indicate a stale cache. The
    // mutation invalidates the list query so the next refetch
    // surfaces the truth. The toast copy is "Not authorized".
    const queryClient = buildQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    installFetch(async (url, init) => {
      if (init?.method === "DELETE") {
        return { status: 403, body: { error: "forbidden" } };
      }
      return { status: 200, body: buildEnvelope([]) };
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useDeleteAttachment(INCIDENT_ID, { onError }), {
      wrapper: wrap(queryClient),
    });

    result.current.mutate(ATTACHMENT_ID);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ATTACHMENTS_QUERY_KEY(INCIDENT_ID),
    });
    expect(onError).toHaveBeenCalledWith("Not authorized");
  });

  it("DELETE 404 invalidates AND surfaces 'Attachment not found' toast (vanished row)", async () => {
    // The row vanished (another tab deleted it). The mutation
    // invalidates the list query so the next refetch drops the
    // phantom row from the dropdown.
    const queryClient = buildQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    installFetch(async (url, init) => {
      if (init?.method === "DELETE") {
        return { status: 404, body: { error: "not_found" } };
      }
      return { status: 200, body: buildEnvelope([]) };
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useDeleteAttachment(INCIDENT_ID, { onError }), {
      wrapper: wrap(queryClient),
    });

    result.current.mutate(ATTACHMENT_ID);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ATTACHMENTS_QUERY_KEY(INCIDENT_ID),
    });
    expect(onError).toHaveBeenCalledWith("Attachment not found");
  });

  it("DELETE 5xx surfaces the retryable toast AND does NOT invalidate", async () => {
    // The row is presumed unchanged on a server error; the
    // operator may retry. No invalidation (no point refetching
    // a row that didn't actually change).
    const queryClient = buildQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    installFetch(async (url, init) => {
      if (init?.method === "DELETE") {
        return { status: 500, body: { error: "internal_error" } };
      }
      return { status: 200, body: buildEnvelope([]) };
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useDeleteAttachment(INCIDENT_ID, { onError }), {
      wrapper: wrap(queryClient),
    });

    result.current.mutate(ATTACHMENT_ID);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(onError).toHaveBeenCalledWith("Failed to delete attachment. Try again.");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
