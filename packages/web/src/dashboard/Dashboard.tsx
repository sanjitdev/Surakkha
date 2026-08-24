/**
 * `Dashboard` — Story 2.6.
 *
 * The operator-facing four-region shell at `/dashboard`. Replaces
 * `DashboardStub` (Story 1.7) so `docker compose up` lands an
 * operator on a real surface with KPI band + Map placeholder + Live
 * Readings placeholder + Recent Incidents feed.
 *
 * Wiring (top-down):
 *   - `useDashboardSocket()` mounts the single socket subscription
 *     for `reading:new`. Mounts ONCE per `<Dashboard />` lifecycle;
 *     unmount tears down the listener (the underlying socket is
 *     module-scoped and survives via `connectSocket`).
 *   - `useDashboardReadings()` — TanStack Query for
 *     `GET /api/readings/latest`. The queryKey `["readings", "latest"]`
 *     is invalidated on every `reading:new` so the four regions
 *     re-render in lockstep within 100 ms (AC2).
 *   - `useDashboardIncidents()` — TanStack Query for
 *     `GET /api/incidents/recent?limit=10`. Separate cache key so
 *     realtime invalidation does not refetch a feed that doesn't
 *     change with `reading:new`.
 *
 * DOM order (AC1): KPI band → Map → Live Readings → Recent Incidents.
 * Tab navigation + screen-reader reading order follow the JSX.
 *
 * AC3 + AC5 + AC7 guarantee:
 *   - No conditional root swap; the four regions are always in the
 *     tree (counts default to 0, empty states render their static
 *     copy). The socket may disconnect + reconnect without
 *     unmounting this component.
 *   - `isError` from the readings query does NOT unmount the regions;
 *     `summarizeReadings([])` + the empty-state copies render in
 *     place of the data so AC7 (DB 500 → empty states) holds.
 */
import { KpiBand } from "./KpiBand";
import { LiveReadingsRegion } from "./LiveReadingsRegion";
import { MapRegion } from "./MapRegion";
import { RecentIncidentsRegion } from "./RecentIncidentsRegion";
import {
  summarizeReadings,
  useDashboardIncidents,
  useDashboardReadings,
} from "./useDashboardReadings";
import { useDashboardSocket } from "./useDashboardSocket";

export const Dashboard = () => {
  // AC2: invalidate `["readings", "latest"]` on every `reading:new`.
  // Default URL is `/api` so production + `vite dev` share the same
  // path-resolution rules (Vite proxies to the api over the same
  // origin; the cookie's `Path=/auth` requirement stays satisfied).
  useDashboardSocket();

  const readingsQuery = useDashboardReadings();
  const incidentsQuery = useDashboardIncidents();

  const readings = readingsQuery.data?.readings ?? [];
  const incidents = incidentsQuery.data?.incidents ?? [];

  // AC3 + AC7: derive counts from whatever the query currently holds.
  // On error the data is `undefined`, so `readings` defaults to `[]`
  // and `summarizeReadings([])` returns the 0/0/0/0 empty band. The
  // regions render their empty-state copy in lockstep.
  const counts = summarizeReadings(readings);

  return (
    <div
      data-testid="dashboard-root"
      className="flex flex-col gap-4"
    >
      <KpiBand counts={counts} />
      <MapRegion readings={readings} />
      <LiveReadingsRegion readings={readings} />
      <RecentIncidentsRegion incidents={incidents} />
    </div>
  );
};