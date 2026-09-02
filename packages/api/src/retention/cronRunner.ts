/**
 * `cronRunner.ts` — sweep orchestrator.
 *
 * Pure function `runningCronTick({ prisma, cutoff, lockKey,
 * batchSize })` running one tick of the hourly retention cron:
 * try-advisory-lock (skip on contention) → per-batch loop in
 * `$transaction` (upsert + deleteMany) → release lock →
 * write `CronRun` row → return `CronTickResult`. The runner
 * stays IO-portable: the wiring layer owns the audit emit.
 *
 * `pg_try_advisory_lock` is the non-blocking variant so a 10k-row
 * tick does not queue sibling ticks behind it.
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

/** Inputs to `runningCronTick`. `intervalMs` is the wiring layer's concern. */
export interface RunningCronTickInput {
  readonly prisma: unknown;
  readonly cutoff: Date;
  readonly lockKey: bigint;
  readonly batchSize: number;
}

/** Bridge from raw wire keys (long names) to aggregate column keys (short names). Battery/signal absent — raw wire does not carry them today. */
const RAW_TO_AGGREGATE: ReadonlyMap<ReadingAggregateMetric, string> = new Map([
  ["tds", "tds_ppm"],
  ["turbidity", "turbidity_ntu"],
  ["ph", "ph"],
  ["temperature", "temp_c"],
]);

/** Stable iteration order for the per-row loop. Must mirror the keys-of `RAW_TO_AGGREGATE` set. */
const ALL_METRICS: readonly ReadingAggregateMetric[] = ["tds", "turbidity", "ph", "temperature"];

/** Hard cap on batches per tick. Defends against a misconfigured `batchSize` producing an unbounded loop. */
const MAX_BATCHES_PER_TICK = 1_000;

/** Minimal Prisma-client surface for the `$queryRaw` lock acquire/release path. */
interface PrismaClientForLocks {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** `pg_try_advisory_lock` returns `true` if acquired, `false` if another process holds it. */
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
 * One batch: read up to `batchSize` raw rows whose `ts <
 * cutoff`, upsert per `(deviceId, bucketStart, metric)` triple,
 * then delete the source rows — all inside one `$transaction`
 * callback. The upsert is merge-additive so re-processing the
 * same bucket across ticks does not corrupt prior aggregates.
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
      // Skip rows with invalid `ts`; `floorToFiveMinutes(new Date(NaN))` would throw and crash the batch.
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
 * `(deviceId, bucketStart, metric)` triple — read prior, compute
 * running mean/min/max/sampleCount, then upsert. `value` is
 * assumed finite; the caller validates before invoking.
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
  // A prior row may exist if an earlier tick processed a row into the same bucket.
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

/** Pure arithmetic for merging one new sample into a prior aggregate (or no prior). */
/* eslint-disable complexity -- readability over extraction */
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
 * `audit.emit` call. The advisory lock is acquired first (skip
 * on contention), then a per-batch loop reads + upserts +
 * deletes inside `$transaction`, then a `CronRun` row is
 * written. The lock is released in `finally` so it fires on
 * mid-batch failure too.
 */
export const runningCronTick = async (input: RunningCronTickInput): Promise<CronTickResult> => {
  const { prisma, cutoff, lockKey, batchSize } = input;
  const client = prisma as PrismaClientForLocks;
  const repo = resolveCronRepository(prisma);

  // Guard the direct-call surface (unit tests bypass the shared schema) against pathological batchSize.
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new TypeError(
      `runningCronTick: batchSize must be a finite positive integer, got ${batchSize}`,
    );
  }

  const acquired = await acquireLockOrSkip(client, lockKey);
  if (!acquired) {
    return { status: "skipped", reason: "lock_held" };
  }

  const startedAt = new Date();

  try {
    const { aggregatedRows, deletedRows } = await runBatchLoop({
      repo,
      cutoff,
      batchSize,
      startedAt,
    });

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
    // Release in `finally` so it fires on mid-batch failure too.
    try {
      await releaseAdvisoryLock(client, lockKey);
    } catch {
      // `pg_advisory_unlock` returns `false` if the lock was already released (session disconnect) — non-error, swallow.
    }
  }
};

/** Acquire the advisory lock. Throws on acquire-level failure (network, permission) so the wiring layer maps it to an audit failure. */
const acquireLockOrSkip = (client: PrismaClientForLocks, lockKey: bigint): Promise<boolean> =>
  tryAdvisoryLock(client, lockKey);

/** Inputs to `runBatchLoop`. Bundled to satisfy the `max-params` lint ceiling. */
interface RunBatchLoopInput {
  readonly repo: CronRepository;
  readonly cutoff: Date;
  readonly batchSize: number;
  readonly startedAt: Date;
}

/**
 * Per-batch loop. Terminates when a batch is empty or the
 * `MAX_BATCHES_PER_TICK` ceiling is reached. A mid-batch throw
 * writes a `CronRun` failure row with cumulative counts, then
 * re-throws so the wiring layer emits the failure audit.
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
