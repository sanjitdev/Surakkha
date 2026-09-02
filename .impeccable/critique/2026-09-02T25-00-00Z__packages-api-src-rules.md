# Critique — `packages/api/src/rules/` (rules engine + de-bounce IO)

**Date:** 2026-09-02
**Surface:** `packages/api/src/rules/` (9 source files, ~2,500 LOC)
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/rules/
├── engine.ts                  318 LOC   — pure rules-evaluation engine
├── hooks.ts                   542 LOC   — installRuleEngineHooks wiring + boot guard
├── debounce.ts                398 LOC   — pure de-bounce core (rising/falling edge)
├── cache.ts                   194 LOC   — ActiveRuleCache hydration + lookup
├── applyTransition.ts         546 LOC   — open/clear path IO + post-commit emits
├── alertStateRepository.ts    208 LOC   — narrow Prisma slice + resolveX adapter
├── incidentFromAlert.ts       128 LOC   — shouldCreateIncident + buildIncidentPayload
├── findOpenAlert.ts            94 LOC   — partial-index lookup
├── prismaReader.ts             81 LOC   — narrow Prisma slice + resolveX adapter
```

The rules/ directory is the largest and most-survivor-dense surface in the
api package. It is the load-bearing implementation of the rule engine +
de-bounce layer for Epic 3.4 (FR-14/AR-7) plus the alert→incident
auto-create (3.6) and notification write (4.9).

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                           |
| --- | ---------------- | ----- | -------------------------------------------------------------- |
| 1   | Visibility       | 2     | Status surfaces OK in console.warn lines but no operator UI    |
| 2   | Match real world | 3     | Domain language "breach", "rising edge", "slot" matches ops    |
| 3   | User control     | n/a   | No operator UI in this surface; backend only                   |
| 4   | Consistency      | 2     | Inconsistent rationale block sizes; F-P markers mix styles     |
| 5   | Error prevention | 3     | Boot guard (write-amplification), P2002 catch, NUL delimiter   |
| 6   | Recognition      | 2     | Inline "Patch (spec-3-4 review 2026-08-27...)" lines RESTATE   |
| 7   | Flexibility      | n/a   | No configuration UI; fixed contract                            |
| 8   | Minimalist       | 1     | Files are 2-4× larger than they need to be (AI-slop overhead)  |
| 9   | Recoverability   | 3     | Idempotency keys + P2002 race catch + best-effort state writes |
| 10  | Help docs        | 1     | Most rationale is in code comments, NOT in a discoverable doc  |

**Weighted total: 22/40** (same band as ingest/, shared/, api/.)

## AI-slop detection

### P1 (block merge)

- **P1-1: `applyTransition.ts` carries 4 inline "Patch (spec-3-4 review
  2026-08-27, P-L2-N / XX-NN)" rationale blocks** totaling ~80 lines
  across `applyOpenTransition` and `applyClearTransition`. Each block
  reads "previously X, now Y because spec-3-4 review wanted Z". Git is
  canonical for that history; the patch rationale belongs in the commit
  message, not in the source. Examples: lines 88-95 (P-L2-4 / BH-09
  idempotency state advance), lines 182-188 (P-L2-14 / ECH-07 incident
  write try/catch), lines 277-285 (P-L2-8 / BH-19 emit independence),
  lines 397-404 (P-L2-9 / ECH-02 state upsert inside tx).

- **P1-2: `hooks.ts` carries 2 inline "Patch (spec-3-4 review 2026-08-27,
  P-L2-N / XX-NN)" rationale blocks** (~30 lines): lines 252-263 (P-L2-12
  / ECH-05 NaN guard), lines 437-446 (P-L2-5 / BH-10 IO-failure frame
  reset), lines 407-417 (P-L2-15 / BH-16 multi-replica lastSeen map).
  Each is the same "previously X, now Y because review" pattern.

- **P1-3: `debounce.ts` carries 3 inline "Patch (spec-3-4 review
  2026-08-27, P-L2-N / XX-NN)" rationale blocks** (~50 lines): P-L2-13
  / ECH-06 NUL delimiter, P-L2-7 / BH-14 / ECH-08 integer-seconds guard,
  P-L2-10 / ECH-03 deterministic sort. Plus a 4th `Patch (code review
2026-08-27 #15)` in `applyTransition.ts:313` (incident payload parity).

### P2 (apply before merge)

#### Story codes in headers / inline rationale

The rules surface uses Story / AC / FR / AR codes in 50+ inline comments
and 9 file headers. The full list, scanned by Read:

- `engine.ts`: header "Story 3.2"; inline "Story 3.1 invariant I-5",
  "Story 3.4 — adds minDurationSeconds", "Story 3.5's alert manager",
  "per Story 3.2 AC #5", "Story 3.5 re-derives".
- `hooks.ts`: header "Story 3.2 + Story 3.4 (de-bouncing)"; inline
  "Story 3.5 owns alert emission, Story 3.4 owns state-machine update",
  "architecture §4.5", "FR-14/AR-7", "Story 3.4 — de-bounce wiring",
  "spec line 84", "Story 3.4 AC12", "Story 3.7 will wire",
  "Stories 3.4/3.5/Epic 5".
- `debounce.ts`: header "Story 3.4 (architecture §5.1, FR-14/AR-7)";
  inline "ADR-3 §"Negative"", "spec Design Note", "FR-14", "AC1",
  "AC1's pause-not-reset", "I/O Matrix row STALE_STATE_NO_RULE",
  "spec I/O Matrix rows".
- `cache.ts`: header "Story 3.2"; inline "Story 3.5", "Story 3.7",
  "spec's per-row rejection contract", "cache AC".
- `applyTransition.ts`: header references "Story 3.4 review-finding
  #4 + #6"; inline "Story 4.2", "Story 3.6", "Story 4.9",
  "AC1/AC2/AC3/AC4/AC6", "AI-3.2 closure", "AI-3.3 closure",
  "Story 4.4 detail page", "loopback-1 Finding #6", "Spec-3-4 review
  2026-08-27".
- `alertStateRepository.ts`: header "Story 3.4 (de-bouncing IO)";
  inline "Story 3.4 review-finding #3 + #4", "Story 3.6", "AC6",
  "Story 4.9", "patch spec-3-4 review 2026-08-27".
- `incidentFromAlert.ts`: header "Story 3.6"; inline "AC1, AC2",
  "PRD §5.3", "Epic 4", "AC3", "Story 4.2", "spec §"Incident.value
  semantics"".
- `findOpenAlert.ts`: header "Story 3.4 (architecture §5.1, FR-14/AR-7
  seam)"; inline "Story 3.5 alert manager", "3.4 hooks".
