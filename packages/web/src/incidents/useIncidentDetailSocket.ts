/**
 * `useIncidentDetailSocket` — Story 4.4.
 *
 * Mounts the `incident:state_changed` listener on the active
 * socket for the lifetime of the `<IncidentDetailPage />`. On
 * every event:
 *
 *   1. Look up the affected incident's current row in the
 *      `["incidents", "detail", id]` TanStack Query cache.
 *   2. If the row's id matches the event's `incident_id`,
 *      replace the row's `state` in place — the row stays
 *      visible even on `RESOLVED` (the detail page is read-only;
 *      resolved incidents are first-class).
 *   3. If the row's id does NOT match (e.g., a stale event for
 *      a different incident), drop the event silently.
 *
 * Why KEEP resolved rows on the detail page (different from the
 * Kanban's drop-on-RESOLVED): the detail page is the operator's
 * "what happened with this incident" surface. Resolved incidents
 * have a `resolved_at` timestamp and a `resolve` event in the
 * timeline; they're legitimate to inspect after the fact.
 *
 * Listener scope is page-scoped — the detail page unmounts when
 * the operator navigates away, the listener tears down with it.
 * Mirrors `useKanbanBoardSocket.ts:104-121`.
 *
 * The shared row-update shape (`applyTransitionToCachedRow`)
 * lives in `./cacheMutators.ts` so the Kanban and detail hooks
 * don't drift.
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import { type IncidentPayload } from "@surakkha/shared/incident";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { connectSocket } from "../realtime/socketClient";

import { applyTransitionToCachedRow } from "./cacheMutators";

/**
 * The shared TanStack Query key for the per-incident detail
 * fetch. `IncidentDetailPage` uses the same key for its initial
 * fetch; this hook mutates the same cache so the page's render
 * stays the single source of truth.
 */
export const INCIDENT_DETAIL_QUERY_KEY_PREFIX = "incidents" as const;

export const incidentDetailQueryKey = (id: string): readonly unknown[] => [
  INCIDENT_DETAIL_QUERY_KEY_PREFIX,
  "detail",
  id,
];

const DEFAULT_SOCKET_URL = "/dashboard";

interface DetailCacheEnvelope {
  readonly incident: IncidentPayload;
}

/**
 * Mutate the per-incident detail cache to reflect a single
 * `incident:state_changed` event. Pure helper (no React, no
 * socket). Returns:
 *   - `"mutated"` if the row's `state` was replaced in place.
 *   - `"dropped"` if the event's `incident_id` does not match
 *     the cached row (no-op).
 *   - `"undefined"` if the cache itself is undefined (no
 *     initial fetch yet).
 */
export const applyStateChangeToDetailCache = (
  prev: DetailCacheEnvelope | undefined,
  event: IncidentStateChangedEvent,
): DetailCacheEnvelope | undefined => {
  if (prev === undefined) return prev;
  const next = applyTransitionToCachedRow(prev.incident, event);
  if (next === null) return prev;
  return { incident: next };
};

/**
 * Mount the detail-page realtime subscription. Returns nothing —
 * the side-effect is the sole purpose of this hook.
 *
 * `id` is the incident's UUID; `url` defaults to `/dashboard`
 * so the hook works in production without call-site configuration.
 * Tests pass a stub `url` (the socket itself is mocked at the
 * network layer via the `connectSocket` vi.mock pattern).
 */
export const useIncidentDetailSocket = (id: string, url: string = DEFAULT_SOCKET_URL): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = connectSocket({ url }, { onSessionLost: () => undefined });

    const handleStateChange = (payload: IncidentStateChangedEvent): void => {
      queryClient.setQueryData<DetailCacheEnvelope>([...incidentDetailQueryKey(id)], (prev) =>
        applyStateChangeToDetailCache(prev, payload),
      );
    };

    socket.on("incident:state_changed", handleStateChange);
    return () => {
      socket.off("incident:state_changed", handleStateChange);
    };
  }, [queryClient, id, url]);
};
