-- Story 2.2 — initial schema with Reading + Device placeholders.
--
-- Forward-only migration. New entities land in their own stories.

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

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reading_deviceId_ts_idx" ON "Reading"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "Reading_deviceId_seq_idx" ON "Reading"("deviceId", "seq");