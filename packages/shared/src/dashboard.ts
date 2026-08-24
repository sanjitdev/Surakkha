/**
 * Dashboard wire types + placeholder severity (Story 2.6).
 *
 * Source-of-truth surface for the operator-facing `/dashboard`. Lives
 * in `@surakkha/shared` so the api's REST surface (`/api/readings/
 * latest`, `/api/incidents/recent`) and the web's TanStack Query hooks
 * agree on shape by construction (ADR 0007 — no epic imports from
 * another epic's directory).
 *
 * `placeholderSeverity(reading)` is a TEMPORARY helper that derives a
 * severity bucket (`healthy | warning | critical`) from a `Reading`
 * using the metric defaults seeded by Story 3.3 (or, when 3.3 has
 * not landed, the hard-reject ranges in `MetricRanges` as a sane
 * fallback). Story 3.5 replaces this with the rule-driven engine —
 * callers should treat the returned value as ephemeral and re-fetch
 * via `placeholderSeverity` on every render rather than memoizing
 * across renders.
 *
 * The output enum intentionally mirrors the four `KpiStat` severities
 * so a future replacement does not break the dashboard's KPI band.
 */
import type { TelemetryMetrics } from "./telemetry.js";

/**
 * Dashboard-facing severity enum. Subset of the four KpiStat severities
 * — `offline` is resolved by the absence of a reading, not by the
 * reading itself, so the placeholder severity function never returns it.
 */
export type Severity = "healthy" | "warning" | "critical";

/**
 * The minimum wire shape the dashboard needs to render one row in the
 * Live Readings table + a corresponding KPI count.
 *
 * `name` is the device's human label (Story 2.5 — nullable for legacy
 * rows). `device_id` is the canonical UUIDv4 wire identifier. `metrics`
 * and `flags` mirror the api→web `reading:new` event shape so the
 * REST initial-load path and the realtime path are interchangeable.
 */
export interface LatestReadingPayload {
  readonly device_id: string;
  readonly name: string | null;
  readonly ts: number;
  readonly server_received_at: string;
  readonly metrics: TelemetryMetrics;
  readonly flags: readonly string[];
}

/**
 * Wire shape of `GET /api/readings/latest`.
 *
 * The `readings` array is the latest reading per device, ordered by
 * `server_received_at DESC` so the first row is the freshest device.
 * Empty when no readings exist (empty DB or six devices still
 * unseeded).
 */
export interface LatestReadingsResponse {
  readonly readings: readonly LatestReadingPayload[];
}

/**
 * Minimum wire shape for the Recent Incidents preview (Story 2.6).
 * Story 4.2 expands this; for now the endpoint returns `{ incidents: [] }`
 * so the dashboard can render the empty state without a wire drift.
 *
 * The fields below match the spec gap-fill (`id`, `device_id`,
 * `severity`, `metric`, `value`, `opened_at`) — they are the
 * minimum needed for the dashboard to render an Epic-4 card
 * affordance later without a schema change.
 */
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

/**
 * Inline "healthy" ranges for the placeholder severity function.
 *
 * Story 2.4 simulator defaults (scenario curves) and the BRD §8.3.1
 * WHO/BSTI band both sit inside these envelopes, so a `Normal`
 * scenario's reading is `healthy`, and `RisingTDS` /
 * `TurbiditySpike` / `ChlorineDrop` each breach exactly one metric
 * and land in `critical`.
 *
 * Story 3.3 seeds the canonical `Rule` table from these same bands;
 * Story 3.5 then replaces this helper with the rule-driven engine.
 * Until those land, `placeholderSeverity` reads from this constant
 * so the test surface stays in lockstep with the simulator's output.
 */
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

/**
 * TEMPORARY severity derivation — Story 2.6 placeholder until
 * Story 3.5 ships the rule-driven engine.
 *
 * Contract:
 *   - Any metric outside its `PLACEHOLDER_HEALTHY_RANGES` envelope
 *     returns `critical`.
 *   - Otherwise `healthy`.
 *   - `warning` is reserved; no current path returns it. The KPI band
 *     handles a `warning` bucket when Epic 3 enables rule-driven
 *     de-bounced warnings (e.g. a metric hovering just outside its
 *     `healthy` envelope for `min_duration_seconds < threshold`).
 *
 * `NaN` / `Infinity` are NOT out-of-range here — the wire contract
 * rejects them at parse time, and the api rejects them with
 * `400 bad_request`. If a future path delivers a metric with a
 * non-finite value, we conservatively return `critical` (silent
 * NaN = the metric is wrong; surfacing that as critical is the
 * safe default).
 *
 * Pure: same input → same output. No I/O, no clocks, no globals.
 */
