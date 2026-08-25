---
title: 'Story 3.1 — Rules Table + Prisma Schema'
type: 'feature'
created: '2026-08-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a78e30b387a59f470847e1ad539c4c878ba5770f' # docs: deployment plan tracking deferred until ship
context:
  - _bmad-output/implementation-artifacts/epic-3-context.md
  - _bmad-output/planning-artifacts/epics.md#story-31-rules-table--prisma-schema
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The rules engine (Story 3.2) and the default-thresholds seed (Story 3.3) need a typed, queryable `Rule` source of truth; without it the engine can only hold an in-memory list and any rule change made via the future `/admin/thresholds` tab (Story 3.7) is lost on restart.

**Approach:** Add a `Rule` model to `packages/db/prisma/schema.prisma` with the BRD §8.3.1 fields, ship a forward-only migration that creates an empty table on a clean DB, and pin every behavioural guarantee with a vitest source-walk + schema-validation contract so the regression cannot reappear silently.

## Boundaries & Constraints

**Always:**
- Migration is forward-only; new columns are nullable so existing rows survive. New enum types are created before any `CREATE TABLE` that references them.
- The four enum columns (`metric`, `operator`, `severity`, `ruleType`) are Prisma enums, not free strings. Value sets are pinned in `packages/shared/src/rule.ts` (see Code Map) so Story 3.2 / 3.3 / 3.7 share one source of truth.
- Unique constraint on `(deviceId, metric, operator, threshold, version)` per the AC. NULL `deviceId` rows (global rules) coexist because Postgres treats NULLs as distinct in unique constraints by default.
- `deviceId` is `String?` with optional FK to `Device.id`, `onDelete: Cascade`, `onUpdate: Cascade`.
- `createdBy` is `String?` (NOT an FK) — the `User` table does not exist in the schema yet. A later story adds the FK.
- Schema stays under the `binaryTargets = ["native", "debian-openssl-3.0.x"]` generator config already pinned.
- All existing tests across packages keep passing against the regenerated Prisma client.

**Ask First:**
- Adding the `AuditLog` table or an `audit_log` write inside this story. (Default: NO — that work is owned by the stories that reference it; Story 3.1 just adds `createdBy` so a future audit row has an FK target.)

**Never:**
- Do not introduce `Alert`, `IncidentEvent`, or `MetricDefinition` tables — those land in Stories 3.5, 4.2, and the metric-registry story respectively.
- Do not change the existing `Device`, `Reading`, or `Incident` models.
- Do not seed any rules in this story — Story 3.3 owns the seed.

</frozen-after-approval>

## Code Map

- `packages/db/prisma/schema.prisma` -- append four `enum` declarations (`RuleMetric`, `RuleOperator`, `RuleSeverity`, `RuleRuleType`) and a `model Rule { ... }` block at the bottom. Field order in the model matches the AC: `id`, `deviceId`, `metric`, `operator`, `threshold`, `severity`, `ruleType`, `minDurationSeconds`, `hysteresisSeconds`, `version`, `createdBy`, `createdAt`, `updatedAt`, `isActive`. `Rule.deviceId String?` declares the relation side as `device Device? @relation("DeviceRules", fields: [deviceId], references: [id], onDelete: Cascade, onUpdate: Cascade)`. The existing `Device` model MUST also gain `rules Rule[] @relation("DeviceRules")` (added in the same `schema.prisma` edit, following the `readings` / `incidents` naming pattern). Tail the model with `@@unique([deviceId, metric, operator, threshold, version])`. Mirror the cascade-comment style of the existing `Incident` model.
- `packages/db/prisma/migrations/<14-digit-timestamp>_rule_table/migration.sql` -- new forward-only migration. Generate via `pnpm -F @surakkha/db exec prisma migrate dev --name rule_table --create-only`, then commit the generated SQL unmodified. Filename MUST match the pattern `\d{14}_rule_table` (Prisma auto-assigns the timestamp at generate-time; do NOT hard-code `20260825000000`). Layout: `CREATE TYPE` for each of the four enums, then `CREATE TABLE "Rule"` with every column (Prisma emits both), then the `@@unique` index, then the optional `FK` to `Device.id` with `ON DELETE CASCADE`.
- `packages/shared/src/rule.ts` -- new file. Define four `as const` arrays (`RULE_METRICS`, `RULE_OPERATORS`, `RULE_SEVERITIES`, `RULE_RULE_TYPES`) and inferred union types. `RULE_METRICS` = `["ph","tds_ppm","turbidity_ntu","chlorine_ppm","temp_c","water_level_cm"]`. `RULE_OPERATORS` = `["gte","gt","lte","lt","eq"]` (mapped to `>=`, `>`, `<=`, `<`, `==` by Story 3.2). `RULE_SEVERITIES` = `["info","warning","critical"]`. `RULE_RULE_TYPES` = `["instant","rate","absence"]`. Each enum literal matches the Prisma enum name 1:1.
- `packages/shared/src/__tests__/rule.spec.ts` -- new pin. One test per array asserting its literal value set (length + contents). Catches a typo that would silently change wire semantics.
- `packages/shared/src/index.ts` -- add `export * from "./rule.js"` to the barrel.
- `packages/db/__tests__/rule-table.schema.spec.ts` -- new source-walk pin (mirrors the structure of `packages/db/prisma/seed.spec.ts`):
  - Reads `schema.prisma` as text and asserts the `model Rule {` block exists, that every AC field is named inside it, and that the four enum declarations are present at file scope.
  - Asserts `@@unique([deviceId, metric, operator, threshold, version])` is on the `Rule` model.
  - Lists the `migrations/` directory and asserts an entry matching `\d{14}_rule_table` exists (Prisma auto-assigns the timestamp).
