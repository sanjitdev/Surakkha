# Epic 3 Retrospective — Rules & Alerts

**Date:** 2026-08-27
**Facilitator:** Amelia (Senior Software Engineer)
**Participants:** Sanjit (Project Lead), John (PM) standing in as Product Owner proxy, Charlie (Senior Dev), Dana (QA Engineer) standing in as Murat (Test Architect), Elena (Junior Dev)
**Status:** done
**Sprint status entry:** `epic-3-retrospective` → `done` (committed alongside this document)

---

## 1. Epic Recap

Epic 3 ("Rules & Alerts") shipped 7 stories:

- **3.1** — Rule model + enum tuples (`RuleMetric`, `RuleOperator`)
- **3.2** — Alert + AlertEvent models, FK to Device
- **3.3** — AlertStateRepository abstraction for alert write path
- **3.4** — Debouncing: `RuleDebounceState`, partial unique index, `findOpenAlert` seam
- **3.5** — Alert lifecycle: `POST /api/alerts/:id/acknowledge`, `GET /api/alerts`, compare-and-set
- **3.6** — Auto-create `Incident` from warning/critical `Alert`
- **3.7** — `/admin/thresholds` admin tab: list / create / supersede / activate Rule

**Outcome:** All 7 stories `done`. Zero schema migrations across the epic (every change was application-layer). Production surface area: a new admin tab, a new POST endpoint for acknowledgement, a new GET endpoint for alerts list, and silent behavior where warning/critical alerts now create `Incident` rows in the same transaction as the alert.

**Commit boundary:** Five commits — `1b65d35` (3.5), and the four-commit sequence for the rest. All pushed to `origin/main`.

---

## 2. Wins

### 2.1 Schema-as-correctness paid off

The `@@unique([deviceId, metric, operator, threshold, version])` (3.1 / 3.7), the partial-unique-index `Alert_open_unique_idx WHERE clearedAt IS NULL` (3.4), and the `updateMany({ where: { id, acknowledgedAt: null } })` compare-and-set (3.5) all replaced what could have been distributed-lock dances with single declarative constraints. Each one was a schema design decision made _before_ Epic 3 began, and each one earned its keep this epic.

### 2.2 Single-source-of-truth on critical predicates

Story 3.6's `shouldCreateIncident` predicate was originally defined separately in `packages/api/src/rules/incidentFromAlert.ts` and re-mirrored in `packages/db/prisma/alert-debounce.spec.ts`. The cross-package drift risk was real: if production had `severity === 'warning' || severity === 'critical'` and the test rig had a slightly different wording, the test would have passed while production wrote the wrong rows. Hoisting it to `@surakkha/shared/incident.ts` (alongside the existing `IncidentSeveritySchema` Zod enum) made that class of bug syntactically impossible.

### 2.3 Zero migrations = zero rollback risk

Every Epic 3 change was application-layer. The Prisma schema is byte-identical pre- and post-epic. The atomic-write semantics from 3.6 (alert + incident in same `$transaction`) are forward-only by construction.

### 2.4 Live Prisma test rigs caught real behavior

Stories 3.4 and 3.6 used live Prisma rigs (in `packages/db/prisma/alert-debounce.spec.ts` and a sibling live test) rather than in-memory mocks. This was the right call — in-memory mocks would have masked the partial-unique-index behavior and the `$transaction` rollback semantics.

### 2.5 Review loop quality improved over the epic

Story 3.4 had 1 review loop. 3.5 had 4 loops. 3.6 + 3.7 had a code-review sweep that caught 7 findings (F1, F2+F5, F3+F7, F4, F10, F12, F15). The early loops found design-level issues; later loops found definition-of-done and test-surface gaps. Net velocity _per concern type_ was higher in the later loops.

---

## 3. Challenges

### 3.1 Definition-of-done gap

Of the 7 review findings on 3.6 / 3.7, **5 were definitionally preventable**:

