---
title: "Story 5.5 — Hourly Retention Cron"
type: "feature"
created: "2026-09-02"
status: "in-review"
review_loop_iteration: 0
baseline_commit: "05880fdbe0dc2422c7389230d88e070c777d892c"
context: []
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot.
     Cohesive cross-layer story (DB+BE) stays in ONE file. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Raw `Reading` rows older than 30 days are never read by any surface (operator page 24h, CSV export 30d cap) yet still consume disk + index bloat on the `(deviceId, ts)` and `(deviceId, seq)` indexes that grow monotonically. Without an automated retention writer, no surface can ever safely delete them — and Story 5.4's `ReadingAggregate` table sits empty, so future admin/chart readers cannot get historical context.

**Approach:** Ship an hourly background job that aggregates raw `Reading` rows older than 30 days into 5-minute mean/min/max/sample_count buckets via `prisma.readingAggregate.upsert` on the `@@unique([deviceId, bucketStart, metric])` key (NULLS NOT DISTINCT), then deletes the source raw rows in the same transaction. Writes a `cron_runs` row per tick recording started/finished/aggregated/deleted counts. Uses a Postgres advisory lock keyed on a constant so concurrent ticks cannot double-process. Batched at ≤10,000 rows per transaction. No UI surface (admin-internal in v1).

## Boundaries & Constraints

**Always:**

- New `CronRun` Prisma model + a new migration (next after `20260901000001_reading_aggregate`, so `20260901000002_cron_runs`). Columns: `id` (uuid), `startedAt` (`DateTime`), `finishedAt` (`DateTime?`), `status` (`String` — closed enum at Zod layer: `running | success | failure`), `aggregatedRows` (`Int`), `deletedRows` (`Int`), `errorMessage` (`String?`).
- New `Reading.ts` index `@@index([ts])` for the cron's `WHERE ts < cutoff` range-scan; today's indexes (`[deviceId, ts]`, `[deviceId, seq]`) would force a seq-scan. Added via the same migration.
- A `floorToFiveMinutes(ts: Date): Date` helper exported from `packages/shared/src/reading-aggregate.ts` — used by the cron to bucket `Reading.ts` to the nearest 5-minute floor. Mirrors the precedent of writing wire helpers at the shared seam.
- A `runningCronTick(args: { prisma: unknown, cutoff: Date, lockKey: bigint }): Promise<CronTickResult>` function in `packages/api/src/retention/cronRunner.ts` — pure function (no module-scoped state), easy to mock from tests. The `CronTickResult` type is `{ status, aggregatedRows, deletedRows } | { status: "skipped", reason: "lock_held" }`.
- A `scheduleRetentionCron(args: { resolvePrismaClient, lockKey, retentionWindowDays, batchSize, intervalMs, logger })` function in `packages/api/src/retention/cronWiring.ts` — sets the interval and exposes start/stop. Default `intervalMs = 60 * 60 * 1000` (hourly); default `retentionWindowDays = 30`; default `batchSize = 10_000`; `lockKey` constant lives in this file.
- Postgres advisory lock via `pg_advisory_lock($1)` / `pg_advisory_unlock($1)` at `lockKey`. The Prisma client exposes `$queryRaw` so the lock acquisition is `await prisma.$queryRaw\`SELECT pg_advisory_lock(${lockKey})\``. If `pg_try_advisory_lock`returns`false`the tick short-circuits with`{ status: "skipped", reason: "lock_held" }`.
- `CronRepository` interface in `packages/api/src/retention/cronRepository.ts` with three methods (`cronRun`, `readingAggregate`, `reading`) — mirrors the audit/notification repository seam pattern. Includes `$transaction(cb)` so each batch is atomic.
- Wire schema `CronRunStatusSchema` in `packages/shared/src/retention.ts` — closed enum: `"running" | "success" | "failure"`. Mirrors `ReadingAggregateMetricSchema` precedent.
- No deletion of aggregates (only raw `Reading` rows). Raw rows with `ts >= cutoff` are NEVER touched (regulator retention).
- `audit.emit({ auditAction: "cron_run_completed", outcome, context: { aggregatedRows, deletedRows, durationMs } })` on `success` and on `failure` — adds `cron_run_completed` to the `AuditAction` enum in `packages/shared/src/rbac.ts`.

**Ask First:**

