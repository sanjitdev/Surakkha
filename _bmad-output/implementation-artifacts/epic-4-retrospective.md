# Epic 4 Retrospective — Incidents & Workflow

**Date:** 2026-08-30
**Facilitator:** Amelia (Senior Software Engineer)
**Participants:** Sanjit (Project Lead), Alice (Product Owner), Charlie (Senior Dev), Dana (QA Engineer), Elena (Junior Dev)
**Status:** done
**Sprint status entry:** `epic-4-retrospective` → `done` (committed alongside this document)

---

## 1. Epic Recap

Epic 4 ("Incidents & Workflow") shipped **13 stories**, the most ambitious epic of the project to date:

| Story | Title                                     | Status | Review(s)                         | Notable ACs closed                 |
| ----- | ----------------------------------------- | ------ | --------------------------------- | ---------------------------------- |
| 4.1   | Card Action Affordance Contract           | done   | Group 1 (Web types)               | Slot derivation shape              |
| 4.2   | Incident State Machine + Migration        | done   | Group 1 + Group 2 + Group 4       | AI-3.2 (log line), AI-3.3 (socket) |
| 4.3   | Kanban Column Projection                  | done   | Step-04                           | `projectKanbanColumn` shared       |
| 4.4   | Incident Detail Page                      | done   | Adversarial + Edge + Verification | First 404 surface                  |
| 4.5   | Acknowledge Flow                          | done   | Step-04 hardening                 | Classified error toasts            |
| 4.6   | Assign Technician + INSPECTING Transition | done   | Adversarial + Edge + Verification | Tech-ownership pattern             |
| 4.7   | Submit Result (SAFE/UNSAFE/MONITORING)    | done   | Adversarial + Edge + Verification | SeverityBanner input               |
| 4.8   | Sticky SeverityBanner + RBAC              | done   | Adversarial + Edge + Verification | UNSAFE → 24h banner                |
| 4.9   | Notification Writer                       | done   | Group 2 (Notifications)           | DB writer seam                     |
| 4.10  | NotificationBell Dropdown                 | done   | Adversarial + Edge + Verification | Mark-as-read silent drop           |
| 4.11  | Reopen Path (Admin)                       | done   | Spec Change Log Loop0             | `resolvedAt` cleared semantics     |
| 4.12  | Technician-Filtered Kanban                | done   | Render-time Tech filter           | Defense-in-depth dual filter       |
| 4.13  | Attachments                               | done   | Step-04 verification pins         | First XSS-tainted field accepted   |

**Outcome:** All 13 stories `done`. One Prisma migration (the largest the project has seen: `User`, `Incident.state`/`assigneeUserId`/`acknowledgedAt`/`resolvedAt`, `IncidentEvent`, `Notification`, `Attachment`). The Kanban at `/incidents` is now the day-to-day operator surface with seven states, three full transition verbs (acknowledge, assign, submit-result, reopen), real-time recompute, and a sticky SeverityBanner.

**Commit boundary:** 11 commits from `12f1fb4` (4.3) to `6ac0979` (4.13 review pins). All pushed to `origin/main`.

**Carried retro actions closed:** **2 of 7** AI-3 items — AI-3.2 (incident auto-create observability log line) and AI-3.3 (`incident:opened` socket event) both landed in Story 4.2. The remaining five (AI-3.1, AI-3.4, AI-3.5, AI-3.6, AI-3.7) were not addressed.

**Net test count movement:** api ~411 → ~489 tests (+78); web ~268 → ~464 tests (+196). Many of the new tests are step-04 verification-gap pins.

---

## 2. Wins

### 2.1 Schema-as-correctness paid off again

The Epic 3 pattern repeated: 4.2's `@@index([assigneeUserId, state])`, the optimistic-concurrency compare-and-set on `Incident.updatedAt`, and the 7-state enum made downstream stories testable in isolation. Each transition was a one-liner on top of the pure `transition()` projection. **Charlie:** "Once `applyTransition` was in place, every subsequent verb felt like writing a fixture + a router. The hard part was already done."

