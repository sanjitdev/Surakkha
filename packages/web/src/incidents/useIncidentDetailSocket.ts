/**
 * Mounts the `incident:state_changed` listener for the detail
 * page. Replaces the cached row's `state` in place; resolved
 * rows are kept (the detail page is read-only). Shared row-
 * update helper lives in `./cacheMutators.ts`.
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import { type IncidentPayload } from "@surakkha/shared/incident";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { connectSocket } from "../realtime/socketClient";

import { applyTransitionToCachedRow } from "./cacheMutators";

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
 * Pure helper — replaces the cached row's `state` in place via
 * the shared `applyTransitionToCachedRow` mutator. Returns
 * `prev` unchanged when the event targets a different row or
 * the cache is empty.
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
