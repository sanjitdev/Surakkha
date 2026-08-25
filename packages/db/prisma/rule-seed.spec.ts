/**
 * Default-threshold seed tests — packages/db (Story 3.3).
 *
 * Pins the seed's `THRESHOLD_TABLE` (Block A — pure helpers), the
 * `upsertDefaultRule` helper (Block B — mocked Prisma), and the
 * `seed.ts` integration (Block C — source-walk pins).
 *
 * The full Prisma upsert flow is exercised in the docker-compose
 * stack's boot sequence; here we pin the pure helpers + the helper
 * seam so a regression in shape, idempotency, or admin-edit handling
 * surfaces in CI before the seed ever hits the DB.
 *
 * Block layout (22 tests total — loopback-2 amendment):
 *   - Block A: 11 assertions across 5 distinct `it()` blocks for the
 *     pure helpers (`THRESHOLD_TABLE`, `WIRE_OPERATOR_TO_PRISMA`,
 *     `assertValidSeedRow` with its 7 accept/reject branches).
 *   - Block B: 6 mocked-Prisma tests for `upsertDefaultRule` covering
 *     AC2 (fresh-DB create), AC3 (idempotent noop), AC5 (drift
 *     severity), AC5 (drift ruleType), AC6 (skipped-inactive), and
 *     the P2002 race wrap.
 *   - Block C: 4 source-walk pins proving `seed.ts` calls
 *     `upsertDefaultRule(` and imports from `./thresholdTable`,
 *     iterates `THRESHOLD_TABLE` in main(), and calls the helper
 *     per-row.
 *
 * FR-13 expected tuples are hand-written from the BRD text directly
 * (NOT derived from `THRESHOLD_TABLE`) so a typo in the source can't
 * pass the test (loopback-2 F7 fix).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RULE_METRICS, RULE_OPERATORS, RULE_SEVERITIES } from "@surakkha/shared";

import { assertValidSeedRow, THRESHOLD_TABLE, WIRE_OPERATOR_TO_PRISMA } from "./thresholdTable.js";

const SEED_TS_PATH = join("prisma", "seed.ts");

/**
 * FR-13 expected tuples. Hand-written from BRD §8.3.1 verbatim:
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
 * The PRISMA-side `operator` token is what's actually stored in the
 * row, so we hand-write the Prisma form (`lt`, `gt`, `gte`, ...) per
 * the BRD's wire symbol (`<`, `>`, `>=`, ...).
 */
const FR13_EXPECTED_TUPLES: ReadonlyArray<{
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
}> = [
  { metric: "ph", operator: "lt", threshold: 6.5, severity: "critical" },
  { metric: "ph", operator: "gt", threshold: 8.5, severity: "critical" },
  { metric: "tds_ppm", operator: "gte", threshold: 300, severity: "warning" },
  { metric: "tds_ppm", operator: "gte", threshold: 1000, severity: "critical" },
  { metric: "turbidity_ntu", operator: "gt", threshold: 5, severity: "critical" },
  { metric: "chlorine_ppm", operator: "lt", threshold: 0.2, severity: "critical" },
  { metric: "chlorine_ppm", operator: "gt", threshold: 1.5, severity: "warning" },
  { metric: "temp_c", operator: "gt", threshold: 45, severity: "warning" },
  { metric: "water_level_cm", operator: "lt", threshold: 20, severity: "warning" },
];

/**
 * Get the row at `index` from `THRESHOLD_TABLE` with a clear error
 * if the table is empty (loopback-2 F32 fix — replaces `THRESHOLD_TABLE[0]!`
 * which would silently use `undefined` on a regression).
 */
const requireRow = (index: number) => {
  const row = THRESHOLD_TABLE[index];
  if (!row) {
    throw new Error(`THRESHOLD_TABLE[${index}] is missing — table is empty`);
  }
  return row;
};

// ---------------------------------------------------------------------------
// Block A — pure helpers
// ---------------------------------------------------------------------------

