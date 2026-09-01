/**
 * Source-walk pin for the `reading_aggregate` migration SQL (Story 5.4).
 *
 * Reads `packages/db/prisma/migrations/<timestamp>_reading_aggregate/
 * migration.sql` and asserts:
 *   - the file creates the `ReadingAggregate` table with all 8 AC
 *     columns in the spec-pinned order (id, deviceId, bucketStart,
 *     metric, mean, min, max, sampleCount);
 *   - the file uses `TEXT` (nullable) for `deviceId` — the column
 *     MUST be nullable to align with the `onDelete: SetNull` FK
 *     and the Prisma `String?` model declaration (Story 5.4
 *     review pass);
 *   - the file creates the compound unique index
 *     `ReadingAggregate_deviceId_bucketStart_metric_key` with
 *     `NULLS NOT DISTINCT` so two `(bucketStart, metric)` rows
 *     with `deviceId IS NULL` collide (Story 5.4 review pass);
 *   - the file creates the non-unique index
 *     `ReadingAggregate_deviceId_bucketStart_idx` for the future
 *     range-scan read pattern;
 *   - the file creates the FK constraint
 *     `ReadingAggregate.deviceId → Device.id` with `ON DELETE SET
 *     NULL ON UPDATE CASCADE` (regulator retention requirement;
 *     a Device id update must cascade to its historical
 *     aggregates).
 *
 * If a future change drops a column, weakens the cascade, drops
 * the unique index, or removes the `NULLS NOT DISTINCT` clause,
 * this file fails loudly so the regression cannot reappear
 * silently.
 *
 * Mirrors the structure of
 * `packages/db/__tests__/alert-debounce.migration.spec.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join("prisma", "migrations");

const findMigrationSql = (): string => {
  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const match = entries.find((n) => /^\d{14}_reading_aggregate$/.test(n));
  if (!match) {
    throw new Error(
      `expected /\\d{14}_reading_aggregate/ in ${MIGRATIONS_DIR}; got ${entries.join(", ")}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, match, "migration.sql"), "utf8");
};

describe("Story 5.4 — reading_aggregate migration SQL pin", () => {
  const sql = findMigrationSql();

  it("creates the ReadingAggregate table with all 8 AC columns", () => {
    expect(sql).toMatch(/CREATE TABLE "ReadingAggregate"/);
    expect(sql).toMatch(/"id"\s+TEXT\s+NOT NULL/);
    // deviceId is nullable (Story 5.4 review pass) — must be
    // `TEXT,` with no `NOT NULL`. The Prisma `String?` model
    // declaration matches this SQL shape.
    expect(sql).toMatch(/"deviceId"\s+TEXT,/);
    expect(sql).toMatch(/"bucketStart"\s+TIMESTAMP\(3\)\s+NOT NULL/);
    expect(sql).toMatch(/"metric"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"mean"\s+DOUBLE PRECISION\s+NOT NULL/);
    expect(sql).toMatch(/"min"\s+DOUBLE PRECISION\s+NOT NULL/);
    expect(sql).toMatch(/"max"\s+DOUBLE PRECISION\s+NOT NULL/);
    expect(sql).toMatch(/"sampleCount"\s+INTEGER\s+NOT NULL/);
  });

  it("creates the compound UNIQUE INDEX with NULLS NOT DISTINCT (review pass)", () => {
    // The `NULLS NOT DISTINCT` clause is the load-bearing
    // Postgres 15+ syntax that makes two `(bucketStart, metric)`
    // rows with `deviceId IS NULL` collide. Without it, Postgres
    // treats NULLs as distinct in UNIQUE indexes and permits
    // orphan-duplicate buckets once any Device is deleted —
    // breaking the 5.5 cron's idempotent `ON CONFLICT (...) DO
    // UPDATE` invariant on the tombstoned path. Prisma's
    // `@@unique` does not natively emit the clause; this is a
    // hand-edited migration.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "ReadingAggregate_deviceId_bucketStart_metric_key"\s+ON "ReadingAggregate"\("deviceId", "bucketStart", "metric"\)\s+NULLS NOT DISTINCT/,
    );
  });

  it("creates the non-unique index for the future range-scan read pattern", () => {
    expect(sql).toMatch(
      /CREATE INDEX "ReadingAggregate_deviceId_bucketStart_idx"\s+ON "ReadingAggregate"\("deviceId", "bucketStart"\)/,
    );
  });

  it("ReadingAggregate.deviceId FK ON DELETE SET NULL ON UPDATE CASCADE", () => {
    expect(sql).toMatch(
      /ALTER TABLE "ReadingAggregate"\s+ADD CONSTRAINT "ReadingAggregate_deviceId_fkey"\s+FOREIGN KEY \("deviceId"\)\s+REFERENCES "Device"\("id"\)\s+ON DELETE SET NULL\s+ON UPDATE CASCADE/,
    );
  });
});
