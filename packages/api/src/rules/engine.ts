/**
 * Rules evaluation engine — Story 3.2.
 *
 * Pure (no IO) evaluation of a single observation against a set of
 * rules. The engine is the single authority on which semantic of
 * `hysteresisSeconds` applies (instant/rate → clearing grace;
 * absence → fire-after-no-readings window) and on the rate-slope
 * formula (simple linear regression on `(ts.getTime() in ms, value)`
 * pairs; units are `value/ms`).
 *
 * The hook (`./hooks.ts`) is the only place that touches the DB on
 * the eval path. It queries `Reading.findMany` for the rate-rule
 * window, pre-filters (sort ascending, drop future-ts, dedupe by
 * ts, slice to last 5), and hands the array as
 * `EngineObservation.recentReadings`. Keeping the math pure means
 * `engine.spec.ts` runs without any Prisma mock.
 *
 * The `OPERATOR_COMPARATORS` table is the ONLY site where camel-case
 * Prisma enum tokens (`gte | gt | lte | lt | eq`) reach JS comparators.
 * Declared as `Record<RuleOperator, ...>` so tsc rejects a missing
 * entry if the enum ever grows (closed lookup pin per Story 3.1's
 * invariant I-5).
 */
import type { RuleMetric, RuleOperator, RuleRuleType, RuleSeverity } from "@surakkha/shared";

/**
 * Closed operator→comparator lookup table. Story 3.1's invariant
 * I-5 makes this a `Record<RuleOperator, ...>` so a future enum
 * addition that forgets this file fails tsc at compile time (the
 * runtime completeness pin lives in `engine.spec.ts`).
 */
export const OPERATOR_COMPARATORS: Record<RuleOperator, (a: number, b: number) => boolean> = {
  gte: (a, b) => a >= b,
  gt: (a, b) => a > b,
  lte: (a, b) => a <= b,
  lt: (a, b) => a < b,
  eq: (a, b) => a === b,
};

/**
 * The shape the engine consumes at eval time. Deliberately excludes
 * `createdAt / updatedAt / version / isActive / createdBy` — the
 * engine doesn't need them; cache hydration (`./cache.ts`) projects
 * the Prisma row down to this shape.
 *
 * Story 3.4 — adds `minDurationSeconds` to the projected shape.
 * The engine itself does NOT consume `minDurationSeconds` (its surface
 * is unchanged); the field is passed through so the de-bounce layer
 * (`./debounce.ts`) can read it without re-querying Prisma or
 * re-projection. The presence of the field on `EngineRule` is the
 * deliberate signal that the cache is the canonical source of
 * de-bounce configuration.
 */
export interface EngineRule {
  readonly id: string;
  readonly deviceId: string | null;
  readonly metric: RuleMetric;
  readonly operator: RuleOperator;
  readonly threshold: number;
  readonly severity: RuleSeverity;
  readonly ruleType: RuleRuleType;
  readonly minDurationSeconds: number;
  readonly hysteresisSeconds: number;
}

/**
 * A single observation the engine evaluates rules against. The hook
 * builds this from the inbound `TelemetryFrame.metrics[metric]` plus
 * a recent-readings window queried for rate rules. The `recentReadings`
 * array MUST already be sorted ascending, future-ts-dropped,
 * ts-deduplicated, and sliced to the last 5 readings by the hook
 * — the engine treats it as opaque post-condition input.
 */
export interface EngineObservation {
  readonly deviceId: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly observedAt: Date;
  readonly recentReadings: ReadonlyArray<{ readonly ts: Date; readonly value: number }>;
}

/**
 * The wire shape of a breach. Uniform across all rule types:
 *   - `observedAt` is always `observation.observedAt` (frame's
 *     wire timestamp converted to Date) so Story 3.5's alert
 *     manager has one timestamping rule.
 *   - `value` carries the triggering observation value (instant =
 *     reading value; rate = computed slope; absence = 0 sentinel —
 *     downstream distinguishes via `ruleType === "absence"`).
 *   - `deviceId` is always `observation.deviceId` regardless of
 *     whether the firing rule was global or per-device.
 *
 * Intentionally omits `threshold`, `operator`, `hysteresisSeconds`
 * — Story 3.5 re-derives those by `ruleId` from the cache.
 */
