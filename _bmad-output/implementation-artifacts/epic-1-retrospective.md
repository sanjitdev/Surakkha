# Epic 1 — Retrospective

**Date:** 2026-08-21
**Scope:** Epic 1 — Auth, RBAC, and Login
**Status:** CLOSED (11/11 stories shipped)
**BMAD analogue:** `bmad-retrospective` (ER)
**Inputs:** `sprint-status.yaml`, 11 `stories/<id>.review.md` files, 11 `stories/<id>.context.md` files, `docs/BMAD-METHOD.md`, 17 commits on `main`
**Output:** this file

---

## 1. Summary

| Metric | Value |
|---|---|
| Stories shipped | 11 of 11 (1.1, 1.2a, 1.2b, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10) |
| Source commits | 11 (one per story) |
| Ledger commits | 4 (BMAD method doc, retro ledger 1.1–1.8, story 1.9 ledger, story 1.10 ledger + Epic 1 closure) |
| Files added / modified | 77 |
| Lines added | 8,223 (mostly auth + RBAC + shell scaffolding) |
| Tests shipped | **164** (56 api + 88 web + 20 shared) |
| Test files | 9 (`rbac.negative.spec.ts`, `auth.no-rotation.spec.ts`, `jwt.spec.ts`, `router.spec.ts`, `users.spec.ts`, `authorize.spec.ts`, `jwtDecode.spec.ts`, `refresh.spec.ts`, `tokens.spec.ts`, `access.spec.tsx`, `shell.spec.tsx`, `login.spec.tsx`, `KpiStat.spec.tsx`) |
| Pipeline status at close | typecheck ✓ • lint ✓ (5/5) • lint:rbac ✓ (11/13 actions) • tests 164/164 ✓ • build ✓ |

### Story-by-story ledger

| # | Title | Commit | New tests |
|---|---|---|---|
| 1.1 | RBAC Matrix Lock | `fec0834` | (matrix spec) |
| 1.2a | Design Tokens + Density | `3039b88` | 27 (tokens) |
| 1.2b | Responsive Layout Shell | `822b736` | 13 (shell) |
| 1.3 | Login Shell | `a8ec5ec` | 12 (login) |
| 1.4 | JWT Auth + Refresh | `8184cda` | 23 (jwt + router + users) |
| 1.5 | RBAC Middleware | `e272f95` | 13 (authorize) |
| 1.6 | Role-Aware Nav + RBAC Denied State | `034634e` | 15 (access) |
| 1.7 | 401 Refresh Flow | `8742339` | 11 (jwtDecode + refresh) |
| 1.8 | Negative RBAC Tests | `4a4ee53` | 17 (rbac.negative) |
| 1.9 | Critical-First Visual Hierarchy | `baa4aed` | 10 (KpiStat) |
| 1.10 | Single-Secret JWT Rotation Policy | `c9a6ce5` | 3 (auth.no-rotation) |

---

## 2. What worked

### 2.1 — Cross-cutting rules survived intact

Every shipped story respected the four cross-cutting rules from `docs/BMAD-METHOD.md`:

- Shared types live in `packages/shared` — no epic imported types from another epic's directory.
- The wire contract (`packages/shared/src/auth.ts`) was edited exactly twice in Epic 1 (Story 1.4 base, Story 1.7 role claim) and stayed at `version: 1`.
- The HS256 single-secret JWT policy was enforced both by the fail-fast (Story 1.4) *and* by an invariant test that walks the source (Story 1.10). Two independent guardrails for the same constraint.
- UX voice discipline held — no `!` anywhere in user-facing copy, no marketing language.

### 2.2 — Pipeline is the contract

Every story went through `pnpm typecheck` + `pnpm lint` + `pnpm lint:rbac` + `pnpm test` + `pnpm build` before commit. **Every story was green on the first commit.** No `--no-verify`, no skipped hooks, no test-only commits that broke the pipeline.

The `lint:rbac` script (`scripts/lint-rbac-matrix.mjs`) caught the right things — it flags `acknowledge_banner` and `assign` as not-yet-referenced, which is the correct Epic 2/3 deferral signal.

### 2.3 — Test register scaled

Story 1.8's data-driven negative test register (14 cases in `NEGATIVE_CASES` + 3 ownership cases) was the right shape. Adding a new denial cell is one row in the table — no new `it(...)` block required. Story 1.10 followed the same data-driven pattern (a `FORBIDDEN_ENV_VARS` constant + a walk-the-source-tree assertion).

### 2.4 — Ledger-first retrospective is cheap