describe("Block A — THRESHOLD_TABLE (FR-13 verbatim)", () => {
  it("contains exactly nine rows (AC1 / AC7)", () => {
    expect(THRESHOLD_TABLE.length).toBe(9);
    expect(FR13_EXPECTED_TUPLES.length).toBe(9);
  });

  it("rows match FR-13 verbatim — set equality + index ordering (AC1 / AC8)", () => {
    // Hand-written expected list from FR-13 text — independent of the
    // implementation source so a typo in BOTH doesn't pass the test.
    expect(THRESHOLD_TABLE).toEqual(FR13_EXPECTED_TUPLES);

    // Pin the codomain of operator tokens so a future drift adds
    // 6 wire symbols only after extending `RULE_OPERATORS` (loopback-2
    // F17 fix).
    expect(RULE_OPERATORS.length).toBe(5);
  });

  it("every metric is in RULE_METRICS, every operator in RULE_OPERATORS, every severity in RULE_SEVERITIES", () => {
    for (const row of THRESHOLD_TABLE) {
      expect(RULE_METRICS).toContain(row.metric);
      expect(RULE_OPERATORS).toContain(row.operator);
      expect(RULE_SEVERITIES).toContain(row.severity);
    }
  });

  it("WIRE_OPERATOR_TO_PRISMA is a bijection between the 5 FR-12 wire symbols and RULE_OPERATORS (AC9)", () => {
    expect(Object.keys(WIRE_OPERATOR_TO_PRISMA).sort()).toEqual(["<", "<=", "==", ">", ">="]);

    for (const value of Object.values(WIRE_OPERATOR_TO_PRISMA)) {
      expect(RULE_OPERATORS).toContain(value);
    }

    // Bijection — every `RuleOperator` token has a mapping back. A
    // developer who renames a Prisma enum token (e.g. `gte` → `gt_eq`)
    // trips this assertion because the `gte` value no longer maps back.
    for (const op of RULE_OPERATORS) {
      const reverseFound = Object.values(WIRE_OPERATOR_TO_PRISMA).includes(op);
      expect(reverseFound).toBe(true);
    }
  });
});

describe("Block A — assertValidSeedRow (seven branches)", () => {
  it("accepts a happy row of the documented shape", () => {
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
      }),
    ).not.toThrow();
  });

  it("rejects a non-object input", () => {
    expect(() => assertValidSeedRow("not-an-object")).toThrow(
      /malformed threshold row: not an object/,
    );
    expect(() => assertValidSeedRow(null)).toThrow(/malformed threshold row: not an object/);
    expect(() => assertValidSeedRow([1, 2, 3])).toThrow(/malformed threshold row: not an object/);
  });

  it('rejects a row missing the "metric" key', () => {
    expect(() =>
      assertValidSeedRow({
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
      }),
    ).toThrow(/missing field "metric"/);
  });

  it('rejects a row missing the "operator" key', () => {
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        threshold: 6.5,
        severity: "critical",
      }),
    ).toThrow(/missing field "operator"/);
  });

  it('rejects a row missing the "severity" key', () => {
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
      }),
    ).toThrow(/missing field "severity"/);
  });

  it("rejects a non-finite threshold (NaN / Infinity / undefined / null)", () => {
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: Number.NaN,
        severity: "critical",
      }),
    ).toThrow(/threshold must be a finite number/);
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: Number.POSITIVE_INFINITY,
        severity: "critical",
      }),
    ).toThrow(/threshold must be a finite number/);
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: undefined,
        severity: "critical",
      }),
    ).toThrow(/threshold must be a finite number/);
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: null,
        severity: "critical",
      }),
    ).toThrow(/threshold must be a finite number/);
  });

  it("rejects an empty-string metric/operator/severity with the documented expected-one-of message", () => {
    // Loopback-2 F26 fix — empty strings are rejected with a distinct
    // greppable message format so the regression is obvious in CI.
    expect(() =>
      assertValidSeedRow({
        metric: "",
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
      }),
    ).toThrow(/metric=""; expected one of/);
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "",
        threshold: 6.5,
        severity: "critical",
      }),
    ).toThrow(/operator=""; expected one of/);
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
        severity: "",
      }),
    ).toThrow(/severity=""; expected one of/);
  });

  it("rejects an unknown severity value", () => {
    expect(() =>
      assertValidSeedRow({
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
        severity: "bogus",
      }),
    ).toThrow(/severity="bogus" not in/);
  });
});

