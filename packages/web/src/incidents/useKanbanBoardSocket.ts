/**
 * Mounts the `incident:state_changed` listener for the Kanban
 * page. RESOLVED rows are removed from the cache (drop off the
 * board); other transitions replace the cached `state` in
 * place. The shared cache key must NOT be Tech-filtered at
 * write time (the severity banner reads the same key as a
 * global safety surface).
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import { type IncidentPayload } from "@surakkha/shared/incident";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiFetch } from "../api/apiClient";
import { connectSocket } from "../realtime/socketClient";

export const KANBAN_ACTIVE_QUERY_KEY = ["incidents", "active"] as const;

interface ActiveCacheEnvelope {
  readonly incidents: IncidentPayload[];
}

const KANBAN_SOCKET_URL = "/dashboard";

/**
 * Pure cache mutator for the active list. RESOLVED removes the
 * row; other transitions overwrite `state` in place. Returns
 * `prev` unchanged on either silent-drop path (cache empty or
 * `incident_id` not found).
 */
export const applyStateChangeToCache = (
  prev: ActiveCacheEnvelope | undefined,
  event: IncidentStateChangedEvent,
): ActiveCacheEnvelope | undefined => {
  if (prev === undefined) return prev;
  const idx = prev.incidents.findIndex((i) => i.id === event.incident_id);
  if (idx === -1) return prev;
  if (event.to_state === "RESOLVED") {
    return {
      incidents: prev.incidents.filter((_, i) => i !== idx),
    };
  }
  const current = prev.incidents[idx];
  if (current === undefined) return prev;
  const nextIncidents = prev.incidents.slice();
  nextIncidents[idx] = {
    ...current,
    state: event.to_state as IncidentPayload["state"],
  };
  return { incidents: nextIncidents };
};

export const useKanbanBoardSocket = (url: string = KANBAN_SOCKET_URL): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = connectSocket({ url }, { onSessionLost: () => undefined });

    const handleStateChange = (payload: IncidentStateChangedEvent): void => {
      queryClient.setQueryData<ActiveCacheEnvelope>([...KANBAN_ACTIVE_QUERY_KEY], (prev) =>
        applyStateChangeToCache(prev, payload),
      );
    };

    socket.on("incident:state_changed", handleStateChange);
    return () => {
      socket.off("incident:state_changed", handleStateChange);
    };
  }, [queryClient, url]);
};

/**
 * Fallback fetcher — resolves an incident's wire row by id when
 * a socket event arrives before the active list has loaded.
 * Exported for the test rig (production uses the cache hit path).
 */
export const _fetchIncidentForBoard = async (id: string): Promise<IncidentPayload | null> => {
  const res = await apiFetch(`/api/incidents/${id}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { incident?: IncidentPayload } & IncidentPayload;
  if ("incidents" in body) return null;
  return body;
};
