/**
 * Source-walk pin for the `ReadingAggregate` Prisma model (Story 5.4).
 *
 * Reads `packages/db/prisma/schema.prisma` as text and asserts:
 *   - the `model ReadingAggregate { ... }` block exists at file scope;
 *   - every AC field is named inside the model in the spec-pinned
 *     order (id, deviceId, bucketStart, metric, mean, min, max,
 *     sampleCount);
 *   - `deviceId` is `String?` (nullable end-to-end with the SQL
 *     migration — Story 5.4 review pass: the column MUST be
 *     nullable for the `onDelete: SetNull` FK to function);
 *   - `metric` is a free `String` (NOT a Prisma enum — the
 *     closed enum lives at the Zod layer
 *     `packages/shared/src/reading-aggregate.ts`);
 *   - the unique key `@@unique([deviceId, bucketStart, metric])`
 *     is the load-bearing invariant for Story 5.5's
 *     `ON CONFLICT (...) DO UPDATE` cron;
 *   - the non-unique `@@index([deviceId, bucketStart])` is
 *     present (the future range-scan read pattern);
 *   - the `device` FK is `onDelete: SetNull` so a removed Device
 *     does NOT cascade-delete historical aggregates (regulator
 *     retention requirement);
 *   - the `Device` model gains the back-relation
 *     `readingAggregates ReadingAggregate[] @relation("DeviceReadingAggregates")`;
 *   - the migrations directory contains an entry matching
 *     `/^\d{14}_reading_aggregate$/`.
 *
 * If a future change deletes a column, renames a model, drops an
 * index, weakens the cascade, or moves the migration folder, this
 * file fails loudly so the regression cannot reappear silently.
 *
 * Mirrors the structure of
 * `packages/db/__tests__/audit-log.schema.spec.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCHEMA_PATH = join("prisma", "schema.prisma");
const MIGRATIONS_DIR = join("prisma", "migrations");

/**
 * AC field order for the `ReadingAggregate` model. Pinned so a
 * future reorder / deletion surfaces here rather than as a silent
 * schema drift.
 */
const READING_AGGREGATE_FIELDS_IN_ORDER = [
  "id",
  "deviceId",
  "bucketStart",
  "metric",
  "mean",
  "min",
  "max",
  "sampleCount",
] as const;

const readSchema = (): string => readFileSync(SCHEMA_PATH, "utf8");

/**
 * Extract the body of the named `model X { ... }` block as a
 * substring so the AC field + index assertions operate on the model
 * scope, not the entire file. Mirrors the audit precedent at
 * `audit-log.schema.spec.ts:66-82`.
 *
 * Prisma has no nested braces inside a model body today, but the
 * raw-text brace-counter below SKIPS `// ...` and `/* ... *\/`
 * regions so a future comment containing `{` or `}` cannot corrupt
 * the depth counter (Story 5.4 review pass 2 — finding T2-NEW-1).
 */
