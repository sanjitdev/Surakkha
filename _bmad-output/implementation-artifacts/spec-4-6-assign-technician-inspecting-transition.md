---
title: "Story 4.6 — Assign Technician + INSPECTING Transition"
type: "feature"
created: "2026-08-28"
status: "in-progress"
review_loop_iteration: 0
baseline_commit: "194fdd6"
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-1-incident-card-types.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-4-incident-detail-page.md
  - _bmad-output/implementation-artifacts/spec-4-5-acknowledge-flow.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.5 shipped the Acknowledge button (Operator one-click; OPEN → ACKNOWLEDGED). Operators can ACK an incident but cannot ASSIGN — the next step in the operator workflow is to pick which Technician handles the incident. The detail page (`/incidents/:id`) has an Assign slot pinned by `actionSlotsFor` (4.1) but no UI for it. The server endpoint `POST /api/incidents/:id/assign` already exists at `packages/api/src/incidents/router.ts:354-358` with full RBAC (Admin + Operator), audit, state-machine (OPEN | ACKNOWLEDGED → INSPECTING), and `incident:state_changed` emit — verified by Story 4.2 review patch "assign body does not validate target User exists" (which is P2003 → 404 defense-in-depth on the server).

**Approach:** Add an Assign button on the detail page header (visible only when the row's state is `ACKNOWLEDGED` AND the viewer is Admin or Operator — same slot gate as the Acknowledge button, just for the `assign` slot). One click → `POST /api/incidents/:id/assign` with `{ assignee_user_id }` body via the existing `apiFetch`. On success: invalidate the detail-page row query (TanStack Query re-fetch); the existing `useIncidentDetailSocket` subscription reconciles state via the next `incident:state_changed` event — no optimistic UI. Show a transient success toast inline (matching `ThresholdsPage.tsx:56-69` + `IncidentDetailPage` 4.5 toast wiring; 4s TTL, no library). Disabled while the mutation is in flight. Errors render a transient error toast; row stays as-is on 5xx, reconciles on 4xx. Mirrors Story 4.5 patterns verbatim: same `actionSlotsFor` gate, same per-verb `useMutation` shape, same inline toast pattern, same `vi.useFakeTimers()` TTL test, same 401/403/404/409/500 error classification with 4xx invalidating row cache and 5xx preserving stale row. Mutation disabled in flight.

## Boundaries & Constraints

**Always:**

- The button renders on the detail page only — NOT on Kanban cards. Story 4.4 design notes are explicit that clicking a card → `/incidents/:id` → action there. Same justification as 4.5.
- The button is gated by the SAME `actionSlotsFor(incident, viewerRole)` contract from Story 4.1 (`packages/web/src/components/IncidentCard.types.ts:83-94`). For an ACKNOWLEDGED incident viewed by an Admin/Operator, this returns the `assign` slot. The detail page calls the same helper — single source of truth for which actions render.
- The mutation is disabled while in flight (no double-click idempotency risk; the server already rejects 409 on second-call from a non-ASSIGNABLE state).
- Toast feedback is inline state (matching `ThresholdsPage.tsx:56-69` + the existing `toast.tsx` primitive from 4.5), NOT a library — the codebase has no toast dependency today.
- The button visually disappears once the row's state is no longer ACKNOWLEDGED (driven by the existing `useIncidentDetailSocket` subscription; the row cache mutation IS the optimistic surface via the existing `incident:state_changed` event).
- The body of the existing `<IncidentDetailActions />` (added in 4.5) gains the Assign button alongside the Acknowledge button — same parent component, same visibility gate, separate `useMutation` instance. Both buttons render inside the existing `data-testid="incident-detail-actions"` region; per-button testids disambiguate (`incident-detail-acknowledge-button`, `incident-detail-assign-button`).
- The `assignee_user_id` value is sourced from a small static lookup of seeded Technician ids (the 6-user seed in Story 4.2 AC10 enumerates `TECH_ID` / `OTHER_TECH_ID`). v1 does NOT ship a server-side user lookup or a fuzzy search — pick one of the seeded Technicians via a minimal `<select>` (or radio group) rendered alongside the button in an inline form. Inline form is simpler than a modal: no focus trap, no portal, no escape handling, fewer tests, and aligns with the operator's "I'm assigning to Tech X" mental model.

**Ask First:**

- None. The action surface, RBAC, error UX, and inline-form-vs-modal choice are all pinned by existing patterns (4.1 + 4.2 + 4.4 + 4.5). The seed-Technician lookup is a temporary v1 simplification documented as deferred work for post-Epic-4 cleanup.

**Never:**

- Optimistic UI for the mutation. Server is authoritative; the cache mutation IS the optimistic surface via the existing `incident:state_changed` subscription (same as 4.5).
- A Kanban card-level button. 4.4 design notes are explicit.
- A new toast library. The codebase has none; the existing `toast.tsx` primitive from 4.5 is reused verbatim.
- A new shared `useAssignMutation` hook. 4.6 is the only consumer today; abstracting prematurely is YAGNI. Stories 4.7 / 4.11 each ship their own one-shot mutation on the detail page; the extraction is a future cleanup (matches 4.5's "no premature extraction" decision).
- A modal. An inline form below the Assign button is simpler and matches 4.5's "Acknowledge is one click; no confirmation" pattern — assign is two clicks (open inline form → pick tech → click Assign) which is the minimum friction for the verb.
- A `confirm` dialog. Assignment is reversible (reassign or 4.7 submit-result changes ownership).

## I/O & Edge-Case Matrix

| Scenario                            | Input / State                                                                                                                             | Expected Output / Behavior                                                                                                                                                                                                                            | Error Handling                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `HAPPY_PATH`                        | ACKNOWLEDGED incident + Admin/Operator viewer + inline-form Technician selected                                                           | Button visible, enabled. Click → POST 200 with `{ assignee_user_id }` body → toast "Technician assigned" → row re-fetched via cache invalid → socket event lands → row shows `state: "INSPECTING"`, `assignee_user_id` populated → button disappears. | N/A                                       |
| `NOT_OPEN` (sic — non-ACKNOWLEDGED) | Incident in any state ≠ ACKNOWLEDGED (OPEN, INSPECTING, SAFE, UNSAFE, MONITORING, RESOLVED, REOPENED)                                     | Button not rendered (gated by `actionSlotsFor` returning no `assign` slot). The Acknowledge button may still be visible for OPEN rows (separate gate).                                                                                                | N/A                                       |
| `RBAC_DENIED`                       | ACKNOWLEDGED incident + Technician or Viewer viewer                                                                                       | Button not rendered (gated by `actionSlotsFor` — both roles return no `assign` slot for ACKNOWLEDGED).                                                                                                                                                | N/A                                       |
| `MUTATION_IN_FLIGHT`                | User clicks Assign twice in quick succession                                                                                              | First click fires POST; button becomes disabled (in-flight state). Second click is a no-op (button is `disabled`).                                                                                                                                    | N/A                                       |
| `CONFLICT_409`                      | Server returns 409 `invalid_state_transition` (row was already assigned / state moved past ACKNOWLEDGED between page load and click)      | Error toast "Already assigned" (or "State changed" depending on the response shape — see `classifyAssignError`). Row cache invalidated; on next fetch the row shows `INSPECTING`. Button disappears.                                                  | Toast; no row revert.                     |
| `FORBIDDEN_403`                     | Server returns 403 (token role drift between page load and click — viewer lost Admin/Operator)                                            | Error toast "Not authorized". Row cache invalidated; on next fetch, page renders `<RbacDenied />`.                                                                                                                                                    | Toast → re-render to RBAC denied surface. |
| `NOT_FOUND_404`                     | Server returns 404 (incident deleted between page load and click OR assignee user id does not exist — server returns 404 via P2003 catch) | Error toast "Incident not found" (or "Technician not found" — see `classifyAssignError`). Row cache invalidated; page renders `<NotFound />`.                                                                                                         | Toast → re-render to NotFound surface.    |
| `SERVER_ERROR_500`                  | Server returns 500                                                                                                                        | Error toast "Failed to assign. Try again." Button re-enables (mutation error state).                                                                                                                                                                  | Toast; manual retry.                      |
| `SOCKET_EVENT`                      | `incident:state_changed` arrives during/after the mutation                                                                                | Row cache updates via the existing `useIncidentDetailSocket` subscriber. Button re-renders based on the new state. No double-update race — TanStack Query reconciles the invalidate + the socket mutation.                                            | N/A                                       |
| `TOKEN_EXPIRED_401`                 | Server returns 401 (`apiFetch`'s internal refresh has failed — operator is effectively signed out)                                        | Error toast "Session expired — please sign in again". Row cache NOT invalidated (5xx-class semantics; the operator must re-auth before any further action). Button re-enables.                                                                        | Toast; no row revert; manual re-auth.     |
| `NO_TECH_SELECTED`                  | User clicks Assign before picking a Technician from the inline form                                                                       | Button is disabled (no Technician selected). No POST fires.                                                                                                                                                                                           | N/A                                       |
| `BODY_VALIDATION`                   | Server returns 400 (request body fails Zod validation — defensive only; client should not produce this)                                   | Error toast "Invalid request". Row cache invalidated (4xx branch).                                                                                                                                                                                    | Toast; row re-fetch surfaces truth.       |

</frozen-after-approval>

## Code Map

**Web (`packages/web/`):**

- `incidents/useAssignMutation.ts` — NEW. TanStack `useMutation` that wraps `apiFetch("/api/incidents/:id/assign", { method: "POST", body: JSON.stringify({ assignee_user_id }) })`. Returns `{ mutate, isPending, error }`. On success: invalidate `incidentDetailQueryKey(id)`. On 4xx: also invalidate `incidentDetailQueryKey(id)`. On 5xx / network throw: do NOT invalidate (row presumed unchanged; manual retry). The hook MUST catch throws from `apiFetch` and surface them as classified `AssignMutationError` so `onError`'s status range check never reads `undefined`. Mirrors `useAcknowledgeMutation.ts:172-228` line for line, swapping the toast copy from "Acknowledged" / "Failed to acknowledge" to "Technician assigned" / "Failed to assign".
- `incidents/IncidentDetailActions.tsx` — MODIFY. Extend with Assign control alongside the existing Acknowledge button. Add `isAssignPending` and `onAssign(assigneeUserId)` props. Inline `<select>` of seeded Technician ids (sourced from a tiny `SEEDED_TECHNICIAN_IDS` constant exported from the same file or from a new `seededTechnicians.ts`) plus an Assign button. The Assign control renders ONLY when `actionSlotsFor` includes the `assign` slot; the Acknowledge button renders ONLY when the slot includes `acknowledge`. Both gates consume the SAME `actionSlotsFor` helper — single source of truth (no inline role checks). Per-button disabled state threads through `isAckPending` / `isAssignPending` props. The `<select>` defaults to `""` (no selection); the Assign button is disabled while `selectedAssignee === ""` OR `isAssignPending`.
- `incidents/IncidentDetailPage.tsx` — MODIFY. Mount `useAssignMutation(id)` alongside `useAcknowledgeMutation`. Wire `handleAssign(assigneeUserId)` that calls `assignMutation.mutate(assigneeUserId, { onSuccess → pushToast("success", "Technician assigned"), onError → pushToast("error", err.message) })`. Thread `isAssign={assignMutation.isPending}` and `onAssign={handleAssign}` through `IncidentDetailDispatch` → `IncidentDetailBody` → `<IncidentDetailActions />`.
- `incidents/IncidentDetailPage.spec.tsx` — MODIFY. Extend with ~6 assign tests at the page integration level: HAPPY_PATH, NOT_OPEN (button absent for OPEN row), RBAC_DENIED (Technician viewer), MUTATION_IN_FLIGHT (button disabled during mutate + no double-fire), CONFLICT_409 (toast + row reconciles to INSPECTING), SERVER_ERROR_500 (toast + button re-enables). Use the existing `renderDetail(role)` rig.
- `incidents/IncidentDetailActions.spec.tsx` — MODIFY. Extend the visibility matrix to add ACKNOWLEDGED + Operator → both buttons visible; ACKNOWLEDGED + Technician → no buttons (the slot matrix says Technician returns `[]` for ACKNOWLEDGED); ACKNOWLEDGED + Viewer → no buttons. Also add OPEN + Operator → only Acknowledge visible (no Assign — verifies the gate is per-slot, not per-role). The existing 4.5 cases stay unchanged.
- `incidents/seededTechnicians.ts` — NEW. Tiny constant export `SEEDED_TECHNICIAN_IDS = [TECH_ID, OTHER_TECH_ID]` (the two Technician ids from `packages/api/src/incidents/router.spec.ts:39-40`). Hardcoded UUID strings; no fetch. Documented as v1 simplification; deferred to post-Epic-4 cleanup (a `/api/users?role=Technician` lookup + a search input).

**Shared (`packages/shared/`):**

- No changes. `ActionVerbSchema` at `incident.ts:114-121` already includes `"assign"`.

**Backend (`packages/api/`):**

- No changes. `POST /api/incidents/:id/assign` exists at `router.ts:354-358` with full RBAC (Admin + Operator via `RBAC_ACTION_BY_VERB.assign`), audit, state-machine (OPEN | ACKNOWLEDGED → INSPECTING), and `incident:state_changed` emit. Body schema validates `{ assignee_user_id: string.uuid() }` (verified by `router.spec.ts:332` happy path + `:362-365` 400 negative). The mutation is a thin client over this existing endpoint.

## Tasks & Acceptance

**Execution:**

- [ ] 1. Write spec doc (this file). Status: draft → ready-for-dev.
- [ ] 2. Create `packages/web/src/incidents/seededTechnicians.ts` with `SEEDED_TECHNICIAN_IDS` constant.
- [ ] 3. Create `packages/web/src/incidents/useAssignMutation.ts` mirroring `useAcknowledgeMutation.ts` (4xx invalidates; 5xx + network throw do not; `AssignMutationError` tagged class; status 0 sentinel).
- [ ] 4. Extend `IncidentDetailActions.tsx` with the Assign inline form (Technician `<select>` + Assign button), gated by `actionSlotsFor` returning the `assign` slot. Existing Acknowledge button logic stays untouched.
- [ ] 5. Extend `IncidentDetailActions.spec.tsx` visibility matrix: ACKNOWLEDGED + Operator → both buttons visible; OPEN + Operator → only Acknowledge; ACKNOWLEDGED + Technician → nothing.
- [ ] 6. Extend `IncidentDetailPage.tsx` to mount `useAssignMutation`, define `handleAssign`, thread `isAssign` + `onAssign` props through Dispatch → Body → Actions.
- [ ] 7. Extend `IncidentDetailPage.spec.tsx` with 6 assign-flow tests (HAPPY_PATH, NOT_OPEN, RBAC_DENIED, MUTATION_IN_FLIGHT, CONFLICT_409, SERVER_ERROR_500).
- [ ] 8. Run `pnpm -F @surakkha/web test`, `pnpm -r typecheck`. All green.
- [ ] 9. Lint-fix + commit + sync sprint-status (mark 4-6 done).

**Acceptance Criteria:**

1. The Assign button renders on `/incidents/:id` for an ACKNOWLEDGED incident viewed by Admin or Operator. Pinned in `IncidentDetailActions.spec.tsx`.
2. The Assign button does NOT render when the row's state is not ACKNOWLEDGED, regardless of viewer role. Pinned in `IncidentDetailActions.spec.tsx`.
3. The Assign button does NOT render for a Technician or Viewer viewer of an ACKNOWLEDGED incident. Pinned in `IncidentDetailActions.spec.tsx`.
4. The Assign button is disabled until a Technician is selected from the inline form. Pinned in `IncidentDetailPage.spec.tsx` (HAPPY_PATH pre-condition).
5. Clicking the Assign button with a Technician selected fires `POST /api/incidents/:id/assign` exactly once; double-clicks are no-ops (button is disabled while in flight). Pinned in `IncidentDetailPage.spec.tsx` (HAPPY_PATH + MUTATION_IN_FLIGHT).
6. On 200: a success toast appears, the row cache is invalidated, and the `incident:state_changed` socket event drives the cache mutation. The row shows `state: "INSPECTING"` and `assignee_user_id` populated. The button disappears (the `assign` slot returns null for INSPECTING). Pinned in `IncidentDetailPage.spec.tsx`.
7. On 409 (`invalid_state_transition`): an error toast appears; row cache invalidated; on next fetch the row shows `INSPECTING` and the button disappears. Pinned in `IncidentDetailPage.spec.tsx`.
8. On 403 (`forbidden`): an error toast appears; row cache invalidated; on next fetch the page renders `<RbacDenied />`. Pinned in `IncidentDetailPage.spec.tsx`.
9. On 404: an error toast appears; on next fetch the page renders `<NotFound />`. Pinned in `IncidentDetailPage.spec.tsx`.
10. On 401 (token refresh exhausted): an error toast "Session expired — please sign in again" appears; row cache NOT invalidated; button re-enables. Pinned in `IncidentDetailPage.spec.tsx`.
11. On 500 / network throw: an error toast "Failed to assign. Try again." appears; row cache NOT invalidated; button re-enables. Pinned in `IncidentDetailPage.spec.tsx`.

## Design Notes

**Why an inline form, not a modal.** Acknowledge is a one-click verb — the existing 4.5 button fires immediately. Assign is a two-action verb: pick a Technician, then fire. The simplest UI for "pick then fire" is an inline `<select>` next to the Assign button — no portal, no focus trap, no escape handling, no modal testid pattern. Modals are warranted for irreversible actions (destructive deletes, payment confirmations); reassignment is reversible (4.7 reassigns via submit-result path, 4.11 can re-open), so the friction of a modal is unjustified. Future post-Epic-4 cleanup can swap the inline form for a server-backed `<TechnicianPicker />` if a user-management endpoint ships.

**Why a hardcoded `SEEDED_TECHNICIAN_IDS` constant, not a fetch.** v1 has no `/api/users?role=Technician` endpoint. Sourcing from the seed script's documented UUIDs (TECH_ID + OTHER_TECH_ID) keeps the assign UI testable end-to-end without inventing a new backend route. Documented as deferred work for the post-Epic-4 cleanup that adds the user-management surface.

**Why `useAssignMutation` mirrors `useAcknowledgeMutation` line-for-line, not a shared factory.** Same rationale as 4.5: each mutation has its own toast copy, its own URL, and its own per-verb semantics. The duplication is ~50 lines per hook × 4 hooks (4.5 + 4.6 + 4.7 + 4.11) = ~200 lines, which is well below the threshold where a factory would start paying for itself. The future post-Epic-4 sweep extracts a `useIncidentMutation({ verb, body })` factory once the pattern stabilizes.

**Why the Assign control sits in the same `<IncidentDetailActions />` as the Acknowledge button.** Both buttons share the same `actionSlotsFor` gate and the same visibility matrix (both Admin + Operator, both rendered inside the body between `<dl>` and the audit timeline). Splitting them into two siblings would duplicate the gate logic and force two parent components to coordinate state. The 4.5 design note "extracting the action surface today keeps the body component under the lint `max-lines-per-function: 200` ceiling" applies equally to 4.6 — the per-action visibility test stays trivial (mount one component, assert presence / absence per slot).

**Why `onError` invalidates 4xx but not 5xx (mirroring 4.5 exactly).** A 409 means another operator assigned between page load and click — the row is now in a non-ACKNOWLEDGED state and the next fetch surfaces that, which hides the button. A 404 means the row was deleted (or the assignee doesn't exist) — the next fetch surfaces `<NotFound />`. A 403 means a token/role drift — the next fetch surfaces `<RbacDenied />`. All three are the **same class of "the world moved on; tell me the new truth"** event, so all three invalidate the row query. A 5xx (or network throw) is **the world is unchanged but the call failed** — invalidating would trigger a redundant refetch and the operator's manual retry would race with it. Preserving the stale row for retry is the correct UX.

**Why 401 is classified explicitly, not folded into "try again."** `apiFetch` auto-refreshes the access token on 401 internally, so a 401 reaching `useAssignMutation` means the refresh itself failed (the user is signed out). The toast copy must reflect this — "Session expired — please sign in again" — instead of the generic retryable bucket, which would prompt the operator to click a button that will never succeed.

**Why `assignee_user_id` is the only body field (not `assigneeUserId` camelCase).** The server's Zod schema (`transitionHelpers.ts:317`) reads `body["assignee_user_id"]` — snake_case to match the rest of the wire contract (`IncidentPayloadSchema` uses snake_case keys). Client mirrors server: snake_case in the request body. The mutation hook's `body` parameter is `{ assignee_user_id: string }` (snake_case), not `{ assigneeUserId }`.

## Verification

**Commands:**

- `pnpm -F @surakkha/web test` — expected: existing 318 + ~10 new (~6 IncidentDetailActions visibility + ~4 IncidentDetailPage assign flow — page-level MUTATION_IN_FLIGHT and CONFLICT_409 are the highest-value pins) green.
- `pnpm -F @surakkha/api test` — expected: green (no backend changes; existing assign endpoint coverage at `router.spec.ts:329-337` happy path + `:362-365` body-validation negative).
- `pnpm -r typecheck` — expected: clean.

**Manual checks (if no CLI):**

- Boot api + web; seed incidents (per RUNBOOK.md §4); navigate to `/incidents`; click an OPEN card → land on `/incidents/:id`; click Acknowledge; verify state flips to ACKNOWLEDGED.
- Reload (or wait for the socket event); verify the Assign button appears in the actions region (alongside no Acknowledge button).
- Pick a Technician from the inline `<select>`; click Assign. Verify: success toast appears for ~4s; row's state pill flips to "INSPECTING"; `assignee_user_id` populates; both action buttons disappear.
- Verify: a separate browser tab on `/incidents` Kanban sees the card move to the ACKNOWLEDGED column (the projection rules INSPECTING onto ACKNOWLEDGED per `projectKanbanColumn` at `incident.ts:81-96`).
- Switch role to Viewer (or log in as Technician). Verify: button does NOT render on an ACKNOWLEDGED incident.
- Curl the row's state to INSPECTING manually. Verify: detail page's Assign button disappears on the next socket event.

## Suggested Review Order

**Spec**

- Story 4.6 spec — intent, AC matrix, design notes (read first; mirrors 4.5's structure).
  [`spec-4-6-assign-technician-inspecting-transition.md:16`](spec-4-6-assign-technician-inspecting-transition.md#L16)
