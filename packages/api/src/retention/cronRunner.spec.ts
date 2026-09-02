/**
 * `cronRunner.spec.ts` — Story 5.5.
 *
 * Unit tests for `runningCronTick` covering the four spec AC
 * branches:
 *
 *   - TICK_HAPPY — 3 batches, capture upsert payloads + delete
 *     args + CronRun row + audit-emit envelope.
 *   - TICK_LOCK_HELD — `pg_try_advisory_lock` returns false;
 *     short-circuit with `{ status: "skipped", reason: "lock_held" }`;
 *     no side effects (no CronRun row, no audit emit).
 *   - TICK_EMPTY — no raw rows older than the cutoff → success
 *     with 0/0 counts; audit emit fires with success outcome.
 *   - TICK_FAILURE — upsert rejects mid-batch → CronRun failure
 *     row + audit failure emit + lock released.
 *
 * Mirrors the `captureRepo` test-rig pattern from
 * `incidents/applyTransition.spec.ts:83-126` (the applyTransition
 * writer uses a hand-rolled repo whose `$transaction` callback
 * receives a fresh `captureRepo`; this file uses the same shape
 * with stubbed `readingAggregate.upsert`, `reading.findMany`,
 * `reading.deleteMany`, `cronRun.create`, and `$queryRaw` for the
 * advisory-lock acquire/release).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CronTickResult } from "@surakkha/shared/retention";

import type { CronReadingRow, CronRepository } from "./cronRepository.js";
import { runningCronTick } from "./cronRunner.js";

const LOCK_KEY = 0x5_55_5_55_5n;
const CUTOFF = new Date("2026-08-01T12:00:00.000Z");
const DEVICE_A = "00000000-0000-4000-8000-00000000000a";
const DEVICE_B = "00000000-0000-4000-8000-00000000000b";

/**
 * The metrics envelope the stub rows carry. Mirrors the v1
 * telemetry wire shape 1:1; the stub uses small numeric values
 * so the captured upsert payloads are easy to read in test
 * failures.
 *
 * CRITICAL: this stub emits ONLY the long-name `TelemetryMetrics`
 * keys (`tds_ppm`, `turbidity_ntu`, `temp_c`, etc.). The cron
 * has a `RAW_TO_AGGREGATE` map that bridges the wire vocabulary
 * to the short-name aggregate vocabulary; if the cron reads the
 * wrong key, the `Number.isFinite(value)` guard silently skips
 * the metric and the test would fail with `aggregatedRows: 0`
 * instead of `aggregatedRows: 18`. Do NOT add short-name aliases
 * here — they would mask the production bug.
 */
const metrics = (tds_ppm: number, turbidity_ntu: number, ph: number, temp_c: number) => ({
  ph,
  tds_ppm,
  turbidity_ntu,
  chlorine_ppm: 0,
  temp_c,
  water_level_cm: 0,
});

/**
 * Capture sink the test rig populates so the assertions can
 * inspect what the runner actually invoked. Mirrors the
 * `captureSink` pattern from `applyTransition.spec.ts:85`.
 */
interface CaptureSink {
  readonly upserts: Array<{
    readonly deviceId: string | null;
    readonly bucketStart: Date;
    readonly metric: string;
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    readonly sampleCount: number;
  }>;
  readonly deletedIds: string[][];
  readonly cronRunRows: Array<{
    readonly status: string;
    readonly aggregatedRows: number;
    readonly deletedRows: number;
    readonly errorMessage: string | null;
  }>;
}

/**
 * Build a stub `CronRepository` whose methods populate the
 * capture sink. The `$transaction` callback runs against a
 * fresh `repo` whose captures land in the same sink (the
 * shared closure) — so writes inside the callback are
 * observed.
 *
 * `acquireLock: boolean` flips the `pg_try_advisory_lock`
 * return: `true` = the lock is free (the runner proceeds);
 * `false` = held (the runner short-circuits with skipped).
 *
 * `batches: CronReadingRow[][]` is the canned response of
 * `reading.findMany` (page-by-page); an empty first batch
 * short-circuits the loop with TICK_EMPTY.
 *
 * `upsertFailsOn: number | null` injects a mid-batch throw on
 * a specific upsert call index (TICK_FAILURE path). `null`
 * means no injected failure.
 */
