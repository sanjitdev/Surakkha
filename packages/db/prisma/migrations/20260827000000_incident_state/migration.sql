-- Story 4.2 + 4.9 — Incident state machine + Notification writer.
--
-- The largest single migration in the project so far. Adds the User
-- table (FK target for Incident.assigneeUserId, IncidentEvent.actorUserId,
-- Notification.acknowledgedByUserId, Attachment.uploadedByUserId,
-- Alert.acknowledgedByUserId retrofit), the IncidentEvent audit table,
-- the Notification table, the Attachment table (table-only; 4.13 writes
-- the endpoint), four new columns on Incident, four new columns on
-- Alert, three new enum types, and the partial unique index that
-- enforces Notification idempotency.
--
-- Forward-only. All new columns are nullable (or have safe defaults).
-- The Incident.state default 'OPEN' applies to existing rows from
-- Story 3.6's auto-create path so they land at OPEN without a backfill.
-- The Alert.acknowledgedByUserId FK is added NOW (the column has been
-- a free String since Story 3.5; this migration retrofits the
-- constraint).
--
-- Idempotency: this is a single forward migration; no `IF NOT EXISTS`
-- guards. Prisma migrate deploy expects it to run once against a
-- pristine state.

-- CreateEnum — IncidentState_ (Story 4.2)
-- Mirrors `IncidentStateSchema` in `packages/shared/src/incident.ts`.
-- `REOPENED` is a transition alias; Story 4.11 writes `OPEN` at the
-- reopen commit but the enum member exists so the schema can describe
-- the wire-state if Story 4.11 changes its mind.
CREATE TYPE "IncidentState_" AS ENUM (
    'OPEN',
    'ACKNOWLEDGED',
    'INSPECTING',
    'SAFE',
    'UNSAFE',
    'MONITORING',
    'RESOLVED',
    'REOPENED'
);

-- CreateEnum — IncidentEventType_ (Story 4.2)
-- `invalid_transition_attempt` is the synthetic type written when a
-- transition is rejected (compare-and-set optimistic-concurrency
-- loser OR a `TRANSITIONS` table miss).
CREATE TYPE "IncidentEventType_" AS ENUM (
    'acknowledge',
    'assign',
    'submit_result',
    'resolve',
    'reopen',
    'invalid_transition_attempt'
);

-- CreateEnum — UserRole_ (Story 4.2)
-- Mirrors `RoleSchema` in `packages/shared/src/rbac.ts` 1:1.
CREATE TYPE "UserRole_" AS ENUM (
    'Admin',
    'Operator',
    'Technician',
    'Viewer'
);

-- CreateEnum — NotificationSeverity_ (Story 4.9)
-- Triple mirrors the wire contract; only `warning` + `critical` are
-- emitted by 4.9. `info` reserved for Epic 6 cron warnings.
CREATE TYPE "NotificationSeverity_" AS ENUM (
    'info',
    'warning',
    'critical'
);

-- CreateEnum — NotificationRecipientRole_ (Story 4.9)
-- Mirrors the four demo roles.
CREATE TYPE "NotificationRecipientRole_" AS ENUM (
    'Admin',
    'Operator',
    'Technician',
    'Viewer'
);

-- CreateTable — User (Story 4.2)
-- `id` is the JWT `sub` (UUIDv4). Seeded by `seedUsers.ts`
-- (1 Admin + 2 Operators + 2 Technicians + 1 Viewer); the api also
-- lazy-upserts on first JWT sight as defense-in-depth.
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole_" NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable — IncidentEvent (Story 4.2 audit)
-- Every successful transition writes one row in the same $transaction
-- as the Incident.update. Every failed/rejected attempt ALSO writes a
-- row with `type: 'invalid_transition_attempt'`.
CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "IncidentEventType_" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable — Notification (Story 4.9)
-- All notification events land here. `acknowledgedAt` is the open-
-- banner-window marker; the partial unique index enforces at-most-
-- one-active-banner per (incidentId, severity).
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "severity" "NotificationSeverity_" NOT NULL,
    "incidentId" TEXT,
    "alertId" TEXT,
    "recipientRole" "NotificationRecipientRole_" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable — Attachment (Story 4.13 schema-only)
