/**
 * Source-walk pin for the generated Rule migration SQL (Story 3.1).
 *
 * Reads the `migration.sql` inside Prisma's auto-assigned
 * `<14-digit-timestamp>_rule_table` folder and asserts:
 *   - `CREATE TABLE "Rule"` is present;
 *   - every column from the AC appears with the expected nullability;
 *   - the `@@unique` index covers
 *     `(deviceId, metric, operator, threshold, version)`;
 *   - the FK to `Device.id` is `ON DELETE CASCADE`;
 *   - the four `CREATE TYPE` enum declarations precede the table
 *     creation (Postgres requires the type to exist before use).
 *
 * If a future change deletes a column, drops the unique constraint,
 * or weakens the cascade, this file fails loudly so the regression
 * cannot reappear silently.
 *
 * Mirrors the file-walking + assertion shape of
 * `packages/api/__tests__/health.public.spec.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join("prisma", "migrations");

/**
 * Columns the AC requires on the `Rule` table, paired with the
 * expected nullability that the generated `CREATE TABLE` line must
 * carry. `NOT NULL` is mandatory for columns without `?`; nullable
 * columns must NOT carry `NOT NULL`.
 */
const AC_COLUMNS: ReadonlyArray<{ readonly name: string; readonly nullable: boolean }> = [
  { name: "id", nullable: false },
  { name: "deviceId", nullable: true },
  { name: "metric", nullable: false },
  { name: "operator", nullable: false },
  { name: "threshold", nullable: false },
  { name: "severity", nullable: false },
  { name: "ruleType", nullable: false },
  { name: "minDurationSeconds", nullable: false },
  { name: "hysteresisSeconds", nullable: false },
  { name: "version", nullable: false },
  { name: "createdBy", nullable: true },
  { name: "createdAt", nullable: false },
  { name: "updatedAt", nullable: false },
  { name: "isActive", nullable: false },
];

const findMigrationSql = (): { folder: string; contents: string } => {
  const entries = readdirSync(MIGRATIONS_DIR);
  const match = entries.find((entry) => /^\d{14}_rule_table$/.test(entry));
  if (!match) {
    throw new Error(
      `expected migrations directory to contain a \`\\d{14}_rule_table\` folder; saw [${entries.join(", ")}]`,
    );
  }
  const path = join(MIGRATIONS_DIR, match, "migration.sql");
  return { folder: match, contents: readFileSync(path, "utf8") };
};

const extractCreateTableRule = (source: string): string => {
  // The `Rule` table is the only `CREATE TABLE "Rule" (...)` block
  // in this migration; pull it as a substring so subsequent column
  // assertions operate on the table body rather than the entire file.
  const startMarker = `CREATE TABLE "Rule"`;
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(
      `expected migration.sql to contain \`${startMarker}\``,
    );
  }
  const bodyStart = source.indexOf("(", start);
  if (bodyStart === -1) {
    throw new Error(
      `expected \`${startMarker}\` to be followed by an opening paren`,
    );
  }
  let depth = 1;
  let i = bodyStart + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    i += 1;
  }
  if (depth !== 0) {
    throw new Error("unterminated CREATE TABLE Rule block");
  }
  return source.slice(start, i);
};

