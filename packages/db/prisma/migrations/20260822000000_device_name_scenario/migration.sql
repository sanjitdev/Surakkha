-- Story 2.5 — Device name + scenario columns.
--
-- Adds two nullable columns to the `Device` table so the api can
-- serve the `/admin/simulator/devices` listing without re-reading
-- the simulator's local `devices.json`. Nullable to keep the
-- forward migration safe for any rows that already exist from the
-- Story 2.2 placeholder. A separate seed step (prisma/seed.ts) back-
-- fills the six default devices with their canonical names + scenarios.

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "name" TEXT;
ALTER TABLE "Device" ADD COLUMN "scenario" TEXT;
