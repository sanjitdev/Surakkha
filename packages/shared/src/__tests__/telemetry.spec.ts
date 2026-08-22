/**
 * Tests for `@surakkha/shared/telemetry` wire-contract surface (Story 2.1).
 *
 * Covers the I/O Matrix rows from the spec:
 *   VALID_FRAME, MISSING_METRIC, OUT_OF_RANGE, WRONG_VERSION, NA_NUMBER.
 *
 * Error cases are parameterised over a `ZOD_ERROR_CASES` table per Epic 1
 * retrospective lesson L1 (data-driven register pattern) so a regression
 * in any path surfaces as one named `it.each` failure, not five duplicates.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  classifyFlags,
  CLOCK_SKEW_DETECT_MS,
  MetricExtendedRanges,
  PROCESSING_ORDER,
  ReadingFlagSchema,
  STALE_FRAME_THRESHOLD_MS,
  type TelemetryFrame,
  TelemetryFrameSchema,
  translateZodError,
} from "../index.js";

const VALID_DEVICE_UUID = "9b1c4d2e-1234-4abc-9def-1234567890ab";
const VALID_FRAME: TelemetryFrame = {
  version: 1,
  device_id: VALID_DEVICE_UUID,
  ts: 1_700_000_000,
  fw: "1.0.3",
  seq: 8421,
  metrics: {
    ph: 7.2,
    tds_ppm: 180,
    turbidity_ntu: 0.4,
    temp_c: 27.4,
    chlorine_ppm: 0.6,
    water_level_cm: 85,
  },
};

const makeFrame = (
  overrides: Partial<TelemetryFrame> & {
    metricsOverride?: Partial<TelemetryFrame["metrics"]>;
  } = {},
): Record<string, unknown> => {
  const { metricsOverride, ...rest } = overrides;
  const metrics = { ...VALID_FRAME.metrics, ...(metricsOverride ?? {}) };
  return { ...VALID_FRAME, ...rest, metrics };
};

interface ZodErrorCase {
  readonly name: string;
  readonly mutate: () => Record<string, unknown>;
  readonly expectedMissing: readonly string[];
}

/**
 * Data-driven register (Epic 1 retro L1). Each row is a malformed frame;
 * the test asserts that `translateZodError` returns the right
 * `missing_fields` for that mutation.
 */
const ZOD_ERROR_CASES: readonly ZodErrorCase[] = [
  {
    name: "missing `ph`",
    mutate: () => {
      const candidate = makeFrame();
      const { ph: _drop, ...restMetrics } = (candidate.metrics ?? {}) as Record<string, unknown>;
      return { ...candidate, metrics: restMetrics };
    },
    expectedMissing: ["metrics.ph"],
  },
  {
    name: "out-of-range `ph=15`",
    mutate: () => makeFrame({ metricsOverride: { ph: 15 } }),
    expectedMissing: ["metrics.ph"],
  },
  {
    name: "wrong `version:2`",
    mutate: () => makeFrame({ version: 2 as unknown as 1 }),
    expectedMissing: ["version"],
  },
  {
    name: "`ph:NaN`",
    mutate: () => makeFrame({ metricsOverride: { ph: Number.NaN } }),
    expectedMissing: ["metrics.ph"],
  },
  {
    name: "device_id is not a uuid",
    mutate: () => makeFrame({ device_id: "not-a-uuid" }),
    expectedMissing: ["device_id"],
  },
];

describe("TelemetryFrameSchema happy path", () => {
  it("round-trips a valid v1 frame with every field preserved", () => {
    const result = TelemetryFrameSchema.safeParse(VALID_FRAME);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Field-for-field: a regression that strips `ts` / `fw` / `seq` would fail here.
    expect(result.data).toEqual(VALID_FRAME);
  });
});

describe("TelemetryFrameSchema error matrix (translateZodError)", () => {
  for (const { name, mutate, expectedMissing } of ZOD_ERROR_CASES) {
    it(`produces bad_request with missing_fields=[${[...expectedMissing].join(",")}] for ${name}`, () => {
      const candidate = mutate();
      const result = TelemetryFrameSchema.safeParse(candidate);
      expect(result.success).toBe(false);
      if (result.success) return;
      const translated = translateZodError(result.error);
      expect(translated.error).toBe("bad_request");
      expect(translated.missing_fields).toEqual([...expectedMissing]);
    });
  }
});

