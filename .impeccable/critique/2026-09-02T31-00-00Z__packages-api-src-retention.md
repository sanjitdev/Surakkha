# Critique — `packages/api/src/retention/` (cron sweep surface)

**Date:** 2026-09-02
**Surface:** `packages/api/src/retention/` (3 source files, 943 LOC)
**Scoring:** Nielsen 10-heuristics + AI-slop detection

## Scope

| File                | LOC | Role                                                   |
| ------------------- | --- | ------------------------------------------------------ |
| `cronRepository.ts` | 207 | Prisma slice for retention sweep (interface + adapter) |
| `cronWiring.ts`     | 253 | node-cron wiring + RBAC + audit                        |
| `cronRunner.ts`     | 483 | sweep orchestrator (readings/incidents/attachments)    |

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic            | Score | Note                                                                                                                                                                                    |
| --- | -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visibility           | 3     | Status, lock acquisition, audit emit, and skip-on-contention are visible at seams. Header docs reveal intent.                                                                           |
| 2   | Match real world     | 3     | User language: `cronRun`, `runningCronTick`, `cutoff`, `retentionWindowDays` align with operator vocabulary.                                                                            |
| 3   | User control/freedom | 3     | `lockKey`, `batchSize`, `intervalMs`, `retentionWindowDays` all overridable; `stop()` handle exposed for shutdown.                                                                      |
| 4   | Consistency          | 3     | Follows `auditLogRepository.ts`/`resolveIncidentStateRepository`/`admin/thresholdsWiring.ts` patterns.                                                                                  |
| 5   | Error prevention     | 3     | `validateRuntimeConfig` rejects pathological inputs before they reach `setInterval`; `MAX_BATCHES_PER_TICK` ceiling defends the loop; `pg_try_advisory_lock` non-blocking variant.      |
| 6   | Recognition > recall | 3     | Helpers named by purpose (`tryAdvisoryLock`, `releaseAdvisoryLock`, `acquireLockOrSkip`, `runBatchLoop`, `processBatch`, `mergeMetric`, `mergeStats`).                                  |
| 7   | Flexibility          | 3     | `CronRepository` narrow slice allows stub injection without Prisma boot.                                                                                                                |
| 8   | Minimalist design    | 1     | **All three files carry heavy AI-slop bloat**: 30-line, 42-line, 32-line JSDoc headers restating patterns, AC citations, narrative rationale blocks, story codes, cross-file line refs. |
| 9   | Help recover errors  | 3     | Failure path writes a `CronRun` failure row + releases lock in `finally` + emits `audit.emit({ outcome: "failure" })`.                                                                  |
| 10  | Help & docs          | 2     | Inline docs are over-extended — file headers and per-helper JSDoc exceed a useful "what does this do" budget.                                                                           |

**Weighted total: 28/40.**

## AI-slop detection

### P1 (block merge)

- `cronRunner.ts` — 42-line header block (lines 1-42) duplicates a "Why `pg_try_advisory_lock`" rationale already restated inside helpers.
- `cronRepository.ts` — 30-line header block (lines 1-30) restates the "narrow slice" rationale twice with cross-file line refs.
- `cronWiring.ts` — 32-line header block (lines 1-32) mixes file purpose, the `lockKey` motif explanation, the `TICK_EMPTY` AC citation, and cross-file precedent.

### P2 (apply before merge)

#### Story codes / "distilled" markers

- `cronRepository.ts:1` — `Story 5.5`
- `cronRepository.ts:113-119` — `The 5.5 upsert:` (story code)
- `cronWiring.ts:2` — `Story 5.5`
- `cronWiring.ts:23, 42` — `Story 5.5's "fingerprint"` / `Story 5.5's id`
- `cronWiring.ts:30-31` — `TICK_EMPTY AC`
- `cronRunner.ts:2` — `Story 5.5`

#### Cross-file line refs

