/**
 * `MapRegion` — dashboard map region. Three states:
 *   - errored OR succeeded with zero rows → static "No devices" copy;
 *   - loading → "Loading map…" overlay (no Leaflet mount);
 *   - populated → `<MapView>` with one marker per device.
 * The realtime path is the shared `readings:latest` cache — no new
 * socket subscription here.
 */
import { type LatestReadingsResponse } from "@surakkha/shared/dashboard";

import { MapView } from "./MapView";
import { useDashboardDevices } from "./useDashboardDevices";

interface MapRegionProps {
  readonly readings: LatestReadingsResponse["readings"];
}

export const MapRegion = ({ readings }: MapRegionProps) => {
  const devicesQuery = useDashboardDevices();

  const { isError, isLoading, data } = devicesQuery;
  const devices = data?.devices ?? [];
  const isEmpty = data !== undefined && devices.length === 0;

  if (isError || isEmpty) {
    return (
      <section
        data-testid="dashboard-map-region"
        data-region="map"
        aria-label="Map"
        className="rounded-card border border-neutral-border bg-neutral-surface p-density-card"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-md font-semibold text-neutral-body">Map</h2>
        </header>
        <div
          data-testid="dashboard-map-empty"
          className="mt-3 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
        >
          No devices
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="dashboard-map-region"
      data-region="map"
      aria-label="Map"
      className="rounded-card border border-neutral-border bg-neutral-surface p-density-card"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-md font-semibold text-neutral-body">Map</h2>
        <span className="text-xs text-neutral-secondary">
          {devices.length === 1 ? "1 device on the map" : `${devices.length} devices on the map`}
        </span>
      </header>
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
    </section>
  );
};
