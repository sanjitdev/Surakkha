# Test spec — `packages/api/src/boot/` critique loop

**Date:** 2026-09-02
**Surface:** `packages/api/src/boot/` (5 files, 339 LOC → ~210 LOC)
**Companion critique:** `.impeccable/critique/2026-09-02T30-00-00Z__packages-api-src-boot.md` (29/40 weighted)

## Behavioural pins

### Prisma singleton (db.ts)

- **B-DB-1**: Given `getPrisma()` on first call, when invoked, then it lazy-imports `@prisma/client` and constructs a new `PrismaClient`.
- **B-DB-2**: Given `getPrisma()` after the first call, when invoked, then it returns the cached instance (no new construction).
- **B-DB-3**: Given `getPrisma()` and an import failure, when called, then it logs via `logger.warn` and re-throws.
- **B-DB-4**: Given `__resetPrismaForTests()`, when called, then the cached client is nulled (next call re-imports).

### Exit codes (exits.ts)

- **B-EX-1**: `EX_CONFIG === 78` and `EXIT_FAILURE === 1` (literal pin).

### Reading delegate (readingDelegate.ts)

- **B-RD-1**: Given `resolveReadingDelegate()`, when called, then it returns a `{ reading: { create, findMany } }` adapter.
- **B-RD-2**: Given `delegate.reading.findMany(args)` with `args.where.deviceId`, `args.where.metric`, `args.where.ts.gte`, when called, then it returns rows ordered by `ts: "asc"` and bounded by `take`.

### Rule engine boot (ruleEngine.ts)

- **B-RE-1**: Given `initializeRuleEngine` and a successful hydration, when called, then `setIngestHooks(installRuleEngineHooks({ cache, prisma, readingRepository, alertReader, alertState }))` runs.
- **B-RE-2**: Given `initializeRuleEngine` and a transient DB error (NOT `WriteAmplificationError`), when called, then it logs `[rules] boot: hydrate failed; running with no-op hooks` AND installs `NOOP_HOOKS`.
- **B-RE-3**: Given `initializeRuleEngine` and a `WriteAmplificationError`, when called, then it re-throws (so the outer `boot()` catch exits with `EX_CONFIG`); NOOP_HOOKS NOT installed.
- **B-RE-4**: The `console.error` prefix MUST be exactly `[rules] boot: hydrate failed; running with no-op hooks` (the source-walk spec pins this).

### Socket.IO (socketIO.ts)

- **B-SI-1**: Given `createSocketIOServer(httpServer)`, when called, then it binds Socket.IO to `httpServer` with `path: INGEST_PATH_PREFIX`, `pingTimeout: 25_000`, `pingInterval: 20_000`, `maxHttpBufferSize: 64_000`, `cors: { origin: false }`.
- **B-SI-2**: Given `createSocketIOServer`, when called, then it returns `{ io, ingestHandlerPromise }` (handler resolved once and re-used).
- **B-SI-3**: Given `wireDashboardNamespace(io, logger)`, when called, then `io.of("/dashboard").on("connection", handler)` is registered; handler routes through `handleSubscriberConnection`.
- **B-SI-4**: Given `wireDashboardNamespace` and the handler throws, when called, then it logs and calls `socket.disconnect(true)`.
- **B-SI-5**: Given `wireIngestSocket(io, ingestHandlerPromise, logger)`, when called, then `io.on("connection", handler)` is registered; per-connection calls the cached handler.
- **B-SI-6**: Given `wireIngestSocket` and `ingestHandlerPromise` rejects, when the per-connection catch fires, then it logs and `socket.disconnect(true)` (silent failure would leave every future connection without a handler).

## Static / lint pins

- **P-FS-1**: All 5 file headers MUST be ≤ 10 lines.
- **P-FS-2**: No file MUST contain `distilled 2026-08-30` / `Story 3.x` / `Story 2.6` / `F-P4` / `F-P10` / `(AC12)` / cross-file `src/index.ts:N-M` line refs.
- **P-DB-1**: `getPrisma()` MUST return `Promise<unknown>` (the lazy-resolve seam that lets HTTP-only tests mount routers without DATABASE_URL).
- **P-DB-2**: `__resetPrismaForTests` MUST be exported from `boot/db.ts` but NOT re-exported from `index.ts`.
- **P-EX-1**: `EX_CONFIG === 78 as const` and `EXIT_FAILURE === 1 as const` (literal pins).
- **P-RE-1**: The `console.error` prefix MUST be exactly `[rules] boot: hydrate failed; running with no-op hooks`.
- **P-RE-2**: `WriteAmplificationError` MUST be re-thrown (NOT swallowed as a transient failure).
- **P-SI-1**: `maxHttpBufferSize` MUST be `64_000` (64 KB cap).
- **P-SI-2**: `cors.origin` MUST be `false` (the WS endpoint is not browser-facing in v1).
- **P-SI-3**: `pingTimeout` MUST be `25_000` and `pingInterval` MUST be `20_000`.
- **P-LINT-1**: `npx eslint packages/api/src/boot` MUST exit 0.
- **P-LINT-2**: `npx tsc -b packages/api` MUST exit 0.

## Negative pins

- **N-1**: `getPrisma()` MUST NOT construct a new `PrismaClient` on every call (singleton pin).
- **N-2**: The boot fallback MUST NOT crash on transient DB outage (NOOP_HOOKS fallback).
- **N-3**: `WriteAmplificationError` MUST NOT be swallowed (configuration error → EX_CONFIG).
- **N-4**: `wireIngestSocket` MUST NOT silently drop the per-connection rejection (silent failure would leave every future connection without a handler).
- **N-5**: `createSocketIOServer` MUST NOT use `cors: { origin: true }` (WS endpoint is not browser-facing in v1).
- **N-6**: `resolveReadingDelegate` MUST NOT widen the public Prisma surface beyond the 2 methods (`create`, `findMany`).

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/boot
npx --prefix packages/api vitest run packages/api/__tests__/boot-fallback.spec.ts
```

Existing specs must stay green:

- `boot-fallback.spec.ts` (2 cases) — boot guard + WriteAmplificationError re-throw
- `boot-exit-code.spec.ts` — EX_CONFIG (78) literal pin
