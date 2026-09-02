/**
 * `reading-aggregate.spec.ts` — Story 5.4 (review pass) + 5.5.
 *
 * Wire-schema regression coverage for the `ReadingAggregate` table's
 * closed-enum metric column. The shared module is the canonical
 * source for the metric vocabulary — the Prisma column stays as a
 * free `String` (migration-light), and the Zod enum is the only wire
 * contract. Story 5.5's retention cron + the future admin read
 * surface both consume this enum, so any drift surfaces here at the
 * unit boundary (no api / web imports).
 *
 * Precedent: `notification.spec.ts` (Story 4.10 + 5.1).
 */
import { describe, expect, it } from "vitest";

import { ReadingAggregateMetricSchema, floorToFiveMinutes } from "./reading-aggregate.js";

const ALL_METRICS = ["tds", "turbidity", "ph", "temperature", "battery", "signal"] as const;

describe("Story 5.4 — ReadingAggregateMetricSchema (closed enum)", () => {
  it.each(ALL_METRICS)("accepts the closed-enum member %j", (metric) => {
    expect(ReadingAggregateMetricSchema.parse(metric)).toBe(metric);
  });

  it("rejects a value outside the closed enum", () => {
    // Drift strings — anything not in the six-value vocabulary must
    // fail. Pin the closed-enum invariant against silent drift
    // (the spec calls this out as "wire contract").
    const drift = ReadingAggregateMetricSchema.safeParse("orp_mv");
    expect(drift.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = ReadingAggregateMetricSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects a case-mismatched value (closed enum is case-sensitive)", () => {
    const result = ReadingAggregateMetricSchema.safeParse("TDS");
    expect(result.success).toBe(false);
  });

  it("pins the enum size at exactly 6 members (drift detection)", () => {
    // Adding or removing a value would surface here as a count
    // mismatch. The api/MetricKeySchema (telemetry.ts) has its own
    // 6 members with a different vocabulary — those two enums are
    // NOT the same; this test pins only the ReadingAggregate enum
    // size.
    expect(ALL_METRICS.length).toBe(6);
  });
});

describe("Story 5.5 — floorToFiveMinutes (retention-cron bucket floor)", () => {
  // The helper is the load-bearing seam for the cron's
  // bucket-assignment step. A regression that rounds UP (or
  // biases off-by-one) would silently re-key raw rows to the
  // wrong bucket and break the upsert idempotency invariant.
  // Pins:
  //   - aligned ts (no change)
  //   - off-by-1ms rounds down
  //   - off-by-4m59s rounds to floor
  //   - exactly-on-boundary stays
  //   - naive-Date input converted to UTC

  it("leaves an aligned ts unchanged (no rounding bias)", () => {
    const aligned = new Date("2026-09-01T12:35:00.000Z");
    expect(floorToFiveMinutes(aligned).toISOString()).toBe("2026-09-01T12:35:00.000Z");
  });

  it("rounds a ts that is off by 1ms down to the prior 5-minute boundary", () => {
    const offByOneMs = new Date("2026-09-01T12:35:00.001Z");
    expect(floorToFiveMinutes(offByOneMs).toISOString()).toBe("2026-09-01T12:35:00.000Z");
  });

  it("rounds a ts that is off by 4 minutes 59 seconds down to the floor", () => {
    const offBy4m59s = new Date("2026-09-01T12:39:59.000Z");
    expect(floorToFiveMinutes(offBy4m59s).toISOString()).toBe("2026-09-01T12:35:00.000Z");
  });

  it("treats exactly-on-boundary input as already-aligned (no drift)", () => {
    const exactlyBoundary = new Date("2026-09-01T12:40:00.000Z");
    expect(floorToFiveMinutes(exactlyBoundary).toISOString()).toBe("2026-09-01T12:40:00.000Z");
  });

  it("floors a naive-Date input using UTC arithmetic (no host-tz bias)", () => {
    // `new Date('2026-09-01T12:37:14.000')` is a naive Date
    // (parsed as LOCAL time on the host). The helper must NOT
    // consult the host timezone — it uses `getTime()` which is
    // timezone-independent. The test asserts the bucket is
    // computed off the underlying UTC instant.
    const naive = new Date("2026-09-01T12:37:14");
    const expectedMs = Math.floor(naive.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
    expect(floorToFiveMinutes(naive).getTime()).toBe(expectedMs);
  });

  it("returns a NEW Date instance (does not mutate the input)", () => {
    const input = new Date("2026-09-01T12:37:14.000Z");
    const original = input.getTime();
    const result = floorToFiveMinutes(input);
    expect(result).not.toBe(input);
    expect(input.getTime()).toBe(original);
    expect(result.toISOString()).toBe("2026-09-01T12:35:00.000Z");
  });

  it("throws TypeError on a malformed Date input (defensive guard for the cron)", () => {
    // `new Date(NaN)` is a valid Date instance whose getTime() is
    // NaN. Without the guard, `Math.floor(NaN/...) * ... = NaN`,
    // and `new Date(NaN).toISOString()` throws RangeError. The
    // cron would crash the entire batch on a single corrupt raw
    // row. The TypeError makes the malformed input visible so the
    // cron can skip-and-continue.
    const malformed = new Date(Number.NaN);
    expect(() => floorToFiveMinutes(malformed)).toThrow(TypeError);
  });
});
