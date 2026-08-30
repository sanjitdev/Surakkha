# AI-3.1 — Triage: 5 pre-existing test failures on `alerts/*Router.spec.ts`

**Source:** Epic 3 retrospective AI-3.1 — "triage and fix the 5 pre-existing test failures on `HEAD` (`acknowledgeRouter.spec.ts`, `listRouter.spec.ts`, `alert-debounce.spec.ts` `acknowledgedByUserId` drift)."

**Run:** `pnpm exec vitest run src/alerts/acknowledgeRouter.spec.ts src/alerts/listRouter.spec.ts ../db/prisma/alert-debounce.spec.ts --reporter=verbose` from `packages/api` (cwd) on commit `948812b` (HEAD).

**Result:** 5 fail / 49 pass / 54 total. The `alert-debounce.spec.ts` file (third in the AI-3.1 named target set) is **green** — its `acknowledgedByUserId` column drift was apparently resolved during an Epic 4 sweep. Both remaining failures live in `alerts/acknowledgeRouter.spec.ts` (2) and `alerts/listRouter.spec.ts` (3).

---

## Triage table

| #   | Test                        | File (line)                     | Symptom                                                            | Root cause                                                                                                                                                                                                                                                                                                                                                                               | Classification                                                                                                                                                                                                                                                                          |
| --- | --------------------------- | ------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ACK_VIEWER_DENIED`         | `acknowledgeRouter.spec.ts:286` | `body.required_role === "Admin"`; test expects `"Operator"`        | **`smallestGrantingRole` in `authorize.ts:166-174` returns the most-privileged satisfying role, not the least-privileged.** `ROLE_ORDER` walks most-privileged-first; for `Alert.acknowledge` (Admin+Y, Operator+Y, Tech=N, Viewer=N) it returns `"Admin"`. Test + SPA UX intent both want the _least_-privileged satisfying role (= `"Operator"`).                                      | **Bug, not fixture drift.** Real product bug in `authorize.ts` semantics. One-line fix: reverse `ROLE_ORDER` to least-privileged-first. Comment at `authorize.ts:159-164` is internally contradictory and should be rewritten.                                                          |
| 2   | `ACK_RESPONSE_SCHEMA_DRIFT` | `acknowledgeRouter.spec.ts:812` | `emits.length === 1`; test expects `0`                             | **Order-of-operations bug.** `broadcast.emit("alert:acknowledged", ...)` runs BEFORE `AlertAcknowledgeResponseSchema.safeParse(...)`. The test pins the contract that a schema-drift 500 must NOT fire an emit (otherwise downstream consumers would think the row changed when it didn't).                                                                                              | **Bug.** Move the emit AFTER the `safeParse` check (or inside the success branch of the guard). Three-line fix in `acknowledgeRouter.ts`.                                                                                                                                               |
| 3   | `LIST_PAGINATION_NEXT`      | `listRouter.spec.ts:468`        | `where.OR` undefined after decoding a valid opaque cursor          | **Cursor predicate never propagates.** The `decodeCursor(...)` call at `list.ts:117` parses successfully (the `LIST_PAGINATION_CURSOR_INVALID` test on banana passes), but the resulting `OR: [...]` clause never lands in the `where` passed to Prisma. Test `LIST_PAGINATION_FIRST` (no cursor → no OR) passes, so this is specifically the cursor-applied branch.                     | **Bug.** The list handler builds the `where` for a cursor case but a refactor (probably in 4.x) lost the merge. Likely fix: in `listRouter.ts`/`list.ts`, after decoding the cursor, concatenate the cursor's `OR` clause into the `where` object before passing to Prisma. 5-line fix. |
| 4   | `LIST_VIEWER_OK`            | `listRouter.spec.ts:863`        | `rbac_allowed` audit event missing for Viewer on `GET /api/alerts` | **`authorize()` middleware never emits `rbac_allowed`.** The test pins the contract that every successful authorization writes an allow-audit row (`outcome: "allow"`). The current middleware only emits `rbac_denied` on the failure branch. The success branch calls `next()` directly. Operational dashboards key off `rbac_allowed` so they can count permitted vs denied attempts. | **Missing-feature bug.** Add `audit.emit({ auditAction: "rbac_allowed", ..., outcome: "allow" })` before `next()` in `authorize.ts`. ~5-line fix. Will also fix #5.                                                                                                                     |
| 5   | `LIST_TECHNICIAN_OK`        | `listRouter.spec.ts:887`        | Same as #4 but for Technician                                      | Same root cause as #4.                                                                                                                                                                                                                                                                                                                                                                   | Same fix.                                                                                                                                                                                                                                                                               |

## Cross-cutting notes

- **Two of the five failures (#4 + #5) share one root cause.** Adding the `rbac_allowed` emit fixes both.
- **#1 + the existing `authorize.spec.ts:228,374` tests** should ALL pass after reversing `ROLE_ORDER`. The `:228` test (`read AuditLog`, Operator denied) expects `"Admin"` because only Admin satisfies — reversing the order still returns `"Admin"` (first match). The `:374` test (`requireOwner` denial) expects `"Technician"` because that path hardcodes `"Technician"` at `authorize.ts:268`, not via `smallestGrantingRole`. So no regression risk from the reverse.
- **#3 (cursor OR predicate) is a pure logic bug.** Fix is local; no audit-row / contract change.
- **#2 (emit-before-safeParse) is a contract violation.** The emit must come AFTER the response is verified to match the wire schema, otherwise a drift 500 leaves a phantom `alert:acknowledged` event in the bus that downstream WebSocket consumers process. Real consumer-visible bug if it ever fires.

## Effort estimate

All five fixes combined: ~25 lines of code across 3 files (`authorize.ts`, `acknowledgeRouter.ts`, `list.ts`/`listRouter.ts`). No schema migration, no spec amendment needed, no test rewrites — the existing tests _are_ the spec.

## Recommended shape

Land as a single follow-up story in Epic 5 (or before Story 5.1 begins) titled:

> **5.0 — fix RBAC `required_role` ordering + acknowledge emit-after-safeParse + list cursor OR + rbac_allowed audit emit**

Or split into three stories if the Epic 5 lead prefers smaller ACs:

> **5.0a — Fix `smallestGrantingRole` to return least-privileged satisfying role** (covers #1)
> **5.0b — Move `alert:acknowledged` emit AFTER response-schema safeParse** (covers #2)
> **5.0c — Fix `listRouter` cursor OR predicate + add `rbac_allowed` audit on success** (covers #3, #4, #5)

Either shape closes AI-3.1 and turns CI green on the alert suite. Recommend the second shape for spec granularity; the first is faster.

## What this is NOT

- Not a fixture-drift story. None of the five are caused by a stale fixture; the fixtures in `packages/api/src/test-helpers/` (used by these specs) are correct. The drift classification in the Epic 3 retro was wrong.
- Not a regression from Epic 4 work directly. The `acknowledgeRouter.ts` and `listRouter.ts` were last touched in Epic 3 / early Epic 4; the bugs above are pre-existing in source but only surfaced when the _new tests_ pinned the contracts during Epic 4 review hardening (specifically #2, #4, #5 came in with the review patches; #1 and #3 have been latent since 3.5).
- Not blocked by anything in Epic 4. None of the failures reference `Incident` or `Notification` surfaces — they're all `Alert`-only.

## Verification after fix

- `pnpm exec vitest run src/alerts/acknowledgeRouter.spec.ts src/alerts/listRouter.spec.ts` from `packages/api` — expect 54/54 green.
- `pnpm --filter @surakkha/api test` — expect full suite green (currently the 5 failing tests are the only failures; everything else passes).
- `pnpm --filter @surakkha/api exec vitest run` for `Alert.*` integration tests if they exist — verify no consumer regressions.
- `pnpm -r typecheck` — clean (no signature drift).
- Manual smoke: `curl` GET /api/alerts with each of Operator/Admin/Viewer/Technician tokens; verify the 403 body for Operator→read AuditLog still says `required_role: "Admin"`.

## Defer-to-spec amendments

None. All five bugs are mechanical / one-shot fixes. No spec doc amendments required; the existing test contracts are the canonical spec.
