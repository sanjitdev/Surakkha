/**
 * `MapRegion` — Story 2.7.
 *
 * Operator dashboard's map region. Replaces the Story 2.6
 * placeholder with a real Leaflet surface (via `<MapView>`). The
 * `data-testid="dashboard-map-region"` contract is preserved so the
 * DOM order assertion in `Dashboard.spec.tsx` keeps passing.
 *
 * State transitions (the four rendering states match the AC
 * empty-state matrix):
 *
 *   - **Devices loading** → "Loading map…" overlay (no Leaflet
 *     mount). The map's container reserves the layout space so
 *     nothing shifts when the api responds.
 *   - **Devices error (5xx)** → static "No devices" empty state.
 *     The KPI band + Live Readings table keep rendering from the
 *     working readings cache — `isError` is isolated to this query.
 *   - **Devices empty (zero rows)** → static "No devices" empty
 *     state.
 *   - **Devices populated** → `<MapView>` mounts Leaflet with one
 *     marker per device, severity driven by `deviceMapSeverity()`.
 *
 * The map's realtime path is the shared `readings:latest` socket
 * stream; no new socket subscription.
 */
import {
  type LatestReadingsResponse,
} from "@surakkha/shared/dashboard";

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

  // "No devices" — errored OR succeeded with an empty list. We
  // present these through one route because the operator's
  // experience is identical (the api didn't tell us about any
  // devices). The error path is observable through TanStack Query
  // but the UI doesn't differentiate — the Story 2.9 surface owns
  // the operator-facing "DB down" copy.
  //
  // Loading state short-circuits this branch so the "Loading map…"
  // overlay renders while the query is in-flight; on a stale
  // `data?.devices ?? []` we previously flashed the empty state
  // before the api responded.
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
