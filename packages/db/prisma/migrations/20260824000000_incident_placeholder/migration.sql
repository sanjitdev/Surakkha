-- Story 2.6 — Incident placeholder model.
--
-- The dashboard's Recent Incidents preview needs a queryable Incident
-- table so `GET /api/incidents/recent` can return a real shape once
-- rule-firing lands in Epic 3. Story 4.2 expands this into the full
-- 7-state machine (architecture §5.1) — adding columns like `state`,
-- `acknowledged_at`, `resolved_at`, `actor_user_id`, the
-- `IncidentEvent` audit table, etc.
--
-- The 2.6 model is intentionally minimal: `id`, `device_id`, `severity`,
-- `metric`, `value`, `opened_at`. `device_id` FK ON DELETE CASCADE
-- matches the Device↔Reading FK contract (F-P8) so a removed Device
-- does not leave orphan Incidents behind.
--
-- `severity` is a free-form TEXT (NOT a Postgres enum) for the same
-- reason the column is a plain string in the Prisma schema: Story 4.2
-- may pivot on the canonical severity set; pinning it here would force
-- a migration that Epic 4 has to undo. The api validates
-- `severity ∈ {"info","warning","critical"}` at the wire boundary.

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "deviceId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "Incident_deviceId_fkey"
        FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Incident_deviceId_openedAt_idx" ON "Incident"("deviceId", "openedAt");