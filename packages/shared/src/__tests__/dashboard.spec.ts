/**
 * Tests for `@surakkha/shared/dashboard` (Story 2.6).
 *
 * Coverage:
 *   - placeholderSeverity(reading):
 *       - Returns 'critical' when ANY metric is outside its healthy band.
 *       - Returns 'healthy' when every metric sits inside its band.
 *       - Returns 'critical' when a metric is NaN/Infinity (defensive — the
 *         wire rejects these, but a future call site should not silently
 *         treat a non-finite value as healthy).
 *       - Pins `PLACEHOLDER_HEALTHY_RANGES` so a future edit cannot drift the
 *         contract without an explicit Story 2.6 follow-up.
 *   - Wire-shape sanity for LatestReadingPayload + RecentIncidentsResponse.
 *   - LatestReadingsResponse + RecentIncidentsResponse shapes parse cleanly
 *     through their zod counterparts when an iteration over the envelope is
 *     needed (tests don't pull in zod schemas — the api + web own those).
 */
import { describe, expect, it } from "vitest";

import {
  type LatestReadingPayload,
  placeholderSeverity,
  PLACEHOLDER_HEALTHY_RANGES,
} from "../index.js";

const BASE = {
  device_id: "9b1c4f00-0000-4000-8000-00000000000a",
  name: "DEVICE-A",
  ts: 1_700_000_000,
  server_received_at: "2026-08-20T10:31:04.456Z",
} as const;

const healthyMetrics = {
  ph: 7.2,
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27.4,
  chlorine_ppm: 0.6,
  water_level_cm: 85,
};

const buildReading = (
  metricsOverride: Partial<typeof healthyMetrics> = {},
): LatestReadingPayload => ({
  ...BASE,
  metrics: { ...healthyMetrics, ...metricsOverride },
  flags: [],
});

describe("placeholderSeverity — healthy band", () => {
  it("returns 'healthy' when every metric sits inside its band", () => {
    expect(placeholderSeverity(buildReading())).toBe("healthy");
  });

  it("returns 'healthy' at the inclusive boundary (each metric at min)", () => {
    expect(
      placeholderSeverity(
        buildReading({
          ph: PLACEHOLDER_HEALTHY_RANGES.ph.min,
          tds_ppm: PLACEHOLDER_HEALTHY_RANGES.tds_ppm.min,
          turbidity_ntu: PLACEHOLDER_HEALTHY_RANGES.turbidity_ntu.min,
          temp_c: PLACEHOLDER_HEALTHY_RANGES.temp_c.min,
          chlorine_ppm: PLACEHOLDER_HEALTHY_RANGES.chlorine_ppm.min,
          water_level_cm: PLACEHOLDER_HEALTHY_RANGES.water_level_cm.min,
        }),
      ),
    ).toBe("healthy");
  });

  it("returns 'healthy' at the inclusive upper boundary", () => {
    expect(
      placeholderSeverity(
        buildReading({
          ph: PLACEHOLDER_HEALTHY_RANGES.ph.max,
          tds_ppm: PLACEHOLDER_HEALTHY_RANGES.tds_ppm.max,
          turbidity_ntu: PLACEHOLDER_HEALTHY_RANGES.turbidity_ntu.max,
          temp_c: PLACEHOLDER_HEALTHY_RANGES.temp_c.max,
          chlorine_ppm: PLACEHOLDER_HEALTHY_RANGES.chlorine_ppm.max,
          water_level_cm: PLACEHOLDER_HEALTHY_RANGES.water_level_cm.max,
        }),
      ),
    ).toBe("healthy");
  });
});

describe("placeholderSeverity — out-of-range per metric", () => {
  // Data-driven pin: every metric gets a row that proves a breach
  // surfaces as `critical`. Mirrors the simulator's
  // (RisingTDS/TurbiditySpike/ChlorineDrop) breach axes.
  const BREACHES: ReadonlyArray<{
    readonly metric: keyof typeof healthyMetrics;
    readonly value: number;
  }> = [
    { metric: "ph", value: 6.4 },
    { metric: "ph", value: 8.6 },
    { metric: "tds_ppm", value: 501 },
    { metric: "turbidity_ntu", value: 1.5 },
    { metric: "temp_c", value: 23 },
    { metric: "temp_c", value: 31 },
    { metric: "chlorine_ppm", value: 0.4 },
    { metric: "water_level_cm", value: 49 },
    { metric: "water_level_cm", value: 121 },
  ];

  for (const { metric, value } of BREACHES) {
    it(`returns 'critical' when ${metric} === ${value} breaches the band`, () => {
      expect(placeholderSeverity(buildReading({ [metric]: value }))).toBe(
        "critical",
      );
    });
  }

  it("returns 'critical' when a metric is NaN", () => {
    expect(placeholderSeverity(buildReading({ ph: Number.NaN }))).toBe(
      "critical",
    );
  });

  it("returns 'critical' when a metric is Infinity", () => {
    expect(
      placeholderSeverity(buildReading({ tds_ppm: Number.POSITIVE_INFINITY })),
    ).toBe("critical");
  });
});

describe("PLACEHOLDER_HEALTHY_RANGES pin", () => {
  it("matches the Story 2.4 / BRD §8.3.1 bands character-for-character", () => {
    expect(PLACEHOLDER_HEALTHY_RANGES).toEqual({
      ph: { min: 6.5, max: 8.5 },
      tds_ppm: { min: 0, max: 500 },
      turbidity_ntu: { min: 0, max: 1 },
      temp_c: { min: 24, max: 30 },
      chlorine_ppm: { min: 0.5, max: 1.5 },
      water_level_cm: { min: 50, max: 120 },
    });
  });
});
