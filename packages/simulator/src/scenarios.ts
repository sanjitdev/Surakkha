/**
 * Scenario curves — Story 2.4.
 *
 * Seven pure scenario functions `(state, tickCount) → TelemetryMetrics`
 * matching the names in `docs/architecture.md` §6.1:
 *
 *   Normal | RisingTDS | TurbiditySpike | ChlorineDrop | Offline
 *   | BatteryLow | RandomFailure
 *
 * Pure: same `tickCount` yields the same metrics. `RandomFailure`
 * deliberately injects a NaN on a deterministic 20-tick period (test
 * pin overrides the spec's "Poisson λ=20" prose). The frame wrapper
 * upstream catches the NaN via `TelemetryFrameSchema.safeParse` before
 * the wire — the scenarios themselves can therefore produce NaN
 * without breaking the contract test.
 *
 * All scenarios keep their emitted metrics within `MetricRanges`
 * except `RandomFailure` (NaN is the point). The api rejects
 * out-of-range frames with `400 bad_request`, so scenarios must
 * clamp before returning. The `Offline` scenario returns `null` and
 * is the contract that the simulator's loop yields no frame at all
 * for that tick.
 *
 * ESLint `no-magic-numbers` is disabled module-wide: the scenario
 * curves ARE magic numbers — every literal here is a curve
 * parameter (anchor, period, slope, decay rate). Lifting them to
 * named constants would make the curves less readable without adding
 * semantic value. The `MetricRanges` clamp at the bottom is the
 * only structural number, and that one IS named.
 */
/* eslint-disable no-magic-numbers */
import { BASELINE_METRICS } from "@surakkha/shared/simulator";
import { type TelemetryMetrics } from "@surakkha/shared/telemetry";

