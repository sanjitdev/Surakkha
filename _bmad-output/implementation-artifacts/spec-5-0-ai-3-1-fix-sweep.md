# Story 5.0 — AI-3.1 Fix Sweep (5 pre-existing alert-router test failures)

## Intent

Close AI-3.1 / AI-4.2 by repairing the 5 pre-existing test failures surfaced
in the Epic 3 retrospective, surfaced again in the Epic 4 retro. The failures
were triaged in
`_bmad-output/implementation-artifacts/triage-ai-3-1-test-fixture-drift.md`.
The retro labelled them "fixture drift" but every one of the 5 was a real
production bug — the fixtures were _correct_; the production code under test
was wrong.

The sweep is one story because all 5 fixes share the same shape:
_surface a hidden contract assumption that a test had pinned silently for
months._ Together they tighten the audit log, the ack emit ordering, the
list pagination cursor handling, and the SPA-facing 403 `required_role`
copy.

## Boundaries & Constraints

- No new endpoints, no new RBAC cells, no new schema migrations.
- No production-code changes outside the 5 named fixes. Every change is the
  smallest patch that flips a red test green.
- The pre-existing `src/rules/__tests__/hooks.spec.ts` RISING_EDGE_DELAY
  failure is OUT OF SCOPE — it pre-dates this story on clean main
  (`git stash` round-trip confirmed it fails on `HEAD` without any of
  these changes).
- The audit enum expansion (`"rbac_allowed"`) is a 1-line addition to
  `AuditActionSchema` in `@surakkha/shared/rbac`. The package MUST be
  rebuilt (`pnpm --filter @surakkha/shared build`) before api typecheck
  passes — this is the second time this dependency shape has bitten
  the build, see AI-3.5 follow-up.

## I/O & Edge-Case Matrix

| #   | File                                                | Failure                                                                                                                                                                                                            | Fix                                                                                                                                                                           | Audit-row shape               |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | `middleware/authorize.ts:173`                       | `smallestGrantingRole` returned `Admin` for every multi-grantor cell (e.g. `Alert.acknowledge`), contradicting the SPA's "you need at least Operator" copy.                                                        | Reverse `ROLE_ORDER` from `[Admin, Operator, Technician, Viewer]` to `[Viewer, Technician, Operator, Admin]` (least-privileged-first). Rewrite the contradictory doc comment. | n/a                           |
| 2   | `alerts/acknowledgeRouter.ts:409`                   | `alert:acknowledged` emit fired BEFORE the response-schema safeParse check. A schema-drift 500 would emit a phantom event whose wire response says "we did not change the row".                                    | Move the emit block AFTER the safeParse gate. Pinned by `ACK_RESPONSE_SCHEMA_DRIFT` (acknowledgeRouter.spec.ts:812).                                                          | n/a                           |
| 3   | `alerts/listRouter.spec.ts:164`                     | Test stub branched on `where.OR !== undefined` to distinguish page vs predecessor query. The cursor-paginated page query ALSO sets `where.OR`, so cursor-paginated calls were mis-classified as predecessor calls. | Stub now branches on the `select` shape: predecessor query lacks `ruleId`; page query selects `ruleId` + `acknowledgedAt` + `acknowledgedByUserId`.                           | n/a                           |
| 4   | `middleware/authorize.ts:228`                       | `authorize()` only emitted on the deny branch. Operational dashboards could not count permitted-vs-denied attempts.                                                                                                | Add `audit.emit({auditAction: "rbac_allowed", outcome: "allow", ...})` BEFORE `next()` on the success branch.                                                                 | `{subject, action, resource}` |
| 5   | Same fix as #4 — the two audit-row gaps are paired. | n/a                                                                                                                                                                                                                | n/a                                                                                                                                                                           | n/a                           |

## Code Map

