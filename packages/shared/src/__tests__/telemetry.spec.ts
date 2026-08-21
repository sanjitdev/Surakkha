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

import {
  MetricSoftRanges,
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
  it("round-trips a valid v1 frame", () => {
    const result = TelemetryFrameSchema.safeParse(VALID_FRAME);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe(1);
    expect(result.data.device_id).toBe(VALID_DEVICE_UUID);
    expect(result.data.metrics).toEqual(VALID_FRAME.metrics);
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

describe("MetricSoftRanges (architecture §3.2 extended observation range)", () => {
  it("turbidity_ntu max is 3000 and chlorine_ppm max is 10", () => {
    expect(MetricSoftRanges.turbidity_ntu.max).toBe(3000);
    expect(MetricSoftRanges.chlorine_ppm.max).toBe(10);
  });
});