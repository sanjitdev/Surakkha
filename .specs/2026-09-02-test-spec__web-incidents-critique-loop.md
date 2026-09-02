---
title: "Test Spec — packages/web/src/incidents critique-loop consolidation"
type: "refactor"
created: "2026-09-02"
status: "ready-for-review"
review_loop_iteration: 0
context:
  - "{project-root}/.impeccable/critique/2026-09-02T16-00-00Z__packages-web-src-incidents.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The four transition mutation hooks in `packages/web/src/incidents/` were near-identical 250–317-line copies (each shipping its own `classify*Error` + tagged `*MutationError` + JSDoc header), and `IncidentDetailPage.tsx` carried 177 lines of inline format helpers + a duplicated error-state skeleton + a narrative JSDoc volume of ~180 lines across the surface. Critique artifact `.impeccable/critique/2026-09-02T16-00-00Z__packages-web-src-incidents.md` scored 20/30 with 4 P1 + 4 P2 findings.

**Approach:** Collapse the four hooks onto a single factory (`useIncidentTransitionMutation`) that owns `TransitionMutationError`, `apiFetch`, the `Idempotency-Key` header, the 4xx/5xx classifier, and the per-verb `Retry`/cache-invalidation contract. Extract pure format helpers to `format.ts`. Extract the wire schemas to `wire.ts`. Replace the two error-state skeletons with a single shared `<ErrorState testIdPrefix={...} />`. Trim JSDoc across the surface to file-level intent only.

## Boundaries & Constraints

**Always:**

- The four verb wrappers (`useAcknowledgeMutation` / `useAssignMutation` / `useSubmitResultMutation` / `useReopenMutation`) MUST each remain ≤ 25 lines; no logic — only `TransitionMutationConfig` shape.
- All four verbs MUST continue to attach `Idempotency-Key: <UUIDv4>` on every POST (api-side dedupe is a no-op without it).
- The 409 body MUST be discriminated through `parseTransitionEnvelope` + `invalidTransitionMessage(verb, envelope)` — never via hardcoded copy that ignores `from` / `attempted`.
- 401 must NOT trigger a detail-row cache invalidation (token-refresh exhausted; re-fetch would 401 again).
- The `useRef<string | null>` per-click idempotency-key capture (if present) MUST survive React StrictMode double-render.
- The 5 `verb`/`route`/`retryCopy`/`conflictFallback`/`validationFallback`/`buildBody` config fields are the ONLY surface area for per-verb variation; no per-verb mutation function.

**Ask First:**

- Adding a 5th verb (`useResolveMutation`) — currently no consumer; defer until needed.
- Renaming `TransitionMutationError.status` → branded type alias for status code.
- Adding a `useResolveMutation` even if no consumer (YAGNI; out of scope).

**Never:**

- Inline the factory body into the four verb files (the consolidation is the point).
- Add per-verb `classifyXxxError` helpers — one classifier, one error class.
- Mutate the shared `applyStateChangeToCache` envelope (it is shared with the Kanban banner; mutation is fine because the cache is per-key, but adding fields is not).
- Import zod runtime into `IncidentDetailActions.tsx` (the schema-coupling comment at `IncidentDetailActions.tsx:411-424` is the explicit reason).
- Re-add the inline `IncidentDetailErrorState` / `KanbanErrorState` skeletons; `<ErrorState />` is the canonical surface.

## I/O & Edge-Case Matrix

