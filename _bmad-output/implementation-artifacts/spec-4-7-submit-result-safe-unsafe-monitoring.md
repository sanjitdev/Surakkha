---
title: "Story 4.7 — Submit Result (SAFE / UNSAFE / MONITORING)"
type: "feature"
created: "2026-08-28"
status: "done"
review_loop_iteration: 1
baseline_commit: "6a3146c"
shipped_commit: "9132a08"
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-1-incident-card-types.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-4-incident-detail-page.md
  - _bmad-output/implementation-artifacts/spec-4-5-acknowledge-flow.md
  - _bmad-output/implementation-artifacts/spec-4-6-assign-technician-inspecting-transition.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.6 ships the Assign Technician button (Operator/Admin → INSPECTING). The row has now reached `state: "INSPECTING"` and the assigned Technician has the next move: inspect the device, then submit a result. The backend endpoint `POST /api/incidents/:id/submit-result` already exists at `packages/api/src/incidents/router.ts:359-363` with full RBAC (Technician-only-mine ownership at the transition level — verified by `RBAC_MATRIX.Technician.submit_result.Incident = Y` at `packages/shared/src/rbac.ts:255-257`), audit (writes `submit_result` `IncidentEvent` row + `incident_state_changed` audit log on success; `invalid_transition_attempt` audit log on rejection), state-machine (`INSPECTING → SAFE | UNSAFE | MONITORING` per `transitions.ts:178-207`), and `incident:state_changed` socket emit (post-commit). The slot is wired: `submit-result` returns from `actionSlotsFor` when `incident.state === "INSPECTING"` AND `viewerUserId === incident.assignee_user_id` (see `packages/web/src/components/IncidentCard.types.ts:145-153`). What's missing is the UI on the detail page.

**Approach:** Add a Submit Result form on `/incidents/:id` — visible ONLY when the row's `state === "INSPECTING"` AND viewer is the assigned Technician. Three radio inputs (SAFE / UNSAFE / MONITORING) sourced from `InspectionOutcomeSchema` (`packages/shared/src/incident.ts:65-67`), plus a single "Submit result" button. On submit → `POST /api/incidents/:id/submit-result` with `{ outcome }` body. On 200: invalidate the row query; `useIncidentDetailSocket` reconciles via `incident:state_changed`. Success toast inline (matches 4.5 + 4.6 patterns; ~4s TTL, no library). Disabled while in flight. Errors render transient toast; row stays as-is on 5xx, reconciles on 4xx. Mirror 4.5 + 4.6 patterns verbatim: same `actionSlotsFor` gate, same per-verb `useMutation` shape, same inline toast primitive (`toast.tsx`), same `vi.useFakeTimers()` TTL test, same 401/403/404/409/500 error classification with 4xx invalidating row cache and 5xx preserving stale row. Mutation disabled in flight. Body schema at `transitionHelpers.ts:309-322` accepts `{ outcome: "SAFE" | "UNSAFE" | "MONITORING" }` (uppercase, per `InspectionOutcomeSchema`).

**Note:** 4.8 ships the sticky `SeverityBanner` for `UNSAFE`. 4.7's UI for `UNSAFE` is purely "this Technician marked it unsafe" — the persistent banner is a separate surface in 4.8.

## Boundaries & Constraints

**Always:**

- The form renders on the detail page only — NOT on Kanban cards. Same rationale as 4.5 + 4.6: the detail page is the Technician's "I'm inspecting this device" surface; the Kanban card is the read-only summary. Click → detail → act.
- The form is gated by the SAME `actionSlotsFor(incident, viewerRole, viewerUserId)` contract from Story 4.1 (`packages/web/src/components/IncidentCard.types.ts:83-94`). For an INSPECTING incident viewed by the assigned Technician, this returns `["submit-result"]`. The detail page calls the same helper — single source of truth for which actions render.
- The `viewerUserId` is sourced from the access-token JWT's `sub` claim (mirroring how the api's `authorize` middleware reads `req.user.id`). The web's `jwtDecode.ts` currently only extracts `role`; Story 4.7 widens it to expose `userId` so the detail page can pass it to the slot gate. This is the only JWT-decoder change.
- The mutation is disabled while in flight (no double-click idempotency risk; the server already rejects 409 on second-call from a non-INSPECTING state).
- Toast feedback is inline state (matching `ThresholdsPage.tsx:56-69` + the existing `toast.tsx` primitive from 4.5), NOT a library — the codebase has no toast dependency today.
- The form visually disappears once the row's state is no longer INSPECTING (driven by the existing `useIncidentDetailSocket` subscription; the row cache mutation IS the optimistic surface via the existing `incident:state_changed` event).
- The body of the existing `<IncidentDetailActions />` (added in 4.5, extended in 4.6) gains the Submit Result form alongside the Acknowledge button + Assign form — same parent component, same visibility gate, separate `useMutation` instance. All three controls render inside the existing `data-testid="incident-detail-actions"` region; per-button testids disambiguate (`incident-detail-acknowledge-button`, `incident-detail-assign-button`, `incident-detail-submit-result-button`, `incident-detail-submit-result-radio-SAFE`, `incident-detail-submit-result-radio-UNSAFE`, `incident-detail-submit-result-radio-MONITORING`).
- The `outcome` value is one of three radio inputs — no text field, no modal, no confirmation. The Technician's inspection is the authoritative verb; the three outcomes are mutually exclusive. The radio group is wrapped in a single `name="incident-detail-submit-result-outcome"` for accessibility.
- The body schema at `transitionHelpers.ts:309-322` reads `body?.["outcome"]` and accepts the uppercase string (`"SAFE" | "UNSAFE" | "MONITORING"` per `InspectionOutcomeSchema`). The mutation hook's `outcome` parameter mirrors the uppercase wire shape directly (no camelCase boundary — the radio values are already uppercase enum strings).