-- The WRITE endpoint ships in Story 4.13 (deferred). The TABLE lands
-- here so we don't pay a second forward migration when 4.13 lands.
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "mime" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- AlterTable — Incident gains state-machine columns (Story 4.2)
-- All new columns are nullable except `state` (which has a DEFAULT
-- `'OPEN'`). Existing rows from Story 3.6's auto-create path land at
-- state='OPEN' without a backfill — that's the right value because
-- those incidents have not been acknowledged.
ALTER TABLE "Incident" ADD COLUMN "state" "IncidentState_" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "Incident" ADD COLUMN "assigneeUserId" TEXT;
ALTER TABLE "Incident" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- CreateIndex — Kanban-column hot path (Story 4.3, deferred UI)
-- `(state, openedAt DESC)` is the OPEN/ACKNOWLEDGED/RESOLVED buckets.
CREATE INDEX "Incident_state_openedAt_idx" ON "Incident"("state", "openedAt");

-- CreateIndex — IncidentEvent timeline (Story 4.4 detail page)
-- Per-incident chronological order consumed by the deferred UI.
CREATE INDEX "IncidentEvent_incidentId_createdAt_idx" ON "IncidentEvent"("incidentId", "createdAt");

-- CreateIndex — Notification dropdown lookup (Story 4.10, deferred UI)
-- All-recent-by-role pattern; consumes the migration's index by
-- `recipientRole, createdAt DESC` matching the spec.
CREATE INDEX "Notification_recipientRole_createdAt_idx" ON "Notification"("recipientRole", "createdAt");

-- CreateIndex — Notification idempotency (Story 4.9 AC5)
-- At-most-one-active-banner per (incidentId, severity). Acknowledged
-- rows drop out of the partial predicate, allowing a future
-- re-emission if a new UNSAFE result lands.
CREATE UNIQUE INDEX "Notification_incidentId_severity_active_unique_idx"
    ON "Notification"("incidentId", "severity")
    WHERE "acknowledgedAt" IS NULL;

-- CreateIndex — Attachment per-incident list (Story 4.13)
CREATE INDEX "Attachment_incidentId_createdAt_idx" ON "Attachment"("incidentId", "createdAt");

-- AddForeignKey — Incident.assigneeUserId → User.id SET NULL
-- Removing a User must NOT cascade-delete the incident: audit history
-- (IncidentEvent rows with that user) requires the incident to outlive
-- its assignee. SET NULL keeps the row intact; the IncidentEvent's
-- `actorUserId` becomes NULL too via cascade.
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assigneeUserId_fkey"
    FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — IncidentEvent.incidentId → Incident.id CASCADE
-- Removing the incident drops its event log (no orphan audit rows).
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — IncidentEvent.actorUserId → User.id SET NULL
-- Removing the actor must NOT cascade-delete their audit trail: the
-- incident's audit history is the contract.
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — Notification.incidentId → Incident.id SET NULL
-- Removing an incident preserves its notification history (audit
-- durability, same principle as IncidentEvent).
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — Notification.alertId → Alert.id SET NULL
-- Same durability principle for alert-backed notifications (warnings
-- from Story 3.6 auto-create).
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "Alert"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — Notification.acknowledgedByUserId → User.id SET NULL
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_acknowledgedByUserId_fkey"
    FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — Attachment.incidentId → Incident.id CASCADE
-- Removing the incident drops its attachments.
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — Attachment.uploadedByUserId → User.id SET NULL
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — Alert.acknowledgedByUserId → User.id SET NULL (retrofit)
-- Story 3.5 shipped this column as a free `String?`. Epic 4 introduces
-- the User table; this migration retrofits the FK constraint.
-- ON DELETE SET NULL preserves the alert row even when the operator
-- is removed.
--
-- Pre-emptive orphan-null backfill (code review 2026-08-27, decision 4):
-- Story 3.5 demo flows populated Alert.acknowledgedByUserId with free
-- strings that may not match any seeded User.id. Setting those rows to
-- NULL before adding the FK constraint prevents the migration from
-- aborting on a populated prod-like DB. The alert row + its clearedAt
-- timestamp are preserved; only the now-orphan acknowledgedByUserId is
-- cleared.
DO $$
BEGIN
    UPDATE "Alert"
    SET "acknowledgedByUserId" = NULL
    WHERE "acknowledgedByUserId" IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM "User" WHERE "User"."id" = "Alert"."acknowledgedByUserId"
      );
END $$;

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_acknowledgedByUserId_fkey"
    FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
