/**
 * Retention-cron wire types (Story 5.5).
 *
 * Sibling module — keeps `reading-aggregate.ts` (durable-half surface)
 * and `audit.ts` (audit-log surface) free of cron-specific contracts.
 * The Prisma layer keeps `status` as a free `String` column so adding
 * a new status does not force a Prisma migration.
 */
import { z } from "zod";

/** Closed enumeration of `CronRun.status` values. Kept separate
 *  from the Prisma `String` column so the wire surface has a closed
 *  shape while the DB stays write-flexible. */
export const CronRunStatusSchema = z.enum(["running", "success", "failure"]);
export type CronRunStatus = z.infer<typeof CronRunStatusSchema>;

/** Result envelope returned by `runningCronTick`. Two shapes:
 *  - On lock-acquired: the `{ status, aggregatedRows, deletedRows }`
 *    success arm. `aggregatedRows` is the cumulative count of
 *    upserts across all batches (zero for an empty tick);
 *    `deletedRows` is the cumulative count of raw `Reading` rows
 *    removed after the upserts committed.
 *  - On lock-held (a sibling process holds the advisory lock):
 *    the `{ status: "skipped", reason: "lock_held" }` short-circuit.
 *    No `CronRun` row is written; no `audit.emit` fires. */
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
 */
export const RetentionConfigSchema = z.object({
  retentionWindowDays: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  intervalMs: z.number().int().positive(),
  lockKey: z.bigint(),
});
export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;
