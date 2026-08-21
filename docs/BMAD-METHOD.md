# BMAD method — per-story execution loop

This document describes the per-story execution loop the project uses for
Phase 4 implementation. Each story is run as a `bmad-build`-style cycle
(clarify intent → plan → implement → review → present). The artefacts
are produced into `_bmad-output/implementation-artifacts/` so a sprint
status tool can read the ledger.

**Last verified on 2026-08-21.** Story 1.8 has been shipped through this
loop; the loop is the canonical pattern from Story 1.9 onward.

---

## The seven-step cycle

For every story, run steps 1–7 in order. Steps 1–4 are BMAD-derived
plans; steps 5–7 are mechanical and live entirely in the repo.

### 1. Story context (what does this story need to know?)

**Source:** `_bmad-output/planning-artifacts/epics.md` → the story's
*As a … I want … So that …* stanza + bulleted ACs.

**Inputs read:**
- Story body + ACs (acceptance criteria, file targets, "Covers:" line).
- Linked architecture (`docs/architecture.md`) if the AC names an
  invariant (e.g., I-9, I-13).
- Linked UX (`_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/DESIGN.md`
  or `EXPERIENCE.md`) if the AC names a UX-DR- or UX-FR- decision.
- Prior stories already merged (the cycle is monotonic — re-read the
  last merged commit's message to confirm we're stacking on the right
  baseline).

**Output:** a one-paragraph `intent` restatement answering *"what does
this AC make true?"* The restatement is the rest of the cycle's
north star.

### 2. Sprint status (where are we?)

**Source:** the `sprint-status.yaml` (or equivalent) at
`_bmad-output/implementation-artifacts/sprint-status.yaml`. If absent,
seed it from `epics.md` (one entry per story: `pending`).

The current story becomes `in-progress`; the rest stay `pending`. The
sprint status is the input to the next story's step 1.

**Why this step:** BMAD's `bmad-sprint-planning` (SS) is the
readiness-gate + tracker. Doing this in a yaml file keeps the loop
reproducible without a separate tool.

### 3. ATDD — red-phase acceptance tests (what does passing look like?)

**BMAD analogue:** `bmad-testarch-atdd` (phase 4).

**Output:** failing tests that, when green, prove each AC. Each AC
bullet → at least one `expect(...)` clause. The tests are written
before the implementation and committed in the same commit as the
implementation (the cycle's "red, then green" is verified by the diff:
the test fails on the first half of the diff, passes on the second).

**Tests live in:**
- `packages/<pkg>/__tests__/*.spec.ts` for cross-file fixtures
- `packages/<pkg>/src/**/*.spec.ts` for unit tests that live next to
  the code

**Verification command:** `pnpm --filter "@surakkha/<pkg>" test`.

### 4. Implementation — make the red tests pass

**BMAD analogue:** `bmad-build` (BD) → implement step.

**Rules (cross-cutting, from `docs/architecture.md` and
`docs/architecture-appendix-opconstraints.md`):**
- All cross-epic types live in `packages/shared`. No epic imports
  types from another epic's directory.
- The wire contract is frozen behind `version: 1`. A bump is a v2
  event, not a per-story edit.
- The HS256 single-secret policy (I-13) is enforced by the test
  register, not by docs-only.
- No marketing copy, no exclamation marks (UX voice discipline from
  `DESIGN.md`).

**Output:** the source files that turn the red tests green, plus any
required fixture / wiring.

### 5. Pipeline verification (does it ship?)

**Run, in order:**
1. `pnpm typecheck` — all 4 packages compile, no errors.
2. `pnpm lint` — ESLint 9 flat config, `--max-warnings 0`.
3. `pnpm lint:rbac` — matrix ↔ handler cross-check.
4. `pnpm test` — full test suite across all packages.
5. `pnpm --filter "@surakkha/<pkg>" build` — clean dist, no test
   helpers leaking into `dist/` (the `src/__tests__/**` exclude
   pattern is the guard).

**If any step fails, the story is not shippable. Fix and re-run.** No
exceptions — the pipeline is the contract.

### 6. Code review (is the AC actually satisfied?)

