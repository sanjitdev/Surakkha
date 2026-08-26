/**
 * Source-walk pin for the `Rule` Prisma model (Story 3.1).
 *
 * Reads `packages/db/prisma/schema.prisma` as text and asserts:
 *   - the `model Rule {` block exists at file scope;
 *   - every AC field is named inside it (in the documented order);
 *   - the four enum declarations (`RuleMetric`, `RuleOperator`,
 *     `RuleSeverity`, `RuleRuleType`) are present at file scope;
 *   - the unique constraint
 *     `@@unique([deviceId, metric, operator, threshold, version])`
 *     is on the `Rule` model;
 *   - the `Device` model gains `rules Rule[] @relation("DeviceRules")`;
 *   - the migrations directory contains an entry matching Prisma's
 *     auto-assigned `\d{14}_rule_table` pattern.
 *
 * If a future change deletes a column, renames an enum literal, drops
 * the unique constraint, or moves the migration folder, this file
 * fails loudly so the regression cannot reappear silently.
 *
 * Mirrors the structure of `packages/db/prisma/seed.spec.ts`
 * (text reads + regex matching).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCHEMA_PATH = join("prisma", "schema.prisma");
const MIGRATIONS_DIR = join("prisma", "migrations");

const AC_FIELDS_IN_ORDER = [
  "id",
  "deviceId",
  "metric",
  "operator",
  "threshold",
  "severity",
  "ruleType",
  "minDurationSeconds",
  "hysteresisSeconds",
  "version",
  "createdBy",
  "createdAt",
  "updatedAt",
  "isActive",
] as const;

const REQUIRED_ENUMS = [
  "enum RuleMetric",
  "enum RuleOperator",
  "enum RuleSeverity",
  "enum RuleRuleType",
] as const;

const readSchema = (): string => readFileSync(SCHEMA_PATH, "utf8");

/**
 * Extract the body of the `model Rule { ... }` block as a substring so
 * the AC field + unique-constraint assertions operate on the model
 * scope, not the entire file (which would let an unrelated `model
 * Foo { isActive }` accidentally satisfy the assertion).
 */
const extractRuleBlock = (source: string): string => {
  const startMarker = "model Rule {";
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`expected \`${SCHEMA_PATH}\` to contain \`${startMarker}\``);
  }
  const blockStart = start + startMarker.length;
  // A Prisma model body closes at the first top-level `}` — we walk
  // forward and balance braces from the first `{` after the marker.
  let depth = 1;
  let i = blockStart;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  if (depth !== 0) {
    throw new Error(`unterminated \`${startMarker}\` block in \`${SCHEMA_PATH}\``);
  }
  return source.slice(start, i);
};

