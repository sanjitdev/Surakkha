/**
 * `Dashboard` — operator four-region shell at `/dashboard`: KPI band,
 * Map, Live Readings, Recent Incidents. Empty states render in
 * lockstep (counts default to 0; queries' `isError` falls through to
 * each region's static copy so a DB 500 doesn't unmount anything).
 *
 * Layout: page heading (Dashboard + sub) sits above the four regions;
 * the Map and Live Readings pair on a 2-col grid at >= 1024px so the
 * map reads as a hero rather than a thin strip; the Recent Incidents
 * region takes the full row below. The DOM order stays
 * KPI → Map → Live Readings → Recent Incidents (Dashboard.spec.tsx
 * pins this with `compareDocumentPosition`).
 */
import { PageHeader } from "../components/PageHeader";

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
    <div data-testid="dashboard-root" className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Real-time water-safety telemetry across every connected school."
      />
      <KpiBand counts={counts} />
      <div className="grid gap-6 lg:grid-cols-2">
        <MapRegion readings={readings} />
        <LiveReadingsRegion readings={readings} />
      </div>
      <RecentIncidentsRegion incidents={incidents} />
    </div>
  );
};