export const placeholderSeverity = (
  reading: Pick<LatestReadingPayload, "metrics">,
): Severity => {
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

/**
 * Dashboard-facing severity including the `offline` bucket.
 *
 * Story 2.7 expands the placeholder severity from the reading-only
 * three-bucket enum (`healthy | warning | critical`) to a four-bucket
 * enum so the map's offline threshold (`OFFLINE_THRESHOLD_MS`) can
 * surface a device whose `last_reading_at` lapsed as `offline`.
 *
 * `placeholderSeverity` keeps the three-bucket shape; the dashboard's
 * KPI band + map route through this combined enum and resolve
 * `offline` via `isOffline()`.
 */
export type MapSeverity = Severity | "offline";

/**
 * Per-device staleness threshold (Story 2.7).
 *
 * A device whose latest reading is older than this — or has never
 * emitted — renders with the `offline` severity token. The simulator
 * ticks every 2 s; 60 s = 30× a normal tick (clearly lapsed). A
 * real-world device on a 30 s or 60 s tick sits well within the
 * envelope so the simulator's marker doesn't flip to grey just
 * because of a slower tick rate.
 *
 * Lives here so the KPI band can adopt it later (the KPI band's
 * `offline` count is currently hard-coded to `0`; see
 * `useDashboardReadings.summarizeReadings`) without a wire change.
 */
export const OFFLINE_THRESHOLD_MS = 60_000;

/**
 * Wire shape of `GET /api/devices` (Story 2.7).
 *
 * One row per Device, joined to `MAX(Reading.serverReceivedAt)` so
 * the map can render severity by joining the device roster with the
 * latest-readings cache. Sorted by `id ASC`.
 *
 * `last_reading_at` is `null` when a device has never connected —
 * the map renders these in the `offline` token ("No reading yet").
 */
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

/**
 * Decide whether a device should render with the `offline` severity
 * token. Returns `true` when:
 *   - The device has never connected (`last_reading_at === null`),
 *     OR
 *   - The most recent reading lapsed more than `OFFLINE_THRESHOLD_MS`
 *     before `now`.
 *
 * Pure: same input → same output. `now` is injected so callers
 * control the clock (tests pin a fixed `now`; production uses
 * `Date.now()`).
 */
export const isOffline = (
  device: Pick<DeviceSummary, "last_reading_at">,
  now: number,
): boolean => {
  if (device.last_reading_at === null) return true;
  const ts = Date.parse(device.last_reading_at);
  if (!Number.isFinite(ts)) return true;
  return now - ts > OFFLINE_THRESHOLD_MS;
};

/**
 * Resolve a device's map severity from its roster row + latest reading.
 *
 * The map's marker colour is driven by this function so the same
 * "worst-current-bucket" rule the KPI band uses drives the map.
 * Devices flagged `isOffline()` return `offline` even when their last
 * reading was within the threshold — a manual "Offline" scenario
 * override surfaces as grey regardless of telemetry freshness.
 */
export const deviceMapSeverity = (
  device: Pick<DeviceSummary, "last_reading_at">,
  latestReading:
    | Pick<LatestReadingPayload, "metrics">
    | undefined,
  now: number,
): MapSeverity => {
  if (isOffline(device, now)) return "offline";
  if (latestReading === undefined) return "offline";
  return placeholderSeverity(latestReading);
};

/**
 * Resolve the "breached metric" — the first metric outside its
 * `PLACEHOLDER_HEALTHY_RANGES` envelope. Returns `null` when every
 * metric is healthy.
 *
 * The map's popup surfaces this so the operator sees at a glance
 * which telemetry band tripped the critical severity (the
 * `latestReading.metrics` payload is six values; showing every one
 * would overflow the popup).
 */
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
