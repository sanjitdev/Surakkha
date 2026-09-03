/**
 * Dashboard wire types + placeholder severity.
 *
 * Source-of-truth surface for the operator-facing `/dashboard`. The
 * placeholder helpers derive a severity bucket from a `Reading` using
 * the healthy-range bands as a sane fallback.
 */
import type { TelemetryMetrics } from "./telemetry.js";

/** Dashboard-facing severity enum. `offline` is resolved by the absence of a reading, not by the reading itself. */
export type Severity = "healthy" | "warning" | "critical";

/** Minimum wire shape the dashboard needs to render one row in the Live Readings table. */
export interface LatestReadingPayload {
  readonly device_id: string;
  readonly name: string | null;
  readonly ts: number;
  readonly server_received_at: string;
  readonly metrics: TelemetryMetrics;
  readonly flags: readonly string[];
}

/** Wire shape of `GET /api/readings/latest`. */
export interface LatestReadingsResponse {
  readonly readings: readonly LatestReadingPayload[];
}

/** Minimum wire shape for the Recent Incidents preview. */
export interface RecentIncidentSummary {
  readonly id: string;
  readonly device_id: string;
  readonly severity: "info" | "warning" | "critical";
  readonly metric: string;
  readonly value: number;
  readonly opened_at: string;
}

export interface RecentIncidentsResponse {
  readonly incidents: readonly RecentIncidentSummary[];
}

/** Inline "healthy" ranges for the placeholder severity function. */
export const PLACEHOLDER_HEALTHY_RANGES: Readonly<
  Record<keyof TelemetryMetrics, { readonly min: number; readonly max: number }>
> = {
  ph: { min: 6.5, max: 8.5 },
  tds_ppm: { min: 0, max: 500 },
  turbidity_ntu: { min: 0, max: 1 },
  temp_c: { min: 24, max: 30 },
  chlorine_ppm: { min: 0.5, max: 1.5 },
  water_level_cm: { min: 50, max: 120 },
};

/** Severity derivation from a reading's metrics. Any out-of-range metric returns `critical`; non-finite values also return `critical`. Pure: same input → same output. */
export const placeholderSeverity = (reading: Pick<LatestReadingPayload, "metrics">): Severity => {
  const m = reading.metrics;
  for (const key of Object.keys(PLACEHOLDER_HEALTHY_RANGES) as ReadonlyArray<
    keyof TelemetryMetrics
  >) {
    const value = m[key];
    if (!Number.isFinite(value)) return "critical";
    const range = PLACEHOLDER_HEALTHY_RANGES[key];
    if (value < range.min || value > range.max) {
      return "critical";
    }
  }
  return "healthy";
};

/** Dashboard-facing severity including the `offline` bucket. */
export type MapSeverity = Severity | "offline";

/** Per-device staleness threshold — a device whose latest reading is older than this renders as `offline`. */
export const OFFLINE_THRESHOLD_MS = 60_000;

/** Wire shape of `GET /api/devices`. */
export interface DeviceSummary {
  readonly id: string;
  readonly name: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly last_reading_at: string | null;
}

export interface DevicesResponse {
  readonly devices: readonly DeviceSummary[];
}

/** Decide whether a device should render with the `offline` severity token. Pure: `now` is injected so callers control the clock. */
export const isOffline = (device: Pick<DeviceSummary, "last_reading_at">, now: number): boolean => {
  if (device.last_reading_at === null) return true;
  const ts = Date.parse(device.last_reading_at);
  if (!Number.isFinite(ts)) return true;
  return now - ts > OFFLINE_THRESHOLD_MS;
};

/** Resolve a device's map severity from its roster row + latest reading. */
export const deviceMapSeverity = (
  device: Pick<DeviceSummary, "last_reading_at">,
  latestReading: Pick<LatestReadingPayload, "metrics"> | undefined,
  now: number,
): MapSeverity => {
  if (isOffline(device, now)) return "offline";
  if (latestReading === undefined) return "offline";
  return placeholderSeverity(latestReading);
};

/** Resolve the "breached metric" — the first metric outside its `PLACEHOLDER_HEALTHY_RANGES` envelope. */
export const breachedMetric = (
  reading: Pick<LatestReadingPayload, "metrics">,
): { readonly key: keyof TelemetryMetrics; readonly value: number } | null => {
  const m = reading.metrics;
  for (const key of Object.keys(PLACEHOLDER_HEALTHY_RANGES) as ReadonlyArray<
    keyof TelemetryMetrics
  >) {
    const value = m[key];
    const range = PLACEHOLDER_HEALTHY_RANGES[key];
    if (value < range.min || value > range.max || !Number.isFinite(value)) {
      return { key, value };
    }
  }
  return null;
};
