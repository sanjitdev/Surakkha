/**
 * `LiveReadingsRegion` — Story 2.6.
 *
 * Placeholder container for the Live Readings table. Story 2.8 fills
 * in the per-device row surface with metric columns and freshness
 * indicators; this story ships the empty container with the documented
 * testid + the calm "No readings yet" empty state.
 *
 * Per AC3 the surface never animates on first render — the empty-state
 * copy is static. Per AC5 the surface does NOT unmount across a socket
 * reconnect — the parent `Dashboard` mounts once and stays mounted
 * regardless of socket state.
 */
import {
  type LatestReadingsResponse,
} from "@surakkha/shared/dashboard";

interface LiveReadingsRegionProps {
  readonly readings: LatestReadingsResponse["readings"];
}

export const LiveReadingsRegion = ({ readings }: LiveReadingsRegionProps) => {
  const isEmpty = readings.length === 0;
  return (
    <section
      data-testid="dashboard-live-readings-region"
      data-region="live-readings"
      aria-label="Live Readings"
      className="rounded-card border border-neutral-border bg-neutral-surface p-density-card"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-md font-semibold text-neutral-body">Live Readings</h2>
        <span className="text-xs text-neutral-secondary">
          Story 2.8 wires the real surface
        </span>
      </header>
      <div
        data-testid="dashboard-live-readings-empty"
        className="mt-3 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
      >
        {isEmpty ? "No readings yet" : `${readings.length} reading${readings.length === 1 ? "" : "s"}`}
      </div>
    </section>
  );
};