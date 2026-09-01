# Surakkha — AI Agent Rules of Engagement

This file is read by every AI coding agent (and every human contributor)
before writing code in this repository. It is opinionated. The opinion
is: **small, typed, immutable, professional, audited.**

If a request from a user contradicts the principles below, surface the
conflict to the user before writing code. Do not silently violate a
principle because the user asked for it. Do not silently violate a
principle because the implementation is easier without it.

---

## 1. The five principles

Every change in this repository is judged against these five. They
are not negotiable per-task; they are the project's bar.

### 1.1 Small

Components, functions, modules, and files stay small enough to read in
one screen. If a component is doing too much, split it. If a function
is doing too much, extract. If a file is doing too much, split it.

Concrete thresholds (enforced by `eslint.config.js`):

- **Function**: ≤ 200 lines, complexity ≤ 10, depth ≤ 4
- **File**: ≤ 500 lines (warn), 800 lines (error)
- **React component**: ≤ 4 hooks, ≤ 8 props, ≤ 6 levels of JSX depth
- **Module**: one feature per file; cross-feature code goes in
  `packages/shared`

If you write something that hits a threshold, do not raise the
threshold. Split the unit.

### 1.2 Typed

TypeScript strict mode is on. There are no untyped escapes.

- No `any`. If you do not know the type, derive it. Use `unknown` and
  narrow.
- No `@ts-ignore` / `@ts-expect-error` without a one-line comment
  explaining why, and a TODO with a date.
- No non-null assertions (`!`) outside test files.
- No `as` casts that hide a real type mismatch. If the type is wrong,
  fix the type, not the cast.
- Props on every React component. No `React.FC` (it hides props).
- Function signatures, return types on exported functions.
- `interface` for object shapes, `type` for unions/aliases. This is
  pinned in ESLint.

### 1.3 Immutable

Data does not mutate. State updates produce new values.

- `const` by default; `let` only when the value genuinely changes.
- No `Array.prototype.push`, `splice`, `sort` (in-place), `reverse` on
  data you do not own.
- Use `readonly` on props and state types. Use `ReadonlyArray<T>` for
  read-only arrays.
- React state updates: always a new value (`setX(prev => ...)`), never
  in-place mutation of the previous state.
- Object spreads over `Object.assign`. Spread operators over manual
  merging.
- Database writes are exceptions (we mutate rows); the rule applies
  to in-process state, not to the persistence layer.

### 1.4 Professional

The code reads like it was written by a senior engineer who cared.

- **No `console.log` in committed code.** `console.warn` and
  `console.error` are allowed; everything else is removed before
  commit. Use the logger (`packages/shared/src/logger.ts`) for
  diagnostic output.
- **No commented-out code.** Delete it. Git remembers.
- **No `TODO` without a date and an owner.** `// TODO: 2026-12-01
sanjit — handle empty case here` is acceptable. `// TODO` alone is
  not.
- **No magic numbers.** Named constants for every literal that is not
  `0`, `1`, `-1`, `true`, `false`, `null`, `""`. Thresholds come from
  the BRD §8.3.1 source-of-truth or a Story's acceptance criteria.
- **No deep prop drilling.** More than 2 levels of prop passing means
  the value should live in a context (Zustand store, React context,
  or a custom hook).
- **No `useEffect` for derived state.** Compute the value during
  render or in a `useMemo`. Effects are for side effects (network,
  subscriptions, DOM), not for transforming state.
- **Error boundaries** wrap every feature route in `packages/web`.
  A throw inside one feature does not take down the whole dashboard.
- **Accessibility** is part of "professional." Every interactive
  element has an accessible name (`aria-label` or text content).
  Every form field has a label. Color is not the only signal.
- **Imports are ordered and grouped**: external, internal
  (`@surakkha/*`), relative. ESLint enforces this.

#### 1.4.1 Coding standard (mechanically enforced)

These rules fire in `eslint.config.js` (block 3b). When you write
code, they will tell you what to do.