const extractModelBody = (schema: string, modelName: string): string => {
  const header = `model ${modelName} {`;
  const start = schema.indexOf(header);
  if (start === -1) return "";
  const afterHeader = start + header.length;
  let depth = 1;
  let end = afterHeader;
  for (let i = afterHeader; i < schema.length && depth > 0; i += 1) {
    // Skip `// line comments` to end of line.
    if (schema[i] === "/" && schema[i + 1] === "/") {
      const nl = schema.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    // Skip `/* block comments */`.
    if (schema[i] === "/" && schema[i + 1] === "*") {
      const close = schema.indexOf("*/", i + 2);
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    if (schema[i] === "{") depth += 1;
    else if (schema[i] === "}") depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  return schema.slice(afterHeader, end);
};

describe("Story 5.4 — ReadingAggregate schema pin", () => {
  it("declares the ReadingAggregate model with all AC fields in documented order", () => {
    const body = extractModelBody(readSchema(), "ReadingAggregate");
    expect(body).not.toBe("");

    let cursor = 0;
    for (const field of READING_AGGREGATE_FIELDS_IN_ORDER) {
      const idx = body.indexOf(field, cursor);
      expect(
        idx,
        `ReadingAggregate.${field} should appear after previous field (cursor=${cursor})`,
      ).toBeGreaterThanOrEqual(cursor);
      cursor = idx + field.length;
    }
  });

  it("keeps deviceId as nullable (String?) end-to-end with the SQL migration", () => {
    // The Story 5.4 review pass changed deviceId from `String` to
    // `String?` to match the SQL `TEXT` column. The Prisma client's
    // TypeScript types must accept `null deviceId` on the read
    // path so tombstoned rows (Device delete → ON DELETE SET NULL)
    // are reachable in the typed row shape. A future drift back to
    // `String` (non-null) would re-introduce the nullability
    // mismatch the review pass fixed.
    const body = extractModelBody(readSchema(), "ReadingAggregate");
    expect(body).toMatch(/deviceId\s+String\?/);
  });

  it("keeps metric as a free String column (closed enum is at the Zod layer)", () => {
    // Per the spec design note: a Prisma enum would force a
    // migration every time a metric is added. The closed enum
    // lives at `packages/shared/src/reading-aggregate.ts`; a
    // future Prisma-enum migration should surface here.
    const body = extractModelBody(readSchema(), "ReadingAggregate");
    expect(body).toMatch(/metric\s+String\b/);
  });

  it("uses Float for mean/min/max and Int for sampleCount", () => {
    const body = extractModelBody(readSchema(), "ReadingAggregate");
    // `(?!\\?)` is a negative lookahead — pins the column as non-nullable
    // (`Float` not `Float?`). Story 5.4 review pass 2 (finding T2-NEW-4):
    // the bare `Float\b` regex matched both forms; the migration SQL
    // pins NOT NULL separately, but this tightens the schema spec too.
    expect(body).toMatch(/mean\s+Float(?!\?)/);
    expect(body).toMatch(/min\s+Float(?!\?)/);
    expect(body).toMatch(/max\s+Float(?!\?)/);
    expect(body).toMatch(/sampleCount\s+Int(?!\?)/);
  });

  it("has @@unique([deviceId, bucketStart, metric]) for the 5.5 upsert cron", () => {
    const body = extractModelBody(readSchema(), "ReadingAggregate");
    expect(body).toMatch(/@@unique\(\[deviceId,\s*bucketStart,\s*metric\]\)/);
  });

  it("has @@index([deviceId, bucketStart]) for the future range-scan read pattern", () => {
    const body = extractModelBody(readSchema(), "ReadingAggregate");
    expect(body).toMatch(/@@index\(\[deviceId,\s*bucketStart\]\)/);
  });

  it("device FK is onDelete: SetNull (aggregates must outlive their device)", () => {
    // Regulator-facing retention requirement: a deleted Device
    // must NOT cascade-delete historical aggregates. The FK row
    // goes null and the aggregate stays.
    const body = extractModelBody(readSchema(), "ReadingAggregate");
    expect(body).toMatch(/onDelete:\s*SetNull/);
  });

  it("Device model gains back-relation for ReadingAggregate", () => {
    const body = extractModelBody(readSchema(), "Device");
    expect(body).toMatch(
      /readingAggregates\s+ReadingAggregate\[\]\s+@relation\("DeviceReadingAggregates"\)/,
    );
  });

  it("migration directory contains the reading_aggregate entry", () => {
    // The spec mandates a directory named
    // `<YYYYMMDDHHMMSS>_reading_aggregate`. Story 5.4 review pass:
    // also accept the variant `_reading_aggregate_5_4_*` if a
    // future contributor renames for clarity.
    const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const match = entries.find((n) => /^\d{14}_reading_aggregate$/.test(n));
    expect(
      match,
      `expected /\\d{14}_reading_aggregate/ in ${MIGRATIONS_DIR}; got ${entries.join(", ")}`,
    ).toBeDefined();
  });
});
