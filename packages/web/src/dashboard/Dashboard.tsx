/**
 * `Dashboard` — operator four-region shell at `/dashboard`: KPI band,
 * Map, Live Readings, Recent Incidents. Empty states render in
 * lockstep (counts default to 0; queries' `isError` falls through to
 * each region's static copy so a DB 500 doesn't unmount anything).
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
  useDashboardSocket();

  const readingsQuery = useDashboardReadings();
  const incidentsQuery = useDashboardIncidents();

  const readings = readingsQuery.data?.readings ?? [];
  const incidents = incidentsQuery.data?.incidents ?? [];

  const counts = summarizeReadings(readings);

  return (
    <div data-testid="dashboard-root" className="flex flex-col gap-4">
      <KpiBand counts={counts} />
      <MapRegion readings={readings} />
      <LiveReadingsRegion readings={readings} />
      <RecentIncidentsRegion incidents={incidents} />
    </div>
  );
};