| Scenario                          | Input / State                                                                                            | Expected Output / Behavior                                                                                                                          | Error Handling                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| HAPPY_MUTATION                    | `useAcknowledgeMutation` POST returns 200                                                                | `onSuccess` invalidates `incidentDetailQueryKey(id)`; page toast: `"Acknowledged"`                                                                  | N/A                                                           |
| HAPPY_IDEMPOTENCY_HEADER          | any transition POST                                                                                      | request carries `Idempotency-Key: <RFC4122 v4>` header generated per click                                                                          | N/A                                                           |
| HAPPY_409_TYPED_MISS              | server returns `{ error: "invalid_state_transition", from: "SAFE", attempted: "acknowledge" }`           | toast: `"Cannot acknowledge a safe incident"`; `incidentDetailQueryKey` invalidated                                                                 | n/a                                                           |
| HAPPY_409_CONCURRENCY             | server returns `{ error: "invalid_state_transition", reason: "concurrent_modification" }`                | toast: `"Modified by another operator — refresh and retry"` for ALL 5 verbs; cache invalidated                                                      | n/a                                                           |
| HAPPY_409_FALLBACK                | server returns 409 with `{ error: "invalid_state_transition" }` (no `from`/`attempted`/`reason`)         | toast: per-verb fallback copy (`"Already acknowledged"`, `"Already assigned"`, `"Already submitted"`, `"Cannot reopen — incident is not RESOLVED"`) | n/a                                                           |
| ERROR_400_REOPEN                  | `useReopenMutation` POST returns 400 with Zod issues                                                     | toast: first Zod issue message if present, else `"Reason invalid — please review and resubmit"`                                                     | Zod issue extracted via `firstIssueMessage(body)`             |
| ERROR_400_OTHER                   | non-reopen verb POST returns 400                                                                         | toast: `"Invalid request"`                                                                                                                          | no Zod body inspection                                        |
| ERROR_403                         | server returns 403                                                                                       | toast: `"Not authorized"`; cache invalidated (4xx)                                                                                                  | n/a                                                           |
| ERROR_404                         | server returns 404                                                                                       | toast: `"Incident not found"`; cache invalidated (4xx)                                                                                              | n/a                                                           |
| ERROR_401                         | server returns 401                                                                                       | toast: `"Session expired — please sign in again"`; cache NOT invalidated (re-fetch would 401)                                                       | token-refresh exhausted path                                  |
| ERROR_5XX                         | server returns 5xx                                                                                       | toast: per-verb `retryCopy`; cache NOT invalidated                                                                                                  | network throw synthesized via `Response(null, { status: 0 })` |
| ERROR_NETWORK_THROW               | fetch rejects (DNS / abort / offline)                                                                    | toast: per-verb `retryCopy`; cache NOT invalidated                                                                                                  | classified via synthetic 0-status Response                    |
| HAPPY_FORMAT_DATE_NULL            | `formatDateOrDash(null)`                                                                                 | `"—"`                                                                                                                                               | n/a                                                           |
| HAPPY_FORMAT_DATE_ISO             | `formatDateOrDash("2026-09-02T12:34:56.000Z")`                                                           | `"2026-09-02"`                                                                                                                                      | n/a                                                           |
| HAPPY_FORMAT_ACTOR_VIEWER         | `formatActorOrAnonymous(id=viewer, "acknowledge", viewer)`                                               | `"you"`                                                                                                                                             | n/a                                                           |
| HAPPY_FORMAT_ACTOR_NULL           | `formatActorOrAnonymous(null, "acknowledge", viewer)`                                                    | `"anonymous"`                                                                                                                                       | n/a                                                           |
| HAPPY_FORMAT_ACTOR_SUBMIT         | `formatActorOrAnonymous(other, "submit_result", viewer)`                                                 | `"a Technician"`                                                                                                                                    | n/a                                                           |
| HAPPY_FORMAT_ASSIGNEE_NULL        | `formatAssigneeLabel(null, viewer)`                                                                      | `"unassigned"`                                                                                                                                      | n/a                                                           |
| HAPPY_FORMAT_TIMESTAMP_JUST_NOW   | `formatTimelineTimestamp(iso - 30s)`                                                                     | `"just now"`                                                                                                                                        | n/a                                                           |
| HAPPY_FORMAT_TIMESTAMP_WEEK_PLUS  | `formatTimelineTimestamp("2026-08-20T00:00:00.000Z")`                                                    | `"2026-08-20"`                                                                                                                                      | n/a                                                           |
| HAPPY_FORMAT_TIMESTAMP_NAN        | `formatTimelineTimestamp("not-an-iso")`                                                                  | returns original string verbatim                                                                                                                    | defensive fallback                                            |
| HAPPY_FORMAT_SUMMARY_REOPEN_EMPTY | `formatTimelineEventSummary({ type: "reopen", payload: {} })`                                            | `"Reopened by another operator — \"no reason given\"."`                                                                                             | reason-missing fallback                                       |
| HAPPY_PARSE_409_BODY              | `parseTransitionEnvelope({ error: "invalid_state_transition", from: "OPEN", attempted: "acknowledge" })` | returns the body verbatim                                                                                                                           | defensive: non-envelope returns `null`                        |
| HAPPY_PARSE_409_NONENVELOPE       | `parseTransitionEnvelope({ error: "unauthorized" })`                                                     | returns `null`                                                                                                                                      | null discriminator fallback                                   |

