/**
 * TanStack `useQuery` over `GET /api/incidents/active`, filtered
 * for the sticky `<SeverityBanner />` display set: rows in
 * `state === "UNSAFE"` with `resolved_at === null` and
 * `opened_at` within 24h. Shares the `KANBAN_ACTIVE_QUERY_KEY`
 * so the existing socket subscriber mutates this cache on every
 * `incident:state_changed` event — no separate socket needed.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { KanbanRbacDeniedError } from "./KanbanRbacDeniedError";
import { KANBAN_ACTIVE_QUERY_KEY } from "./useKanbanBoardSocket";

const SEVERITY_BANNER_QUERY_KEY = KANBAN_ACTIVE_QUERY_KEY;

const MS_PER_HOUR = 3_600_000;
const WINDOW_24H_HOURS = 24;
const WINDOW_24H_MS = WINDOW_24H_HOURS * MS_PER_HOUR;

const HTTP_FORBIDDEN = 403;
const DEVICES_CACHE_KEY = ["devices"] as const;
const UNNAMED_DEVICE = "Unnamed device";

interface ActiveIncidentsEnvelope {
  readonly incidents: readonly IncidentPayload[];
}

/**
 * Pure filter — does this row qualify for the banner? Exported
 * for direct test coverage. `now` is parameterized for test
 * determinism.
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

export const useSeverityBanner = () => {
  const queryClient = useQueryClient();
  const query = useQuery<ActiveIncidentsEnvelope>({
    queryKey: [...SEVERITY_BANNER_QUERY_KEY],
    queryFn: bannerQueryFn,
    staleTime: Infinity,
  });
  const unsafeIncidents = filterUnsafeWithin24h(query.data?.incidents ?? []);
  const criticalCount = unsafeIncidents.length;

  // Passive reader of the `["devices"]` cache; falls back when
  // the device roster hasn't loaded yet.
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
 * Re-export the cache key for the test rig's identity pin
 * (`SeverityBanner.spec.tsx` asserts equality with
 * `KANBAN_ACTIVE_QUERY_KEY`).
 */
export const SEVERITY_BANNER_QUERY_KEY_EXPORT = SEVERITY_BANNER_QUERY_KEY;
