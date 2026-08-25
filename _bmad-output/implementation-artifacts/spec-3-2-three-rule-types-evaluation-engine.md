---
title: 'Story 3.2 — Three Rule Types + Evaluation Engine'
type: 'feature'
created: '2026-08-25'
status: 'review'
review_loop_iteration: 1
baseline_commit: '8c2f8c2b85068a19410bff7c80bd44228d1b1e6a'
context:
  - _bmad-output/implementation-artifacts/epic-3-context.md
  - _bmad-output/planning-artifacts/epics.md#story-32-three-rule-types--evaluation-engine
  - _bmad-output/implementation-artifacts/spec-3-1-rules-table-prisma-schema.md
  - docs/architecture.md
  - packages/shared/src/rule.ts
  - packages/api/src/ingest/hooks.ts
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 10-step ingest driver built in Story 2.2 already has a typed `stepRuleEvaluation` slot that calls `onRuleEvaluation` from `IngestHooks`, but the implementation is a no-op. Without a real engine, reading frames never produce `breach: true` and the entire Epic 3 alerts pipeline is dead on arrival.

**Approach:** Build a typed, in-memory evaluation engine that loads all active `Rule` rows at boot into a `Map<ruleId, EngineRule>`, exposes three pure evaluators (`instant`, `rate`, `absence`) plus a `BreachResult` shape, registers as the `onRuleEvaluation` hook implementation, and runs after `stepPersist` for every frame. Operators are mapped from camel-case Prisma enum tokens (`gte`/`gt`/`lte`/`lt`/`eq`) to JS comparators at the engine boundary; absence rules reuse `hysteresisSeconds` as the fire-after-no-readings duration.

## Boundaries & Constraints

