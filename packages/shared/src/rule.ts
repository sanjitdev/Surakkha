/**
 * Rules engine contract — Surakkha shared (Story 3.1).
 *
 * Closed enum literals that mirror the Prisma enums in
 * `packages/db/prisma/schema.prisma` (`RuleMetric`, `RuleOperator`,
 * `RuleSeverity`, `RuleRuleType`) 1:1. Story 3.2's evaluation engine,
 * Story 3.3's seed script, and Story 3.7's `/admin/thresholds` admin
 * tab all import the `*_SCHEMA` constants from this file so the wire /
 * DB / UI never drift on the canonical value sets.
 *
 * Prisma enums require valid TS identifiers, so the `operator` values
 * here are the camel-case tokens `gte | gt | lte | lt | eq`. Story 3.2
 * owns the mapping table that translates these tokens into the JS
 * comparator at evaluation time. The `rule_type` values are the v1
 * closed enum (`instant | rate | absence`) per architecture §4.2 /
 * §8.1 invariant I-5.
 *
 * The literal arrays are exported as `as const` tuples so both the
 * inferred union type (`(typeof ARRAY)[number]`) and the runtime value
 * set share a single source of truth.
 */

/**
 * Closed enum of metric keys that a Rule can target.
 *
 * Mirrors the `Reading.metrics` keys carried in the v1 wire frame
 * (architecture §3.2 / §5). Adding a new metric in v2 requires a
 * Prisma migration that drops + recreates `RuleMetric`; this is
 * intentional — Story 3.2's exhaustive switch needs a closed set.
 */
export const RULE_METRICS = [
  "ph",
  "tds_ppm",
  "turbidity_ntu",
  "chlorine_ppm",
  "temp_c",
  "water_level_cm",
] as const;
export type RuleMetric = (typeof RULE_METRICS)[number];

/**
 * Closed enum of comparison operators that a Rule can apply.
 *
 * Mirrors the Prisma `RuleOperator` enum (camel-case TS identifiers
 * because Prisma enums must be valid identifiers). Story 3.2 maps
 * these to the JS comparator via a small lookup table:
 *   gte → >=, gt → >, lte → <=, lt → <, eq → ==
 */
export const RULE_OPERATORS = [
  "gte",
  "gt",
  "lte",
  "lt",
  "eq",
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/**
 * Closed enum of severity levels that a Rule can stamp onto a fired
 * alert (architecture §4.3, invariant I-6). Severity is set by the
 * rule, not inferred by the engine.
 */
export const RULE_SEVERITIES = [
  "info",
  "warning",
  "critical",
] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/**
 * Closed enum of v1 rule types (architecture §4.2, invariant I-5).
 * Story 3.2's engine supports exactly these three; new rule types
 * require a wire-contract bump.
 */
export const RULE_RULE_TYPES = [
  "instant",
  "rate",
  "absence",
] as const;
export type RuleRuleType = (typeof RULE_RULE_TYPES)[number];