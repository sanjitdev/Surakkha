/**
 * `LiveReadingsRegion` — Story 2.6 (shell) + Story 2.8 (table).
 *
 * Operator-facing live-readings table. Mounts once and stays
 * mounted across socket invalidations (Story 2.6 AC5 contract).
 *
 * Wire contract:
 *   - Reads the same `/api/readings/latest` payload the KPI band,
 *     map, and Story 2.7's `MapRegion` consume. The parent
 *     `Dashboard` owns the `useDashboardReadings()` hook so this
 *     region owns no socket of its own — `reading:new` events
 *     invalidate the cache and the rows re-render via the existing
 *     TanStack Query fan-out (Story 2.6 AC2).
 *   - Empty / error fallback is the static "No readings yet"
 *     string that has shipped since Story 2.6. The string contract
 *     (`data-testid="dashboard-live-readings-empty"`) does NOT
 *     change here — `Dashboard.spec.tsx` AC3 / AC7 assert against
 *     it.
 *   - Rows are sorted deterministically: severity rank
 *     (critical → warning → healthy) → `device_id ASC`. The rank
 *     keeps critical rows at the top so a freshly-tripped device
 *     is the operator's first read.
 *
 * Read-only contract (Story 2.8 AC4):
 *   - No sort control, no per-row buttons, no acknowledge / assign
 *     / submit-result affordances. Viewer / Operator / Admin all
 *     render the same surface; RBAC is enforced at the api layer
 *     via the existing RBAC matrix (`packages/shared/src/rbac.ts`).
 *   - Epic 4 owns the per-row action affordances; this story ships
 *     the read-only surface and the empty-state fallback.
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

/**
 * Severity rank. Lower number = higher visual priority at the top
 * of the table. The LiveReadingsRow derives severity via
 * `placeholderSeverity` (a 3-bucket enum: healthy | warning |
 * critical). `warning` is reserved for the Epic 3 rule engine —
 * today's data path returns only healthy or critical — but the rank
 * table includes it so a future Epic 3 binding does not have to
 * extend this file. (See Verification-Gap review VG-4.)
 */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};

const compareRows = (
  a: LatestReadingPayload,
  b: LatestReadingPayload,
): number => {
  const sevA = SEVERITY_RANK[placeholderSeverity(a)];
  const sevB = SEVERITY_RANK[placeholderSeverity(b)];
  if (sevA !== sevB) return sevA - sevB;
  return a.device_id.localeCompare(b.device_id);
};

export const LiveReadingsRegion = ({
  readings,
}: LiveReadingsRegionProps) => {
  const isEmpty = readings.length === 0;

  // Sort is a per-render `useMemo` keyed off the readings reference.
  // The parent `Dashboard` already memoizes the readings array via
  // TanStack Query; any `reading:new` invalidation produces a fresh
  // array, so the memo's dep arr is exact.
  const sortedReadings = useMemo(
    () => [...readings].sort(compareRows),
    [readings],
  );

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
            <span role="columnheader" className="flex-1">Device</span>
            <span role="columnheader" className="w-32 shrink-0">Metric</span>
            <span role="columnheader" className="w-32 shrink-0">Severity</span>
            <span role="columnheader" className="w-20 shrink-0 text-right">Age</span>
          </div>
          {sortedReadings.map((reading) => (
            <LiveReadingsRow key={reading.device_id} reading={reading} />
          ))}
        </div>
      )}
    </section>
  );
};
