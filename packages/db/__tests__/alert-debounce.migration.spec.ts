/**
 * Source-walk pin for the alert_debounce migration SQL (Story 3.4).
 *
 * Reads `packages/db/prisma/migrations/<timestamp>_alert_debounce/
 * migration.sql` and asserts:
 *   - the file creates the `Alert` table with all AC columns;
 *   - the file creates the `RuleDebounceState` table with all AC
 *     columns;
 *   - the file creates `@@index([deviceId, metric, severity])` on
 *     `Alert` for `findOpenAlert`;
 *   - the file creates `@@index([deviceId, metric, severity,
 *     clearedAt])` on `Alert` for the dashboard list;
 *   - the file creates the PARTIAL UNIQUE INDEX
 *     `Alert_open_unique_idx` with `WHERE "clearedAt" IS NULL`
 *     (Prisma `@@unique` cannot express WHERE; this is the safety
 *     net for the open race per AC11);
 *   - the file creates `@@unique([deviceId, metric, severity])` on
 *     `RuleDebounceState`;
 *   - the file creates FK constraints `Alert.deviceId → Device.id`,
 *     `Alert.ruleId → Rule.id`, and
 *     `RuleDebounceState.deviceId → Device.id` with `ON DELETE
 *     CASCADE` (AC10 — Device delete cascades).
 *
 * If a future change drops a column, removes an index, weakens the
 * cascade, or removes the partial unique index, this file fails
 * loudly so the regression cannot reappear silently.
 *
 * Mirrors the structure of `rule-table.migration.spec.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join("prisma", "migrations");

const findMigrationSql = (): string => {
  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const match = entries.find((n) => /^\d{14}_alert_debounce$/.test(n));
  if (!match) {
    throw new Error(
      `expected /\\d{14}_alert_debounce/ in ${MIGRATIONS_DIR}; got ${entries.join(", ")}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, match, "migration.sql"), "utf8");
};

describe("Story 3.4 — alert_debounce migration SQL pin", () => {
  const sql = findMigrationSql();

  it("creates the Alert table with all AC columns", () => {
    expect(sql).toMatch(/CREATE TABLE "Alert"/);
    expect(sql).toMatch(/"deviceId"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"ruleId"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"severity"\s+"RuleSeverity"\s+NOT NULL/);
    expect(sql).toMatch(/"metric"\s+"RuleMetric"\s+NOT NULL/);
    expect(sql).toMatch(/"openedAt"\s+TIMESTAMP\(3\)\s+NOT NULL/);
    expect(sql).toMatch(/"clearedAt"\s+TIMESTAMP\(3\)/);
    expect(sql).toMatch(/"acknowledgedAt"\s+TIMESTAMP\(3\)/);
  });

  it("creates the RuleDebounceState table with all AC columns", () => {
    expect(sql).toMatch(/CREATE TABLE "RuleDebounceState"/);
    expect(sql).toMatch(/"deviceId"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"metric"\s+"RuleMetric"\s+NOT NULL/);
    expect(sql).toMatch(/"severity"\s+"RuleSeverity"\s+NOT NULL/);
    expect(sql).toMatch(/"inViolationSince"\s+TIMESTAMP\(3\)/);
    expect(sql).toMatch(/"clearedSince"\s+TIMESTAMP\(3\)/);
  });

  it("creates @@index([deviceId, metric, severity]) on Alert for findOpenAlert", () => {
    expect(sql).toMatch(
      /CREATE INDEX "Alert_deviceId_metric_severity_idx"\s+ON "Alert"\("deviceId", "metric", "severity"\)/,
    );
  });

  it("creates @@index([deviceId, metric, severity, clearedAt]) on Alert for dashboard", () => {
    expect(sql).toMatch(
      /CREATE INDEX "Alert_deviceId_metric_severity_clearedAt_idx"\s+ON "Alert"\("deviceId", "metric", "severity", "clearedAt"\)/,
    );
  });

  it("creates the partial UNIQUE INDEX Alert_open_unique_idx with WHERE clearedAt IS NULL (AC11)", () => {
    // Pin the partial-unique-index pattern explicitly. This is the
    // safety net for the open race — second `prisma.alert.create`
    // for the same `(deviceId, metric, severity)` while the first is
    // still open hits P2002 and the hook catches it.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "Alert_open_unique_idx"\s+ON "Alert"\("deviceId", "metric", "severity"\)\s+WHERE "clearedAt" IS NULL/,
    );
  });

  it("creates @@unique([deviceId, metric, severity]) on RuleDebounceState", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "RuleDebounceState_deviceId_metric_severity_key"\s+ON "RuleDebounceState"\("deviceId", "metric", "severity"\)/,
    );
  });

  it("Alert.deviceId FK CASCADE on Device delete (AC10)", () => {
    expect(sql).toMatch(
      /ALTER TABLE "Alert"\s+ADD CONSTRAINT "Alert_deviceId_fkey"\s+FOREIGN KEY \("deviceId"\)\s+REFERENCES "Device"\("id"\)\s+ON DELETE CASCADE/,
    );
  });

  it("Alert.ruleId FK CASCADE on Rule delete", () => {
    expect(sql).toMatch(
      /ALTER TABLE "Alert"\s+ADD CONSTRAINT "Alert_ruleId_fkey"\s+FOREIGN KEY \("ruleId"\)\s+REFERENCES "Rule"\("id"\)\s+ON DELETE CASCADE/,
    );
  });

  it("RuleDebounceState.deviceId FK CASCADE on Device delete (AC10)", () => {
    expect(sql).toMatch(
      /ALTER TABLE "RuleDebounceState"\s+ADD CONSTRAINT "RuleDebounceState_deviceId_fkey"\s+FOREIGN KEY \("deviceId"\)\s+REFERENCES "Device"\("id"\)\s+ON DELETE CASCADE/,
    );
  });
});