// ---------------------------------------------------------------------------
// Block A-extension — DRIFT_CHECKED_FIELDS coverage (re-review V5 / E5)
// ---------------------------------------------------------------------------

describe("Block A — DRIFT_CHECKED_FIELDS coverage (re-review V5 / E5)", () => {
  it("contains exactly seven fields, in the documented order, all members of the Prisma Rule shape", async () => {
    // Import the helper from `seedHelpers.js` so we pin the SHIPPED
    // constant — a developer who removes a field silently broadens
    // the contract and this test catches it.
    const mod = await import("./seedHelpers.js");
    expect(mod.DRIFT_CHECKED_FIELDS).toEqual([
      "metric",
      "operator",
      "threshold",
      "severity",
      "ruleType",
      "minDurationSeconds",
      "hysteresisSeconds",
    ]);
  });

  it("pickDriftShape projects exactly the seven drift-checked fields", async () => {
    // Re-review E5: pin the projection's coverage so the drift error
    // message contains every checked field, no more, no less.
    const mod = await import("./seedHelpers.js");
    const ts = new Date("2026-08-25T00:00:00.000Z");
    const row = {
      id: "rule-test-uuid",
      deviceId: null,
      metric: "ph",
      operator: "lt" as const,
      threshold: 6.5,
      severity: "critical" as const,
      ruleType: "instant" as const,
      minDurationSeconds: 0,
      hysteresisSeconds: 0,
      version: 1,
      createdBy: null,
      createdAt: ts,
      updatedAt: ts,
      isActive: true,
    };
    expect(Object.keys(mod.pickDriftShape(row)).sort()).toEqual([
      "hysteresisSeconds",
      "metric",
      "minDurationSeconds",
      "operator",
      "ruleType",
      "severity",
      "threshold",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Block B — upsertDefaultRule helper (mocked Prisma)
// ---------------------------------------------------------------------------

interface MockRuleRow {
  id: string;
  deviceId: string | null;
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
  ruleType: string;
  minDurationSeconds: number;
  hysteresisSeconds: number;
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

const buildMockRuleRow = (overrides: Partial<MockRuleRow> = {}): MockRuleRow => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  return {
    id: "rule-test-uuid",
    deviceId: null,
    metric: "ph",
    operator: "lt",
    threshold: 6.5,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
    version: 1,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    isActive: true,
    ...overrides,
  };
};

interface MockPrisma {
  rule: {
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

const buildMockPrisma = (
  upsertReturn: MockRuleRow | Error,
  options: { echoCreate?: boolean } = {},
): MockPrisma => ({
  rule: {
    upsert: vi.fn().mockImplementation((args: { create: MockRuleRow }) => {
      if (upsertReturn instanceof Error) {
        return Promise.reject(upsertReturn);
      }
      return Promise.resolve(
        options.echoCreate ? { ...upsertReturn, ...args.create } : upsertReturn,
      );
    }),
    update: vi.fn(),
  },
});
// echoCreate contract (re-review E2 fixup):
//   - `echoCreate: true`  → the create payload (`args.create`) is
//     spread onto the returned row. Use this when the test cares
//     about the AC2 create-payload shape, OR when `createdAt ===
//     updatedAt` is required (the seed's `created` vs `noop`
//     detection depends on it).
//   - `echoCreate: false` (default) → the mock returns
//     `upsertReturn` as-is, so the test pre-stages a row with
//     drifted shape / inactive state / etc. WITHOUT the create
//     payload overwriting the deliberate signal.
// The AC6 test (below) deliberately OMITS `echoCreate: true` so the
// mocked `isActive: false` is not overwritten by the create
// payload's `isActive: true` — the short-circuit is the test's
// signal.

/**
 * Import the helper from `./seedHelpers.js` (NOT `./seed.js`) so the
 * Block B tests don't trigger `seed.ts`'s top-level `main().catch(...)`
 * side-effect (loopback-2 F14/F38 fix).
 */
const importUpsertDefaultRule = async () => {
  const mod = await import("./seedHelpers.js");
  return mod.upsertDefaultRule;
};

describe("Block B — upsertDefaultRule (AC2 / AC3 / AC5 / AC6 / P2002)", () => {
  // Re-review V1: parameterize AC2 over all 9 FR-13 rows so a
  // regression in the create payload that affects only rows 1–8
  // (e.g. a typo'd metric/operator/threshold tuple hardcoded in the
  // upsert) fails CI rather than passing for row 0 only.
  THRESHOLD_TABLE.forEach((row, index) => {
    it(`AC2 row ${index} (${row.metric} ${row.operator} ${row.threshold} ${row.severity}) — fresh DB: prisma.rule.upsert called with the documented create payload + returns { status: 'created' }`, async () => {
      const upsertDefaultRule = await importUpsertDefaultRule();
      const ts = new Date("2026-08-25T00:00:00.000Z");
      const mockPrisma = buildMockPrisma(buildMockRuleRow({ createdAt: ts, updatedAt: ts }), {
        echoCreate: true,
      });

      const result = await upsertDefaultRule(
        mockPrisma as unknown as Parameters<typeof upsertDefaultRule>[0],
        row,
      );

      expect(mockPrisma.rule.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.rule.upsert.mock.calls[0]![0] as {
        where: {
          deviceId_metric_operator_threshold_version: {
            deviceId: null;
            metric: string;
            operator: string;
            threshold: number;
            version: number;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };

      // `where` shape: the documented unique key with version: 1.
      expect(call.where.deviceId_metric_operator_threshold_version).toEqual({
        deviceId: null,
        metric: row.metric,
        operator: row.operator,
        threshold: row.threshold,
        version: 1,
      });

      // `create` payload: every AC2 field present with the AC2 invariant.
      expect(call.create).toEqual({
        deviceId: null,
        metric: row.metric,
        operator: row.operator,
        threshold: row.threshold,
        severity: row.severity,
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
        version: 1,
        createdBy: null,
        isActive: true,
      });

      // `update` is intentionally empty — load-bearing detail for AC3.
      expect(call.update).toEqual({});

      // Return shape: created (timestamps equal within 2ms tolerance).
      expect(result).toEqual({ status: "created" });
    });
  });

  it("AC3 — DB already has the row with matching shape: update is {} and prisma.rule.update was NEVER called; returns { status: 'noop' }", async () => {
    const upsertDefaultRule = await importUpsertDefaultRule();
    const ts = new Date("2026-08-25T00:00:00.000Z");
    const laterTs = new Date("2026-08-25T00:00:01.000Z");
    // Existing row already at the seed-managed key, with the desired
    // shape — match the input row's tuple exactly so the drift check
    // passes. `updatedAt` differs from `createdAt` to flag "noop".
    const row = requireRow(2); // tds_ppm gte 300 warning
    const mockPrisma = buildMockPrisma(
      buildMockRuleRow({
        metric: row.metric,
        operator: row.operator,
        threshold: row.threshold,
        severity: row.severity,
        createdAt: ts,
        updatedAt: laterTs,
      }),
      { echoCreate: true },
    );

    const result = await upsertDefaultRule(
      mockPrisma as unknown as Parameters<typeof upsertDefaultRule>[0],
      row,
    );

    expect(mockPrisma.rule.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.rule.upsert.mock.calls[0]![0] as {
      update: Record<string, unknown>;
    };
    expect(call.update).toEqual({});
    expect(mockPrisma.rule.update).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "noop" });
  });

  it("AC5 (severity drift) — DB has the row with drifted severity: throws the documented shape-drift error, prisma.rule.update NOT called, message contains both shape strings", async () => {
    const upsertDefaultRule = await importUpsertDefaultRule();
    const ts = new Date("2026-08-25T00:00:00.000Z");
    // Drift severity from `critical` to `warning`. Default mock
    // factory (no `echoCreate`) returns the upsertReturn as-is so the
    // drift persists.
    const row = requireRow(0); // ph lt 6.5 critical
    const driftedRow = buildMockRuleRow({
      metric: row.metric,
      operator: row.operator,
      threshold: row.threshold,
      severity: "warning", // <-- drifted from row.severity="critical"
      createdAt: ts,
      updatedAt: ts,
    });
    const mockPrisma = buildMockPrisma(driftedRow);

    let captured: Error | null = null;
    try {
      await upsertDefaultRule(
        mockPrisma as unknown as Parameters<typeof upsertDefaultRule>[0],
        row,
      );
    } catch (err) {
      captured = err as Error;
    }

    expect(captured).not.toBeNull();
    const msg = captured!.message;
    // Re-review F5: explicit keys-string format pin (in addition to
    // the regex match above) so a regression that drops `severity=` or
    // `version=1` from the unique-key portion of the error fails.
    expect(msg).toContain("metric=ph");
    expect(msg).toContain("operator=lt");
    expect(msg).toContain("threshold=6.5");
    expect(msg).toContain("severity=critical");
    expect(msg).toContain("version=1");
    expect(msg).toMatch(
      /seed: existing Rule row at default key metric=ph operator=lt threshold=6\.5 severity=critical version=1 has different shape/,
    );
    expect(mockPrisma.rule.update).not.toHaveBeenCalled();

    // Existing shape contains the drifted severity `warning`.
    expect(msg).toContain('"severity":"warning"');
    // Desired shape contains the seed's expected severity `critical`.
    expect(msg).toContain('"severity":"critical"');
    expect(msg).toMatch(/existing=/);
    expect(msg).toMatch(/desired=/);
    expect(msg).toMatch(/refusing to overwrite/);
  });

  it("AC5 (ruleType drift) — DB has the row with drifted ruleType: throws the same drift error (loopback-2 F5 — extends drift-field coverage)", async () => {
    const upsertDefaultRule = await importUpsertDefaultRule();
    const ts = new Date("2026-08-25T00:00:00.000Z");
    // Drift ruleType from "instant" to "rate".
    const row = requireRow(0); // ph lt 6.5 critical
    const driftedRow = buildMockRuleRow({
      metric: row.metric,
      operator: row.operator,
      threshold: row.threshold,
      severity: row.severity,
      ruleType: "rate", // <-- drifted from "instant"
      createdAt: ts,
      updatedAt: ts,
    });
    const mockPrisma = buildMockPrisma(driftedRow);

    let captured: Error | null = null;
    try {
      await upsertDefaultRule(
        mockPrisma as unknown as Parameters<typeof upsertDefaultRule>[0],
        row,
      );
    } catch (err) {
      captured = err as Error;
    }

    expect(captured).not.toBeNull();
    const msg = captured!.message;
    expect(msg).toMatch(/has different shape/);
    expect(msg).toContain('"ruleType":"rate"');
    expect(msg).toContain('"ruleType":"instant"');
    expect(mockPrisma.rule.update).not.toHaveBeenCalled();
  });

  it("AC6 — DB has the row with isActive: false (and matching shape): returns { status: 'skipped-inactive' }, prisma.rule.update NOT called, prisma.rule.upsert WAS called with update: {} (no resurrection)", async () => {
    const upsertDefaultRule = await importUpsertDefaultRule();
    const ts = new Date("2026-08-25T00:00:00.000Z");
    // Admin-took-over row at version: 1 — sibling version: 2 row is
    // active; this row stays at version: 1 with isActive: false.
    // Shape matches the desired row so the drift check would pass
    // if reached; the `isActive: false` check short-circuits BEFORE
    // drift (AC6).
    //
    // We deliberately do NOT pass `echoCreate: true` here — the
    // create payload has `isActive: true` and would overwrite the
    // mocked `isActive: false`, hiding the test's actual signal.
    const row = requireRow(0); // ph lt 6.5 critical
    const inactiveRow = buildMockRuleRow({
      metric: row.metric,
      operator: row.operator,
      threshold: row.threshold,
      severity: row.severity,
      isActive: false,
      createdAt: ts,
      updatedAt: ts,
    });
    const mockPrisma = buildMockPrisma(inactiveRow);

    const result = await upsertDefaultRule(
      mockPrisma as unknown as Parameters<typeof upsertDefaultRule>[0],
      row,
    );

    expect(result).toEqual({ status: "skipped-inactive" });
    expect(mockPrisma.rule.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.rule.upsert.mock.calls[0]![0] as {
      update: Record<string, unknown>;
    };
    expect(call.update).toEqual({});
    expect(mockPrisma.rule.update).not.toHaveBeenCalled();
    // Re-review E8: pin that the mocked row's `isActive` was NOT
    // mutated by the upsert — if a future refactor flips the
    // short-circuit order, this catches it.
    expect(inactiveRow.isActive).toBe(false);
  });

  it("P2002 race wrap — prisma.rule.upsert rejects with P2002: throws wrapped error matching /seed: rule upsert race for key/ AND preserves the original error in cause", async () => {
    const upsertDefaultRule = await importUpsertDefaultRule();
    // Loopback-2 F36 fix — pin the P2002 catch branch.
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.20.0",
      meta: { target: ["x"] },
    });
    const mockPrisma = buildMockPrisma(prismaError);

    const row = requireRow(0); // ph lt 6.5 critical

    let captured: Error | null = null;
    try {
      await upsertDefaultRule(
        mockPrisma as unknown as Parameters<typeof upsertDefaultRule>[0],
        row,
      );
    } catch (err) {
      captured = err as Error;
    }

    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/seed: rule upsert race for key/);
    expect(captured!.message).toContain(
      "metric=ph operator=lt threshold=6.5 severity=critical version=1",
    );
    // Re-review E4: the wrapped message carries `(P2002)` for
    // log-debuggability — a developer reading the CI log does not
    // have to inspect `cause` to know it's a unique-constraint race.
    expect(captured!.message).toContain("(P2002)");
    // Original Prisma error preserved in `cause` for debuggability.
    const { cause } = captured as Error & { cause?: unknown };
    expect(cause).toBe(prismaError);
    // The wrapped error's own code is NOT "P2002" — the seed's wrapped
    // message takes precedence. The original code lives in `cause`.
    expect((captured as Error & { code?: string }).code).toBeUndefined();
    expect(mockPrisma.rule.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Block C — source-walk pins
// ---------------------------------------------------------------------------

describe("Block C — seed.ts adoption pins (AC10 / AC11 + loopback-2 F8/F35)", () => {
  const source = readFileSync(SEED_TS_PATH, "utf8");

  it("AC10 — seed.ts contains the literal token `upsertDefaultRule(`, proving main() calls the helper rather than inline prisma.rule.upsert(...)", () => {
    expect(source).toContain("upsertDefaultRule(");
  });

  it("AC11 — seed.ts imports from `./thresholdTable`, proving the seed reads from the pure module rather than an inline duplicate", () => {
    expect(source).toMatch(/from\s+["']\.\/thresholdTable(?:\.js)?["']/);
  });

  it("loopback-2 F8 — seed.ts iterates THRESHOLD_TABLE in main() (regex /for ... const row ... THRESHOLD_TABLE/)", () => {
    expect(source).toMatch(/for\s*\(\s*const\s+row\s+of\s*THRESHOLD_TABLE\s*\)/);
  });

  it("loopback-2 F35 — seed.ts calls `await upsertDefaultRule(prisma, row)` inside the for-loop body", () => {
    expect(source).toMatch(/await\s+upsertDefaultRule\s*\(\s*prisma\s*,\s*row\s*\)/);
  });

  it("re-review V2 — seed.ts emits the documented `was deactivated by an admin; preserving as-is` skip-inactive notice (AC6 log format pinned)", () => {
    // The notice is emitted by `seed.ts`'s rule-loop, NOT by
    // `upsertDefaultRule` (which only returns `{ status: "skipped-inactive" }`).
    // A future refactor that removes or rewords the log would silently
    // degrade CI-debuggability of admin-took-over rows.
    expect(source).toContain("was deactivated by an admin; preserving as-is");
  });

  it("re-review F1/F4 — seed.ts emits the device-loop success log AFTER the rule-loop block (placement contract)", () => {
    // The string `seed: upserted ${parsed.devices.length} device rows`
    // appears AFTER the rule-loop's `for (const row of THRESHOLD_TABLE)`
    // in source order. Pins that the device-loop success log is the
    // last "all good" line in the seed's stdout so a rule abort shows
    // up before any "all good" device success line.
    const deviceLogIndex = source.indexOf("seed: upserted ${parsed.devices.length} device rows");
    const ruleLoopIndex = source.indexOf("for (const row of THRESHOLD_TABLE)");
    expect(deviceLogIndex).toBeGreaterThan(-1);
    expect(ruleLoopIndex).toBeGreaterThan(-1);
    expect(deviceLogIndex).toBeGreaterThan(ruleLoopIndex);
  });
});
