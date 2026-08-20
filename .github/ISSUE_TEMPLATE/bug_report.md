---
name: Bug report
about: Report a defect, regression, or unexpected behaviour in Surakkha.
title: "[Bug] "
labels: ["bug", "needs-triage"]
assignees: []
---

> **Security note.** If the bug is a security vulnerability, do not file it here.
> Follow the private reporting process in [`SECURITY.md`](../../SECURITY.md).

Thanks for taking the time to report a defect. The fields below mirror what
`SECURITY.md` asks for, adapted for non-security bugs.

---

## Summary

One sentence describing what is broken.

## Affected component

Mark all that apply. This routes the issue to the right maintainer.

- [ ] `packages/api` — backend, ingestion, rules engine, workflow
- [ ] `packages/web` — frontend dashboard
- [ ] `packages/simulator` — telemetry simulator
- [ ] `packages/shared` — wire contract and shared types
- [ ] `packages/db` — migrations and seed
- [ ] Infrastructure (`docker-compose.yml`, env, deploy)
- [ ] Documentation (`docs/`, `README.md`, `_bmad-output/`)
- [ ] Other (describe in "Additional context")

## Steps to reproduce

1. …
2. …
3. …

## Expected behaviour

What should have happened.

## Actual behaviour

What actually happened. Include error messages, stack traces, screenshots,
or short screen recordings when they help.

## Environment

- Surakkha version: `git rev-parse HEAD` output, or tag (e.g. `1.0.0-rc.1`)
- Run mode: `docker compose up`, local Node, deployed instance
- Browser (for web bugs): name + version
- OS: `uname -a` or Windows version
- Node version (for local dev): `node -v`

## Reproducibility

How often does this happen? Every time, intermittent, once?

- [ ] Always
- [ ] Intermittent (roughly __ of __ attempts)
- [ ] Once

## Severity

How bad is the impact?

- [ ] Blocker — the demo or a core workflow cannot complete
- [ ] High — a primary feature is broken
- [ ] Medium — a secondary feature is broken or unreliable
- [ ] Low — cosmetic, typo, or minor inconvenience

## Severity vocabulary (if applicable)

Surakkha has a fixed severity vocabulary for incident response. If the bug is
about how a reading, alert, or incident is classified, indicate which level
is wrong:

- [ ] Healthy
- [ ] Warning
- [ ] Critical

## Attachments

Paste logs, screenshots, or repro snippets here. If the repro is more than
~50 lines, link to a minimal repo or gist instead.

## Additional context

Anything else that might help — related issues, prior research, suggested
fix, links to commits.

---

### Maintainer checklist

- [ ] Component label assigned (`api`, `web`, `simulator`, `shared`, `db`, `docs`, `infra`)
- [ ] Severity label assigned (`blocker`, `high`, `medium`, `low`)
- [ ] Repro verified on `main`
- [ ] Linked to a story in `_bmad-output/planning-artifacts/epics.md` if applicable
- [ ] Linked to an existing tracking issue if a duplicate