- `prismaReader.ts`: header "Story 3.2"; inline "Story 3.7's hot-reload".

These are noise — the spec is the canonical record (per the SHARED
critique). Story codes break on every planning rename.

#### Cross-file line refs

- `engine.ts`: "cache hydration (`./cache.ts`) projects", "The hook
  (`./hooks.ts`) is the only place that touches the DB", "`./debounce.ts`
  can read it without re-querying", "Story 3.5 re-derives those by
  `ruleId` from the cache", "the spec's per-row rejection contract".
- `hooks.ts`: "Step 3 in `frame.ts:PROCESSING_ORDER`" (cross-file
  ref to ingest/frame.ts), "Story 3.7's `refreshActiveRuleCache`".
- `debounce.ts`: "slotKey (matches the pure module's)", "spec's I/O
  Matrix", "see Design Note".
- `cache.ts`: "pinned by `cache.spec.ts`", "`requireRuleType` (regular
  throwing function) so the call works without TS2775's", "Story 3.7
  will call this on save".
- `applyTransition.ts`: "`applyTransition.ts:101-167`" (self-ref,
  line numbers in comments), "the partial unique index raised P2002
  (the catch is in `isPrismaP2002` below)", "Story 3.4 review-finding
  #4 + #6: clear path", "the pure module's `clear` transition", "this
  helper (`incidentFromAlert.ts`)" (auto-ref).
- `incidentFromAlert.ts`: "called from inside the `$transaction`
  callback in `applyTransition.ts:101-167`" (the self-ref that the
  applyTransition patch will move!), "test rig at
  `alert-debounce.spec.ts`".
- `findOpenAlert.ts`: "kept in its own file (NOT inside `debounce.ts`)
  so the de-bounce module stays pure", "3.4 hooks", "3.5 alert manager".

These break on every refactor — the spec is the canonical record.

#### Long narrative rationale blocks (restate the obvious)

- `engine.ts` header: 22 lines. Trims to: "Pure rules-evaluation engine
  - linear-regression slope. No IO. The hook layer queries
    `Reading.findMany` and hands the array as `EngineObservation.recentReadings`."
- `engine.ts:122-139` (BreachCandidate rationale): 18 lines, restates
  what `evaluateRule`'s return type already says.
- `engine.ts:96-104` (BreachResult shape): 18 lines, restates
  `BreachResult` field-by-field then says "Intentionally omits
  `threshold`, `operator`, `hysteresisSeconds`" — fields-not-present is
  the type system talking.