export interface BreachResult {
  readonly ruleId: string;
  readonly deviceId: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly severity: RuleSeverity;
  readonly ruleType: RuleRuleType;
  readonly observedAt: Date;
}

/**
 * Internal projection used by `evaluateRule` to make the per-rule
 * helper's output explicit. `evaluateRules` projects each non-null
 * `BreachCandidate` into a fully-populated `BreachResult` using
 * `observation.observedAt` and `observation.deviceId`. NOT exported
 * — it is a private engine type that exists so the field-provenance
 * pin in `engine.spec.ts` can assert on a single source of truth.
 */
interface BreachCandidate {
  readonly ruleId: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly severity: RuleSeverity;
  readonly ruleType: RuleRuleType;
}

/**
 * Compute the linear-regression slope over `(x = ts.getTime() in ms,
 * y = value)` pairs. Returns `null` if the input has fewer than 5
 * points OR if the time-axis denominator is zero (all readings share
 * the same `ts` — degenerate column).
 *
 * Formula (mean-centered for numerical stability):
 *   x̄ = Σx / n, ȳ = Σy / n
 *   slope = Σ(xᵢ − x̄)(yᵢ − ȳ) / Σ(xᵢ − x̄)²
 *
 * Units: `value / ms`. Tests use ms-scale thresholds or pre-scale
 * the slope; the engine math is unchanged (per Story 3.2 AC #5).
 *
 * Mean-centering avoids catastrophic cancellation when `x` is a
 * Unix epoch millisecond (~10¹²) and the spread is small relative
 * to `x²`. The textbook `n*Σx² − (Σx)²` formula loses precision in
 * the same regime; the mean-centered form is the textbook fix.
 */
export const computeSlope = (
  points: ReadonlyArray<{ readonly ts: Date; readonly value: number }>,
): number | null => {
  const n = points.length;
  if (n < 5) return null;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.ts.getTime();
    sumY += p.value;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let numer = 0;
  let denom = 0;
  for (const p of points) {
    const dx = p.ts.getTime() - meanX;
    const dy = p.value - meanY;
    numer += dx * dy;
    denom += dx * dx;
  }
  if (denom === 0) return null;
  return numer / denom;
};

/**
 * Evaluate a single rule against a single observation. Returns a
 * `BreachCandidate` (without `observedAt`/`deviceId`) when the rule
 * fires, or `null` otherwise. The per-rule evaluator carries the
 * per-ruleType dispatch so `evaluateRules` stays a simple map.
 */
export const evaluateRule = (
  rule: EngineRule,
  observation: EngineObservation,
): BreachCandidate | null => {
  const comparator = OPERATOR_COMPARATORS[rule.operator];
  switch (rule.ruleType) {
    case "instant": {
      if (comparator(observation.value, rule.threshold)) {
        return {
          ruleId: rule.id,
          metric: rule.metric,
          value: observation.value,
          severity: rule.severity,
          ruleType: "instant",
        };
      }
      return null;
    }
    case "rate": {
      const slope = computeSlope(observation.recentReadings);
      if (slope === null) return null;
      if (comparator(slope, rule.threshold)) {
        return {
          ruleId: rule.id,
          metric: rule.metric,
          value: slope,
          severity: rule.severity,
          ruleType: "rate",
        };
      }
      return null;
    }
    case "absence": {
      // The breach fires when no reading exists within the rule's
      // `hysteresisSeconds` window of `observation.observedAt`. A
      // reading whose `ts` is at exactly `observedAt −
      // hysteresisSeconds*1000` (inclusive boundary) clears the
      // breach — the engine uses `>=` against the threshold.
      //
      // Defense-in-depth: a non-positive or non-finite
      // `hysteresisSeconds` (zero seed, DB column drift, or a
      // poison rule row) would make the window vacuously true,
      // spamming operators with always-on breaches. The engine
      // treats such a rule as "no rule" and returns null.
      if (!Number.isFinite(rule.hysteresisSeconds) || rule.hysteresisSeconds <= 0) {
        return null;
      }
      const cutoffMs = observation.observedAt.getTime() - rule.hysteresisSeconds * 1000;
      const hasReadingInWindow = observation.recentReadings.some((r) => r.ts.getTime() >= cutoffMs);
      if (!hasReadingInWindow) {
        return {
          ruleId: rule.id,
          metric: rule.metric,
          // Sentinel — downstream distinguishes absence via ruleType.
          value: 0,
          severity: rule.severity,
          ruleType: "absence",
        };
      }
      return null;
    }
    default: {
      // Exhaustiveness — `rule.ruleType` is `RuleRuleType` and the
      // switch above covers all 3 cases. A future enum addition
      // surfaces here at compile time.
      const _exhaustive: never = rule.ruleType;
      throw new Error(`unsupported_rule_type: ${_exhaustive as string}`);
    }
  }
};

