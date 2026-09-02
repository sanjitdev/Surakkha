/**
 * `cronWiring.ts` — boot-side wiring for the hourly retention
 * cron. Resolves Prisma lazily per tick via the supplied
 * `resolvePrismaClient` so a transient DB outage at boot does
 * not crash the api. On success / failure of a tick, emits
 * `audit.emit({ auditAction: "cron_run_completed", outcome,
 * ... })`. Skipped ticks (lock held) are silent. Returns
 * `{ stop }` so the boot can wire it into a future shutdown
 * hook.
 */
import { type AuditLogger } from "../audit.js";

import { runningCronTick } from "./cronRunner.js";

/** Postgres advisory lock key for the retention cron. Stable across processes so two ticks collide and skip on contention. */
const RETENTION_LOCK_KEY = 0x5_55_5_55_5n;

/** Time-unit helpers. */
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const HOURS_PER_DAY = 24;

/** Default retention-window length in days. */
const DEFAULT_RETENTION_WINDOW_DAYS = 30;

/** Default batch size for the per-batch read+upsert+delete loop. */
const DEFAULT_BATCH_SIZE = 10_000;

/** Default tick interval in milliseconds (hourly). */
const DEFAULT_INTERVAL_MS = SECONDS_PER_MINUTE * MS_PER_MINUTE;

/** Minimal logger surface the wiring function uses. Tests may pass a stub. */
export interface RetentionLogger {
  readonly info: (obj: unknown, msg?: string) => void;
  readonly warn: (obj: unknown, msg?: string) => void;
  readonly error: (obj: unknown, msg?: string) => void;
}

/** Inputs to `scheduleRetentionCron`. Defaults applied for `lockKey`, `retentionWindowDays`, `batchSize`, `intervalMs`. */
export interface ScheduleRetentionCronInput {
  readonly resolvePrismaClient: () => Promise<unknown>;
  readonly audit: AuditLogger;
  /** Postgres advisory-lock key. Defaults to `0x5_55_5_55_5n` if omitted. Tests may override to exercise lock-held branches. */
  readonly lockKey?: bigint;
  readonly retentionWindowDays?: number;
  readonly batchSize?: number;
  readonly intervalMs?: number;
  readonly logger: RetentionLogger;
}

/** The handle returned by `scheduleRetentionCron`. The api boot can hold this for a future shutdown hook. */
export interface RetentionCronHandle {
  readonly stop: () => void;
}

/**
 * Schedule the hourly retention cron. The first tick fires at
 * `t = intervalMs` after registration (NOT immediately); each
 * tick computes `cutoff = now - retentionWindowDays`, invokes
 * `runningCronTick(...)`, and emits a `cron_run_completed` audit
 * row on success / failure. Skipped ticks (lock held) are silent.
 */
const validateRuntimeConfig = (config: {
  readonly batchSize: number;
  readonly intervalMs: number;
  readonly retentionWindowDays: number;
}): void => {
  if (!Number.isFinite(config.batchSize) || config.batchSize <= 0) {
    throw new TypeError(
      `scheduleRetentionCron: batchSize must be a finite positive integer, got ${config.batchSize}`,
    );
  }
  if (!Number.isFinite(config.intervalMs) || config.intervalMs <= 0) {
    throw new TypeError(
      `scheduleRetentionCron: intervalMs must be a finite positive integer, got ${config.intervalMs}`,
    );
  }
  if (!Number.isFinite(config.retentionWindowDays) || config.retentionWindowDays < 0) {
    throw new TypeError(
      `scheduleRetentionCron: retentionWindowDays must be a finite non-negative integer, got ${config.retentionWindowDays}`,
    );
  }
};

export const scheduleRetentionCron = (input: ScheduleRetentionCronInput): RetentionCronHandle => {
  const {
    resolvePrismaClient,
    lockKey = RETENTION_LOCK_KEY,
    retentionWindowDays = DEFAULT_RETENTION_WINDOW_DAYS,
    batchSize = DEFAULT_BATCH_SIZE,
    intervalMs = DEFAULT_INTERVAL_MS,
    logger,
  } = input;

  validateRuntimeConfig({ batchSize, intervalMs, retentionWindowDays });

  let running = false;

  const tick = async (): Promise<void> => {
    // Re-entrancy guard: `setInterval` does not debounce — if a tick takes longer than `intervalMs`, two ticks could run concurrently. The cross-process lock is the second line of defence.
    if (running) {
      logger.warn(
        { ts: new Date().toISOString() },
        "retention cron: tick already running, skipping",
      );
      return;
    }
    running = true;
    const tickStart = Date.now();
    try {
      const prisma = await resolvePrismaClient();
      const cutoff = new Date(
        Date.now() - retentionWindowDays * HOURS_PER_DAY * SECONDS_PER_MINUTE * MS_PER_MINUTE,
      );
      const result = await runningCronTick({ prisma, cutoff, lockKey, batchSize });
      const durationMs = Date.now() - tickStart;
      if (result.status === "skipped") {
        logger.info({ durationMs, reason: result.reason }, "retention cron: tick skipped");
        return;
      }
      input.audit.emit({
        auditAction: "cron_run_completed",
        outcome: "success",
        context: {
          aggregatedRows: result.aggregatedRows,
          deletedRows: result.deletedRows,
          durationMs,
        },
      });
      logger.info(
        {
          durationMs,
          aggregatedRows: result.aggregatedRows,
          deletedRows: result.deletedRows,
        },
        "retention cron: tick completed",
      );
    } catch (err) {
      const durationMs = Date.now() - tickStart;
      const message = err instanceof Error ? err.message : String(err);
      input.audit.emit({
        auditAction: "cron_run_completed",
        outcome: "failure",
        context: { durationMs, errorMessage: message },
      });
      logger.error({ err, durationMs }, "retention cron: tick failed");
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
  };
};
