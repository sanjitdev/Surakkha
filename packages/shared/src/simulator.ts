/**
 * Simulator contract types — Surakkha shared (Story 2.5).
 *
 * Re-declared here (rather than imported from `@surakkha/simulator`) so
 * the api can validate inbound scenario names without taking a
 * dependency on the simulator package. The simulator is a separate
 * process; packages other than itself may not import it.
 *
 * The names MUST stay in lockstep with
 * `packages/simulator/src/scenarios.ts:35-44` (`SCENARIO_NAMES`). The
 * spec at `_bmad-output/implementation-artifacts/2-5-admin-simulator-tab.md`
 * pins a closed enum of seven scenario names; the api uses this enum
 * to validate `POST /admin/simulator/:device_id/scenario` bodies.
 *
 * Adding a scenario is a wire-contract-adjacent change. Bump both
 * files in lockstep.
 */
import { z } from "zod";

/**
 * Closed enum of scenario names — mirrored from
 * `packages/simulator/src/scenarios.ts:SCENARIO_NAMES`.
 */
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
 * Zod schema mirroring the closed enum above. Use this on inbound
 * request bodies so an unknown name rejects with a 400 validation
 * error rather than being silently dropped.
 */
export const ScenarioNameSchema = z.enum(SCENARIO_NAMES);
