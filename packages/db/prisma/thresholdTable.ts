/**
 * Default threshold table — packages/db (Story 3.3).
 *
 * Pure module (no Prisma, no filesystem, no `process.exit`) exposing the
 * nine FR-13 default rules as a single source of truth for the seed
 * script, the unit tests, and a future Story 3.7 "reset to defaults"
 * admin-tab button.
 *
 * The rows are taken FR-13 VERBATIM — same metric, operator, threshold,
 * and severity the spec lists, in the same order, with no rounding or
 * interpretation:
 *
 *   1. ph               <    6.5  critical
 *   2. ph               >    8.5  critical
 *   3. tds_ppm          >=   300  warning
 *   4. tds_ppm          >=  1000  critical
 *   5. turbidity_ntu    >      5  critical
 *   6. chlorine_ppm     <    0.2  critical
 *   7. chlorine_ppm     >    1.5  warning
 *   8. temp_c           >     45  warning
 *   9. water_level_cm   <     20  warning
 *
 * The wire symbols `<`, `>`, `<=`, `>=`, `==` (FR-12) are translated
 * to the matching Prisma `RuleOperator` token via `WIRE_OPERATOR_TO_PRISMA`
 * — the mapping table lives in the seed layer (NOT in Story 3.2's
 * engine). v1 ships exactly the 5 FR-12 wire symbols (`<`, `>`, `<=`,
 * `>=`, `==`); no `!=` / `<>` semantics.
 *
 * `assertValidSeedRow` is the runtime guard against a future caller
 * that bypasses `tsc` (e.g. a `tsx` script in CI) — the six branches
 * mirror the Block A test suite so a regression surfaces in CI before
 * production.
 */
import {
  RULE_METRICS,
  RULE_OPERATORS,
  RULE_SEVERITIES,
  type RuleMetric,
  type RuleOperator,
  type RuleSeverity,
} from "@surakkha/shared";

/**
 * One row of the default threshold table. Carries exactly the four
 * fields a Story 3.7 "reset to defaults" button could conceivably edit
 * through the admin tab — `ruleType` / `minDurationSeconds` /
 * `hysteresisSeconds` / `version` / `isActive` / `createdBy` are the
 * seed's permanent invariants and are filled internally from a single
 * source of truth (this module). Exposing them through the DTO would
 * let a future caller mutate a `ruleType` from `"instant"` to `"rate"`
 * and break the engine's closed-enum contract.
 */
export interface RuleSeedRow {
  readonly metric: RuleMetric;
  readonly operator: RuleOperator;
  readonly threshold: number;
  readonly severity: RuleSeverity;
}

/**
 * The nine FR-13 default rule rows, in FR-13 order. Typed as
 * `readonly RuleSeedRow[]` so a developer who tries to `.push(...)`
 * fails at `tsc`. The constant is the SINGLE source of truth the seed
 * reads from, the spec test pins, and a future Story 3.7 admin-tab
 * "reset to defaults" button could re-import from.
 */
export const THRESHOLD_TABLE: readonly RuleSeedRow[] = [
  { metric: "ph", operator: "lt", threshold: 6.5, severity: "critical" },
  { metric: "ph", operator: "gt", threshold: 8.5, severity: "critical" },
  { metric: "tds_ppm", operator: "gte", threshold: 300, severity: "warning" },
  { metric: "tds_ppm", operator: "gte", threshold: 1000, severity: "critical" },
  {
    metric: "turbidity_ntu",
    operator: "gt",
    threshold: 5,
    severity: "critical",
  },
  {
    metric: "chlorine_ppm",
    operator: "lt",
    threshold: 0.2,
    severity: "critical",
  },
  {
    metric: "chlorine_ppm",
    operator: "gt",
    threshold: 1.5,
    severity: "warning",
  },
  { metric: "temp_c", operator: "gt", threshold: 45, severity: "warning" },
  {
    metric: "water_level_cm",
    operator: "lt",
    threshold: 20,
    severity: "warning",
  },
] as const;