describe("Rule model — schema.prisma source-walk pin (Story 3.1)", () => {
  it("declares a `model Rule { ... }` block", () => {
    const source = readSchema();
    expect(source).toMatch(/^model Rule \{/m);
  });

  it("declares every AC field inside the Rule model block", () => {
    const block = extractRuleBlock(readSchema());
    for (const field of AC_FIELDS_IN_ORDER) {
      // Match `fieldName` followed by optional whitespace + a Prisma
      // type marker (`?`, `:`, `@`, `\t`). This rejects e.g. a
      // comment-only reference and only counts true column
      // declarations.
      const pattern = new RegExp(`^\\s+${field}\\b`, "m");
      expect(pattern.test(block), `Rule model is missing AC field \`${field}\``).toBe(true);
    }
  });

  it("lists the AC fields in the documented order (regression pin)", () => {
    // Order matters per the AC: `id`, `deviceId`, `metric`, `operator`,
    // `threshold`, `severity`, `ruleType`, `minDurationSeconds`,
    // `hysteresisSeconds`, `version`, `createdBy`, `createdAt`,
    // `updatedAt`, `isActive`. If a future change reorders them, the
    // engine in Story 3.2 might silently mis-read column positions.
    //
    // Also rejects duplicate AC field declarations: each AC field
    // must appear exactly once as a column line in the model block.
    // A duplicate column declaration (e.g. an accidentally-pasted
    // `isActive Boolean @default(true)` line) would silently produce
    // a Prisma error at generate-time but the source-walk test must
    // catch it earlier.
    const block = extractRuleBlock(readSchema());
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    let lastIndex = -1;
    for (const field of AC_FIELDS_IN_ORDER) {
      const matchingIndices = lines
        .map((line, idx) => (line.startsWith(`${field} `) ? idx : -1))
        .filter((idx) => idx >= 0);
      expect(
        matchingIndices.length,
        `AC field \`${field}\` must be declared exactly once in the Rule model block; saw ${matchingIndices.length}`,
      ).toBe(1);
      const idx = matchingIndices[0] ?? -1;
      expect(idx, `expected \`${field}\` to appear in the Rule model block`).toBeGreaterThan(
        lastIndex,
      );
      lastIndex = idx;
    }
  });

  it("declares `createdBy` as `String?` (not a relation — no User table yet)", () => {
    const block = extractRuleBlock(readSchema());
    // The column must be nullable. The intent is `String?` (no `@relation`).
    // Allow leading whitespace and a `@map(...)` clause in the future
    // by only checking for the `String?` token after the field name.
    const match = block.match(/^\s+createdBy\s+([^\n]+)$/m);
    expect(match, "Rule model is missing the `createdBy` column").not.toBeNull();
    expect(match?.[1] ?? "", "`createdBy` must be typed `String?` (nullable, not an FK)").toMatch(
      /^String\?(\s|$)/,
    );
    expect(
      match?.[1] ?? "",
      "`createdBy` must NOT carry a `@relation` (no User table yet)",
    ).not.toMatch(/@relation/);
  });

  it("has `@@unique([deviceId, metric, operator, threshold, version])` on the Rule model", () => {
    const block = extractRuleBlock(readSchema());
    expect(block).toMatch(/@@unique\(\[deviceId,\s*metric,\s*operator,\s*threshold,\s*version\]\)/);
  });

  it("does NOT introduce IncidentEvent, MetricDefinition, or AuditLog tables", () => {
    // Per the spec "Never" list: those models belong to other stories.
    // Catching a stray declaration here keeps the story boundary clean.
    // Note: the `Alert` + `RuleDebounceState` models belong to Story
    // 3.4 — see `alert-debounce.schema.spec.ts` for those pins.
    const source = readSchema();
    expect(source).not.toMatch(/^model IncidentEvent\b/m);
    expect(source).not.toMatch(/^model MetricDefinition\b/m);
    expect(source).not.toMatch(/^model AuditLog\b/m);
  });

  it.each(REQUIRED_ENUMS)(
    "declares `%s` at file scope (Prisma enum literal pin)",
    (declaration) => {
      const source = readSchema();
      expect(source).toMatch(new RegExp(`^${declaration}\\s*\\{`, "m"));
    },
  );

  it('Device model gains `rules Rule[] @relation("DeviceRules")`', () => {
    const source = readSchema();
    expect(source).toMatch(/rules\s+Rule\[\]\s+@relation\(\s*["']DeviceRules["']\s*\)/);
  });

  it("Device model retains its existing relations (readings / incidents)", () => {
    // Defensive: this story adds `rules` to the Device model but must
    // NOT delete the prior `readings` / `incidents` relations.
    const source = readSchema();
    expect(source).toMatch(/readings\s+Reading\[\]\s+@relation\(\s*["']DeviceReadings["']\s*\)/);
    expect(source).toMatch(/incidents\s+Incident\[\]\s+@relation\(\s*["']DeviceIncidents["']\s*\)/);
  });

  it('Rule model declares `device Device? @relation("DeviceRules", ...)` matching Device.rules', () => {
    // Prisma requires both sides of a named relation to agree. The
    // Device side is pinned by the "Device model gains `rules ...`"
    // test above; this pins the Rule side so a regression that
    // renames the relation on one side only (or flips the optional
    // marker `?`) is loud before `prisma generate` errors out.
    const block = extractRuleBlock(readSchema());
    expect(block).toMatch(/device\s+Device\?\s+@relation\(\s*["']DeviceRules["']/);
  });

  it("schema generator pins binaryTargets for native + Debian OpenSSL 3", () => {
    // The Prisma generator's `binaryTargets` controls which engine
    // binaries get produced. The runtime containers in this repo are
    // Debian-based and need `debian-openssl-3.0.x`; macOS dev machines
    // need `native`. Dropping either silently breaks one of those
    // platforms without a runtime error visible to the other.
    const source = readSchema();
    expect(source).toMatch(/binaryTargets\s*=\s*\[\s*"native"\s*,\s*"debian-openssl-3\.0\.x"\s*\]/);
  });
});

describe("Rule migration folder — Prisma timestamp pin (Story 3.1)", () => {
  it("contains an entry matching Prisma's auto-assigned \\d{14}_rule_table pattern", () => {
    const entries = readdirSync(MIGRATIONS_DIR);
    const matches = entries.filter((entry) => /^\d{14}_rule_table$/.test(entry));
    expect(
      matches,
      `expected migrations directory to contain a \`\\d{14}_rule_table\` folder; saw [${entries.join(", ")}]`,
    ).toHaveLength(1);
  });
});

describe("Enum literal set consistency between schema.prisma and packages/shared/src/rule.ts (Story 3.1)", () => {
  /**
   * The schema doc-comment at `schema.prisma:122-127` promises that
   * each Prisma enum literal matches the corresponding `RULE_*`
   * array in `packages/shared/src/rule.ts` 1:1, and that the
   * source-walk pin catches drift. But the existing pin only
   * asserts each enum *name* is present — it doesn't compare the
   * literal sets. This describe block delivers the promised
   * drift-detection: if a future contributor adds `orp_mv` to
   * `RuleMetric` in the schema without updating `RULE_METRICS`, or
   * reorders `RULE_OPERATORS` without updating `RuleOperator`, the
   * affected `it(...)` here fails loudly.
   *
   * Read the path from the db package's cwd (which IS `packages/db`
   * when `pnpm -F @surakkha/db test` runs). The shared package sits
   * one level up at `../shared/src/rule.ts`.
   */
  const SHARED_RULE_PATH = join("..", "shared", "src", "rule.ts");

  const readSharedRule = (): string => {
    try {
      return readFileSync(SHARED_RULE_PATH, "utf8");
    } catch (err) {
      throw new Error(
        `expected shared rule module at \`${SHARED_RULE_PATH}\`; saw ${(err as Error).message}`,
      );
    }
  };

  /**
   * Extract the literal set declared inside a Prisma enum block:
   *   `enum RuleMetric { ph tds_ppm ... }`
   * The body is whitespace/comma/newline separated identifiers.
   */
  const extractSchemaEnumLiterals = (source: string, enumName: string): string[] => {
    const re = new RegExp(`enum\\s+${enumName}\\s*\\{([^}]*)\\}`, "m");
    const match = source.match(re);
    if (!match) {
      throw new Error(`expected schema.prisma to declare \`enum ${enumName} { ... }\``);
    }
    return match[1]
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  /**
   * Extract the literal set from a shared `RULE_*` `as const` array.
   * Captures everything between `[` and `]` and parses the quoted
   * strings, tolerating newlines and trailing commas.
   */
  const extractSharedArrayLiterals = (source: string, arrayName: string): string[] => {
    const re = new RegExp(`${arrayName}\\s*=\\s*\\[([^\\]]*)\\]`, "m");
    const match = source.match(re);
    if (!match) {
      throw new Error(`expected packages/shared/src/rule.ts to declare \`${arrayName} = [ ... ]\``);
    }
    const literals: string[] = [];
    const literalRe = /["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = literalRe.exec(match[1])) !== null) {
      literals.push(m[1]);
    }
    return literals;
  };

  /**
   * Compare two literal sets as ordered deep-equal arrays. The order
   * matters because both Prisma enum bodies and the shared
   * `as const` arrays are read sequentially — a reordering should
   * fail (the engine may depend on declaration order in Story 3.2).
   */
  const expectLiteralSetsEqual = (enumName: string, arrayName: string): void => {
    const schemaSource = readSchema();
    const sharedSource = readSharedRule();
    const schemaLiterals = extractSchemaEnumLiterals(schemaSource, enumName);
    const sharedLiterals = extractSharedArrayLiterals(sharedSource, arrayName);
    expect(
      schemaLiterals,
      `\`enum ${enumName}\` literals must equal \`${arrayName}\` 1:1 (schema order matters)`,
    ).toEqual(sharedLiterals);
  };

  it("RuleMetric literals in schema.prisma match RULE_METRICS in packages/shared/src/rule.ts", () => {
    expectLiteralSetsEqual("RuleMetric", "RULE_METRICS");
  });

  it("RuleOperator literals in schema.prisma match RULE_OPERATORS in packages/shared/src/rule.ts", () => {
    expectLiteralSetsEqual("RuleOperator", "RULE_OPERATORS");
  });

  it("RuleSeverity literals in schema.prisma match RULE_SEVERITIES in packages/shared/src/rule.ts", () => {
    expectLiteralSetsEqual("RuleSeverity", "RULE_SEVERITIES");
  });

  // Prisma enum is `RuleRuleType` (singular); shared array is
  // `RULE_RULE_TYPES` (plural). The mapping is named explicitly so
  // a future contributor renaming either side sees a clear error.
  it("RuleRuleType literals in schema.prisma match RULE_RULE_TYPES in packages/shared/src/rule.ts", () => {
    expectLiteralSetsEqual("RuleRuleType", "RULE_RULE_TYPES");
  });
});