The retroactive ledger commit (`d61834e`, 19 files, 947 insertions) was a one-shot operation once the loop was documented. Every future loop iteration has a peer to model its own context + review file on. The per-story review file is now the entry point for any "why is this code here?" question.

### 2.5 — Conventional Commits + Co-Authored-By footer

The commit log reads cleanly:
```
3056f65 docs(bmad): ledger for Story 1.10 + Epic 1 closure (Epic 1 COMPLETE)
c9a6ce5 chore(auth): single-secret JWT rotation policy + invariant test (Story 1.10)
d448bcd docs(bmad): ledger for Story 1.9 (context + review + sprint-status)
baa4aed feat(web): critical-first KpiStat card on the authenticated shell (Story 1.9)
d61834e docs(bmad): retroactive ledger for Stories 1.1 to 1.8
3a9fa6c docs: BMAD per-story execution loop (docs/BMAD-METHOD.md)
4a4ee53 feat(api): 14-case negative RBAC test register (Story 1.8)
8742339 feat(web): silent token refresh with offline fallback (Story 1.7)
034634e feat(web): role-aware nav with RbacDenied empty state (Story 1.6)
e272f95 feat(api): RBAC middleware with single authorize gate (Story 1.5)
8184cda feat(api): JWT auth, refresh cookie, JWT_SECRET fail-fast (Story 1.4)
a8ec5ec feat(web): login shell with split-screen hero + FormField primitive (Story 1.3)
822b736 feat(web): responsive layout shell with role-aware sidebar (Story 1.2b)
3039b88 feat(web): wire design tokens + density baseline (Story 1.2a)
fec0834 chore(auth): lock RBAC matrix and add coverage lint (Story 1.1)
```

`feat` / `chore` / `docs` types are scoped by package; `Story <id>` is in the body where the message is multi-line.

---

## 3. What to change

### 3.1 — `tsconfig.json` `rootDir` discipline

Story 1.8 hit a regression where `rootDir: "./"` caused test helpers to leak into the production dist at `dist/src/__tests__/rbacNegativeRouter.js`. Fix: `rootDir: "./src"` + `exclude: ["**/*.test.ts", "**/*.spec.ts", "src/__tests__/**"]`. **Action for Epic 2:** when adding a new package, copy `packages/api/tsconfig.json` as the template — don't hand-roll.

### 3.2 — Test fixtures under `src/__tests__/`

Story 1.8 also discovered that test-only Express factories live best under `src/__tests__/`, not `__tests__/` at the package root. The `tsconfig.json` `exclude` rule makes `src/__tests__/**` a no-compile zone while `vitest` still picks up the file via its default glob. **Action for Epic 2:** keep this convention for any shared Express factory (e.g. Story 2.4 simulator test fixture).

### 3.3 — ESLint complexity budget

Story 1.7's `apiClient.ts` had to be split into `withBearer`, `withJsonContentType`, `buildAuthedHeaders`, `retryAfterRefresh` to satisfy `complexity` and `max-params: 3`. **Action for Epic 2:** when writing the websocket handler (Story 2.2) and the rule evaluator (Story 3.x), pre-emptively factor the helper functions rather than hitting the lint ceiling mid-loop.

### 3.4 — Bash chaining in the sandbox

Several commands that joined with `&&` were denied at the sandbox layer. The fix was to run the commands separately. **Action for Epic 2:** keep the one-command-per-Bash-call discipline.

### 3.5 — Two-commit story pattern

Each story was committed as `feat/chore` + `docs(bmad): ledger`. The ledger commit carries the review file, the context file, and the sprint-status update. The split keeps source diffs clean (every source commit is one story) and lets the ledger be regenerated without rewriting history. **Action for Epic 2:** keep the split.

---

## 4. Lessons learned

### L1 — Schema-pinning is the cheapest invariant

The cheapest way to enforce a cross-cutting constraint is a test that *walks the source*. Story 1.10's `auth.no-rotation.spec.ts` does this — it reads every `.ts` file in `packages/api/src/`, strips comments, and asserts no `JWT_PUBLIC_KEY` literal is referenced. The test is 100 lines, has no dependencies, and will fail the moment someone adds JWKS support. Use this pattern for any future "this MUST not happen" constraint.

### L2 — The lint:rbac script is the right tool

`scripts/lint-rbac-matrix.mjs` is a 144-line Node script that grep-walks the api source for handler references to matrix actions. It runs in 200ms and catches drift in real time. **The same shape applies to telemetry schemas (Story 2.1)**: a script that walks `packages/api/src/ingest/` and asserts every handler references a metric type from the shared schema. Add a parallel `scripts/lint-wire-contract.mjs` in Epic 2.

