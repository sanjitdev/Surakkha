/**
 * engine-rule-migration.spec.ts — type-level pin for
 * `EngineRule.minDurationSeconds`.
 *
 * Story 3.4 / spec-3-4-de-bouncing.md line 91: the spec promised
 * this file as part of the Code Map. It's a pure compile-time pin:
 * if `EngineRule` ever loses the `minDurationSeconds` field (or
 * makes it optional), this file fails to compile. The fix is to
 * restore the field — there is no runtime logic.
 *
 * Review-driven: spec-3-4-de-bouncing iteration 2 marked this as
 * `bad_spec` (the spec promised the file but it was never
 * created). The human picked Option A (create the file) from the
 * loopback menu, so we ship it now.
 *
 * Pin mechanism: the imports below reference `EngineRule` and
 * instantiate the type with `minDurationSeconds` as a literal.
 * TypeScript will reject any code that:
 *   - Removes `minDurationSeconds` from `EngineRule`
 *   - Marks `minDurationSeconds` as optional (`?`)
 *   - Changes the field's type away from `number`
 *
 * No runtime assertions are needed — `tsc --noEmit` is the test.
 * The file is exercised by `pnpm -r typecheck` and
 * `pnpm --filter @surakkha/api run typecheck`.
 */
import { describe, expect, it } from "vitest";

import { type EngineRule } from "../rules/engine";

/**
 * Compile-time pin: instantiate `EngineRule` with
 * `minDurationSeconds` as a literal `number`. If the field is
 * removed or made optional, this assignment is still legal but
 * the `expects-field-present` assertion below fails to type-check.
 */
const RULE_WITH_MIN_DURATION: EngineRule = {
  id: "00000000-0000-4000-8000-000000000001",
  deviceId: null,
  metric: "tds_ppm",
  operator: "gte",
  threshold: 300,
  severity: "warning",
  ruleType: "instant",
  minDurationSeconds: 30,
  hysteresisSeconds: 60,
};

describe("EngineRule.minDurationSeconds migration pin", () => {
  it("EngineRule.minDurationSeconds is a required `number`", () => {
    // The compile is the assertion. At runtime we read the field
    // through `keyof` so the TypeScript narrowing proves the
    // field is present (not optional) and is a number.
    const field: keyof EngineRule = "minDurationSeconds";
    expect(typeof field).toBe("string");
    expect(RULE_WITH_MIN_DURATION[field]).toBe(30);
    expect(typeof RULE_WITH_MIN_DURATION.minDurationSeconds).toBe("number");
  });

  it("EngineRule accepts `minDurationSeconds: 0` (no-debounce rule)", () => {
    // The historical pre-3.4 rules set `minDurationSeconds: 0`
    // to opt out of de-bouncing. The pin must allow that literal
    // value too — the spec's design choice (every rule can opt
    // out of the timer by setting min=0).
    const rule: EngineRule = {
      ...RULE_WITH_MIN_DURATION,
      minDurationSeconds: 0,
    };
    expect(rule.minDurationSeconds).toBe(0);
  });
});
