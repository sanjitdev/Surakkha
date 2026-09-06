/**
 * `MapRegion` — dashboard map region. Three states:
 *   - errored OR succeeded with zero rows → static "No devices" copy;
 *   - loading → "Loading map…" overlay (no Leaflet mount);
 *   - populated → `<MapView>` with one marker per device.
 * The realtime path is the shared `readings:latest` cache — no new
 * socket subscription here.
 */
import { type LatestReadingsResponse } from "@surakkha/shared/dashboard";

import { RegionCard } from "../components/RegionCard";

import { MapView } from "./MapView";
import { useDashboardDevices } from "./useDashboardDevices";

interface MapRegionProps {
  readonly readings: LatestReadingsResponse["readings"];
}

const CountChip = ({ count }: { readonly count: number }) => (
  <span
    data-testid="dashboard-map-count"
    className="rounded-pill bg-neutral-page px-2 py-0.5 text-xs text-neutral-secondary"
  >
    {count === 1 ? "1 device on the map" : `${count} devices on the map`}
  </span>
);

const EmptyCard = () => (
  <RegionCard title="Map" region="map" testId="dashboard-map-region">
    <div
      data-testid="dashboard-map-empty"
      className="mt-3 rounded-input border border-dashed border-neutral-border py-8 text-center text-sm text-neutral-secondary"
    >
      No devices
    </div>
  </RegionCard>
);

export const MapRegion = ({ readings }: MapRegionProps) => {
  const devicesQuery = useDashboardDevices();

  const { isError, isLoading, data } = devicesQuery;
  const devices = data?.devices ?? [];
  const isEmpty = data !== undefined && devices.length === 0;

  if (isError || isEmpty) {
    return <EmptyCard />;
  }

  return (
    <RegionCard
      title="Map"
      region="map"
      testId="dashboard-map-region"
      rightSlot={<CountChip count={devices.length} />}
    >
      <div className="relative mt-3">
        {isLoading ? (
          <div
            data-testid="dashboard-map-loading"
            className="flex h-[420px] w-full items-center justify-center rounded-input border border-dashed border-neutral-border bg-neutral-surface text-sm text-neutral-secondary"
          >
            Loading map…
          </div>
        ) : (
          <MapView devices={devices} readings={readings} />
        )}
      </div>
    </RegionCard>
  );
};