- `hooks.ts` header: 46 lines (one of the largest in the codebase).
- `applyTransition.ts:357-368` "clear path" rationale: 12 lines of pure
  "Story 3.4 review-finding #4 + #6" preamble.
- `incidentFromAlert.ts` header: 33 lines.
- `findOpenAlert.ts` header: 19 lines.
- `cache.ts` header: 21 lines.
- `alertStateRepository.ts` header: 17 lines.

#### Loop-N review hardening markers

- `applyTransition.ts`: "Story 3.4 review-finding #3 + #4 + #6",
  "review-finding #7", "review-finding #8", "loopback-1 Finding #6".
- `alertStateRepository.ts`: "Story 3.4 review-finding #3 + #4".
- `engine.ts:300-303`: "the call target must have an explicit type
  annotation" — restates TS2775 in prose.
- `engine.ts:295-304`: "Used by `cache.ts` to skip + `console.warn`
  rows whose `ruleType` is anything else (per-row rejection; valid
  rows still load). Also exported for direct use by any future site
  that needs the same guard." — restates the export.

#### "The previous code was X" / "the pre-patch code did Y" patterns

Inline rationale blocks that say "the previous behaviour was X because
of review N" are git's job. Examples:

- `applyTransition.ts:88-95`: "the pre-patch code returned early,
  leaving the timer stale..."
- `applyTransition.ts:182-188`: "wrap the Incident + Notification writes
  in try/catch so a non-P2002 error here does NOT propagate and abort
  the entire `$transaction`..."
- `applyTransition.ts:277-285`: "if the alert emit parse failed and
  the Incident emit would also fail, we still want the Incident emit
  to ATTEMPT..."
- `applyTransition.ts:393-404`: "the state upsert now runs INSIDE this
  transaction (not as a best-effort `persistStateSlot` outside) so the
  Alert row + state row commit as one unit."
- `applyTransition.ts:462-468`: "the pre-patch code called
  `persistStateSlot` here as a best-effort fallback; with the upsert
  inside the tx we no longer need the outer write."
- `applyTransition.ts:526-533`: "drop the cargo-cult `_AlertStateRef`
  alias..." — meta-commentary about a deleted thing.
- `engine.ts:252-263`: "The previous behaviour was to silently return
  EMPTY_BREACH_RESULTS because every comparison returned false (NaN
  compared to anything is false). Now we log a warn..."
- `hooks.ts:407-417`: "The previous code updated the Map before the
  IO; if IO threw, the next frame would compute `lastTs = observedAt`
  and miss the failed frame, silently dropping its breach from the
  de-bounce window."
- `hooks.ts:437-446`: same pattern re: IO failure → frame reset.
- `debounce.ts:117-126`: "The previous `|` worked because the closed
  enums can't contain it..."
- `debounce.ts:134-143`: "The schema column is `Int`, but a fractional
  value like `0.5` passes `Number.isFinite(v) && v >= 0` and Prisma
  will silently floor it on write..."
- `debounce.ts:215-227`: "the iteration order of the upstream cache
  can differ across hot-reloads, which would silently flip the winner."

Each of these restates the _current_ code in the lines immediately
following. The current code IS the truth — git log IS the history.

#### "[Review][Patch] F-A8" / `Patch (code review 2026-08-27 #15)` markers

- `applyTransition.ts:313`: "Patch (code review 2026-08-27 #15):
  parity with `IncidentStateChangedEventSchema`. The auto-create path
  is system-driven (rule engine, not an operator), so this is always
  null in v1 — but pinning the field shape keeps the socket-emit
  record uniform across the lifecycle and future-proofs a manual-create
  path." — 10 lines for "the field is null and we want it there."

#### "Patch (spec-3-4 review 2026-08-27, ...)" markers — see P1 above

These are the single largest AI-slop source. ~80 lines of pure
"previously X, now Y because review" prose.

### Non-findings (verified, not raised)

- **The pure-module split (engine, debounce, incidentFromAlert)** is
  good engineering. The 10-step driver in ingest/frame.ts consumes the
  hook return type `Promise<readonly BreachResult[]>`; the seamed
  modules keep the IO-free parts testable without `vi.mock`. This is
  intentional and load-bearing.
- **The `AlertStateRepository` slice + `resolveAlertStateRepository`
  adapter pattern** is correct. Production narrows the real Prisma
  client at boot, tests inject a stub. The pattern keeps the engine
  - hook modules free of `@prisma/client` imports.
