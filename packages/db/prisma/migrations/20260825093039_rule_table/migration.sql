-- CreateEnum
CREATE TYPE "RuleMetric" AS ENUM ('ph', 'tds_ppm', 'turbidity_ntu', 'chlorine_ppm', 'temp_c', 'water_level_cm');

-- CreateEnum
CREATE TYPE "RuleOperator" AS ENUM ('gte', 'gt', 'lte', 'lt', 'eq');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "RuleRuleType" AS ENUM ('instant', 'rate', 'absence');

-- AlterTable
ALTER TABLE "Incident" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Reading" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "metric" "RuleMetric" NOT NULL,
    "operator" "RuleOperator" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "ruleType" "RuleRuleType" NOT NULL,
    "minDurationSeconds" INTEGER NOT NULL,
    "hysteresisSeconds" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rule_deviceId_metric_operator_threshold_version_key" ON "Rule"("deviceId", "metric", "operator", "threshold", "version");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