- _Resolved at step-01:_ Lock acquisition style — `pg_advisory_lock` (blocking) vs `pg_try_advisory_lock` (non-blocking, skips on contention). Default: `pg_try_advisory_lock` (skip-on-contention, no queue back-pressure).
- _Resolved at step-01:_ Cron tick on `api` boot vs separate worker process — default: `api` boot (no new deployable; matches existing single-process Express pattern).
- _Resolved at step-01:_ Aggregation window — `floorToFiveMinutes` vs `floorToFifteenMinutes` vs custom. Default: 5 minutes (matches the spec table story's user-story AC for `bucketStart`).

**Never:**

- No retention policy on `ReadingAggregate` rows — the aggregates are kept indefinitely (a 30-day retention on the aggregates would be self-defeating).
- No UI surface for `cron_runs` (no `/admin/cron-runs` page). Operator can observe via the `cron_run_completed` audit rows.
- No raw SQL on the `readingAggregate` table — the upsert is via `prisma.readingAggregate.upsert(...)` for type safety.
- No mutation of `ReadingAggregate` rows that already exist (the `upsert`'s `update` clause only writes `mean`, `min`, `max`, `sampleCount`; never `bucketStart` or `metric` or `deviceId`).
- No changes to the simulator's emit cadence — simulator is unchanged.
- No `audit.emit` for the `running` state — only `success` and `failure` emit; `running` is silent.

## I/O & Edge-Case Matrix

| Scenario           | Input / State                                                 | Expected Output / Behavior                                                                                                                                                           | Error Handling                                |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| TICK_HAPPY         | 25,000 raw rows older than 30d across 3 devices; lock free    | 3 batches × ≤10k, all upserted + deleted; `CronRun` row with `status: "success"`, `aggregatedRows: <bucket count>`, `deletedRows: 25_000`; `audit.emit` `cron_run_completed` success | n/a                                           |
| TICK_LOCK_HELD     | Concurrent tick from another process holds `pg_advisory_lock` | `{ status: "skipped", reason: "lock_held" }`; no `CronRun` row written; no audit emit                                                                                                | n/a                                           |
| TICK_EMPTY         | No raw rows older than 30d                                    | `CronRun` row with `status: "success"`, `aggregatedRows: 0`, `deletedRows: 0`; audit emit                                                                                            | n/a                                           |
| TICK_FAILURE       | `prisma.readingAggregate.upsert` rejects with P2002 mid-batch | Transaction reverts; `CronRun` row with `status: "failure"`, `errorMessage` set; audit emit `cron_run_completed` failure                                                             | `pg_advisory_unlock` fires in the catch block |
| UPSERT_NULL_DEVICE | Raw row's `deviceId` references a deleted device              | Aggregate row written with `deviceId: null` (per the `NULLS NOT DISTINCT` invariant from 5.4)                                                                                        | n/a                                           |
| BUCKET_FLOOR       | `Reading.ts = 2026-09-01T12:37:14.000Z`                       | `floorToFiveMinutes(ts)` → `2026-09-01T12:35:00.000Z`                                                                                                                                | n/a                                           |
| MIGRATION_FRESH    | `pnpm prisma migrate dev` on empty DB                         | `cron_runs` table + `Reading.ts` index applied cleanly                                                                                                                               | n/a                                           |
| SCHEDULER_BOOT     | `index.ts` boots the api                                      | `scheduleRetentionCron` invoked once at boot, returns `{ stop }` for shutdown hook                                                                                                   | n/a                                           |

## Code Map

- `packages/db/prisma/schema.prisma:85-101` — `model Reading` (today's indexes; 5.5 adds `@@index([ts])` here).
- `packages/db/prisma/schema.prisma:142-172` — `model ReadingAggregate` (5.4's nullable deviceId + NULLS NOT DISTINCT target for the cron upsert).
- `packages/db/prisma/migrations/20260901000001_reading_aggregate/migration.sql:1-79` — 5.4 migration; the 5.5 migration (`20260901000002_cron_runs`) mirrors the comment style + uses Prisma's hand-edited `pg_advisory_*` precedent.
- `packages/api/src/audit.ts:11-32` — `audit.emit` signature; the cron calls this with `auditAction: "cron_run_completed"`.
- `packages/api/src/boot/db.ts:31-49` — `getPrisma()` lazy singleton; the cron uses this rather than importing `@prisma/client` directly.
- `packages/api/src/readings/csvRepository.ts:44-49` — `ReadingRow` shape (id, deviceId, ts, metrics).
- `packages/api/src/readings/csvRepository.ts:87-117` — keyset pagination SQL on `(ts, id)`; the cron reuses the keyset pattern with `WHERE ts < cutoff` predicate.
- `packages/api/src/readings/csvRepository.ts:261-271` — module-scope lazy `resolvePrismaClient` resolver; cron mirrors this.
- `packages/api/src/admin/thresholdsWiring.ts:50-69` — `$transaction` callback wrapper pattern; cron mirrors.
- `packages/api/src/incidents/applyTransition.spec.ts:83-126` — `captureRepo` test-rig pattern with `$transaction` callback-invoking stub; cron spec mirrors.
- `packages/shared/src/rbac.ts:510-548` — `AuditActionSchema`; 5.5 adds `cron_run_completed` here.
- `packages/shared/src/reading-aggregate.ts:54-62` — closed-enum Zod pattern; `CronRunStatusSchema` mirrors.
- `packages/api/src/index.ts:96-100` — `audit.emit` v1 logger-only wiring; unchanged.
- `packages/api/src/index.ts:203-234` — boot router mount pattern; cron wiring slots in here.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/db/prisma/schema.prisma` -- ADD `model CronRun` block with columns `id @id @default(uuid())`, `startedAt DateTime`, `finishedAt DateTime?`, `status String`, `aggregatedRows Int`, `deletedRows Int`, `errorMessage String?`; `@@index([startedAt])` for the future "last run" lookup. ADD `@@index([ts])` to `model Reading`.
- [ ] `packages/db/prisma/migrations/20260901000002_cron_runs/migration.sql` -- NEW `CREATE TABLE "CronRun"` + `CREATE INDEX "CronRun_startedAt_idx"` + `CREATE INDEX "Reading_ts_idx"` (the new reading ts index the cron relies on).
- [ ] `packages/shared/src/reading-aggregate.ts` -- ADD `export const floorToFiveMinutes = (ts: Date): Date => { ... }` to the existing module. Pure function, no dependencies.
- [ ] `packages/shared/src/retention.ts` -- NEW module: `CronRunStatusSchema = z.enum(["running", "success", "failure"])`, plus `CronTickResult` type, plus `RetentionConfigSchema` shape. Preamble cites the `reading-aggregate.ts` precedent.
- [ ] `packages/shared/src/rbac.ts` -- ADD `"cron_run_completed"` to the `AuditActionSchema` enum values; update the doc comment to mention the cron-emit case.
- [ ] `packages/api/src/retention/cronRepository.ts` -- NEW repo: `CronRepository` interface with three methods (`cronRun.create`, `readingAggregate.upsert`, `reading.findMany` + `reading.deleteMany` + keyset cursor) + `resolveCronRepository(prisma)` adapter mirroring `auditLogRepository.ts:81-127`.
- [ ] `packages/api/src/retention/cronRunner.ts` -- NEW pure function `runningCronTick({ prisma, cutoff, lockKey, batchSize })`: try-advisory-lock → batch-loop (`findMany + floorToFiveMinutes + upsert + deleteMany` per batch, ≤10k) → release lock → return `CronTickResult`. No module-scoped state.
- [ ] `packages/api/src/retention/cronWiring.ts` -- NEW `scheduleRetentionCron({ resolvePrismaClient, lockKey, retentionWindowDays, batchSize, intervalMs, logger })` returning `{ stop }`. `setInterval` ticks call `runningCronTick`, then `audit.emit` success/failure. Lock key constant lives here.
- [ ] `packages/api/src/index.ts` -- CALL `scheduleRetentionCron({ ... })` once at boot (after `getPrisma()` is resolvable). Wire the returned `stop` into any shutdown hook.
- [ ] `packages/shared/src/retention.spec.ts` -- NEW unit tests for `CronRunStatusSchema` (closed-enum acceptances + 3 rejections: drift string, empty string, case-mismatch). Mirrors `reading-aggregate.spec.ts`.
- [ ] `packages/shared/src/reading-aggregate.spec.ts` -- ADD tests for `floorToFiveMinutes`: aligned ts (no change), off-by-1ms rounds down, off-by-4m59s rounds to floor, exactly-on-boundary stays, naive-Date input converted to UTC.
- [ ] `packages/api/src/retention/cronRunner.spec.ts` -- NEW unit tests for `runningCronTick` using the `applyTransition.spec.ts` captureRepo pattern. Cover: TICK_HAPPY (3 batches, captures upsert payloads + delete args + CronRun row + audit emit), TICK_LOCK_HELD (try-advisory returns false → skip + no side effects), TICK_EMPTY (no rows → 0/0 success), TICK_FAILURE (upsert rejects → CronRun failure row + audit failure emit + lock released).

**Acceptance Criteria:**

- Given raw `Reading` rows older than 30d exist across 3 devices, when the cron tick runs, then each row's `ts` is floored to the nearest 5 minutes, aggregated into `ReadingAggregate` via upsert (matching `@@unique([deviceId, bucketStart, metric])`), and the raw rows are deleted — all within ≤10,000-row batches.
- Given a concurrent tick holds the advisory lock, when the cron's `pg_try_advisory_lock` runs, then the tick short-circuits with `{ status: "skipped", reason: "lock_held" }`; no `CronRun` row is written; no audit emit fires.
- Given `prisma.readingAggregate.upsert` rejects mid-batch with P2002, when the transaction reverts, then a `CronRun` row is written with `status: "failure"`, `errorMessage` populated, and `audit.emit({ auditAction: "cron_run_completed", outcome: "failure" })` fires.
- Given `floorToFiveMinutes(ts)` is called with `ts = 2026-09-01T12:37:14.000Z`, when the function returns, then the result is `2026-09-01T12:35:00.000Z` (floor).
- Given the api boots, when the boot path reaches the cron-wiring call, then `scheduleRetentionCron` returns `{ stop }` and the interval is registered; the first tick fires within `intervalMs`.
- Given a `Reading` row references a deleted device (`deviceId` would cascade to NULL), when the cron processes it, then the resulting `ReadingAggregate` row has `deviceId: null` (per the `NULLS NOT DISTINCT` invariant from 5.4).
