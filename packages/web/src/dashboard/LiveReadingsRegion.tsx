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

import { RegionCard } from "../components/RegionCard";

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

const CountChip = ({ count }: { readonly count: number }) => (
  <span
    data-testid="dashboard-live-readings-count"
    className="rounded-pill bg-neutral-page px-2 py-0.5 text-xs text-neutral-secondary"
  >
    {count === 0 ? "0 devices" : `${count} device${count === 1 ? "" : "s"}`}
  </span>
);

export const LiveReadingsRegion = ({ readings }: LiveReadingsRegionProps) => {
  const isEmpty = readings.length === 0;
  const sortedReadings = useMemo(() => [...readings].sort(compareRows), [readings]);

  return (
    <RegionCard
      title="Live Readings"
      region="live-readings"
      testId="dashboard-live-readings-region"
      rightSlot={
        <>
          {/* "LIVE" pulse indicator — primary-coloured 8px dot with the
              `live-pulse` motion token (1200ms transient outline).
              Tells the operator this surface is realtime without
              needing to read the label. */}
          <span
            aria-hidden
            data-testid="dashboard-live-readings-pulse"
            className="mr-2 inline-block size-2 rounded-full bg-primary animate-live-pulse"
          />
          <span className="mr-3 text-xs font-semibold uppercase tracking-wide text-primary">
            Live
          </span>
          <CountChip count={sortedReadings.length} />
        </>
      }
    >
      {isEmpty ? (
        <div
          data-testid="dashboard-live-readings-empty"
          className="mt-3 rounded-input border border-dashed border-neutral-border py-8 text-center text-sm text-neutral-secondary"
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
            className="flex items-center gap-4 border-b border-neutral-border px-3 pb-2 text-xs uppercase tracking-wide text-neutral-secondary"
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
    </RegionCard>
  );
};
