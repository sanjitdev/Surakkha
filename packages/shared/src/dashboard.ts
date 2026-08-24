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