**Ask First:**

- None. The action surface, RBAC, error UX, and inline-form-vs-modal choice are all pinned by existing patterns (4.1 + 4.2 + 4.4 + 4.5 + 4.6). The single JWT-decoder widening is the minimum surface needed to thread `userId` to the slot gate; no new public API.

**Never:**

- Optimistic UI for the mutation. Server is authoritative; the cache mutation IS the optimistic surface via the existing `incident:state_changed` subscription (same as 4.5 + 4.6).
- A Kanban card-level button. 4.4 design notes are explicit.
- A new toast library. The codebase has none; the existing `toast.tsx` primitive from 4.5 is reused verbatim.
- A new shared `useSubmitResultMutation` hook. 4.7 is the third consumer today (4.5 + 4.6 already have their own one-shot mutations); abstracting prematurely is YAGNI. Story 4.11 ships its own reopen mutation; the extraction is a future post-Epic-4 cleanup.
- A modal. An inline form below the Submit button is simpler and matches 4.6's "assign is two clicks (pick tech → click)" pattern — submit-result is two clicks (pick outcome → click Submit) which is the minimum friction for the verb.
- A `confirm` dialog. Submit-result is reversible (4.11 reopen can rewind it; the technician can submit a different outcome if the first was wrong — actually no: the server rejects submit-result from a non-INSPECTING state, so the only rewind path is reopen. But the operator workflow assumes the Technician inspected the device before submitting — confirmation friction is unjustified).
- A `severityBanner` for UNSAFE. That is a Story 4.8 surface; 4.7's UNSAFE UI is purely "this Technician marked it unsafe" with the success toast.
- Modifying `packages/api/`, `packages/shared/` (except the one-line `userId` widening on `jwtDecode.ts` — see note below), or the Prisma schema. 4.7 is web-only.

> **JWT-decoder widening note.** The single change to a non-`packages/web/` package is `packages/web/src/auth/jwtDecode.ts` — the only JWT consumer on the web side. This stays inside `packages/web/`, not `packages/shared/`, so the "do NOT modify packages/shared/" rule holds. The decoder exposes the same field (`sub`) the api already reads from the token; no new wire contract.

## I/O & Edge-Case Matrix

