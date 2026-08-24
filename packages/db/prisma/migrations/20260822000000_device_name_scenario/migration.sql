-- Story 2.5 — Device name + scenario columns.
--
-- Adds two nullable columns to the `Device` table so the api can
-- serve the `/admin/simulator/devices` listing without re-reading
-- the simulator's local `devices.json`. Nullable to keep the
-- forward migration safe for any rows that already exist from the
-- Story 2.2 placeholder.
--
-- The six default devices are NOT back-filled by this migration —
-- the separate `pnpm --filter @surakkha/db seed` step (which reads
-- `packages/simulator/src/devices.json`) populates `name` and
-- `scenario` for the canonical six. Running `prisma migrate deploy`
-- without the seed leaves `name` and `scenario` NULL until the
-- seed runs. See Story 6.1 for the docker-compose init container
-- that orchestrates the two-step boot.

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "name" TEXT;
ALTER TABLE "Device" ADD COLUMN "scenario" TEXT;