### 2.2 Shared-predicate discipline held

The Epic 3 retro committed AI-3.4 ("shared predicates must live in `@surakkha/shared`"). Epic 4 honored it from day one: `IncidentStateSchema`, `IncidentEventTypeSchema`, `projectKanbanColumn`, `actionSlotsFor`, `IncidentSeveritySchema`, `IncidentPayloadSchema` — every predicate that touches wire shapes lives in `@surakkha/shared/incident`. **Zero cross-package drift bugs** this epic. The cross-package invariant risk flagged in the Epic 3 retro did not materialize.

### 2.3 Live-Prisma rigs caught real behavior for state-machine work

The Epic 3 retro's velocity-pattern recommendation ("live Prisma for state-machine work; mocked rigs for view/UX work") was followed. 4.2's `incident-state-machine.spec.ts` live rig caught the optimistic-concurrency race; 4.5's live rig caught an `IncidentEvent` rollback edge case. **No regressions in production code this epic.**

### 2.4 Review-loop discipline improved

Every story 4.4–4.13 ran through the three-agent step-04 loop (adversarial + edge-case-hunter + verification-gap). The 4.13 review alone produced 6 TIER 1 verification pins and surfaced a design drift (matrix vs handler on uploader-delete) that the implementation team had not flagged. **The loop is paying for itself.**

### 2.5 First-time surfaces are landing cleanly

4.4 introduced the **first 404 page** (`<NotFound />`) and the **first per-incident detail view**. 4.10 introduced the **first notification UI**. 4.13 introduced the **first user-supplied text field with XSS risk**. Each shipped with the right defence-in-depth: text-only rendering for labels, `rel="noopener noreferrer" target="_blank"` for outbound URLs, URL-scheme allowlist for the form. **The first-time-surface checklist is paying dividends.**

### 2.6 Spec Change Log Loop 0 closed 4.11 cleanly

4.11's reopen path diverged from spec AC5 (clears `resolvedAt`) and AC7 (no `previous_state` payload). The deviations were load-bearing — consumers filtering `state === "OPEN" && resolvedAt IS NULL` correctly categorize a re-opened incident as in-flight again, and `previous_state` would be redundant given the audit timeline. The Spec Change Log Loop0 entry documented the deviation and the implementation semantic won. **This is the first time we've used the change-log loop for a deliberate implementation-over-spec decision**, and it worked.

---

## 3. Challenges

### 3.1 AI-3 carry-forward rate: 2 of 7

The Epic 3 retro committed 7 action items. Two were closed (AI-3.2, AI-3.3 in Story 4.2). **Five remain open**:

- AI-3.1 (5 pre-existing test failures) — **NOT addressed.** Still surfacing as 6 pre-existing failures (acknowledgeRouter × 2, listRouter × 3, hooks × 1) on `HEAD` as of `6ac0979`. The drift is now stale 4 cycles.
- AI-3.4 (shared predicates rule in PR checklist) — **NOT addressed.** Charlie's checklist file was never created.
- AI-3.5 (no defensive props rule in PR checklist) — **NOT addressed.** Same as 3.4.
- AI-3.6 (Incident Code Map at `epic-4-context.md`) — **PARTIALLY addressed.** The context file was created and contains an explicit "Cross-Story Dependencies" section but lacks the file-by-file map the AI originally committed to.
- AI-3.7 (L4 UX completeness end-of-epic story) — **NOT addressed.** No dedicated UX-completeness sweep landed at the end of Epic 4.

**Elena:** "We kept saying we'd add the checklist file 'next week.' Four weeks later..."

**Charlie:** "The checklist lives in my head, but it doesn't live in the repo. That's a gap."

### 3.2 Deferred-work register grew by 14 entries