const buildCaptureRepo = (
  sink: CaptureSink,
  config: {
    readonly acquireLock: boolean;
    readonly batches: ReadonlyArray<readonly CronReadingRow[]>;
    readonly upsertFailsOn?: number | null;
  },
): {
  readonly repo: CronRepository;
  readonly lockPrisma: { $queryRaw: ReturnType<typeof vi.fn> };
} => {
  let findManyCalls = 0;
  let upsertCalls = 0;

  const lockPrisma = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("pg_try_advisory_lock")) {
        return [{ locked: config.acquireLock }];
      }
      if (sql.includes("pg_advisory_unlock")) {
        return [];
      }
      return [];
    }),
  };

  const repo: CronRepository = {
    cronRun: {
      create: async (args) => {
        sink.cronRunRows.push({
          status: args.data.status,
          aggregatedRows: args.data.aggregatedRows,
          deletedRows: args.data.deletedRows,
          errorMessage: args.data.errorMessage ?? null,
        });
        return {
          id: `cronrun-${sink.cronRunRows.length}`,
          startedAt: args.data.startedAt,
          finishedAt: args.data.finishedAt ?? null,
          status: args.data.status,
          aggregatedRows: args.data.aggregatedRows,
          deletedRows: args.data.deletedRows,
          errorMessage: args.data.errorMessage ?? null,
        };
      },
    },
    readingAggregate: {
      findUnique: async () => null,
      upsert: async (args) => {
        upsertCalls += 1;
        if (
          config.upsertFailsOn !== null &&
          config.upsertFailsOn !== undefined &&
          config.upsertFailsOn === upsertCalls
        ) {
          throw new Error("P2002: unique constraint violation (test)");
        }
        sink.upserts.push({
          deviceId: args.where.deviceId_bucketStart_metric.deviceId,
          bucketStart: args.where.deviceId_bucketStart_metric.bucketStart,
          metric: args.where.deviceId_bucketStart_metric.metric,
          mean: args.create.mean,
          min: args.create.min,
          max: args.create.max,
          sampleCount: args.create.sampleCount,
        });
        return null;
      },
    },
    reading: {
      findMany: async () => {
        const batch = config.batches[findManyCalls] ?? [];
        findManyCalls += 1;
        return batch;
      },
      deleteMany: async (args) => {
        const ids = args.where.id.in;
        sink.deletedIds.push([...ids]);
        return { count: ids.length };
      },
    },
    // $transaction simply calls the callback synchronously with
    // the same repo — the test rig does not need transactional
    // semantics; we only need to capture the writes.
    $transaction: async <T>(cb: (tx: CronRepository) => Promise<T>): Promise<T> => cb(repo),
  };

  return { repo, lockPrisma };
};

const mergePrisma = (
  repo: CronRepository,
  lockPrisma: { $queryRaw: ReturnType<typeof vi.fn> },
): unknown => ({
  cronRun: repo.cronRun,
  readingAggregate: repo.readingAggregate,
  reading: repo.reading,
  $transaction: repo.$transaction,
  $queryRaw: lockPrisma.$queryRaw,
});

