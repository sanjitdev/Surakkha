-- Story 5.5 — `CronRun` table + `Reading.ts` index.
--
-- The hourly retention cron persists one row per tick so an
-- operator can audit the writer independently of the audit trail
-- (the `cron_run_completed` audit row covers the operator-facing
-- view; this table is the engine-side record). A new `@@index`
-- on `Reading.ts` is also added so the cron's `WHERE ts < cutoff`
-- range scan is index-served instead of seq-scanning the table.
--
-- Column-by-column (mirrors the Prisma `CronRun` model at
-- `packages/db/prisma/schema.prisma`):
--   - `id` (TEXT, UUIDv4 PK — server-generated).
--   - `startedAt` (TIMESTAMP(3), NOT NULL) — tick wall-clock
--      start.
--   - `finishedAt` (TIMESTAMP(3), nullable) — tick wall-clock end
--      (NULL while `running`).
--   - `status` (TEXT, NOT NULL) — closed enum
--      `{"running","success","failure"}` lives at the Zod layer
--      `packages/shared/src/retention.ts`; storing as TEXT avoids
--      a Prisma enum migration every time a status is added, same
--      precedent as `AuditLog.outcome`.
--   - `aggregatedRows` (INTEGER, NOT NULL) — number of upserts
--      performed across all batches in the tick.
--   - `deletedRows` (INTEGER, NOT NULL) — number of raw `Reading`
--      rows the tick removed after the upserts committed.
--   - `errorMessage` (TEXT, nullable) — populated when `status =
--      "failure"`; NULL on `success` / `running`.
--
-- Index:
--   - `CronRun_startedAt_idx` — the "last run" / "recent ticks"
--     lookup the operator surface (deferred) consumes.

-- CreateTable — CronRun
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "aggregatedRows" INTEGER NOT NULL,
    "deletedRows" INTEGER NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — last-run / recent-ticks lookup
CREATE INDEX "CronRun_startedAt_idx" ON "CronRun"("startedAt");

-- CreateIndex — Reading.ts range-scan for the cron's
-- `WHERE ts < cutoff` predicate. The existing
-- `(deviceId, ts)` + `(deviceId, seq)` indexes cannot serve a
-- device-agnostic range scan; without this index the hourly cron
-- would seq-scan the raw `Reading` table.
CREATE INDEX "Reading_ts_idx" ON "Reading"("ts");