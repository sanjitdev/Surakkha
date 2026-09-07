/**
 * `SensorsPage` — the populated branch of `/sensors`. Three-branch
 * state separation (loading / error / empty / populated) mirroring
 * `AuditLogPage`. On populated, the page renders the real device
 * roster with live severity and last-seen.
 *
 * Severity is resolved per row in `SensorsRoster`, which joins the
 * roster with the dashboard readings cache (`useDashboardReadings`)
 * — same hook the dashboard's `LiveReadingsRegion` uses. The
 * sensors page owns no second cache; the readings cache is shared
 * with the dashboard so a single `reading:new` socket event lights
 * up both surfaces.
 *
 * `now` is injected as `Date.now()` so the row's `formatLastSeen`
 * and `resolveSensorsSeverity` resolve deterministically against the
 * same clock. The spec stubs `Date.now` directly when it needs to
 * pin a value.
 */
import {
  type LatestReadingPayload,
  type LatestReadingsResponse,
} from "@surakkha/shared/dashboard";
import { useMemo } from "react";

import { PageHeader } from "../components/PageHeader";
import { useDashboardReadings } from "../dashboard/useDashboardReadings";

import { SensorsRoster } from "./SensorsRoster";
import { useSensorsList } from "./useSensorsList";

interface SensorsStatePlaceholderProps {
  readonly testId: string;
  readonly tone: "neutral" | "critical";
  readonly children: string;
}

const SensorsStatePlaceholder = ({
  testId,
  tone,
  children,
}: SensorsStatePlaceholderProps) => (
  <p
    data-testid={testId}
    className={`rounded-input border border-dashed border-neutral-border p-6 text-center text-sm ${
      tone === "critical" ? "text-severity-critical-text" : "text-neutral-secondary"
    }`}
  >
    {children}
  </p>
);

interface SensorsErrorPanelProps {
  readonly onRetry: () => void;
}

const SensorsErrorPanel = ({ onRetry }: SensorsErrorPanelProps) => (
  <div
    data-testid="sensors-error"
    className="flex flex-col items-center gap-3 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-severity-critical-text"
  >
    <span>Unable to load devices. Retry shortly.</span>
    <button
      type="button"
      onClick={onRetry}
      data-testid="sensors-retry"
      className="rounded-input border border-primary bg-primary px-3 py-1 text-sm font-medium text-white hover:bg-primary-hover"
    >
      Retry
    </button>
  </div>
);

const buildLatestByDevice = (
  readings: LatestReadingsResponse | undefined,
): ReadonlyMap<string, LatestReadingPayload> => {
  const map = new Map<string, LatestReadingPayload>();
  if (readings === undefined) return map;
  for (const r of readings.readings) {
    map.set(r.device_id, r);
  }
  return map;
};

export const SensorsPage = () => {
  const sensorsQuery = useSensorsList();
  const readingsQuery = useDashboardReadings();
  const now = Date.now();
  const latestByDevice = useMemo(
    () => buildLatestByDevice(readingsQuery.data),
    [readingsQuery.data],
  );

  if (sensorsQuery.isLoading) {
    return (
      <div data-testid="sensors-page" className="flex flex-col gap-6">
        <PageHeader
          title="Sensors"
          description="Device roster with live severity and last-seen."
        />
        <SensorsStatePlaceholder testId="sensors-loading" tone="neutral">
          Loading devices…
        </SensorsStatePlaceholder>
      </div>
    );
  }

  if (sensorsQuery.isError) {
    return (
      <div data-testid="sensors-page" className="flex flex-col gap-6">
        <PageHeader
          title="Sensors"
          description="Device roster with live severity and last-seen."
        />
        <SensorsErrorPanel onRetry={() => void sensorsQuery.refetch()} />
      </div>
    );
  }

  if (!sensorsQuery.data || sensorsQuery.data.devices.length === 0) {
    return (
      <div data-testid="sensors-page" className="flex flex-col gap-6">
        <PageHeader
          title="Sensors"
          description="Device roster with live severity and last-seen."
        />
        <SensorsStatePlaceholder testId="sensors-empty" tone="neutral">
          No devices registered.
        </SensorsStatePlaceholder>
      </div>
    );
  }

  return (
    <div data-testid="sensors-page" className="flex flex-col gap-6">
      <PageHeader
        title="Sensors"
        description="Device roster with live severity and last-seen."
      />
      <SensorsRoster
        devices={sensorsQuery.data.devices}
        latestByDevice={latestByDevice}
        now={now}
      />
    </div>
  );
};
