-- Story 2.2 — initial schema with Reading + Device placeholders.
--
-- Forward-only migration. New entities land in their own stories.

-- F-P9: pgcrypto provides `gen_random_uuid()` on PostgreSQL <13.
-- PG 13+ has it built-in (`pg_catalog`), so this is idempotent.
-- Required by the `Reading.id DEFAULT gen_random_uuid()` below.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "deviceId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "seq" INTEGER NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id"),

    -- F-P8: enforce "device_id authority" at the DB layer. A reading
    -- with a bogus deviceId is rejected with a FK violation, which the
    -- api's `stepPersist` catch block translates into a
    -- `persist_failed` envelope + disconnect. ON DELETE CASCADE keeps
    -- a removed Device from leaving orphan Reading rows behind.
    CONSTRAINT "Reading_deviceId_fkey"
        FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Reading_deviceId_ts_idx" ON "Reading"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "Reading_deviceId_seq_idx" ON "Reading"("deviceId", "seq");