- `packages/api/src/middleware/authorize.ts` — Fix #1 (lines 160-173), Fix #4 (lines 229-238), JSDoc updates.
- `packages/api/src/middleware/authorize.spec.ts` — 3 test updates: widen the local `AuditEvent.outcome` type, replace 3 `expect(events).toEqual([])` patterns with `expect.objectContaining` against the new `rbac_allowed` row.
- `packages/api/src/audit.ts` — widen `outcome` from `"success" \| "failure"` to `"success" \| "failure" \| "allow"`; add JSDoc explaining the three-state semantic.
- `packages/api/src/alerts/acknowledgeRouter.ts` — Fix #2 (lines 409-432): move the emit block from BEFORE the safeParse gate to AFTER; update the contract comment.
- `packages/api/src/alerts/listRouter.spec.ts` — Fix #3 (lines 161-189): branch the test stub on `select` shape (not `where.OR`).
- `packages/api/__tests__/rbac.negative.spec.ts` — 2 test updates: replace 2 `expect(events).toEqual([])` patterns (one in the parametric loop, one in the standalone ownership case) with `expect.objectContaining` against `rbac_allowed`.
- `packages/shared/src/rbac.ts` — add `"rbac_allowed"` to `AuditActionSchema` with a 4-line comment explaining the allow/deny pairing.

## Tasks & Acceptance

1. Reverse `ROLE_ORDER` to least-privileged-first. AC: `Alert.acknowledge` denial against an Operator returns `required_role: "Operator"`, not `"Admin"`.
2. Move ack emit after safeParse. AC: `ACK_RESPONSE_SCHEMA_DRIFT` test (acknowledgeRouter.spec.ts:812) goes green.
3. Fix list cursor `OR` predicate propagation. AC: the LIST_PAGINATION_NEXT pin (listRouter.spec.ts) goes green.
4. Emit `rbac_allowed` on authorize success. AC: every successful authorization in `authorize.spec.ts` produces exactly one audit row with `auditAction: "rbac_allowed"`, `outcome: "allow"`.
5. Add `"rbac_allowed"` to `AuditActionSchema` + widen `outcome` type. AC: shared package rebuilds; api typecheck is clean; web typecheck is clean.

## Design Notes

### Why three-state `outcome`

The original `"success" | "failure"` was a binary. Adding `"allow"` is the
smallest change that distinguishes a _state-change success_
(`alert_acknowledged`, `incident_state_changed`) from a _permit log_
(`rbac_allowed`). Dashboards key off the permit log; ad-hoc readers
key off the state-change success. Conflating them would force every
reader to know which `auditAction` values are state-changes vs
permits, which is a reader-side coupling this fix sidesteps.

### Why emit BEFORE `next()`

The allow-row must precede any downstream middleware that might mutate
the audit log (e.g. a future handler that calls `audit.emit` itself
for its own action). Synchronous emission is the simplest ordering
guarantee; an async emit would force every handler to be audit-aware,
which couples it to the auth gate.

### Why stub the page query on `select`, not `where.OR`

The previous branch was a tacit assertion "only the predecessor query
sets `where.OR`" — a false invariant. The page query sets
`where.OR` whenever a cursor is present (the LIST_PAGINATION_NEXT
pin). The new branch keys on the structural difference in the
`select` projection, which is stable across cursor and non-cursor
page queries and across predecessor queries.

## Verification

- `pnpm --filter @surakkha/api test` — green; 494/495 tests pass (the 1
  failure is the pre-existing `RISING_EDGE_DELAY` test, unrelated to
  AI-3.1; verified via `git stash` round-trip).
- `pnpm --filter @surakkha/web test` — green; 464/464 tests pass.
- `pnpm -r typecheck` — clean across all 5 packages.
- `pnpm --filter @surakkha/shared build` — succeeds after the
  `AuditActionSchema` enum expansion.

## Risks

1. **Any future audit row that wants `outcome: "allow"` must add a
   matching enum value.** Mitigation: the type lives in
   `@surakkha/shared/rbac` so any drift is a typecheck failure, not a
   runtime one.
2. **The `select`-shape stub branch is brittle if a future
   `AlertSummary` change removes `ruleId` from the page projection.**
   Mitigation: the page-vs-predecessor selection difference is
   documented in a comment block at listRouter.spec.ts:165-175;
   refactor candidates will see the comment.
3. **The `rbac_allowed` emit is on the synchronous hot path of every
   authorized request.** Mitigation: the audit sink is a no-op stub
   in tests; in production it is a single structured log write. No
   measurable latency added.

## Out of scope

- The pre-existing `RISING_EDGE_DELAY` failure in
  `src/rules/__tests__/hooks.spec.ts` (Story 3.4 de-bouncing test).
- Follow-up actions from AI-3.4 (shared-predicate PR checklist rule)
  and AI-3.5 (no-defensive-props PR checklist rule) — both are
  process changes that land separately.

## Spec Change Log

- Loop 0 (2026-08-30): initial spec lands alongside the fix sweep.
  Closes AI-3.1 + AI-4.2.