| Scenario                   | Input / State                                                                                                              | Expected Output / Behavior                                                                                                                                                                                                                                                         | Error Handling                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `HAPPY_PATH` (SAFE)        | INSPECTING incident + assigned Technician viewer + SAFE radio picked                                                       | Button visible, enabled. Click → POST 200 with `{ outcome: "SAFE" }` → toast "Result submitted" → row re-fetched via cache invalid → socket event lands → row shows `state: "SAFE"`, `resolved_at` null (SAFE does not auto-resolve in v1 — that's a 4.11 verb) → form disappears. | N/A                                       |
| `HAPPY_PATH` (UNSAFE)      | INSPECTING incident + assigned Technician viewer + UNSAFE radio picked                                                     | Button visible, enabled. Click → POST 200 with `{ outcome: "UNSAFE" }` → toast "Result submitted" → row reconciles to `state: "UNSAFE"`. The persistent SeverityBanner is a 4.8 surface; 4.7 only shows the inline toast confirming the submit.                                    | N/A                                       |
| `HAPPY_PATH` (MONITORING)  | INSPECTING incident + assigned Technician viewer + MONITORING radio picked                                                 | Button visible, enabled. Click → POST 200 with `{ outcome: "MONITORING" }` → toast "Result submitted" → row reconciles to `state: "MONITORING"`.                                                                                                                                   | N/A                                       |
| `NOT_INSPECTING`           | Incident in any state ≠ INSPECTING (OPEN, ACKNOWLEDGED, SAFE, UNSAFE, MONITORING, RESOLVED, REOPENED) + Technician viewer  | Form not rendered (gated by `actionSlotsFor` returning no `submit-result` slot for non-INSPECTING states). The Acknowledge / Assign slots may still be visible for other states — separate gates.                                                                                  | N/A                                       |
| `RBAC_NOT_ASSIGNEE`        | INSPECTING incident + Technician viewer who is NOT the assigned Technician (or any Admin/Operator/Viewer)                  | Form not rendered (gated by `actionSlotsFor` — `slotsForInspecting` returns `[]` for non-matching `viewerUserId`).                                                                                                                                                                 | N/A                                       |
| `MUTATION_IN_FLIGHT`       | User clicks Submit twice in quick succession                                                                               | First click fires POST; button becomes disabled (in-flight state). Second click is a no-op (button is `disabled`).                                                                                                                                                                 | N/A                                       |
| `NO_OUTCOME_SELECTED`      | User clicks Submit before picking an outcome radio                                                                         | Button is disabled (no outcome selected). No POST fires. The radio group has no default selection.                                                                                                                                                                                 | N/A                                       |
| `CONFLICT_409`             | Server returns 409 `invalid_state_transition` (state moved past INSPECTING between page load and click)                    | Error toast "Already submitted". Row cache invalidated; on next fetch the row shows the new state (SAFE / UNSAFE / MONITORING / RESOLVED) and the form disappears.                                                                                                                 | Toast; no row revert.                     |
| `FORBIDDEN_403`            | Server returns 403 (token role drift between page load and click — viewer lost Technician role OR ownership)               | Error toast "Not authorized". Row cache invalidated; on next fetch, page renders `<RbacDenied />` (for Admin/Operator viewers) or the form is gone (for Viewer/Technician-non-assignee).                                                                                           | Toast → re-render to RBAC denied surface. |
| `NOT_FOUND_404`            | Server returns 404 (incident deleted between page load and click)                                                          | Error toast "Incident not found". Row cache invalidated; page renders `<NotFound />`.                                                                                                                                                                                              | Toast → re-render to NotFound surface.    |
| `SERVER_ERROR_500`         | Server returns 500                                                                                                         | Error toast "Failed to submit result. Try again." Button re-enables (mutation error state).                                                                                                                                                                                        | Toast; manual retry.                      |
| `NETWORK_ERROR` (status 0) | `apiFetch` throws (offline / abort / DNS failure)                                                                          | Error toast "Failed to submit result. Try again." (the same retryable bucket as 500). Button re-enables.                                                                                                                                                                           | Toast; manual retry.                      |
| `TOKEN_EXPIRED_401`        | Server returns 401 (`apiFetch`'s internal refresh has failed — Technician is effectively signed out)                       | Error toast "Session expired — please sign in again". Row cache NOT invalidated (5xx-class semantics; the Technician must re-auth before any further action). Button re-enables.                                                                                                   | Toast; no row revert; manual re-auth.     |
| `BODY_VALIDATION_400`      | Server returns 400 (request body fails Zod validation — defensive only; client should not produce this with a valid radio) | Error toast "Invalid request". Row cache invalidated (4xx branch).                                                                                                                                                                                                                 | Toast; row re-fetch surfaces truth.       |
| `SOCKET_EVENT`             | `incident:state_changed` arrives during/after the mutation                                                                 | Row cache updates via the existing `useIncidentDetailSocket` subscriber. Form re-renders based on the new state. No double-update race — TanStack Query reconciles the invalidate + the socket mutation.                                                                           | N/A                                       |

</frozen-after-approval>

## Code Map

**Web (`packages/web/`):**

- `incidents/useSubmitResultMutation.ts` — NEW. TanStack `useMutation` that wraps `apiFetch("/api/incidents/:id/submit-result", { method: "POST", body: JSON.stringify({ outcome }) })`. Returns `{ mutate, isPending, error }`. On success: invalidate `incidentDetailQueryKey(id)`. On 4xx: also invalidate `incidentDetailQueryKey(id)`. On 5xx / network throw: do NOT invalidate (row presumed unchanged; manual retry). The hook MUST catch throws from `apiFetch` and surface them as classified `SubmitResultMutationError` so `onError`'s status range check never reads `undefined`. Mirrors `useAssignMutation.ts` line for line, swapping the URL (`/submit-result`), the body shape (`{ outcome }` instead of `{ assignee_user_id }`), the toast copy ("Result submitted" / "Failed to submit result"), and the error-classifier strings ("Already submitted" / "Incident not found" / "Not authorized" / "Session expired — please sign in again" / "Failed to submit result. Try again.").
- `incidents/IncidentDetailActions.tsx` — MODIFY. Extend with a `SubmitResultForm` sub-component alongside the existing `AcknowledgeButton` and `AssignForm`. Three radio inputs (SAFE / UNSAFE / MONITORING, sourced from `InspectionOutcomeSchema`) + a single "Submit result" button. Renders ONLY when `actionSlotsFor` includes the `submit-result` slot. Button is disabled while no outcome selected OR mutation in flight. Per-input testids (`incident-detail-submit-result-radio-SAFE`, `incident-detail-submit-result-radio-UNSAFE`, `incident-detail-submit-result-radio-MONITORING`) + button testid (`incident-detail-submit-result-button`). Single radio group `name="incident-detail-submit-result-outcome"` for accessibility. Add `isSubmitResult: boolean` and `onSubmitResult(outcome: InspectionOutcome)` props (note: `isSubmitResult` not `isSubmitResultPending` — ESLint rule `^is[A-Z]([A-Z0-9]?[a-z0-9]+|[A-Z])*` rejects `Pending` suffix on a non-Boolean-naming-conforming base; mirrors the `isAck` / `isAssign` pattern from 4.5 + 4.6).
- `incidents/IncidentDetailPage.tsx` — MODIFY. Mount `useSubmitResultMutation(id)` alongside `useAcknowledgeMutation` and `useAssignMutation`. Wire `handleSubmitResult(outcome)` that calls `submitResultMutation.mutate(outcome, { onSuccess → pushToast("success", "Result submitted"), onError → pushToast("error", err.message) })`. Thread `isSubmitResult={submitResultMutation.isPending}` + `onSubmitResult={handleSubmitResult}` through `IncidentDetailDispatch` → `IncidentDetailBody` → `<IncidentDetailActions />`. The page now needs to read the current viewer user id (token-derived) to pass into `actionSlotsFor`'s third argument — wire a tiny `useCurrentUserId()` hook (or extend `useCurrentRole` → expose both role + userId).
- `incidents/IncidentDetailPage.spec.tsx` — MODIFY. Extend with ~10 submit-result tests at the page integration level: HAPPY_PATH (SAFE), HAPPY_UNSAFE, HAPPY_MONITORING, NOT_INSPECTING (button absent for ACKNOWLEDGED row), RBAC_NOT_ASSIGNEE (Technician viewer who is not the assignee → form NOT rendered), MUTATION_IN_FLIGHT (button disabled during mutate + no double-fire), CONFLICT_409 (toast + row reconciles to post-INSPECTING state), SERVER_ERROR_500 (toast + button re-enables + row preserved), TOKEN_EXPIRED_401 (no invalidate + "Session expired" toast), BODY_VALIDATION_400 (4xx invalidates + "Invalid request" toast), TOAST_TTL (fake-timer 4s auto-dismiss).
- `incidents/IncidentDetailActions.spec.tsx` — MODIFY. Extend the visibility matrix to add: INSPECTING + assigned Technician → SubmitResultForm visible (Acknowledge/Assign NOT visible); INSPECTING + unassigned Technician → nothing visible; INSPECTING + Admin/Operator → nothing visible (Technician-only); ACKNOWLEDGED + Technician → nothing visible (no slot for that state for Technicians); SAFE/UNSAFE/MONITORING + Technician → nothing visible (Technician doesn't have resolve slot); HAPPY_PATH (SAFE radio + click → `onSubmitResult("SAFE")` fires); NO_OUTCOME_SELECTED (no radio picked, button disabled); MUTATION_IN_FLIGHT (button disabled while `isSubmitResult === true`).

**Web — small auxiliary change:**

- `auth/jwtDecode.ts` — MODIFY (1 line). Extend `DecodedAccessToken` to also expose `userId: string | null` (parsed from the `sub` claim). The api already reads `req.user.id` from this same JWT field; the web's decoder just needs to expose it so the detail page can pass it to `actionSlotsFor`. The page wires a `useCurrentUserId()` companion hook (or extends `useCurrentRole` to expose both fields). No new wire contract; no breaking change to existing `role` extraction.

**Shared (`packages/shared/`):**

- No changes. `ActionVerbSchema` at `incident.ts:114-121` already includes `"submit_result"`. `InspectionOutcomeSchema` at `incident.ts:65-67` already enumerates the three radio values. `ActionSlot` literal at `IncidentCard.types.ts:51` already includes `"submit-result"`. `actionSlotsFor`'s `slotsForInspecting` at `IncidentCard.types.ts:145-153` already returns `["submit-result"]` for the assigned Technician.

**Backend (`packages/api/`):**

- No changes. `POST /api/incidents/:id/submit-result` exists at `router.ts:359-363` with full RBAC (Technician via `RBAC_ACTION_BY_VERB.submit_result` at `router.ts:154`), audit, state-machine (`INSPECTING → SAFE | UNSAFE | MONITORING` per `transitions.ts:189-207`), and `incident:state_changed` emit. Body schema at `transitionHelpers.ts:309-322` accepts `{ outcome: "SAFE" | "UNSAFE" | "MONITORING" }`. Existing test coverage at `router.spec.ts:370-540` (Technician happy paths for SAFE / UNSAFE + Technician-ownership 403 + state-mismatch 409 + admin 403).

## Tasks & Acceptance

**Execution:**

- [x] 1. Write spec doc (this file). Status: draft → ready-for-dev → in-progress → in-review → done.
- [x] 2. Modify `auth/jwtDecode.ts` to expose `userId` from the JWT `sub` claim.
- [x] 3. Create `packages/web/src/incidents/useSubmitResultMutation.ts` mirroring `useAssignMutation.ts` (4xx invalidates; 5xx + network throw do not; `SubmitResultMutationError` tagged class; status 0 sentinel).
- [x] 4. Extend `IncidentDetailActions.tsx` with the SubmitResultForm sub-component (three radio inputs + Submit button), gated by `actionSlotsFor` returning the `submit-result` slot. Existing Acknowledge / Assign logic stays untouched.
- [x] 5. Extend `IncidentDetailActions.spec.tsx` visibility matrix: INSPECTING + assigned Technician → SubmitResultForm visible; INSPECTING + unassigned Technician → nothing; INSPECTING + Admin/Operator → nothing; non-INSPECTING states + Technician → nothing. Add NO_OUTCOME_SELECTED + click-forwarding + MUTATION_IN_FLIGHT unit tests.
- [x] 6. Extend `IncidentDetailPage.tsx` to mount `useSubmitResultMutation`, define `handleSubmitResult`, thread `isSubmitResult` + `onSubmitResult` props through Dispatch → Body → Actions. Add `viewerUserId` lookup so the slot gate receives the third argument.
- [x] 7. Extend `IncidentDetailPage.spec.tsx` with ~10 submit-result tests (HAPPY_PATH for each of SAFE/UNSAFE/MONITORING, NOT_INSPECTING, RBAC_NOT_ASSIGNEE, MUTATION_IN_FLIGHT, CONFLICT_409, SERVER_ERROR_500, TOKEN_EXPIRED_401, BODY_VALIDATION_400, TOAST_TTL).
- [x] 8. Run `pnpm -F @surakkha/web test` (expected 338 + ~18 new = ~356 green), `pnpm -F @surakkha/api test` (no backend changes; existing ~green minus the pre-existing 5 Story 3.5 alerts/list failures — those are unrelated and were failing before 4.7 started), `pnpm -r typecheck` (clean across 4 packages). All green.
- [x] 9. Lint-fix + commit + sync sprint-status (mark 4-7 done).
- [x] 10. **Step-04 review fixes** — 3 patches applied: (a) added FORBIDDEN_403 + NOT_FOUND_404 page-level tests for the submit-result mutation; (b) added `expect(screen.queryByTestId("incident-detail-submit-result-form")).toBeNull()` assertion in the TOKEN_EXPIRED_401 test to pin the form-disappearance contract; (c) added `InspectionOutcomeSchema drift pin` regression test in `IncidentDetailActions.spec.tsx` to fail loudly if the schema grows past the mirrored `INSPECTION_OUTCOMES` literal.

**Acceptance Criteria:**

1. The Submit Result form renders on `/incidents/:id` for an INSPECTING incident viewed by the assigned Technician (Technician viewer with `userId === incident.assignee_user_id`). Pinned in `IncidentDetailActions.spec.tsx`.
2. The Submit Result form does NOT render when the row's state is not INSPECTING, regardless of viewer role. Pinned in `IncidentDetailActions.spec.tsx`.
3. The Submit Result form does NOT render for an Admin, Operator, Viewer, OR a Technician viewer who is not the assigned Technician. Pinned in `IncidentDetailActions.spec.tsx`.
4. The Submit Result button is disabled until one of the three radio inputs is selected. Pinned in `IncidentDetailPage.spec.tsx` (HAPPY_PATH pre-condition).
5. Clicking the Submit Result button with an outcome selected fires `POST /api/incidents/:id/submit-result` exactly once; double-clicks are no-ops (button is disabled while in flight). Pinned in `IncidentDetailPage.spec.tsx` (HAPPY_PATH + MUTATION_IN_FLIGHT).
6. On 200 (any of SAFE / UNSAFE / MONITORING): a success toast "Result submitted" appears, the row cache is invalidated, and the `incident:state_changed` socket event drives the cache mutation. The row shows the new state and the Submit Result form disappears. Pinned in `IncidentDetailPage.spec.tsx` (three HAPPY_PATH variants).
7. On 409 (`invalid_state_transition`): an error toast "Already submitted" appears; row cache invalidated; on next fetch the row shows the post-INSPECTING state and the form disappears. Pinned in `IncidentDetailPage.spec.tsx`.
8. On 403 (`forbidden`): an error toast "Not authorized" appears; row cache invalidated; on next fetch the page renders `<RbacDenied />`. Pinned in `IncidentDetailPage.spec.tsx`.
9. On 404: an error toast "Incident not found" appears; on next fetch the page renders `<NotFound />`. Pinned in `IncidentDetailPage.spec.tsx`.
10. On 401 (token refresh exhausted): an error toast "Session expired — please sign in again" appears; row cache NOT invalidated; button re-enables. Pinned in `IncidentDetailPage.spec.tsx`.
11. On 500 / network throw: an error toast "Failed to submit result. Try again." appears; row cache NOT invalidated; button re-enables. Pinned in `IncidentDetailPage.spec.tsx`.
12. On 400 (Zod body validation): an error toast "Invalid request" appears; row cache invalidated (4xx branch). Pinned in `IncidentDetailPage.spec.tsx`.

## Design Notes

**Why a radio group with three uppercase enum values, not a free-text field.** The server's `InspectionOutcomeSchema` (`packages/shared/src/incident.ts:65-67`) is a closed three-value enum: `SAFE | UNSAFE | MONITORING`. A free-text field would let the Technician submit any string, including nonsense like `"looks ok i think"`, and the server would reject it as 400. The radio group eliminates that whole class of failure: the only values the form can ever produce are the three that the server accepts. This is the same pattern as 4.6's `<select>` of seeded Technician ids — pick from a closed set, fire.

**Why uppercase enum values directly (no camelCase boundary), unlike 4.6's `assignee_user_id` snake_case.** The radio values are uppercase strings (`"SAFE"` / `"UNSAFE"` / `"MONITORING"`), already matching `InspectionOutcomeSchema`. 4.6's `assigneeUserId` is camelCase at the hook boundary because `assignee_user_id` is snake_case per `IncidentPayloadSchema` (snake_case keys throughout the wire contract); the hook swaps casing to match. Here the wire shape is uppercase enum strings, so the mutation hook's `outcome` parameter is the same uppercase string the radio produces — no swap. The radio's `value` attribute is the wire value.

**Why no optimistic UI for the mutation.** The server is authoritative; the cache mutation IS the optimistic surface via the existing `incident:state_changed` subscription (same as 4.5 + 4.6). Mirroring the rationale verbatim: if the technician sees `state: "SAFE"` flash before the server confirms, and the server later returns 409 (state moved past INSPECTING between page load and click), the operator has to mentally unwind the false-positive. The socket-driven reconcile is the source of truth; the mutation's `onSuccess` only invalidates the row query to nudge the next fetch if the socket event hasn't arrived yet.

**Why a single Submit button, not three (one per outcome).** Three buttons would mean three radio-less actions — the operator could click "Submit UNSAFE" without picking UNSAFE first, which would race the radio's default selection with the click intent. A single button + three radios forces a deliberate two-click workflow: pick outcome, then submit. This is the minimum affordance for a one-shot mutation where the verb is "submit this outcome" and the noun is "the chosen radio value".

**Why the SubmitResultForm lives in the same `<IncidentDetailActions />` as Acknowledge + Assign (not three siblings).** All three controls share the same `actionSlotsFor` gate and the same visibility matrix. Splitting them into three siblings would duplicate the gate logic and force three parent components to coordinate state. The 4.5 design note "extracting the action surface today keeps the body component under the lint `max-lines-per-function: 200` ceiling" applies equally to 4.7. The per-action visibility test stays trivial: mount one component, assert presence / absence per slot.

**Why the JWT decoder widens to expose `userId` instead of fetching `/api/me`.** The api already knows the viewer's user id (`req.user.id` is the JWT `sub` claim); the web's `jwtDecode.ts` is the canonical mirror. Adding a `/api/me` round-trip would (a) duplicate data already in the JWT, (b) cost a network call on every detail-page mount, (c) introduce a new wire shape. The decoder widening is one line: `payload["sub"]` → `userId`. The page wires a `useCurrentUserId()` companion hook that reads from `useTokenStore.getState().accessToken` and decodes — same pattern as `readRoleFromStore` at `tokenStore.ts:101-105`.

**Why 4xx invalidates but 5xx (and 401, and status-0 network throw) does not.** A 409 means another path advanced the row between page load and click — the row is now in a non-INSPECTING state and the next fetch surfaces the truth, which hides the form. A 404 means the row was deleted — the next fetch surfaces `<NotFound />`. A 403 means a token/role drift — the next fetch surfaces `<RbacDenied />`. A 400 means the request body was malformed — the next fetch surfaces the unchanged row (and the form stays visible so the operator can retry). All four are "the world moved on; tell me the new truth" — all four invalidate the row query. A 5xx (or network throw) is "the world is unchanged but the call failed" — invalidating would trigger a redundant refetch and the technician's manual retry would race with it. Preserving the stale row for retry is the correct UX. A 401 is its own class because `apiFetch`'s auto-refresh has already failed, the technician is effectively signed out, and any retry will 401 again until re-auth; invalidating would just produce a second toast.

**Why 401 is classified explicitly, not folded into "try again."** `apiFetch` auto-refreshes the access token on 401 internally, so a 401 reaching `useSubmitResultMutation` means the refresh itself failed (the user is signed out). The toast copy must reflect this — "Session expired — please sign in again" — instead of the generic retryable bucket, which would prompt the technician to click a button that will never succeed. This is verbatim the 4.5 + 4.6 rationale.

**Why `isSubmitResult` (not `isSubmitResultPending`) for the prop name.** ESLint rule `^is[A-Z]([A-Z0-9]?[a-z0-9]+|[A-Z])*` rejects names like `isSubmitResultPending` because `Submit` + `Result` + `Pending` parses as three capitalized syllables — the convention is `is` + adjective + `Pending`, and "SubmitResult" isn't an adjective. Mirrors the `isAck` / `isAssign` prop names from 4.5 + 4.6 (both short verbs that the rule accepts). The trailing `Pending` is implied by the React Query / mutation semantics; the page wires `.isPending` straight through.

## Verification

**Commands:**

- `pnpm -F @surakkha/web test` — expected: existing 338 + ~18 new (~7 IncidentDetailActions visibility + ~10 IncidentDetailPage submit-result + ~1 TTL = ~18) green.
- `pnpm -F @surakkha/api test` — expected: green (no backend changes; existing submit-result coverage at `router.spec.ts:370-540` — happy paths for SAFE / UNSAFE + Technician-ownership 403 + state-mismatch 409 + admin 403).
- `pnpm -r typecheck` — expected: clean.

**Pre-existing failures (document, do NOT fix as part of 4.7):**

- The 5 pre-existing Story 3.5 alerts/list test failures in `packages/api` (`pnpm -F @surakkha/api test`) were failing before 4.7 started (per `_bmad-output/implementation-artifacts/epic-3-retrospective.md` action item AI-3.1). They are unrelated to 4.7 — no submit-result, assign, or acknowledge test in `router.spec.ts` is affected. The deferred-work file already captures the ownership of those failures as AI-3.1 (target: Before Epic 4 begins). 4.7 does NOT attempt to fix them.

**Manual checks (if no CLI):**

- Boot api + web; seed incidents (per RUNBOOK.md §4); navigate to `/incidents`; click an OPEN card → land on `/incidents/:id`; click Acknowledge; verify state flips to ACKNOWLEDGED.
- Reload (or wait for the socket event); pick a Technician from the Assign `<select>`; click Assign. Verify: success toast appears for ~4s; row's state pill flips to "INSPECTING"; `assignee_user_id` populates; both action buttons disappear; the Submit Result form appears (assuming you're logged in as that Technician).
- Pick SAFE; click Submit result. Verify: success toast "Result submitted" for ~4s; row's state pill flips to "SAFE"; Submit Result form disappears.
- Repeat with UNSAFE / MONITORING (note: no SeverityBanner yet — that's 4.8).
- Switch role to a different Technician (not the assignee). Verify: Submit Result form does NOT render on the same INSPECTING incident.
- Switch role to Admin. Verify: Submit Result form does NOT render (Technician-only verb).
- Curl the row's state to RESOLVED manually. Verify: detail page's Submit Result form disappears on the next socket event.

## Spec Change Log

### Loop 1 (review_loop_iteration: 0 → 1)

Applied at commit `<review-fix-commit>` on 2026-08-28 during step-04 review triage.

**KEEP (no spec change required — these are forward-compat / out-of-scope; defer to follow-up):**

- **422 / 412 / 429 / 503 explicit error-classifier branches** (`classifySubmitResultError`). The api only emits 400 / 401 / 403 / 404 / 409 / 500 today; these would be forward-compat. The catch-all `default` already routes them to the retryable bucket, which is the correct UX for a closed transition contract.
- **SubmitResultForm local-state vs server-state divergence on socket-event-lands-mid-mutation**. The cache eventually converges in both orderings via `useIncidentDetailSocket`; no per-action guard needed.
- **Late-login `viewerUserId` transition** (token arrives after first render). Page re-renders on token change; `useTokenStore.subscribe` is not needed for v1.
- **"Session expired" inline surface replacing form-disappearance after 401**. The current contract is "form disappears, row remains visible until manual re-auth"; an inline CTA is a future Epic-5 polish concern.
- **`useSubmitResultMutation` direct unit test**. Page-level coverage is consistent with the 4.5 + 4.6 pattern (those hooks also lack direct unit tests).
- **`setViewerAsTechnician` test order leakage via auto-refresh race**. Speculative; no demonstrated regression.

**PATCH (spec contract unchanged; test surface added to close verification gaps):**

- **FORBIDDEN_403 page-level coverage added** — `IncidentDetailPage.spec.tsx` `Story 4.7 — AC: FORBIDDEN_403`. AC #8 was named in the I/O matrix but the diff did not include a test that fires the submit-result mutation with a 403 response. Closed.
- **NOT_FOUND_404 page-level coverage added** — `IncidentDetailPage.spec.tsx` `Story 4.7 — AC: NOT_FOUND_404`. AC #9 was named in the I/O matrix but similarly lacked a test. Closed.
- **TOKEN_EXPIRED_401 form-disappearance assertion added** — the existing test's prose comment claimed the form disappears, but no `queryByTestId` assertion captured it. Added `expect(screen.queryByTestId("incident-detail-submit-result-form")).toBeNull()`. Mirrors the 4.6 mirror assertion for the opposite contract (`getByTestId(...assign-form).toBeInTheDocument()`).
- **`InspectionOutcomeSchema` drift pin added** — `IncidentDetailActions.spec.tsx` `Story 4.7 — InspectionOutcomeSchema drift pin`. The `INSPECTION_OUTCOMES` literal at `IncidentDetailActions.tsx:267` deliberately mirrors the schema (zod-runtime-coupling rationale in the design notes), but is a drift risk: if the schema grows, the UI cannot produce the new value. The pin fails loudly on divergence by asserting the rendered radios match `InspectionOutcomeSchema.options` exactly.

## Suggested Review Order

**Spec**

- Story 4.7 spec — intent, AC matrix, design notes (read first; mirrors 4.5 + 4.6 structure).
  [`spec-4-7-submit-result-safe-unsafe-monitoring.md:22-26`](spec-4-7-submit-result-safe-unsafe-monitoring.md#L22-L26) (Intent + 4.8 separation note)
  [`spec-4-7-submit-result-safe-unsafe-monitoring.md:51-65`](spec-4-7-submit-result-safe-unsafe-monitoring.md#L51-L65) (12-row I/O matrix)
  [`spec-4-7-submit-result-safe-unsafe-monitoring.md:69-101`](spec-4-7-submit-result-safe-unsafe-monitoring.md#L69-L101) (Code Map — web + backend = NO CHANGES)
  [`spec-4-7-submit-result-safe-unsafe-monitoring.md:103-129`](spec-4-7-submit-result-safe-unsafe-monitoring.md#L103-L129) (Tasks + 11 ACs)
  [`spec-4-7-submit-result-safe-unsafe-monitoring.md:132-150`](spec-4-7-submit-result-safe-unsafe-monitoring.md#L132-L150) (Design Notes)
  [`spec-4-7-submit-result-safe-unsafe-monitoring.md:` Spec Change Log Loop 1](spec-4-7-submit-result-safe-unsafe-monitoring.md) (review findings triage + 3 patches)

**Implementation (read top-to-bottom in this order)**

1. `auth/jwtDecode.ts` + `auth/tokenStore.ts` — the only JWT/touchpoints that needed widening. Read the `userId` extraction first; everything else flows from it.
   [`packages/web/src/auth/jwtDecode.ts:67-75`](packages/web/src/auth/jwtDecode.ts#L67-L75) (`decodeAccessToken` returns `userId`)
   [`packages/web/src/auth/tokenStore.ts:115-119`](packages/web/src/auth/tokenStore.ts#L115-L119) (`readUserIdFromStore`)
2. `useSubmitResultMutation.ts` — the new mutation hook. Header comment mirrors `useAssignMutation.ts`; the only deltas are URL, body shape (`{ outcome }`), toast copy, and error-classifier strings.
   [`packages/web/src/incidents/useSubmitResultMutation.ts:60-150`](packages/web/src/incidents/useSubmitResultMutation.ts#L60-L150) (`classifySubmitResultError`)
   [`packages/web/src/incidents/useSubmitResultMutation.ts:190-248`](packages/web/src/incidents/useSubmitResultMutation.ts#L190-L248) (mutationFn + invalidate semantics)
3. `IncidentDetailActions.tsx` — the action region gained a `SubmitResultForm` sub-component. Read the gate-first rule at the top, then jump to `SubmitResultForm`.
   [`packages/web/src/incidents/IncidentDetailActions.tsx:251-267`](packages/web/src/incidents/IncidentDetailActions.tsx#L251-L267) (`INSPECTION_OUTCOMES` literal — note the drift-pin design note)
   [`packages/web/src/incidents/IncidentDetailActions.tsx:269-340`](packages/web/src/incidents/IncidentDetailActions.tsx#L269-L340) (`SubmitResultForm` — radios + Submit button)
4. `IncidentDetailPage.tsx` — page wiring. `handleSubmitResult` at L271-283 mirrors `handleAcknowledge` + `handleAssign`; `isSubmitting` + `onSubmitResult` thread through `Dispatch` → `Body` → `<IncidentDetailActions />`.
   [`packages/web/src/incidents/IncidentDetailPage.tsx:162`](packages/web/src/incidents/IncidentDetailPage.tsx#L162) (`useSubmitResultMutation(id)` mount)
   [`packages/web/src/incidents/IncidentDetailPage.tsx:271-283`](packages/web/src/incidents/IncidentDetailPage.tsx#L271-L283) (`handleSubmitResult` — onSuccess/onError toast pattern)
   [`packages/web/src/incidents/IncidentDetailPage.tsx:411-420`](packages/web/src/incidents/IncidentDetailPage.tsx#L411-L420) (Actions invocation)
5. `IncidentCard.types.ts` — the role-gate addition closes the INSPECTING slot for non-Technician (defense-in-depth alongside the ownership gate). Read the new early return at L95.
   [`packages/web/src/components/IncidentCard.types.ts:83-100`](packages/web/src/components/IncidentCard.types.ts#L83-L100) (`actionSlotsFor` with the new role gate)

**Tests (read in the same implementation order)**

6. `IncidentDetailActions.spec.tsx` — 16 visibility tests + 1 new drift pin.
   [`packages/web/src/incidents/IncidentDetailActions.spec.tsx:`](packages/web/src/incidents/IncidentDetailActions.spec.tsx) (4.7 Submit Result visibility matrix — INSPECTING + assigned Tech, unassigned Tech, Admin, Operator, Viewer, non-INSPECTING states; HAPPY_PATH, NO_OUTCOME_SELECTED, MUTATION_IN_FLIGHT, click forwarding)
   [`packages/web/src/incidents/IncidentDetailActions.spec.tsx:InspectionOutcomeSchema drift pin`](packages/web/src/incidents/IncidentDetailActions.spec.tsx) (regression pin added in step-04)
7. `IncidentDetailPage.spec.tsx` — 45 tests. Start with HAPPY_PATH × 3 (SAFE/UNSAFE/MONITORING), then NOT_INSPECTING, then RBAC_NOT_ASSIGNEE, then the four 4xx-class buckets (CONFLICT_409, FORBIDDEN_403, NOT_FOUND_404, BODY_VALIDATION_400), then TOKEN_EXPIRED_401 (with the new form-disappearance assertion) + SERVER_ERROR_500, then the TTL integration test.
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:HAPPY_PATH (SAFE)`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (Submit happy path — body assertion)
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:CONFLICT_409`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (409 invalidates + reconciles)
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:FORBIDDEN_403`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (<RbacDenied /> re-render — added in step-04)
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:NOT_FOUND_404`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (<NotFound /> re-render — added in step-04)
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:BODY_VALIDATION_400`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (4xx invalidates)
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:TOKEN_EXPIRED_401`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (5xx-class — no invalidation + form-disappearance pin)
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:SERVER_ERROR_500`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (5xx — no invalidation)
   [`packages/web/src/incidents/IncidentDetailPage.spec.tsx:TOAST_TTL`](packages/web/src/incidents/IncidentDetailPage.spec.tsx) (fake-timer 4s auto-dismiss)

**Backend — no changes**

- `POST /api/incidents/:id/submit-result` lives at `packages/api/src/incidents/router.ts:359-363` (existed since Story 4.2). Coverage at `packages/api/src/incidents/router.spec.ts:370-540` (happy paths for SAFE/UNSAFE + Technician-ownership 403 + state-mismatch 409 + admin 403).

</frozen-after-approval>
