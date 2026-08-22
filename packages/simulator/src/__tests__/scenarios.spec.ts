/**
 * Story 2.4 — scenario unit tests.
 *
 * Per-scenario deterministic pin: same `tickCount` yields the same
 * metrics; key tick counts pin scenario-specific behaviour (TDS ramp,
 * turbidity spike, chlorine decay, Offline no-emit, RandomFailure
 * NaN-on-period).
 *
 * Run with `pnpm --filter @surakkha/simulator test`.
 */
import { describe, expect, it } from "vitest";

import { MetricRanges, type TelemetryMetrics } from "@surakkha/shared/telemetry";

import {
  SCENARIO_NAMES,
  runScenario,
  scenarioBatteryLow,
  scenarioChlorineDrop,
  scenarioNormal,
  scenarioOffline,
  scenarioRandomFailure,
  scenarioRisingTDS,
  scenarioTurbiditySpike,
} from "../scenarios.js";

const STATE: Readonly<Record<string, never>> = Object.freeze({});

/**
 * Assert every metric is within `MetricRanges` (api hard-reject range).
 * `RandomFailure` injects NaN deliberately — those tests use the
 * `exemptNaN` flag.
 */
const expectMetricsWithinRanges = (
  metrics: TelemetryMetrics,
  exemptNaN: boolean = false,
): void => {
  for (const [key, range] of Object.entries(MetricRanges)) {
    const value = metrics[key as keyof TelemetryMetrics];
    if (typeof value !== "number") {
      throw new Error(`expected number for ${key}, got ${typeof value}`);
    }
    if (exemptNaN && Number.isNaN(value)) {
      continue;
    }
    if (Number.isNaN(value)) {
      throw new Error(`unexpected NaN for ${key}`);
    }
    expect(value).toBeGreaterThanOrEqual(range.min);
    expect(value).toBeLessThanOrEqual(range.max);
  }
};

describe("scenarios — SCENARIO_NAMES pin", () => {
  it("lists the seven spec-named scenarios in the canonical order", () => {
    expect(SCENARIO_NAMES).toEqual([
      "Normal",
      "RisingTDS",
      "TurbiditySpike",
      "ChlorineDrop",
      "Offline",
      "BatteryLow",
      "RandomFailure",
    ]);
  });
});

describe("scenarios — Normal", () => {
  it("emits metrics within MetricRanges", () => {
    for (const tick of [0, 1, 10, 100, 255]) {
      const result = scenarioNormal(STATE, tick);
      expect(result.kind).toBe("metrics");
      if (result.kind === "metrics") {
        expectMetricsWithinRanges(result.metrics);
      }
    }
  });

  it("is deterministic: same tickCount yields same metrics", () => {
    const a = scenarioNormal(STATE, 42);
    const b = scenarioNormal(STATE, 42);
    expect(a).toEqual(b);
  });
});

describe("scenarios — RisingTDS", () => {
  it("ramps tds_ppm from 200 to 1500 over ~120 ticks", () => {
    const start = scenarioRisingTDS(STATE, 0);
    const mid = scenarioRisingTDS(STATE, 60);
    const end = scenarioRisingTDS(STATE, 120);
    expect(start.kind).toBe("metrics");
    expect(mid.kind).toBe("metrics");
    expect(end.kind).toBe("metrics");
    if (start.kind !== "metrics" || mid.kind !== "metrics" || end.kind !== "metrics") {
      throw new Error("expected metrics at all ticks");
    }
    expect(start.metrics.tds_ppm).toBeCloseTo(200, 5);
    expect(mid.metrics.tds_ppm).toBeGreaterThan(700);
    expect(end.metrics.tds_ppm).toBeCloseTo(1_500, 5);
    // Plateau after the ramp window.
    const plateau = scenarioRisingTDS(STATE, 200);
    if (plateau.kind !== "metrics") throw new Error("expected metrics");
    expect(plateau.metrics.tds_ppm).toBeCloseTo(1_500, 5);
  });

  it("keeps all metrics within MetricRanges", () => {
    for (const tick of [0, 30, 60, 90, 120, 200, 500]) {
      const result = scenarioRisingTDS(STATE, tick);
      if (result.kind === "metrics") {
        expectMetricsWithinRanges(result.metrics);
      }
    }
  });
});

