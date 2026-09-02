/**
 * `retention.ts` — Story 5.5.
 *
 * Wire types + closed enums for the hourly retention cron. Mirrors
 * the `reading-aggregate.ts:1-33` preamble pattern: a dedicated
 * sibling per read/write surface so cross-cutting imports don't
 * couple the Audit / Reading / Retention modules' wire contracts.
 *
 * Why a dedicated module (vs adding to `reading-aggregate.ts` or
 * `audit.ts`):
 *
 *   - `reading-aggregate.ts` is the durable-half surface
 *     (`ReadingAggregate` row shape + the metric enum). The cron
 *     carries different state (`CronRun.status`, the tick result
 *     envelope, the retention config) and would muddle the
 *     aggregate wire envelope.
 *
 *   - `audit.ts` is the audit-log surface (resource enum, list
 *     envelope). The retention module is the cron-emit surface;
 *     it imports `AuditAction` FROM `audit.ts` for the audit
 *     payload, but does NOT export any audit surface itself.
 *
 *   - The Prisma layer keeps `status` as a free `String` column
 *     (no Prisma enum) so adding a new status does NOT force a
 *     Prisma migration. The Zod enum below is the closed wire
 *     contract for any reader/writer — the same precedent as
 *     `AuditLogResourceSchema` (`audit.ts:53-67`) and
 *     `ReadingAggregateMetricSchema`
 *     (`reading-aggregate.ts:54-62`).
 */
import { z } from "zod";

/**
 * Closed enumeration of `CronRun.status` values. Three members:
 *
 *   - `"running"` — the tick is in flight. The runner writes the
 *     `CronRun` row with this status at start, then updates it to
 *     `"success"` or `"failure"` when the tick finishes.
 *   - `"success"` — the tick finished cleanly (zero or more
 *     batches upserted + deleted).
 *   - `"failure"` — the tick threw mid-batch; the runner writes
 *     the row with `errorMessage` populated.
 *
 * Kept separate from the Prisma `String` column (which is
 * intentionally NOT a Prisma enum) so the wire surface has a
 * closed shape while the DB stays write-flexible. Mirrors
 * `AuditLogResourceSchema` (`audit.ts:53-67`) and
 * `ReadingAggregateMetricSchema` (`reading-aggregate.ts:54-62`).
 */
export const CronRunStatusSchema = z.enum(["running", "success", "failure"]);
export type CronRunStatus = z.infer<typeof CronRunStatusSchema>;

/**
 * Result envelope returned by `runningCronTick`. Two shapes:
 *
 *   - On lock-acquired: the `{ status, aggregatedRows, deletedRows }`
 *     success arm. `status === "success"` indicates the tick
 *     finished cleanly; `aggregatedRows` is the cumulative count
 *     of upserts across all batches (zero for an empty tick);
 *     `deletedRows` is the cumulative count of raw `Reading` rows
 *     the tick removed after the upserts committed.
 *   - On lock-held (a sibling process holds the advisory lock):
 *     the `{ status: "skipped", reason: "lock_held" }` short-
 *     circuit. No `CronRun` row is written; no `audit.emit`
 *     fires.
 */
export type CronTickResult =
  | {
      readonly status: "success";
      readonly aggregatedRows: number;
      readonly deletedRows: number;
    }
  | {
      readonly status: "skipped";
      readonly reason: "lock_held";
    };

/**
 * Retention-cron configuration. The wiring layer
 * (`scheduleRetentionCron`) accepts these defaults; the actual
 * defaults live in the wiring call site (not in the schema) so
 * the runtime knobs (interval, batch size, window days) can be
 * overridden by tests + future operator env-vars.
 *
 *   - `retentionWindowDays` — only `Reading.ts < now - window`
 *     rows are eligible for the aggregation+delete step.
 *     Spec default: 30 (matches the operator-page 24h + CSV
 *     30d cap).
 *   - `batchSize` — maximum raw `Reading` rows per
 *     `findMany + deleteMany` batch. Spec default: 10_000
 *     (matches the spec's batched-at-10000-rows-per-transaction
 *     contract).
 *   - `intervalMs` — `setInterval` period between ticks. Spec
 *     default: 60 * 60 * 1000 (hourly).
 *   - `lockKey` — the Postgres advisory lock key the tick
 *     attempts to acquire (constant lives in `cronWiring.ts`).
 */
export const RetentionConfigSchema = z.object({
  retentionWindowDays: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  intervalMs: z.number().int().positive(),
  lockKey: z.bigint(),
});
export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;
