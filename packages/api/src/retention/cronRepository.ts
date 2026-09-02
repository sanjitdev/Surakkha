/**
 * `cronRepository.ts` — narrow Prisma slice for the retention
 * cron. Interface-driven so the runner's test rig can stub the
 * data layer without spinning up Prisma. The `$transaction`
 * wrapper exposes `tx` shaped as `CronRepository` so the same
 * calls work inside the callback without re-binding.
 */
import type { ReadingAggregateMetric } from "@surakkha/shared/reading-aggregate";
import type { TelemetryMetrics } from "@surakkha/shared/telemetry";

/** Row shape read from the raw `Reading` table, with `metrics` narrowed to the wire contract. */
export interface CronReadingRow {
  readonly id: string;
  readonly deviceId: string;
  readonly ts: Date;
  readonly metrics: TelemetryMetrics;
}

/** Row shape written to the `CronRun` table. Matches Prisma's `CronRun` model. */
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
 * Narrow slice of `@prisma/client` consumed by the retention cron.
 * Methods not exposed here are intentionally out of scope.
 */
export interface CronRepository {
  readonly cronRun: {
    /** Write one `CronRun` row (running → success/failure). */
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
    /** Read the prior aggregate row for a `(deviceId, bucketStart, metric)` triple, or `null`. */
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
    /** Upsert against `@@unique([deviceId, bucketStart, metric])`. The `update` clause only writes aggregate statistics. */
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
    /** Read one batch of raw `Reading` rows whose `ts < until`, ordered by `(ts ASC)`. */
    findMany(args: {
      readonly where: {
        readonly ts: { readonly lt: Date };
      };
      readonly orderBy: ReadonlyArray<{ readonly ts: "asc" }>;
      readonly take: number;
    }): Promise<readonly CronReadingRow[]>;
    /** Hard-delete raw `Reading` rows by primary key. Invoked after the upsert commits. */
    deleteMany(args: {
      readonly where: { readonly id: { readonly in: readonly string[] } };
    }): Promise<{ readonly count: number }>;
  };
  /** `$transaction` wrapper. The `tx` inside the callback is shaped as `CronRepository`. */
  $transaction<T>(cb: (tx: CronRepository) => Promise<T>): Promise<T>;
}

/**
 * Adapter that narrows the real `@prisma/client` to the
 * `CronRepository` slice. The `as any` cast is contained here
 * so future Prisma type drifts do not ripple into the runner.
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
