/**
 * `cronRepository.ts` — Story 5.5.
 *
 * Narrow Prisma slice for the retention cron's read/write
 * surface. Mirrors the pattern from
 * `auditLogRepository.ts:81-127`: interface-driven + adapter that
 * narrows the real `@prisma/client` via a structural cast. The
 * repository is the SEAM between the cron runner and the data
 * layer so the runner's test rig can stub the data layer
 * without spinning up Prisma.
 *
 * Why a narrow slice:
 *
 *   - Test injection is trivial — the test rig hands a stub that
 *     exposes only the methods this module calls.
 *   - Live tests (Prisma) use the production adapter; unit tests
 *     use a hand-rolled stub matching the same shape.
 *   - The `$transaction` wrapper lets the runner collapse
 *     (upsert + deleteMany) per batch atomically. The
 *     transaction's `tx` object is itself shaped as
 *     `CronRepository` so the same calls
 *     (`tx.readingAggregate.upsert`, `tx.reading.deleteMany`,
 *     `tx.cronRun.create`) work inside the callback without
 *     re-binding.
 *
 * Atomicity: any throw inside the `$transaction` callback rolls
 * back the entire transaction. No orphan `ReadingAggregate`
 * rows on `Reading.deleteMany` failure; no orphan raw rows on
 * `readingAggregate.upsert` failure.
 */
import type { ReadingAggregateMetric } from "@surakkha/shared/reading-aggregate";
import type { TelemetryMetrics } from "@surakkha/shared/telemetry";

/**
 * The narrow row shape the cron reads from the raw `Reading`
 * table. Matches Prisma's `Reading` model with `metrics` narrowed
 * to the wire-contract `TelemetryMetrics` shape (the cron
 * iterates per-metric to upsert the per-bucket aggregate row).
 */
export interface CronReadingRow {
  readonly id: string;
  readonly deviceId: string;
  readonly ts: Date;
  readonly metrics: TelemetryMetrics;
}

/**
 * The narrow row shape the cron writes to the `CronRun` table.
 * Matches Prisma's `CronRun` model.
 */
export interface CronRunRow {
  readonly id: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly status: string;
  readonly aggregatedRows: number;
  readonly deletedRows: number;
  readonly errorMessage: string | null;
}

/**
 * Narrow slice of `@prisma/client` that the retention cron needs.
 *
 * Methods NOT exposed here (intentionally) are out of scope for
 * the cron: the future admin read surface can use its own slice.
 */
export interface CronRepository {
  readonly cronRun: {
    /**
     * Write one CronRun row at tick start (`status: "running"`)
     * and a final row at tick end (`status: "success" | "failure"`).
     * `create` is the only path the runner uses — the future admin
     * read surface (deferred) can add a separate narrow-typed
     * `findMany` rather than widen this method.
     */
    create(args: {
      readonly data: {
        readonly startedAt: Date;
        readonly finishedAt?: Date | null;
        readonly status: string;
        readonly aggregatedRows: number;
        readonly deletedRows: number;
        readonly errorMessage?: string | null;
      };
    }): Promise<CronRunRow>;
  };
  readonly readingAggregate: {
    /**
     * Read the prior aggregate row for a `(deviceId, bucketStart,
     * metric)` triple. Used by the merge-additive upsert path
     * (the cron's per-batch loop computes running mean/min/max/
     * sampleCount from the prior row + the new sample). Returns
     * `null` if no prior row exists (the first sample for a new
     * bucket).
     */
    findUnique(args: {
      readonly where: {
        readonly deviceId_bucketStart_metric: {
          readonly deviceId: string | null;
          readonly bucketStart: Date;
          readonly metric: ReadingAggregateMetric;
        };
      };
    }): Promise<{
      readonly deviceId: string | null;
      readonly bucketStart: Date;
      readonly metric: ReadingAggregateMetric;
      readonly mean: number;
      readonly min: number;
      readonly max: number;
      readonly sampleCount: number;
    } | null>;
    /**
     * The 5.5 upsert: `ON CONFLICT` against the compound unique
     * `@@unique([deviceId, bucketStart, metric])`. The `update`
     * clause only writes `mean`, `min`, `max`, `sampleCount` —
     * never `bucketStart` or `metric` or `deviceId` (those are
     * key columns, not aggregate statistics).
     */
    upsert(args: {
      readonly where: {
        readonly deviceId_bucketStart_metric: {
          readonly deviceId: string | null;
          readonly bucketStart: Date;
          readonly metric: ReadingAggregateMetric;
        };
      };
      readonly create: {
        readonly deviceId: string | null;
        readonly bucketStart: Date;
        readonly metric: ReadingAggregateMetric;
        readonly mean: number;
        readonly min: number;
        readonly max: number;
        readonly sampleCount: number;
      };
      readonly update: {
        readonly mean: number;
        readonly min: number;
        readonly max: number;
        readonly sampleCount: number;
      };
    }): Promise<unknown>;
  };
  readonly reading: {
    /**
     * Read one batch of raw `Reading` rows whose `ts` is in
     * `[since, until)` (inclusive lower, exclusive upper) ordered
     * by `(ts ASC, id ASC)` so the keyset paging seam stays
     * stable across the per-batch loop.
     */
    findMany(args: {
      readonly where: {
        readonly ts: { readonly lt: Date };
      };
      readonly orderBy: ReadonlyArray<{ readonly ts: "asc" }>;
      readonly take: number;
    }): Promise<readonly CronReadingRow[]>;
    /**
     * Hard-delete the raw `Reading` rows whose primary keys are
     * in the batch's id list. Invoked AFTER the upsert commits so
     * the raw rows are reachable for retry on transient failure.
     */
    deleteMany(args: {
      readonly where: { readonly id: { readonly in: readonly string[] } };
    }): Promise<{ readonly count: number }>;
  };
  /**
   * `$transaction` wrapper. The callback runs the (upsert +
   * deleteMany) per batch atomically. Production forwards to
   * `prisma.$transaction(cb)`. The `tx` object inside the callback
   * is shaped as `CronRepository` so the same calls work without
   * re-binding.
   */
  $transaction<T>(cb: (tx: CronRepository) => Promise<T>): Promise<T>;
}

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `CronRepository` slice. Mirrors `resolveIncidentStateRepository`
 * (`incidentStateRepository.ts:202-221`). The `as any` cast is
 * contained to this file so future Prisma type drifts do not
 * ripple into the runner.
 *
 * Production narrows via this adapter; the test rig provides a
 * hand-rolled stub matching the same shape (see
 * `cronRunner.spec.ts`).
 */
export const resolveCronRepository = (prisma: unknown): CronRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    cronRun: {
      create: (args) => client.cronRun.create(args) as Promise<CronRunRow>,
    },
    readingAggregate: {
      findUnique: (args) => client.readingAggregate.findUnique(args),
      upsert: (args) => client.readingAggregate.upsert(args) as Promise<unknown>,
    },
    reading: {
      findMany: (args) => client.reading.findMany(args) as Promise<readonly CronReadingRow[]>,
      deleteMany: (args) => client.reading.deleteMany(args) as Promise<{ readonly count: number }>,
    },
    $transaction: <T>(cb: (tx: CronRepository) => Promise<T>): Promise<T> =>
      client.$transaction(cb) as Promise<T>,
  };
};
