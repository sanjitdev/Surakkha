# 0007 — Monorepo with pnpm workspaces

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** (workspace, n/a in architecture.md)
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Surakkha has five first-class code units that ship together:

- `packages/api` — Express server, ingestion, rules, workflow
- `packages/web` — Vite + React dashboard
- `packages/simulator` — telemetry simulator (separate Node process)
- `packages/shared` — wire contract, RBAC types, common utilities
- `packages/db` — migrations, seeds, schema introspection

The wire contract (ADR 0001) is shared by three of them. The RBAC
matrix (Story 1.1) is shared by `api` and `web`. A polyrepo would
force version pinning of `shared` and create a release-coordination
problem that does not match how a one-team codebase actually moves.

Forces:

- **One team, one release cadence.** The simulator, web dashboard,
  and api are released together. There is no scenario where one ships
  without the others.
- **Shared types are part of the contract.** A drift between
  `packages/shared` and the code that uses it is a wire-contract bug,
  not a version-mismatch bug.

## Decision

We use a **pnpm workspace monorepo** with five packages at the
top level. The shared package is a real npm package installed by the
other three; cross-cutting types live there and **only** there.

```
/
├── package.json          (workspace root)
├── pnpm-workspace.yaml
├── eslint.config.js
├── packages/
│   ├── api/             (Node 20, Express, Socket.IO)
│   ├── web/             (Node 20, Vite, React, shadcn/ui)
│   ├── simulator/       (Node 20, separate process, same wire contract)
│   ├── shared/          (Zod schemas, types, RBAC matrix)
│   └── db/              (node-pg-migrate, seeds, fixtures)
```

Three corollaries:

1. **No cross-epic imports.** A file in `packages/api/src/ingestion/`
   cannot `import` from `packages/api/src/rules/`. The ESLint config
   (`eslint.config.js`) enforces this. Cross-epic types live in
   `packages/shared`.
2. **`packages/shared` is the only source of truth for wire-contract
   types.** If a type is referenced by more than one epic, it belongs
   in `shared`.
3. **Each package has its own `tsconfig.json`** extending the root
   `tsconfig.base.json`. The base sets `strict: true`, `target:
   ES2022`, `module: ESNext`, and path aliases for `@surakkha/shared`.

## Consequences

**Positive**

- One `git clone`, one `pnpm install`, one PR can touch the wire
  contract and all consumers atomically. No version pins to update.
- TypeScript sees the real types from `packages/shared`, not
  pre-built declarations. Refactors propagate immediately.
- CI runs all packages in one pipeline; coverage is aggregated.

**Negative**

- The repo is larger than a single package would be. A new
  contributor must understand the workspace layout.
- **One bad change in `packages/shared` breaks three packages at
  once.** Mitigated by the package's own test suite plus the
  downstream packages' contract tests.

**Neutral**

- We are not using Nx, Turborepo, or Lerna. pnpm's built-in workspace
  features are enough at v1 size.

## Reversal

The monorepo reverses when:

- **The packages release on independent cadences.** Currently, all
  five release together. The moment a partner or compliance regime
  requires independent versioning (e.g. firmware team wants to pin a
  specific `shared` version), the relevant packages split into their
  own repos or a published registry.
- **The repo grows past a comfortable CI time.** A single pipeline
  running all five packages' tests should stay under 10 minutes. If
  that breaks, we add `turborepo` for caching and task scheduling,
  not a split.

Until then, monorepo with `packages/shared` as the cross-epic seam.
The ESLint rule on cross-epic imports is the load-bearing enforcement
mechanism.