/**
 * `cronRunner.ts` — Story 5.5.
 *
 * Pure function `runningCronTick({ prisma, cutoff, lockKey, batchSize })`
 * that runs ONE tick of the hourly retention cron. Mirrors the
 * `applyTransition` pattern from `incidentStateRepository.ts:268-369`:
 *
 *   - Pure function with no module-scoped state. The wiring layer
 *     resolves Prisma once at boot; the runner is invoked per
 *     `setInterval` tick.
 *   - Try-advisory-lock (skip-on-contention; see "Why pg_try_advisory_lock"
 *     below) → batch loop → release lock → write `CronRun` row →
 *     return `CronTickResult`. No `audit.emit` here — the wiring
 *     layer (`cronWiring.ts`) owns the audit surface so the runner
 *     stays IO-portable (it can be unit-tested with a stub `prisma`
 *     without faking the audit logger).
 *
 * The `prisma` arg is typed `unknown` at the public boundary;
 * the runner narrows via `resolveCronRepository(prisma)` so the
 * same lazy-resolver seam as the boot layer applies. Tests inject
 * a hand-rolled `CronRepository` stub matching the same shape (see
 * `cronRunner.spec.ts`).
 *
 * Why `pg_try_advisory_lock` (non-blocking, skip-on-contention):
 *   - The spec's "Resolved at step-01" decision picked the
 *     non-blocking variant over `pg_advisory_lock` (blocking).
 *     Blocking would queue concurrent ticks behind the first one,
 *     which is bad behaviour for a 10k-row-per-batch job that may
 *     run for many minutes; the next tick should short-circuit so
 *     the next interval's slot is free.
 *   - `true` → lock acquired (we own it for the rest of the tick).
 *   - `false` → lock held by another process (a sibling tick is
 *     running). Short-circuit with `{ status: "skipped", reason:
 *     "lock_held" }`; no `CronRun` row, no `audit.emit`.
 *
 * Atomicity:
 *   - Each batch runs in a `$transaction`. A mid-batch throw
 *     rolls back the upsert + deleteMany pair; the catch block
 *     writes a `CronRun` failure row + releases the lock.
 *   - The `pg_advisory_unlock` fires in the `finally` block so
 *     the lock is released even when the batch loop throws.
 */
import {
  floorToFiveMinutes,
  type ReadingAggregateMetric,
} from "@surakkha/shared/reading-aggregate";

import {
  type CronReadingRow,
  type CronRepository,
  resolveCronRepository,
} from "./cronRepository.js";

import type { CronTickResult } from "@surakkha/shared/retention";

/**
 * Inputs to `runningCronTick`. The full `RetentionConfigSchema` lives
 * at `packages/shared/src/retention.ts`; the runner only consumes
 * `cutoff`, `lockKey`, and `batchSize` — the `intervalMs` is the
 * wiring layer's concern.
 */
export interface RunningCronTickInput {
  readonly prisma: unknown;
  readonly cutoff: Date;
  readonly lockKey: bigint;
  readonly batchSize: number;
}

/**
 * The aggregate metric keys the cron writes per raw row. Mirrors
 * the `ReadingAggregateMetricSchema` from
 * `@surakkha/shared/reading-aggregate` 1:1; the per-row loop walks
 * these keys in a stable order so the upsert payload is
 * reproducible across ticks.
 *
 * Note: the RAW `Reading.metrics` payload uses LONG-name wire keys
 * (`tds_ppm`, `turbidity_ntu`, `temp_c`, `chlorine_ppm`,
 * `water_level_cm`, `ph`) per `TelemetryMetricsSchema`. The
 * aggregate column uses the SHORT names. The `RAW_TO_AGGREGATE`
 * map below bridges the two vocabularies at the cron's read seam;
 * without it the `rawMetrics[metric]` lookup silently returns
 * `undefined` for every real row and the cron emits `success` with
 * `aggregatedRows: 0` while still deleting the source raw rows
 * (silent data loss). Battery/signal are absent from the raw wire
 * — the simulator does not emit them — so they have no mapping
 * entry and are skipped by the per-row loop (a future firmware
 * extension adding those channels would extend this map).
 */
const RAW_TO_AGGREGATE: ReadonlyMap<ReadingAggregateMetric, string> = new Map([
  ["tds", "tds_ppm"],
  ["turbidity", "turbidity_ntu"],
  ["ph", "ph"],
  ["temperature", "temp_c"],
  // battery + signal: no raw wire key today. The aggregate enum
  // includes them so future firmware extensions can write
  // historical aggregates; today they are simply absent from the
  // per-row iteration.
]);

/**
 * Aggregate keys the per-row loop walks. This is the keys-of
 * `RAW_TO_AGGREGATE` set — declared explicitly so the iteration
 * order is stable. Battery/signal are intentionally absent: the
 * raw wire does not carry them today; if a future firmware bump
 * adds them, the map above gains a `RAW_TO_AGGREGATE.set(...)`
 * entry AND this array gains the key.
 */
