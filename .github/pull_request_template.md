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