- `cronRepository.ts:5-6` — `Mirrors the pattern from `auditLogRepository.ts:81-127``
- `cronRepository.ts:180-181` — `Mirrors `resolveIncidentStateRepository` (`incidentStateRepository.ts:202-221`)`
- `cronRunner.ts:6` — `Mirrors the `applyTransition`pattern from`incidentStateRepository.ts:268-369``
- `cronRunner.ts:22` — `(see `cronRunner.spec.ts`)`
- `cronRunner.ts:71-72` — `Mirrors the `ReadingAggregateMetricSchema`from`@surakkha/shared/reading-aggregate``
- `cronRunner.ts:131-134` — `(lives in `cronWiring.ts` so the wiring + the runner agree on the value)`
- `cronRunner.ts:355-362` — `(The schema-level validator lives at `RetentionConfigSchema`in`@surakkha/shared/retention`)`
- `cronRunner.ts:384` — `(extracted to keep `runningCronTick`'s cyclomatic complexity under the lint ceiling)`
- `cronWiring.ts:5-6` — `Mirrors the lazy-resolver pattern at `admin/thresholdsWiring.ts`+`alerts/wiring.ts``
- `cronWiring.ts:49` — `see `telemetry.ts:15-18` precedent`
- `cronWiring.ts:108-112` — `(see `setInterval`-returning helpers in `admin/thresholdsWiring.ts`)` / `index.ts`
- `cronWiring.ts:135-149` — `(The schema-level validator lives at `RetentionConfigSchema`in`@surakkha/shared/retention`)` + `index.ts`
- `cronWiring.ts:210-211` — `(per the spec's "No audit.emit for the running state" note)`

#### Long narrative rationale blocks

- `cronRepository.ts:13-29` — 17-line "Why a narrow slice" / "Atomicity" block restating what the interface declarations already say.
- `cronRunner.ts:24-34` — 11-line "Why `pg_try_advisory_lock`" block restating lock semantics.
- `cronRunner.ts:36-41` — 6-line "Atomicity" block restating transaction behavior.
- `cronRunner.ts:70-87` — 18-line RAW/long-name wire-vs-short-name aggregate vocabulary restating the `TelemetryMetricsSchema`.
- `cronRunner.ts:110-117` — 8-line `MAX_BATCHES_PER_TICK` rationale.
- `cronRunner.ts:168-186` — 19-line "Aggregate arithmetic (read+merge)" restating the 4-step merge formula inline + restating the why.
- `cronRunner.ts:236-251` — 16-line block on `mergeMetric` + `MergeMetricInput` rationale.
- `cronRunner.ts:295-302` — 8-line `mergeStats` rationale + lint-disable comment.
- `cronRunner.ts:330-351` — 22-line `runningCronTick` "Steps" block restating the body.
- `cronRunner.ts:357-362` — 6-line defensive guard rationale.
- `cronRunner.ts:368-372` — 5-line step-1 rationale + duplicated step-1 comment.
- `cronRunner.ts:383-385` — 3-line step-2 extraction rationale.
- `cronRunner.ts:401-405` — 5-line step-4 finally rationale.
- `cronRunner.ts:407-414` — 8-line "may return false" rationale.
- `cronRunner.ts:417-424` — 8-line `acquireLockOrSkip` rationale.
- `cronRunner.ts:428-432` — 5-line `RunBatchLoopInput` bundle rationale.
- `cronRunner.ts:440-449` — 10-line `runBatchLoop` rationale.
- `cronWiring.ts:21-26` — 6-line `lockKey` motif explanation.
- `cronWiring.ts:27-32` — 6-line empty-tick behaviour rationale.
- `cronWiring.ts:37-46` — 10-line `RETENTION_LOCK_KEY` rationale.
- `cronWiring.ts:84-91` — 8-line input override rationale.
- `cronWiring.ts:106-113` — 8-line `RetentionCronHandle` rationale.
- `cronWiring.ts:118-134` — 17-line schedule function header restating the body.
- `cronWiring.ts:135-149` — 15-line `validateRuntimeConfig` rationale.
- `cronWiring.ts:186-193` — 8-line re-entrancy guard rationale.

#### "Patch (code review ...)" / "F-P..." markers

- None observed in this surface.

### Non-findings (verified, not raised)

- **Retention TTL constants** (`DEFAULT_RETENTION_WINDOW_DAYS = 30`, `DEFAULT_BATCH_SIZE = 10_000`, `DEFAULT_INTERVAL_MS = SECONDS_PER_MINUTE * MS_PER_MINUTE`) — preserved.
- **`MAX_BATCHES_PER_TICK = 1_000`** ceiling — preserved.
- **3-table sweep ordering** — preserved (the runner reads + upserts aggregates, then deletes raw rows inside one `$transaction` per batch; the per-row defensive `Date` validity skip is preserved; the keyset-paging `(ts ASC, id ASC)` order is preserved).
- **Audit-log emit semantics** — `cron_run_completed` action, `outcome: "success" | "failure"`, `skipped` is silent (no audit.emit), preserved.
- **Advisory-lock acquire/release pairing** — `tryAdvisoryLock` + `releaseAdvisoryLock` (in `finally`) + cross-process second-line-of-defence preserved.
- **`pg_try_advisory_lock` (non-blocking)** — preserved over blocking variant.
- **Re-entrancy guard** in `cronWiring.ts` (in-process `running` flag + cross-process advisory lock) — preserved.
- **`CronRepository` structural cast seam** — preserved (single `as any` contained to `resolveCronRepository`).
- **`tx: CronRepository` re-binding inside `$transaction`** — preserved (the callback narrows back to the same slice).
- **`mergeStats` `complexity` lint-disable** — preserved with the eslint-disable line retained.
- **`mergeMetric` param-bundling to satisfy `max-params: 3`** — preserved.

