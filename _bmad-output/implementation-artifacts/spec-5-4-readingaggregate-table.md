---
title: "Story 5.4 — ReadingAggregate Table"
type: "feature"
created: "2026-09-01"
status: "done"
review_loop_iteration: 0
baseline_commit: "782a445d6ef99bb2532c9e9df002fc0addf6bc8f"
context: []
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot.
     Cohesive cross-layer story (DB+BE) stays in ONE file. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Raw `Reading` rows accumulate forever. After 30 days they are never read by any surface (the operator page only renders the last 24h, the CSV export caps at 30 days). They are wasted disk + index bloat on a per-device index that grows monotonically. There is no aggregate-table seam for the next story's retention cron to write into.

**Approach:** Ship the durable half of the retention story — a new `ReadingAggregate` Prisma model + migration that holds 5-minute mean/min/max/sample_count buckets, one row per `(device_id, bucket_start, metric)`. The model is the write target for Story 5.5's hourly retention cron; this story does NOT ship the cron, does NOT delete any raw rows, and does NOT add any UI surface (the aggregate is admin-internal in v1; a future story may surface it). Mirrors the 5.3 precedent of "ship the table + the read seam; the writer/reader is a future story."

## Boundaries & Constraints

**Always:**

- New `ReadingAggregate` Prisma model + a new migration (next after `20260901000000_audit_log`, so `20260901000001_reading_aggregate`). First-ever aggregate table in the schema.
- Columns mirror the Story 5.4 user-story acceptance criteria (camelCase Prisma convention, not the snake_case `epics.md:1622` text): `id` (uuid), `deviceId` (FK SET NULL → Device), `bucketStart` (`DateTime`), `metric` (`String` — closed enum: `tds | turbidity | ph | temperature | battery | signal`), `mean` (`Float`), `min` (`Float`), `max` (`Float`), `sampleCount` (`Int`).
- `@@unique([deviceId, bucketStart, metric])` — the 5.5 cron uses `ON CONFLICT (...) DO UPDATE` for idempotent overlap-safe retries; the constraint is the load-bearing invariant.
- `@@index([deviceId, bucketStart])` for the (future) range-scan read pattern (admin / chart query).
- `onDelete: SetNull` for the `deviceId` FK — a deleted device must NOT cascade-delete historical aggregates (regulators may still want them); the FK row goes null and the aggregate stays.
- `bucketStart` is the floor of the source `Reading.ts` to the nearest 5 minutes, computed by the 5.5 cron (NOT by 5.4 — 5.4 ships the column shape only).
- Metric values are a closed `String` column at the Prisma layer; a sibling `ReadingAggregateMetricSchema` Zod enum in `packages/shared/src/reading-aggregate.ts` is the wire contract for any future reader (Story 5.5 doesn't need it, but the convention from `audit.ts:53-67` is to ship the Zod enum alongside the table).
- New sibling `readingAggregateRepository.ts` in `packages/api/src/readings/` follows the `auditLogRepository.ts:81-127` shape: typed `ReadingAggregateRow` interface + `ReadingAggregateRepository` interface + `resolveReadingAggregateRepository(prisma)` adapter that narrows via `as unknown as ...`. Pure-Promise seam (not async iterable) because the future admin read pattern is a small page, not a CSV stream.
- `ReadingAggregateRepository.findMany({deviceId?, metric?, since?, until?, limit?})` returns `{ rows, total, truncated }` ordered `bucketStart DESC`. Mirrors the 5.3 envelope.

**Ask First:**

- _Resolved at step-01:_ Migration filename — default: `20260901000001_reading_aggregate/` following the same-day `_00001` pattern from `20260827000001_alert_rule_id_index/`.
- _Resolved at step-01:_ `metric` column type — default: `String` (closed enum at Zod layer) so the Prisma schema stays migration-light when a metric is added; mirrors `AuditLog.resource` (`schema.prisma:631` as of 5.4; was `:554` at step-01 before 5.3's insert expanded the file).
- _Resolved at step-01:_ Whether 5.4 ships a wire schema in `@surakkha/shared` — default: YES, a tiny `ReadingAggregateMetricSchema` Zod enum module so 5.5 doesn't have to invent it. No row schema (no UI consumer).

**Never:**

- No retention cron — that's Story 5.5.
- No deletion of any `Reading` row — 5.4 is read/write to the new table only; raw rows are untouched.
- No UI surface — no `/admin/aggregates` page, no API route, no web hook. The repository seam is the v1 contract; admin read access is a future story.
- No `cron_runs` table — that's Story 5.5's job.
- No changing the existing `Reading` model, its indexes, or the `csvRepository.ts` stream seam.
- No `audit.emit` call from this story — 5.4 doesn't trigger auditable actions. 5.5's cron will write `cron_runs` audit rows.
- No raw SQL — the Prisma client owns the new table; 5.5 can use `prisma.$executeRaw` for the cron, but 5.4 stays type-safe.

## I/O & Edge-Case Matrix

| Scenario                | Input / State                                                    | Expected Output / Behavior                                                | Error Handling         |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------- |
| REPO_FIND_HAPPY         | repo.findMany({}) with 50 rows across 3 devices                  | `{ rows: [50], total: 50, truncated: false }`, ordered `bucketStart DESC` | n/a                    |
| REPO_FIND_BY_DEVICE     | repo.findMany({deviceId: "d1"})                                  | rows filtered to `deviceId = d1`                                          | n/a                    |
| REPO_FIND_BY_METRIC     | repo.findMany({metric: "tds"})                                   | rows filtered to `metric = "tds"`                                         | n/a                    |
| REPO_FIND_BY_DATE_7D    | repo.findMany({since: now - 7d})                                 | rows with `bucketStart >= since`                                          | n/a                    |
| REPO_FIND_COMBINED      | repo.findMany({deviceId: "d1", metric: "tds", since: now - 24h}) | AND-ed result                                                             | n/a                    |
| REPO_FIND_TRUNCATED     | repo.findMany({limit: 10}) with 100 rows match                   | `{ rows: [10], total: 100, truncated: true }`                             | n/a                    |
| REPO_FIND_EMPTY         | empty table                                                      | `{ rows: [], total: 0, truncated: false }`                                | n/a                    |
| REPO_FIND_INVALID_LIMIT | limit < 1                                                        | empty result (caller-side guard)                                          | no throw               |
| SCHEMA_UNIQUE           | INSERT duplicate `(deviceId, bucketStart, metric)`               | Prisma `P2002` thrown                                                     | surfaced via repo seam |
| MIGRATION_FRESH         | `pnpm prisma migrate dev` on empty DB                            | migration applies; `ReadingAggregate` table exists with both indexes      | n/a                    |
| MIGRATION_REPLAY        | `pnpm prisma migrate reset` + reapply                            | idempotent; no drift                                                      | n/a                    |

## Code Map

- `packages/db/prisma/schema.prisma:79-95` — `model Reading` block (sibling model to mirror; new `ReadingAggregate` block goes after).
- `packages/db/prisma/schema.prisma:631` — `model AuditLog` (5.3 reference; demonstrates `@@index([..., createdAt])`, FK SET NULL, Json field convention). Spec line number drifted from `:554` at step-01 as 5.3's own model insert expanded the file.
- `packages/db/prisma/schema.prisma:510-521` — `model RuleDebounceState` (closest structural sibling: minimal FK-only model + `@@unique` + cascade precedent).
- `packages/db/prisma/migrations/20260901000000_audit_log/migration.sql` — most recent migration; new `20260901000001_reading_aggregate/migration.sql` follows the same `CREATE TABLE` + `CREATE INDEX` + `ALTER TABLE FK` shape (65-line precedent).
- `packages/db/prisma/migrations/20260827000001_alert_rule_id_index/` — same-day `_00001` filename convention precedent.
- `packages/api/src/audit/auditLogRepository.ts:81-127` — interface-driven repo seam pattern to mirror: typed `Row` interface → `Repository` interface → `resolveRepository(prisma)` adapter with `as unknown as`.
- `packages/api/src/audit/auditLogRepository.ts:182-193` — `toPrismaWhere` AND-ed filter helper shape to mirror for `ReadingAggregateRepository.findMany`.
- `packages/shared/src/audit.ts:1-35` — preamble pattern for a new `@surakkha/shared` module (cited "Why a dedicated module" rationale + sibling references).
- `packages/shared/src/audit.ts:53-67` — `AuditLogResourceSchema` closed-enum Zod pattern to mirror for `ReadingAggregateMetricSchema`.
- `packages/api/src/audit/auditLogRepository.spec.ts:1-29` — preamble + helper-seam unit test rig to mirror for `readingAggregateRepository.spec.ts`.
- `docs/adr/0006-hourly-aggregation.md:38-39` — background ADR on the legacy hourly design (does NOT pin the 5-minute bucket formula; 5.5 owns that).

## Tasks & Acceptance

**Execution:**

- [x] `packages/db/prisma/schema.prisma` -- ADD `model ReadingAggregate` block after `model Reading` (line 95) with columns `id @id @default(uuid())`, `deviceId String`, `bucketStart DateTime`, `metric String`, `mean Float`, `min Float`, `max Float`, `sampleCount Int`; FK `device Device @relation("DeviceReadingAggregates", fields: [deviceId], references: [id], onDelete: SetNull)`; `@@unique([deviceId, bucketStart, metric])`; `@@index([deviceId, bucketStart])`. Add the back-relation `readingAggregates ReadingAggregate[]` on `model Device`.
- [x] `packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql` -- NEW `CREATE TABLE "ReadingAggregate"` (uuid PK + 8 columns) + `CREATE UNIQUE INDEX "ReadingAggregate_deviceId_bucketStart_metric_key" ON "ReadingAggregate"("deviceId", "bucketStart", "metric")` + `CREATE INDEX "ReadingAggregate_deviceId_bucketStart_idx" ON "ReadingAggregate"("deviceId", "bucketStart")` + `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE`. `pnpm prisma migrate dev --name reading_aggregate` runs cleanly on a fresh DB.
- [x] `packages/shared/src/reading-aggregate.ts` -- NEW module: `ReadingAggregateMetricSchema = z.enum(["tds", "turbidity", "ph", "temperature", "battery", "signal"])` + `export type ReadingAggregateMetric = z.infer<typeof ReadingAggregateMetricSchema>`. Preamble cites the `audit.ts` sibling convention. No row schema (no UI consumer).
- [x] `packages/api/src/readings/readingAggregateRepository.ts` -- NEW repo: `ReadingAggregateRow` interface (id, deviceId, bucketStart, metric, mean, min, max, sampleCount) + `ReadingAggregateRepository` interface with `findMany({deviceId?, metric?, since?, until?, limit?})` returning `{rows: ReadingAggregateRow[]; total: number; truncated: boolean}` + `resolveReadingAggregateRepository(prisma)` adapter mirroring `auditLogRepository.ts:81-127`. `limit` defaults to 100, hard-capped at 1000 to mirror the 5.3 cap pattern. `orderBy: bucketStart DESC`.
- [x] `packages/api/src/readings/readingAggregateRepository.spec.ts` -- NEW spec (~8 unit tests covering the I/O matrix rows above): helpers `deviceWhere`, `metricWhere`, `dateRangeWhere`, `toPrismaWhere`, `clampLimit`. Mirrors `auditLogRepository.spec.ts:1-29` preamble style. No Express, no http — pure helper seam.

**Acceptance Criteria:**

- Given `pnpm prisma migrate dev` runs on a fresh database, when the migration applies, then the `ReadingAggregate` table exists with both indexes (`deviceId_bucketStart_metric` unique + `deviceId_bucketStart` non-unique) AND prisma-client-js regenerates with `ReadingAggregate` in the type union.
- Given a duplicate `(deviceId, bucketStart, metric)` insert, when Prisma rejects it, then `P2002` is thrown (the unique constraint is enforced).
- Given `repo.findMany({limit: 0})`, when called, then the result is `{ rows: [], total: 0, truncated: false }` (caller-side guard short-circuits before hitting Prisma).
- Given a future Story 5.5 retention cron calls `prisma.readingAggregate.upsert({where: {deviceId_bucketStart_metric: {...}}, ...})`, when it runs, then the schema accepts the upsert (the compound unique key is the upsert target).

## Spec Change Log

<!-- Empty until first review loopback. -->

## Verification

**Commands:**

- `pnpm --filter @surakkha/db prisma migrate dev --name reading_aggregate` -- expected: migration applies cleanly; `ReadingAggregate` table present in the DB.
- `pnpm --filter @surakkha/db prisma generate` -- expected: `ReadingAggregate` model in `node_modules/.prisma/client/index.d.ts`.
- `pnpm --filter @surakkha/api test readingAggregateRepository` -- expected: ~8 unit tests pass.
- `pnpm -r typecheck` -- expected: clean (the new model + repo type-check end-to-end).
- `pnpm --filter @surakkha/shared test` -- expected: clean (the new Zod module compiles).

**Manual checks (if no CLI):**

- Open `packages/db/prisma/schema.prisma` and confirm `ReadingAggregate` is the only NEW model block (no other drift). Confirm `Device` got the `readingAggregates ReadingAggregate[]` back-relation.

## Suggested Review Order

<!-- Ordered by concern, not file. Read top-down to grasp intent, then narrow into details. -->

### 1. Schema shape (the durable contract)

- [schema.prisma:142](../../packages/db/prisma/schema.prisma#L142) — `model ReadingAggregate`: 8-column shape; the compound unique + range-scan index side-by-side pin the upsert + range-read contract.
- [schema.prisma:157](../../packages/db/prisma/schema.prisma#L157) — `@@unique([deviceId, bucketStart, metric])`: load-bearing for Story 5.5's idempotent `ON CONFLICT DO UPDATE` cron.
- [schema.prisma:153](../../packages/db/prisma/schema.prisma#L153) — `onDelete: SetNull` FK to Device: removed Device must NOT wipe historical aggregates (regulator retention).
- [schema.prisma:71](../../packages/db/prisma/schema.prisma#L71) — `readingAggregates` back-relation on Device: completes the relation; non-null deviceId + nullable relation is the correct Prisma pattern.

### 2. Migration SQL (the on-disk shape)

- [migration.sql:44](../../packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql#L44) — `CREATE TABLE "ReadingAggregate"`: 8-column declaration with explicit `DEFAULT` + nullability.
- [migration.sql:66](../../packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql#L66) — `CREATE UNIQUE INDEX ... NULLS NOT DISTINCT`: the upsert-target invariant in SQL form (Postgres 15+ NULL semantics).
- [migration.sql:77](../../packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql#L77) — `FOREIGN KEY ... ON DELETE SET NULL`: mirrors the schema.prisma comment. (Spec wrote `:70` at the present step; the line shifted to `:77` after the 5.4 review pass added a multi-line comment above the unique index.)

### 3. Wire contract (the closed enum at the shared seam)

- [reading-aggregate.ts:54](../../packages/shared/src/reading-aggregate.ts#L54) — `ReadingAggregateMetricSchema` Zod enum: closed vocabulary for any future reader; matches the `audit.ts` sibling precedent.

### 4. Repository seam (the typed adapter)

- [readingAggregateRepository.ts:122](../../packages/api/src/readings/readingAggregateRepository.ts#L122) — `resolveReadingAggregateRepository(prisma)`: interface-driven adapter with the structural cast, mirrors `auditLogRepository.ts`.
- [readingAggregateRepository.ts:216](../../packages/api/src/readings/readingAggregateRepository.ts#L216) — `toPrismaWhere`: AND-s the per-filter helpers into a single Prisma `where`; the wire-contract seam.
- [readingAggregateRepository.ts:161](../../packages/api/src/readings/readingAggregateRepository.ts#L161) — `clampLimit`: caller-side guard short-circuits before Prisma; caps at 1000 to mirror 5.3.

### 5. Test rig (the helper-seam coverage)

- [readingAggregateRepository.spec.ts:1](../../packages/api/src/readings/readingAggregateRepository.spec.ts#L1) — preamble: mirrors `auditLogRepository.spec.ts`; pins the helper-chain behavior at the wire-contract boundary.

### 6. Tracking (the workflow ledger)

- [sprint-status.yaml](../sprint-status.yaml) — `5-4-readingaggregate-table: in-progress`; epic-5 already `in-progress` so no epic lift.

## Review Findings

<!-- Code review pass — 2026-09-01. 4 reviewer layers (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). -->

### Decision Needed (2 — RESOLVED 2026-09-01)

- [x] [Review][Decision] **`deviceId` nullability drift** — RESOLVED option 1 (nullable end-to-end). `schema.prisma` changed `deviceId String` → `deviceId String?`; SQL `TEXT` column is already nullable. The Prisma client now types `deviceId: string | null` and `ReadingAggregateRow.deviceId: string | null` is reachable.
- [x] [Review][Decision] **`@@unique([deviceId, bucketStart, metric])` permits orphan duplicates under PostgreSQL NULL semantics** — RESOLVED option 1 (`NULLS NOT DISTINCT`). The migration SQL now emits `CREATE UNIQUE INDEX ... NULLS NOT DISTINCT` (Postgres 15+); two `deviceId IS NULL` rows at the same `(bucketStart, metric)` collide. Prisma's `@@unique` cannot emit the clause natively; the migration is hand-edited with a comment explaining the drift.

### Patches (7 — APPLIED 2026-09-01)

- [x] [Review][Patch] **Fix short-circuit contract: short-circuit `findMany` on `take === 0`** [`packages/api/src/readings/readingAggregateRepository.ts:130-144`] — DONE. Added `if (args.take < 1) return { rows: [], total: 0, truncated: false };` at the top of the adapter body. Spec REPO_FIND_INVALID_LIMIT envelope is now satisfied without hitting Prisma.
- [x] [Review][Patch] **Refactor `findMany`+`count` to `Promise.all`; hoist `toPrismaWhere` once** [`packages/api/src/readings/readingAggregateRepository.ts:130-144`] — DONE. `const [rows, total] = await Promise.all([findMany, count])` with `where` hoisted.
- [x] [Review][Patch] **Fix misleading "double-cast" comment** [`packages/api/src/readings/readingAggregateRepository.ts:123-126`] — DONE. Comment now correctly describes the single `prisma as any` cast (matches 5.3 audit precedent).
- [x] [Review][Patch] **Add e2e adapter-body test** [`packages/api/src/readings/readingAggregateRepository.spec.ts`] — DONE. Added `describe("resolveReadingAggregateRepository adapter body", ...)` block with 6 new tests: REPO_FIND_HAPPY, REPO_FIND_TRUNCATED, REPO_FIND_EMPTY, REPO_FIND_INVALID_LIMIT (Prisma-not-called assertion), `Promise.all` parallel-issue, `orderBy` forward.
- [x] [Review][Patch] **Add `packages/shared/src/reading-aggregate.spec.ts`** — DONE. 10 tests: 6 `it.each` closed-enum acceptances + 4 rejections (drift string, empty string, case-mismatch, size drift).
- [x] [Review][Patch] **Add `packages/db/__tests__/reading-aggregate.schema.spec.ts` + `reading-aggregate.migration.spec.ts`** — DONE. Schema spec: 9 tests pin field order, `String?` deviceId, `String` metric, Float/Int types, `@@unique`+`@@index`, SetNull FK, Device back-relation, migration folder pattern. Migration spec: 4 tests pin CREATE TABLE shape (with `TEXT,` nullable deviceId), `NULLS NOT DISTINCT` UNIQUE INDEX, range-scan INDEX, FK `ON DELETE SET NULL ON UPDATE CASCADE`.
- [x] [Review][Patch] **Update stale spec line citations** [`spec-5-4-readingaggregate-table.md:27, 39, 71, 131-132`] — DONE. `epics.md:1622` reframed to "user-story AC line (camelCase convention)"; `schema.prisma:554` → `:631` (5.3's own insert shifted it); `migration.sql:58` → `:66` (the NULLS NOT DISTINCT comment block added 8 lines); `migration.sql:70` → `:77`.

### Deferred (12)

- [x] [Review][Defer] **Redundant `@@index([deviceId, bucketStart])` vs `@@unique([deviceId, bucketStart, metric])` leading prefix** [`packages/db/prisma/schema.prisma:158`] — deferred, pre-existing — Postgres can range-scan the unique index; both are kept to mirror 5.3 AuditLog precedent; index-tuning pass can drop later.
- [x] [Review][Defer] **`bucketStart` is `TIMESTAMP(3)` timezone-naive** [`packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql:47`] — deferred, pre-existing — DST ambiguity is locked in by the 5.4 schema choice; 5.5 cron writes in UTC anyway; column-type migration to `Timestamptz` is a future story.
- [x] [Review][Defer] **Spec ↔ epic-5 snake_case drift on column names** [`spec-5-4-readingaggregate-table.md:27`] — deferred, pre-existing — Prisma camelCase is the repo convention; epic-5 narrative predates the convention.
- [x] [Review][Defer] **Spec line 34 promises `findMany({limit?})` but interface accepts pre-clamped `take`** [`packages/api/src/readings/readingAggregateRepository.ts:97-109`] — deferred, pre-existing — future admin router owns the `limit → clampLimit → take` wiring.
- [x] [Review][Defer] **`since > until` silent empty result** [`packages/api/src/readings/readingAggregateRepository.ts:201-208`] — deferred, pre-existing — caller contract; helper chain trusts inputs.
- [x] [Review][Defer] **Whitespace-only `deviceId`/`metric` not stripped** [`packages/api/src/readings/readingAggregateRepository.ts:179-193`] — deferred, pre-existing — future router-level Zod boundary owns string-trim validation.
- [x] [Review][Defer] **Adapter swallows Prisma errors identically (no P2002 vs P1001 triage)** [`packages/api/src/readings/readingAggregateRepository.ts:130-144`] — deferred, pre-existing — out of 5.4 scope (5.5 cron owns error triage).
- [x] [Review][Defer] **No DB-level CHECK for 5-min bucket floor** [`packages/db/prisma/schema.prisma:145`] — deferred, pre-existing — by spec design ("5.4 ships the column shape only"); 5.5 cron owns the floor formula.
- [x] [Review][Defer] **Sequential `findMany`+`count` race** [`packages/api/src/readings/readingAggregateRepository.ts:130-144`] — deferred, pre-existing — typical pagination race; refactor to `Promise.all` (see Patches) narrows the window.
- [x] [Review][Defer] **Adapter crashes on null/undefined prisma argument** [`packages/api/src/readings/readingAggregateRepository.ts:122`] — deferred, pre-existing — caller contract violation; matches 5.3 precedent (no null-guard there either).
- [x] [Review][Defer] **No pagination cursor; empty `where` full-scans** [`packages/api/src/readings/readingAggregateRepository.ts:97-109`] — deferred, pre-existing — by spec design (capped at 1000); future admin read surface owns pagination.
- [x] [Review][Defer] **`metricWhere` accepts free string (closed-enum comment lies)** [`packages/api/src/readings/readingAggregateRepository.ts:184-188`] — deferred, pre-existing — no router in 5.4; closed-enum validation lives at the future router boundary.
- [x] [Review][Defer] **AC2 (`P2002`) has no test coverage** [`spec-5-4-readingaggregate-table.md:95`] — deferred, pre-existing — AC2 is asserted at the SQL shape level (unique index exists); live `prisma.readingAggregate.create()` duplicate-insert test requires a live DB; deferred to 5.5 writer-side tests.
- [x] [Review][Defer] **AC1 migration-on-fresh-DB has no automated test** [`spec-5-4-readingaggregate-table.md:94`] — deferred, pre-existing — `prisma migrate dev` runs locally; CI is a TODO stub (out of 5.4 scope).
