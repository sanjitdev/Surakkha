/**
 * Source-walk pin for the `CronRun` Prisma model (Story 5.5).
 *
 * Reads `packages/db/prisma/schema.prisma` as text and asserts:
 *   - the `model CronRun { ... }` block exists at file scope;
 *   - every AC field is named inside the model in the spec-pinned
 *     order (id, startedAt, finishedAt, status, aggregatedRows,
 *     deletedRows, errorMessage);
 *   - `status` is a free `String` (closed enum lives at the
 *     Zod layer `packages/shared/src/retention.ts`);
 *   - the index `@@index([startedAt])` is present for the
 *     "last run" / "recent ticks" lookup;
 *   - the `Reading` model gains the new
 *     `@@index([ts])` for the cron's `WHERE ts < cutoff`
 *     range-scan;
 *   - the migrations directory contains an entry matching
 *     `/^\d{14}_cron_runs$/`.
 *
 * If a future change deletes a column, renames a model, drops
 * an index, or moves the migration folder, this file fails
 * loudly so the regression cannot reappear silently.
 *
 * Mirrors the structure of `reading-aggregate.schema.spec.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCHEMA_PATH = join("prisma", "schema.prisma");
const MIGRATIONS_DIR = join("prisma", "migrations");

/**
 * AC field order for the `CronRun` model. Pinned so a future
 * reorder / deletion surfaces here rather than as a silent
 * schema drift.
 */
const CRON_RUN_FIELDS_IN_ORDER = [
  "id",
  "startedAt",
  "finishedAt",
  "status",
  "aggregatedRows",
  "deletedRows",
  "errorMessage",
] as const;

const readSchema = (): string => readFileSync(SCHEMA_PATH, "utf8");

/**
 * Extract the body of the named `model X { ... }` block as a
 * substring so the AC field + index assertions operate on the
 * model scope, not the entire file. Mirrors the audit precedent
 * at `audit-log.schema.spec.ts:66-82`.
 */
const extractModelBody = (schema: string, modelName: string): string => {
  const header = `model ${modelName} {`;
  const start = schema.indexOf(header);
  if (start === -1) return "";
  const afterHeader = start + header.length;
  let depth = 1;
  let end = afterHeader;
  for (let i = afterHeader; i < schema.length && depth > 0; i += 1) {
    if (schema[i] === "{") depth += 1;
    else if (schema[i] === "}") depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  return schema.slice(afterHeader, end);
};

describe("Story 5.5 — CronRun schema pin", () => {
  it("declares the CronRun model with all AC fields in documented order", () => {
    const body = extractModelBody(readSchema(), "CronRun");
    expect(body).not.toBe("");

    let cursor = 0;
    for (const field of CRON_RUN_FIELDS_IN_ORDER) {
      const idx = body.indexOf(field, cursor);
      expect(
        idx,
        `CronRun.${field} should appear after previous field (cursor=${cursor})`,
      ).toBeGreaterThanOrEqual(cursor);
      cursor = idx + field.length;
    }
  });

  it("uses String for status (closed enum lives at the Zod layer)", () => {
    // Per the spec design note: a Prisma enum would force a
    // migration every time a status is added. The closed enum
    // lives at `packages/shared/src/retention.ts`; a future
    // Prisma-enum migration should surface here.
    const body = extractModelBody(readSchema(), "CronRun");
    expect(body).toMatch(/status\s+String\b/);
  });

  it("uses Int for aggregatedRows + deletedRows", () => {
    const body = extractModelBody(readSchema(), "CronRun");
    expect(body).toMatch(/aggregatedRows\s+Int\b/);
    expect(body).toMatch(/deletedRows\s+Int\b/);
  });

  it("uses String? for errorMessage (NULL on success / running)", () => {
    const body = extractModelBody(readSchema(), "CronRun");
    expect(body).toMatch(/errorMessage\s+String\?/);
  });

  it("has @@index([startedAt]) for the last-run / recent-ticks lookup", () => {
    const body = extractModelBody(readSchema(), "CronRun");
    expect(body).toMatch(/@@index\(\[startedAt\]\)/);
  });

  it("Reading model gains @@index([ts]) for the cron's range-scan", () => {
    // Story 5.5 — without this index the cron's
    // `WHERE ts < cutoff` would seq-scan the raw Reading table.
    const body = extractModelBody(readSchema(), "Reading");
    expect(body).toMatch(/@@index\(\[ts\]\)/);
  });

  it("migration directory contains the cron_runs entry", () => {
    const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const match = entries.find((n) => /^\d{14}_cron_runs$/.test(n));
    expect(
      match,
      `expected /\\d{14}_cron_runs/ in ${MIGRATIONS_DIR}; got ${entries.join(", ")}`,
    ).toBeDefined();
  });
});