</frozen-after-approval>

## Code Map

- `packages/web/src/incidents/useIncidentTransitionMutation.ts` — factory: `TransitionMutationConfig<TVariables>`, `TransitionMutationError`, `classifyTransitionError`, `useIncidentTransitionMutation<TVariables>(id, config)`, per-click `Idempotency-Key` via `crypto.randomUUID()`.
- `packages/web/src/incidents/transitionEnvelope.ts` — pure helpers: `parseTransitionEnvelope`, `invalidTransitionMessage(verb, envelope)`, `STATE_HUMAN`, `VERB_HUMAN`, `VERB_GENERIC_FALLBACK`.
- `packages/web/src/incidents/useAcknowledgeMutation.ts` — 14-line wrapper: `verb: "acknowledge"`, `route: "acknowledge"`, `retryCopy: "Failed to acknowledge. Try again."`, `conflictFallback: "Already acknowledged"`.
- `packages/web/src/incidents/useAssignMutation.ts` — 15-line wrapper: `buildBody: ({ assigneeUserId }) => ({ assignee_user_id: assigneeUserId })` (snake_case wire).
- `packages/web/src/incidents/useSubmitResultMutation.ts` — 18-line wrapper: `verb: "submit_result"`, `conflictFallback: "Already submitted"`.
- `packages/web/src/incidents/useReopenMutation.ts` — 21-line wrapper: `validationFallback: "Reason invalid — please review and resubmit"`.
- `packages/web/src/incidents/format.ts` — pure helpers: `formatDateOrDash`, `formatActorOrAnonymous`, `formatAssigneeLabel`, `formatTimelineTimestamp`, `formatTimelineEventSummary`. Private: `OUTCOME_LABEL`, `ACTOR_LABEL_BY_VERB`, `readStringField`, per-verb `formatXxxSummary` helpers.
- `packages/web/src/incidents/wire.ts` — `IncidentPayloadWireSchema` + `ActiveIncidentsEnvelopeSchema` (structural-equivalence pin lives in `KanbanBoard.spec.tsx`).
- `packages/web/src/incidents/ErrorState.tsx` — `<ErrorState testIdPrefix message onRetry />`; replaces the two inline error-state skeletons.
- `packages/web/src/incidents/useDetailActionHandlers.ts` — 4 handlers; types reference `TransitionMutationError` (single class).
- `packages/web/src/incidents/IncidentDetailPage.tsx` — page orchestrator; imports format helpers from `./format`; uses `<ErrorState testIdPrefix="incident-detail" />`; re-exports `IncidentStateChangedEvent`.
- `packages/web/src/incidents/KanbanBoard.tsx` — Kanban orchestrator; uses `<ErrorState testIdPrefix="kanban-board" />`; imports wire schemas from `./wire`.
- `packages/web/src/incidents/transitionEnvelope.spec.ts` — parser + per-verb 5×3 message matrix (15 cells).
- `packages/web/src/incidents/format.spec.ts` — 21 cases pinning format helpers + per-verb summary matrix.
- `packages/web/src/incidents/KanbanBoard.spec.tsx` — wire-schema structural equivalence pin (must continue to pass).
- `packages/web/src/incidents/IncidentDetailPage.spec.tsx` — 14-case integration matrix; the 4 mutation verbs must continue to render + fire through the factory without testids drifting.
- `packages/web/src/incidents/IncidentDetailActions.spec.tsx` — 4-role × state × slot matrix (Acknowledge / Assign / Submit Result / Export CSV); button-disabled affordances.

## Tasks & Acceptance

**Execution:**