- `packages/db/__tests__/rule-table.migration.spec.ts` -- reads the generated `migration.sql` and asserts `CREATE TABLE "Rule"` is present, every column is listed with correct nullability (per the schema), the unique constraint is present, and the FK to `Device.id` is `ON DELETE CASCADE`.
- `packages/db/prisma/seed.ts` -- NO change. Story 3.3 extends it.
- `packages/db/migrations/*` (prior four) -- NO change. Forward-only.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/rule.ts` -- NEW file: define four `as const` arrays + inferred union types. Wires Story 3.2 engine, Story 3.3 seed, Story 3.7 admin tab to one source of truth.
- [ ] `packages/shared/src/__tests__/rule.spec.ts` -- NEW: pin the literal value sets for the four arrays.
- [ ] `packages/shared/src/index.ts` -- add `export * from "./rule.js"` to the barrel.
- [ ] `packages/db/prisma/schema.prisma` -- append four `enum` declarations + `model Rule` block per the AC field list.
- [ ] `packages/db/prisma/migrations/20260825000000_rule_table/migration.sql` -- NEW migration generated by `prisma migrate dev --create-only`, committed unmodified.
- [ ] `packages/db/__tests__/rule-table.schema.spec.ts` -- NEW source-walk pin covering the model block, enum declarations, unique constraint, and migration folder name.
- [ ] `packages/db/__tests__/rule-table.migration.spec.ts` -- NEW source-walk pin covering the generated `migration.sql` (table, columns, unique, FK).
- [ ] `pnpm -F @surakkha/db exec prisma validate` -- expected exit 0.
- [ ] `pnpm -F @surakkha/db exec prisma generate` -- regenerate the client so the new enum types are visible to other packages.
- [ ] Full test matrix: `pnpm -F @surakkha/shared test && pnpm -F @surakkha/db test && pnpm -F @surakkha/api test && pnpm -F @surakkha/web test && pnpm -F @surakkha/simulator test` -- expected: every package green against the regenerated client.

**Acceptance Criteria:**
- Given `packages/db/prisma/schema.prisma`, when a reviewer greps for `model Rule`, then the block is present and contains every AC field in the order listed in Code Map.
- Given the schema, when the reviewer greps for the unique constraint, then `@@unique([deviceId, metric, operator, threshold, version])` is on the `Rule` model.
- Given a clean Postgres DB, when `pnpm -F @surakkha/db exec prisma migrate deploy` runs, then the `Rule` table exists, is empty, and the migration exits 0.
- Given a DB that already has the four prior migrations, when the new migration runs, then prior tables are intact and `Rule` is added without altering existing rows.
- Given `packages/db/__tests__/rule-table.schema.spec.ts`, when someone deletes a column from `Rule` in `schema.prisma`, then the test fails with a clear diff pointing at the missing field.
- Given `packages/db/__tests__/rule-table.schema.spec.ts`, when someone renames or removes the rule_table migration folder, then the migration-folder-name assertion fails.
- Given `packages/db/__tests__/rule-table.migration.spec.ts`, when someone deletes a column from the generated `migration.sql`, then the test fails with a clear diff pointing at the missing column.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. Do not modify or delete existing entries. Empty until the first bad_spec loopback. -->

## Design Notes

**Known inconsistency: `threshold` (DB column) vs `value` (wire field).** The Story 3.1 AC literal in `epics.md` §Story 3.1 line 959 names the column `threshold (float)`. The wire-contract rule shape in `docs/architecture.md` §4.1 names the same field `value`. Story 3.1 honours the AC: the DB column is `threshold`. Story 3.2's engine MUST map DB `threshold` → wire `value` at the engine boundary (and vice versa for read-back). This is a pre-existing AC vs. architecture drift; flagging here so the implementer does NOT silently rename the column to `value` (which would break the AC and any future audit rows keyed off the AC field name). Out of scope for 3.1 to fix the underlying drift.

**`operator` is stored as `gte | gt | lte | lt | eq`** (camel-case TS identifiers) rather than the wire-facing `>=`, `>`, `<=`, `<`, `==` symbols because Prisma enums must be valid identifiers. Story 3.2's engine maps the camel-case token to the JS comparator at evaluation time via a small lookup table; that mapping is owned by Story 3.2, not this story.

**`metric` is frozen at the six v1 keys as a Prisma enum** — adding a new key in v2 requires a Prisma migration that drops + recreates the type. This is intentional: Story 3.3's seed needs these six keys, and Story 3.2's exhaustive switch needs a closed set.

**`createdBy` is intentionally NOT a Prisma relation to `User`** because no `User` table exists yet. When the `User` migration lands in a future story, a follow-up migration adds `references: [id]` on `createdBy`. The current nullable string is forward-compatible.

**Unique constraint scope.** The `@@unique([deviceId, metric, operator, threshold, version])` constraint guarantees no two rows share the same `(device, metric, operator, threshold)` for a given version — `version` is the disambiguator that lets Story 3.7 insert a new `is_active: true` row alongside an `is_active: false` previous version. Concurrency on Story 3.7's edit path (two admins racing on the same rule) is NOT enforced at the DB layer in v1; the read-then-write flow may produce a unique-constraint violation that surfaces as a 409 to the second admin. Story 3.7 may add a partial unique index `WHERE is_active = true` if this becomes a real problem; out of scope for 3.1.

## Verification

**Commands:**
- `pnpm -F @surakkha/shared test` -- expected: existing + new `rule.spec.ts` pass.
- `pnpm -F @surakkha/db exec prisma validate` -- expected: exit 0.
- `pnpm -F @surakkha/db exec prisma generate` -- expected: client regenerates; new enum types visible.
- `pnpm -F @surakkha/db test` -- expected: existing `seed.spec.ts` + new `rule-table.schema.spec.ts` + new `rule-table.migration.spec.ts` pass.
- Full test matrix across api/web/simulator -- expected: green.

**Manual checks (if no CLI):**
- Open the generated `migration.sql` and confirm `CREATE TYPE` lines precede `CREATE TABLE` (Postgres requires type creation before use).

## Suggested Review Order

**Schema (the typed source of truth)**

- Lead with the four Prisma enum blocks: closed v1 value sets that wire-3.2 / seed-3.3 / admin-3.7 all consume.
  [`schema.prisma:131`](../../packages/db/prisma/schema.prisma#L131)

- Then the `model Rule` block itself: 14 AC fields in order, nullable `createdBy` (no FK yet), nullable `deviceId` with cascading FK.
  [`schema.prisma:194`](../../packages/db/prisma/schema.prisma#L194)

- The `Device.rules` back-relation that closes the named-relation contract both ways.
  [`schema.prisma:59`](../../packages/db/prisma/schema.prisma#L59)

- The Prisma generator's `binaryTargets` (Docker Debian + macOS native — do not narrow).
  [`schema.prisma:17`](../../packages/db/prisma/schema.prisma#L17)

**Migration (forward-only DDL)**

- Lead with the migration's `CREATE TYPE` declarations — must precede the table that uses them.
  [`migration.sql:2`](../../packages/db/prisma/migrations/20260825093039_rule_table/migration.sql#L2)

- Then `CREATE TABLE "Rule"` — every AC column with the right nullability.
  [`migration.sql:20`](../../packages/db/prisma/migrations/20260825093039_rule_table/migration.sql#L20)

- The unique index on `(deviceId, metric, operator, threshold, version)` — note `isActive` is intentionally excluded.
  [`migration.sql:40`](../../packages/db/prisma/migrations/20260825093039_rule_table/migration.sql#L40)

- The FK constraint with `ON DELETE CASCADE` — keeps a removed Device from leaving orphan Rule rows.
  [`migration.sql:43`](../../packages/db/prisma/migrations/20260825093039_rule_table/migration.sql#L43)

- The two intentional `ALTER TABLE "Incident"/"Reading" ALTER COLUMN "id" DROP DEFAULT;` lines — Prisma re-evaluated implicit defaults when adding enums.
  [`migration.sql:14`](../../packages/db/prisma/migrations/20260825093039_rule_table/migration.sql#L14)

**Shared package (one source of truth across packages)**

- Lead with the four `as const` arrays — the closed v1 value sets shared with the Prisma enums.
  [`rule.ts:31`](../../packages/shared/src/rule.ts#L31)

- The inferred union types derived from the arrays — engine / seed / admin switch exhaustively on these.
  [`rule.ts:39`](../../packages/shared/src/rule.ts#L39)

- The barrel export wiring `@surakkha/shared/rule` for downstream consumers.
  [`index.ts`](../../packages/shared/src/index.ts)

**Tests (contract pins)**

- The schema source-walk pin — AC field order, duplicates, enum literals, relation name, binaryTargets.
  [`rule-table.schema.spec.ts`](../../packages/db/__tests__/rule-table.schema.spec.ts)

- The migration source-walk pin — column nullability, FK cascade, unique index (no `isActive`), DROP DEFAULT lines, no other ALTER TABLE.
  [`rule-table.migration.spec.ts`](../../packages/db/__tests__/rule-table.migration.spec.ts)

- The shared enum-value pin — 16 tests catching a typo or reorder in the four arrays.
  [`rule.spec.ts`](../../packages/shared/src/__tests__/rule.spec.ts)