- **The boot guard for `minDurationSeconds === 0 && hysteresisSeconds
=== 0`** (write-amplification refusal) is load-bearing. It throws
  `WriteAmplificationError(ruleIds)` and forces the api process to exit
  78 (EX_CONFIG) rather than enter a runaway-write loop. The enum list
  of every offender is the right design — operators with many bad
  configs see them all in one boot failure.
- **The `OPERATOR_COMPARATORS: Record<RuleOperator, ...>` exhaustive
  table** in `engine.ts` is correctly typed. A future enum addition
  fails tsc here.
- **The NUL-delimiter `slotKey` in `debounce.ts`** (`${metric}\u0000${severity}`)
  is correct — NUL is illegal in every metric + severity literal,
  future enum additions can't contain it. The previous `|` worked
  only by accident.
- **The `default: never` exhaustive check in `evaluateRule`'s switch**
  is correctly placed.
- **The `Rule.open_unique_idx` partial-index lookup** (`findOpenAlert`)
  is the canonical idempotency surface. The hook layer's
  `findOpenAlert → tx.alert.create → catch P2002` flow is correct.
- **The `RATE_WINDOW_MS = 60_000` and `RATE_MAX_POINTS = 5` constants**
  in `hooks.ts` are pinned to architecture §4.5.

### Out of scope

- **The hot-reload path** (`refreshActiveRuleCache` in `cache.ts`) is
  Story 3.7 work — `void deps.prisma` in `hooks.ts` is the seam. Not
  refactoring that line.
- **The `Alert` ↔ `Incident` ↔ `Notification` auto-create triple-write
  in `applyTransition.ts`** is correctly inside the same `$transaction`
  (atomicity per AC6). The shape of `buildIncidentPayload` is locked to
  the `Incident` model — no refactor.
- **The "Patch (spec-3-4 review...)" markers** carry codes
  (`P-L2-N / XX-NN`) that look like patch-management IDs. Keeping or
  dropping them is a project-policy decision; this loop drops them as
  AI-slop (they restate git history). If they are mandated by some
  downstream audit tool, the markers can be re-emitted by a script
  against `git log --grep` output.

## Plan

### Strip pass (all 9 files)

1. **Drop the 9 "Patch (spec-3-4 review 2026-08-27, P-L2-N / XX-NN)"
   inline rationale blocks** (~80 LOC across `applyTransition.ts`,
   `hooks.ts`, `debounce.ts`, `alertStateRepository.ts`). Each block
   says "previously X, now Y because review". Git log is canonical.
2. **Drop `Patch (code review 2026-08-27 #15)`** in
   `applyTransition.ts:313`.
3. **Drop `// Patch (spec-3-4 review 2026-08-27, P-L2-23 / BH-04)`**
   in `applyTransition.ts:526-533` (meta-commentary about a deleted
   alias).
4. **Drop "Story 3.4 review-finding #N" / "Loopback-1 Finding #N" /
   "Spec-3-4 review 2026-08-27" markers** — kept-out-of-source, the
   spec captures this.
5. **Drop `Story X.Y`, `AC1`, `AC2`, etc. codes** from inline
   rationale. Where the AC1 reference encodes a load-bearing rule
   (e.g. "AC1's pause-not-reset" — the rule that `inViolationSince`
   pauses rather than resets on a brief blip), keep a 1-line reference
   without the code.
6. **Drop `architecture §4.5`, `architecture §5.1`, `FR-14`, `AR-7`,
   `ADR-3 §"Negative"` codes**. Where the prose restates a load-bearing
   rule (e.g. "the engine's slope calc"), keep the rule without the §ref.
7. **Drop cross-file line refs**: `applyTransition.ts:101-167`,
   `frame.ts:PROCESSING_ORDER`, `cache.spec.ts`, `debounce.spec.ts`,
   `engine.spec.ts`, `hooks.spec.ts`, `alert-debounce.spec.ts`,
   `frame.ts:303`. Keep references to file NAMES where the dep is
   structural (e.g. "the hook module imports `findOpenAlert`").
8. **Drop the "the pre-patch code did X" / "the previous behaviour
   was X"** sentences — current code IS the truth.

### Trim pass (file headers + function-level rationales)

9. **`engine.ts` header**: 22 lines → 6 lines. Keep: pure / no IO,
   slope is mean-centered, OPERATOR_COMPARATORS is the closed lookup.
10. **`engine.ts:96-104` (BreachResult shape)**: 18 lines → 3 lines.
    Field comments suffice; the rest is restatement.
11. **`engine.ts:122-139` (BreachCandidate rationale)**: 18 lines →
    4 lines.
12. **`engine.ts:288-303` (requireRuleType)**: 16 lines → 4 lines.
    Drop the TS2775 prose.