**BMAD analogue:** `bmad-code-review` (CR).

**Checklist, per AC:**
- [ ] The AC's *Given/When/Then* is mirrored in a test clause.
- [ ] The test fails without the implementation (red).
- [ ] The test passes with the implementation (green).
- [ ] No off-AC surface added (no "while I'm here" refactors).
- [ ] Cross-cutting rules respected (shared types, wire contract, I-13).
- [ ] Files named and structured per the AC's file targets.

**Output:** an "all green" stamp before commit. If a check fails, fix
and re-run step 5.

### 7. Commit (the immutable record)

**Format:** Conventional Commits, type + scope + imperative summary.

```
<type>(<scope>): <summary> (Story <id>)

<body — 3-7 sentences explaining the WHY and WHAT>

<footer>
Co-Authored-By: Opus 4.8 <noreply@puku.sh>
```

**Type:** `feat` (new) / `fix` (bug) / `refactor` / `test` / `docs` /
`chore`. The Story id goes in the body, not the subject line — the
subject line stays scannable.

**Forbidden:**
- `--no-verify` (pre-commit hooks are policy).
- `--amend` (always a new commit; never rewrite history).
- Bundling unrelated stories in one commit.

**Push policy:** `git push` is *not* automatic. The local branch
strays ahead of `origin/main` because the user reviews before push.
This is intentional — do not push without explicit instruction.

---

## Outputs produced per story

Per story, write into `_bmad-output/implementation-artifacts/`:

- `sprint-status.yaml` — the current ledger (steps 1, 2).
- `stories/<id>.context.md` — the intent restatement + cross-refs
  (step 1).
- `stories/<id>.review.md` — the checklist from step 6, dated and
  signed off.

These files are the BMAD `implementation_artifacts` output. The
`bmad-qa-generate-e2e-tests` skill (QA) reads them to produce E2E
coverage later.

---

## What BMAD steps are *not* used here

For transparency, the following BMAD skills are *not* invoked per story
in this project:

- `bmad-create-story` — stories already exist in `epics.md`. Re-using
  the loop's step 1 ("story context") in place of the formal skill is
  equivalent for this project's scale.
- `bmad-correct-course` — owned by the user; the loop defers to the
  user when the AC is no longer shippable.
- `bmad-retrospective` — owned by the user at epic boundaries.

The skills were *consulted* (their `module-help.csv` descriptions
informed this document) but not invoked. The loop is a deliberate
subset of the BMAD cycle, not a replacement.

---

## Worked example — Story 1.8

Story 1.8 (Negative RBAC Tests, FR-21) ran through this loop on
2026-08-21.

- **Step 1 (context):** AC = "≥10 negative RBAC cases pinning the matrix
  → 403 contract." Cross-refs: `docs/architecture-appendix-rbac.md`,
  `packages/api/src/middleware/authorize.ts`.
- **Step 2 (sprint):** Story 1.8 set to `in-progress` in
  `sprint-status.yaml` (last verified on 2026-08-21).
- **Step 3 (ATDD):** wrote `packages/api/__tests__/rbac.negative.spec.ts`
  with 14 cases in `NEGATIVE_CASES` + 2 ownership cases. All 17 tests
  red.
- **Step 4 (implement):** wrote `packages/api/src/__tests__/rbacNegativeRouter.ts`
  (test-only Express factory) + fixed `tsconfig.json` to exclude
  `src/__tests__/**` from production dist.
- **Step 5 (pipeline):** typecheck ✓, lint ✓, lint:rbac 11/13 actions
  referenced (acknowledge_banner, assign deferred to Epic 2/3),
  53/53 api tests ✓, build ✓.
- **Step 6 (review):** all 14 AC cells covered (the 10-floor is
  exceeded by 4); ownership cases carry `reason: "not_assignee"`; no
  off-AC surface.
- **Step 7 (commit):** `4a4ee53 feat(api): 14-case negative RBAC test
  register (Story 1.8)`.

---

## Change log

- 2026-08-21 — initial version. Mirrors BMAD v6 `bmad-build` (BD) loop
  with explicit per-step outputs.