### Out of scope

- `cronRunner.spec.ts` (21 KB) — not edited.
- The `@surakkha/shared/retention` `RetentionConfigSchema` — referenced but not edited.

## Plan

### Strip pass

1. Drop `Story 5.5` markers from all three file headers.
2. Drop `TICK_EMPTY AC` reference in `cronWiring.ts:30-31`.
3. Drop cross-file line refs (`auditLogRepository.ts:81-127`, `incidentStateRepository.ts:202-221`, `incidentStateRepository.ts:268-369`, `telemetry.ts:15-18`, `admin/thresholdsWiring.ts`, `alerts/wiring.ts`, `index.ts`, `cronRunner.spec.ts`).
4. Drop `RetentionConfigSchema` cross-package reference duplication — keep one short pointer if needed.
5. Drop duplicated "Step 1" comment in `cronRunner.ts:368-372`.
6. Drop duplicated "Step 2" extraction rationale comment.
7. Drop the `five-fives motif` / "fingerprint" rationale in `cronWiring.ts:21-26, 37-46` — keep the constant + a one-liner that it is stable across processes.
8. Drop `lint-disable` `complexity` comment expansion — keep the `eslint-disable` line only.

### Trim pass

1. `cronRepository.ts` header: 30 → 10 lines. State file purpose only.
2. `cronRunner.ts` header: 42 → 10 lines. State file purpose only.
3. `cronWiring.ts` header: 32 → 10 lines. State file purpose only.
4. `cronRunner.ts` `processBatch` header: 19 → 4 lines.
5. `cronRunner.ts` `mergeMetric` + `MergeMetricInput` JSDoc: 16 → 4 lines.
6. `cronRunner.ts` `mergeStats` JSDoc: 8 → 3 lines.
7. `cronRunner.ts` `runningCronTick` JSDoc "Steps" block: 22 → 6 lines.
8. `cronRunner.ts` `runBatchLoop` JSDoc: 10 → 4 lines.
9. `cronRunner.ts` `acquireLockOrSkip` JSDoc: 8 → 3 lines.
10. `cronRunner.ts` defensive-guard comments at lines 357-362, 368-372, 383-385, 401-405, 407-414: collapse to 1-2 lines each.
11. `cronRunner.ts` `RAW_TO_AGGREGATE` rationale block: 18 → 4 lines.
12. `cronWiring.ts` `scheduleRetentionCron` JSDoc: 17 → 6 lines.
13. `cronWiring.ts` `validateRuntimeConfig` rationale: 15 → 4 lines.
14. `cronWiring.ts` `RETENTION_LOCK_KEY` rationale: 10 → 2 lines.
15. `cronWiring.ts` re-entrancy guard comment: 8 → 2 lines.

### Preserved (load-bearing)

- `RETENTION_LOCK_KEY = 0x5_55_5_55_5n` constant + its `bigint` type.
- `MAX_BATCHES_PER_TICK = 1_000` ceiling + its rationale as a 1-2 line comment.
- `DEFAULT_RETENTION_WINDOW_DAYS`, `DEFAULT_BATCH_SIZE`, `DEFAULT_INTERVAL_MS` constants.
- `validateRuntimeConfig` runtime guards.
- `CronRepository` interface + `resolveCronRepository` adapter with the contained `as any` cast.
- `$transaction` callback + `tx: CronRepository` re-binding shape.
- `mergeMetric` / `mergeStats` arithmetic (Welford-style running mean/min/max/sampleCount).
- `processBatch` per-row defensive `Date` validity skip + per-metric numeric-validity skip.
- `pg_try_advisory_lock` (non-blocking) acquire + `pg_advisory_unlock` release in `finally`.
- `cron_run_completed` audit emit with `outcome: "success" | "failure"` + silent `skipped`.
- Re-entrancy `running` flag + cross-process advisory-lock second-line-of-defence.
- `complexity` lint-disable on `mergeStats`.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/retention
cd packages/api && npx vitest run src/retention 2>&1 | tail -15
node scripts/lint-prose.mjs
```
