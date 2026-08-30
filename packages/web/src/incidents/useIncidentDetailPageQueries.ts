/**
 * `useIncidentDetailPageQueries` — extract the two TanStack queries
 * (row + timeline) and the projected `incident` / `timeline` values
 * from `<IncidentDetailPage />` so the page component stays under
 * the `complexity: 10` lint ceiling.
 *
 * Returns the page's data-fetch layer in one bag:
 *   - `rowQuery` (TanStack Query result for `/api/incidents/:id`)
 *   - `timelineQuery` (TanStack Query result for `/api/incidents/:id/events`)
 *   - `incident` (extracted row, `undefined` while loading)
 *   - `timeline` (events array, `[]` while loading)
 *
 * No JSX, no socket subscription, no toast wiring. The page
 * composes these primitives with the rest of its render tree.
 *
 * Timeline query is gated on `id !== undefined && !rowQuery.isError`
 * so we don't fire a second request when the parent row already
 * 403'd or 404'd.
 */
import { type IncidentEventPayload } from "@surakkha/shared/incident";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  fetchIncidentDetail,
  fetchIncidentTimeline,
  type IncidentDetailEnvelope,
  type IncidentTimeline,
} from "./detailQueryFns";
import { incidentDetailQueryKey } from "./useIncidentDetailSocket";

export type IncidentDetailRowQuery = UseQueryResult<IncidentDetailEnvelope>;
export type IncidentDetailTimelineQuery = UseQueryResult<IncidentTimeline>;

interface UseIncidentDetailPageQueriesOutput {
  readonly rowQuery: IncidentDetailRowQuery;
  readonly timelineQuery: IncidentDetailTimelineQuery;
  readonly incident: IncidentDetailEnvelope["incident"] | undefined;
  readonly timeline: readonly IncidentEventPayload[];
}

export const useIncidentDetailPageQueries = (
  id: string | undefined,
): UseIncidentDetailPageQueriesOutput => {
  const idOrEmpty = id ?? "";
  const rowQuery = useQuery<IncidentDetailEnvelope>({
    queryKey: incidentDetailQueryKey(idOrEmpty),
    enabled: id !== undefined,
    queryFn: () => fetchIncidentDetail(id as string),
  });

  const timelineQuery = useQuery<IncidentTimeline>({
    queryKey: [...incidentDetailQueryKey(idOrEmpty), "events"],
    enabled: id !== undefined && !rowQuery.isError,
    queryFn: () => fetchIncidentTimeline(id as string),
  });

  const incident = rowQuery.data?.incident;

  // Project events into timeline rows. `useMemo` because the
  // projection is O(N) over the events array; re-running on every
  // render is wasteful for an operator that may park on this page
  // for minutes while inspecting a single incident.
  const timeline = useMemo<readonly IncidentEventPayload[]>(
    () => timelineQuery.data?.events ?? [],
    [timelineQuery.data?.events],
  );

  return { rowQuery, timelineQuery, incident, timeline };
};
