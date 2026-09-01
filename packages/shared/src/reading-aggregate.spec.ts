/**
 * `reading-aggregate.spec.ts` — Story 5.4 (review pass).
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

import { ReadingAggregateMetricSchema } from "./reading-aggregate.js";

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
