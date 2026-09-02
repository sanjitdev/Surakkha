/**
 * `LiveReadingsRegion` — dashboard's live-readings table. Mounts once
 * and stays mounted across socket invalidations. Rows sorted by
 * severity rank (critical → warning → healthy), then `device_id ASC`.
 * Read-only: no per-row action affordances (Epic 4 territory).
 */
import {
  type LatestReadingPayload,
  placeholderSeverity,
  type Severity,
} from "@surakkha/shared/dashboard";
import { useMemo } from "react";

import { LiveReadingsRow } from "./LiveReadingsRow";

interface LiveReadingsRegionProps {
  readonly readings: readonly LatestReadingPayload[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};

const compareRows = (a: LatestReadingPayload, b: LatestReadingPayload): number => {
  const sevA = SEVERITY_RANK[placeholderSeverity(a)];
  const sevB = SEVERITY_RANK[placeholderSeverity(b)];
  if (sevA !== sevB) return sevA - sevB;
  return a.device_id.localeCompare(b.device_id);
};

export const LiveReadingsRegion = ({ readings }: LiveReadingsRegionProps) => {
  const isEmpty = readings.length === 0;
  const sortedReadings = useMemo(() => [...readings].sort(compareRows), [readings]);

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
          {sortedReadings.length === 0
            ? "0 devices"
            : `${sortedReadings.length} device${sortedReadings.length === 1 ? "" : "s"}`}
        </span>
      </header>
      {isEmpty ? (
        <div
          data-testid="dashboard-live-readings-empty"
          className="mt-3 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
        >
          No readings yet
        </div>
      ) : (
        <div
          role="table"
          aria-label="Live readings"
          data-testid="dashboard-live-readings-table"
          className="mt-3 flex flex-col gap-2"
        >
          <div
            role="row"
            className="flex items-center gap-4 px-3 py-1 text-xs uppercase tracking-wide text-neutral-secondary"
          >
            <span role="columnheader" className="flex-1">
              Device
            </span>
            <span role="columnheader" className="w-32 shrink-0">
              Metric
            </span>
            <span role="columnheader" className="w-32 shrink-0">
              Severity
            </span>
            <span role="columnheader" className="w-20 shrink-0 text-right">
              Age
            </span>
          </div>
          {sortedReadings.map((reading) => (
            <LiveReadingsRow key={reading.device_id} reading={reading} />
          ))}
        </div>
      )}
    </section>
  );
};