- **F10** — `shouldCreateIncident` was duplicated across packages (should have been in `@surakkha/shared` from the start)
- **F12** — PATCH endpoint lacked an end-to-end test asserting the superseded row's `isActive` flipped
- **F15** — Create endpoint lacked an unknown-field rejection test (`.strict()` boundary)
- **F4** — `parseApiError` exceeded ESLint complexity ceiling (sign of under-decomposition)
- **Plus one related finding on the unused `pushToast` prop on `ThresholdsPopulatedView`** — defensive-prop smell

These weren't bugs in production logic. They were gaps in the "is this testably complete?" definition.

### 3.2 Story 3.5 pre-existing test debt carries forward

Five test failures exist on `HEAD` `4e91bf8` _before_ Epic 3 began:

- `packages/api/src/alerts/acknowledgeRouter.spec.ts` — failures TBD on triage
- `packages/api/src/alerts/listRouter.spec.ts` — failures TBD on triage
- `packages/db/prisma/alert-debounce.spec.ts` — `acknowledgedByUserId` column drift (suggests a migration was applied without updating the test fixture)

These were confirmed via `git stash` to pre-date Epic 3 work. They are not part of the Epic 3 commit boundary, but they will inherit into Epic 4 if not triaged.

### 3.3 Defensive-prop smell

The 3.7 PR added `pushToast={pushToast}` as a prop to `ThresholdsPopulatedView` because the form _might_ need to surface a toast on save. The child never read the prop because the form is local state. ESLint `--max-warnings 0` should have caught the unused prop at review time; it was caught at PR review instead. Pattern: a "prop is read by the child" check at PR review time.

### 3.4 Deferred-work register grew by 5 entries

`_bmad-output/implementation-artifacts/deferred-work.md` gained 5 entries this epic:

1. **F8 / F9** — AC4 (no log line on incident auto-create) and AC5 (no `incident:opened` socket event) — Epic 4 owns both
2. **F13** — `Rule.version` tiebreak ordering is implicit; should be promoted to a `RuleOrderBy` field (now done as part of F2+F5 fix)
3. **F19** — No `audit_log` writes for Rule edits — Epic 5 owns the table
4. **F20** — Unused `pushToast` prop (now done)

The growth is healthy — every entry was tracked, every entry has an owner story. But the _size_ of the register is now meaningful and warrants periodic review.

### 3.5 L4 "UX completeness" end-of-epic story didn't ship (carry-forward from Epic 2)

The Epic 2 retro committed to a pattern where each epic closes with a story that pins "does the user have what they need?" For Epic 3, this story was registered as a deferred action but not shipped as a discrete story. Carry forward to Epic 4.

---

## 4. Cross-Story Patterns

### 4.1 Common Struggles

- **Cross-package invariant gaps** appeared in 3.6 (F10) and 3.7 (F15). Both were resolved by promoting shared logic to `@surakkha/shared`. The pattern is worth codifying.
- **Lint complexity ceilings** were hit on `useThresholds.ts` (F4) and `incidentFromAlert.ts`. Both indicate that helper-extraction discipline could be applied earlier — i.e., at PR review time, look for any function over ~50 lines and consider naming sub-helpers.
- **Stripe of test gaps on boundary cases** (`.strict()` rejection, FK cascade coverage, version-tiebreak ordering) — these share a root cause: the test plan treated happy paths + a few error paths as sufficient, instead of enumerating every schema constraint.

### 4.2 Review Feedback Themes

