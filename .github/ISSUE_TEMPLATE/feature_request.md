---
name: Feature request
about: Propose a new feature, enhancement, or v2 candidate for Surakkha.
title: "[Feature] "
labels: ["enhancement", "needs-triage"]
assignees: []
---

> **Scope.** Surakkha v1 is feature-complete against the FR set in
> [`docs/Surakkha-PRD.md`](../../docs/Surakkha-PRD.md). v1.x patches are
> accepted. v2 features go on the roadmap; this template is for both.

Thanks for proposing a change. The fields below help maintainers decide
whether the request fits v1.x, belongs in v2, or should be declined.

---

## Summary

One sentence describing the feature.

## Problem

What user or operator problem does this solve? Who is affected?

## Proposed solution

What should change? Describe the user-visible behaviour, not the
implementation.

## Alternatives considered

What other shapes did you consider, and why is this one better?

## Scope

- [ ] v1.x patch (bug fix, perf, docs, DX) — eligible for current branch
- [ ] v2 candidate — defer to the v2 roadmap
- [ ] Out of scope — should be declined with rationale

## Wire contract impact

Surakkha's wire contract is frozen behind `version: 1` (architecture I-1,
NFR-14). Edits to `packages/shared/src/telemetry.ts` are a contract bump.

- [ ] No wire contract change required
- [ ] Wire contract bump required — see architecture §3 for the bump process

## Cross-cutting impact

- [ ] Affects `packages/api`
- [ ] Affects `packages/web`
- [ ] Affects `packages/simulator`
- [ ] Affects `packages/shared`
- [ ] Affects `packages/db`
- [ ] Affects ops constraints (architecture §8.2 I-9..I-15)

If multiple packages are affected, note which packages cannot import types
from another package's directory (see `CONTRIBUTING.md` cross-cutting rule).

## Requirements touched

Reference the FR or NFR this request advances. The full set lives in
`docs/Surakkha-PRD.md` §4 (FRs) and §5 (NFRs).

- FR-_:
- NFR-_:
- AR-_ (architecture rule):
- UX-DR-_ (experience rule):

If none apply, write "No FR/NFR touched — this is a new requirement" so
maintainers know a PRD delta is implied.

## Effort estimate (rough)

- [ ] Trivial — under half a day
- [ ] Small — 1–2 days
- [ ] Medium — a story
- [ ] Large — an epic
- [ ] Unknown

## Priority

- [ ] P0 — blocks the demo, blocks v1 sign-off
- [ ] P1 — needed for v1.x
- [ ] P2 — v2 candidate
- [ ] P3 — backlog

## Acceptance criteria (proposed)

Draft 3–5 bullets a maintainer can sanity-check before approving.

- [ ] …
- [ ] …
- [ ] …

## Mockups, sketches, or references

Link to designs, similar products, or specs. If the request touches the UI,
a wireframe in `.excalidraw` or an HTML mockup helps.

## Additional context

Anything else — related discussions, prior research, links to standards or
guidelines (WHO, BSTI, BD government water-safety documents if relevant).