- **Naming**: variables and functions are `camelCase` or `PascalCase`.
  Types, classes, interfaces, and enums are `PascalCase`. Constants
  (frozen booleans/numbers/strings) are `UPPER_CASE`. Booleans start
  with `is`, `has`, `should`, `can`, `did`, or `will` — no
  `enabled: boolean` (that's a noun, not a state). Acronyms are
  uppercase: `userID`, `deviceID`, `incidentID`, `JWT_SECRET`, not
  `userId`, `deviceId`, `incidentId`, `jwtSecret`.
- **No constructor types as type annotations**: `Function`, `Object`,
  `Boolean`, `Number`, `String`, `Symbol` are forbidden as types. Use
  the lowercase primitives (`function` if you must, `object` never,
  `boolean`, `number`, `string`, `symbol`) or, better, a specific
  shape.
- **Promise-returning functions must be `async`** or explicitly typed
  `Promise<T>`. The `@typescript-eslint/promise-function-async` rule
  catches the accidentally-synchronous case.
- **Consistent type assertions**: prefer `as const` over `as Foo`.
  A cast that hides a real type mismatch is forbidden by §1.2; this
  rule is the mechanical companion.
- **`Record<string, T>` over `{ [key: string]: T }`** for indexed
  object types.
- **Template literals must contain stringifiable values**.
  `` `${someObject}` `` is forbidden — it produces `[object Object]`.
  Convert with `String(x)`, `JSON.stringify(x)`, or interpolate a
  primitive.
- **Node builtins use the `node:` protocol**: `import { readFile }
from "node:fs"`, not `from "fs"`. Aligns with Node 20 conventions.
- **Throw `new Error(...)`, not `Error(...)`**.
- **`event.target` over `event.srcElement`** (the latter is legacy IE).
- **No duplicate enum values**: typos like `enum X { A = 1, B = 1 }`
  are caught.
- **No array callback reference** for `forEach`/`map`/`reduce` etc.
  Don't pass a built-in (`console.log`, `parseInt`) as a callback.
  Define a wrapper or use the named form.
- **No inline arrow functions in component bodies when a top-level
  function would do** (`unicorn/consistent-function-scoping`). The
  JSX-inline-handler pattern is forbidden for non-trivial handlers.

### 1.5 Audited

Anything that affects thresholds, incidents, access, or state must be
auditable. ADR 0012 is the closed enumeration; respect it.

- Every state transition writes an audit row.
- Every rule change writes an audit row with before/after diff.
- Every failed authorization writes an audit row.
- The audit log itself is append-only (database trigger).
- Do not log raw `Reading` frames. The `Reading` table is the record.
- Do not add a new audit action without updating the
  `audit_log.action` enum and the CI test that verifies the
  enumeration.

---

## 2. The architecture contract

Before writing code, read the relevant ADR. The ADRs are the
authoritative "why" for each load-bearing decision.

- Wire contract → [ADR 0001](docs/adr/0001-wire-contract-first.md)
- Single Node process → [ADR 0002](docs/adr/0002-single-node-process.md)
- Postgres only → [ADR 0003](docs/adr/0003-postgres-only.md)
- HS256 single secret → [ADR 0004](docs/adr/0004-hs256-single-secret.md)
- Plain ws:// for v1 → [ADR 0005](docs/adr/0005-plain-ws-v1.md)
- Hourly aggregation cron → [ADR 0006](docs/adr/0006-hourly-aggregation.md)
- Monorepo layout → [ADR 0007](docs/adr/0007-monorepo-layout.md)
- Rule engine JSON DSL → [ADR 0008](docs/adr/0008-rule-engine-json.md)
- Severity + incident states → [ADR 0009](docs/adr/0009-severity-and-states.md)
- Device-id in path → [ADR 0010](docs/adr/0010-device-id-in-path.md)
- RBAC middleware → [ADR 0011](docs/adr/0011-rbac-middleware.md)
- Audit log invariants → [ADR 0012](docs/adr/0012-audit-log-invariants.md)
- Server processing order → [ADR 0013](docs/adr/0013-server-processing-order.md)
- AI-agent guardrails → [ADR 0014](docs/adr/0014-ai-agent-guardrails.md)

If a request would violate an ADR, surface it. Do not silently
override. The reversal conditions are documented in each ADR; if the
trigger has not been met, the ADR is still in force.

---

## 3. The package layout

This is a pnpm workspace monorepo. Five packages:

| Package              | Purpose                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/api`       | Express + Socket.IO, ingestion, rules, workflow                                                            |
| `packages/web`       | Vite + React + Tailwind dashboard (hand-rolled primitives — see `_bmad-output/.../DESIGN.md` §`ui_system`) |
| `packages/simulator` | Telemetry simulator (separate Node process)                                                                |
| `packages/shared`    | Wire contract, RBAC matrix, types, logger                                                                  |
| `packages/db`        | Migrations, seeds, fixtures                                                                                |

**Cross-cutting rule** (ADR 0007, ESLint-enforced): no epic may
import a type from another epic's directory. Cross-epic types live
in `packages/shared`. The ESLint config
(`import/no-restricted-paths`) blocks violations with a message
pointing at this rule.

The epic boundaries inside `packages/api` are:

- `auth/` — login, JWT, RBAC middleware
- `ingestion/` — WebSocket ingestion, server processing order
- `rules/` — JSON DSL, evaluation, de-bouncing
- `alerts/` — alert lifecycle, Socket.IO broadcast
- `workflow/` — incident state machine (ADR 0009)
- `admin/` — devices, rules, simulator, audit log views

---

## 4. Workflow for an AI agent

When asked to implement a story:

1. **Read the story** in `_bmad-output/planning-artifacts/epics.md`.
   Identify its acceptance criteria, its epic, and which packages it
   touches.
2. **Read the relevant ADRs.** If the story touches the wire
   contract, ingestion, rules, audit, RBAC, or incident state,
   read the matching ADR first.
3. **Plan the file layout.** List the files you will create or
   modify, including their package and epic directory. Confirm the
   layout respects the cross-cutting rule.
4. **Write the smallest viable slice.** Implement against the
   acceptance criteria. No speculative generality.
5. **Test against the ACs.** Every AC needs a passing test.
6. **Run ESLint and Prettier.** `pnpm lint --fix` then
   `pnpm format`. CI will fail otherwise.
7. **Run the type checker.** `pnpm -r typecheck`. Zero errors.
8. **Run the test suite.** `pnpm test`. Coverage thresholds in NFR-12
   apply (api ≥ 70% lines, web ≥ 50% lines).
9. **Update the audit enumeration** if you added a new audit action.
10. **Open the PR.** Use `.github/pull_request_template.md`. Tick
    every applicable box.

If you cannot complete a step, do not submit the work. Surface the
blocker to the user.

---

## 5. Anti-patterns (do not do these)

These are observed in AI-generated code and explicitly forbidden:

- **God component**: a 500+ line React component with 10+ hooks.
  Split it.
- **`useEffect` to copy props into state.** Use the prop directly or
  `useMemo`. Never `setX(props.y)` inside `useEffect`.
- **Stringly-typed enums.** If a value has a closed set of options,
  use a TypeScript union or enum. No `"warning" | "critical"` typed
  as `string`.
- **Catch-all `try { ... } catch (e) {}`.** Swallowed errors are
  silent regressions. Either rethrow, log, or handle.
- **`fetch` in render.** Network calls belong in `useEffect`,
  React Query, or a server action. Never in the render body.
- **Inline styles for repeated values.** Use Tailwind classes or a
  design token. Inline styles are for one-off, computed values only.
- **Commented-out code.** Delete it.
- **Dead code.** Unused exports, unreachable branches, unused
  imports. ESLint flags these; do not silence them.
- **`@ts-ignore`** without explanation. Fix the type.
- **A new dependency** without a one-line justification in the PR.
  Every dep is a supply-chain and bundle-size cost.

---

## 6. When the user is wrong

If the user asks for something that violates an ADR or one of the
five principles, do not silently comply. Reply with:

1. The principle or ADR being violated.
2. The specific code change that would do so.
3. The smallest change that respects the principle.

Example: user asks "add a console.log to debug this". Reply: "The
principle in §1.4 forbids `console.log` in committed code. Use the
logger from `packages/shared/src/logger.ts` instead, or use a
breakpoint. Here is the change."

If the user insists after you have surfaced the conflict, comply but
flag the violation in the PR description. The PR template has a
"principles checklist" for exactly this reason.

---

## 7. Reading order for a new contributor (human or AI)

1. [`README.md`](README.md) — what this project is
2. [`AGENTS.md`](AGENTS.md) (this file) — how to work on it
3. [`RUNBOOK.md`](RUNBOOK.md) — **if you were asked to "run the project", start here.** Documents the dev stack boot order, seed scripts, and the five operational pitfalls (catch-all 404 order, auth path is `/auth/login`, container can be "healthy" while api is dead, `--ignore-scripts` breaks bcrypt, cached image isn't recreated automatically).
4. [`docs/architecture.md`](docs/architecture.md) — the technical shape
5. [`docs/adr/`](docs/adr/) — the "why" behind each decision
6. [`CONTRIBUTING.md`](CONTRIBUTING.md) — day-to-day workflow
7. [`docs/Surakkha-PRD.md`](docs/Surakkha-PRD.md) — what to build next
8. `_bmad-output/planning-artifacts/epics.md` — the stories
