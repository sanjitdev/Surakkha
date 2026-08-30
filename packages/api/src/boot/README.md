# `boot/` — api boot module

Distilled from `src/index.ts` on 2026-08-30 to keep the entrypoint
under the `max-lines: 500` ESLint ceiling. Each module owns one
concern; the index.ts orchestrator wires them together.

## Modules

| File                 | Concern                                                            | Key export                                                           |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `db.ts`              | Lazy-resolved Prisma singleton (cached on first call)              | `getPrisma()`                                                        |
| `readingDelegate.ts` | Narrow `Reading` delegate over the shared Prisma client            | `resolveReadingDelegate()`                                           |
| `ruleEngine.ts`      | Story 3.2 boot-fallback contract (hydrates cache + installs hooks) | `initializeRuleEngine()`                                             |
| `socketIO.ts`        | Socket.IO server, dashboard namespace, ingest socket               | `createSocketIOServer`, `wireDashboardNamespace`, `wireIngestSocket` |
| `exits.ts`           | Named constants for process exit codes                             | `EX_CONFIG = 78`, `EXIT_FAILURE = 1`                                 |

## Why a separate directory

The api boot path grew over Stories 2.2 → 4.13 to 842 lines in
`src/index.ts`. The boot concerns — Prisma resolution, rule
engine hydration, Socket.IO wiring, exit-code handling — were
interleaved with the router mount order, making each new router
hard to add without bumping the lint ceiling.

Splitting by concern makes each module testable in isolation
(`boot/ruleEngine.ts` is now walked directly by
`__tests__/boot-fallback.spec.ts`) and keeps `index.ts` focused
on the wire-up that matters at a glance: middleware chain, mount
order, catch-all 404, and the `boot()` boot orchestration.

## Constraints preserved

- `/health` remains registered BEFORE `app.use(authenticate)`,
  without `markPublic` — pinned by `health.public.spec.ts`.
- `boot()` orchestration (SKIP_MIGRATIONS, `runMigrations`,
  `process.exit` codes) remains in `index.ts` — pinned by
  `boot.skipMigrations.spec.ts`.
- Catch-all 404 handler remains AFTER every router mount — pinned
  by `catchall-404-order.spec.ts`.
- `initializeRuleEngine(...)` and the NOOP_HOOKS fallback shape
  remain together — pinned by `boot-fallback.spec.ts` (now walks
  `boot/ruleEngine.ts` instead of `index.ts`).
