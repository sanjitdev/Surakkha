/**
 * Pure rules-evaluation engine. No IO. The hook layer queries
 * `Reading.findMany` for the rate-rule window and hands the rows as
 * `EngineObservation.recentReadings`.
 */
import type { RuleMetric, RuleOperator, RuleRuleType, RuleSeverity } from "@surakkha/shared";

/** Closed operator→comparator lookup. Typed as `Record<RuleOperator,
 *  ...>` so tsc rejects a missing entry when the enum grows. */
export const OPERATOR_COMPARATORS: Record<RuleOperator, (a: number, b: number) => boolean> = {
  gte: (a, b) => a >= b,
  gt: (a, b) => a > b,
  lte: (a, b) => a <= b,
  lt: (a, b) => a < b,
  eq: (a, b) => a === b,
};

/** Projected rule shape. Cache hydration projects the Prisma row to
 *  this shape. `minDurationSeconds` is consumed by the de-bounce
 *  layer, not the engine — passed through. */
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

/** Single observation the engine evaluates against. The hook builds
 *  this from the inbound `TelemetryFrame.metrics[metric]` plus a
 *  recent-readings window queried for rate rules. */
export interface EngineObservation {
  readonly deviceId: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly observedAt: Date;
  readonly recentReadings: ReadonlyArray<{ readonly ts: Date; readonly value: number }>;
}

/** Wire shape of a breach. Uniform across all rule types. `value` is
 *  the triggering observation value (instant = reading value; rate =
 *  computed slope; absence = 0 sentinel — distinguished via
 *  `ruleType`). `threshold` / `operator` / `hysteresisSeconds` are
 *  intentionally omitted. */
export interface BreachResult {
  readonly ruleId: string;
  readonly deviceId: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly severity: RuleSeverity;
  readonly ruleType: RuleRuleType;
  readonly observedAt: Date;
}

/** Internal projection used by `evaluateRule`. NOT exported. */
interface BreachCandidate {
  readonly ruleId: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly severity: RuleSeverity;
  readonly ruleType: RuleRuleType;
}

/** Linear-regression slope over `(x = ts.getTime() ms, y = value)`
 *  pairs. Returns `null` if the input has fewer than 5 points OR
 *  if the time-axis denominator is zero.
 *
 *  Mean-centered for numerical stability:
 *    x̄ = Σx / n, ȳ = Σy / n
 *    slope = Σ(xᵢ − x̄)(yᵢ − ȳ) / Σ(xᵢ − x̄)²
 *  Units: `value / ms`. */
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

/** Evaluate a single rule against a single observation. Returns a
 *  `BreachCandidate` (without `observedAt`/`deviceId`) when the rule
 *  fires, or `null` otherwise. */
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
      // Defense-in-depth: a non-positive or non-finite `hysteresisSeconds`
      // would make the window vacuously true.
      if (!Number.isFinite(rule.hysteresisSeconds) || rule.hysteresisSeconds <= 0) {
        return null;
      }
      // Inclusive boundary — a reading whose `ts` is at exactly
      // `observedAt − hysteresisSeconds*1000` clears the breach.
      const cutoffMs = observation.observedAt.getTime() - rule.hysteresisSeconds * 1000;
      const hasReadingInWindow = observation.recentReadings.some((r) => r.ts.getTime() >= cutoffMs);
      if (!hasReadingInWindow) {
        return {
          ruleId: rule.id,
          metric: rule.metric,
          value: 0,
          severity: rule.severity,
          ruleType: "absence",
        };
      }
      return null;
    }
    default: {
      // Exhaustiveness — a future enum addition surfaces here at compile time.
      const _exhaustive: never = rule.ruleType;
      throw new Error(`unsupported_rule_type: ${_exhaustive as string}`);
    }
  }
};

/** Multi-rule entry point. Projects each non-null `BreachCandidate`
 *  into a fully-projected `BreachResult` using `observation.observedAt`
 *  and `observation.deviceId`. */
export const evaluateRules = (
  rules: readonly EngineRule[],
  observation: EngineObservation,
): readonly BreachResult[] => {
  // Wire format is JSON — a NaN, null, or string can arrive when an
  // upstream sensor misbehaves. Warn and short-circuit.
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

/** Runtime exhaustiveness check for `RuleRuleType`. Throwing function
 *  so it can be called on a property-access expression without TS2775. */
export const requireRuleType = (value: string): void => {
  if (value !== "instant" && value !== "rate" && value !== "absence") {
    throw new Error(`unsupported_rule_type: ${value}`);
  }
};

/** Frozen empty tuple. The no-op `IngestHooks.onRuleEvaluation` default
 *  returns this so the contract is satisfied without allocating.
 *  Consumers MUST NOT mutate. */
export const EMPTY_BREACH_RESULTS: readonly BreachResult[] = Object.freeze([]);
