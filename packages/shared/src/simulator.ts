/**
 * Simulator contract types.
 * Re-declared here (rather than imported from `@surakkha/simulator`)
 * so the api can validate inbound scenario names without depending on
 * the simulator package. Adding a scenario requires bumping both this
 * enum and the simulator's `SCENARIO_NAMES` in lockstep.
 */
import { z } from "zod";

/** Closed enum of scenario names. */
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

/** Zod schema mirroring the closed enum above. */
export const ScenarioNameSchema = z.enum(SCENARIO_NAMES);

/** Simulator firmware version — surfaced in telemetry frame metadata.
 *  The api logs a warning if a frame arrives with a newer `fw_version`
 *  than this constant. */
export const SIMULATOR_FW_VERSION = "1.4.0" as const;

/** Baseline metrics for the "Normal" scenario (and the first 5 ticks
 *  of the "Offline" scenario, which emits Normal-shape values during
 *  the grace window). */
export const BASELINE_METRICS = {
  ph: 7.2,
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27,
  chlorine_ppm: 0.6,
  water_level_cm: 80,
} as const;