### L3 — Test the test, not the implementation

Story 1.10's test passes today because Story 1.4's fail-fast is correct. The test is a contract pin, not a TDD red-then-green. This is the right shape for any "must remain true" invariant. The BMAD loop's ATDD step should distinguish "red-then-green" (new feature) from "contract pin" (constraint enforcement) and the review file should note which it is.

### L4 — Two commits per story is a feature, not a bug

The split between `feat/chore` (source) and `docs(bmad)` (ledger) means a future contributor can:
- Bisect source-only regressions (`git bisect` over `feat`/`chore` commits).
- Skip the ledger when reading the source diff (`git log --no-merges --grep="^docs"`).
- Regenerate the ledger from scratch if a future BMAD version adds new fields.

### L5 — Story 1.9 is the design-system proof

Story 1.9 (`KpiStat`) is the only Epic 1 story that produced *visible* output (the `/severity-cards` route renders four severity cards on the authenticated shell). Stories 1.1–1.8 are mostly invisible — they wire contracts and guards. Story 1.9 is the reviewer-visible "yes, the design system is wired" moment. **Action for Epic 2:** identify the equivalent reviewer-visible story in each epic (Story 2.4 / 2.7 / 2.8 are likely candidates) and front-load it.

---

## 5. Open risks for Epic 2

### R1 — `acknowledge_banner` and `assign` actions are not yet referenced by any handler

`lint:rbac` reports 11/13 actions referenced. The two missing are `acknowledge_banner` (Story 4.6 — Severity Banner) and `assign` (Story 4.x — Incident Assignment). Not a blocker for Epic 2 (which is telemetry + dashboard), but the gap should close by Epic 4. **Action:** when Epic 4 lands, re-run `lint:rbac` and expect 13/13.

### R2 — The `pnpm-lock.yaml` keeps regenerating

Every Epic 1 commit that touched a package's `package.json` also touched `pnpm-lock.yaml`. The lockfile churn is noisy in `git log --stat`. **Action:** consider `--no-lockfile` for story commits where the lockfile change is a `pnpm install` artifact, not a story outcome.

### R3 — WebSocket endpoint design (Story 2.2)

Epic 1 has no socket transport — only the SPA's `socket.io-client` (Story 1.7) is wired, and it only consumes the future `reading:new` event. Story 2.2 introduces the api-side endpoint. **Risk:** the wire-contract seam (Story 2.1) and the socket protocol must agree on the same `TelemetryFrame` schema. **Action:** write Story 2.1's `telemetry.ts` schema first, then derive the socket protocol from it. Don't let Story 2.2 invent its own shape.

### R4 — Simulator is its own process

Epic 1 left the simulator untouched (it's a placeholder `package.json` from Step 0). Story 2.4 introduces a real simulator process. **Risk:** the simulator runs as a separate Node container in the docker-compose stack and must mint its own JWT (the `aud: "simulator"` claim template from Story 2.1). **Action:** verify the simulator's JWT minting uses the same `JWT_SECRET` and the shared claim schema, and add it to the `lint:rbac` set when it ships.

### R5 — Dashboard Shell (Story 2.6) is bigger than it looks

Story 2.6 has to mount the KPI band (Story 2.x), the map (Story 2.7), and the live readings table (Story 2.8) inside the AppShell. Epic 1's shell (Story 1.2b) has placeholder stubs for these. **Action:** before Story 2.6 lands, the three child components must be in place. Sequence: 2.1 → 2.2 → 2.3 → 2.4 → 2.6 (with stubs) → 2.7 → 2.8 → 2.9.

### R6 — Connection State + Offline UX (Story 2.9)

Epic 1's `apiClient.ts` has a `no-op onOffline` placeholder (Story 1.7's `console.warn`). Story 2.9 wires the real offline surface (UX-DR-11). **Action:** the offline surface must not change the existing refresh flow — it's an additive banner that fires on the same `onOffline` callback.

---

## 6. Recommended next action

**Run `bmad-build` for Story 2.1 (Wire Contract Schemas).** This is the foundation for every Epic 2 story — the simulator, the websocket endpoint, the dashboard, and the map all derive from `packages/shared/src/telemetry.ts`. Land it first; the other 8 Epic 2 stories have a stable substrate to build on.

---

## 7. Sprint-status update

After this retrospective is committed, `sprint-status.yaml` will have:

- Epic 1 status: `done`
- An `epic-1-retrospective` entry with status `done`

The next story to surface in the sprint-status skill's recommendation is **Story 2.1** (the only `pending` story in Epic 2).

---

## Change log

- 2026-08-21 — initial retrospective. Epic 1 closed.