const ALL_METRICS: readonly ReadingAggregateMetric[] = ["tds", "turbidity", "ph", "temperature"];

/**
 * Hard cap on the number of batches processed per tick. Defends
 * against a misconfigured `batchSize` (NaN, Infinity, "10000"
 * string, etc.) causing an infinite `while (true)` loop. At
 * 10_000 rows/batch × 1000 batches = 10M rows/tick — well above
 * any reasonable retention backlog. A tick exceeding this ceiling
 * exits the loop and resumes on the next interval.
 */
const MAX_BATCHES_PER_TICK = 1_000;

/**
 * Minimal Prisma-client surface the lock acquire/release path
 * needs. Declared locally so this file never imports
 * `@prisma/client` directly (the `resolveCronRepository` adapter
 * narrows the full client; this is a second narrow slice for the
 * `$queryRaw` calls).
 */
interface PrismaClientForLocks {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * Postgres advisory-lock acquire + release. The lock key is a
 * stable `bigint` constant (lives in `cronWiring.ts` so the wiring
 * + the runner agree on the value); `pg_try_advisory_lock` returns
 * a single boolean row whose `?column?` field is `true` if the
 * lock was acquired, `false` if another process holds it.
 *
 * The release is `pg_advisory_unlock` (no return value used; if
 * the lock was already released by Postgres the function returns
 * `false` but does not error — the runner logs and continues).
 */
const tryAdvisoryLock = async (client: PrismaClientForLocks, lockKey: bigint): Promise<boolean> => {
  const rows =
    (await client.$queryRaw`SELECT pg_try_advisory_lock(${lockKey}) AS locked`) as ReadonlyArray<{
      readonly locked: boolean;
    }>;
  return rows[0]?.locked === true;
};

const releaseAdvisoryLock = async (
  client: PrismaClientForLocks,
  lockKey: bigint,
): Promise<void> => {
  await client.$queryRaw`SELECT pg_advisory_unlock(${lockKey})`;
};

/**
 * One batch of the per-batch loop. Reads up to `batchSize` raw
 * rows whose `ts < cutoff`, upserts per `(deviceId, bucketStart,
 * metric)` triple, then deletes the source raw rows — all inside
 * a single `$transaction` callback.
 *
 * Returns `{ aggregatedRows, deletedRows }` for the caller to
 * accumulate. A throw inside the `$transaction` rolls back the
 * whole batch; the caller catches and writes the `CronRun`
 * failure row.
 *
 * Aggregate arithmetic (read+merge):
 *   The naive upsert (`update: { mean, min, max, sampleCount: 1 }`)
 *   is WRONG — it overwrites any prior bucket with a single new
 *   sample, destroying historical aggregates whenever the cron
 *   processes a second raw row into the same bucket. The correct
 *   shape is:
 *
 *     1. Read the prior aggregate row (if any).
 *     2. Compute running mean: newMean = (oldMean*oldCount + value) / (oldCount + 1)
 *     3. min/max: take min/max of (oldMin, value) / (oldMax, value).
 *     4. sampleCount: oldCount + 1.
 *
 *   This makes the upsert merge-additive so re-processing the same
 *   bucket across ticks (e.g. an hourly tick that overlaps the
 *   30-day window before the cutoff advances) does not corrupt
 *   prior aggregates. The merge is done in JS rather than via a
 *   single SQL `UPDATE ... SET mean = (mean*sampleCount + $x) /
 *   (sampleCount + 1)` to keep the code SQL-portable and the
 *   arithmetic visible.
 */
const processBatch = async (
  repo: CronRepository,
  cutoff: Date,
  batchSize: number,
): Promise<{ readonly aggregatedRows: number; readonly deletedRows: number }> => {
  const rows = (await repo.reading.findMany({
    where: { ts: { lt: cutoff } },
    orderBy: [{ ts: "asc" }],
    take: batchSize,
  })) as readonly CronReadingRow[];
  if (rows.length === 0) {
    return { aggregatedRows: 0, deletedRows: 0 };
  }

  return repo.$transaction(async (tx) => {
    let aggregatedRows = 0;
    for (const row of rows) {
      // Defensive: skip rows whose `ts` is malformed (NaN /
      // Invalid Date). `floorToFiveMinutes(new Date(NaN))` would
      // throw `RangeError: Invalid time value` and crash the
      // whole batch; one corrupt row would silently break the
      // cron. The skip is silent — the corrupt row is still
      // deleted by `tx.reading.deleteMany` at the end of the
      // batch so the backlog drains on the next tick.
      if (!(row.ts instanceof Date) || Number.isNaN(row.ts.getTime())) {
        continue;
      }
      const bucketStart = floorToFiveMinutes(row.ts);
      const rawMetrics = row.metrics as unknown as Record<string, unknown>;
      for (const metric of ALL_METRICS) {
        const rawKey = RAW_TO_AGGREGATE.get(metric);
        if (rawKey === undefined) continue;
        const value = rawMetrics[rawKey];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          continue;
        }
        await mergeMetric({ tx, deviceId: row.deviceId, bucketStart, metric, value });
        aggregatedRows += 1;
      }
    }
    const batchIds = rows.map((r) => r.id);
    const del = await tx.reading.deleteMany({
      where: { id: { in: batchIds } },
    });
    return { aggregatedRows, deletedRows: del.count };
  });
};

