-- Story 5.3 — `AuditLog` table.
--
-- The v1 audit writer (Story 1.5) writes a Pino log line; Story 5.6
-- swaps that writer to land rows here. This story ships the table +
-- read surface first so an Admin can browse the trail once the
-- writer is flipped — see spec-5-3 "Why ship the AuditLog table in
-- 5.3 rather than defer to 5.6".
--
-- Column-by-column (mirrors `IncidentEvent` shape):
--   - `id` (UUIDv4, server-generated).
--   - `actorUserId` (FK → User.id, ON DELETE SET NULL). The audit
--      row MUST outlive its actor — a deleted Admin's `rbac_allowed`
--      rows remain forensically valid. SET NULL is the same
--      durability pattern as `IncidentEvent.actorUserId` (4.2).
--   - `auditAction` (free TEXT). Closed enum is in
--      `@surakkha/shared/rbac.ts` (24 values + Story 5.0 additions);
--      storing as TEXT avoids a Prisma enum migration every time a
--      new variant is added.
--   - `resource` (TEXT) — entity type the action targeted
--      (`"Incident"`, `"Rule"`, etc.).
--   - `resourceId` (TEXT, nullable) — entity id when applicable;
--      null for actions like `logout` that have no resource binding.
--   - `payload` (JSONB, NOT NULL) — heterogeneous by design; the
--      writer passes through whatever the call site already has.
--   - `outcome` (TEXT, NOT NULL) — three values today
--      (`"success" | "failure" | "allow"`); free TEXT per the spec
--      design note "Why outcome is a String column rather than a
--      Prisma enum".
--   - `createdAt` (TIMESTAMP(3), default `CURRENT_TIMESTAMP`).
--
-- Indexes:
--   - `(createdAt)` — default listing
--      (`GET /api/audit/list`) orders by `createdAt DESC`.
--   - `(actorUserId, createdAt)` — actor-filter branch
--      (`?actorIds=a,b`) reads both columns.

-- CreateTable — AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "auditAction" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "payload" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — default listing path
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex — actor-filter branch
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- AddForeignKey — AuditLog.actorUserId → User.id SET NULL
-- Removing an actor MUST NOT cascade-delete their audit trail;
-- the audit history outlives the actor. Mirrors
-- IncidentEvent.actorUserId (Story 4.2) and Notification /
-- Attachment actor FKs in the same migration.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
