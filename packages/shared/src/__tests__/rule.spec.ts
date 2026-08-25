/**
 * Rules engine contract — Surakkha shared (Story 3.1).
 *
 * Pins the literal value sets for the four closed enums in
 * `packages/shared/src/rule.ts`. A typo (e.g. `chlorine_ppm` →
 * `chlorie_ppm`) would silently change wire semantics for every
 * downstream consumer (Story 3.2 engine, Story 3.3 seed, Story 3.7
 * admin tab) — this file makes that drift loud in CI.
 *
 * Each array must stay in lockstep with the matching Prisma enum
 * literal name in `packages/db/prisma/schema.prisma`. Prisma's
 * migrate diff will reject a drift between the two, but only at
 * migration time; this test catches it earlier at unit-test time.
 */
import { describe, expect, it } from "vitest";

import {
  RULE_METRICS,
  RULE_OPERATORS,
  RULE_RULE_TYPES,
  RULE_SEVERITIES,
  type RuleMetric,
  type RuleOperator,
  type RuleRuleType,
  type RuleSeverity,
} from "../index.js";

describe("RULE_METRICS (Story 3.1 — closed metric enum)", () => {
  it("contains exactly the six v1 metric keys in the documented order", () => {
    expect(RULE_METRICS).toEqual([
      "ph",
      "tds_ppm",
      "turbidity_ntu",
      "chlorine_ppm",
      "temp_c",
      "water_level_cm",
    ]);
  });

  it("contains six entries (length pin)", () => {
    expect(RULE_METRICS).toHaveLength(6);
  });

  it("has no duplicate entries", () => {
    const set = new Set(RULE_METRICS);
    expect(set.size).toBe(RULE_METRICS.length);
  });

  it("RuleMetric is the union of the six names (compile-time pin)", () => {
    for (const metric of RULE_METRICS) {
      const typed: RuleMetric = metric;
      expect(typed).toBe(metric);
    }
  });
});

describe("RULE_OPERATORS (Story 3.1 — closed operator enum)", () => {
  it("contains exactly the five v1 operator tokens in the documented order", () => {
    // Camel-case tokens — Prisma enums require valid TS identifiers,
    // so the JS comparator mapping (>=, >, <=, <, ==) is owned by
    // Story 3.2's engine.
    expect(RULE_OPERATORS).toEqual(["gte", "gt", "lte", "lt", "eq"]);
  });

  it("contains five entries (length pin)", () => {
    expect(RULE_OPERATORS).toHaveLength(5);
  });

  it("has no duplicate entries", () => {
    const set = new Set(RULE_OPERATORS);
    expect(set.size).toBe(RULE_OPERATORS.length);
  });

  it("RuleOperator is the union of the five tokens (compile-time pin)", () => {
    for (const op of RULE_OPERATORS) {
      const typed: RuleOperator = op;
      expect(typed).toBe(op);
    }
  });
});

describe("RULE_SEVERITIES (Story 3.1 — closed severity enum)", () => {
  it("contains exactly the three v1 severities in the documented order", () => {
    expect(RULE_SEVERITIES).toEqual(["info", "warning", "critical"]);
  });

  it("contains three entries (length pin)", () => {
    expect(RULE_SEVERITIES).toHaveLength(3);
  });

  it("has no duplicate entries", () => {
    const set = new Set(RULE_SEVERITIES);
    expect(set.size).toBe(RULE_SEVERITIES.length);
  });

  it("RuleSeverity is the union of the three names (compile-time pin)", () => {
    for (const severity of RULE_SEVERITIES) {
      const typed: RuleSeverity = severity;
      expect(typed).toBe(severity);
    }
  });
});

describe("RULE_RULE_TYPES (Story 3.1 — closed rule-type enum)", () => {
  it("contains exactly the three v1 rule types in the documented order", () => {
    expect(RULE_RULE_TYPES).toEqual(["instant", "rate", "absence"]);
  });

  it("contains three entries (length pin)", () => {
    expect(RULE_RULE_TYPES).toHaveLength(3);
  });

  it("has no duplicate entries", () => {
    const set = new Set(RULE_RULE_TYPES);
    expect(set.size).toBe(RULE_RULE_TYPES.length);
  });

  it("RuleRuleType is the union of the three names (compile-time pin)", () => {
    for (const ruleType of RULE_RULE_TYPES) {
      const typed: RuleRuleType = ruleType;
      expect(typed).toBe(ruleType);
    }
  });
});