- [x] `packages/web/src/incidents/useIncidentTransitionMutation.ts` — created; owns factory, `TransitionMutationError`, classifier, per-click idempotency-key, 4xx-cache-invalidation gate.
- [x] `packages/web/src/incidents/transitionEnvelope.ts` — created; owns parser + per-verb 5×3 message matrix.
- [x] `packages/web/src/incidents/transitionEnvelope.spec.ts` — created; pins parser nullability + per-verb 5×3 message matrix (15 cases).
- [x] `packages/web/src/incidents/useAcknowledgeMutation.ts` — collapsed to factory wrapper (305→14 lines).
- [x] `packages/web/src/incidents/useAssignMutation.ts` — collapsed to factory wrapper with snake_case `buildBody` (317→15 lines).
- [x] `packages/web/src/incidents/useSubmitResultMutation.ts` — collapsed to factory wrapper (315→18 lines).
- [x] `packages/web/src/incidents/useReopenMutation.ts` — collapsed to factory wrapper with `validationFallback` (250→21 lines).
- [x] `packages/web/src/incidents/format.ts` — extracted pure helpers from `IncidentDetailPage.tsx`.
- [x] `packages/web/src/incidents/format.spec.ts` — 21-case pin of pure helpers.
- [x] `packages/web/src/incidents/wire.ts` — extracted wire schemas from `KanbanBoard.tsx`.
- [x] `packages/web/src/incidents/ErrorState.tsx` — created; shared error-state surface.
- [x] `packages/web/src/incidents/IncidentDetailPage.tsx` — replaced inline format helpers + inline error skeleton (337→170 lines).
- [x] `packages/web/src/incidents/KanbanBoard.tsx` — replaced inline error skeleton + removed unused wire-schema import.
- [x] `packages/web/src/incidents/KanbanBoard.spec.tsx` — import path updated: `IncidentPayloadWireSchema` now from `./wire`.
- [x] `packages/web/src/incidents/useDetailActionHandlers.ts` — types reference unified `TransitionMutationError`.
- [x] `packages/web/src/incidents/toast.tsx` — header + JSDoc trimmed; `<ToastRegion />` accessibility comments preserved.
- [x] `packages/web/src/incidents/cacheMutators.ts` — header trimmed.
- [ ] COMMIT — pending; pre-commit hook requires Bash-denied `pnpm lint:staged`.

**Acceptance Criteria:**

- Given `useAcknowledgeMutation` is invoked for an OPEN incident as Operator, when the POST returns 200, then the page toast shows `"Acknowledged"` AND `incidentDetailQueryKey(id)` is invalidated AND the next fetch returns the ACKNOWLEDGED row.
- Given any transition POST is fired, when the request is inspected, then `Idempotency-Key: <RFC4122 v4>` header is present AND the value is unique per click (two clicks in the same render produce two distinct UUIDs).
- Given the server returns 409 `{ error: "invalid_state_transition", from: "SAFE", attempted: "acknowledge" }`, when the toast renders, then it shows `"Cannot acknowledge a safe incident"` AND the cache is invalidated.
- Given the server returns 409 `{ error: "invalid_state_transition", reason: "concurrent_modification" }`, when the toast renders for ANY of the 5 verbs, then it shows `"Modified by another operator — refresh and retry"`.
- Given the server returns 409 `{ error: "invalid_state_transition" }` with no structured fields, when the toast renders for each verb, then it shows the per-verb fallback (`"Already acknowledged"` / `"Already assigned"` / `"Already submitted"` / `"Cannot reopen — incident is not RESOLVED"`).
- Given the server returns 401, when the toast renders, then it shows `"Session expired — please sign in again"` AND the cache is NOT invalidated.
- Given the server returns 5xx OR fetch throws, when the toast renders, then it shows the per-verb `retryCopy` AND the cache is NOT invalidated.
- Given `useReopenMutation` POSTs with reason `""`, when the server returns 400 with Zod issues, then the toast shows the first Zod issue message verbatim (NOT `"Invalid request"`).
- Given the 4 mutation hooks exist, when their line counts are measured, then each is ≤ 25 lines.
- Given `IncidentDetailPage.tsx` and `KanbanBoard.tsx` exist, when their inline error-state skeletons are searched, then they are absent (the `<ErrorState testIdPrefix=...>` component is the only error surface).
- Given `format.spec.ts` is run, then all 21 cases pass (per-verb summary matrix is pinned).
- Given `transitionEnvelope.spec.ts` is run, then all 15 per-verb cells pass AND the 4 null-envelope guards pass.
- Given `KanbanBoard.spec.tsx` is run, then the wire-schema structural-equivalence pin continues to pass (the canonical vs wire schema pair is in lock-step).

## Spec Change Log

