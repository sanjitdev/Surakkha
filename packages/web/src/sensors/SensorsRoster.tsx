/**
 * `SensorsRoster` — the populated branch of `/sensors`. Renders the
 * device roster as a real `<table>` inside the polished card chrome
 * (`metric-card rounded-card border border-neutral-border
 * bg-neutral-surface p-0 shadow-elevation-card`) so the page reads
 * the same as `/admin/thresholds` and `/audit`.
 *
 * Severity is derived per-row from the readings cache (`now` is
 * injected so the spec controls the clock). Rows sort by severity
 * rank (critical → warning → healthy → offline) then by device id
 * so the worst-state devices always render at the top of the table.
 */
import {
  type DeviceSummary,
  type LatestReadingPayload,
  type MapSeverity,
} from "@surakkha/shared/dashboard";

import { SEVERITY_CLASS, SEVERITY_GLYPH } from "../dashboard/severityTokens";

import {
  formatDeviceIdShort,
  formatLastSeen,
  formatLocation,
} from "./formatLastSeen";
import { resolveSensorsSeverity } from "./resolveSensorsSeverity";

interface SensorsRosterProps {
  readonly devices: readonly DeviceSummary[];
  readonly latestByDevice: ReadonlyMap<string, LatestReadingPayload>;
  /** Injected so the spec controls the clock and severity resolves
   *  deterministically without depending on `Date.now()`. */
  readonly now: number;
}

const SEVERITY_RANK: Record<MapSeverity, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
  offline: 3,
};

const compareDevices = (
  a: { readonly device: DeviceSummary; readonly severity: MapSeverity },
  b: { readonly device: DeviceSummary; readonly severity: MapSeverity },
): number => {
  const ra = SEVERITY_RANK[a.severity];
  const rb = SEVERITY_RANK[b.severity];
  if (ra !== rb) return ra - rb;
  return a.device.id.localeCompare(b.device.id);
};

interface SensorsRowProps {
  readonly device: DeviceSummary;
  readonly severity: MapSeverity;
  readonly lastSeen: string;
  readonly location: string;
}

const SensorsRow = ({ device, severity, lastSeen, location }: SensorsRowProps) => {
  const name = device.name ?? "—";
  const shortId = formatDeviceIdShort(device.id);
  return (
    <tr
      data-testid={`sensors-row-${device.id}`}
      data-severity={severity}
      className="border-b border-neutral-border text-md text-neutral-body last:border-b-0 hover:bg-neutral-page"
    >
      <td className="px-4 py-3 font-mono text-xs text-neutral-secondary">
        {shortId}
      </td>
      <td className="px-4 py-3 text-neutral-body">{name}</td>
      <td className="px-4 py-3 font-mono tabular-nums text-xs text-neutral-secondary">
        {location}
      </td>
      <td className="px-4 py-3">
        <span
          data-testid={`sensors-severity-${device.id}`}
          className={`inline-flex items-center gap-2 rounded-pill px-2 py-0.5 text-xs text-white ${SEVERITY_CLASS[severity]}`}
        >
          <span aria-hidden className="font-mono">
            {SEVERITY_GLYPH[severity]}
          </span>
          <span className="font-medium uppercase tracking-wide">
            {severity}
          </span>
        </span>
      </td>
      <td className="px-4 py-3 text-neutral-body">{lastSeen}</td>
    </tr>
  );
};

export const SensorsRoster = ({ devices, latestByDevice, now }: SensorsRosterProps) => {
  const sorted = [...devices]
    .map((device) => ({
      device,
      severity: resolveSensorsSeverity(device, latestByDevice, now),
    }))
    .sort(compareDevices);

  return (
    <section
      aria-label="Device roster"
      className="metric-card rounded-card border border-neutral-border bg-neutral-surface p-0 shadow-elevation-card"
    >
      <table className="w-full border-collapse" data-testid="sensors-table">
        <thead>
          <tr className="border-b border-neutral-border bg-neutral-page text-xs uppercase tracking-wider text-neutral-secondary">
            <th className="px-4 py-2 text-left font-semibold">Device</th>
            <th className="px-4 py-2 text-left font-semibold">Name</th>
            <th className="px-4 py-2 text-left font-semibold">Location</th>
            <th className="px-4 py-2 text-left font-semibold">Severity</th>
            <th className="px-4 py-2 text-left font-semibold">Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ device, severity }) => (
            <SensorsRow
              key={device.id}
              device={device}
              severity={severity}
              lastSeen={formatLastSeen(device.last_reading_at, now)}
              location={formatLocation(device.lat, device.lng)}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
};