/**
 * Multi-rule entry point. Projects each non-null `BreachCandidate`
 * into a fully-projected `BreachResult` using `observation.observedAt`
 * and `observation.deviceId` (the same source for all rule types —
 * uniform timestamping + deviceId per Story 3.2's design notes).
 */
export const evaluateRules = (
  rules: readonly EngineRule[],
  observation: EngineObservation,
): readonly BreachResult[] => {
  // Patch (spec-3-4 review 2026-08-27, P-L2-12 / ECH-05): the
  // engine's type signature declares `value: number` on
  // `EngineObservation`, but the wire format is JSON so a NaN,
  // null, or string can arrive when an upstream sensor misbehaves.
  // The previous behaviour was to silently return
  // EMPTY_BREACH_RESULTS because every comparison returned false
  // (NaN compared to anything is false). Now we log a warn so
  // operators see the poison reading in the ingest log, then
  // short-circuit to the empty result. The signature stays
  // `number` because the public contract is "the engine never
  // produces a non-number"; the warn is observability for the
  // rejection.
  if (typeof observation.value !== "number" || !Number.isFinite(observation.value)) {
    console.warn(
      `[engine] non-number metric value rejected: deviceId=${observation.deviceId} metric=${observation.metric} value=${JSON.stringify(observation.value)}`,
    );
    return EMPTY_BREACH_RESULTS;
  }
  const out: BreachResult[] = [];
  for (const rule of rules) {
    const candidate = evaluateRule(rule, observation);
    if (candidate !== null) {
      out.push({
        ruleId: candidate.ruleId,
        deviceId: observation.deviceId,
        metric: candidate.metric,
        value: candidate.value,
        severity: candidate.severity,
        ruleType: candidate.ruleType,
        observedAt: observation.observedAt,
      });
    }
  }
  return out;
};

/**
 * Runtime exhaustiveness check for `RuleRuleType`. Throws
 * `Error("unsupported_rule_type: " + value)` if `value` is not one
 * of `instant | rate | absence`. Used by `cache.ts` to skip +
 * `console.warn` rows whose `ruleType` is anything else (per-row
 * rejection; valid rows still load). Also exported for direct use
 * by any future site that needs the same guard.
 *
 * NOTE: this is a regular throwing function rather than an
 * `asserts value is RuleRuleType` signature so it can be called on
 * a property-access expression (`row.ruleType`) without hitting
 * TypeScript's TS2775 constraint that every name in the call target
 * of an assertion function must have an explicit type annotation.
 * The trade-off is the caller can't narrow `row.ruleType` to
 * `RuleRuleType` from the assertion alone — `cache.ts` re-types it
 * explicitly.
 */
export const requireRuleType = (value: string): void => {
  if (value !== "instant" && value !== "rate" && value !== "absence") {
    throw new Error(`unsupported_rule_type: ${value}`);
  }
};

/**
 * Frozen empty tuple. The no-op `IngestHooks.onRuleEvaluation` default
 * returns this so the type contract (`Promise<readonly BreachResult[]>`)
 * is satisfied without allocating. Consumers can compare by identity
 * but MUST NOT mutate.
 */
export const EMPTY_BREACH_RESULTS: readonly BreachResult[] = Object.freeze([]);