describe("scenarios — TurbiditySpike", () => {
  it("spikes turbidity_ntu to 200, holds for 10 ticks, then decays back to baseline over 10 more", () => {
    // Spec narrative: "~10 ticks, then baseline". Implementation:
    // ticks 0-9 hold at 200; ticks 10-19 decay linearly back to 0.4;
    // tick 20+ is baseline. Cycle period 60.
    const spikeStart = scenarioTurbiditySpike(STATE, 0);
    const spikeHold = scenarioTurbiditySpike(STATE, 9);
    const decayStart = scenarioTurbiditySpike(STATE, 10);
    const decayMid = scenarioTurbiditySpike(STATE, 15);
    const decayEnd = scenarioTurbiditySpike(STATE, 19);
    const baseline = scenarioTurbiditySpike(STATE, 40);
    expect(spikeStart.kind).toBe("metrics");
    expect(spikeHold.kind).toBe("metrics");
    expect(decayStart.kind).toBe("metrics");
    expect(decayMid.kind).toBe("metrics");
    expect(decayEnd.kind).toBe("metrics");
    expect(baseline.kind).toBe("metrics");
    if (spikeStart.kind !== "metrics" || spikeHold.kind !== "metrics"
      || decayStart.kind !== "metrics" || decayMid.kind !== "metrics"
      || decayEnd.kind !== "metrics" || baseline.kind !== "metrics") {
      throw new Error("expected metrics at all ticks");
    }
    expect(spikeStart.metrics.turbidity_ntu).toBeCloseTo(200, 5);
    expect(spikeHold.metrics.turbidity_ntu).toBeCloseTo(200, 5);
    // Decay starts: still very near 200.
    expect(decayStart.metrics.turbidity_ntu).toBeGreaterThan(100);
    // Mid-decay: less than spike, more than baseline.
    expect(decayMid.metrics.turbidity_ntu).toBeLessThan(200);
    expect(decayMid.metrics.turbidity_ntu).toBeGreaterThan(0.4);
    // End of decay (t=19): back at baseline (decay has 10 ticks
    // t=10..19 inclusive = 9 equal intervals; the last sample lands
    // exactly on the baseline).
    expect(decayEnd.metrics.turbidity_ntu).toBeCloseTo(0.4, 5);
    // After the decay window, back near baseline.
    expect(baseline.metrics.turbidity_ntu).toBeCloseTo(0.4, 5);
  });
});

describe("scenarios — ChlorineDrop", () => {
  it("decays chlorine_ppm from 0.8 to 0.1 over ~60 ticks and holds", () => {
    const start = scenarioChlorineDrop(STATE, 0);
    const mid = scenarioChlorineDrop(STATE, 30);
    const end = scenarioChlorineDrop(STATE, 60);
    const hold = scenarioChlorineDrop(STATE, 150);
    expect(start.kind).toBe("metrics");
    expect(mid.kind).toBe("metrics");
    expect(end.kind).toBe("metrics");
    expect(hold.kind).toBe("metrics");
    if (start.kind !== "metrics" || mid.kind !== "metrics"
      || end.kind !== "metrics" || hold.kind !== "metrics") {
      throw new Error("expected metrics at all ticks");
    }
    expect(start.metrics.chlorine_ppm).toBeCloseTo(0.8, 5);
    expect(mid.metrics.chlorine_ppm).toBeLessThan(0.8);
    expect(mid.metrics.chlorine_ppm).toBeGreaterThan(0.1);
    expect(end.metrics.chlorine_ppm).toBeCloseTo(0.1, 5);
    expect(hold.metrics.chlorine_ppm).toBeCloseTo(0.1, 5);
  });
});

