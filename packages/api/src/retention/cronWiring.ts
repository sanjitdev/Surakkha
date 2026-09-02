/**
 * `cronWiring.ts` — Story 5.5.
 *
 * Boot-side wiring for the hourly retention cron. Mirrors the
 * lazy-resolver pattern at `admin/thresholdsWiring.ts` +
 * `alerts/wiring.ts`: the wiring function captures Prisma
 * indirectly via the supplied `resolvePrismaClient` so a
 * transient DB outage at boot does NOT crash the api.
 *
 * `scheduleRetentionCron(...)`:
 *   - Resolves Prisma on each `setInterval` tick (so a tick that
 *     runs after a long-deferred Prisma resolution still works).
 *   - On success / failure of a tick, calls
 *     `audit.emit({ auditAction: "cron_run_completed", outcome,
 *     context: { aggregatedRows, deletedRows, durationMs } })`.
 *   - Returns `{ stop }` so the api boot can wire it into the
 *     shutdown hook (the spec is silent on a shutdown hook in
 *     `index.ts` today, but exposing `stop` keeps the contract
 *     symmetric with `setInterval`-returning schedulers).
 *
 * `lockKey` constant lives in this file so the wiring + the
 * runner agree on the value. The constant is
 * `0x5_55_5_55_5n` — Story 5.5's "fingerprint" (the five-fives
 * motif), stable across processes so two ticks in the same
 * Postgres instance collide.
 *
 * Empty-tick behaviour: a tick with zero raw rows older than
 * `cutoff` STILL emits `audit.emit({ outcome: "success", ... })`
 * with `aggregatedRows: 0, deletedRows: 0`. The
 * `TICK_EMPTY` AC requires the audit row be written even on a
 * no-op tick so the operator can confirm the cron is alive.
 */
import { type AuditLogger } from "../audit.js";

import { runningCronTick } from "./cronRunner.js";

/**
 * Postgres advisory lock key for the retention cron's
 * `pg_try_advisory_lock`. Stable across processes so two ticks
 * in the same Postgres instance collide and skip on contention.
 *
 * The `0x5_55_5_55_5n` "fingerprint" is Story 5.5's id — five
 * fives — so the lock key reads meaningfully in pg_locks dumps
 * (a 64-bit fingerprint is unique enough to not collide with
 * other advisory locks the codebase may add in the future).
 */
const RETENTION_LOCK_KEY = 0x5_55_5_55_5n;

/** Time-unit helpers — see `telemetry.ts:15-18` precedent. */
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const HOURS_PER_DAY = 24;

/**
 * Default retention-window length (days). Spec default: 30
 * (matches the operator-page 24h + CSV 30d cap).
 */
const DEFAULT_RETENTION_WINDOW_DAYS = 30;

/**
 * Default batch size for the per-batch read+upsert+delete
 * loop. Spec default: 10_000 (matches the spec's batched-at-
 * 10000-rows-per-transaction contract).
 */
const DEFAULT_BATCH_SIZE = 10_000;

/**
 * Default tick interval (milliseconds). Spec default: hourly.
 */
const DEFAULT_INTERVAL_MS = SECONDS_PER_MINUTE * MS_PER_MINUTE;

/**
 * Minimal logger surface the wiring function uses. Mirrors the
 * shape `createLogger({ name, level })` returns; tests can pass
 * a stub `{ info, warn, error }` (e.g. `pino`-shaped or any
 * silent stub).
 */
export interface RetentionLogger {
  readonly info: (obj: unknown, msg?: string) => void;
  readonly warn: (obj: unknown, msg?: string) => void;
  readonly error: (obj: unknown, msg?: string) => void;
}

/**
 * Inputs to `scheduleRetentionCron`. `intervalMs`,
 * `retentionWindowDays`, and `batchSize` have documented
 * defaults; `lockKey` is the wiring-supplied constant (exported
 * so tests can pass an alternate value if they want to
 * exercise the lock-held path).
 */
export interface ScheduleRetentionCronInput {
  readonly resolvePrismaClient: () => Promise<unknown>;
  readonly audit: AuditLogger;
  /**
   * Postgres advisory-lock key. Defaults to `0x5_55_5_55_5n` if
   * omitted. Tests may override to exercise lock-held branches.
   */
  readonly lockKey?: bigint;
  readonly retentionWindowDays?: number;
  readonly batchSize?: number;
  readonly intervalMs?: number;
  readonly logger: RetentionLogger;
}

/**
 * The handle returned by `scheduleRetentionCron`. Mirrors the
 * `{ stop }` shape of other interval schedulers in the codebase
 * (see `setInterval`-returning helpers in
 * `admin/thresholdsWiring.ts`); the api boot can hold this
 * for a future shutdown hook (the spec is silent on a shutdown
 * hook today; the seam is left exposed).
 */
export interface RetentionCronHandle {
  readonly stop: () => void;
}

/**
 * Schedule the hourly retention cron. Returns `{ stop }` so the
 * caller can cancel the interval.
 *
 * The first tick fires at `t = intervalMs` after `setInterval`
 * registration (NOT immediately — `setInterval` is fire-at-t=N,
 * not fire-at-t=0; a caller wanting "fire on boot" would invoke
 * `tick()` separately before scheduling). Subsequent ticks fire
 * every `intervalMs`. Each tick:
 *   - computes `cutoff = now - retentionWindowDays` (UTC).
 *   - invokes `runningCronTick({ prisma, cutoff, lockKey, batchSize })`.
 *   - on success: `audit.emit({ outcome: "success", context: { aggregatedRows, deletedRows, durationMs } })`.
 *   - on failure: `audit.emit({ outcome: "failure", context: { durationMs, errorMessage } })`.
 *   - on skipped (lock held): no `audit.emit` (per the spec's
 *     "No audit.emit for the `running` state" note — skipped is
 *     also silent).
 */
/**
 * Defensive runtime guards for the direct-call boot path in
 * `index.ts`. The schema-level validator lives at
 * `RetentionConfigSchema` in `@surakkha/shared/retention`; this
 * guards the boot path (which does not parse through the schema)
 * against pathological values that would cause silent runtime
 * bugs:
 *   - `batchSize <= 0` → infinite loop in the runner.
 *   - `intervalMs <= 0` → `setInterval` fires immediately or not
 *     at all.
 *   - `retentionWindowDays < 0` → future-dated window (would
 *     delete nothing then delete-everything).
 * We fail fast at schedule time so the boot path surfaces the
 * misconfiguration instead of running silently.
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
    // Re-entrancy guard: a slow tick should not let two ticks
    // overlap. `setInterval` does NOT debounce — if a tick takes
    // longer than `intervalMs`, two ticks could run concurrently.
    // The flag short-circuits the second tick; the deferred tick
    // then runs on the next interval. The `pg_try_advisory_lock`
    // is the cross-process second line of defence.
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
        // Skip-on-contention is silent (per the spec's "No
        // audit.emit for the running state" note).
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
