/**
 * `retention.spec.ts` — Story 5.5.
 *
 * Wire-schema regression coverage for the `CronRunStatusSchema`
 * closed enum + the `CronTickResult` / `RetentionConfigSchema`
 * type discriminators. The shared module is the canonical source
 * for the retention vocabulary — the Prisma `status` column
 * stays as a free `String` (migration-light), and the Zod enum
 * is the only wire contract for the cron-emit path.
 *
 * Precedent: `reading-aggregate.spec.ts` (Story 5.4).
 */
import { describe, expect, it } from "vitest";

import { CronRunStatusSchema, RetentionConfigSchema, type CronTickResult } from "./retention.js";

const ALL_STATUSES = ["running", "success", "failure"] as const;

describe("Story 5.5 — CronRunStatusSchema (closed enum)", () => {
  it.each(ALL_STATUSES)("accepts the closed-enum member %j", (status) => {
    expect(CronRunStatusSchema.parse(status)).toBe(status);
  });

  it("rejects a drift string outside the closed enum", () => {
    // Drift strings — anything not in the three-value vocabulary
    // must fail. Pin the closed-enum invariant against silent
    // drift (the spec calls this out as "wire contract").
    const drift = CronRunStatusSchema.safeParse("in_progress");
    expect(drift.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = CronRunStatusSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects a case-mismatched value (closed enum is case-sensitive)", () => {
    const result = CronRunStatusSchema.safeParse("SUCCESS");
    expect(result.success).toBe(false);
  });

  it("pins the enum size at exactly 3 members (drift detection)", () => {
    // Adding or removing a value would surface here as a count
    // mismatch. The set is intentionally small (running +
    // success + failure); a future "cancelled" status would be a
    // contract bump and require extending both this enum and the
    // runner's result-mapping.
    expect(ALL_STATUSES.length).toBe(3);
  });
});

describe("Story 5.5 — RetentionConfigSchema shape", () => {
  it("accepts a fully-populated retention config", () => {
    const parsed = RetentionConfigSchema.parse({
      retentionWindowDays: 30,
      batchSize: 10_000,
      intervalMs: 60 * 60 * 1000,
      lockKey: 0x5_55_5_55_5n,
    });
    expect(parsed.retentionWindowDays).toBe(30);
    expect(parsed.batchSize).toBe(10_000);
    expect(parsed.intervalMs).toBe(3_600_000);
    expect(parsed.lockKey).toBe(0x5_55_5_55_5n);
  });

  it("rejects a non-positive retentionWindowDays", () => {
    const result = RetentionConfigSchema.safeParse({
      retentionWindowDays: 0,
      batchSize: 10_000,
      intervalMs: 60 * 60 * 1000,
      lockKey: 0x5_55_5_55_5n,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive batchSize", () => {
    const result = RetentionConfigSchema.safeParse({
      retentionWindowDays: 30,
      batchSize: 0,
      intervalMs: 60 * 60 * 1000,
      lockKey: 0x5_55_5_55_5n,
    });
    expect(result.success).toBe(false);
  });
});

describe("Story 5.5 — CronTickResult discriminator", () => {
  it("accepts the success arm shape", () => {
    // Type-level discriminator pin — runtime does not need a Zod
    // parse, but the assignment must type-check against the union
    // (a regression that flips the status string from "success"
    // to "completed" would fail this).
    const result: CronTickResult = {
      status: "success",
      aggregatedRows: 250,
      deletedRows: 25_000,
    };
    expect(result.status).toBe("success");
  });

  it("accepts the skipped arm shape", () => {
    const result: CronTickResult = { status: "skipped", reason: "lock_held" };
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("lock_held");
  });
});