/**
 * Boundary coverage for every metric in `MetricRanges`. Each row pins
 * `min - 1` (just out, must fail) and `min` (just in, must pass). The
 * `max + 1` / `max` rows are covered by the missing / out-of-range cases
 * above (e.g. `ph=15` is `max+1` for the `ph` range).
 *
 * Each row is named after the metric + boundary so a regression in any
 * one row surfaces as a single named failure (Epic 1 retro L1 pattern).
 */
describe("TelemetryFrameSchema boundary table (MetricRanges min-1 / min / max+1)", () => {
  interface BoundaryRow {
    readonly metric: keyof typeof VALID_FRAME.metrics;
    readonly minMinusOne: number;
    readonly min: number;
    readonly maxPlusOne: number;
  }
  const BOUNDARIES: readonly BoundaryRow[] = [
    { metric: "ph", minMinusOne: -0.001, min: 0, maxPlusOne: 15 },
    { metric: "tds_ppm", minMinusOne: -1, min: 0, maxPlusOne: 5001 },
    { metric: "turbidity_ntu", minMinusOne: -1, min: 0, maxPlusOne: 1001 },
    { metric: "temp_c", minMinusOne: -10.001, min: -10, maxPlusOne: 81 },
    { metric: "chlorine_ppm", minMinusOne: -0.001, min: 0, maxPlusOne: 6 },
    { metric: "water_level_cm", minMinusOne: -1, min: 0, maxPlusOne: 501 },
  ];

  for (const { metric, minMinusOne, min, maxPlusOne } of BOUNDARIES) {
    it(`${metric}: ${minMinusOne} (min-1) is rejected`, () => {
      const result = TelemetryFrameSchema.safeParse(
        makeFrame({ metricsOverride: { [metric]: minMinusOne } }),
      );
      expect(result.success).toBe(false);
    });

    it(`${metric}: ${min} (min inclusive) is accepted`, () => {
      const result = TelemetryFrameSchema.safeParse(
        makeFrame({ metricsOverride: { [metric]: min } }),
      );
      expect(result.success).toBe(true);
    });

    it(`${metric}: ${maxPlusOne} (max+1) is rejected`, () => {
      const result = TelemetryFrameSchema.safeParse(
        makeFrame({ metricsOverride: { [metric]: maxPlusOne } }),
      );
      expect(result.success).toBe(false);
    });
  }
});

