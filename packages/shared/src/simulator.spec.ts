/**
 * Story 2.5 — shared simulator contract tests.
 *
 * Pins the closed enum of scenario names so the api and the simulator
 * stay in lockstep. The seven names mirror
 * `packages/simulator/src/scenarios.ts:35-44` (`SCENARIO_NAMES`); a
 * drift between the two files would let the api accept a name the
 * simulator would later reject (or vice versa).
 */
import { describe, expect, it } from "vitest";

import {
  SCENARIO_NAMES,
  type ScenarioName,
  ScenarioNameSchema,
} from "./simulator.js";

describe("Story 2.5 — shared SCENARIO_NAMES (closed enum)", () => {
  it("contains exactly seven names in the documented order", () => {
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

  it("contains seven names (length pin)", () => {
    expect(SCENARIO_NAMES).toHaveLength(7);
  });

  it("has no duplicate entries", () => {
    const set = new Set(SCENARIO_NAMES);
    expect(set.size).toBe(SCENARIO_NAMES.length);
  });

  it("accepts every documented name via Zod parse", () => {
    for (const name of SCENARIO_NAMES) {
      expect(ScenarioNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("rejects unknown names with a Zod failure", () => {
    const result = ScenarioNameSchema.safeParse("Bogus");
    expect(result.success).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(ScenarioNameSchema.safeParse("").success).toBe(false);
  });

  it("ScenarioName is the union of the seven names (compile-time pin)", () => {
    // Each entry of `SCENARIO_NAMES` must be assignable to
    // `ScenarioName`. If a future contributor renames an array entry,
    // the inferred `ScenarioName` type changes and these assignments
    // fail to compile.
    for (const name of SCENARIO_NAMES) {
      const typed: ScenarioName = name;
      expect(typed).toBe(name);
    }
  });
});
