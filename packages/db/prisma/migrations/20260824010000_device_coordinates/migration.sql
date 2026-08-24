-- Story 2.7 — Device lat / lng columns.
--
-- Adds two nullable numeric columns so the dashboard's map view can
-- place markers at the seeded coordinates without re-reading the
-- simulator's `devices.json`. Nullable to keep the forward migration
-- safe for any rows that predate Story 2.7.
--
-- The six default devices are NOT back-filled by this migration —
-- the separate `pnpm --filter @surakkha/db seed` step (which reads
-- `packages/simulator/src/devices.json`) populates `lat` and `lng`
-- for the canonical six. Running `prisma migrate deploy` without the
-- seed leaves `lat` / `lng` NULL until the seed runs.

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN "lng" DOUBLE PRECISION;