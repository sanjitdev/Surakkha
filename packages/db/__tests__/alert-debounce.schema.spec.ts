/**
 * Source-walk pin for the `Alert` + `RuleDebounceState` Prisma models
 * (Story 3.4).
 *
 * Reads `packages/db/prisma/schema.prisma` as text and asserts:
 *   - the `model Alert { ... }` block exists at file scope;
 *   - the `model RuleDebounceState { ... }` block exists at file scope;
 *   - every AC field is named inside each model (FR-14 de-bounce
 *     schema contract);
 *   - the `Alert` model has both `@@index([deviceId, metric, severity])`
 *     AND `@@index([deviceId, metric, severity, clearedAt])` (per
 *     spec Code Map §"Alert");
 *   - the `RuleDebounceState` model has `@@unique([deviceId, metric,
 *     severity])` (FR-14 de-bounce key);
 *   - the `Device` model gains back-relations `alerts Alert[]` AND
 *     `debounceStates RuleDebounceState[]` (FK CASCADE targets);
 *   - the migrations directory contains an entry matching the
 *     `\d{14}_alert_debounce` pattern (B12 — migration filename).
 *
 * The partial unique index `Alert_open_unique_idx` is NOT a Prisma
 * `@@unique` (Prisma's `@@unique` does not support WHERE clauses);
 * it lives in the raw migration SQL. This spec DOES pin the
 * migration file's presence; the SQL body is covered by the
 * `alert-debounce.migration.spec.ts` companion.
 *
 * If a future change deletes a column, renames a model, drops an
 * index, or moves the migration folder, this file fails loudly so
 * the regression cannot reappear silently.
 *
 * Mirrors the structure of `packages/db/__tests__/rule-table.schema.
 * spec.ts` (text reads + regex matching).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCHEMA_PATH = join("prisma", "schema.prisma");
const MIGRATIONS_DIR = join("prisma", "migrations");

const ALERT_FIELDS_IN_ORDER = [
  "id",
  "deviceId",
  "ruleId",
  "severity",
  "metric",
  "openedAt",
  "clearedAt",
  "acknowledgedAt",
] as const;

const RULE_DEBOUNCE_STATE_FIELDS_IN_ORDER = [
  "id",
  "deviceId",
  "metric",
  "severity",
  "inViolationSince",
  "clearedSince",
] as const;

const readSchema = (): string => readFileSync(SCHEMA_PATH, "utf8");

/**
 * Extract the body of the named `model X { ... }` block as a substring
 * so the AC field + index assertions operate on the model scope, not
 * the entire file (which would let an unrelated `model` block satisfy
 * the assertion by accident).
 */
const extractModelBody = (schema: string, modelName: string): string => {
  const header = `model ${modelName} {`;
  const start = schema.indexOf(header);
  if (start === -1) return "";
  const afterHeader = start + header.length;
  // Walk forward until the matching `}` at column 0 — Prisma model
  // bodies are indented, so any `}` at column 0 closes the block.
  let depth = 1;
  let end = afterHeader;
  for (let i = afterHeader; i < schema.length && depth > 0; i++) {
    if (schema[i] === "{") depth++;
    else if (schema[i] === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  return schema.slice(afterHeader, end);
};

describe("Story 3.4 — alert-debounce schema pin", () => {
  it("declares the Alert model with all AC fields in documented order", () => {
    const schema = readSchema();
    const body = extractModelBody(schema, "Alert");
    expect(body).not.toBe("");

    let cursor = 0;
    for (const field of ALERT_FIELDS_IN_ORDER) {
      const idx = body.indexOf(field, cursor);
      expect(
        idx,
        `Alert.${field} should appear after previous field (cursor=${cursor})`,
      ).toBeGreaterThanOrEqual(cursor);
      cursor = idx + field.length;
    }
  });

  it("declares the RuleDebounceState model with all AC fields in documented order", () => {
    const schema = readSchema();
    const body = extractModelBody(schema, "RuleDebounceState");
    expect(body).not.toBe("");

    let cursor = 0;
    for (const field of RULE_DEBOUNCE_STATE_FIELDS_IN_ORDER) {
      const idx = body.indexOf(field, cursor);
      expect(
        idx,
        `RuleDebounceState.${field} should appear after previous field (cursor=${cursor})`,
      ).toBeGreaterThanOrEqual(cursor);
      cursor = idx + field.length;
    }
  });

  it("Alert has @@index([deviceId, metric, severity]) for findOpenAlert", () => {
    const body = extractModelBody(readSchema(), "Alert");
    expect(body).toMatch(/@@index\(\[deviceId,\s*metric,\s*severity\]\)/);
  });

  it("Alert has @@index([deviceId, metric, severity, clearedAt]) for dashboard list", () => {
    const body = extractModelBody(readSchema(), "Alert");
    expect(body).toMatch(/@@index\(\[deviceId,\s*metric,\s*severity,\s*clearedAt\]\)/);
  });

  it("RuleDebounceState has @@unique([deviceId, metric, severity]) for the de-bounce key", () => {
    const body = extractModelBody(readSchema(), "RuleDebounceState");
    expect(body).toMatch(/@@unique\(\[deviceId,\s*metric,\s*severity\]\)/);
  });

  it("Device model gains back-relations for Alert + RuleDebounceState", () => {
    const body = extractModelBody(readSchema(), "Device");
    expect(body).toMatch(/alerts\s+Alert\[\]\s+@relation\("DeviceAlerts"\)/);
    expect(body).toMatch(
      /debounceStates\s+RuleDebounceState\[\]\s+@relation\("DeviceRuleDebounceStates"\)/,
    );
  });

  it("Rule model gains back-relation for Alert (FK CASCADE target)", () => {
    const body = extractModelBody(readSchema(), "Rule");
    expect(body).toMatch(/alerts\s+Alert\[\]\s+@relation\("RuleAlerts"\)/);
  });

  it("migration directory contains the alert_debounce entry (B12)", () => {
    // The spec mandates a directory named `<YYYYMMDDHHMMSS>_alert_debounce`.
    const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const match = entries.find((n) => /^\d{14}_alert_debounce$/.test(n));
    expect(
      match,
      `expected /\\d{14}_alert_debounce/ in ${MIGRATIONS_DIR}; got ${entries.join(", ")}`,
    ).toBeDefined();
  });
});
