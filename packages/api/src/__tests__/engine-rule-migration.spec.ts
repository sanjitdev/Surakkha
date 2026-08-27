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
 * loopback menu, so we ship it now. Iteration 4's adversarial
 * review found the original `keyof`-based pin only proves the
 * field is *declared*, not *required* — so this revision adds
 * `expectTypeOf(...).toEqualTypeOf<number>()` which fails to
 * compile if anyone marks the field optional
 * (`minDurationSeconds?: number`).
 *
 * Pin mechanism: the imports below reference `EngineRule` and
 * instantiate the type with `minDurationSeconds` as a literal.
 * TypeScript will reject any code that:
 *   - Removes `minDurationSeconds` from `EngineRule`
 *   - Marks `minDurationSeconds` as optional (`?`)        [via `expectTypeOf`]
 *   - Changes the field's type away from `number`         [via `expectTypeOf`]
 *
 * No runtime assertions are needed — `tsc --noEmit` is the test.
 * The file is exercised by `pnpm -r typecheck` and
 * `pnpm --filter @surakkha/api run typecheck`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

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
    // The compile is the assertion. We pin three things:
    //  (a) `keyof EngineRule` includes the field (it's declared);
    //  (b) the field's resolved type is exactly `number` — NOT
    //      `number | undefined`, NOT `number?`, NOT optional. The
    //      `Equal<...>` helper (vitest) is a strict type-equality
    //      check; if anyone marks the field optional, this assign-
    //      ment is still legal at the call site but `Equal<...>`
    //      evaluates to `false` and the test fails to type-check.
    //  (c) at runtime the value is a `number` and reads back as 30.
    const field: keyof EngineRule = "minDurationSeconds";
    expect(typeof field).toBe("string");
    expect(RULE_WITH_MIN_DURATION[field]).toBe(30);
    expect(typeof RULE_WITH_MIN_DURATION.minDurationSeconds).toBe("number");

    // Type-level pin (b): assert the field's TYPE is exactly
    // `number`. If the field becomes optional
    // (`minDurationSeconds?: number`), the resolved type widens
    // to `number | undefined` and `expectTypeOf` reports the
    // mismatch — vitest surfaces this as a failing test.
    expectTypeOf(RULE_WITH_MIN_DURATION.minDurationSeconds).toEqualTypeOf<number>();
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
