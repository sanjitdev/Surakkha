/**
 * Two TanStack queries (row + timeline) for the detail page.
 * Timeline query is gated on `id !== undefined && !rowQuery.isError`
 * so a 403 / 404 on the parent row suppresses the second request.
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
  const timeline = useMemo<readonly IncidentEventPayload[]>(
    () => timelineQuery.data?.events ?? [],
    [timelineQuery.data?.events],
  );

  return { rowQuery, timelineQuery, incident, timeline };
};