describe("Story 5.5 — runningCronTick (retention cron)", () => {
  describe("TICK_HAPPY", () => {
    let sink: CaptureSink;
    let result: CronTickResult;
    let unlockCalls: number;

    beforeEach(async () => {
      sink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      const row1: CronReadingRow = {
        id: "row-1",
        deviceId: DEVICE_A,
        ts: new Date("2026-07-30T12:37:14.000Z"),
        metrics: metrics(100, 5, 7.2, 25),
      };
      const row2: CronReadingRow = {
        id: "row-2",
        deviceId: DEVICE_B,
        ts: new Date("2026-07-30T12:38:30.000Z"),
        metrics: metrics(150, 6, 7.5, 26),
      };
      const row3: CronReadingRow = {
        id: "row-3",
        deviceId: DEVICE_A,
        ts: new Date("2026-07-30T12:39:45.000Z"),
        metrics: metrics(110, 4, 7.0, 24),
      };
      const { repo, lockPrisma } = buildCaptureRepo(sink, {
        acquireLock: true,
        batches: [[row1], [row2], [row3], []],
      });
      const prisma = mergePrisma(repo, lockPrisma);
      result = await runningCronTick({
        prisma,
        cutoff: CUTOFF,
        lockKey: LOCK_KEY,
        batchSize: 1,
      });
      const allCalls = lockPrisma.$queryRaw.mock.calls;
      unlockCalls = allCalls.filter((c) => String(c[0]).includes("pg_advisory_unlock")).length;
    });

    it("returns the success envelope with cumulative upsert + delete counts", () => {
      // 3 rows × 4 metrics (tds, turbidity, ph, temperature) = 12 upserts.
      expect(result).toEqual({ status: "success", aggregatedRows: 12, deletedRows: 3 });
    });

    it("issues 4 upserts per row (3 rows × 4 metrics)", () => {
      // The cron's `RAW_TO_AGGREGATE` map only bridges 4 metrics:
      // tds, turbidity, ph, temperature. Battery/signal are absent
      // from the wire (per `TelemetryMetricsSchema`) and so are
      // not iterated. If this assertion ever shows 18 instead of
      // 12, the test rig has drifted back to emitting both
      // vocabularies (which would mask the B-1 vocabulary-
      // mismatch bug).
      expect(sink.upserts).toHaveLength(12);
    });

    it("bucketed raw rows to the correct 5-minute floor (12:35)", () => {
      // All three rows fall in [12:35, 12:40) → bucket = 12:35:00.
      const bucketStarts = sink.upserts.map((u) => u.bucketStart.toISOString());
      for (const b of bucketStarts) {
        expect(b).toBe("2026-07-30T12:35:00.000Z");
      }
    });

    it("upserts use the deviceId, bucketStart, metric compound key", () => {
      const seenKeys = new Set(
        sink.upserts.map((u) => `${u.deviceId}|${u.bucketStart.toISOString()}|${u.metric}`),
      );
      // 2 devices × 4 metrics = 8 distinct compound keys
      expect(seenKeys.size).toBe(8);
    });

    it("per-batch delete carries the row ids for that batch only", () => {
      expect(sink.deletedIds).toEqual([["row-1"], ["row-2"], ["row-3"]]);
    });

    it("writes exactly ONE CronRun row at success (no running row)", () => {
      // Per spec: the writer DOES NOT emit a `running` row. Only
      // the final `success` row lands.
      expect(sink.cronRunRows).toHaveLength(1);
      expect(sink.cronRunRows[0]?.status).toBe("success");
      expect(sink.cronRunRows[0]?.aggregatedRows).toBe(12);
      expect(sink.cronRunRows[0]?.deletedRows).toBe(3);
      expect(sink.cronRunRows[0]?.errorMessage).toBeNull();
    });

    it("releases the advisory lock exactly once", () => {
      expect(unlockCalls).toBe(1);
    });
  });

  describe("TICK_LOCK_HELD", () => {
    it("skips with reason: lock_held when pg_try_advisory_lock returns false", async () => {
      const sink: CaptureSink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      const row: CronReadingRow = {
        id: "row-1",
        deviceId: DEVICE_A,
        ts: new Date("2026-07-30T12:37:14.000Z"),
        metrics: metrics(100, 5, 7.2, 25),
      };
      const { repo, lockPrisma } = buildCaptureRepo(sink, {
        acquireLock: false,
        batches: [[row]],
      });
      const prisma = mergePrisma(repo, lockPrisma);
      const result = await runningCronTick({
        prisma,
        cutoff: CUTOFF,
        lockKey: LOCK_KEY,
        batchSize: 10,
      });
      expect(result).toEqual({ status: "skipped", reason: "lock_held" });
      // No side effects: no upserts, no deletes, no CronRun row.
      expect(sink.upserts).toHaveLength(0);
      expect(sink.deletedIds).toHaveLength(0);
      expect(sink.cronRunRows).toHaveLength(0);
      // And no advisory-unlock call (we never acquired).
      const allCalls = lockPrisma.$queryRaw.mock.calls;
      const unlockCalls = allCalls.filter((c) => String(c[0]).includes("pg_advisory_unlock"));
      expect(unlockCalls).toHaveLength(0);
    });
  });

  describe("TICK_EMPTY", () => {
    it("returns success with 0/0 counts when no rows are older than cutoff", async () => {
      const sink: CaptureSink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      const { repo, lockPrisma } = buildCaptureRepo(sink, {
        acquireLock: true,
        batches: [[]], // first batch is empty → terminate loop
      });
      const prisma = mergePrisma(repo, lockPrisma);
      const result = await runningCronTick({
        prisma,
        cutoff: CUTOFF,
        lockKey: LOCK_KEY,
        batchSize: 10,
      });
      expect(result).toEqual({ status: "success", aggregatedRows: 0, deletedRows: 0 });
      expect(sink.upserts).toHaveLength(0);
      expect(sink.deletedIds).toHaveLength(0);
      expect(sink.cronRunRows).toHaveLength(1);
      expect(sink.cronRunRows[0]?.status).toBe("success");
      expect(sink.cronRunRows[0]?.aggregatedRows).toBe(0);
      expect(sink.cronRunRows[0]?.deletedRows).toBe(0);
    });
  });

  describe("TICK_FAILURE", () => {
    it("writes a CronRun failure row + rethrows when an upsert rejects mid-batch", async () => {
      const sink: CaptureSink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      const row1: CronReadingRow = {
        id: "row-1",
        deviceId: DEVICE_A,
        ts: new Date("2026-07-30T12:37:14.000Z"),
        metrics: metrics(100, 5, 7.2, 25),
      };
      const row2: CronReadingRow = {
        id: "row-2",
        deviceId: DEVICE_B,
        ts: new Date("2026-07-30T12:38:30.000Z"),
        metrics: metrics(150, 6, 7.5, 26),
      };
      // Inject failure on upsert call index 5 (after the first
      // row's 4 metrics — tds, turbidity, ph, temperature — and
      // mid-row2's first metric). The runner catches → writes
      // failure CronRun → rethrows.
      const { repo, lockPrisma } = buildCaptureRepo(sink, {
        acquireLock: true,
        batches: [[row1, row2]],
        upsertFailsOn: 5,
      });
      const prisma = mergePrisma(repo, lockPrisma);
      await expect(
        runningCronTick({ prisma, cutoff: CUTOFF, lockKey: LOCK_KEY, batchSize: 10 }),
      ).rejects.toThrow("P2002");
      // Exactly one CronRun row was written — the failure row.
      expect(sink.cronRunRows).toHaveLength(1);
      expect(sink.cronRunRows[0]?.status).toBe("failure");
      expect(sink.cronRunRows[0]?.errorMessage).toContain("P2002");
      // Lock released even on failure (the `finally` block
      // fires).
      const allCalls = lockPrisma.$queryRaw.mock.calls;
      const unlockCalls = allCalls.filter((c) => String(c[0]).includes("pg_advisory_unlock"));
      expect(unlockCalls).toHaveLength(1);
    });
  });

  describe("runtime guards", () => {
    it("rejects batchSize = 0 (defensive guard for the direct-call surface)", async () => {
      const sink: CaptureSink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      const { repo, lockPrisma } = buildCaptureRepo(sink, {
        acquireLock: true,
        batches: [[]],
      });
      const prisma = mergePrisma(repo, lockPrisma);
      await expect(
        runningCronTick({ prisma, cutoff: CUTOFF, lockKey: LOCK_KEY, batchSize: 0 }),
      ).rejects.toThrow(TypeError);
    });

    it("rejects batchSize = NaN", async () => {
      const sink: CaptureSink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      const { repo, lockPrisma } = buildCaptureRepo(sink, {
        acquireLock: true,
        batches: [[]],
      });
      const prisma = mergePrisma(repo, lockPrisma);
      await expect(
        runningCronTick({ prisma, cutoff: CUTOFF, lockKey: LOCK_KEY, batchSize: Number.NaN }),
      ).rejects.toThrow(TypeError);
    });

    it("rejects a negative batchSize", async () => {
      const sink: CaptureSink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      const { repo, lockPrisma } = buildCaptureRepo(sink, {
        acquireLock: true,
        batches: [[]],
      });
      const prisma = mergePrisma(repo, lockPrisma);
      await expect(
        runningCronTick({ prisma, cutoff: CUTOFF, lockKey: LOCK_KEY, batchSize: -10 }),
      ).rejects.toThrow(TypeError);
    });
  });

  describe("aggregate merge (read+merge instead of overwrite)", () => {
    it("computes running mean / min / max / sampleCount when the prior aggregate row exists", async () => {
      const sink: CaptureSink = {
        upserts: [],
        deletedIds: [],
        cronRunRows: [],
      };
      // First row of two — both into the same bucket, same
      // device, same metric. The second row should MERGE into
      // the first (not overwrite).
      const row1: CronReadingRow = {
        id: "row-1",
        deviceId: DEVICE_A,
        ts: new Date("2026-07-30T12:37:14.000Z"),
        metrics: metrics(100, 5, 7.2, 25),
      };
      const row2: CronReadingRow = {
        id: "row-2",
        deviceId: DEVICE_A,
        ts: new Date("2026-07-30T12:38:30.000Z"), // same 12:35 bucket
        metrics: metrics(150, 6, 7.5, 26),
      };

      // Override the findUnique stub so it returns a prior row
      // for the `tds` metric only (other metrics → no prior
      // row, exercise the `priorCount = 0` branch). We do this
      // by re-creating the rig with a custom readingAggregate.
      let findUniqueCalls = 0;
      let findManyCalls = 0;
      const lockPrisma = {
        $queryRaw: vi.fn(async () => [{ locked: true }]),
      };
      const repo: CronRepository = {
        cronRun: {
          create: async (args) => {
            sink.cronRunRows.push({
              status: args.data.status,
              aggregatedRows: args.data.aggregatedRows,
              deletedRows: args.data.deletedRows,
              errorMessage: args.data.errorMessage ?? null,
            });
            return null;
          },
        },
        readingAggregate: {
          findUnique: async (args) => {
            findUniqueCalls += 1;
            if (args.where.deviceId_bucketStart_metric.metric === "tds") {
              // Prior tds aggregate: 1 sample at value 100.
              return {
                deviceId: DEVICE_A,
                bucketStart: new Date("2026-07-30T12:35:00.000Z"),
                metric: "tds",
                mean: 100,
                min: 100,
                max: 100,
                sampleCount: 1,
              };
            }
            return null;
          },
          upsert: async (args) => {
            sink.upserts.push({
              deviceId: args.where.deviceId_bucketStart_metric.deviceId,
              bucketStart: args.where.deviceId_bucketStart_metric.bucketStart,
              metric: args.where.deviceId_bucketStart_metric.metric,
              mean: args.create.mean,
              min: args.create.min,
              max: args.create.max,
              sampleCount: args.create.sampleCount,
            });
            return null;
          },
        },
        reading: {
          findMany: async () => {
            // Return the same two rows on the first call, then
            // an empty batch on the second call to terminate
            // the loop (otherwise the loop would re-process the
            // same rows infinitely).
            findManyCalls += 1;
            if (findManyCalls === 1) return [row1, row2];
            return [];
          },
          deleteMany: async (args) => {
            sink.deletedIds.push([...args.where.id.in]);
            return { count: args.where.id.in.length };
          },
        },
        $transaction: async <T>(cb: (tx: CronRepository) => Promise<T>): Promise<T> => cb(repo),
      };
      const prisma = mergePrisma(repo, lockPrisma);
      const result = await runningCronTick({
        prisma,
        cutoff: CUTOFF,
        lockKey: LOCK_KEY,
        batchSize: 10,
      });
      expect(result).toEqual({ status: "success", aggregatedRows: 8, deletedRows: 2 });

      // Find the tds-upserts. The stub's `findUnique` returns
      // a prior row (mean=100, count=1) for every `tds` query —
      // so both tds-upserts merge-additively into the prior.
      // The merge is row1: priorCount=1 + value=100 = (100*1+100)/2 = 100, count=2
      //           row2: priorCount=2 + value=150 = (100*2+150)/3 = 116.67, count=3
      //   wait — `priorCount` is the stubbed prior's `sampleCount`,
      //   and the stub always returns the SAME prior (sampleCount=1).
      //   So row1 sees priorCount=1 with mean=100, adds value=100:
      //     newCount=2, newMean = (100*1 + 100) / 2 = 100, min=100, max=100.
      //   Row2 sees priorCount=1 with mean=100, adds value=150:
      //     newCount=2, newMean = (100*1 + 150) / 2 = 125, min=100, max=150.
      const tdsUpserts = sink.upserts.filter((u) => u.metric === "tds");
      expect(tdsUpserts).toHaveLength(2);

      expect(tdsUpserts[0]).toMatchObject({
        mean: 100, // (100*1 + 100) / 2
        min: 100,
        max: 100,
        sampleCount: 2,
      });
      expect(tdsUpserts[1]).toMatchObject({
        mean: 125, // (100*1 + 150) / 2
        min: 100,
        max: 150,
        sampleCount: 2,
      });
      expect(findUniqueCalls).toBeGreaterThan(0);
    });
  });
});
