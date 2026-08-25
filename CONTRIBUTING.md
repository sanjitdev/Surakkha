# Contributing to Surakkha

Thanks for your interest in Surakkha. This document explains how to set up a development environment, the conventions we follow, and how to submit a change.

Surakkha is a real-time water-safety monitoring and incident-management platform for Bangladeshi government primary schools. The planning artefacts in `docs/` and `_bmad-output/planning-artifacts/` are the source of truth for _what to build_; this document covers _how to build it_.

---

## Code of conduct

All participants are expected to follow the [Contributor Covenant](./CODE_OF_CONDUCT.md). Report unacceptable behaviour to the maintainers (see [SECURITY.md](./SECURITY.md) for contact channels).

---

## Development setup

### Prerequisites

| Tool     | Version | Notes                                                     |
| -------- | ------- | --------------------------------------------------------- |
| Node.js  | 20 LTS  | Required for `api`, `web`, and `simulator` packages.      |
| pnpm     | 9+      | Workspace-aware install; required for the monorepo.       |
| Docker   | 24+     | Required for the `db` service and the full Compose stack. |
| Postgres | 15      | Runs as a Docker container in dev; bare-metal optional.   |
| Git      | 2.40+   | For the contribution workflow below.                      |

### First-time setup

```bash
# 1. Clone
git clone <repo-url> surakkha
cd surakkha

# 2. Install dependencies (workspace install)
pnpm install

# 3. Environment
cp .env.example .env
# Edit .env and set JWT_SECRET to a random string of 32+ characters.
# The api process fails fast on a missing or weak JWT_SECRET.

# 4. Database
docker compose up -d db
pnpm -F db migrate
pnpm -F db seed

# 5. Run the full stack
docker compose up
```

The web app is at `http://localhost:8080`. The api healthcheck is at `http://localhost:3000/health`.

### Running tests

```bash
# Unit + integration tests
pnpm test

# Backend coverage (target: 70%)
pnpm -F api test:coverage

# Frontend coverage (target: 50%)
pnpm -F web test:coverage

# End-to-end smoke tests (Playwright)
pnpm -F web test:e2e

# Lint + format
pnpm lint
pnpm format
```

---

## Repository layout

```
surakkha/
├── docs/                                         # Planning artefacts (PRD, BRD, architecture, idea-refined)
├── packages/
│   ├── api/                                      # Node 20 + Express + Prisma backend (Epic 1–6)
│   ├── web/                                      # Vite + React + TypeScript frontend (Epic 1–6)
│   ├── simulator/                                # Separate Node process on the same wire contract (Epic 2)
│   ├── shared/                                   # Foundation Seam: telemetry, auth, events, incident, rbac
│   └── db/                                       # Prisma schema + seed script + migrations
├── _bmad-output/
│   └── planning-artifacts/
│       ├── epics.md                              # 55 stories across 6 epics + Step 0
│       └── ux-designs/ux-Surakkha-2026-08-20/    # UX spine pair (DESIGN.md + EXPERIENCE.md)
├── docker-compose.yml                            # 4 services: web, api, simulator, db
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/ci.yml
├── README.md
├── LICENSE
└── CONTRIBUTING.md (this file)
```

### Cross-cutting rule (binding)

**No epic may `import type` from another epic's directory.** All cross-epic types live in `packages/shared/src` only. The AI coding agent and human contributors alike are bound by this rule; any candidate code that violates it is wrong, regardless of what pattern matching suggests.

### Wire contract

The telemetry frame is `version: 1` and frozen (NFR-14, AR-2). Any change to `packages/shared/src/telemetry.ts` is a **contract bump** and must be called out in the PR description.

---

## Branching model

| Branch type | Naming                    | Created from | Merges into |
| ----------- | ------------------------- | ------------ | ----------- |
| `main`      | `main`                    | —            | —           |
| Epic        | `epic/<epic-name>`        | `main`       | `main`      |
| Story       | `story/<epic>.<n>-<slug>` | epic branch  | epic branch |
| Hotfix      | `hotfix/<short-slug>`     | `main`       | `main`      |

