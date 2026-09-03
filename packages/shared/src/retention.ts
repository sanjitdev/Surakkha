/**
 * Retention-cron wire types.
 * Closed `status` enum on the wire; the Prisma column is a free
 * `String` so adding a new status does not force a Prisma migration.
 */
import { z } from "zod";

export const CronRunStatusSchema = z.enum(["running", "success", "failure"]);
export type CronRunStatus = z.infer<typeof CronRunStatusSchema>;

/** Result envelope returned by `runningCronTick`.
 *  - On lock-acquired: `{ status: "success", aggregatedRows, deletedRows }`.
 *  - On lock-held: `{ status: "skipped", reason: "lock_held" }` — no
 *    `CronRun` row written, no audit emit. */
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

/** Retention-cron runtime configuration. Defaults live at the wiring
 *  call site (not here) so interval / batch size / window days can
 *  be overridden by tests and future operator env-vars. */
export const RetentionConfigSchema = z.object({
  retentionWindowDays: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  intervalMs: z.number().int().positive(),
  lockKey: z.bigint(),
});
export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;
