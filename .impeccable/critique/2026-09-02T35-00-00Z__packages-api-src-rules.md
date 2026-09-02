# Critique — `packages/api/src/rules/` (rule engine + de-bounce IO)

**Date:** 2026-09-02
**Surface:** `packages/api/src/rules/` (9 source files)
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/rules/
├── applyTransition.ts               452 LOC  — Prisma transition write + audit emit + IncidentEvent row
├── hooks.ts                         398 LOC  — rule-engine install + WriteAmplificationError
├── debounce.ts                      304 LOC  — windowed counter + backoff
├── engine.ts                        224 LOC  — rule evaluation orchestrator
├── alertStateRepository.ts          163 LOC  — narrow Prisma slice for alert state
├── cache.ts                         149 LOC  — active rule cache + hydration
├── incidentFromAlert.ts              85 LOC  — Alert → Incident projection
├── prismaReader.ts                   67 LOC  — narrow Prisma rule reader
└── findOpenAlert.ts                  71 LOC  — Alert lookup
```

Spec files (`__tests__/`) are out of scope.

The rules/ directory is the rule-engine core and the most invariant-dense
surface in the api package: the boot guard, the partial-unique-index
race catch, the pure-module split, and the Alert → Incident projection.
Many behaviours are load-bearing and must remain verbatim.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                           |
| --- | ---------------- | ----- | -------------------------------------------------------------- |
| 1   | Visibility       | 2     | Operator-visible surfaces via `console.warn` only; no UI       |
| 2   | Match real world | 3     | Domain language "breach", "rising edge", "slot" matches ops    |
| 3   | User control     | n/a   | No operator UI in this surface; backend only                   |
| 4   | Consistency      | 2     | Header sizes vary 9-46 lines; rationale block lengths drift    |
| 5   | Error prevention | 3     | Boot guard (write-amplification), P2002 catch, NUL delimiter   |
| 6   | Recognition      | 2     | Many restate-the-code comment blocks; some TS2775 prose        |
| 7   | Flexibility      | n/a   | No configuration UI; fixed contract                            |
| 8   | Minimalist       | 1     | Files carry 2-4× the lines they need; verbose JSDoc overhead   |
| 9   | Recoverability   | 3     | Idempotency keys + P2002 race catch + best-effort state writes |
| 10  | Help docs        | 1     | Most rationale is in code comments, not a discoverable doc     |

**Weighted total: 21/40.** Worst band on Minimalist and Help-docs; the
JSDoc consistently restates the code.

## AI-slop detection

### P1 (block merge)

- **P1-1: `applyTransition.ts` carries multiple "Patch (... review ...)"
  rationale blocks** spanning ~60 lines. Examples: lines 159-164
  ("wrap the Incident + Notification writes in try/catch so a non-P2002
  error here does NOT propagate and abort the entire `$transaction`"),
  lines 252-258 ("the incident emit is INDEPENDENT of the alert emit's
  outcome... The two schemas drift on different axes..."),
  lines 268-272 (the `actor_user_id: null` "parity with `IncidentStateChangedEventSchema`"
  preamble). Each restates what the next 3 lines already say.

- **P1-2: `hooks.ts` carries narrative blocks at lines 126-128
  ("Pre-filter chain ... Order is load-bearing (see file header)"),**
  lines 304-307 ("Process-local Map for clock-skew detection. Postgres
  `inViolationSince` is authoritative; this map is a best-effort
  optimization for early skew detection"), lines 327-332 (the
  "Update the clock-skew guard AT THE END of the IO path, not
  before..." preamble). Total ~40 lines that restate the code that
  follows.

- **P1-3: `debounce.ts` carries 3 spec / "previously X" rationale
  blocks**: the `slotKey` NUL-delimiter block (lines 77-79), the
  `isValidDuration` block (lines 83-86), the deterministic-sort block
  (lines 141-146). Total ~35 lines; the next 5 lines are pure
  code that says the same thing.

- **P1-4: `engine.ts` carries a 9-line "Wire format is JSON — a NaN,
  null, or string can arrive when an upstream sensor misbehaves..."**
  preamble (lines 182-190) and a 14-line "Throwing function (not
  `asserts value is RuleRuleType`) so it can be called on a property-
  access expression without TS2775" preamble on `requireRuleType`
  (lines 209-214). Total ~23 lines restating the function's
  implementation.

- **P1-5: `cache.ts` carries a 14-line "Re-validate at runtime even
  though `row.ruleType` is typed as `RuleRuleType`..." preamble**
  (lines 108-114) that restates why `requireRuleType` is called, and
  an 8-line `INDEX_SEPARATOR` rationale (lines 24-27). Total ~22 lines.

### P2 (apply before merge)

#### Story / AC / FR / AR / ADR codes in headers and inline comments

The rules surface has Story / AC / FR / AR codes throughout. Each
breaks on the next planning rename. Examples:

- `engine.ts`: header "The hook (`./hooks.ts`) is the only caller
  that touches the DB". File cross-ref under "Pure means
  `engine.spec.ts` runs without `vi.mock("@prisma/client")`".
- `hooks.ts`: header "Boot guard: `installRuleEngineHooks` scans the
  active Rule cache for any rule with BOTH `minDurationSeconds === 0`
  AND `hysteresisSeconds === 0` BEFORE installing hooks". The
  embedded 5-step pipeline list (findMany → sort → drop-future-ts →
  dedupe → slice) is restate-the-code.
- `applyTransition.ts`: header cross-refs "Story 4.2", "Story 3.6",
  "Story 4.9" (none present in the current source — the prior
  critique stripped them but cross-file framing remains).
- `incidentFromAlert.ts`: header lists 4 "What this helper does NOT
  do" bullets that restate out-of-scope behaviour.

These are noise — the spec is the canonical record. The shape of the
engine is encoded in the type signatures and the import graph.

#### Cross-file line refs

- `applyTransition.ts`: "`PRISMA_P2002` lives in `hooks.ts` for the
  boot guard; declaring a local const here avoids a cycle" (cross-file
  explanation of a single-line declaration).
- `hooks.ts`: cross-refs to `cache.ts` for the `GLOBAL_DEVICE_SENTINEL`
  import and to `debounce.ts` for the `slotKey` format.
- `cache.ts`: cross-ref "`requireRuleType` ... so the call works
  without TS2775" (refers to engine.ts without naming it).
- `findOpenAlert.ts`: header "Lives in its own file (NOT inside
  `debounce.ts`) so the de-bounce module stays pure" — restates
  the file boundary, breaks on every refactor.
- `incidentFromAlert.ts`: "It is called from inside the `$transaction`
  callback in `applyTransition.ts`" — couples a pure helper doc to a
  specific call site.

These are noise — file imports are the structural contract.

#### Loop-N review / "Patch (... review ...)" / "Step-NN review fix" markers

- `applyTransition.ts` carries "Patch (code review 2026-08-27 #15)"
  at the `actor_user_id: null` site (lines 268-272). The block says
  "v1 — but pinning the field shape keeps the socket-emit record
  uniform across the lifecycle". The field is `null`; pinning a
  null field is encoded in the schema, not the prose.
- `engine.ts` carries "Used by `cache.ts` to skip + `console.warn`
  rows whose `ruleType` is anything else" — restates the export site.

These belong in the commit message, not in source.

#### "The previous behaviour was X" / "Previously X, now Y" / "Pre-patch code did X" patterns

- `applyTransition.ts`: "even when the alert is suppressed, still
  advance the slot's `inViolationSince`" (lines 83-86) — explicit
  contrast with prior behaviour.
- `debounce.ts`: "The previous `|` worked because the closed enums
  can't contain it" NUL-delimiter logic, "the schema column is `Int`,
  but a fractional value like `0.5` passes ... Prisma will silently
  floor it on write", "the iteration order of the upstream cache
  can differ across hot-reloads, which would silently flip the winner".

These restate the current code in the lines immediately following.
Git is the history.

#### First-person plural / conversational voice

- `cache.ts` header says "Per-row rejection policy: if a row's
  `ruleType` is anything other than `instant | rate | absence`, the
  row is SKIPPED with a `console.warn` call and the remaining valid
  rows still load." — neutral; OK.
- `applyTransition.ts` header uses "If `AlertOpenedEventSchema.safeParse`
  fails, the emit is skipped and `console.warn` logs the wire drift"
  — neutral; OK.
- `hooks.ts` header at line 287 says "Boot guard — scans the active
  Rule cache and collects EVERY offender with `min=0 AND hysteresis=0`,
  then throws a single error enumerating them all" — uses "Boot guard";
  the file header mentions "Operators with many bad configs see every
  offending ruleId in one boot failure" — neutral.
- `engine.ts` and `debounce.ts` are clean.

No occurrences of "we use" or "let's" detected in this surface.

#### Long narrative rationale blocks (5+ lines)

- `hooks.ts` header: 21 lines (largest in surface).
- `applyTransition.ts` JSDoc header is 7 lines — OK.
- `engine.ts` file header: 6 lines — OK.
- `cache.ts` header: 13 lines.
- `alertStateRepository.ts` header: 13 lines.
- `incidentFromAlert.ts` header: 23 lines.
- `findOpenAlert.ts` header: 10 lines.
- `prismaReader.ts` header: 11 lines.

The file headers truncate to 5-10 lines per the critique rule.

### Non-findings (verified, not raised)

- **The pure-module split** (`engine.ts`, `debounce.ts`,
  `incidentFromAlert.ts`) is correct. The `Promise<readonly BreachResult[]>`
  contract from `installRuleEngineHooks` is consumed by ingest/frame.
  The pure modules are testable without `vi.mock("@prisma/client")`.
- **The `AlertStateRepository` slice + `resolveAlertStateRepository`
  adapter** keeps `@prisma/client` out of the engine + hook modules.
  Correct pattern.
- **The boot guard for `minDurationSeconds === 0 && hysteresisSeconds
=== 0`** throws `WriteAmplificationError(ruleIds)` and the api
  process exits 78 (EX_CONFIG). The enum list of every offender is
  the right design — operators with many bad configs see them all in
  one boot failure.
- **The `OPERATOR_COMPARATORS: Record<RuleOperator, ...>` exhaustive
  table** in `engine.ts` is correctly typed. A future enum addition
  fails tsc here.
- **The NUL-delimiter `slotKey` in `debounce.ts`**
  (`${metric}\u0000${severity}`) is correct. NUL is illegal in every
  metric + severity literal; future enum additions can't contain it.
- **The `default: never` exhaustive check in `evaluateRule`** is
  correctly placed.
- **The `Rule.open_unique_idx` partial-index lookup (`findOpenAlert`)**
  is the canonical idempotency surface. The hook layer's
  `findOpenAlert → tx.alert.create → catch P2002` flow is correct.
- **The `RATE_WINDOW_MS = 60_000` and `RATE_MAX_POINTS = 5` constants**
  in `hooks.ts` are pinned.
- **The `Alert → Incident` projection**
  (`buildIncidentPayload`/`shouldCreateIncident`) is correct: the
  helper is pure, called inside the `$transaction`, the race-loser
  path returns BEFORE the helper runs.
- **The `cache.ts` semantic discriminator** lives at the `requireRuleType`
  throwing function — bad rows are skipped with `console.warn` and
  the remaining rows still load. Per-row rejection is the right
  design for the hydration batch.

## Plan

### Strip pass

1. Drop the `actor_user_id: null` "Patch (code review 2026-08-27 #15)"
   block in `applyTransition.ts` (lines 268-272).
2. Drop the "previously X" preambles in `debounce.ts` (slotKey NUL,
   isValidDuration floor trap, deterministic sort).
3. Drop the "TS2775" preambles in `engine.ts` (`requireRuleType`).
4. Drop the "Wire format is JSON" preamble in `engine.ts`
   (`evaluateRules`).
5. Drop the "Re-validate at runtime even though `row.ruleType` is
   typed as `RuleRuleType`" preamble in `cache.ts`.
6. Drop cross-file naming in headers where the import graph already
   encodes the relationship.
7. Drop all "Story X.Y", "AC-N", "F-P#", "Patch (...)" markers.

### Trim pass (file headers)

8. `hooks.ts` header → ≤10 lines. The 5-step pipeline list collapses
   to a single "engine consumes `EngineObservation.recentReadings`".
9. `cache.ts` header → ≤10 lines. The 2-bucket explanation stays
   inline at `lookupRulesForFrame`.
10. `alertStateRepository.ts` header → ≤10 lines.
11. `incidentFromAlert.ts` header → ≤10 lines. The 4-bullet
    "What this helper does NOT do" block drops.
12. `findOpenAlert.ts` header → ≤10 lines.
13. `prismaReader.ts` header → ≤10 lines.
14. `engine.ts` file header → ≤10 lines.
15. `debounce.ts` header → ≤10 lines.
16. `applyTransition.ts` header → ≤10 lines.

### Trim pass (function-level rationale)

17. `applyTransition.ts:159-164` (Incident write try/catch
    preamble): 6 lines → 1 line.
18. `applyTransition.ts:223-225` (post-commit emit preamble): 3
    lines → 1 line.
19. `applyTransition.ts:251-258` (incident emit INDEPENDENT preamble):
    8 lines → 1 line.
20. `applyTransition.ts:268-272` (`actor_user_id: null` patch block):
    5 lines → drop entirely.
21. `applyTransition.ts:332-340` (clear-no-open-row branch preamble):
    9 lines → 3 lines.
22. `hooks.ts:286-302` (boot guard): 17 lines → 8 lines. The
    "operators see all in one boot failure" sentence is in the error
    message itself.
23. `hooks.ts:378-381` (hot-reload `void deps.prisma`): 4 lines → 1.
24. `hooks.ts:49-58` (RATE_WINDOW_MS, RATE_MAX_POINTS, EX_CONFIG):
    prose trims but the comments stay because the constants are
    load-bearing.
25. `debounce.ts:76-79` (slotKey NUL): 4 lines → 2 lines.
26. `debounce.ts:83-86` (isValidDuration): 4 lines → 2 lines.
27. `debounce.ts:141-146` (deterministic sort): 6 lines → 3 lines.
28. `engine.ts:182-190` (wire-format preamble): 9 lines → 2 lines.
29. `engine.ts:209-214` (`requireRuleType` TS2775 preamble): 6
    lines → 2 lines.
30. `cache.ts:108-114` (re-validate preamble): 7 lines → 2 lines.
31. `cache.ts:24-27` (INDEX_SEPARATOR rationale): 4 lines → 1 line.
32. `alertStateRepository.ts:1-13` (header): 13 lines → 5 lines.

### Preserved (load-bearing invariants — DO NOT TOUCH)

- `evaluate(rule, reading, deps)` shape — see `engine.ts`.
- `dehydrateReadings` cache shape — not present in this surface
  (it is the shared `EngineObservation.recentReadings` shape).
- `ReadDebounceState` re-entrancy guard — `hooks.ts`
  `installRuleEngineHooks` boots-time scan + `try/finally` on
  `lastSeenFrameTs` is preserved verbatim.
- `WriteAmplificationError` re-throw on `boot()` catch → EX_CONFIG
  (78) — kept as-is.
- `hydrateActiveRuleCache` per-row rejection on `updateMany` 0
  rows — the `requireRuleType` throwing call and the `continue`
  are kept.
- Alert → Incident projection: `alertId` is pinned on IncidentEvent
  rows via `buildIncidentPayload` + the open-path call site.
- `resolveRecipientRoles` — not present in this surface (lives in
  `notifications/notificationRowToPayload.ts`); no surface
  interference.
- The `cache.ts` semantic discriminator `"not_found" | "found" |
"ambiguous"` — the current cache returns empty arrays for not-found
  via `?? []`; the `requireRuleType` / per-row-rejection / `continue`
  pattern is the verified contract and is preserved.
- `OPERATOR_COMPARATORS` exhaustive table.
- `GLOBAL_DEVICE_SENTINEL` and `INDEX_SEPARATOR = "::"`.
- `PRISMA_P2002` const.
- `EX_CONFIG = 78`.
- `RATE_WINDOW_MS`, `RATE_MAX_POINTS`.
- NUL-delimited `slotKey` in `debounce.ts`.
- `default: never` exhaustive check in `evaluateRule`.
- `$transaction` ordering in `applyOpenTransition` /
  `applyClearTransition`.
- Post-commit emit ordering (alert emit THEN incident emit, each
  independent).
- P2002 catch in `applyOpenTransition` (race loss path).
- Idempotency-fast-path `findOpenAlert → upsert` (before the
  transaction's INSERT).

## Out of scope (deferred)

- `packages/api/src/notifications/` — recipient-role resolution
  surface; same AI-slop density profile. Future loop candidate.
- `packages/api/src/incidents/transitions.ts` +
  `transitionSideEffects.ts` — criteria-state-machine core.
- `packages/api/src/audit/` — audit log surface.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/rules
cd packages/api && npx vitest run src/rules 2>&1 | tail -15
node scripts/lint-prose.mjs
```

Existing specs (must stay green):

- `rules/__tests__/engine.spec.ts` — pure engine math
- `rules/__tests__/debounce.spec.ts` — 11+ I/O Matrix rows
- `rules/__tests__/cache.spec.ts` — hydration + lookup
- `rules/__tests__/hooks.spec.ts` — full hook wiring + boot guard

The contract surfaces verified here are load-bearing for:

- `evaluateRules` → ingest/hooks.onRuleEvaluation → Alert row +
  Incident auto-create + Notification write
- `debounceBreaches` → `RuleDebounceState` row writes via the hook
- `applyOpenTransition` → `alert:opened` + `incident:opened`
  socket emits
- `applyClearTransition` → `Alert.clearedAt` update
- `hydrateActiveRuleCache` → api boot path
- `WriteAmplificationError` → api boot path exits 78 (EX_CONFIG)
- `findOpenAlert` → idempotency-fast-path inside the open `$transaction`