Long-running epic branches allow multiple stories to land in parallel within an epic before merging. The main branch is always deployable.

---

## Commit message style

We use **Conventional Commits**. Format:

```
<type>(<scope>): <short summary>

<body — what changed and why>

<footer — references, breaking notes>
```

| Type       | When to use                                              |
| ---------- | -------------------------------------------------------- |
| `feat`     | A new user-visible feature or story.                     |
| `fix`      | A bug fix.                                               |
| `docs`     | Documentation only.                                      |
| `style`    | Formatting, missing semicolons, etc. — no code change.   |
| `refactor` | Code change that neither fixes a bug nor adds a feature. |
| `test`     | Adding or correcting tests.                              |
| `chore`    | Build, CI, dependencies, tooling.                        |
| `revert`   | Reverts a previous commit.                               |

**Scope** is the package or epic: `api`, `web`, `simulator`, `shared`, `db`, `epic-1`, `epic-3`, etc.

**Example:**

```
feat(api): add RBAC middleware with (subject, action, resource) check

Implements Story 1.5 from epics.md. The single authorize.ts middleware
runs after auth and before every handler. The full RBAC matrix lives
at docs/architecture-appendix-rbac.md and is re-exported from
packages/shared/src/rbac.ts.

Covers FR-20.
```

---

## Pull request checklist

Before opening a PR, confirm the following:

- [ ] Branch is up to date with the target branch (`git fetch && git rebase`).
- [ ] `pnpm lint` and `pnpm test` pass locally.
- [ ] Pre-commit lint hook (`pnpm lint:staged` via husky) ran clean on every commit in this PR. Any `--no-verify` bypasses are noted here with the reason.
- [ ] Coverage thresholds are still met (`pnpm -F api test:coverage`, `pnpm -F web test:coverage`).
- [ ] If the PR changes a wire-contract schema, the PR description explains the contract bump and links the v2-bump justification (Story 1.10).
- [ ] If the PR changes UX, screenshots or screen recordings are attached.
- [ ] The PR description links the originating story (e.g. "Implements Story 2.4").
- [ ] New env vars are documented in `README.md` and `.env.example`.
- [ ] No new dependencies without a justification comment in the PR body.
- [ ] Commit messages follow Conventional Commits.
- [ ] No `import type` from another epic's directory (cross-cutting rule).
- [ ] No `console.log` left in production code.
- [ ] `__simulator_event`, `__invalid_transition_attempt`, and other audit-row payloads match the schema in Story 5.6's test cases.

---

## Pre-commit lint hook

The repo installs a husky-managed `pre-commit` hook that runs `pnpm lint:staged` — ESLint with `--max-warnings 0` against staged `.ts` / `.tsx` / `.mts` / `.cts` files only. The hook:

- **Blocks** the commit if any staged source file has an ESLint warning or error.
- **Skips** lint for commits that touch no staged source files (e.g. docs-only commits).
- **Does not** touch pre-existing lint debt in files you aren't committing.

The hook is installed automatically by `pnpm install` (via the `prepare` script). If for some reason it didn't run on first clone (e.g. you ran `npm install` instead), re-run it with `pnpm exec husky`.

For documented escape-hatch cases — reformatting during a merge, fixing a CI-broken build, etc. — bypass with:

```bash
git commit --no-verify -m "..."
```

Any bypass must be noted in the PR body so reviewers can audit. The hook will not silently allow the bypass through; the audit trail is human, not automated.

---

## Reporting issues

- **Bugs:** use the [bug report template](./.github/ISSUE_TEMPLATE/bug_report.md).
- **Features:** use the [feature request template](./.github/ISSUE_TEMPLATE/feature_request.md).
- **Security vulnerabilities:** see [SECURITY.md](./SECURITY.md) — do **not** file a public issue.

