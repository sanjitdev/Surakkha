<!--
Thanks for the pull request. The checklist below mirrors CONTRIBUTING.md.
Tick each box that applies; leave blank if not applicable.
-->

## Summary

One sentence describing the change.

## Type

Mark exactly one. Conventional Commits prefixes are in `CONTRIBUTING.md`.

- [ ] `feat:` — new feature
- [ ] `fix:` — bug fix
- [ ] `docs:` — docs only
- [ ] `style:` — formatting, no logic change
- [ ] `refactor:` — internal change, no behaviour change
- [ ] `test:` — tests only
- [ ] `chore:` — build, CI, deps, tooling
- [ ] `revert:` — revert of a prior commit

## Linked issue

Closes #_, fixes #_, or relates to #_. Use "Closes" only if the PR fully
resolves the issue.

## Linked story

Reference the story in `_bmad-output/planning-artifacts/epics.md`. The story
ID format is `<epic>.<n>` (e.g. `1.4`, `3.3`, `6.7`).

- Story: _

## Wire contract

The wire contract is frozen behind `version: 1` (architecture I-1, NFR-14).

- [ ] No wire contract change
- [ ] Bumps wire contract — bump process in `docs/architecture.md` §3 followed

## Operational constraints

- [ ] Touches a v1 constraint (I-9..I-15) — call this out in the description
- [ ] No v1 constraint touched

## Test coverage

- [ ] Unit tests added or updated
- [ ] Integration tests added or updated
- [ ] Playwright happy-path test (`__tests__/e2e/happy-path.spec.ts`) still green
- [ ] Latency test (`__tests__/e2e/latency.spec.ts`) still green
- [ ] Negative RBAC test (`__tests__/rbac.negative.spec.ts`) still green
- [ ] Coverage thresholds still met (api ≥ 70% lines, web ≥ 50% lines per NFR-12)

## Cross-cutting rules

- [ ] No epic imports a type from another epic's directory (see `CONTRIBUTING.md`)
- [ ] Shared types live in `packages/shared` only
- [ ] No ad-hoc README/docs files added outside the canonical paths
- [ ] Migrations, if any, are reversible and documented

## Code principles

These are the project's bar, not a per-PR preference. See [`AGENTS.md`](../../AGENTS.md) §1 for full context. Tick every box that applies; leave blank if not applicable.

### Small (AGENTS.md §1.1)

- [ ] No file exceeds 500 lines (warn) / 800 lines (error)
- [ ] No function exceeds 200 lines or complexity 10
- [ ] No React component exceeds 6 levels of JSX depth
- [ ] No nested component definitions (functions defined inside another component)
- [ ] Component split if a component exceeded these limits (do not silence the lint warning)

### Typed (AGENTS.md §1.2)

- [ ] No `any` (use `unknown` and narrow)
- [ ] No `@ts-ignore` or `@ts-expect-error` without an explanation comment
- [ ] No non-null assertion (`!`) outside test files
- [ ] No unjustified `as` casts that hide a type mismatch
- [ ] All React components have explicit, typed props
- [ ] Interface (not type alias) used for object shapes

### Immutable (AGENTS.md §1.3)

- [ ] No `Array.push/pop/shift/unshift/splice/sort/reverse/fill` on shared arrays
- [ ] No `Object.assign` for state updates (use `{...a, ...b}`)
- [ ] React state updates use the functional form (`setX(prev => ...)`)
- [ ] Props and state types use `readonly` / `ReadonlyArray` where appropriate

### Professional (AGENTS.md §1.4)

- [ ] No `console.log` (only `console.warn` / `console.error` allowed; use the shared logger for diagnostics)
- [ ] No commented-out code
- [ ] No `TODO` without a date and an owner
- [ ] No magic numbers — literals are named constants (see `BRD §8.3.1` for thresholds)
- [ ] No prop drilling past 2 levels (lift to context or a store)
- [ ] No `useEffect` for derived state — compute during render or `useMemo`
- [ ] Interactive elements have accessible names; form fields have labels
- [ ] No new dependencies without a one-line justification in the PR

### Audited (AGENTS.md §1.5)

- [ ] Every state transition writes an audit row
- [ ] Every rule change writes an audit row with before/after diff
- [ ] Every failed authorization writes an audit row
- [ ] No raw `Reading` frames logged
- [ ] Any new audit action is added to the closed enumeration (ADR 0012)

## Documentation

- [ ] `docs/` updated where behaviour changed
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Inline code comments cite architecture IDs (`I-N`, `AR-N`, `FR-N`, `NFR-N`)
- [ ] New env vars added to `.env.example` and `README.md` env-vars table

## Security

- [ ] No new env vars that bypass the auth checks
- [ ] No new endpoint without RBAC coverage in `docs/architecture-appendix-rbac.md`
- [ ] No new external network calls

## Screenshots or recordings

For UI changes, attach before/after or a short clip. The wireframe source
files live under `_bmad-output/planning-artifacts/ux-designs/`.

## Verification steps

How can a reviewer reproduce and confirm this change?

1. …
2. …
3. …

## Risk and rollback

What is the blast radius if this breaks? How do we revert? One sentence
each.

- Risk: …
- Rollback: …
