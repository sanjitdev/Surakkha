# 0014 — AI-agent guardrails as code

**Status:** Accepted
**Date:** 2026-08-21
**Deciders:** Engineering team
**Related architecture IDs:** (workspace policy)
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Surakkha is expected to be implemented by an AI coding agent in a
series of build iterations (`bmad-build`). The agent reads context,
proposes changes, writes code, opens PRs, and reacts to review
feedback. The risk surface of an AI-driven codebase is different
from a human-driven one:

- An AI agent does not internalise conventions through socialisation.
  It needs the rules in a file it can read on every iteration.
- An AI agent will silently optimise for "the code works" rather than
  "the code is small, typed, immutable, professional". The default
  shape of LLM-generated code is verbose, loosely typed, and
  mutating.
- An AI agent can be instructed by the user to violate a project
  principle without realising it is a principle. The user's
  authority is not the project's authority.
- Architectural review meetings do not scale to an AI agent's
  iteration cadence. Enforcement must be mechanical or PR-time.

Forces:

- **Speed vs. quality**: an AI agent can produce many PRs per day.
  Review must catch regressions without slowing the loop to zero.
- **Plurality of tools**: the agent may use Cursor, Claude Code,
  Aider, or a hand-rolled harness. The rules must live in the repo,
  not in a per-tool config.
- **Drift**: a rule that lives only in a doc file will be forgotten
  after one or two iterations. The rule must be enforced by a
  machine.

## Decision

We enforce project principles through **three layers**, each
covering what the others cannot:

1. **`AGENTS.md` at the repo root.** Plain-prose, opinionated rules
   every agent reads on session start. The five principles
   (Small, Typed, Immutable, Professional, Audited) live here with
   concrete thresholds. Anti-patterns are listed. The "when the user
   is wrong" section tells the agent how to surface conflicts.
2. **`eslint.config.js` (mechanical enforcement).** Every principle
   that can be expressed as a lint rule is. The full enumeration is
   in `CONTRIBUTING.md` "Code principles" and `AGENTS.md` §1.
   Mechanical enforcement is **error** level for rules that
   silently weaken the contract (e.g. `import/no-restricted-paths`,
   `no-restricted-syntax` for mutation, `react/no-unstable-nested-components`)
   and **warn** level for rules that are nudges (e.g. file size,
   complexity).
3. **PR template principles checklist.** The
   `.github/pull_request_template.md` "Code principles" section is
   the human/agent review-time check. Reviewers tick boxes; missing
   ticks are a reject reason.

Three corollaries:

1. **No rule lives in only one layer.** A principle that is only in
   `AGENTS.md` is forgotten; a principle that is only in the PR
   template is bypassed; a principle that is only in ESLint cannot
   be reasoned about. Each principle appears in at least two
   layers.
2. **The layers escalate, not duplicate.** ESLint catches
   mechanical violations automatically. The PR checklist catches
   judgement calls (was this component small enough? were the
   thresholds sensible?). `AGENTS.md` is the prose that justifies
   both.
3. **Architectural review is not a layer.** We do not schedule
   review meetings for AI-agent PRs. The three layers above are
   exhaustive. A fourth layer (architectural review) is a v2
   concern when the team grows beyond the agent.

## Consequences

**Positive**

- An AI agent reading `AGENTS.md` on session start has the project's
  bar in one place. It cannot claim ignorance.
- ESLint runs on every file write (via `lint-staged`) and on every
  CI run. Mechanical violations are caught before merge.
- The PR template's checklist is the explicit handoff: the agent
  states which principles it followed, the reviewer confirms.
- New contributors (human or AI) follow the same onboarding path:
  read `README.md`, read `AGENTS.md`, read the relevant ADR, write
  code against the principles.

**Negative**

- **The layers can drift.** `AGENTS.md` says one thing, ESLint
  enforces another. We mitigate by citing the rule IDs
  (`AGENTS.md §1.1`, `eslint.config.js rule-id`) in both files.
- **Mechanical rules have false positives.** `react/jsx-max-depth: 6`
  may flag a legitimately complex layout. The agent should split,
  but if it cannot, a one-line `// eslint-disable-next-line` with a
  justification is acceptable. The PR reviewer confirms.
- **`AGENTS.md` is a long file.** It is long because the rules are
  numerous. A shorter file would be vaguer. We accept the length.

**Neutral**

- We are not committing to a specific AI tool or harness. The rules
  are tool-agnostic.

## Reversal

The three-layer enforcement model reverses when:

- **The team grows past the AI agent.** Multiple human contributors
  with their own conventions need a fourth layer (architectural
  review, design docs, RFC process). The three layers still apply;
  the new layer is added.
- **The mechanical rules cause more false positives than real
  catches.** We relax the threshold (e.g. `max-lines: 500 → 750`)
  or remove the rule. The principle in `AGENTS.md` remains; only
  the mechanical enforcement is gone.
- **A new principle category emerges** (e.g. "performance budget",
  "i18n completeness"). It is added to `AGENTS.md`, the ESLint rule
  (if mechanical), and the PR template.

Until then, three layers, each load-bearing. The repo's principles
are enforced as code, not as conversations.