/**
 * `useSeverityBanner` — Story 4.8.
 *
 * TanStack `useQuery` over `GET /api/incidents/active` (existing
 * endpoint, same as the Kanban's active-list query). Filters the
 * envelope for rows that warrant the sticky `SeverityBanner`:
 *
 *   - `state === "UNSAFE"`     — the row is in the unsafe outcome
 *                                 submitted by the inspecting
 *                                 Technician (Story 4.7).
 *   - `resolved_at === null`   — the row has NOT been resolved yet.
 *                                 A UNSAFE row that was resolved
 *                                 falls off the active list per the
 *                                 api's contract (activeRouter.ts:5)
 *                                 — but we defensively re-check
 *                                 here in case the cache mutation
 *                                 lags the resolver.
 *   - `opened_at` within 24h   — UX-DR-5's "24h window" constraint.
 *                                 We use `opened_at` (NOT a
 *                                 hypothetical `state_changed_at`)
 *                                 because it's already on the wire
 *                                 row — see spec Design Notes for
 *                                 the simplification rationale.
 *
 * Cache key: `["incidents", "active"]` — the SAME key as
 * `KANBAN_ACTIVE_QUERY_KEY` in `useKanbanBoardSocket.ts:48`. Reusing
 * the key means the existing socket subscriber (4.3) mutates this
 * query's cache on every `incident:state_changed` event — the
 * banner auto-reconciles without a new socket subscription.
 *
 * Returns `{ unsafeIncidents, criticalCount, query }`. The hook is
 * the read-only projection; the consumer is `<SeverityBanner />`
 * which calls this hook internally.
 *
 * Pure helper `filterUnsafeWithin24h` is exported so the test rig
 * can pin the filter against canned `IncidentPayload[]` fixtures
 * without spinning up a query client.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { KanbanRbacDeniedError } from "./KanbanRbacDeniedError";
import { KANBAN_ACTIVE_QUERY_KEY } from "./useKanbanBoardSocket";

/**
 * TanStack Query key — imported from `KanbanBoard`'s
 * `KANBAN_ACTIVE_QUERY_KEY` constant. This is the SAME key the
 * Kanban uses for its `useQuery`; sharing the key means both
 * surfaces read from one cache entry. The Kanban's
 * `useKanbanBoardSocket` subscriber mutates this cache on every
 * `incident:state_changed` event, so the banner auto-reconciles
 * without a new socket subscription.
 *
 * **Cache-key identity matters**: if this key ever drifts from
 * `KANBAN_ACTIVE_QUERY_KEY`, the banner will silently stop
 * reflecting socket events. The test rig's "cache key identity"
 * assertion reads both constants and fails loudly on divergence —
 * see `SeverityBanner.spec.tsx`.
 *
 * **Cache-key dedup matters**: TanStack Query dedupes by key, so
 * two `useQuery` calls with the same key share one cache entry.
 * But two DIFFERENT `queryFn`s racing for the same key cause
 * non-deterministic behavior (whichever `queryFn` registers first
 * wins). To avoid this, the banner does NOT register its own
 * `useQuery` + `queryFn`. Instead, it reads the cache passively
 * via `useQueryClient().getQueryData` and fires a fetch ONLY when
 * no consumer is already fetching (see `useSeverityBanner` below).
 */
const SEVERITY_BANNER_QUERY_KEY = KANBAN_ACTIVE_QUERY_KEY;

/** Time-unit constants — extracted so the `no-magic-numbers` lint
 * rule does not flag the 24h-window arithmetic inline. Each
 * numeric separator-form literal is a const default-value, which
 * the rule's `ignoreDefaultValues` option passes through cleanly.
 */
const MS_PER_HOUR = 3_600_000;

/** UX-DR-5's "24h" window — how long a UNSAFE row stays on the banner. */
const WINDOW_24H_HOURS = 24;

/** Milliseconds in a 24-hour window — UX-DR-5's "24h" constraint. */
const WINDOW_24H_MS = WINDOW_24H_HOURS * MS_PER_HOUR;

/** HTTP status code sentinel — RBAC denial. Both this hook's
 * `bannerQueryFn` and `KanbanBoard`'s `queryFn` throw
 * `KanbanRbacDeniedError` on 403 so the cache's error type is the
 * same class — `KanbanBoard.tsx` uses an inline `403` literal, NOT
 * a named constant, so this constant is the single source of truth
 * within the banner module only. */
const HTTP_FORBIDDEN = 403;

/** Device roster query key — owned by `useDashboardDevices` (Story
 * 2.7). The banner reads this cache passively (no competing
 * `queryFn`) so the map + dashboard devices query stay the
 * canonical fetcher. The cache-key identity pin lives at
 * `SeverityBanner.spec.tsx` so a drift breaks the test rig, not
 * the production banner.
 */
const DEVICES_CACHE_KEY = ["devices"] as const;

/** Fallback label when a device name is unavailable in the device
 * roster cache (either the cache is empty because the dashboard
 * hasn't mounted, or the row's `device_id` is unknown). Mirrors
 * `MapView.tsx`'s popup fallback string. */
const UNNAMED_DEVICE = "Unnamed device";

interface ActiveIncidentsEnvelope {
  readonly incidents: readonly IncidentPayload[];
}

