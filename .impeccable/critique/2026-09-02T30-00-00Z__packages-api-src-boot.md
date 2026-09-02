# Critique — `packages/api/src/boot/` (boot wiring: ruleEngine, socketIO, readingDelegate, db, exits)

**Date:** 2026-09-02
**Surface:** `packages/api/src/boot/` (5 files, 339 LOC)
**Scoring:** Nielsen 10-heuristics + AI-slop detection

## Scope

```
packages/api/src/boot/
├── db.ts                58 LOC  — lazy getPrisma() singleton + test reset hook
├── exits.ts             30 LOC  — EX_CONFIG (78), EXIT_FAILURE (1) constants
├── readingDelegate.ts   71 LOC  — narrow Reading delegate over shared Prisma client
├── ruleEngine.ts        71 LOC  — boot-time rule cache hydration + hook install
└── socketIO.ts         109 LOC  — Socket.IO server creation + /dashboard namespace + ingest root attach
```

The boot surface is small but load-bearing: it owns the lazy Prisma
singleton (so HTTP-only tests don't require DATABASE_URL), the
boot-fallback contract for the rules engine (transient DB outage →
no-op hooks; write-amplification rule → EX_CONFIG), and the Socket.IO
server creation with the `/ingest/` path scope and the `/dashboard`
namespace registration.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                                                    |
| --- | ---------------- | ----- | --------------------------------------------------------------------------------------- |
| 1   | Visibility       | 4     | console.error on hydrate failure; warn on prisma resolution                             |
| 2   | Match real world | 4     | "getPrisma", "initializeRuleEngine", "wireIngestSocket"                                 |
| 3   | User control     | 3     | NOOP_HOOKS fallback keeps api serving HTTP+WS on DB outage                              |
| 4   | Consistency      | 2     | "distilled 2026-08-30 (was inline in src/index.ts:N-M)" RESTATE everywhere; Story codes |
| 5   | Error prevention | 4     | WriteAmplificationError → EX_CONFIG; hydrate failure → NOOP_HOOKS                       |
| 6   | Recognition      | 2     | "F-P10", "F-P4", "(Story 3.4 AC12)" markers RESTATE                                     |
| 7   | Flexibility      | 4     | `getPrisma()` lazy; `wireDashboardNamespace` accepts logger dep                         |
| 8   | Minimalist       | 1     | Headers 4-7× larger than needed                                                         |
| 9   | Recoverability   | 4     | Lazy-resolve + cached singleton; boot-fallback with NOOP_HOOKS                          |
| 10  | Help docs        | 1     | Most rationale is in code comments                                                      |

**Weighted total: 29/40.**

## AI-slop detection

### P1 (block merge)

- **P1-1: `socketIO.ts` header is 29 lines** — restates 3 wiring steps + F-P10 maxHttpBufferSize + F-P10 cors. Trim to ~6 lines.
- **P1-2: `db.ts` header is 25 lines** — restates "distilled from index.ts" + lazy + Promise<unknown> rationale. Trim to ~5 lines.
- **P1-3: `exits.ts` header is 27 lines** — restates the magic-number history + Story 3.4 + spec walk. Trim to ~5 lines.
- **P1-4: `ruleEngine.ts` header is 31 lines** — restates the boot-fallback contract + boot-guard + source-walk pin. Trim to ~6 lines.
- **P1-5: `readingDelegate.ts` header is 18 lines** — restates the narrow-delegate rationale + lazy-resolve. Trim to ~5 lines.

### P2 (apply before merge)

#### Story codes / "distilled" markers

- `db.ts:2`: `distilled 2026-08-30 (was inline in src/index.ts:553-589)`
- `exits.ts:2`: `Story 3.4 (distilled 2026-08-30)`; inline `(Story 3.4)`; `boot-exit-code.spec.ts` (test ref); `src/index.ts:834` (cross-file line ref)
- `readingDelegate.ts:2-3`: `distilled 2026-08-30 (was inline in src/index.ts:600-645)`; inline `(Story 3.2)`
- `ruleEngine.ts:2-3`: `distilled 2026-08-30 (was inline in src/index.ts:718-743)`; inline `(Story 3.2)`; `(Story 3.4)`; `(Story 3.4 AC12)`; `boot-fallback.spec.ts` (test ref); `INDEX_TS constant` reference
- `socketIO.ts:2-3`: `distilled 2026-08-30 (was inline in src/index.ts:524-540 and 755-778)`; `(F-P10)` (×2); `(F-P4)`; `(Story 2.6)`; `(the Story 2.6 dashboard subscriber)`; `(the ingest handler parses the URL on its own)`

These are noise — git tracks the moves.

#### Cross-file line refs

- `db.ts:24`: `resolveAlertAcknowledgeRepository, resolvePrismaRuleReader, resolveIncidentStateRepository` (4 list-reader wirings)
- `exits.ts:21-22`: `src/index.ts:834` (inline location)
- `readingDelegate.ts:55`: `boot/db.ts`
- `ruleEngine.ts:27`: `boot-fallback.spec.ts` (test ref)
- `ruleEngine.ts:30`: `INDEX_TS constant`

#### Long narrative rationale blocks

- `db.ts:33-37` (getPrisma preamble): 5 lines restating "returns the cached instance on subsequent calls"
- `db.ts:51-54` (\_\_resetPrismaForTests preamble): 4 lines restating "test-only reset hook"
- `socketIO.ts:44-49` (createSocketIOServer preamble): 6 lines restating "returns the io handle plus the ingest handler promise"
- `socketIO.ts:67-71` (wireDashboardNamespace preamble): 5 lines restating "/dashboard namespace"
- `socketIO.ts:89-94` (wireIngestSocket preamble): 6 lines restating the F-P4 rationale
- `readingDelegate.ts:54-57` (single-allowed-cast preamble): 4 lines restating the `as any` boundary

#### "Patch (code review...)" / "F-P..." markers

- `socketIO.ts:21`: `(F-P10): caps inbound WS message size at 64 KB` — F-P pin restated
- `socketIO.ts:24`: `(F-P10): the WS endpoint is not browser-facing in v1` — F-P pin restated
- `socketIO.ts:93`: `(F-P4)` — F-P pin restated
- `ruleEngine.ts:62`: `Story 3.4 AC12 — configuration error, not a transient outage. The boot guard already logged the offending ruleId via console.warn; here we re-throw so the outer boot() catch exits with EX_CONFIG. NOT swallowed.` — 5-line rationale that the function body already encodes

### Non-findings (verified, not raised)

- **The `getPrisma()` lazy-resolve + cached singleton** is correct — `Promise<unknown>` return type is the seam that lets HTTP-only tests mount routers without DATABASE_URL.
- **The `__resetPrismaForTests` hook** is correct — test-only seam, NOT exported from index.ts.
- **`EX_CONFIG` (78)** is the sysexits.h standard signal for "configuration error". Correct pin.
- **`EXIT_FAILURE` (1)** is the catch-all. Docker Compose restarts on any non-zero exit. Correct.
- **`NOOP_HOOKS` fallback on hydrate failure** is correct — keeps the api serving HTTP+WS without rule evaluation during a transient DB outage.
- **`WriteAmplificationError` re-throw** is correct — boot guard already logged the offending ruleId; the outer `boot()` catch exits with EX_CONFIG. NOT swallowed.
- **The `installRuleEngineHooks({ cache, prisma, readingRepository, alertReader, alertState })`** dependency bundle is the seam that decouples the rules engine from the Prisma client.
- **The `maxHttpBufferSize: 64_000` cap** is correct — caps inbound WS message size at 64 KB; a v1 telemetry frame is <1 KB.
- **The `cors: { origin: false }`** is correct — the WS endpoint is not browser-facing in v1; devices authenticate via JWT.
- **The `/ingest/` path scope** (separate from Express's URL space) is correct — the ingest handler parses the URL on its own.
- **The `/dashboard` namespace registration** is correct — without it Socket.IO replies "Invalid namespace" and disconnects.
- **The `ingestHandlerPromise.then(...)` cache** is correct — handler is resolved once and re-used for every connection; rejecting the promise disconnects the socket (silent failure would leave every future connection without a handler).
- **The `wireIngestSocket` rejection → `socket.disconnect(true)`** is correct.
- **The `ReadingDelegate` narrow Prisma slice** is correct — only the 2 methods the rules engine calls are exposed.

### Out of scope

- **`packages/api/src/ingest/hooks.ts`** — `NOOP_HOOKS` + `setIngestHooks` exports. Refined in loop #199.
- **`packages/api/src/rules/cache.ts`** — `hydrateActiveRuleCache`. Refined in loop #200.
- **`packages/api/src/rules/hooks.ts`** — `installRuleEngineHooks` + `resolveAlertStateRepository` + `WriteAmplificationError`. Refined in loop #200.
- **`packages/api/__tests__/boot-fallback.spec.ts`** — the source-walk spec for this file. Out of scope for code refinement.

## Plan

### Strip pass

1. Drop "distilled 2026-08-30 (was inline in src/index.ts:N-M)" extraction markers from all 5 files.
2. Drop `Story 3.2` / `Story 3.4` / `Story 3.4 AC12` / `Story 2.6` codes from all files.
3. Drop `(F-P10)` / `(F-P4)` markers from `socketIO.ts`.
4. Drop cross-file line refs (`src/index.ts:834`, `boot/db.ts` test ref, `INDEX_TS constant` reference, `boot-fallback.spec.ts`, `boot-exit-code.spec.ts`).
5. Drop `(the ingest handler parses the URL on its own)` parenthetical.
6. Drop `(the Story 2.6 dashboard subscriber)` parenthetical.

### Trim pass

7. **`socketIO.ts` header**: 29 → 6 lines.
8. **`db.ts` header**: 25 → 5 lines.
9. **`exits.ts` header**: 27 → 5 lines.
10. **`ruleEngine.ts` header**: 31 → 6 lines.
11. **`readingDelegate.ts` header**: 18 → 5 lines.
12. **`ruleEngine.ts:62-67`** (WriteAmplificationError re-throw comment): 5 → 2 lines.
13. **`db.ts:33-37`** (getPrisma preamble): 5 → 2 lines.
14. **`db.ts:51-54`** (\_\_resetPrismaForTests preamble): 4 → 2 lines.
15. **`socketIO.ts:44-49`** (createSocketIOServer preamble): 6 → 3 lines.
16. **`socketIO.ts:67-71`** (wireDashboardNamespace preamble): 5 → 2 lines.
17. **`socketIO.ts:89-94`** (wireIngestSocket preamble): 6 → 3 lines.
18. **`readingDelegate.ts:54-57`** (single-allowed-cast preamble): 4 → 2 lines.

### Preserved (load-bearing)

- `getPrisma()` lazy-resolve + cached singleton.
- `__resetPrismaForTests` hook.
- `EX_CONFIG` (78) + `EXIT_FAILURE` (1) constants.
- `NOOP_HOOKS` fallback on hydrate failure.
- `WriteAmplificationError` re-throw to outer `boot()` catch.
- `installRuleEngineHooks` dependency bundle.
- `maxHttpBufferSize: 64_000` cap.
- `cors: { origin: false }`.
- `/ingest/` path scope.
- `/dashboard` namespace registration.
- `ingestHandlerPromise` cache.
- `wireIngestSocket` rejection → `socket.disconnect(true)`.
- `ReadingDelegate` narrow Prisma slice.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/boot
npx --prefix packages/api vitest run packages/api/__tests__/boot-fallback.spec.ts packages/api/__tests__/boot-exit-code.spec.ts
```