13. **`hooks.ts` header**: 46 lines → 7 lines.
14. **`hooks.ts` (pre-filter chain inline comment)**: 14 lines → 4 lines.
15. **`hooks.ts:524-528` (migration banner)**: 5 lines → drop entirely
    — git tracks the move.
16. **`hooks.ts:531-535` (uninstall test escape hatch)**: 5 lines →
    1 line.
17. **`debounce.ts` header**: 28 lines → 7 lines.
18. **`debounce.ts:112-126` (slotKey NUL rationale)**: 15 lines → 2 lines.
    The comment about why NUL is chosen can collapse to one sentence.
19. **`debounce.ts:133-143` (isValidDuration integer guard)**: 11 lines
    → 2 lines.
20. **`debounce.ts:215-227` (deterministic sort)**: 13 lines → 3 lines.
21. **`cache.ts` header**: 21 lines → 6 lines.
22. **`cache.ts:64-71` (projectRow minDurationSeconds rationale)**: 8
    lines → 2 lines.
23. **`cache.ts:140-160` (buildCacheFromRows rationale)**: 21 lines →
    6 lines.
24. **`applyTransition.ts` header**: 9 lines → 4 lines.
25. **`applyTransition.ts:357-368` (clear path preamble)**: 12 lines →
    2 lines.
26. **`applyTransition.ts:391-405` (clear no-open-row branch preamble)**:
    15 lines → 4 lines.
27. **`incidentFromAlert.ts` header**: 33 lines → 6 lines.
28. **`incidentFromAlert.ts:67-98` (buildIncidentPayload rationale)**:
    31 lines → 5 lines. Field-level comments suffice.
29. **`findOpenAlert.ts` header**: 19 lines → 5 lines.
30. **`alertStateRepository.ts` header**: 17 lines → 5 lines.
31. **`alertStateRepository.ts:189-192` (incident slice rationale)**:
    4 lines → 2 lines.
32. **`alertStateRepository.ts:195-198` (notification slice rationale)**:
    4 lines → 2 lines.
33. **`prismaReader.ts` header**: 16 lines → 5 lines.

### Preserved (load-bearing)

- All `OPERATOR_COMPARATORS`, `GLOBAL_DEVICE_SENTINEL`, `INDEX_SEPARATOR`,
  `PRISMA_P2002`, `EX_CONFIG`, `RATE_WINDOW_MS`, `RATE_MAX_POINTS`,
  `NUL-delimiter slotKey`, `closed-enum requireRuleType`, etc.
- The boot guard (`WriteAmplificationError` + offenders scan).
- The `default: never` exhaustive check in `evaluateRule`.
- The `$transaction` ordering in `applyOpenTransition` /
  `applyClearTransition`.
- The post-commit emit ordering (alert emit THEN incident emit, each
  independent).
- The P2002 catch in `applyOpenTransition` (race loss path).
- The idempotency-fast-path `findOpenAlert → upsert` (before the
  transaction's INSERT).

## Out of scope (deferred to a future loop)

- **`packages/api/src/notifications/`** — the `notificationWriter.ts` +
  `notificationRepository.ts` + `notificationRowToPayload.ts` seam has
  similar density. Loop #201 candidate.
- **`packages/api/src/incidents/transitions.ts` + `transitionSideEffects.ts`** —
  the criteria-state-machine core. Loop #202 candidate.
- **`packages/api/src/audit/`** — the audit log surface. Loop #203 candidate.

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/rules
cd packages/api && npx vitest run src/rules
```

Existing specs (must stay green):

- `rules/__tests__/engine.spec.ts` — pure engine math
- `rules/__tests__/debounce.spec.ts` — 11+ I/O Matrix rows
- `rules/__tests__/cache.spec.ts` — hydration + lookup
- `rules/__tests__/hooks.spec.ts` — full hook wiring + boot guard
- `__tests__/engine-rule-migration.spec.ts` — projection compatibility
- `dev-debounce.spec.ts` (if present) — dev-mode behaviours

The contract surfaces verified here are load-bearing for:

- `evaluateRules` → ingest/hooks.onRuleEvaluation → Alert row + Incident
  auto-create + Notification write
- `debounceBreaches` → `RuleDebounceState` row writes via the hook
- `applyOpenTransition` → `alert:opened` + `incident:opened` socket emits
- `applyClearTransition` → `Alert.clearedAt` update
- `hydrateActiveRuleCache` → api boot path
- `WriteAmplificationError` → api boot path exits 78 (EX_CONFIG)
- `findOpenAlert` → idempotency-fast-path inside the open `$transaction`