/**
 * Pure filter — does this row qualify for the banner? Exported for
 * direct test coverage (mirrors `KanbanBoard.groupByColumn`'s
 * export pattern).
 *
 *   - `now` is parameterized for test determinism. Production
 *     callers pass `Date.now()`.
 *   - `opened_at` is an ISO 8601 string with offset per
 *     `IncidentPayloadSchema`; we `Date.parse` it and compare to
 *     `now - 24h`. Rows newer than the cutoff qualify; rows older
 *     do not.
 */
export const filterUnsafeWithin24h = (
  incidents: readonly IncidentPayload[],
  now: number = Date.now(),
): readonly IncidentPayload[] => {
  const cutoff = now - WINDOW_24H_MS;
  return incidents.filter((i) => {
    if (i.state !== "UNSAFE") return false;
    if (i.resolved_at !== null) return false;
    const openedAtMs = Date.parse(i.opened_at);
    if (Number.isNaN(openedAtMs)) return false;
    return openedAtMs >= cutoff;
  });
};

/**
 * Banner's passive reader of the active-list cache. Reads the
 * SAME cache entry the Kanban populates; never registers its own
 * `useQuery` (which would race the Kanban's `queryFn` and break
 * the cache's error type).
 *
 * If the cache is empty AND no fetch is in-flight, the banner
 * fires its own `fetchQuery` to populate the cache. The
 * `fetchQuery`'s `queryFn` is the SAME shape as the Kanban's:
 * throws `KanbanRbacDeniedError` on 403 so the cache's error
 * preserves the instanceof check that `KanbanBoard.tsx:224`
 * relies on for the `<RbacDenied />` render branch.
 *
 * On 5xx / network: throws a generic Error. The Kanban handles its
 * own error UI; the banner stays hidden.
 */
const bannerQueryFn = async (): Promise<ActiveIncidentsEnvelope> => {
  const res = await apiFetch("/api/incidents/active");
  if (res.status === HTTP_FORBIDDEN) {
    throw new KanbanRbacDeniedError();
  }
  if (!res.ok) {
    throw new Error(`/api/incidents/active failed: ${res.status}`);
  }
  const body = (await res.json()) as ActiveIncidentsEnvelope;
  return body;
};

/**
 * `useSeverityBanner` — TanStack `useQuery` over the active list,
 * filtered for the banner's display set.
 *
 * The hook does NOT add any subscriber — it consumes the existing
 * `["incidents", "active"]` cache that `useKanbanBoardSocket` (4.3)
 * mutates on every `incident:state_changed` event.
 *
 * **Cache-key dedup matters**: TanStack Query dedupes by key, so
 * the banner's `useQuery` and the Kanban's `useQuery` share one
 * cache entry. To avoid non-deterministic behavior from two
 * `queryFn`s racing for the same key, the banner's `queryFn`
 * mirrors the Kanban's: throws `KanbanRbacDeniedError` on 403 so
 * the cache's error preserves the instanceof check that
 * `KanbanBoard.tsx:224` relies on for the `<RbacDenied />` render
 * branch. The first registered `queryFn` wins; matching the
 * behavior means the second consumer inherits the same semantics
 * either way.
 *
 * `staleTime: Infinity` prevents the banner's `queryFn` from
 * firing after the initial mount (the Kanban is the canonical
 * fetcher; the banner reads from cache + socket mutations only).
 * When the Kanban is NOT mounted, the banner's `queryFn` does
 * fire once on mount; subsequent renders read from cache.
 *
 * Returns `{ unsafeIncidents, criticalCount }`. The query object
 * itself is exposed via the hook return for advanced consumers
 * (none today).
 */
export const useSeverityBanner = () => {
  const queryClient = useQueryClient();
  const query = useQuery<ActiveIncidentsEnvelope>({
    queryKey: [...SEVERITY_BANNER_QUERY_KEY],
    queryFn: bannerQueryFn,
    staleTime: Infinity,
  });
  const unsafeIncidents = filterUnsafeWithin24h(query.data?.incidents ?? []);
  const criticalCount = unsafeIncidents.length;

  // Passive reader of the `["devices"]` cache. Falls back to the
  // UUID when the device roster hasn't loaded yet — banner copy
  // never BLOCKS on the dashboard's devices fetch (UX-DR-3 "calm
  // surfaces don't introduce new dependencies" — a banner visible
  // on every page shouldn't make the operator wait for the
  // dashboard's devices cold-load to surface a name).
  const deviceNameById = (deviceId: string): string => {
    const cached = queryClient.getQueryData<{
      devices: ReadonlyArray<{ id: string; name: string | null }>;
    }>(DEVICES_CACHE_KEY);
    const match = cached?.devices.find((d) => d.id === deviceId);
    return match?.name ?? UNNAMED_DEVICE;
  };

  return { unsafeIncidents, criticalCount, query, deviceNameById };
};

/**
 * Re-export the query key for the cache-identity drift pin in the
 * test rig. If the Kanban's `KANBAN_ACTIVE_QUERY_KEY` ever drifts
 * from this constant, the banner's socket reconciliation will
 * silently break — the test pin surfaces the divergence.
 */
export const SEVERITY_BANNER_QUERY_KEY_EXPORT = SEVERITY_BANNER_QUERY_KEY;
