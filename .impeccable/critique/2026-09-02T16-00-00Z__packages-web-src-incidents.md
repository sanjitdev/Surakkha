---
target: packages/web/src/incidents/
total_score: 20
max_score: 30
na_heuristics: []
p0_count: 0
p1_count: 4
p2_count: 4
p3_count: 2
timestamp: 2026-09-02T16:00:00Z
slug: packages-web-src-incidents
loop: 1
---

## Critique pass — packages/web/src/incidents/

**Method:** Manual critique (impeccable detector is config'd to ignore `packages/api/**`; web/src is detector-scoped but Bash is unavailable in this session — manual only). One-loop pass; score 20/30.
**Target:** all 30 files in `packages/web/src/incidents/`
**Score:** 20 / 30 (67%) — Band: Acceptable, with four P1 issues.

The code is functionally correct and well-tested. The AI-slop signature is concentrated in **header JSDoc volume**, **inline helper sprawl**, and **duplicated mutation-hook skeletons** — all three are characteristic of "AI wrote this, no human re-derived it" surface.

### Critique Score

| #     | Heuristic                                   | Score | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Removes accidental complexity               | 2     | Four transition mutations each ship a near-identical 80-line block (classify + hook + 4xx range check + network-throw synthesis). `useAcknowledgeMutation.ts:226-294`, `useAssignMutation`, `useSubmitResultMutation`, `useReopenMutation` are structurally identical except for the verb-specific copy.                                                                                                                                                                                                                   |
| 2     | Comments say WHY, not WHAT                  | 1     | `useAcknowledgeMutation.ts:25-79` is a 55-line header that re-states what 409/403/404/401 each mean twice — once in prose and once in the classifier. `KanbanBoard.tsx:1-45` (45 lines) and `IncidentDetailPage.tsx:1-41` (41 lines) follow the same pattern. The "Why no extraction" comment is a meta-commentary, not engineering judgment.                                                                                                                                                                              |
| 3     | Exports are intentional, not reflexive      | 2     | `cacheMutators.ts` exports `applyTransitionToCachedRow` once, consumed once. `KanbanBoard.tsx:404` re-exports it "for tests" but the test file imports it directly. `KanbanBoard.tsx:373` re-exports `KanbanRbacDeniedError` for "backward compat" — there's no v1 to be backward-compat with.                                                                                                                                                                                                                             |
| 4     | No ceremonial code                          | 2     | `IncidentDetailPage.tsx:646-653` re-exports `IncidentDetailNotFoundError` + `IncidentDetailRbacDeniedError` "so the test rig can assert against them by import path" — but the test file imports them from their dedicated modules already.                                                                                                                                                                                                                                                                                |
| 5     | Helper sprawl / right-sized helpers         | 2     | `IncidentDetailPage.tsx:113-289` has 7 inline formatting helpers (`formatDateOrDash`, `formatActorOrAnonymous`, `formatAssigneeLabel`, `formatTimelineTimestamp`, `formatAcknowledgeSummary`, `formatAssignSummary`, `formatSubmitResultSummary`, `formatResolveSummary`, `formatReopenSummary`, `formatInvalidTransitionSummary`, `formatTimelineEventSummary`) plus `OUTCOME_LABEL` + `ACTOR_LABEL_BY_VERB` + 4 `MS_PER_*` constants. None are unit-tested. Most belong in `incidents/format/` or `incidents/timeline/`. |
| 6     | Error-path code matches intent              | 3     | The 4xx-classification + row-invalidation rule is correct (F-4.5 / F-5.6 lineage). `HTTP_NETWORK_THROW = 0` sentinel is reasonable. The network-throw synthesis via `new Response(null, { status: 0 })` is a smell — a tagged error would be cleaner.                                                                                                                                                                                                                                                                      |
| 7     | Test names describe behavior, not framework | 3     | Spec files use the codebase's standard `describe`/`it` shape; names are reasonable. No AI-flavored "TEST_HAPPY" prefixes in this surface.                                                                                                                                                                                                                                                                                                                                                                                  |
| 8     | Test setup matches reality                  | 3     | Specs use real TanStack Query + real apiFetch mocks; no jsdom-light shortcuts.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9     | Spec JSDoc proportional to file purpose     | 2     | `transitionEnvelope.spec.ts` and `toast.spec.tsx` are appropriately tight. `IncidentDetailPage.spec.tsx` is large but that's the surface area, not JSDoc volume.                                                                                                                                                                                                                                                                                                                                                           |
| 10    | Resource keys align with production         | 2     | `KanbanBoard.tsx:92-112` hand-rolls a duplicate `IncidentPayloadWireSchema` — the module-level JSDoc admits this MUST stay structurally equivalent to the canonical `IncidentPayloadSchema`. The "re-export for tests" pattern at line 123 is a confession that the test rig needs the wire shape but the import is awkward.                                                                                                                                                                                               |
| Total |                                             | 20/30 | Acceptable; four P1, four P2, two P3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Priority Issues

#### P1 — Four near-identical transition mutation hooks

`useAcknowledgeMutation.ts`, `useAssignMutation.ts`, `useSubmitResultMutation.ts`, `useReopenMutation.ts` each ship:

- `HTTP_UNAUTHORIZED`/`HTTP_FORBIDDEN`/`HTTP_NOT_FOUND`/`HTTP_CONFLICT` constants
- `HTTP_NETWORK_THROW = 0` + `HTTP_4XX_MIN`/`HTTP_4XX_MAX`
- A `classifyXxxError` async function (300 lines total across the four)
- A `mutationFn` with the same network-throw synthesis pattern
- An `onError` that runs the same 4xx range check
- An `onSuccess` that invalidates the same `incidentDetailQueryKey(id)` query

The header JSDoc at `useAcknowledgeMutation.ts:75-79` argues "Why no extraction as a generic hook: 4.5 is the only consumer today; Stories 4.6 (assign), 4.7 (submit-result), 4.11 (reopen) each ship their own one-shot mutation. A future post-Epic-4 sweep can refactor to a `useIncidentMutation({ verb })` factory once the pattern is stable across three stories." — the future is now.

**Fix:** extract a `useIncidentTransitionMutation({ verb, requestUrl, classify, successCopy })` factory. Each verb retains its classifier + Idempotency-Key wiring; the boilerplate (query key, 4xx range check, network-throw synthesis, cache invalidation) lives once.

#### P1 — Inline formatting helpers in `IncidentDetailPage.tsx`

Lines 113-289 (177 lines of inline helpers). None are unit-tested. They are the worst single-file sprawl in this surface.

**Fix:** extract `incidents/format/timeline.ts` (the 7 summary helpers + `OUTCOME_LABEL` + `ACTOR_LABEL_BY_VERB` + `formatTimelineTimestamp`), `incidents/format/actor.ts` (`formatActorOrAnonymous` + `formatAssigneeLabel`), and `incidents/format/date.ts` (`formatDateOrDash` + the ISO/MS constants). Each gets a `.spec.ts`. The page file drops to one import line per concern.

#### P1 — Header JSDoc volume

`IncidentDetailPage.tsx:1-41` (41 lines), `KanbanBoard.tsx:1-45` (45 lines), `useAcknowledgeMutation.ts:25-79` (55 lines), `useDetailActionHandlers.ts:1-22` (22 lines), `cacheMutators.ts:1-17` (17 lines). Total ~180 lines of header prose across 5 files for what amounts to "this is the X component."

**Fix:** collapse each to 3-5 lines of orientation: purpose, key constraint, file dependency. Drop the narrative re-explanations of what 409 means, what the disabled button does, etc.

#### P1 — Duplicated error-state skeletons

`KanbanBoard.tsx:379-396` (KanbanErrorState) and `IncidentDetailPage.tsx:86-103` (IncidentDetailErrorState) are identical except for the testid prefix + copy.

**Fix:** extract `incidents/ErrorState.tsx` — single component, `testIdPrefix` + `message` props. Both pages import it.

#### P2 — Reflexive re-exports

- `KanbanBoard.tsx:404` re-exports `applyStateChangeToCache` from `useKanbanBoardSocket` "so the test rig can assert against the SAME helper the board uses" — but the test file can import directly.
- `KanbanBoard.tsx:373` re-exports `KanbanRbacDeniedError` for "backward compat" — there is no v1.
- `IncidentDetailPage.tsx:646-653` re-exports two error classes "so the test rig can assert against them by import path" — but the test file imports them from their dedicated modules already.
- `KanbanBoard.tsx:123` re-exports `IncidentPayloadWireSchema` "for the test rig" — the test file imports it directly.

**Fix:** delete the four re-exports. Update any imports (probably none — they exist defensively).

#### P2 — Hand-rolled wire schema duplicating the canonical one

`KanbanBoard.tsx:92-112` + 114-123 + JSDoc. The header admits the duplication MUST stay in lock-step. This is the canonical case of "tests require a separate symbol" — which is true (the canonical schema lives in `shared/`, the wire schema can't import it without a cycle). The fix is **moving the wire schema + envelope schema to `incidents/wire.ts`** as a sibling file, then having the Kanban import from there. Single source of truth.

#### P2 — `HTTP_NETWORK_THROW = 0` synthesis via fake Response

`useAcknowledgeMutation.ts:264`: `throw await classifyAcknowledgeError(new Response(null, { status: HTTP_NETWORK_THROW }))`. Synthesizing a fake Response to feed the same classifier is a smell — the classifier should accept either a `Response` or a structured error. Split into `classifyTransitionError(err: { status: number })` that takes the post-throw shape directly. Once the P1 factory lands, this resolves naturally.

#### P2 — `cacheMutators.ts` JSDoc-to-code ratio

30 lines of JSDoc + 10 lines of code (1:3 ratio). The function does one thing: copy a row with a new state if the id matches. Drop the JSDoc to 3 lines: "Pure helper; caller decides whether to drop/keep on RESOLVED."

#### P3 — `formatDateOrDash` swallows invalid dates silently

`IncidentDetailPage.tsx:113-114`. If the wire ever produces a malformed ISO string, the operator sees "—" with no signal. Probably fine (the Zod schema on the wire enforces ISO 8601), but a `Number.isNaN(Date.parse(iso))` guard returning the original string is one extra line and surfaces drift loudly.

#### P3 — `formatTimelineTimestamp` returns `iso` on `NaN` instead of the formatted string

`IncidentDetailPage.tsx:182`. Same drift-signal opportunity as above. Out of scope; defer.

### What's Working

- **TanStack Query cache invariants** — the render-time Tech filter in `KanbanBoard.tsx:235-239` is correct, with a clear comment about why it can't move to query-time.
- **Idempotency-Key wiring** — `useAcknowledgeMutation.ts:239` is the right shape (per-`mutationFn` UUIDv4).
- **Toast lifecycle** — `toast.tsx` is small, focused, and handles unmount cleanup correctly (`useEffect` + `clearTimeout`).
- **Actor-label helper** — the `you` / `anonymous` / "another operator" inference is genuinely better than rendering UUIDs (per the 2026-08-31 critique).
- **Test surface** — specs use real TanStack Query + real apiFetch mocks, no jsdom shortcuts.

### Persona Red Flags

Sanjit (Admin, demo-driver) — unaffected; this is operator-facing.
**Rahim (Operator, primary persona)**: hits `IncidentDetailPage` first. The page is functional but the **header JSDoc does not reflect what the operator sees** — the prose describes "the Operator-facing 4-column severity-mixed Kanban view at `/incidents`" while the file is `IncidentDetailPage.tsx`. Future maintainer confusion: is this the Kanban or the detail page?

### Provocative Questions

1. Should the four transition mutations collapse into a single `useIncidentTransitionMutation({ verb, successCopy, classify4xx })` factory? P1 #1.
2. Should `formatTimelineEventSummary` + its 5 per-verb helpers move into `incidents/format/timeline.ts` with a `.spec.ts` that pins the per-verb message matrix? P1 #2.
3. Should the wire schema + envelope schema for the Kanban live in `incidents/wire.ts` instead of being hand-rolled inline? P2 #2.
4. Should `cacheMutators.ts` be deleted entirely (the export is only used once internally + once defensively)? It probably survives — but the JSDoc volume must collapse.
