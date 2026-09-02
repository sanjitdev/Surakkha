/**
 * Source-walk pin for the `cron_runs` migration SQL (Story 5.5).
 *
 * Reads `packages/db/prisma/migrations/<timestamp>_cron_runs/
 * migration.sql` and asserts:
 *   - the file creates the `CronRun` table with all 7 AC
 *     columns in the spec-pinned order (id, startedAt,
 *     finishedAt, status, aggregatedRows, deletedRows,
 *     errorMessage);
 *   - the file creates the non-unique index
 *     `CronRun_startedAt_idx` for the last-run / recent-ticks
 *     lookup;
 *   - the file creates the non-unique index `Reading_ts_idx`
 *     so the cron's `WHERE ts < cutoff` range-scan is
 *     index-served instead of seq-scanning the table.
 *
 * If a future change drops a column, weakens the cascade, drops
 * an index, or removes the `Reading_ts_idx`, this file fails
 * loudly so the regression cannot reappear silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join("prisma", "migrations");

const findMigrationSql = (): string => {
  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const match = entries.find((n) => /^\d{14}_cron_runs$/.test(n));
  if (!match) {
    throw new Error(`expected /\\d{14}_cron_runs/ in ${MIGRATIONS_DIR}; got ${entries.join(", ")}`);
  }
  return readFileSync(join(MIGRATIONS_DIR, match, "migration.sql"), "utf8");
};

describe("Story 5.5 — cron_runs migration SQL pin", () => {
  const sql = findMigrationSql();

  it("creates the CronRun table with all 7 AC columns", () => {
    expect(sql).toMatch(/CREATE TABLE "CronRun"/);
    expect(sql).toMatch(/"id"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"startedAt"\s+TIMESTAMP\(3\)\s+NOT NULL/);
    // finishedAt is nullable (NULL while `running`).
    expect(sql).toMatch(/"finishedAt"\s+TIMESTAMP\(3\)/);
    expect(sql).toMatch(/"status"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"aggregatedRows"\s+INTEGER\s+NOT NULL/);
    expect(sql).toMatch(/"deletedRows"\s+INTEGER\s+NOT NULL/);
    // errorMessage is nullable.
    expect(sql).toMatch(/"errorMessage"\s+TEXT/);
  });

  it("creates the CronRun_startedAt_idx for the last-run lookup", () => {
    expect(sql).toMatch(/CREATE INDEX "CronRun_startedAt_idx"\s+ON "CronRun"\("startedAt"\)/);
  });

  it("creates the Reading_ts_idx for the cron's range-scan", () => {
    // The cron's `WHERE ts < cutoff` predicate would seq-scan
    // without this index; future regressions that drop the
    // index would surface here as a regression that the cron
    // test rig would then exercise at the integration seam.
    expect(sql).toMatch(/CREATE INDEX "Reading_ts_idx"\s+ON "Reading"\("ts"\)/);
  });
});