/**
 * Merge a single sample into the running aggregate for a
 * `(deviceId, bucketStart, metric)` triple. Reads the prior row
 * (if any), computes Welford-style running mean/min/max/sampleCount,
 * and upserts. Extracted from `processBatch` to keep the per-row
 * loop readable and the cyclomatic complexity of both functions
 * under the lint ceiling.
 *
 * `value` is assumed to be a finite number — the caller
 * (`processBatch`) validates before invoking.
 */
/**
 * Aggregate key triple + the new sample value. Bundled into a
 * single object so `mergeMetric` stays under the `max-params: 3`
 * lint ceiling (5 args would otherwise fire).
 */
interface MergeMetricInput {
  readonly tx: CronRepository;
  readonly deviceId: string | null;
  readonly bucketStart: Date;
  readonly metric: ReadingAggregateMetric;
  readonly value: number;
}

const mergeMetric = async (input: MergeMetricInput): Promise<void> => {
  const { tx, deviceId, bucketStart, metric, value } = input;
  // Read prior aggregate. A prior row may exist if an earlier
  // tick already processed a row into the same bucket — the
  // merge keeps the running statistics correct.
  const prior = await tx.readingAggregate.findUnique({
    where: {
      deviceId_bucketStart_metric: { deviceId, bucketStart, metric },
    },
  });

  const { mean: newMean, min: newMin, max: newMax, count: newCount } = mergeStats(prior, value);

  await tx.readingAggregate.upsert({
    where: {
      deviceId_bucketStart_metric: { deviceId, bucketStart, metric },
    },
    create: {
      deviceId,
      bucketStart,
      metric,
      mean: newMean,
      min: newMin,
      max: newMax,
      sampleCount: newCount,
    },
    update: {
      mean: newMean,
      min: newMin,
      max: newMax,
      sampleCount: newCount,
    },
  });
};

/**
 * Pure arithmetic for merging one new sample into a prior
 * aggregate (or no prior). Extracted so `mergeMetric` stays
 * under the `complexity: 10` lint ceiling. The Welford-style
 * running mean is `newMean = (priorMean * priorCount + value)
 * / newCount` which collapses to `value` when `priorCount ===
 * 0` (no prior row) — the single-sample case.
 */
/* eslint-disable complexity -- 8 distinct arithmetic paths (priorCount==0 branch + 2 ternaries + 4 ??-fallbacks); readability over extraction */
const mergeStats = (
  prior: {
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    readonly sampleCount: number;
  } | null,
  value: number,
): {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly count: number;
} => {
  const newCount = (prior?.sampleCount ?? 0) + 1;
  const newMean = ((prior?.mean ?? 0) * (prior?.sampleCount ?? 0) + value) / newCount;
  const priorMin = prior?.min ?? value;
  const priorMax = prior?.max ?? value;
  return {
    mean: newMean,
    min: value < priorMin ? value : priorMin,
    max: value > priorMax ? value : priorMax,
    count: newCount,
  };
};

/**
 * Run one tick of the hourly retention cron. Returns the
 * `CronTickResult` envelope the wiring layer maps to an
 * `audit.emit` call.
 *
 * Steps:
 *   1. `pg_try_advisory_lock(lockKey)` — skip-on-contention
 *      (`status: "skipped"`, `reason: "lock_held"`).
 *   2. Per-batch loop:
 *      - `reading.findMany({ ts: { lt: cutoff }, take: batchSize, orderBy: [{ts: "asc"}] })`
 *      - For each row + metric, `readingAggregate.upsert` on
 *        `@@unique([deviceId, bucketStart, metric])` with
 *        `floorToFiveMinutes(row.ts)` as the bucket key.
 *      - After all rows in the batch processed,
 *        `reading.deleteMany({ id: { in: batchIds } })`.
 *      - Loop until a batch returns zero rows.
 *   3. Write `CronRun` row with cumulative `aggregatedRows` /
 *      `deletedRows` counts + `status: "success" | "failure"` +
 *      `finishedAt: now`.
 *   4. `pg_advisory_unlock(lockKey)` (in `finally` so it fires
 *      even on mid-batch failure).
 */