- **Production code quality: high.** No production-code bug fixes were needed post-merge on any story.
- **Test coverage gaps: most common feedback.** 5 of 7 findings (F1, F2+F5, F4, F12, F15) were about hardening the test surface.
- **Type-narrowing surprises** (F2+F5's `RuleOrderBy` missing `version`/`id` keys) surfaced twice. Indicates a gap in interface-design discipline: when a backend supports N sort fields, the type should accept N sort fields, not a curated subset.

### 4.3 Breakthrough Moments

- **3.6's `shouldCreateIncident` hoist to `@surakkha/shared`** — the moment this was recognized as a pattern, it became a standing rule for the rest of the project.
- **3.7's edit-via-new-version pattern** — once we accepted that creating version N+1 is the edit operation, the entire PATCH endpoint fell out as a one-liner. Pre-stated schema constraints paid off.
- **3.5's batched `linked_alerts` lookup** — `findMany({ OR: [...] })` instead of N+1 queries. Caught at PR review, applied cleanly.

---

## 5. Velocity Patterns

| Story | Review Loops                               | Test Rigs                              | Status |
| ----- | ------------------------------------------ | -------------------------------------- | ------ |
| 3.4   | 1 + (F1, F2+F5, F3+F7 patches)             | Live Prisma (`alert-debounce.spec.ts`) | done   |
| 3.5   | 4                                          | Mocked (Vitest)                        | done   |
| 3.6   | Code-review sweep (F10, F12)               | Live Prisma (sibling live test)        | done   |
| 3.7   | Code-review sweep (F4, F13, F15, F19, F20) | Mocked (RTL+server)                    | done   |

**Observation:** Live Prisma rigs (3.4, 3.6) required more upfront setup but caught real behavior. Mocked rigs (3.5, 3.7) were faster to write but accumulated deferred-work entries. Recommend Epic 4 choose **live Prisma for state-machine work** (4.2, 4.5) and **mocked rigs for view/UX work** (4.3, 4.4).

---

## 6. Action Items

### 6.1 New (this retrospective)

| ID         | Action                                                                                                                                                                                                               | Owner              | Status      | Target               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------- | -------------------- |
| **AI-3.1** | File `3.5-test-fixture-drift` story: triage and fix the 5 pre-existing test failures on `HEAD` (`acknowledgeRouter.spec.ts`, `listRouter.spec.ts`, `alert-debounce.spec.ts` `acknowledgedByUserId` drift).           | Backlog, owner TBD | not-started | Before Epic 4 starts |
| **AI-3.2** | Promote AC4 (observability log line on incident auto-create) into Story 4.2 acceptance criteria.                                                                                                                     | Story 4.2 owner    | not-started | Epic 4 Story 4.2     |
| **AI-3.3** | Pin `incident:opened` socket event emission to Story 4.2 explicitly (update `deferred-work.md` to point at 4.2 by ID).                                                                                               | Story 4.2 owner    | not-started | Epic 4 Story 4.2     |
| **AI-3.4** | Add "shared predicates must live in `@surakkha/shared`" to PR review checklist.                                                                                                                                      | Charlie            | not-started | This week            |
| **AI-3.5** | Add "no defensive props — must be read by the child" to PR review checklist.                                                                                                                                         | Charlie            | not-started | This week            |
| **AI-3.6** | Write Code Map for `Incident` state work, drop into `_bmad-output/planning-artifacts/epic-4-context.md`. Point at `applyTransition.ts`, `alertStateRepository.ts`, the new `incidentState` slice, `recentRouter.ts`. | Elena              | not-started | Epic 4 kickoff       |
| **AI-3.7** | Add "L4 UX completeness end-of-epic story" to Epic 4 plan as the closing story.                                                                                                                                      | Alice              | not-started | Epic 4 plan          |

### 6.2 Carry-forward from Epic 2

| ID     | Action                                         | Status                                                                                                       |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| AI-2.x | L4 "UX completeness" end-of-epic story pattern | ⏳ Carried forward again — see AI-3.7                                                                        |
| AI-2.x | Pre-emptive rule engine factoring              | ⏳ Different approach taken in Epic 3 (per-story factoring, not preemptive); flag as resolved-by-other-means |

### 6.3 Epic 2 retro action items — final disposition

| ID                                        | Action                                                                    | Final disposition |
| ----------------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| Review UI-heavy stories with UX-DR-9 lens | ✅ Applied — 3.5 + 3.7 reviewed for UX completeness                       |
| Pre-emptive rule engine factoring         | ⏳ Resolved by different approach (per-story factoring)                   |
| Deferred-work register discipline         | ✅ Applied — register grew by 5 entries, all cross-referenced             |
| L4 "UX completeness" end-of-epic story    | ⏳ Carried to Epic 4 (AI-3.7)                                             |
| Tighten "testably complete" definition    | ❌ Surfaced as AI-3.4 + AI-3.5 — incomplete at retro time                 |
| Backfill strategy ownership               | ❌ Surfaced as deferred-work F8/F9 — promoter to Epic 4 (AI-3.2 + AI-3.3) |

---

## 7. Epic 4 Preview & Dependencies

**Epic 4 — Incidents & Workflow:** 13 stories. Story 4.1 (Card Affordance), 4.2 (State Machine — load-bearing), 4.3 (Kanban Projection), 4.4 (Detail Page), 4.5 (Acknowledge endpoint — supersedes 3.5's alert-level acknowledge with incident-level), 4.6 (Assign Technician), 4.7 (Submit Result). Rest in backlog.

**Critical dependencies:**

- **Story 4.2 consumes rows created by 3.6.** When 4.2 introduces `state`, incidents generated by 3.6's auto-create need a backfill. This is AI-3.2.
- **Story 4.5 supersedes 3.5's `POST /api/alerts/:id/acknowledge`.** A migration plan is needed: deprecate the alert-level endpoint, route acknowledgement through the incident-level endpoint, and ensure the `compare-and-set` semantic is preserved at the new endpoint.
- **Deferred-work F8 + F9 become Epic 4 work**, not stay-deferred.

**Recommended Epic 4 first-story scope:**

- Land `3.5-test-fixture-drift` (AI-3.1) on day one so CI is green before any Epic 4 PR.
- Land Story 4.2 (state machine) as the _actual_ first story, since downstream stories (4.3, 4.4, 4.5) all consume the `state` column.
- AI-3.6 (Code Map) goes into the Epic 4 kickoff doc, not a separate workstream.

---

## 8. Risks for Epic 4

1. **DB drift risk** — `acknowledgedByUserId` column drift in 3.5's test rig means Epic 4's `Incident.acknowledgedAt` + `assignedTo` fixtures are at high risk of the same drift. Pin CI to `prisma format` + `prisma validate` on every PR.
2. **Cross-package invariant risk** — `shouldCreateIncident` was the _first_ time we hoisted a predicate into `@surakkha/shared`. Epic 4 will need at least one more (`shouldReopenIncident`) for the reopened-state logic in Story 4.2. Apply AI-3.4 from day one.
3. **UX-acceptance gap** — Epic 4 is the _most_ UX-heavy epic of the project so far. The Epic 2 / Epic 3 retro pattern of "RTL tests + happy path" is insufficient. Plan at least one manual end-to-end pass before Epic 4 closes.
4. **Endpoint deprecation risk** — moving the acknowledgement endpoint from alert-level (3.5) to incident-level (4.5) without a deprecation window will create stale-client churn. Plan for both endpoints to live for at least one release.

---

## 9. Celebration

**Charlie (Senior Dev):** "I want to call out that we landed 7 stories in one epic, no schema changes, with a partial-unique-index race catch and a compare-and-set acknowledge endpoint. From a pure-craft perspective, that's a great epic. The deferred-work is real but it's well-tracked."

**Alice (Product Owner):** "The admin tab is the first user-facing Epic 3 surface. Operators can now define rules, edit them via version history, and reactivate old versions. That's real operator value shipping today."

**Dana (QA Engineer):** "The live Prisma rigs caught behavior that no review would've caught. Credit where it's due."

**Elena (Junior Dev):** "My takeaway: hoist shared predicates early, write the test plan against the schema constraints, and don't add a prop you don't read."

**Sanjit (Project Lead):** [Confirmed — Epic 3 done, retrospective committed, Epic 4 next on the runway.]

---

## 10. Retrospective Closure

Retrospective committed to `_bmad-output/implementation-artifacts/epic-3-retrospective.md`.
`sprint-status.yaml` updated:

- `epic-3-retrospective`: `done`
- `action_items`: AI-3.1 through AI-3.7 added with `status: not-started`
- Epic 3 archived as `done` with `completed_at: 2026-08-27`

Next steps: file AI-3.1 (`3.5-test-fixture-drift`) into sprint-status backlog; open Epic 4 with Story 4.2 (state machine) as the first story.

**End of Epic 3 Retrospective.**