describe("TelemetryFrameSchema strict-mode unknown-key rejection", () => {
  it("rejects unknown top-level keys per ADR 0001 (.strict()) with exact path", () => {
    const result = TelemetryFrameSchema.safeParse({
      ...VALID_FRAME,
      unknown_top_level: "x",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    // Zod `unrecognized_keys` issues carry the offending keys in `issue.keys`;
    // `translateZodError` joins them onto the dotted path so firmware sees
    // the bare key name. `toEqual` (not `toContain`) pins the entire
    // envelope shape.
    const translated = translateZodError(result.error);
    expect(translated.error).toBe("bad_request");
    expect(translated.missing_fields).toEqual(["unknown_top_level"]);
  });

  it("surfaces multiple unknown top-level keys (path|code boundary)", () => {
    const result = TelemetryFrameSchema.safeParse({
      ...VALID_FRAME,
      extra_a: "x",
      extra_b: "y",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const translated = translateZodError(result.error);
    expect(translated.missing_fields).toContain("extra_a");
    expect(translated.missing_fields).toContain("extra_b");
  });

  it("ignores unknown keys inside `metrics` per ADR 0001 (forward-compat)", () => {
    // `TelemetryMetricsSchema` is not `.strict()`, so unknown metric keys
    // are silently dropped. This matches ADR 0001's "ignore-not-reject"
    // rule for forward-compat (firmware may add metrics in v2 without
    // a server release). The strict `.strict()` only applies to top-level
    // frame keys.
    const result = TelemetryFrameSchema.safeParse({
      ...VALID_FRAME,
      metrics: { ...VALID_FRAME.metrics, mystery_metric: 42 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metrics).not.toHaveProperty("mystery_metric");
  });
});

describe("translateZodError path|code dedup", () => {
  it("surfaces two issues on the same path with different codes", () => {
    // Synthesizes a ZodError where one path carries two issues with
    // distinct codes. Path-only dedup would drop one; path+code dedup
    // (the production behavior) surfaces both.
    const synthetic = new z.ZodError([
      {
        code: "invalid_type",
        expected: "number",
        received: "nan",
        path: ["metrics", "ph"],
        message: "Expected number, received nan",
      },
      {
        code: "too_small",
        minimum: 0,
        type: "number",
        inclusive: true,
        exact: false,
        message: "Number must be greater than or equal to 0",
        path: ["metrics", "ph"],
      },
    ]);
    const translated = translateZodError(synthetic);
    expect(translated.missing_fields.filter((p) => p === "metrics.ph")).toHaveLength(2);
  });
});

describe("MetricExtendedRanges (architecture §3.2 extended observation range)", () => {
  it("turbidity_ntu max is 3000 and chlorine_ppm max is 10", () => {
    expect(MetricExtendedRanges.turbidity_ntu.max).toBe(3000);
    expect(MetricExtendedRanges.chlorine_ppm.max).toBe(10);
  });

  it("full set matches architecture §3.2 extended observation envelope", () => {
    // Pins all 6 metrics so a future edit cannot drift the four that
    // happen to equal `MetricRanges` (Story 3.3 imports the full set).
    expect(MetricExtendedRanges).toEqual({
      ph: { min: 0, max: 14 },
      tds_ppm: { min: 0, max: 5_000 },
      turbidity_ntu: { min: 0, max: 3_000 },
      temp_c: { min: -10, max: 80 },
      chlorine_ppm: { min: 0, max: 10 },
      water_level_cm: { min: 0, max: 500 },
    });
  });
});

describe("PROCESSING_ORDER (architecture §3.2, ADR 0013)", () => {
  it("matches the canonical 10-step literal character-for-character", () => {
    // Locks the constant against the ADR §"Decision" and architecture §3.2
    // enumerated list. A regression that reorders adjacent steps in
    // `telemetry.ts` is caught here without depending on Story 2.2's
    // `frame.spec.ts`.
    expect(JSON.stringify(PROCESSING_ORDER)).toEqual(
      JSON.stringify([
        "validate",
        "auth check",
        "rate check",
        "seq/drop check",
        "persist",
        "rule evaluation",
        "alert emission",
        "state-machine update",
        "audit append",
        "socket broadcast",
      ]),
    );
  });
});

/**
 * Story 2.3 — ReadingFlagSchema (closed enum pin).
 *
 * The persisted `flags` column and the `reading:new` wire payload both
 * flow through this enum. A typo'd flag is caught here at the seam so
 * ops queries (`SELECT WHERE 'clock_skew_deteced' = ANY (flags)`) cannot
 * silently miss a flag.
 */
describe("ReadingFlagSchema (Story 2.3)", () => {
  it("accepts every v1 flag exactly once", () => {
    expect(ReadingFlagSchema.options).toEqual([
      "out_of_order",
      "clock_skew_detected",
      "rate_limited",
    ]);
  });

  it.each([
    "out_of_order",
    "clock_skew_detected",
    "rate_limited",
  ])("parses `%s` without error", (flag) => {
    expect(ReadingFlagSchema.parse(flag)).toBe(flag);
  });

  it("rejects an unknown flag (closed enum)", () => {
    expect(ReadingFlagSchema.safeParse("not_a_flag").success).toBe(false);
  });

  it("rejects a typo of an existing flag (no fuzzy match)", () => {
    // Most common drift: missing underscore / typo'd casing. Pin that
    // the parser does NOT silently normalise.
    expect(ReadingFlagSchema.safeParse("clock_skew_deteced").success).toBe(false);
    expect(ReadingFlagSchema.safeParse("CLOCK_SKEW_DETECTED").success).toBe(false);
    expect(ReadingFlagSchema.safeParse("clock-skew-detected").success).toBe(false);
  });
});

/**
 * Story 2.3 — STALE_FRAME_THRESHOLD_MS / CLOCK_SKEW_DETECT_MS constants.
 *
 * The simulator (Story 2.4) imports these so its pre-send ts validation
 * stays in lockstep with the api. A regression that drifts the value
 * would silently change the v1 contract.
 */
describe("Story 2.3 — stale-frame + clock-skew thresholds", () => {
  it("STALE_FRAME_THRESHOLD_MS is 5 minutes", () => {
    expect(STALE_FRAME_THRESHOLD_MS).toBe(5 * 60 * 1_000);
  });

  it("CLOCK_SKEW_DETECT_MS is 60 seconds (architecture §3.2 row pin)", () => {
    expect(CLOCK_SKEW_DETECT_MS).toBe(60 * 1_000);
  });

  it("stale window is larger than clock-skew window (5min > 1min)", () => {
    // Logical invariant: a frame that is past the skew window but
    // within the stale window is exactly the row that gets the
    // `clock_skew_detected` flag (not the stale-frame envelope).
    expect(STALE_FRAME_THRESHOLD_MS).toBeGreaterThan(CLOCK_SKEW_DETECT_MS);
  });
});

/**
 * Story 2.3 — classifyFlags helper.
 *
 * The api calls `classifyFlags(parsed, serverReceivedAt)` after a
 * successful Zod parse to derive the per-frame flag set. Rules:
 *   - |skew| ≤ 60s       → []
 *   - 60s < skew < 5min  → ["clock_skew_detected"] (any sign)
 *   - skew > 5min (past) → up to the api's stale-frame check; helper
 *                          returns ["clock_skew_detected"] in case the
 *                          caller did not pre-check (defensive).
 */
describe("classifyFlags (Story 2.3)", () => {
  const baseTs = 1_787_221_864_000; // 2026-08-20T10:31:04Z
  const baseFrame = (ts: number): TelemetryFrame => ({
    ...VALID_FRAME,
    ts,
  });

  it("returns [] when serverReceivedAt equals ts (zero skew)", () => {
    const at = new Date(baseTs);
    expect(classifyFlags(baseFrame(baseTs), at)).toEqual([]);
  });

  it("returns [] when |skew| is 30s (well under threshold)", () => {
    expect(classifyFlags(baseFrame(baseTs - 30_000), new Date(baseTs))).toEqual([]);
    expect(classifyFlags(baseFrame(baseTs + 30_000), new Date(baseTs))).toEqual([]);
  });

  it("returns [clock_skew_detected] when past skew is 90s", () => {
    const result = classifyFlags(baseFrame(baseTs - 90_000), new Date(baseTs));
    expect(result).toEqual(["clock_skew_detected"]);
  });

  it("returns [clock_skew_detected] when future skew is 90s", () => {
    // Device clock ran forward during sleep — accepted with the flag.
    const result = classifyFlags(baseFrame(baseTs + 90_000), new Date(baseTs));
    expect(result).toEqual(["clock_skew_detected"]);
  });

  it("returns [clock_skew_detected] at exactly 61s skew (boundary +1)", () => {
    const result = classifyFlags(baseFrame(baseTs - 61_000), new Date(baseTs));
    expect(result).toEqual(["clock_skew_detected"]);
  });

  it("returns [] at exactly 59s skew (boundary -1)", () => {
    const result = classifyFlags(baseFrame(baseTs - 59_000), new Date(baseTs));
    expect(result).toEqual([]);
  });

  it("returns [clock_skew_detected] for any skew within the stale window", () => {
    // The api's stale-frame check would have rejected frames with
    // skew > 5min, but classifyFlags still surfaces the flag for
    // callers that don't pre-check (defensive contract).
    const result = classifyFlags(
      baseFrame(baseTs - 4 * 60_000),
      new Date(baseTs),
    );
    expect(result).toEqual(["clock_skew_detected"]);
  });
});