describe("scenarios — Offline", () => {
  it("emits baseline metrics during the 5-tick grace period, then kind:offline", () => {
    // Architecture §6.1 SCENARIO_OFFLINE: "Stop emitting; close the
    // WS after a 5-tick grace period (simulates physical
    // disconnect); reconnect with backoff".
    // - Ticks 0..4: emit Normal-style baseline metrics.
    // - Tick 5+: kind:offline (the WsClient closes the socket on
    //   this transition).
    const graceTicks = [0, 1, 2, 3, 4];
    for (const tick of graceTicks) {
      const result = scenarioOffline(STATE, tick);
      expect(result.kind).toBe("metrics");
    }
    const postGraceTicks = [5, 10, 100];
    for (const tick of postGraceTicks) {
      expect(scenarioOffline(STATE, tick).kind).toBe("offline");
    }
  });

  it("the grace-period metrics match Normal at the same tick", () => {
    const tick = 3;
    const offline = scenarioOffline(STATE, tick);
    const norm = scenarioNormal(STATE, tick);
    if (offline.kind !== "metrics" || norm.kind !== "metrics") {
      throw new Error("expected metrics during grace");
    }
    expect(offline.metrics).toEqual(norm.metrics);
  });
});

describe("scenarios — BatteryLow", () => {
  it("emits the same metrics as Normal at a non-trivial tick (log-only signal)", () => {
    // Pin a specific tick that exercises phase math (phase 42 % 256
    // yields a non-trivial sin/cos combination) so a regression that
    // makes BatteryLow emit hardcoded zero metrics would be caught.
    const tick = 42;
    const low = scenarioBatteryLow(STATE, tick);
    expect(low.kind).toBe("metrics");
    if (low.kind !== "metrics") return;
    const norm = scenarioNormal(STATE, tick);
    if (norm.kind !== "metrics") throw new Error("Normal must return metrics");
    expect(low.metrics).toEqual(norm.metrics);
  });
});

describe("scenarios — RandomFailure", () => {
  it("emits valid metrics on non-fail ticks", () => {
    for (const tick of [0, 1, 5, 19, 21, 39]) {
      const result = scenarioRandomFailure(STATE, tick);
      expect(result.kind).toBe("metrics");
      if (result.kind === "metrics") {
        expectMetricsWithinRanges(result.metrics);
      }
    }
  });

  it("injects NaN into ph on the deterministic 20-tick period", () => {
    for (const tick of [20, 40, 60, 80, 120]) {
      const result = scenarioRandomFailure(STATE, tick);
      expect(result.kind).toBe("metrics");
      if (result.kind !== "metrics") throw new Error("expected metrics");
      // ph is the failure-injected field.
      expect(Number.isNaN(result.metrics.ph)).toBe(true);
      // Other fields still within range.
      expectMetricsWithinRanges(result.metrics, true);
    }
  });

  it("tick 0 is a non-fail baseline", () => {
    const result = scenarioRandomFailure(STATE, 0);
    expect(result.kind).toBe("metrics");
    if (result.kind !== "metrics") throw new Error("expected metrics");
    expect(Number.isFinite(result.metrics.ph)).toBe(true);
  });
});

describe("scenarios — runScenario dispatcher", () => {
  it("dispatches each scenario name to its pure function", () => {
    // Tick 0 is within Offline's 5-tick grace period, so Offline at
    // tick 0 returns metrics (not kind:offline). At tick 100 (well
    // past grace) Offline returns kind:offline.
    expect(runScenario("Normal", STATE, 0).kind).toBe("metrics");
    expect(runScenario("RisingTDS", STATE, 0).kind).toBe("metrics");
    expect(runScenario("TurbiditySpike", STATE, 0).kind).toBe("metrics");
    expect(runScenario("ChlorineDrop", STATE, 0).kind).toBe("metrics");
    expect(runScenario("Offline", STATE, 0).kind).toBe("metrics");
    expect(runScenario("Offline", STATE, 100).kind).toBe("offline");
    expect(runScenario("BatteryLow", STATE, 0).kind).toBe("metrics");
    expect(runScenario("RandomFailure", STATE, 0).kind).toBe("metrics");
  });

  it("throws on an unknown scenario name (default-branch never narrowing)", () => {
    // Cast past the type guard to exercise the runtime `default` branch
    // — if a future refactor removes the exhaustive `never` check, the
    // bad name silently falls through to a metrics object instead of
    // throwing. devices.json validation prevents this at boot, but a
    // dynamic reload path could trigger it.
    const unknown = "Bogus" as unknown as (typeof SCENARIO_NAMES)[number];
    expect(() => runScenario(unknown, STATE, 0)).toThrow(/unknown scenario/);
  });
});