export const runningCronTick = async (input: RunningCronTickInput): Promise<CronTickResult> => {
  const { prisma, cutoff, lockKey, batchSize } = input;
  const client = prisma as PrismaClientForLocks;
  const repo = resolveCronRepository(prisma);

  // Defensive runtime guards. The schema-level validator lives at
  // `RetentionConfigSchema` in `@surakkha/shared/retention`; this
  // guards the direct-call surface (unit tests, future
  // contributors who skip the schema) against pathological
  // `batchSize` values that would otherwise spin the batch loop
  // indefinitely.
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new TypeError(
      `runningCronTick: batchSize must be a finite positive integer, got ${batchSize}`,
    );
  }

  // Step 1 — try the advisory lock. Wrap the acquire in its own
  // Step 1 — try the advisory lock. Extracted to `acquireLockOrSkip`
  // so the lock-handling branch is symmetric with the
  // `releaseAdvisoryLock` branch in the `finally` below.
  const acquired = await acquireLockOrSkip(client, lockKey);
  if (!acquired) {
    return { status: "skipped", reason: "lock_held" };
  }

  const startedAt = new Date();
  let aggregatedRows = 0;
  let deletedRows = 0;

  try {
    // Step 2 — batch loop (extracted to keep `runningCronTick`'s
    // cyclomatic complexity under the lint ceiling).
    ({ aggregatedRows, deletedRows } = await runBatchLoop({ repo, cutoff, batchSize, startedAt }));

    // Step 3 — write the success row.
    await repo.cronRun.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        status: "success",
        aggregatedRows,
        deletedRows,
        errorMessage: null,
      },
    });

    return { status: "success", aggregatedRows, deletedRows };
  } finally {
    // Step 4 — release the advisory lock in `finally` so it fires
    // even on mid-batch failure (the failure-branch `cronRun.create`
    // throws AFTER this finally resolves, so the lock is released
    // before the wiring layer's catch sees the error).
    try {
      await releaseAdvisoryLock(client, lockKey);
    } catch {
      // `pg_advisory_unlock` may return `false` if the lock was
      // already released (e.g. by session disconnect). The
      // documentation explicitly says this is non-error; swallow
      // the throw and continue. The runner's caller (wiring
      // layer) does not need the unlock outcome.
    }
  }
};

/**
 * Acquire the Postgres advisory lock. Symmetric with
 * `releaseAdvisoryLock` so the lock-handling branches live in
 * two small helpers rather than inlining a try/catch in the
 * runner. Throws if the acquire itself throws (network drop,
 * permission denied) so the wiring layer can write a `CronRun`
 * failure row + emit the failure audit.
 */
const acquireLockOrSkip = (client: PrismaClientForLocks, lockKey: bigint): Promise<boolean> =>
  tryAdvisoryLock(client, lockKey);

/**
 * Inputs to `runBatchLoop`. Bundled into a single object so the
 * function stays under the `max-params: 3` lint ceiling (4 args
 * would otherwise fire).
 */
interface RunBatchLoopInput {
  readonly repo: CronRepository;
  readonly cutoff: Date;
  readonly batchSize: number;
  readonly startedAt: Date;
}

/**
 * Per-batch loop. Reads up to `batchSize` raw rows per
 * `processBatch` call, terminates when the batch is empty OR
 * when `MAX_BATCHES_PER_TICK` iterations have run (the ceiling
 * defends against a misconfigured `batchSize` that would
 * otherwise produce an unbounded `while (true)` loop). A
 * mid-batch throw writes a `CronRun` failure row with the
 * cumulative counts so far, then re-throws so the wiring layer
 * can map to `audit.emit({ outcome: "failure" })`.
 */
const runBatchLoop = async (
  input: RunBatchLoopInput,
): Promise<{ aggregatedRows: number; deletedRows: number }> => {
  const { repo, cutoff, batchSize, startedAt } = input;
  let aggregatedRows = 0;
  let deletedRows = 0;
  let batchCount = 0;
  while (batchCount < MAX_BATCHES_PER_TICK) {
    batchCount += 1;
    let batchResult: { readonly aggregatedRows: number; readonly deletedRows: number };
    try {
      batchResult = await processBatch(repo, cutoff, batchSize);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await repo.cronRun.create({
        data: {
          startedAt,
          finishedAt: new Date(),
          status: "failure",
          aggregatedRows,
          deletedRows,
          errorMessage: message,
        },
      });
      throw err;
    }
    if (batchResult.aggregatedRows === 0 && batchResult.deletedRows === 0) {
      break;
    }
    aggregatedRows += batchResult.aggregatedRows;
    deletedRows += batchResult.deletedRows;
  }
  return { aggregatedRows, deletedRows };
};