---

## Versioning

Surakkha follows [Semantic Versioning 2.0.0](https://semver.org/). The current target is `0.1.0-planning`; the first release will be `1.0.0` once the demo walkthrough passes end-to-end.

---

## License

By contributing to Surakkha, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

## Code principles

These are the project's bar. They are mechanically enforced by
[`eslint.config.js`](./eslint.config.js) where possible and review-time
where mechanical enforcement is impractical. See [`AGENTS.md`](./AGENTS.md)
for the full rationale and the workflow expected of any AI agent
working on the codebase.

### Small

- Function: ≤ 200 lines, complexity ≤ 10, depth ≤ 4 (ESLint `warn`).
- File: ≤ 500 lines (ESLint `warn`). If a file hits this, split it.
- React component: ≤ 6 levels of JSX depth, no nested component
  definitions, one component per file unless trivial.
- Module: one feature per file. Cross-feature code goes in
  `packages/shared`.

### Typed

- TypeScript strict mode. No `any`, no `@ts-ignore` without a one-line
  justification, no non-null assertions outside tests, no unjustified
  `as` casts.
- Props on every React component. `interface` for object shapes, `type`
  for unions and aliases.
- Exported functions have return types.

### Immutable

- In-process state does not mutate. `Array.push/pop/shift/unshift/splice`
  and `Object.assign` are blocked by ESLint for production code.
- React state updates use the functional form
  (`setX(prev => ...)`), never direct mutation.
- Database writes are exceptions; the rule applies to in-process state.

### Professional

- No `console.log` in committed code. `console.warn` / `console.error`
  are permitted; everything else uses the shared logger.
- No commented-out code. No dead exports. No magic numbers.
- Error boundaries wrap every feature route in `packages/web`.
- Accessibility is not optional. Every interactive element has an
  accessible name; every form field has a label.
- No new dependency without a one-line justification in the PR body.

### Coding standard

The mechanical rules below live in `eslint.config.js` (block 3b).
They are the project's coding standard. Detailed prose lives in
[`AGENTS.md`](./AGENTS.md) §1.4.1.

- **Naming**: `camelCase` for variables and functions, `PascalCase`
  for types/classes/enums/interfaces, `UPPER_CASE` for true constants.
  Booleans start with `is`/`has`/`should`/`can`/`did`/`will`. Acronyms
  are uppercase: `userID`, `deviceID`, `incidentID`, `JWT_SECRET`.
- **No constructor types as type annotations** — `Function`, `Object`,
  `Boolean`, `Number`, `String`, `Symbol` are wrapper types; use the
  lowercase primitives instead.
- **Promise-returning functions must be `async`** (or explicitly typed
  `Promise<T>`).
- **Type assertions**: prefer `as const` over `as Foo`. A cast that
  hides a real type mismatch is forbidden.
- **Indexed object types**: `Record<string, T>`, not `{ [key: string]: T }`.
- **Template literals**: must contain stringifiable values. Use
  `String(x)` or `JSON.stringify(x)` for objects.
- **Node builtins**: use the `node:` protocol (`"node:fs"`, not `"fs"`).
- **Throw** `new Error(...)`, not `Error(...)`.
- **`event.target` over `event.srcElement`**.
- **No duplicate enum values**.
- **No array callback reference** for built-in methods.
- **No inline arrows** in component bodies where a top-level function
  would do.

### Audited

- The audit log is append-only and exhaustive for security-relevant
  events. See [ADR 0012](./docs/adr/0012-audit-log-invariants.md) for
  the closed enumeration.
- Any new audit action is added to the closed enumeration **and** to
  the CI test that verifies it.

### When the principles conflict with a request

If a user asks for code that violates a principle, surface the
conflict before writing the code. Do not silently comply. The PR
template's "Code principles" checklist is the audit trail for this
expectation.