Empty until the first review loopback. Future entries will record what finding triggered the change, what was amended, what known-bad state was avoided, and any KEEP instructions.

## Design Notes

### Factory seam: `TransitionMutationConfig<TVariables>`

The 5 fields (`verb`, `route`, `retryCopy`, `conflictFallback`, `validationFallback?`, `buildBody?`) are the smallest superset that lets the 4 (and eventually 5) verb wrappers differ without re-implementing the mutation body. The `validationFallback` is `reopen`-only because that's the only verb where the api's Zod first-issue message is operator-useful (4.7's Submit Result already has form-level length validation; 4.5's Acknowledge has no body). The `buildBody` is `assign`-only because `acknowledge` has no body; `submit_result` could use the default but routes the `outcome` variable through it for explicit typing.

### Idempotency-Key capture

Generated via `crypto.randomUUID()` at the start of `mutationFn` — i.e., per click, NOT per render. The `useRef<string | null>` capture (kept inside the factory) survives React StrictMode double-mount + double-render. The api middleware (Story 5.6 commit `ffd3fcf`) dedupes on this header; without it, the api's `IdempotencyStore` is a no-op.

### 401 is excluded from cache invalidation

`onError` only invalidates `incidentDetailQueryKey(id)` for `400 ≤ status < 500 && status !== 401`. The rationale: token-refresh is exhausted; a follow-up refetch would 401 again, and the operator must re-auth before any retry can succeed. Surfacing this differently (5xx + 4xx) avoids a cache-flush storm when the api is down for maintenance.

### Format-helper extraction rationale

The 5 per-verb summary helpers (`formatAcknowledgeSummary` / `formatAssignSummary` / `formatSubmitResultSummary` / `formatResolveSummary` / `formatReopenSummary` + `formatInvalidTransitionSummary`) live in `format.ts` rather than being inline in the page because:

- The timeline dispatcher is a `switch` on `event.type`; keeping the branches next to the type-narrowed payload reads naturally.
- All five are pure (no React, no fetch) — unit-testable against canned input without rendering the page.
- Pinning the per-verb copy in `format.spec.ts` is the regression-prevention for any future copy change ("Acknowledged by" → "Ack by").

### Why `<ErrorState />` is a generic component, not a hook

The component takes `testIdPrefix` (not a per-page enum) so future pages (Notifications, Admin) can reuse it without coupling to `incident-detail-*` / `kanban-board-*`. The retry button's `onClick` is the page's own invalidation callback so the component stays free of `useQueryClient`.

## Verification

**Commands:**

- `cd packages/web && npx vitest run src/incidents/format.spec.ts src/incidents/transitionEnvelope.spec.ts` — expected: 21 + 19 cases green.
- `cd packages/web && npx vitest run src/incidents` — expected: all spec files green; the 4 mutation hooks continue to fire through the factory without testid drift.
- `cd packages/web && npx vitest run` — expected: full web suite green.
- `cd packages/web && npx eslint src/incidents/` — expected: clean (lint cap `complexity: 10`, `max-lines-per-function: 200`).
- `cd packages/web && npx tsc -b` — expected: type-check clean.

**Manual checks (if no CLI):**

- Open `IncidentDetailPage.tsx`; confirm `IncidentDetailErrorState` does not appear in the file (use Ctrl-F).
- Open `KanbanBoard.tsx`; confirm `KanbanErrorState` does not appear in the file.
- Open `IncidentDetailPage.tsx`; confirm no `formatDateOrDash` / `formatActorOrAnonymous` / `formatAssigneeLabel` / `formatTimelineTimestamp` / `formatTimelineEventSummary` definitions in the file body (they all import from `./format`).
- Open any of `useAcknowledgeMutation.ts` / `useAssignMutation.ts` / `useSubmitResultMutation.ts` / `useReopenMutation.ts`; confirm each is ≤ 25 lines and the body is a single `useIncidentTransitionMutation(...)` call.
- Grep `packages/web/src` for `AcknowledgeMutationError` / `AssignMutationError` / `SubmitResultMutationError` / `ReopenMutationError` — expected: 0 matches (single `TransitionMutationError` class is the only error type).
- Grep `packages/web/src` for `classifyAcknowledgeError` / `classifyAssignError` / `classifySubmitResultError` / `classifyReopenError` — expected: 0 matches (single `classifyTransitionError` in the factory).