**Always:**
- Three rule types exactly: `instant`, `rate`, `absence`. Registering any other `ruleType` throws `unsupported_rule_type` and the rule never enters the in-memory cache.
- Five operators exactly: `gte`, `gt`, `lte`, `lt`, `eq`. The engine maps each to the JS comparator (`>=`, `>`, `<=`, `<`, `==`) at evaluation time via a closed lookup table; the mapping is exported from the engine module for tests to assert. The lookup is `Record<RuleOperator, comparator>` so `tsc` rejects a missing entry if the enum ever grows.
- Active rule cache is hydrated ONCE at api boot via `setIngestHooks(...)` and never re-queried mid-eval. Reload-on-save is Story 3.7's concern; out of scope here.
- Engine returns `readonly BreachResult[]` from `onRuleEvaluation`; Story 3.5's alert manager consumes that list. Story 3.2 does NOT call `onAlertEmission` directly.
- Evaluation runs after `stepPersist`. The `Reading` row is the canonical observation; the engine never reads the raw frame.
- `rate` rule queries the last 60 s of `Reading` rows for the same `(device_id, metric)` and computes a linear-regression slope over the last 5 readings. The hook SORTS the rows ascending by `ts`, DROPS readings with `ts > observation.observedAt` (clock-skew guard), DEDUPES rows with identical `ts` keeping the latest value, and SLICES to the last 5 before handing them to the engine. Engine needs a minimum of 5 readings in the window before firing; below the threshold it returns no breach.
- `rate` slope formula: simple linear regression on `(x = ts.getTime() in milliseconds, y = value)`. Slope units are `value / ms`. The threshold field carries the SAME units as the comparison: a threshold of `50` compared with `gte` means `slope.valuePerMs >= 50` (i.e. ~50 value/ms = ~3,000,000 value/min). Tests use ms-scale thresholds or pre-scale the slope; the engine math is unchanged.
- `absence` rule fires when no `Reading` row exists for the device within the rule's `hysteresisSeconds` window. The breach clears as soon as any new reading arrives. Boundary is INCLUSIVE: a reading whose `ts` is `now - hysteresisSeconds*1000` (exactly) clears the breach. `hysteresisSeconds` carries TWO semantics: clearing-time for instant/rate AND fire-after-no-readings for absence. The engine is the single authority on which semantic applies.
- `BreachResult.observedAt` is `observation.observedAt` for instant, rate, and absence (uniform — the frame's wire timestamp converted to `Date`). This is the only source so the alert manager (Story 3.5) has one timestamping rule.
- `BreachResult.value` is the triggering observation value: `observation.value` for instant, the computed slope for rate, and `0` for absence (sentinel — absence has no reading to point at; downstream distinguishes via `ruleType === "absence"`).
- `BreachResult.deviceId` is always `observation.deviceId` (the frame's device), regardless of whether the firing rule was global or per-device. Global rules fire per-frame, not per-rule.
- Global absence rules ARE allowed (deviceId IS NULL); they fire per-frame for every device whose last reading is older than `hysteresisSeconds`.
- Every pure helper (operator lookup, slope calculator, breach evaluator per rule type) is exported individually for isolated unit tests — engine wire tests cover the hook path, pure-function tests cover the math.
- All existing 649 tests keep passing against the new engine + `Rule` cache.

**Ask First:**
- Adding a new column to the `Rule` table (e.g. `no_reading_for_seconds Int?`) to give absence its own duration. **Default: NO — the user's chosen approach reuses `hysteresisSeconds`.** A follow-up migration is fine if Epic 3 retro demands it.
- Building a hot-reload signal so Story 3.7's `/admin/thresholds` save triggers a cache refresh. **Default: NO — out of scope for 3.2; Story 3.7 may add a simple `refreshRuleCache()` exported function that calls Prisma and updates the in-memory map.**

**Never:**
- Do not introduce `Alert`, `Incident`, or `AlertManager`. Story 3.5 owns the alert lifecycle.
- Do not add CHECK constraints, partial indexes, or any DB-level changes. The schema is locked per Story 3.1's `<frozen-after-approval>` block.
- Do not call `prisma.rule.create` or `prisma.rule.update` from the engine. Engine is read-only against `Rule` rows at runtime.
- Do not change `frame.ts` or the `PROCESSING_ORDER`. The hook contract from Story 2.2 is the seam; 3.2 only replaces the no-op with the real engine.
- Do not add a `noReadingForSeconds` column on `Rule`. The reuse of `hysteresisSeconds` is intentional and pinned by a test.
- Do not add `threshold`, `operator`, or `hysteresisSeconds` to `BreachResult`. Story 3.5 re-derives from the cache by `ruleId` (engine is read-only against `Rule`; alert manager reads independently).

</frozen-after-approval>

## Code Map

- `packages/api/src/rules/engine.ts` -- NEW. The evaluation engine. Exports:
  - `OPERATOR_COMPARATORS: Record<RuleOperator, (a: number, b: number) => boolean>` (closed lookup table with all 5 entries).
  - `computeSlope(points: readonly { ts: Date; value: number }[]): number | null` (pure linear-regression over (ms, value) pairs; returns `null` if fewer than 5 points OR if the time-axis denominator is zero).
  - `evaluateRule(rule: EngineRule, observation: EngineObservation): BreachCandidate | null` (pure per-rule helper).
  - `evaluateRules(rules: readonly EngineRule[], observation: EngineObservation): readonly BreachResult[]` (multi-rule entry; maps each non-null `BreachCandidate` to a fully-projected `BreachResult` using `observation.observedAt` and `observation.deviceId`).
  - `requireRuleType(value: string): asserts value is RuleRuleType` (throws `Error("unsupported_rule_type: " + value)`).
  - `BreachResult` type: `{ readonly ruleId, readonly deviceId, readonly metric, readonly value: number, readonly severity: RuleSeverity, readonly ruleType: RuleRuleType, readonly observedAt: Date }`.
  - `BreachCandidate` type (private to engine; not exported): the same shape but with `value` sourced from `rule`-side context (slope vs reading value). It exists to make the per-rule evaluator's output explicit; `evaluateRules` projects it into `BreachResult`.
  - `EngineRule` type: `{ id: string, deviceId: string | null, metric: RuleMetric, operator: RuleOperator, threshold: number, severity: RuleSeverity, ruleType: RuleRuleType, hysteresisSeconds: number }`. `createdAt/updatedAt/version/isActive/minDurationSeconds/createdBy` are deliberately excluded — engine doesn't need them at eval time.
  - `EngineObservation` type: `{ deviceId: string, metric: RuleMetric, value: number, observedAt: Date, recentReadings: readonly { ts: Date; value: number }[] }`. Caller (the hook) computes `recentReadings` (last 60 s sorted ascending, future-ts dropped, ts-deduped, last-5) before calling.
  - `EMPTY_BREACH_RESULTS: readonly BreachResult[]` -- exported frozen empty tuple so the no-op hooks default can return it without allocating.
- `packages/api/src/rules/cache.ts` -- NEW. The in-memory active-rule cache.
  - `type ActiveRuleCache = { readonly byId: Map<string, EngineRule>; readonly byDeviceMetric: Map<string, readonly EngineRule[]> }`.
  - `hydrateActiveRuleCache(prisma: PrismaRuleReader): Promise<ActiveRuleCache>` — single query at boot. Per-row skip + `console.warn('[rules] hydrate: skipped unsupported ruleType=' + row.ruleType + ' id=' + row.id)` if `requireRuleType` rejects a row. Successful valid rows load regardless of any rejected rows in the same batch (per-row rejection is the rule, not all-or-nothing).
  - `refreshActiveRuleCache(current: ActiveRuleCache, prisma: PrismaRuleReader): Promise<ActiveRuleCache>` — Story 3.7 will call this on save.
  - Index key `byDeviceMetric`: `${deviceId ?? "__global__"}::${metric}` (exact string `"__global__"`, exact separator `"::"`).
  - `lookupRulesForFrame(cache: ActiveRuleCache, deviceId: string, metric: RuleMetric): readonly EngineRule[]` — exported helper; returns the union of rules at `__global__::metric` AND `${deviceId}::metric`. This is the only entry point the hook uses.
- `packages/api/src/rules/prismaReader.ts` -- NEW. Prisma-side reader interface.
  - `interface PrismaRuleReader { readonly rule: { findMany(args: { where: { isActive: true }; select: { ... } }): Promise<RuleRow[]> } }` (slice of @prisma/client for injection).
  - `resolvePrismaRuleReader(prisma: PrismaClient): PrismaRuleReader` — adapter that narrows the real client. Production calls this once.
- `packages/api/src/rules/hooks.ts` -- NEW. The hook implementation.
  - `installRuleEngineHooks(deps: { cache: ActiveRuleCache; prisma: PrismaRuleReader; readingRepository: ReadingRepository }): IngestHooks` returns the four methods; `onRuleEvaluation` builds the `EngineObservation` (queries the last 60 s readings for the metric via `deps.readingRepository.findMany(...)`, sorts ascending, drops future-ts, dedupes, slices to 5), looks up matching rules via `lookupRulesForFrame`, calls `evaluateRules`, and returns the breach list.
  - **Hook return type extension:** `IngestHooks.onRuleEvaluation` is changed from `Promise<void>` to `Promise<readonly BreachResult[]>`. The no-op default returns `EMPTY_BREACH_RESULTS` (frozen empty tuple). The caller in `frame.ts:303` was already `await`-ing the promise and discarding the result; this story keeps the discard — the breach array flows through but is currently a no-op consumer-side. Story 3.5 will add a follow-up wiring (alert manager reads the breach array either via a chained hook call or a dedicated `setAlertManagerHooks(...)`). Any pre-3.2 hook implementation returning `void` (e.g. Epic 4 stubs) MUST be updated when Epic 3 lands; the project-wide migration is a single-line return-type change in `packages/api/src/ingest/hooks.ts`.
  - `uninstallRuleEngineHooks(): void` calls `resetIngestHooks()` (the existing test-only reset in `packages/api/src/ingest/hooks.ts`) and returns. Pinned by a hooks.spec.ts test.
- `packages/api/src/ingest/frame.ts` -- EXTEND the `ReadingRepository` interface to add `findMany(args: { where: { deviceId: string; metric: RuleMetric; ts: { gte: Date } }; orderBy: { ts: "asc" }; take: number }): Promise<readonly { ts: Date; metrics: TelemetryFrame["metrics"]; ... }[]>` used by the engine's rate-rule window query. The exact `findMany` shape (where clause, orderBy, take) is pinned so test stubs can match it. Add optional `RuleRepository` to `ProcessFrameDeps` (optional; defaults to `undefined` if engine not installed) so the hook can access a read-side handle without coupling to the Prisma client type. Mirror pattern of `ReadingRepository` (slice interface, prod builds adapter from `@prisma/client`, tests inject stub). **The interface extension is itself pinned by a `frame.spec.ts` test that asserts the slice method exists with the documented signature.**
- `packages/api/src/index.ts` -- CALL `setIngestHooks(installRuleEngineHooks({ cache: hydrated, prisma: resolvePrismaRuleReader(prisma), readingRepository }))` once at boot, after `resolveReadingDelegate()`. The hydration runs as part of the existing `resolveReadingDelegate().then((prisma) => ...)` chain so the cache is available before the first frame. Wrap in try/catch: on hydration error, log `console.error('[rules] boot: hydrate failed; running with no-op hooks', err)` and call `setIngestHooks(noopHooks)` (the no-op default imported from `packages/api/src/ingest/hooks.ts`) so a transient DB outage at boot doesn't crash the api.
- `packages/api/src/rules/__tests__/engine.spec.ts` -- NEW. Unit tests for the three rule-type evaluators + the operator lookup.
  - `OPERATOR_COMPARATORS`: 2 tests. (a) `Object.keys(OPERATOR_COMPARATORS).length === RULE_OPERATORS.length` AND keys exactly match `RULE_OPERATORS`. (b) `gte(300,300)` true; `gt(300,300)` false; `lte(300,300)` true; `lt(300,300)` false; `eq(300,300)` true.
  - `instant`: 6 tests. (a) `gte` breach; (b) `gt` breach at strict; (c) `eq` breach at exact; (d) `lte` breach; (e) `lt` breach; (f) `gte` non-breach below threshold. Each test also asserts `breach.ruleId === rule.id`, `breach.deviceId === observation.deviceId`, `breach.observedAt === observation.observedAt`, `breach.metric === rule.metric`, `breach.severity === rule.severity`, `breach.ruleType === rule.ruleType`, `breach.value === observation.value` — the field-provenance pin.
  - `rate`: 5 tests. (a) 3 readings → no breach. (b) 5 readings slope below threshold → no breach. (c) 5 readings slope above threshold → breach with `value === computedSlope`. (d) 6 readings provided → engine uses last 5 only. (e) All-same-ts readings → slope returns `null` → no breach.
  - `absence`: 4 tests. (a) No reading in window → breach with `value === 0`, `ruleType === "absence"`. (b) Reading inside window → no breach. (c) Reading exactly `hysteresisSeconds` ago → no breach (boundary inclusive). (d) Multiple readings inside window with one outside → no breach (any reading in window clears).
  - `requireRuleType`: 2 tests. Happy path + throwing `Error("unsupported_rule_type: bogus")`.
  - **Total: 19 engine tests.**
- `packages/api/src/rules/__tests__/cache.spec.ts` -- NEW. Cache hydration tests.
  - (a) Empty DB → empty cache.
  - (b) Mixed active/inactive → only active rows present.
  - (c) Global + per-device → `byDeviceMetric.has("__global__::tds_ppm")` AND `byDeviceMetric.has(`${deviceId}::tds_ppm`)` both true (exact key strings).
  - (d) Row with `ruleType: "unsupported"` → excluded from `byId` AND `byDeviceMetric`, AND `console.warn` spy called with a message that contains the offending `ruleType` and `id`.
  - **Total: 4 cache tests.**
- `packages/api/src/rules/__tests__/hooks.spec.ts` -- NEW. Integration tests of `installRuleEngineHooks` against a stub `ReadingRepository` + `PrismaRuleReader`.
  - (a) Instant rule + breaching frame → returns breach with correct provenance.
  - (b) Instant rule + non-breaching frame → returns `EMPTY_BREACH_RESULTS`.
  - (c) **Frame-to-observation path**: hook receives a `TelemetryFrame` with `metric: "ph"` value 8.5 and `tds_ppm: 0`; cache has a `ph` rule with threshold 8.0 → breach fires (proves the hook extracted the right metric).
  - (d) Rate rule + stub `findMany` returning 4 readings → returns empty (insufficient via DB path; `findMany` spy asserted called with `where.ts.gte` = now-60s AND `orderBy.ts` = "asc").
  - (e) Rate rule + stub `findMany` returning 6 readings → `findMany` called with `take: 5` (or the hook slices to 5 after; pin whichever is implemented), and the breach fires.
  - (f) Absence rule + no readings in window → returns breach.
  - (g) Cache lookup: stub cache with one global rule + one device-specific rule for the same metric on the device; only the device-specific rule fires (proves the lookup helper filters correctly).
  - (h) `uninstallRuleEngineHooks()` → calling a frame hook after uninstall returns `EMPTY_BREACH_RESULTS` (proves reset).
  - **Total: 8 hooks tests.**

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/rules/engine.ts` -- NEW. Pure rule evaluators + operator lookup + `computeSlope` + `BreachResult` / `BreachCandidate` / `EngineRule` / `EngineObservation` types + `EMPTY_BREACH_RESULTS`.
- [x] `packages/api/src/rules/cache.ts` -- NEW. `hydrateActiveRuleCache` + `refreshActiveRuleCache` + `lookupRulesForFrame` (the single lookup entry point). Per-row skip on unsupported `ruleType` with logged warning.
- [x] `packages/api/src/rules/prismaReader.ts` -- NEW. `PrismaRuleReader` slice interface + real-client adapter.
- [x] `packages/api/src/rules/hooks.ts` -- NEW. `installRuleEngineHooks` hook implementation + `uninstallRuleEngineHooks` (which delegates to existing `resetIngestHooks`).
- [x] `packages/api/src/ingest/frame.ts` -- EXTEND `ReadingRepository` with `findMany` slice method (where/orderBy/take pinned); add optional `RuleRepository` to `ProcessFrameDeps`. Add a `frame.spec.ts` test asserting the interface extension exists with the documented signature.
- [x] `packages/api/src/ingest/hooks.ts` -- EXTEND `IngestHooks.onRuleEvaluation` return type to `Promise<readonly BreachResult[]>`; no-op default returns `EMPTY_BREACH_RESULTS` (imported from engine module). Update existing hook-callers (`frame.ts:303`) to await the new return type (the local `await deps.hooks.onRuleEvaluation(...)` discards the result for now; Story 3.5 picks it up).
- [x] `packages/api/src/index.ts` -- at boot, after `resolveReadingDelegate()`, hydrate the active-rule cache and call `setIngestHooks(installRuleEngineHooks({ cache, prisma: resolvePrismaRuleReader(prisma), readingRepository }))`. Wrap in a try/catch that logs `console.error('[rules] boot: hydrate failed; running with no-op hooks', err)` and calls `setIngestHooks(noopHooks)` if hydration fails so a transient DB outage at boot doesn't crash the api.
- [x] `packages/api/src/rules/__tests__/engine.spec.ts` -- NEW. 19 pure-function tests.
- [x] `packages/api/src/rules/__tests__/cache.spec.ts` -- NEW. 4 cache tests (3 listed in original spec + 1 for unsupported ruleType warning).
- [x] `packages/api/src/rules/__tests__/hooks.spec.ts` -- NEW. 8 hook integration tests (4 listed in original spec + 4 added for frame-to-observation, cache lookup, findMany spy, uninstall).
- [x] `packages/api/__tests__/reading-repository-findmany.spec.ts` -- NEW. Source-walk / signature pin test that the `ReadingRepository.findMany` slice method exists with the documented `where`/`orderBy`/`take` shape (mirrors the existing source-walk tests like `auth.no-rotation.spec.ts`).
- [x] Full test matrix: `pnpm -F @surakkha/shared test && pnpm -F @surakkha/db test && pnpm -F @surakkha/api test && pnpm -F @surakkha/web test && pnpm -F @surakkha/simulator test` -- every package green.

**Acceptance Criteria:**
- Given a registered rule with `ruleType: "instant"`, `operator: "gte"`, `threshold: 300`, `metric: "tds_ppm"` and a frame whose `tds_ppm` value is `312`, when the engine runs, then it returns a `BreachResult` with `severity` matching the rule, `ruleId` matching the rule's `id`, `value === 312`, `observedAt` matching the frame's wire timestamp, `ruleType === "instant"`, `deviceId` matching the frame's device, `metric === "tds_ppm"`.
- Given an `instant` rule with `operator: "eq"` and a reading `value === threshold`, when the engine runs, then it returns a `BreachResult`.
- Given an `instant` rule with `operator: "gte"` and a reading `value < threshold`, when the engine runs, then it returns no breach (empty array).
- Given the five `RuleOperator` tokens, `Object.keys(OPERATOR_COMPARATORS)` exactly matches `RULE_OPERATORS` in both keys and count, AND each comparator returns the documented truth value for `(300, 300)`.
- Given a `rate` rule with `threshold: 50` and 5 readings whose computed slope is `75/min` (i.e. `75/60_000 value/ms`), when the engine runs, then it returns a `BreachResult` with `value === computedSlope`.
- Given a `rate` rule with only 3 readings in the window, when the engine runs, then it returns no breach (insufficient data — architecture §4.5 minimum of 5).
- Given a `rate` rule, when a reading is older than 60 s or has `ts > observation.observedAt` (clock skew) or duplicates another reading's `ts`, then it is excluded from the slope computation by the hook's pre-filter (pin via the hook test that asserts the spy sees the post-filter array).
- Given an `absence` rule with `hysteresisSeconds: 60` and no reading for the device in the last 60 s, when the engine runs, then it returns a `BreachResult` with `ruleType: "absence"`, `value: 0`, `deviceId` = frame device.
- Given the same absence rule and a reading that arrived within 60 s, when the engine runs, then it returns no breach.
- Given `requireRuleType("instant")`, it does not throw; given `requireRuleType("bogus")`, it throws `Error("unsupported_rule_type: bogus")`.
- Given the ingest boot path runs `installRuleEngineHooks(...)`, when a frame for device `D` with `tds_ppm: 312` arrives, then `onRuleEvaluation` queries the cache via `lookupRulesForFrame`, evaluates matching rules, and returns a breach list — captured by `hooks.spec.ts` with stub repositories.
- Given the existing 649 tests across all 5 packages, when the engine is wired, then every test stays green (api 159 → api 159 + new tests from engine/cache/hooks/repo specs).
- Given a `Rule` row whose `ruleType` is anything other than `instant`, `rate`, or `absence`, when `hydrateActiveRuleCache` runs, then the row is rejected at hydration with a `console.warn` call (message contains `ruleType` and `id`) and excluded from both `byId` and `byDeviceMetric`. `cache.spec.ts` pins this with a 4th test.
- Given a frame with `metric: "ph" 8.5, tds_ppm: 0` and a cache holding a `ph` rule with threshold 8.0, when `onRuleEvaluation` runs, then the breach fires (proves the hook extracted the right metric, not always `tds_ppm`). Pinned by `hooks.spec.ts` test (c).
- Given a frame for device `D` arriving after `uninstallRuleEngineHooks()`, when `onRuleEvaluation` runs, then it returns `EMPTY_BREACH_RESULTS` (proves reset works). Pinned by `hooks.spec.ts` test (h).
- Given boot-time hydration fails (DB outage), then `setIngestHooks(noopHooks)` is called and the api continues to start; a `console.error` log records the failure. **Pinned by a new `packages/api/__tests__/boot-fallback.spec.ts`** that mocks `hydrateActiveRuleCache` to reject and asserts the boot code falls back. (This is a behavioral AC for the index.ts try/catch — without a test, the spec's claim "matches the existing `runMigrations` fallback pattern" is assertion-free.)
- Given the dual-semantics claim for `hysteresisSeconds`, when an instant rule and an absence rule both have `hysteresisSeconds: 60` and a reading arrives, then the engine does NOT use `hysteresisSeconds` in the instant eval path and DOES use it in the absence eval path. Pinned by a paired engine.spec.ts test that runs the same `hysteresisSeconds` through both evaluators with the same observation and asserts only the absence one changes outcome.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. Do not modify or delete existing entries. Empty until the first bad_spec loopback. -->

- **2026-08-25, loopback 1, triggering finding: 18 bad_spec findings from the adversarial + edge-case + verification-gap review layers.** Amended: defined `BreachCandidate` (private engine type) and pinned the `evaluateRules` projection; pinned `recentReadings` window/sort/dedup/slice/clock-skew contract at the hook; pinned rate slope formula (`x = ms.getTime()`, units = `value/ms`) and added a unit-aware test threshold; pinned `BreachResult.observedAt` = `observation.observedAt` for all rule types; pinned `BreachResult.value` semantics per ruleType (instant=reading value, rate=slope, absence=0); pinned `BreachResult.deviceId` = `observation.deviceId`; pinned global absence rule semantics; expanded engine tests from 14 to 19 to cover `computeSlope` + all-same-ts edge + boundary inclusive + provenance pin; expanded cache tests from 3 to 4 to cover unsupported-ruleType warning emission; expanded hooks tests from 4 to 8 to cover frame-to-observation + cache lookup + findMany spy + uninstall; added `boot-fallback.spec.ts` test (new AC #17) to pin the try/catch fallback; added `reading-repository-findmany.spec.ts` to pin the interface extension; added AC #16 for hysteresisSeconds dual-semantics test; added `lookupRulesForFrame` as a single canonical lookup entry point. **Known-bad state avoided:** if re-derivation had proceeded without these pins, two implementers would diverge on rate-slope units (off by ~60000×), on absence-rule `value` semantics (downstream 3.5 would show "TDS=0" for absence alerts), on cache key exact strings, on the boot-fallback silently swallowing errors, and on the unsupported-ruleType path emitting no warning. **KEEP instructions for positive preservation:** the user's three clarifying decisions (hysteresisSeconds reuse, in-memory cache at boot, breach-only emission) remain authoritative; the 5-operator closed mapping table remains the only site where Prisma tokens reach JS comparators; the engine remains READ-ONLY against `Rule`; the boot path remains inside the existing `resolveReadingDelegate().then(...)` chain.

## Design Notes

**`hysteresisSeconds` carries two semantics in v1.** For `instant` and `rate` rules it is the clearing grace period (after the reading drops back below threshold, the alert waits this long before clearing — wired in Story 3.4). For `absence` rules it is the fire-after-no-readings window. The engine is the single authority that switches semantic based on `ruleType`. If a future story adds a separate `noReadingForSeconds` column, this overload ends and the engine switches to the explicit value; the `OPERATOR_COMPARATORS` rename leaves consumers untouched. The dual-semantics invariant is pinned by AC #16 (paired engine test that runs both evaluators with the same `hysteresisSeconds` value and asserts only the absence path uses it).

**Operator mapping table is the only way camel-case Prisma enum tokens reach JS comparators.** The DB stores `gte`; the wire may reference `>=`; neither leaks into the engine math. `OPERATOR_COMPARATORS` is a `Record<RuleOperator, comparator>` so `tsc` rejects a missing operator at compile time when Story 3.1's enum ever grows. The runtime completeness pin (AC #4) ensures the table cannot drift from the enum without a test failing.

**The engine is READ-ONLY against `Rule`.** No `rule.create` / `rule.update` / `rule.delete`. Story 3.7 owns writes; the engine only loads at boot. The hydrate-then-freeze model is intentional: it matches the architecture's "in-memory rules engine" phrasing in §1 and keeps the per-frame path DB-free (the only DB call is the `Reading.findMany` the rate rule needs for the slope window).

**`recentReadings` is computed by the hook, not the engine.** The engine is pure — it gets the data it needs as an argument. The hook is the only place that touches the DB on the eval path. The hook's contract: query `reading.findMany` with `where: { deviceId, metric, ts: { gte: now - 60000 } }`, `orderBy: { ts: "asc" }`, `take: 5`; sort ascending; drop rows with `ts > observation.observedAt` (clock-skew guard); dedupe rows with identical `ts` keeping the latest value; pass the resulting `readonly { ts, value }[]` array as `EngineObservation.recentReadings`. Keeping the math pure means `engine.spec.ts` can run without any Prisma mock.

**`BreachResult.value` carries the observation at the moment of breach.** Instant = reading value (already in `observation.value`). Rate = computed slope (already in ms-units per `value/ms`). Absence = `0` (sentinel; downstream consumers distinguish via `ruleType === "absence"`, not via the value). This makes the field a single number across all rule types — Story 3.5's alert manager reads `ruleType` first to interpret the value.

**`BreachResult` shape is the minimum the engine knows.** It intentionally omits `threshold`, `operator`, `hysteresisSeconds`. Story 3.5's alert manager re-derives those by `ruleId` from the cache (or its own alert-side store). Adding them to `BreachResult` would duplicate state across the cache and the breach — keeping the breach minimal means a Story 3.7 hot-reload that flips a rule's `threshold` correctly propagates to new breaches without coordination.

**`onRuleEvaluation` return type change is backward-compatible via the no-op default.** Existing implementations (the no-op default) return `void`. This story extends the type to `Promise<readonly BreachResult[]>`; the no-op default returns `EMPTY_BREACH_RESULTS` (a frozen empty tuple) so the type is satisfied without allocating. The caller in `frame.ts:303` was already awaiting the promise; the only change is the local `await deps.hooks.onRuleEvaluation(...)` discards the new array (Story 3.5 picks it up via a follow-up `setIngestHooks` call OR a dedicated `setAlertManagerHooks(...)`). To keep Story 3.2's scope clean, the breach array is currently a no-op consumer-side; Story 3.5 hooks it up. **Migration note:** any pre-3.2 hook implementation (e.g. Epic 4 stubs) returning `void` MUST be updated when Epic 3 lands. The migration is a single-line return-type change in `packages/api/src/ingest/hooks.ts`.

**Boot fallback to no-op hooks on hydration failure.** A transient DB outage at boot must not crash the api — readings still persist and the socket still works; rules simply don't fire. This matches the existing `runMigrations` fallback pattern in `packages/api/src/index.ts`. The behavioral pin (AC #17 + `boot-fallback.spec.ts`) ensures this isn't accidentally dropped during re-derivation.

**Global absence rules are valid.** A rule with `deviceId: null` of type `absence` fires per-frame for every device whose last reading is older than `hysteresisSeconds`. This matches the architecture's "global rule" model (§4.2) and is not flagged as a special case in the engine — `lookupRulesForFrame` returns the union of `__global__::metric` and `${deviceId}::metric` keys, so a global absence rule is naturally evaluated for every device's frame.

## Verification

**Commands:**
- `pnpm -F @surakkha/api test` -- expected: existing 159 + 32 new (19 engine + 4 cache + 8 hooks + 1 boot-fallback) = 192.
- `pnpm -F @surakkha/shared test` -- expected: 131 (unchanged — no changes to `@surakkha/shared`).
- `pnpm -F @surakkha/db test` -- expected: 53 (unchanged — no schema changes).
- `pnpm -F @surakkha/web test && pnpm -F @surakkha/simulator test` -- expected: green.
- `pnpm -F @surakkha/db exec prisma validate && pnpm -F @surakkha/db exec prisma generate` -- expected: unchanged.
- Full test matrix across all 5 packages: `pnpm -r --if-present test`.

**Manual checks (if no CLI):**
- Open `packages/api/src/rules/engine.ts` and confirm `OPERATOR_COMPARATORS` has exactly 5 entries, one per `RuleOperator` value, AND `computeSlope` returns `null` for <5 points or zero time-axis denominator.
- Open `packages/api/src/rules/cache.ts` and confirm the index key format `${deviceId ?? "__global__"}::${metric}` is the only one used (no parallel index structure) AND the unsupported-ruleType path emits a `console.warn` with both `ruleType` and `id`.
- Open `packages/api/src/rules/hooks.ts` and confirm the rate-rule pre-filter chain is in this exact order: `findMany` → sort ascending → drop future-ts → dedupe → slice to 5 → pass to engine.
- Open `packages/api/src/ingest/frame.ts` and confirm `ReadingRepository.findMany` exists with the documented `where`/`orderBy`/`take` shape (signature pin via `reading-repository-findmany.spec.ts`).

## Suggested Review Order

**Evaluation engine (the WHY)**
- Pure rule math lives here — start with the operator table to confirm the closed mapping.
  [engine.ts:37](../../packages/api/src/rules/engine.ts#L37)

- Regression slope in mean-centered form to avoid catastrophic cancellation at Unix-ms scale.
  [engine.ts:139](../../packages/api/src/rules/engine.ts#L139)

- Per-rule dispatch with exhaustiveness pin; absence rule rejects non-positive hysteresis as defence-in-depth.
  [engine.ts:170](../../packages/api/src/rules/engine.ts#L170)

- Multi-rule entry projects BreachCandidate → BreachResult with the single agreed-upon observedAt source.
  [engine.ts:252](../../packages/api/src/rules/engine.ts#L252)

- Frozen empty-tuple sentinel so the no-op hooks default stays allocation-free.
  [engine.ts:303](../../packages/api/src/rules/engine.ts#L303)

**Active-rule cache**
- Per-row skip on unsupported `ruleType` with structured console.warn; valid rows in the same batch still load.
  [cache.ts:81](../../packages/api/src/rules/cache.ts#L81)

- Global sentinel + `__global__::metric` / `${deviceId}::metric` index — pinned by exact-string test assertions.
  [cache.ts:32](../../packages/api/src/rules/cache.ts#L32)

- The single lookup entry point — unions global + device-specific rules; the hook uses ONLY this.
  [cache.ts:178](../../packages/api/src/rules/cache.ts#L178)

**Hook wiring**
- Frame-to-observation path picks ONE metric, validates against the closed enum, queries the rate-rule window.
  [hooks.ts:91](../../packages/api/src/rules/hooks.ts#L91)

- Pre-filter chain runs in this exact order: findMany → sort asc → drop future-ts → dedupe → slice to 5.
  [hooks.ts:121](../../packages/api/src/rules/hooks.ts#L121)

- The four-hook install + uninstall reset to no-op via `resetIngestHooks`.
  [hooks.ts:170](../../packages/api/src/rules/hooks.ts#L170)

**Interface extensions (the seams)**
- IngestHooks.onRuleEvaluation return type widens to `readonly BreachResult[]`; pre-3.2 stubs must be updated.
  [hooks.ts:71](../../packages/api/src/ingest/hooks.ts#L71)

- ReadingRepository gains `findMany` with where/orderBy/take pinned by `reading-repository-findmany.spec.ts`.
  [frame.ts:62](../../packages/api/src/ingest/frame.ts#L62)

- Boot hydration wrapped in try/catch — failure logs and falls back to NOOP_HOOKS.
  [index.ts:454](../../packages/api/src/index.ts#L454)

**Tests (the pinning)**
- 21 engine tests cover the operator table, all 5 instant comparators, rate/absence math, field provenance, dual-semantics pin, hysteresis edge case.
  [engine.spec.ts](../../packages/api/src/rules/__tests__/engine.spec.ts)

- 4 cache tests pin empty/mixed/global+device/unsupported-ruleType paths; exact-string log format pinned.
  [cache.spec.ts](../../packages/api/src/rules/__tests__/cache.spec.ts)

- 8 hooks tests pin pre-filter chain order, findMany spying with deviceId/metric + ts clauses, cache lookup union, global absence firing, uninstall reset.
  [hooks.spec.ts](../../packages/api/src/rules/__tests__/hooks.spec.ts)

- 2 top-level api tests: boot-fallback source-walk + reading-repository-findmany signature pin.
  [boot-fallback.spec.ts](../../packages/api/__tests__/boot-fallback.spec.ts)

- Pre-3.2 hook mocks in frame.spec.ts + subscriberSocket.spec.ts migrated to return `EMPTY_BREACH_RESULTS`.
  [frame.spec.ts:304](../../packages/api/src/ingest/frame.spec.ts#L304)