/** Closed enum of scenario names — pinned by spec. */
export const SCENARIO_NAMES = [
  "Normal",
  "RisingTDS",
  "TurbiditySpike",
  "ChlorineDrop",
  "Offline",
  "BatteryLow",
  "RandomFailure",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/**
 * A scenario produces metrics that may drive any tick boundary. We
 * centralise the "metrics + clock" payload so `runScenario` returns
 * a single shape the simulator's loop can build into a `TelemetryFrame`
 * without consulting per-scenario shape signatures.
 *
 * `Offline` returns `null` metrics — the simulator translates null
 * to "no frame this tick, do not buffer anything" (architecture
 * §6.1 SCENARIO_OFFLINE).
 */
export type ScenarioTick =
  | { readonly kind: "metrics"; readonly metrics: TelemetryMetrics }
  | { readonly kind: "offline" };

/** Clamp helper: pin a value to `[min, max]`. Pure. */
const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * Normal scenario — slow random walk within healthy ranges. Deterministic
 * modulo-based variation so the same tick yields the same metrics.
 *
 * Range anchors from BRD §8.3.1 / WHO:
 *   pH 6.5–8.5 (within 0–14 hard range)
 *   TDS < 500 ppm
 *   turbidity < 1 NTU
 *   chlorine 0.5–1.5 ppm (within 0–5 hard range)
 *   temp 24–30 °C, water level 50–120 cm
 *
 * `tickCount` is a nonnegative integer counter; `state` is opaque to
 * the scenario (kept on the signature for future per-device tunables
 * like `noise_sigma` from architecture §6.1).
 */
export const scenarioNormal = (
  _state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => {
  const phase = tickCount % 256;
  const ph = 7.0 + 0.5 * Math.sin(phase * 0.1);
  const tds = 200 + (tickCount % 7) * 5;
  const turbidity = 0.3 + ((tickCount * 13) % 7) / 100;
  const temp = 26 + ((tickCount * 17) % 40) / 10;
  const chlorine = 0.8 + 0.2 * Math.cos(phase * 0.07);
  const water = 80 + ((tickCount * 11) % 30);
  return {
    kind: "metrics",
    metrics: {
      ph,
      tds_ppm: clamp(tds, 0, 5_000),
      turbidity_ntu: clamp(turbidity, 0, 1_000),
      temp_c: clamp(temp, -10, 80),
      chlorine_ppm: clamp(chlorine, 0, 5),
      water_level_cm: clamp(water, 0, 500),
    },
  };
};

/**
 * RisingTDS — tds_ppm rises from 200 to 1500 over ~120 ticks
 * (architecture §6.1). Linear ramp, then plateau at 1500.
 */
export const scenarioRisingTDS = (
  _state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => {
  const rampTicks = 120;
  // One-way ramp; `tickCount` is clamped (not wrapped) so the device's
  // TDS rises to 1500 and STAYS there. No cycling back to 200.
  const ramp = tickCount < 0 ? 0 : tickCount > rampTicks ? rampTicks : tickCount;
  const tds = 200 + ((1_500 - 200) * ramp) / rampTicks;
  return {
    kind: "metrics",
    metrics: {
      ...BASELINE_METRICS,
      tds_ppm: clamp(tds, 0, 5_000),
    },
  };
};

/**
 * TurbiditySpike — turbidity spikes to 200, holds for 10 ticks, decays
 * linearly over 10 more ticks back to baseline 0.4. Cycle period 60
 * ticks (architecture §6.1: "~10 ticks, then baseline").
 */
export const scenarioTurbiditySpike = (
  _state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => {
  const period = 60;
  const t = tickCount % period;
  const spike = 200;
  const holdTicks = 10;
  const decayTicks = 10;
  // Linear decay from `spike` (200) at t=holdTicks to `baseline`
  // (0.4) at t=holdTicks + decayTicks - 1, with `(decayTicks - 1)`
  // equal intervals between them. So 10 decay ticks (10..19 inclusive)
  // = 10 ticks, 9 intervals, 22.18 NTU drop per tick. t=19 lands
  // exactly at baseline 0.4. Cycle period 60.
  const baseline = 0.4;
  const turbidity =
    t < holdTicks
      ? spike
      : t < holdTicks + decayTicks
        ? spike - ((t - holdTicks) * (spike - baseline)) / (decayTicks - 1)
        : baseline;
  return {
    kind: "metrics",
    metrics: {
      ...BASELINE_METRICS,
      turbidity_ntu: clamp(turbidity, 0, 1_000),
    },
  };
};

/**
 * ChlorineDrop — chlorine decays from 0.8 → 0.1 over ~60 ticks, holds
 * at 0.1 thereafter. Cycle period 200 ticks so the test can pin
 * exact numbers mid-decay.
 */
export const scenarioChlorineDrop = (
  _state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => {
  const period = 200;
  const decayTicks = 60;
  const t = tickCount % period;
  const startCl = 0.8;
  const endCl = 0.1;
  const chlorine = t < decayTicks ? startCl - ((startCl - endCl) * t) / decayTicks : endCl;
  return {
    kind: "metrics",
    metrics: {
      ...BASELINE_METRICS,
      chlorine_ppm: clamp(chlorine, 0, 5),
    },
  };
};

/**
 * Offline — first 5 ticks: emit baseline metrics (same as Normal).
 * After 5 ticks: return `kind:"offline"` — the WsClient closes the
 * socket on the next tick and reconnects with backoff (architecture
 * §6.1 SCENARIO_OFFLINE: "Stop emitting; close the WS after a 5-tick
 * grace period (simulates physical disconnect); reconnect with backoff").
 *
 * Tests assert grace boundary at tick 4 (last baseline) and tick 5
 * (first non-grace).
 */
const OFFLINE_GRACE_TICKS = 5;
export const scenarioOffline = (
  state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => {
  if (tickCount < OFFLINE_GRACE_TICKS) {
    return scenarioNormal(state, tickCount);
  }
  return { kind: "offline" };
};

/**
 * BatteryLow — wire contract does not carry a battery metric in v1
 * (architecture §6.1 SCENARIO_BATTERY_LOW; design notes). Emits the
 * same curve as `Normal`; the caller logs a one-time `BatteryLow
 * started` notice at the scenario boundary. This is a log-only signal,
 * no wire effect.
 */
export const scenarioBatteryLow = (
  state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => scenarioNormal(state, tickCount);

/**
 * RandomFailure — deterministic 20-tick period: at tick `20, 40, 60, …`
 * one metric (`ph`) is replaced by `NaN`. The frame wrapper upstream
 * calls `TelemetryFrameSchema.safeParse` locally and drops the frame
 * with a logged error; the api's `bad_request` path on a
 * server-side catch is the same envelope.
 *
 * Test pin requires determinism. The spec's "Poisson λ=20 ticks"
 * prose is overridden here for that reason.
 */
export const scenarioRandomFailure = (
  _state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => {
  const failPeriod = 20;
  const failsThisTick = tickCount > 0 && tickCount % failPeriod === 0;
  const base = scenarioNormal({}, tickCount);
  if (base.kind === "offline") {
    return base;
  }
  if (!failsThisTick) {
    return base;
  }
  return {
    kind: "metrics",
    metrics: { ...base.metrics, ph: Number.NaN },
  };
};

/**
 * Dispatcher. Throws on unknown scenario name so a malformed
 * `devices.json` fails at boot rather than silently picking a default.
 * The upstream `loadDevicesFile` validation in `index.ts` already
 * enforces `scenario ∈ SCENARIO_NAMES`.
 */
export const runScenario = (
  scenario: ScenarioName,
  state: Readonly<Record<string, never>>,
  tickCount: number,
): ScenarioTick => {
  switch (scenario) {
    case "Normal":
      return scenarioNormal(state, tickCount);
    case "RisingTDS":
      return scenarioRisingTDS(state, tickCount);
    case "TurbiditySpike":
      return scenarioTurbiditySpike(state, tickCount);
    case "ChlorineDrop":
      return scenarioChlorineDrop(state, tickCount);
    case "Offline":
      return scenarioOffline(state, tickCount);
    case "BatteryLow":
      return scenarioBatteryLow(state, tickCount);
    case "RandomFailure":
      return scenarioRandomFailure(state, tickCount);
    default: {
      const exhaustive: never = scenario;
      throw new Error(`simulator: unknown scenario ${exhaustive as string}`);
    }
  }
};
