# Test spec — `packages/api/src/rules/` critique loop

**Date:** 2026-09-02
**Surface:** `packages/api/src/rules/` (refinement of headers + cross-file refs + story jargon + F-P# markers + Patch (spec-3-4 review...) markers)
**Companion critique:** `.impeccable/critique/2026-09-02T25-00-00Z__packages-api-src-rules.md` (22/40, 3 P1 + 33 P2)

This spec pins the load-bearing invariants of the rules surface that
survived the refactor pass. The header-trim + cross-file / story-codes /
F-P# / "Patch (spec-3-4 review...)" removal work does not change
behaviour; this spec verifies the contracts that depend on the surface
(pure engine math, de-bounce timer semantics, boot guard, $transaction
atomicity, post-commit emit ordering, partial-index idempotency) still
hold.

## Behavioural pins (Given/When/Then)

### Pure engine (engine.ts)

- **B-ENG-1**: Given `OPERATOR_COMPARATORS: Record<RuleOperator, (a, b) => boolean>`,
  when the table is read, then every `RuleOperator` literal
  (`gte | gt | lte | lt | eq`) has exactly one entry — a closed lookup
  pin (the `Record<RuleOperator, ...>` type rejects a missing entry at
  compile time when the enum grows).
- **B-ENG-2**: Given `evaluateRule` with `ruleType = "instant"` and
  `comparator(metricValue, threshold) = true`, when `evaluateRule` runs,
  then it returns a `BreachCandidate` with `value = observation.value`,
  `ruleType: "instant"`.
- **B-ENG-3**: Given `evaluateRule` with `ruleType = "rate"` and
  `observation.recentReadings` of length < 5, when `computeSlope`
  runs, then it returns `null` and `evaluateRule` returns `null`
  (no rate computation possible without ≥ 5 points).
- **B-ENG-4**: Given `evaluateRule` with `ruleType = "rate"` and
  `recentReadings` where all `ts` values are identical (degenerate
  column), when `computeSlope` runs, then it returns `null`
  (denominator is zero).
- **B-ENG-5**: Given `evaluateRule` with `ruleType = "absence"` and
  `hysteresisSeconds <= 0` OR non-finite, when `evaluateRule` runs, then
  it returns `null` (defense-in-depth — a poison rule row is treated
  as "no rule").
- **B-ENG-6**: Given `evaluateRule` with `ruleType = "absence"` and a
  recent-reading at `ts === observedAt - hysteresisSeconds*1000`
  (inclusive boundary), when `evaluateRule` runs, then
  `hasReadingInWindow = true` and it returns `null` (boundary
  clears the breach).
- **B-ENG-7**: Given `evaluateRule` with `ruleType = "absence"` and no
  recent-reading within the window, when `evaluateRule` runs, then
  it returns a `BreachCandidate` with `value: 0` and
  `ruleType: "absence"` (the `0` sentinel — downstream distinguishes
  absence via `ruleType`).
- **B-ENG-8**: Given `evaluateRules` with an observation where
  `value = NaN | Infinity | "-Infinity" | "5"` (non-number JSON
  poison), when `evaluateRules` runs, then it emits
  `console.warn('[engine] non-number metric value rejected: ...')`
  and returns `EMPTY_BREACH_RESULTS` (frozen empty tuple — no
  allocation).
- **B-ENG-9**: Given `evaluateRules` with N valid rules, when it runs,
  then for each non-null `BreachCandidate` it pushes a
  `BreachResult` with `deviceId = observation.deviceId` and
  `observedAt = observation.observedAt` (uniform timestamping +
  deviceId across all rule types).
- **B-ENG-10**: Given `requireRuleType("foobar")`, when called, then
  it throws `Error("unsupported_rule_type: foobar")`.
- **B-ENG-11**: Given `requireRuleType` for any of
  `"instant" | "rate" | "absence"`, when called, then it returns
  `undefined` (silent acceptance).
- **B-ENG-12**: Given `EMPTY_BREACH_RESULTS`, when imported, then
  `Object.isFrozen(EMPTY_BREACH_RESULTS) === true` (consumers MUST
  NOT mutate).

### De-bounce (debounce.ts)

- **B-DEB-1**: Given `debounceBreaches` with `rawBreaches = []` and
  `rules = []`, when called, then it returns
  `{ transitions: [], nextState: ...spread of currentState... }`
  (no-op frame; nothing to advance).
- **B-DEB-2**: Given `debounceBreaches` with `frameTs < lastSeenFrameTs`
  (clock skew), when called, then it emits
  `console.warn('[debounce] clock skew device=...')` and clamps BOTH
  `inViolationSince` and `clearedSince` forward to `frameTs`
  (symmetric clamp).
- **B-DEB-3**: Given `debounceBreaches` with a slot that has
  `inViolationSince: null` and a raw breach for the same slot, when
  called, then it returns a transition of `kind: "open"` only when
  `frameTs.getTime() - inViolationSince.getTime() >= minDurationSeconds*1000`
  (rising-edge elapsed). Otherwise the transition is `null` and
  only `inViolationSince` advances to `frameTs`.
- **B-DEB-4**: Given `debounceBreaches` with a slot that has
  `inViolationSince: <some-ts>` and a raw breach for the same slot,
  when called, then `inViolationSince` stays at the original
  timestamp (it does NOT advance on subsequent rising-edge frames —
  pause-not-reset).
- **B-DEB-5**: Given `debounceBreaches` with a slot that has
  `clearedSince: null` and NO raw breach for the same slot
  (falling edge starts), when called, then it initializes
  `clearedSince = frameTs` but PRESERVES `inViolationSince`
  (the rising timer pauses rather than resets).
- **B-DEB-6**: Given `debounceBreaches` with a falling-edge slot
  where `frameTs.getTime() - clearedSince.getTime() >= hysteresisSeconds*1000`
  AND `inViolationSince !== null`, when called, then it returns a
  transition of `kind: "clear"` AND nulls out `inViolationSince`
  for the next rising edge (timer reset on clear).
- **B-DEB-7**: Given `debounceBreaches` with multiple rules on the
  SAME slot key (e.g. range halves on `(ph, critical)`), when
  `indexRulesBySlot` runs, then the rule with the LOWEST `threshold`
  wins (tie-break by lexicographic `rule.id`) — the "first-wins"
  loop is deterministically ordered so the winner is stable across
  hot-reloads and across multi-replica deploys.
- **B-DEB-8**: Given `debounceBreaches` with a rule where
  `minDurationSeconds = 0.5` (fractional, NOT integer), when
  `indexRulesBySlot` runs, then the rule is SKIPPED with a warn
  log and the slot is left without a backing rule (fractional values
  would silently floor on Prisma write and trip the boot guard on
  the next reload).
- **B-DEB-9**: Given `debounceBreaches` with `slotKey`, the NUL
  delimiter (`${metric}\u0000${severity}`) is the canonical form —
  NUL is illegal in every metric + severity literal. The `hooks.ts`
  call site uses the same delimiter (key.split("\u0000") splits the
  precomputed key for the post-debounce state upsert).
- **B-DEB-10**: Given a slot present in `breachSlots` (raw breach
  fired this frame) but NOT in `rulesBySlot` (rule deactivated), when
  `debounceBreaches` runs, then `advanceSlot` returns
  `{ transition: null, nextSlot: prevSlot }` (stale-state-no-rule —
  state row untouched).

### Cache (cache.ts)

- **B-CACHE-1**: Given `hydrateActiveRuleCache` with N rule rows
  where ONE row has `ruleType = "foobar"` (unsupported), when
  hydration runs, then:
  1. `console.warn('[rules] hydrate: skipped unsupported ruleType=foobar id=...')` fires
  2. The bad row is excluded from BOTH `byId` AND `byDeviceMetric`
  3. The remaining valid rows are returned in the cache
     (per-row rejection, not all-or-nothing)
- **B-CACHE-2**: Given a global rule (`deviceId = null`) and a
  per-device rule on the same metric, when `lookupRulesForFrame`
  runs with the device's UUID, then it returns the UNION of
  `__global__::${metric}` rules + `${deviceId}::${metric}` rules
  (global rules fire for every device's frame).
- **B-CACHE-3**: Given `GLOBAL_DEVICE_SENTINEL = "__global__"` and
  `INDEX_SEPARATOR = "::"`, the index key for a global rule on
  metric `ph` is the literal string `"__global__::ph"` (pinned by
  `cache.spec.ts` — a refactor that drifts the separator silently
  breaks all hook lookups).
- **B-CACHE-4**: Given `projectRow`, the projection produces an
  `EngineRule` with `minDurationSeconds: row.minDurationSeconds`
  (the de-bounce layer reads this field from the projected rule
  without re-querying Prisma).
- **B-CACHE-5**: Given `requireRuleType(row.ruleType as string)` in
  `buildCacheFromRows`, the `as string` cast is required because
  `row.ruleType` is typed as `RuleRuleType` but the runtime check
  needs `string` — `requireRuleType` is a throwing function (not
  an assertion signature) so the call works without TS2775's "every
  name in the call target must be explicitly typed" constraint.

### Hooks (hooks.ts)

- **B-HOOK-1**: Given `installRuleEngineHooks` with a Rule cache
  containing ONE rule with BOTH `minDurationSeconds === 0` AND
  `hysteresisSeconds === 0`, when called, then it:
  1. Emits `console.warn('[debounce] write-amplification guard:
ruleId=... has min=0 AND hysteresis=0')`
  2. Throws `WriteAmplificationError([ruleId])` enumerating EVERY
     offender (not just the first).
- **B-HOOK-2**: Given `installRuleEngineHooks` with N rules each
  having BOTH `minDurationSeconds === 0` AND
  `hysteresisSeconds === 0`, when called, then `WriteAmplificationError`
  carries ALL N `ruleId`s in its `ruleIds` array (operators see all
  bad configs in one boot failure).
- **B-HOOK-3**: Given the api boot catches `WriteAmplificationError`,
  when the catch handler runs, then the api process exits with code
  78 (`EX_CONFIG`).
- **B-HOOK-4**: Given `installRuleEngineHooks` with a valid cache
  (no write-amplification offenders), when called, then it returns
  `IngestHooks` with `onRuleEvaluation`, `onAlertEmission`,
  `onStateMachineUpdate`, `onAuditAppend` methods.
- **B-HOOK-5**: Given `installRuleEngineHooks` with `broadcast`
  not passed (production-side regression), when called, then the
  hook installs a `noopBroadcast` default — defense-in-depth so
  tests that forget to pass `broadcast` do not crash.
- **B-HOOK-6**: Given `buildRecentReadings` and a `Reading` row with
  a non-finite `metric value` (NaN / Infinity from a buggy sensor),
  when the dedupe-by-ts loop runs, then the row is SKIPPED (not
  added to `valueByTs`). A non-finite value would poison
  `computeSlope`.
- **B-HOOK-7**: Given `onRuleEvaluation` and the `applyTransition`
  IO throws, when the `try/finally` block runs, then
  `lastSeenFrameTs.set(deviceId, observedAt)` does NOT execute
  (the IO failure leaves the prior timestamp in place so the next
  frame re-evaluates against the same `lastTs`).
- **B-HOOK-8**: Given `onRuleEvaluation` returns successfully, when
  the `finally` block runs, then `lastSeenFrameTs.set(deviceId,
observedAt)` IS recorded (the IO succeeded — advance the
  clock-skew guard).
- **B-HOOK-9**: Given `uninstallRuleEngineHooks()`, when called, then
  the module-level `currentHooks` in `packages/api/src/ingest/hooks.ts`
  is reset to the no-op default (test-only escape hatch; production
  boot path never calls it).

### Apply-transition (applyTransition.ts)

- **B-APP-1**: Given `applyOpenTransition` and an existing open
  alert for `(deviceId, metric, severity)` returned by
  `findOpenAlert` (idempotency fast path), when the transaction
  runs, then:
  1. `console.warn('[alerts] duplicate open suppressed ...')` fires
  2. The slot's `inViolationSince` is still upserted (state row
     advances even when the alert is suppressed)
  3. `alertId` remains `null` (no new Alert row, no post-commit
     emit)
- **B-APP-2**: Given `applyOpenTransition` and `tx.alert.create`
  throws `isPrismaP2002(err) === true` (race: another concurrent
  insert beat us), when the catch handler runs, then:
  1. `console.warn('[alerts] duplicate open suppressed (race) ...')` fires
  2. The slot's `inViolationSince` is upserted (P2002 catch still
     advances the timer)
  3. The function returns BEFORE the Incident auto-create (AC3 —
     losing writers do not create duplicate Incidents)
