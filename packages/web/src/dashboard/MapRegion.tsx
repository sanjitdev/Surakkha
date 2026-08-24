/**
 * `MapRegion` — Story 2.6.
 *
 * Placeholder container for the map. Story 2.7 fills in the leaflet/
 * maplibre surface; this story ships the empty container with the
 * documented testid so the DOM order, the screen-reader reach, and
 * the empty-state copy are stable.
 *
 * The empty state ("No devices") renders when the latest-readings
 * cache is empty (`readings.length === 0`). Per AC3 the surface never
 * flashes or spins; the container is a calm card with static copy.
 */
import {
  type LatestReadingsResponse,
} from "@surakkha/shared/dashboard";

interface MapRegionProps {
  readonly readings: LatestReadingsResponse["readings"];
}

export const MapRegion = ({ readings }: MapRegionProps) => {
  const isEmpty = readings.length === 0;
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
          Story 2.7 wires the real surface
        </span>
      </header>
      <div
        data-testid="dashboard-map-empty"
        className="mt-3 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
      >
        {isEmpty ? "No devices" : `${readings.length} device${readings.length === 1 ? "" : "s"} on the map`}
      </div>
    </section>
  );
};