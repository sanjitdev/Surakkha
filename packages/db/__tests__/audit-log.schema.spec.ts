/**
 * Source-walk pin for the `AuditLog` Prisma model (Story 5.3).
 *
 * Reads `packages/db/prisma/schema.prisma` as text and asserts:
 *   - the `model AuditLog { ... }` block exists at file scope;
 *   - every AC field is named inside the model (the audit-log
 *     read surface mirrors `IncidentEvent`'s 1:1 shape — see
 *     spec-5-3 "Mirrors `IncidentEvent` shape 1:1");
 *   - the indexes `@@index([createdAt])` (default listing
 *     orders by `createdAt DESC`) and
 *     `@@index([actorUserId, createdAt])` (the actor-filter
 *     branch reads both columns) are present;
 *   - the `actor` FK is `onDelete: SetNull` so a deleted actor's
 *     audit rows survive (the spec design note "Why actorUserId
 *     is nullable");
 *   - the `User` model gains the back-relation
 *     `auditLogs AuditLog[] @relation("UserAuditLogs")`;
 *   - the migrations directory contains an entry matching the
 *     `\d{14}_audit_log` pattern (B12 — migration filename).
 *
 * `auditAction`, `resource`, and `outcome` are deliberately NOT
 * Prisma enums (per the spec "Why outcome is a String column
 * rather than a Prisma enum" note); this spec pins the `String`
 * type so a future Prisma-enum migration would surface here.
 *
 * If a future change deletes a column, renames a model, drops an
 * index, or moves the migration folder, this file fails loudly so
 * the regression cannot reappear silently.
 *
 * Mirrors the structure of `packages/db/__tests__/alert-debounce.
 * schema.spec.ts` (text reads + regex matching).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCHEMA_PATH = join("prisma", "schema.prisma");
const MIGRATIONS_DIR = join("prisma", "migrations");

/**
 * AC field order for the `AuditLog` model. Pinned so a future
 * reorder / deletion surfaces as a failure here rather than as a
 * silent schema drift.
 */
const AUDIT_LOG_FIELDS_IN_ORDER = [
  "id",
  "actorUserId",
  "auditAction",
  "resource",
  "resourceId",
  "payload",
  "outcome",
  "createdAt",
] as const;

const readSchema = (): string => readFileSync(SCHEMA_PATH, "utf8");

/**
 * Extract the body of the named `model X { ... }` block as a substring
 * so the AC field + index assertions operate on the model scope, not
 * the entire file (which would let an unrelated `model` block satisfy
 * the assertion by accident). Mirrors
 * `alert-debounce.schema.spec.ts:69-87`.
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

describe("Story 5.3 — AuditLog schema pin", () => {
  it("declares the AuditLog model with all AC fields in documented order", () => {
    const schema = readSchema();
    const body = extractModelBody(schema, "AuditLog");
    expect(body).not.toBe("");

    let cursor = 0;
    for (const field of AUDIT_LOG_FIELDS_IN_ORDER) {
      const idx = body.indexOf(field, cursor);
      expect(
        idx,
        `AuditLog.${field} should appear after previous field (cursor=${cursor})`,
      ).toBeGreaterThanOrEqual(cursor);
      cursor = idx + field.length;
    }
  });

  it("keeps auditAction, resource, and outcome as free String columns", () => {
    // Per the spec design note "Why outcome is a String column
    // rather than a Prisma enum". A future migration to a Prisma
    // enum should surface here.
    const body = extractModelBody(readSchema(), "AuditLog");
    expect(body).toMatch(/auditAction\s+String\b/);
    expect(body).toMatch(/resource\s+String\b/);
    expect(body).toMatch(/outcome\s+String\b/);
  });

  it("uses Json payload (heterogeneous by design)", () => {
    const body = extractModelBody(readSchema(), "AuditLog");
    expect(body).toMatch(/payload\s+Json\b/);
  });

  it("has @@index([createdAt]) for the default DESC listing", () => {
    const body = extractModelBody(readSchema(), "AuditLog");
    expect(body).toMatch(/@@index\(\[createdAt\]\)/);
  });

  it("has @@index([actorUserId, createdAt]) for the actor-filter branch", () => {
    const body = extractModelBody(readSchema(), "AuditLog");
    expect(body).toMatch(/@@index\(\[actorUserId,\s*createdAt\]\)/);
  });

  it("actor FK is onDelete: SetNull (audit rows must outlive their actor)", () => {
    const body = extractModelBody(readSchema(), "AuditLog");
    expect(body).toMatch(/onDelete:\s*SetNull/);
  });

  it("User model gains back-relation for AuditLog", () => {
    const body = extractModelBody(readSchema(), "User");
    expect(body).toMatch(/auditLogs\s+AuditLog\[\]\s+@relation\("UserAuditLogs"\)/);
  });

  it("migration directory contains the audit_log entry (B12)", () => {
    // The spec mandates a directory named `<YYYYMMDDHHMMSS>_audit_log`.
    const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const match = entries.find((n) => /^\d{14}_audit_log$/.test(n));
    expect(
      match,
      `expected /\\d{14}_audit_log/ in ${MIGRATIONS_DIR}; got ${entries.join(", ")}`,
    ).toBeDefined();
  });
});