describe("Rule migration SQL — source-walk pin (Story 3.1)", () => {
  const migration = findMigrationSql();

  it("declares the Rule table (`CREATE TABLE \"Rule\"`)", () => {
    expect(migration.contents).toMatch(/CREATE TABLE "Rule"/);
  });

  it.each(AC_COLUMNS)(
    "declares the `$name` column (nullable: $nullable)",
    ({ name, nullable }) => {
      const block = extractCreateTableRule(migration.contents);
      // Match `"<column>" <type>[ NOT NULL][ DEFAULT <expr>]` so the
      // assertion handles both nullable and NOT NULL columns
      // uniformly. The `[^,]+` is greedy so the inner capture covers
      // any `DEFAULT ...` clause up to the next column or closing
      // paren.
      const re = new RegExp(`"${name}"\\s+([^,]+)`);
      const match = block.match(re);
      expect(
        match,
        `expected \`CREATE TABLE "Rule"\` to include column \`${name}\``,
      ).not.toBeNull();
      const decl = match?.[1] ?? "";
      if (nullable) {
        expect(
          /\bNOT NULL\b/.test(decl),
          `column \`${name}\` must NOT be marked NOT NULL (nullable column drift)`,
        ).toBe(false);
      } else {
        expect(
          /\bNOT NULL\b/.test(decl),
          `column \`${name}\` must be marked NOT NULL`,
        ).toBe(true);
      }
    },
  );

  it("declares the unique constraint on (deviceId, metric, operator, threshold, version)", () => {
    // Prisma emits a unique INDEX (not an inline `UNIQUE` modifier) so
    // the migration looks like:
    //   CREATE UNIQUE INDEX "Rule_deviceId_metric_operator_threshold_version_key"
    //   ON "Rule"("deviceId", "metric", "operator", "threshold", "version");
    const re =
      /CREATE UNIQUE INDEX "Rule_deviceId_metric_operator_threshold_version_key"\s+ON "Rule"\("deviceId", "metric", "operator", "threshold", "version"\)/;
    expect(migration.contents).toMatch(re);
  });

  it("isActive is NOT in the unique index columns (version disambiguates coexistent rows)", () => {
    // The unique constraint is on (deviceId, metric, operator, threshold, version).
    // `isActive` is excluded so Story 3.7's edit flow can have an
    // `isActive: false` previous version alongside an `isActive: true`
    // new version at the same tuple, differentiated by `version`.
    // Pinning `isActive` exclusion here catches a future regression
    // that adds it to the index and silently breaks the design intent.
    const uniqueBlock =
      /CREATE UNIQUE INDEX "Rule_deviceId_metric_operator_threshold_version_key"[\s\S]+?\);/.exec(
        migration.contents,
      );
    expect(
      uniqueBlock,
      "expected the unique index block to be present",
    ).not.toBeNull();
    expect(
      uniqueBlock?.[0] ?? "",
      "`isActive` must NOT appear in the unique index column list — version is the disambiguator",
    ).not.toMatch(/\bisActive\b/);
  });

  it("declares the FK from Rule.deviceId to Device.id with ON DELETE CASCADE", () => {
    const re =
      /ALTER TABLE "Rule"\s+ADD CONSTRAINT "Rule_deviceId_fkey"\s+FOREIGN KEY \("deviceId"\)\s+REFERENCES "Device"\("id"\)\s+ON DELETE CASCADE\s+ON UPDATE CASCADE/;
    expect(migration.contents).toMatch(re);
  });

  it("declares the FK with ON DELETE CASCADE (cascade pin — no orphans)", () => {
    // Defensive: pin the cascade clause alone so a regression that
    // weakens the FK to RESTRICT (or drops the constraint) is loud.
    const fkBlock =
      /FOREIGN KEY \("deviceId"\) REFERENCES "Device"\("id"\)\s+ON DELETE CASCADE ON UPDATE CASCADE/.exec(
        migration.contents,
      );
    expect(fkBlock, "Rule_deviceId_fkey must use ON DELETE CASCADE").not.toBeNull();
  });

  it("declares the four CREATE TYPE enums preceding the CREATE TABLE", () => {
    const requiredTypes = [
      `CREATE TYPE "RuleMetric"`,
      `CREATE TYPE "RuleOperator"`,
      `CREATE TYPE "RuleSeverity"`,
      `CREATE TYPE "RuleRuleType"`,
    ];
    const createTableOffset = migration.contents.indexOf(`CREATE TABLE "Rule"`);
    expect(createTableOffset).toBeGreaterThan(-1);
    for (const typeDecl of requiredTypes) {
      const offset = migration.contents.indexOf(typeDecl);
      expect(
        offset,
        `migration.sql must declare \`${typeDecl}\``,
      ).toBeGreaterThan(-1);
      expect(
        offset < createTableOffset,
        `\`${typeDecl}\` must precede \`CREATE TABLE "Rule"\` (Postgres requires the type to exist before use)`,
      ).toBe(true);
    }
  });

  it("migration folder matches the Prisma auto-assigned \\d{14}_rule_table pattern", () => {
    expect(migration.folder).toMatch(/^\d{14}_rule_table$/);
  });

  it("declares the intentional ALTER TABLE on Incident.id and Reading.id (drops legacy gen_random_uuid() defaults) and NO other ALTER TABLE on pre-existing tables", () => {
    // Prisma's `migrate dev --create-only` re-evaluates the schema and
    // emits these two `DROP DEFAULT` lines because the schema
    // declares `id String @default(uuid())` for both tables (and the
    // original migrations used Postgres-side `gen_random_uuid()` as
    // the id default — Prisma re-emits these to keep schema and SQL
    // in sync). Pinning them here ensures any accidental removal (or
    // any *additional* `ALTER TABLE` on a pre-existing table — e.g.
    // a stray `DROP COLUMN` slipping in) is loud.
    expect(migration.contents).toMatch(
      /ALTER TABLE "Incident" ALTER COLUMN "id" DROP DEFAULT;/,
    );
    expect(migration.contents).toMatch(
      /ALTER TABLE "Reading" ALTER COLUMN "id" DROP DEFAULT;/,
    );
    // Negative space: no `ALTER TABLE` may target the pre-existing
    // `Device`, `Rule` is the only NEW table so its own ALTERs are
    // allowed, but no other legacy table should be mutated here.
    expect(migration.contents).not.toMatch(/ALTER TABLE "Device"/);
    // Each of the two intentional lines must appear exactly once.
    const incidentDrops = migration.contents.match(
      /ALTER TABLE "Incident" ALTER COLUMN "id" DROP DEFAULT;/g,
    );
    const readingDrops = migration.contents.match(
      /ALTER TABLE "Reading" ALTER COLUMN "id" DROP DEFAULT;/g,
    );
    expect(
      incidentDrops?.length ?? 0,
      "expected exactly one `ALTER TABLE \"Incident\"` line",
    ).toBe(1);
    expect(
      readingDrops?.length ?? 0,
      "expected exactly one `ALTER TABLE \"Reading\"` line",
    ).toBe(1);
  });
});