/**
 * Wire symbol → Prisma `RuleOperator` token. Exactly the 5 FR-12 wire
 * symbols (`<`, `>`, `<=`, `>=`, `==`) map to the matching Prisma
 * tokens (`lt`, `gt`, `lte`, `gte`, `eq`). v1 ships no `!=` / `<>`
 * semantics.
 *
 * Lives in the seed layer (not in Story 3.2's engine) so the wire
 * format can evolve (e.g. adopting a `<>` style negation) without
 * breaking the engine's read path; only this helper changes.
 */
export const WIRE_OPERATOR_TO_PRISMA: Record<
  "<" | ">" | "<=" | ">=" | "==",
  RuleOperator
> = {
  "<": "lt",
  ">": "gt",
  "<=": "lte",
  ">=": "gte",
  "==": "eq",
};

/**
 * Runtime guard for a threshold row. Seven branches:
 *   - non-object input           → throws "malformed threshold row: not an object"
 *   - missing `metric`           → throws "malformed threshold row: missing field \"metric\""
 *   - missing `operator`         → throws "malformed threshold row: missing field \"operator\""
 *   - missing `severity`         → throws "malformed threshold row: missing field \"severity\""
 *   - non-finite `threshold`     → throws "malformed threshold row: threshold must be a finite number"
 *   - empty-string `metric`/`operator`/`severity`
 *                                 → throws "malformed threshold row: <field>=\"\"; expected one of [...]"
 *   - unknown enum value         → throws "malformed threshold row: <field>=\"<value>\" not in [...]"
 *   - happy row                  → does NOT throw.
 *
 * The error messages are the exact strings the spec's Block A test
 * pins — a typo in the message text breaks the test.
 */
export const assertValidSeedRow = (row: unknown): asserts row is RuleSeedRow => {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("seed: malformed threshold row: not an object");
  }
  const obj = row as Record<string, unknown>;
  if (!("metric" in obj)) {
    throw new Error("seed: malformed threshold row: missing field \"metric\"");
  }
  if (!("operator" in obj)) {
    throw new Error(
      "seed: malformed threshold row: missing field \"operator\"",
    );
  }
  if (!("severity" in obj)) {
    throw new Error(
      "seed: malformed threshold row: missing field \"severity\"",
    );
  }
  if (typeof obj.threshold !== "number" || !Number.isFinite(obj.threshold)) {
    throw new Error(
      "seed: malformed threshold row: threshold must be a finite number",
    );
  }
  // Enum-membership guards. An empty string is NOT in any of the
  // three enum arrays, so the `.includes` check alone catches it —
  // but the spec mandates a distinct message for the empty-string
  // case so the regression is greppable from the test.
  if (!(RULE_METRICS as readonly string[]).includes(obj.metric as string)) {
    if (obj.metric === "") {
      throw new Error(
        `seed: malformed threshold row: metric=""; expected one of [${RULE_METRICS.join(", ")}]`,
      );
    }
    throw new Error(
      `seed: malformed threshold row: metric="${String(obj.metric)}" not in [${RULE_METRICS.join(", ")}]`,
    );
  }
  if (
    !(RULE_OPERATORS as readonly string[]).includes(obj.operator as string)
  ) {
    if (obj.operator === "") {
      throw new Error(
        `seed: malformed threshold row: operator=""; expected one of [${RULE_OPERATORS.join(", ")}]`,
      );
    }
    throw new Error(
      `seed: malformed threshold row: operator="${String(obj.operator)}" not in [${RULE_OPERATORS.join(", ")}]`,
    );
  }
  if (
    !(RULE_SEVERITIES as readonly string[]).includes(obj.severity as string)
  ) {
    if (obj.severity === "") {
      throw new Error(
        `seed: malformed threshold row: severity=""; expected one of [${RULE_SEVERITIES.join(", ")}]`,
      );
    }
    throw new Error(
      `seed: malformed threshold row: severity="${String(obj.severity)}" not in [${RULE_SEVERITIES.join(", ")}]`,
    );
  }
};