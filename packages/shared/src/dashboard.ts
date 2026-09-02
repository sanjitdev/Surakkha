/**
 * Dashboard wire types + placeholder severity.
 *
 * Source-of-truth surface for the operator-facing `/dashboard`.
 * `placeholderSeverity` is a TEMPORARY helper that derives a
 * severity bucket from a `Reading` using hard-reject ranges as a
 * sane fallback. The rule-driven engine replaces this in Story 3.5;
 * callers should treat the returned value as ephemeral and re-fetch
 * via `placeholderSeverity` on every render rather than memoizing.
 */
import type { TelemetryMetrics } from "./telemetry.js";

/** Dashboard-facing severity enum. `offline` is resolved by the
 *  absence of a reading, not by the reading itself, so the placeholder
 *  severity function never returns it. */
export type Severity = "healthy" | "warning" | "critical";

/** Minimum wire shape the dashboard needs to render one row in the
 *  Live Readings table + a corresponding KPI count. `name` is the
 *  device's human label (nullable for legacy rows). `metrics` and
 *  `flags` mirror the api→web `reading:new` event shape so the REST
 *  initial-load path and the realtime path are interchangeable. */
export interface LatestReadingPayload {
  readonly device_id: string;
  readonly name: string | null;
  readonly ts: number;
  readonly server_received_at: string;
  readonly metrics: TelemetryMetrics;
  readonly flags: readonly string[];
}

/** Wire shape of `GET /api/readings/latest`. `readings` is the
 *  latest reading per device, ordered by `server_received_at DESC`. */
export interface LatestReadingsResponse {
  readonly readings: readonly LatestReadingPayload[];
}

/** Minimum wire shape for the Recent Incidents preview. The endpoint
 *  currently returns `{ incidents: [] }` so the dashboard can render
 *  the empty state without a wire drift; Story 4.2 expands this. */
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

/** Inline "healthy" ranges for the placeholder severity function.
 *  Story 3.3 seeds the canonical `Rule` table from these same bands;
 *  Story 3.5 then replaces this helper with the rule-driven engine. */
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

/** TEMPORARY severity derivation — placeholder until the rule-driven
 *  engine lands.
 *  - Any metric outside its `PLACEHOLDER_HEALTHY_RANGES` envelope returns
 *    `critical`.
 *  - Otherwise `healthy`.
 *  - `warning` is reserved; no current path returns it.
 *
 *  `NaN` / `Infinity` are NOT out-of-range here — the wire contract
 *  rejects them at parse time. If a future path delivers a non-finite
 *  value, conservatively returns `critical` (silent NaN = the metric
 *  is wrong; surfacing that as critical is the safe default).
 *
 *  Pure: same input → same output. No I/O, no clocks, no globals. */
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

/** Dashboard-facing severity including the `offline` bucket. The
 *  map's offline threshold can surface a device whose `last_reading_at`
 *  lapsed as `offline`. `placeholderSeverity` keeps the three-bucket
 *  shape; the KPI band + map route through this combined enum and
 *  resolve `offline` via `isOffline()`. */
export type MapSeverity = Severity | "offline";

/** Per-device staleness threshold. A device whose latest reading is
 *  older than this — or has never emitted — renders with the `offline`
 *  severity token. The simulator ticks every 2 s; 60 s = 30× a normal
 *  tick (clearly lapsed). */
export const OFFLINE_THRESHOLD_MS = 60_000;

/** Wire shape of `GET /api/devices`. One row per Device, joined to
 *  `MAX(Reading.serverReceivedAt)`. `last_reading_at` is `null` when
 *  a device has never connected — the map renders these in the
 *  `offline` token ("No reading yet"). */
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

/** Decide whether a device should render with the `offline` severity
 *  token. Returns `true` when the device has never connected
 *  (`last_reading_at === null`), OR the most recent reading lapsed
 *  more than `OFFLINE_THRESHOLD_MS` before `now`. Pure: same input
 *  → same output. `now` is injected so callers control the clock. */
export const isOffline = (device: Pick<DeviceSummary, "last_reading_at">, now: number): boolean => {
  if (device.last_reading_at === null) return true;
  const ts = Date.parse(device.last_reading_at);
  if (!Number.isFinite(ts)) return true;
  return now - ts > OFFLINE_THRESHOLD_MS;
};

/** Resolve a device's map severity from its roster row + latest reading.
 *  The map's marker colour is driven by this function so the same
 *  "worst-current-bucket" rule the KPI band uses drives the map. */
export const deviceMapSeverity = (
  device: Pick<DeviceSummary, "last_reading_at">,
  latestReading: Pick<LatestReadingPayload, "metrics"> | undefined,
  now: number,
): MapSeverity => {
  if (isOffline(device, now)) return "offline";
  if (latestReading === undefined) return "offline";
  return placeholderSeverity(latestReading);
};

/** Resolve the "breached metric" — the first metric outside its
 *  `PLACEHOLDER_HEALTHY_RANGES` envelope. Returns `null` when every
 *  metric is healthy. The map's popup surfaces this so the operator
 *  sees at a glance which telemetry band tripped the critical severity. */
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
