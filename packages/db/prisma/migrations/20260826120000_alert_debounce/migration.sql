-- CreateTable — Alert (Story 3.4, architecture §5.1)
-- Per-`(deviceId, metric, severity)` alert lifecycle. `ruleId` records
-- which Rule fired; `severity` and `metric` duplicated to make
-- `findOpenAlert` a single indexed scan without joining Rule. `openedAt`
-- set at rising edge; `clearedAt` set at falling edge (NULL while open).
-- `acknowledgedAt` is forward-compatible nullable (Story 3.5 uses it).
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "metric" "RuleMetric" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable — RuleDebounceState (Story 3.4, FR-14)
-- Per-`(deviceId, metric, severity)` de-bounce timer state.
-- `inViolationSince` set on rising edge (raw breach present);
-- `clearedSince` set on falling edge (no raw breach). Both nullable.
CREATE TABLE "RuleDebounceState" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "metric" "RuleMetric" NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "inViolationSince" TIMESTAMP(3),
    "clearedSince" TIMESTAMP(3),

    CONSTRAINT "RuleDebounceState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — Alert scan for `findOpenAlert`
CREATE INDEX "Alert_deviceId_metric_severity_idx" ON "Alert"("deviceId", "metric", "severity");

-- CreateIndex — Alert operator-dashboard list (open + recently cleared by key)
CREATE INDEX "Alert_deviceId_metric_severity_clearedAt_idx" ON "Alert"("deviceId", "metric", "severity", "clearedAt");

-- CreateIndex — partial unique index for at-most-one-open per key
-- Prisma `@@unique` does not support SQL WHERE predicates; this index
-- is created directly via raw SQL. The hook relies on this index as the
-- safety net for the open race — second `prisma.alert.create` for the
-- same `(deviceId, metric, severity)` while the first is still open
-- hits `P2002` and the hook catches it as "already-open, skip".
CREATE UNIQUE INDEX "Alert_open_unique_idx" ON "Alert"("deviceId", "metric", "severity") WHERE "clearedAt" IS NULL;

-- CreateIndex — RuleDebounceState enforces the de-bounce key
CREATE UNIQUE INDEX "RuleDebounceState_deviceId_metric_severity_key" ON "RuleDebounceState"("deviceId", "metric", "severity");

-- AddForeignKey — Alert.deviceId → Device.id CASCADE
-- Device delete drops Alert rows (no orphan alerts; rule-version
-- history is preserved by Story 3.7's audit, not by Alert rows).
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — Alert.ruleId → Rule.id CASCADE
-- Device delete cascades through Rule (Device → Rule CASCADE) and then
-- Rule delete cascades Alert. Independent Rule delete also cascades.
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — RuleDebounceState.deviceId → Device.id CASCADE
-- Device delete drops RuleDebounceState rows (no ghost timers on re-add).
ALTER TABLE "RuleDebounceState" ADD CONSTRAINT "RuleDebounceState_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
