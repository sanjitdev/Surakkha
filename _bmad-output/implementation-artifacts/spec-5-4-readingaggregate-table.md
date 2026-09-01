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
- Columns mirror `epics.md:1622` exactly: `id` (uuid), `deviceId` (FK SET NULL → Device), `bucketStart` (`DateTime`), `metric` (`String` — closed enum: `tds | turbidity | ph | temperature | battery | signal`), `mean` (`Float`), `min` (`Float`), `max` (`Float`), `sampleCount` (`Int`).
- `@@unique([deviceId, bucketStart, metric])` — the 5.5 cron uses `ON CONFLICT (...) DO UPDATE` for idempotent overlap-safe retries; the constraint is the load-bearing invariant.
- `@@index([deviceId, bucketStart])` for the (future) range-scan read pattern (admin / chart query).
- `onDelete: SetNull` for the `deviceId` FK — a deleted device must NOT cascade-delete historical aggregates (regulators may still want them); the FK row goes null and the aggregate stays.
- `bucketStart` is the floor of the source `Reading.ts` to the nearest 5 minutes, computed by the 5.5 cron (NOT by 5.4 — 5.4 ships the column shape only).
- Metric values are a closed `String` column at the Prisma layer; a sibling `ReadingAggregateMetricSchema` Zod enum in `packages/shared/src/reading-aggregate.ts` is the wire contract for any future reader (Story 5.5 doesn't need it, but the convention from `audit.ts:53-67` is to ship the Zod enum alongside the table).
- New sibling `readingAggregateRepository.ts` in `packages/api/src/readings/` follows the `auditLogRepository.ts:81-127` shape: typed `ReadingAggregateRow` interface + `ReadingAggregateRepository` interface + `resolveReadingAggregateRepository(prisma)` adapter that narrows via `as unknown as ...`. Pure-Promise seam (not async iterable) because the future admin read pattern is a small page, not a CSV stream.
- `ReadingAggregateRepository.findMany({deviceId?, metric?, since?, until?, limit?})` returns `{ rows, total, truncated }` ordered `bucketStart DESC`. Mirrors the 5.3 envelope.

**Ask First:**

- _Resolved at step-01:_ Migration filename — default: `20260901000001_reading_aggregate/` following the same-day `_00001` pattern from `20260827000001_alert_rule_id_index/`.
- _Resolved at step-01:_ `metric` column type — default: `String` (closed enum at Zod layer) so the Prisma schema stays migration-light when a metric is added; mirrors `AuditLog.resource` (`schema.prisma:554`).
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
- `packages/db/prisma/schema.prisma:554` — `model AuditLog` (5.3 reference; demonstrates `@@index([..., createdAt])`, FK SET NULL, Json field convention).
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
- [migration.sql:58](../../packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql#L58) — `CREATE UNIQUE INDEX`: the upsert-target invariant in SQL form.
- [migration.sql:70](../../packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql#L70) — `FOREIGN KEY ... ON DELETE SET NULL`: mirrors the schema.prisma comment.

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
