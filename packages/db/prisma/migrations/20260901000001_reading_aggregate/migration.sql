-- Story 5.4 — `ReadingAggregate` table.
--
-- Durable half of the retention story. Raw `Reading` rows accumulate
-- forever; after 30 days they are never read by any surface (the
-- operator page only renders the last 24h, the CSV export caps at
-- 30 days). They are wasted disk + index bloat on a per-device index
-- that grows monotonically. This table holds 5-minute
-- mean/min/max/sample_count buckets, one row per `(deviceId,
-- bucketStart, metric)`. Story 5.5's hourly retention cron is the
-- write target (via `upsert` on the compound unique key for
-- idempotent overlap-safe retries); this story ships the column
-- shape only.
--
-- Column-by-column (mirrors the Prisma `ReadingAggregate` model at
-- `packages/db/prisma/schema.prisma`):
--   - `id` (TEXT, UUIDv4 PK — server-generated).
--   - `deviceId` (TEXT, FK → Device.id, ON DELETE SET NULL).
--      A deleted Device must NOT cascade-delete historical
--      aggregates (regulators may still want them); the FK row
--      goes null and the aggregate stays.
--   - `bucketStart` (TIMESTAMP(3), NOT NULL) — the floor of the
--      source `Reading.ts` to the nearest 5 minutes, computed by
--      the 5.5 cron (NOT by 5.4 — 5.4 ships the column shape only).
--   - `metric` (TEXT, NOT NULL) — the closed enum
--      `{"tds","turbidity","ph","temperature","battery","signal"}`
--      lives at the Zod layer
--      `packages/shared/src/reading-aggregate.ts`; storing as TEXT
--      avoids a Prisma enum migration every time a metric is added,
--      same precedent as `AuditLog.resource`.
--   - `mean` (DOUBLE PRECISION, NOT NULL).
--   - `min` (DOUBLE PRECISION, NOT NULL).
--   - `max` (DOUBLE PRECISION, NOT NULL).
--   - `sampleCount` (INTEGER, NOT NULL).
--
-- Indexes:
--   - `ReadingAggregate_deviceId_bucketStart_metric_key` (UNIQUE) —
--      the compound upsert key for Story 5.5's cron (`ON CONFLICT
--      (...) DO UPDATE` for idempotent overlap-safe retries); the
--      constraint is the load-bearing invariant.
--   - `ReadingAggregate_deviceId_bucketStart_idx` — the (future)
--      range-scan read pattern (admin / chart query).

-- CreateTable — ReadingAggregate
CREATE TABLE "ReadingAggregate" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL,

    CONSTRAINT "ReadingAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — compound unique key (the 5.5 upsert target).
-- Hand-edited to add NULLS NOT DISTINCT (Story 5.4 review pass):
-- Postgres treats NULLs as distinct in UNIQUE indexes by default,
-- so two `(bucketStart, metric)` rows with `deviceId IS NULL` would
-- not collide, permitting orphan-duplicate buckets once any Device
-- is deleted — breaking the 5.5 cron's idempotent
-- `ON CONFLICT (...) DO UPDATE` invariant. Prisma's `@@unique` does
-- not natively emit the NULLS NOT DISTINCT clause; this is the
-- canonical Postgres 15+ syntax.
CREATE UNIQUE INDEX "ReadingAggregate_deviceId_bucketStart_metric_key"
    ON "ReadingAggregate"("deviceId", "bucketStart", "metric") NULLS NOT DISTINCT;

-- CreateIndex — future range-scan read pattern
CREATE INDEX "ReadingAggregate_deviceId_bucketStart_idx"
    ON "ReadingAggregate"("deviceId", "bucketStart");

-- AddForeignKey — ReadingAggregate.deviceId → Device.id SET NULL
-- A removed Device MUST NOT wipe historical aggregates
-- (regulator-facing retention requirement); the FK row goes null
-- and the aggregate stays.
ALTER TABLE "ReadingAggregate" ADD CONSTRAINT "ReadingAggregate_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