- **B-APP-3**: Given `applyOpenTransition` and the transaction
  commits with `shouldCreateIncident(severity) === true`, when the
  transaction runs, then the Incident row + Notification row + state
  upsert commit atomically with the Alert row (any throw rolls back
  all four).
- **B-APP-4**: Given `applyOpenTransition` and the Incident auto-create
  throws a non-P2002 error, when the inner try/catch runs, then:
  1. `console.warn('[alerts] incident auto-create failed; alert
path continues ...')` fires
  2. The Alert row IS still committed (the try/catch isolates the
     failure from the transaction's atomicity contract)
  3. The `alert:opened` emit still fires post-commit
- **B-APP-5**: Given `applyOpenTransition` and the transaction
  resolves with `alertId !== null`, when the post-commit emit
  handler runs, then `broadcast.to('device:' + deviceId).emit('alert:opened', payload)`
  fires IF `AlertOpenedEventSchema.safeParse(payload).success === true`.
  Otherwise the emit is skipped and `console.warn` logs the parse
  error.
- **B-APP-6**: Given `applyOpenTransition` and the Alert emit
  parse FAILS, when the incident emit block runs, then it still
  ATTEMPTS to fire `incident:opened` (the two emissions are
  independent — alert schema drift is not a reason to suppress the
  incident notification).
- **B-APP-7**: Given `applyOpenTransition` and
  `IncidentOpenedEventSchema.safeParse(incidentPayload).success === true`,
  when the post-commit emit runs, then it emits on TWO rooms:
  1. `device:${deviceId}` (device-watcher subscription)
  2. `incident:${incidentId}` (detail-page subscription)
- **B-APP-8**: Given `applyOpenTransition` and an auto-created
  Incident row, when the observability log fires, then it emits a
  JSON line with `event: "incident_transition"`, `to: "OPEN"`,
  `verb: "auto_create"`, `actor_user_id: null` (distinguishes
  system-driven from operator-driven transitions).
- **B-APP-9**: Given `applyClearTransition` and `findOpenAlert`
  returns `null` (no open alert for the slot), when the transaction
  runs, then:
  1. `console.warn('[alerts] clear transition with no open alert ...')` fires
  2. The state row upsert runs INSIDE the transaction (atomicity —
     Alert row + state row commit as one unit, even on the no-open
     branch)
  3. `clearedAlertId` remains `null` (no post-commit log)
- **B-APP-10**: Given `applyClearTransition` and the transaction
  commits with `existing !== null`, when the post-commit log fires,
  then `console.warn('[alerts] cleared alertId=... clearedAt=...')`
  logs the resolution (no socket emit — `alert:cleared` is out of
  scope; clients poll or refresh).

### Slice adapters (prismaReader.ts + findOpenAlert.ts + alertStateRepository.ts)

- **B-SLICE-1**: Given `resolvePrismaRuleReader(realPrismaClient)`,
  when called, then the returned object exposes `rule.findMany(args)`
  where `args` matches the `PrismaRuleReader` slice (forwarding to
  `client.rule.findMany`).
- **B-SLICE-2**: Given `resolvePrismaAlertReader(realPrismaClient)`,
  when called, then the returned object exposes `alert.findFirst(args)`
  with `where.clearedAt === null` (forwarding to `client.alert.findFirst`).
- **B-SLICE-3**: Given `resolveAlertStateRepository(realPrismaClient)`,
  when called, then the returned object exposes `ruleDebounceState`,
  `alert`, `incident`, `notification`, and `$transaction` slices
  (each forward to the corresponding `client.<X>` method).
- **B-SLICE-4**: Given `AlertStateRepository.$transaction(cb)`,
  when called with a callback, then it invokes
  `client.$transaction(cb)` and passes a `tx` argument shaped as
  `AlertStateRepository` (the same shape the callback receives).
- **B-SLICE-5**: Given the `severity` filter on
  `ruleDebounceState.findMany`, it accepts BOTH the direct-equality
  form (`severity: "info"`) AND the `{ in: [...] }` form (so Prisma
  doesn't have to build a one-element IN clause).
- **B-SLICE-6**: Given `isPrismaP2002(err)` and `err.code === "P2002"`,
  when called, then it returns `true`.
- **B-SLICE-7**: Given `isPrismaP2002(err)` and `err` is null OR
  non-object OR `err.code !== "P2002"`, when called, then it returns
  `false` (narrow type guard — minimal `code` check).

### Incident helper (incidentFromAlert.ts)

- **B-INC-1**: Given `shouldCreateIncident("warning")` and
  `shouldCreateIncident("critical")`, when called, then both return
  `true` (medium + high severity create incidents).
- **B-INC-2**: Given `shouldCreateIncident("info")`, when called, then
  it returns `false` (informational only — no work item).
- **B-INC-3**: Given `shouldCreateIncident("foobar")` (unknown
  severity), when called, then it returns `false` (defense-in-depth
  against wire-format drift; the closed set bounds the unknown value).
- **B-INC-4**: Given `buildIncidentPayload(input)`, when called, then
  the returned object has `state: "OPEN"`, `assigneeUserId: null`,
  `acknowledgedAt: null`, `resolvedAt: null` (auto-create lands in
  OPEN with no human assignment).

## Static / lint pins (Property/Required value)

- **S-1**: All 9 modified source files in `packages/api/src/rules/` have
  NO `/** ... */` block opening longer than 7 lines.
- **S-2**: No file in `packages/api/src/rules/` contains the string
  `F-P` (fix-history markers removed).
- **S-3**: No file in `packages/api/src/rules/` contains a line
  reference of the form `\w+\.ts:\d+` (cross-file line refs removed).
- **S-4**: No file in `packages/api/src/rules/` contains `Story 3.1`,
  `Story 3.2`, `Story 3.4`, `Story 3.5`, `Story 3.6`, `Story 3.7`,
  `Story 4.2`, `Story 4.4`, `Story 4.9`, or `Story 5.x` codes (story-
  jargon in source removed; the spec is the canonical record).
- **S-5**: No file in `packages/api/src/rules/` contains
  `Patch (spec-3-4 review`, `Patch (code review 2026-08-27`,
  `[Review][Patch]`, `loopback-1 Finding`, `Loopback-1 Finding`,
  `Story 3.4 review-finding` (the patch-history markers removed).
- **S-6**: No file in `packages/api/src/rules/` contains the strings
  `AC1`, `AC2`, `AC3`, `AC4`, `AC6`, `AC12`, `FR-14`, `AR-7`,
  `architecture §`, `PRD §`, `ADR-3`, `AI-3.2`, `AI-3.3` (the spec
  code / architecture-doc codes removed from source).
- **S-7**: `engine.ts`'s `default: never` exhaustive check at the end
  of `evaluateRule`'s switch is preserved (the `never` type-pinning
  catches new `RuleRuleType` entries that aren't wired to a handler).
- **S-8**: `debounce.ts`'s NUL-delimiter `slotKey` is preserved exactly
  (`${metric}\u0000${severity}` — load-bearing for the closed-enum
  safety pin).
- **S-9**: `cache.ts`'s `GLOBAL_DEVICE_SENTINEL = "__global__"` and
  `INDEX_SEPARATOR = "::"` constants are preserved exactly
  (load-bearing for the per-device / global lookup union).
- **S-10**: `hooks.ts`'s `EX_CONFIG = 78` exit-code constant is
  preserved exactly (sysexits.h EX_CONFIG; the api boot path
  catches `WriteAmplificationError` and exits this code).
- **S-11**: `hooks.ts`'s `RATE_WINDOW_MS = 60_000` and
  `RATE_MAX_POINTS = 5` constants are preserved exactly
  (engine contract: needs ≥ 5 points for `computeSlope`).
- **S-12**: `applyTransition.ts`'s `PRISMA_P2002 = "P2002"` constant
  is preserved exactly (Prisma's unique-constraint violation code).
- **S-13**: `pnpm tsc -b` runs green on `packages/api`.
- **S-14**: `pnpm eslint src/rules` runs green (no complexity
  violations, no max-lines violations).

## Behaviour / Must-NOT (negative pins)

- **N-1**: When `evaluateRules` is called with a poison
  `observation.value` (NaN, Infinity, non-number), it MUST NOT
  silently pass through — the warn + empty result is the contract.
- **N-2**: When `debounceBreaches` runs with `frameTs < lastSeenFrameTs`
  (clock skew), it MUST NOT leave `inViolationSince` or `clearedSince`
  pointing to a future timestamp — the clamp applies to BOTH fields,
  symmetrically.
- **N-3**: When `debounceBreaches` advances a falling-edge slot, it
  MUST NOT reset `inViolationSince` to `null` UNLESS the falling
  timer has elapsed AND an open alert existed (the pause-not-reset
  rule applies during the drop-frame BETWEEN rising and clear).
- **N-4**: When `hydrateActiveRuleCache` encounters a row with an
  unsupported `ruleType`, it MUST NOT throw — per-row rejection
  means valid rows in the same batch still load.
- **N-5**: When `installRuleEngineHooks` runs with a write-
  amplification offender, it MUST NOT silently downgrade to
  `NOOP_HOOKS` (the boot path catches `WriteAmplificationError` and
  exits 78 EX_CONFIG — configuration errors do NOT degrade
  gracefully).
- **N-6**: When `applyOpenTransition` and `findOpenAlert` returns
  an existing open alert (idempotency fast path), it MUST NOT emit
  a new `alert:opened` (the existing alert's socket emit already
  fired from the original transition).
- **N-7**: When `applyOpenTransition` and the P2002 race catch
  fires, it MUST NOT auto-create a duplicate Incident (AC3 — losing
  writers do not create duplicate Incidents).
- **N-8**: When `applyOpenTransition`'s inner try/catch fires on a
  non-P2002 Incident-write error, it MUST NOT abort the entire
  `$transaction` (the Alert row IS already committed; the
  try/catch isolates the Incident-write failure from the
  transaction's atomicity contract).
- **N-9**: When `applyOpenTransition`'s `AlertOpenedEventSchema`
  parse fails, the post-commit emit MUST NOT fire — but the
  `incident:opened` emit (if `incidentId !== null`) MUST still
  ATTEMPT (the two emissions are independent).
- **N-10**: When `applyClearTransition` runs and `findOpenAlert`
  returns `null` (no open alert), it MUST NOT throw — the state row
  upsert still runs INSIDE the transaction; the function returns
  without a post-commit log.
- **N-11**: When `uninstallRuleEngineHooks` is called from the boot
  path (production code), it MUST NOT — the boot path never calls
  this; only the test rig does. (This is a test-only escape hatch.)
- **N-12**: When `isPrismaP2002(err)` is called on an error whose
  shape varies across Prisma versions, it MUST rely ONLY on the
  `code` field — no `meta`, no `clientVersion`, no `message` checks
  (those drift across versions).
- **N-13**: When `requireRuleType` is called with an unsupported
  rule type, it MUST throw a regular `Error` — NOT use the
  `asserts value is RuleRuleType` assertion signature (which would
  require TS2775's "every name in the call target must be
  explicitly typed" constraint on the row iterator).

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/rules
cd packages/api && npx vitest run src/rules
```

Existing specs (must stay green):

- `rules/__tests__/engine.spec.ts` — pure engine math + BreachResult
  projection
- `rules/__tests__/debounce.spec.ts` — 11+ I/O Matrix rows
  (rising/falling/pause-not-reset/clock-skew clamp/deterministic sort)
- `rules/__tests__/cache.spec.ts` — hydration + lookup + per-row
  rejection
- `rules/__tests__/hooks.spec.ts` — full hook wiring + boot guard
- `__tests__/engine-rule-migration.spec.ts` — projection compatibility

The contract surfaces verified here are load-bearing for downstream
consumers:

- `evaluateRules` → ingest/hooks.onRuleEvaluation → Alert row +
  Incident auto-create + Notification write
- `debounceBreaches` → `RuleDebounceState` row writes via the hook
- `applyOpenTransition` → `alert:opened` + `incident:opened` socket
  emits
- `applyClearTransition` → `Alert.clearedAt` update
- `hydrateActiveRuleCache` → api boot path
- `WriteAmplificationError` → api boot path exits 78 (EX_CONFIG)
- `findOpenAlert` → idempotency-fast-path inside the open `$transaction`
- `OPERATOR_COMPARATORS` (engine) → closed lookup pin for `RuleOperator`
- `shouldCreateIncident` (incidentFromAlert) → auto-create decision
  (info → skip; warning + critical → create)