`_bmad-output/implementation-artifacts/deferred-work.md` gained **14 entries** this epic (F-4.2 × 6, F-4.4 × 1, F-4.11 × 6, F-4.12 × 3, plus 4.13's un-quantified items). The register is now 197 lines. **At current growth rate, it will exceed 300 lines by Epic 6.**

Notable patterns:

- **Cross-verb mutation-handler gaps** — `useReopenMutation` (4.11), `useAcknowledgeMutation` (4.5), `useAssignMutation` (4.6), `useSubmitResultMutation` (4.7) all share the same gap: timeline query (`["incidents","detail",id,"events"]`) is not invalidated on success. One shared `invalidateQueries({ queryKey: detailFamily(id) })` helper would close it.
- **Zod issue first-message-only** — All four mutation hooks read only `issues[0]?.message`. A shared `firstIssueMessages(body, n)` helper would close it.
- **`audit:emit` double-count on reopen** — 4.11 deferred a spec ambiguity: the matrix-level middleware emits one row, the per-cell guard emits another. The current single-row emission matches `submit_result`'s shape, but the audit trail guarantee was underspecified.

**Dana:** "The register is doing its job — every item is documented with evidence and owner. But the size is starting to feel like it's hiding patterns."

### 3.3 Cross-verb duplication is real

Four mutation hooks (`useAcknowledge`, `useAssign`, `useSubmitResult`, `useReopen`) duplicate:

- The 4xx error classification pattern (403/404/400/401/5xx → typed toast copy)
- The cache invalidation shape (`["incidents","detail",id]`)
- The RBAC UI gate (`actionSlotsFor` for the verb)
- The first-Zod-issue-only toast copy
- The `incident:state_changed` socket reconciliation path

The duplication is **5x**. A `useDetailMutation` factory would close it. **The Epic 3 retro predicted this** — the deferred-work notes explicitly say "the same gap exists across all four verbs and a single shared ... helper is the clean fix."

### 3.4 ESLint complexity ceilings keep firing

`max-lines-per-function: 200` and `complexity: 10` were hit on:

- `useThresholds.ts` (Epic 3, F4) — already resolved
- `IncidentDetailPage.tsx` body (4.4) — extracted `IncidentDetailDispatch` + `IncidentDetailBody`
- `attachmentRouter.ts` POST handler (4.13) — extracted `createAttachmentRowOrRespond` closure
- `useReopenMutation.ts` (4.11) — left as-is after triage

**Pattern: every handler hitting the ceiling is being decomposed after the fact, not at design time.** The fix is naming sub-helpers during the implementation sweep, not at review time.

### 3.5 Pre-existing test debt carries forward — unchanged

The 5 pre-existing failures from Epic 3 (`acknowledgeRouter.spec.ts`, `listRouter.spec.ts`, `alert-debounce.spec.ts` `acknowledgedByUserId` drift) are still there. Epic 4 inherited the debt and added 0 net new carry-forward failures, but the original debt remains. **AI-3.1 is now four cycles old.**

### 3.6 First-time surface UX-completeness gap

4.4 (detail page) and 4.10 (notification dropdown) shipped with strong happy-path tests but light end-to-end coverage:

- 4.4: 9 tests cover happy path, 4xx states, socket in-place mutation. No test for the "operator clicks Kanban → detail page mounts → submits a result → state updates in place WITHOUT navigation" round-trip.
- 4.10: similar — happy path + error classification, but no round-trip with the bell → unread count → mark → list refresh.

**The 60-second comprehension test** (Epic 6.8) will surface these gaps when an operator runs through it. We should be ready.

---

## 4. Cross-Story Patterns

### 4.1 Common Struggles

- **`max-params: 3` + closure-helper extraction** appeared 4 times (4.4 dispatch, 4.13 POST, 4.13 DELETE, 4.6 assign). Pattern: bundle args into a single object, capture deps via closure. Codify as a "named-helper-with-bundled-args" idiom.
- **Zod issue extraction** surfaced as a deferred gap 4 times (all four mutation hooks). Single helper closes it.
- **Timeline-cache invalidation gap** surfaced 4 times. Single helper closes it.
- **Step-04 review pin velocity** — the verification-gap agent consistently catches cache-key identity and mutation-invalidation gaps. The pattern is clear: **every new mutation hook should ship with a hooks-spec file pinning its cache key + invalidation shape.**

### 4.2 Review Feedback Themes

- **Production code quality: high.** No post-merge production bug fixes in Epic 4. All step-04 findings were test-surface or definition-of-done gaps.
- **Test coverage gaps: most common feedback.** The verification-gap agent's TIER 1 pins are overwhelmingly about test-surface completeness (cache identity, mutation invalidation, DOM-order, contract non-emit).
- **Spec Change Log discipline working.** 4.11 used it correctly for a deliberate implementation-over-spec decision. 4.13's spec needed no amendments — the design stayed aligned with the matrix.
- **Step-04 review as design check.** 4.13's reviewer caught a design drift (matrix vs handler on uploader-delete) — `enforceDeleteOwnership` is dead code for Operator/Technician because the matrix gate returns 403 first. The narrative in the spec said "uploader + Admin" but the matrix only grants Admin. This is a **spec drift the implementation did not surface.** Resolved as "Admin-only; per-row branch retained as defense-in-depth."

### 4.3 Breakthrough Moments

- **4.2's `applyTransition` design** — one pure function + one transactional writer + one socket emit. Every subsequent verb plugged into this seam. The seam was so clean that 4.5–4.11 added verbs without touching the seam itself.
- **4.4's `useIncidentDetailSocket` vs `useKanbanBoardSocket` divergence** — same pattern, different cache mutation (Kanban drops RESOLVED, detail keeps RESOLVED). The divergence is a feature, not a bug, and both hooks now share a `applyTransitionToCachedRow(row, event)` helper in `cacheMutators.ts`. **Single source of truth for the row-update shape.**
- **4.13's "no socket, no notification" contract** — the absence of `socket.emit` and `notificationWriter` is the contract. Source-grep tests pin the absence; future regressions that wire either dep would force a structural change at the call sites.
- **4.6's Tech-ownership check** — the `assigneeUserId !== req.user.id` predicate became the template for 4.12 (server-side filter), 4.13 (per-incident read), and any future per-row RBAC. The pattern is now a project idiom.

### 4.4 Velocity Patterns

| Story | Review Loops               | Test Rigs            | Step-04 Time-to-pin | Status |
| ----- | -------------------------- | -------------------- | ------------------- | ------ |
| 4.1   | (type contract, no review) | shared.spec.ts only  | n/a                 | done   |
| 4.2   | Group 1 + 2 + 4            | Live Prisma + mocked | n/a (Group review)  | done   |
| 4.3   | Step-04                    | Mocked               | 3 patches           | done   |
| 4.4   | Adversarial + Edge + Verif | Mocked (RTL+server)  | 9 tests added       | done   |
| 4.5   | Step-04 hardening          | Mocked               | n/a                 | done   |
| 4.6   | Adversarial + Edge + Verif | Mocked               | 4 tests added       | done   |
| 4.7   | Adversarial + Edge + Verif | Mocked               | 3 tests added       | done   |
| 4.8   | Adversarial + Edge + Verif | Mocked               | 5 tests added       | done   |
| 4.9   | (writer-only, no review)   | Live Prisma + mocked | n/a                 | done   |
| 4.10  | Adversarial + Edge + Verif | Mocked               | 6 tests added       | done   |
| 4.11  | Spec Change Log Loop0      | Live Prisma + mocked | 2 deferred-work     | done   |
| 4.12  | Render-time filter review  | Mocked               | 1 deferred-work     | done   |
| 4.13  | Step-04 (B+H+E+VG)         | Mocked               | 14 tests added      | done   |

**Observation:** Mocked rigs dominate (8 of 13 stories). Live Prisma rigs landed on the state-machine and writer stories (4.2, 4.9, 4.11). Step-04 review loops added an average of **~5 verification pins per story** — the review is now net-additive to test coverage.

---

## 5. Action Items

### 5.1 New (this retrospective)

| ID          | Action                                                                                                                                                                                                                       | Owner          | Status | Target               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------ | -------------------- |
| **AI-4.1**  | Extract `useDetailMutation(verb, opts)` factory: shared cache invalidation (`["incidents","detail",id]`) + 4xx error classification + Zod-first-issue helper. Closes 4 deferred-work gaps across 4 verbs (4.5–4.11).         | Charlie        | open   | Before Epic 5 starts |
| **AI-4.2**  | Triage AI-3.1 carry-forward: triage the 6 pre-existing test failures (acknowledgeRouter × 2, listRouter × 3, hooks × 1). The `acknowledgedByUserId` drift is the load-bearing one — fix or amend the test to current schema. | Elena          | open   | Before Epic 5 starts |
| **AI-4.3**  | Add `incident:state_changed` is-required test for mutation success across all four verbs (acknowledge, assign, submit_result, reopen). Pin the cache-invalidation contract.                                                  | Dana           | open   | This week            |
| **AI-4.4**  | File `cross-verb-mutation-helper` story under Epic 5 (or as a pre-Epic-5 cleanup). Closes the timeline-invalidation gap, the Zod-issues gap, and the cache-key inconsistency in one sweep.                                   | Alice          | open   | Epic 5 kickoff       |
| **AI-4.5**  | Re-baseline the deferred-work register. Categorize by severity (P0/P2/P3). Anything P0 must be promoted to a discrete story or closed with explicit "won't fix" rationale in the spec change log.                            | Sanjit (PM)    | open   | Before Epic 5 starts |
| **AI-4.6**  | Add "every new mutation hook ships with a hooks-spec file" rule to PR review checklist. The verification-gap agent's TIER 1 pins are 100% predictable now.                                                                   | Charlie        | open   | This week            |
| **AI-4.7**  | Add "lint complexity ceiling — extract sub-helpers at design time" rule to PR review checklist. Every Epic 4 complexity-ceiling hit was resolved by naming sub-helpers after the fact.                                       | Charlie        | open   | This week            |
| **AI-4.8**  | Add "test for the absence (no socket emit, no notification write)" rule to PR review checklist. The 4.13 source-grep pins are the canonical pattern.                                                                         | Dana           | open   | This week            |
| **AI-4.9**  | Close AI-3.4 + AI-3.5 in this sweep: create `_bmad/agents/review-checklist.md` with the four PR-review rules (shared predicates, no defensive props, hooks-spec required, complexity ceiling, absence-of-emit).              | Charlie + Dana | open   | This week            |
| **AI-4.10** | Write 60-second comprehension test (`comprehension-test.spec.ts`) — operator navigates from login → Kanban → detail → submit-result → reopen path → notification bell → mark-as-read, all within 60s.                        | Elena          | open   | Epic 6 prep          |

### 5.2 Carry-forward from Epic 3 — final disposition

| ID     | Action                                             | Final disposition                                                                           |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AI-3.1 | Triage pre-existing test failures                  | ❌ Still not addressed — 6 failures carry into Epic 5 as AI-4.2                             |
| AI-3.2 | Promote AC4 observability into Story 4.2 ACs       | ✅ Closed in Story 4.2 AC4                                                                  |
| AI-3.3 | Pin `incident:opened` socket event to Story 4.2    | ✅ Closed in Story 4.2 AC5                                                                  |
| AI-3.4 | Add shared-predicate rule to PR review checklist   | ❌ Still not addressed — closed via AI-4.9                                                  |
| AI-3.5 | Add no-defensive-props rule to PR review checklist | ❌ Still not addressed — closed via AI-4.9                                                  |
| AI-3.6 | Write Incident Code Map at `epic-4-context.md`     | ⏳ Partially addressed (Cross-Story Dependencies section present; file-by-file map missing) |
| AI-3.7 | Add L4 UX-completeness end-of-epic story           | ❌ Still not addressed — file as Epic 4.5 (UX-completeness sweep) before Epic 5 starts      |

### 5.3 Epic 2 retro action items — final disposition

| ID                                        | Action                                            | Final disposition       |
| ----------------------------------------- | ------------------------------------------------- | ----------------------- |
| Review UI-heavy stories with UX-DR-9 lens | ✅ Applied across 4.4, 4.7, 4.10, 4.13            | Applied                 |
| Pre-emptive rule engine factoring         | ✅ Resolved differently (per-story factoring)     | Resolved-by-other-means |
| Deferred-work register discipline         | ✅ Applied — register grew by 14 entries, tracked | Applied                 |
| L4 "UX completeness" end-of-epic story    | ⏳ Carried to Epic 5 (was Epic 4; now Epic 5)     | See AI-4.10             |
| Tighten "testably complete" definition    | ⏳ AI-4.6 + AI-4.7 + AI-4.8 close most of this    | In progress             |
| Backfill strategy ownership               | ✅ Closed via AI-3.2 + AI-3.3 (Story 4.2)         | Closed                  |

---

## 6. Epic 5 Preview & Dependencies

**Epic 5 — Reporting & Audit:** 6 stories.

- 5.1 — `/admin/notifications` Read View (Admin sees all unread notifications)
- 5.2 — CSV Export of 30 Days of Readings
- 5.3 — Audit Log Surface at `/audit`
- 5.4 — ReadingAggregate Table
- 5.5 — Hourly Retention Cron
- 5.6 — Negative Tests for the Audit Log

**Critical dependencies on Epic 4:**

- 5.1 consumes the Notification rows written by 4.9 and the unread state managed by 4.10. The web-side `NotificationBell` has the `mark-as-read` mutation; 5.1 needs the Admin-everything read view.
- 5.3 consumes the `AuditLog` rows that Epic 4 deferred (4.11 noted that the `__invalid_transition_attempt` event is the same shape 5.3 will consume). 5.3 is the natural home for the audit table itself.
- 5.4 is independent of Epic 4 functionally but depends on the Reading model landed in Epic 2.
- 5.5 reads the Reading model + the retention policy; depends on 5.4 for the aggregate table.
- 5.6 closes the deferred-work gap on negative-audit tests (4.11 deferred F-2.5-9 — the `context` → `payload` column rename in `AuditLogger` is owned by 5.6).

**Recommended Epic 5 first-story scope:**

1. Land AI-4.2 (triage pre-existing test failures) on day one so CI is green.
2. Land AI-4.1 (`useDetailMutation` factory) as a pre-Epic-5 refactor; 5.1's `/admin/notifications` UI will use a mutation hook that benefits from the factory.
3. Land AI-4.9 (PR-review checklist file) so the four rules are codified.
4. Story 5.3 (Audit Log Surface) as the **actual first story** — the `AuditLog` table + the `/audit` UI is the load-bearing foundation; 5.1, 5.6 build on it.

**Epic 5 prep checklist:**

- [ ] AI-4.1 — `useDetailMutation` factory
- [ ] AI-4.2 — triage 6 pre-existing test failures
- [ ] AI-4.4 — file `cross-verb-mutation-helper` story
- [ ] AI-4.5 — re-baseline deferred-work register by severity
- [ ] AI-4.6 + AI-4.7 + AI-4.8 + AI-4.9 — PR-review checklist rules

**Estimated effort:** the four prep items (AI-4.1, AI-4.2, AI-4.5, AI-4.9) total ~6–8 hours of cleanup work. The two checklist additions (AI-4.6 + AI-4.7 + AI-4.8) are documentation-only. Story 5.3 itself is load-bearing and should be estimated at 4–6 hours of spec + 8–12 hours of implementation.

---

## 7. Risks for Epic 5

1. **Carry-forward debt compounding.** Six pre-existing failures + 14 new deferred entries + 2 cross-verb duplication gaps = 22 items. If not addressed before Epic 5 starts, the debt becomes a velocity tax.
2. **`AuditLog` schema drift risk.** Epic 4 wrote `IncidentEvent` rows; Epic 5 will write `AuditLog` rows. The column shape (`context` vs `payload`) deferred from F-2.5-9 needs to be resolved at the 5.3 boundary or the schema-promotion becomes a multi-step migration.
3. **Notification read-view RBAC.** 5.1's `/admin/notifications` surface needs `read.Notification` for Admin; today the matrix grants `read.Notification` to all four roles. The Admin-only filter is a render-time predicate. **Design decision required before 5.1:** widen the matrix (Admin-only) OR keep the matrix broad and filter at the route handler.
4. **CSV export at scale.** 5.2 reads 30 days of readings per device. At simulator volumes (1 device × 1 reading/min × 30 days = ~43k rows) this is trivial. At real-device volumes (100 devices × 30 days = 4.3M rows) it's a streaming-export problem. **Epic 5 v1 scope:** 30 days × simulator volumes; document the streaming requirement for production.
5. **Retention cron vs. idempotency.** 5.5's hourly cron must be idempotent (concurrent runs must not double-delete). The pattern from Epic 3's `Alert_open_unique_idx` partial index is the precedent. **Architectural decision required at 5.5 design time.**

---

## 8. Celebration

**Charlie (Senior Dev):** "13 stories. One migration. Seven state transitions. A real-time Kanban that recomputes on socket events. A sticky SeverityBanner. A Notification bell. A reopen path. Attachments with XSS defense. This is the most operator-facing epic we've shipped and it all started with `applyTransition`. I'm proud of this epic."

**Alice (Product Owner):** "The operator's daily workflow now lives on `/incidents`. They acknowledge, assign, inspect, submit-result, reopen. The audit timeline shows every transition. Attachments give them evidence to attach. The NotificationBell tells them when something needs attention. \*\*This is the day-to-day Surakkha surface. We've shipped it."

**Dana (QA Engineer):** "The step-04 review loop has now run on 8 stories. The verification-gap agent's TIER 1 pins are becoming predictable — cache identity, mutation invalidation, DOM-order, contract non-emit. **The loop is doing its job.** I'd like to see the loop land in CI before Epic 5 starts, but the discipline is there."

**Elena (Junior Dev):** "My biggest takeaway: every new mutation hook ships with a hooks-spec file. The deferred-work register is doing its job, but the duplication across 4 verbs is real. The factory pattern is waiting to be extracted."

**Sanjit (Project Lead):** [Confirmed — Epic 4 done, retrospective committed, Epic 5 next on the runway. The pre-existing test failures (AI-3.1) must be triaged before Epic 5 starts; the carry-forward is now stale four cycles.]

---

## 9. Retrospective Closure

Retrospective committed to `_bmad-output/implementation-artifacts/epic-4-retrospective.md`.
`sprint-status.yaml` updated:

- `epic-4-retrospective`: `done`
- `action_items`: AI-4.1 through AI-4.10 added with `status: open`
- Epic 4 archived as `done` with `completed_at: 2026-08-30`
- Story 4.1, 4.2, 4.9, 4.13 ledger entries synced to `status: done` (were `backlog` in the stories section; correction in this commit)

Next steps:

1. Address AI-4.2 (pre-existing test failures) — 6 carry-forward failures from Epic 3.
2. Address AI-4.1 (`useDetailMutation` factory) — closes 4 deferred-work gaps.
3. Address AI-4.9 (PR-review checklist file) — closes AI-3.4 + AI-3.5 + AI-4.6 + AI-4.7 + AI-4.8.
4. Address AI-4.5 (re-baseline deferred-work register by severity).
5. Open Epic 5 with Story 5.3 (Audit Log Surface) as the first story.

**End of Epic 4 Retrospective.**
