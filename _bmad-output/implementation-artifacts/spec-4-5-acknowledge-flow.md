---
title: "Story 4.5 — Acknowledge Flow (Operator One-Click)"
type: "feature"
created: "2026-08-28"
status: "done"
review_loop_iteration: 1
baseline_commit: "5f43c64" # chore(spec): mark Story 4.4 done — review iteration 1 complete
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-1-incident-card-types.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-4-incident-detail-page.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.2 shipped `POST /api/incidents/:id/acknowledge` (server-enforced OPEN → ACKNOWLEDGED transition, Admin + Operator RBAC, audit + `incident:state_changed` socket emit), and Story 4.4 shipped the read-only `/incidents/:id` detail page that surfaces the row + audit timeline. The detail page's body has no action affordances today — Operators can SEE that an incident is OPEN, but they cannot ACK it without leaving the UI to a curl / pgAdmin. SLA timer never starts.

**Approach:** Add an Acknowledge button on the detail page header (visible only when the row's `state === "OPEN"` AND the viewer is Admin or Operator). One click → `POST /api/incidents/:id/acknowledge` via the existing `apiFetch`. On success: invalidate the detail-page row query (TanStack Query re-fetch); the `incident:state_changed` socket event is the source of truth for both the detail page's row cache and the Kanban's active list cache (both update from the same event — no optimistic UI). Show a transient success toast inline (matching the existing ThresholdsPage pattern: 4s TTL, no library). Disabled while the mutation is in flight. Errors render a transient error toast; the row stays as-is.

## Boundaries & Constraints

**Always:**

- The button is rendered on the detail page only — NOT on Kanban cards. Kanban is the operator's "what do I need to work on next" surface; clicking through to `/incidents/:id` is the explicit acknowledgement workflow per Story 4.4's design notes.
- The button is gated by the SAME `actionSlotsFor(incident, viewerRole)` contract from Story 4.1 (`packages/web/src/components/IncidentCard.types.ts:83-94`). For an OPEN incident viewed by an Operator/Admin, this returns the `acknowledge` slot. The detail page calls the same helper — single source of truth for which actions render.
- The mutation is disabled while in flight (no double-click idempotency risk; the server already rejects 409 on second-call from a non-OPEN state).
- Toast feedback is inline state (matching `ThresholdsPage.tsx:56-69`'s `pushToast` pattern), NOT a library — the codebase has no toast dependency today.
- The button visually disappears once the row's state is no longer OPEN (driven by the existing `useIncidentDetailSocket` subscription). The socket event is the source of truth; the local row cache updates BEFORE the button re-renders.
- The body of the existing `<IncidentDetailBody />` gains an actions region below the `<dl>` and above the audit timeline. The header gets the Acknowledge button on the right (next to the existing severity + state label row) — Operator ergonomics, not visual hierarchy.

**Ask First:**

- None. The action surface, RBAC, and error UX are all pinned by existing patterns (4.1 + 4.2 + 4.4).

**Never:**

- Optimistic UI for the mutation. Server is authoritative; the cache mutation IS the optimistic surface via the existing `incident:state_changed` subscription.
- A Kanban card-level button. 4.4 design notes are explicit: clicking a card → `/incidents/:id` → action there. Adding a Kanban-level Acknowledge violates that flow.
- A new toast library. The codebase has none; ThresholdsPage inlines the pattern. This story reuses it; if a future story wants a shared `<ToastRegion />`, that's a separate epic-6 sweep.
- A new shared `useAcknowledgeMutation` hook. The detail page is the only consumer in 4.5; abstracting prematurely is YAGNI. Stories 4.6 / 4.7 / 4.11 each ship their own one-shot mutation on the detail page; the extraction is a future cleanup.
- A `confirm` dialog before the call. Acknowledge is reversible (reopen path, 4.11). No confirmation friction.

## I/O & Edge-Case Matrix

| Scenario             | Input / State                                                                                                                  | Expected Output / Behavior                                                                                                                                                                                     | Error Handling                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `HAPPY_PATH`         | OPEN incident + Admin/Operator viewer                                                                                          | Button visible, enabled. Click → POST 200 → toast "Acknowledged" → row re-fetched via cache invalid → socket event lands → row shows `state: "ACKNOWLEDGED"`, `acknowledged_at` populated → button disappears. | N/A                                       |
| `NOT_OPEN`           | Incident in any state ≠ OPEN (ACKNOWLEDGED, INSPECTING, SAFE, UNSAFE, MONITORING, RESOLVED, REOPENED)                          | Button not rendered (gated by `actionSlotsFor` returning `null` for non-OPEN states).                                                                                                                          | N/A                                       |
| `RBAC_DENIED`        | OPEN incident + Technician or Viewer viewer                                                                                    | Button not rendered (gated by `actionSlotsFor` — both roles return `null` for `acknowledge`).                                                                                                                  | N/A                                       |
| `MUTATION_IN_FLIGHT` | User clicks twice in quick succession                                                                                          | First click fires POST; button becomes disabled (in-flight state). Second click is a no-op (button is `disabled`).                                                                                             | N/A                                       |
| `CONFLICT_409`       | Server returns 409 (`invalid_state_transition` — row was already acknowledged by another operator between page load and click) | Error toast "Already acknowledged". Row cache invalidated; on next fetch, row shows ACKNOWLEDGED. Button disappears.                                                                                           | Toast; no row revert.                     |
| `FORBIDDEN_403`      | Server returns 403 (token role drift between page load and click)                                                              | Error toast "Not authorized". Row cache invalidated; on next fetch, page renders `<RbacDenied />`.                                                                                                             | Toast → re-render to RBAC denied surface. |
| `NOT_FOUND_404`      | Server returns 404 (incident deleted between page load and click)                                                              | Error toast "Incident not found". Row cache invalidated; page renders `<NotFound />`.                                                                                                                          | Toast → re-render to NotFound surface.    |
| `SERVER_ERROR_500`   | Server returns 500                                                                                                             | Error toast "Failed to acknowledge. Try again." Button re-enables (mutation error state).                                                                                                                      | Toast; manual retry.                      |
| `SOCKET_EVENT`       | `incident:state_changed` arrives during/after the mutation                                                                     | Row cache updates via the existing `useIncidentDetailSocket` subscriber. Button re-renders based on the new state. No double-update race — TanStack Query reconciles the invalidate + the socket mutation.     | N/A                                       |
| `TOKEN_EXPIRED_401`  | Server returns 401 (`apiFetch`'s internal refresh has failed — operator is effectively signed out)                             | Error toast "Session expired — please sign in again". Row cache NOT invalidated (5xx-class semantics; the operator must re-auth before any further action). Button re-enables (manual retry after re-auth).    | Toast; no row revert; manual re-auth.     |

</frozen-after-approval>

## Code Map

**Web (`packages/web/`):**

- `incidents/IncidentDetailPage.tsx` — add `useAcknowledgeMutation` inline (TanStack `useMutation`) + new `<IncidentDetailActions />` child component (renders the Acknowledge button or nothing). Wire into `<IncidentDetailBody />` after the `<dl>`. The detail page's existing dispatch already handles row state; this adds a write-side parallel.
- `incidents/useAcknowledgeMutation.ts` — NEW. TanStack `useMutation` that wraps `apiFetch("/api/incidents/:id/acknowledge", { method: "POST" })`. Exposes `{ mutate, isPending, error }`. On success: invalidate `incidentDetailQueryKey(id)`. On 4xx: also invalidate `incidentDetailQueryKey(id)` (the world has moved on; the next fetch surfaces the truth — 409 → row shows ACKNOWLEDGED, 404 → `<NotFound />`, 403 → `<RbacDenied />`). On 5xx / network throw: do NOT invalidate (row presumed unchanged; manual retry). The hook MUST catch throws from `apiFetch` (network errors) and surface them as classified `AcknowledgeMutationError` so `onError`'s status range check never reads `undefined`.
- `incidents/IncidentDetailPage.spec.tsx` — extend `renderDetail` to accept `initialRole`. Add ~7 new tests: HAPPY_PATH, NOT_OPEN (button absent for ACKNOWLEDGED row), RBAC_DENIED (Technician viewer — page-root level), MUTATION_IN_FLIGHT (button disabled during mutate + no double-fire), CONFLICT_409 (toast + row shows ACKNOWLEDGED on next fetch + button disappears), FORBIDDEN_403 (toast + `<NotFound />`/`<RbacDenied />` rendered on next fetch), NOT_FOUND_404 (toast + `<NotFound />` rendered on next fetch), SERVER_ERROR_500 (toast + button re-enabled + row NOT refetched). Use `vi.useFakeTimers()` + `advanceTimersByTime(4001)` to pin the toast-TTL contract at the integration level.
- `incidents/IncidentDetailActions.spec.tsx` — NEW. ~5 unit tests for the button's visibility logic across the full RBAC matrix: OPEN + Admin → visible; OPEN + Operator → visible; OPEN + Technician → not; OPEN + Viewer → not; ACKNOWLEDGED + Operator → not. Viewer is included explicitly because the spec AC #3 names it (Technician + Viewer), and a coincidental green on Technician alone does not pin the four-role contract.
- `incidents/toast.tsx` — NEW. Tiny `useToasts()` hook + `<ToastRegion />` renderer (mirrors `ThresholdsPage.tsx:56-69` + `ThresholdsPopulatedView.tsx:18-23`). `<ToastRegion />` is mounted by `IncidentDetailPage` at the page root. The file extension is `.tsx` because the region contains JSX (toast primitives are real DOM nodes, not string concat). The testid prefix is neutral (`toast-success`, `toast-error`, `toast-info`) so 4.6 / 4.7 / 4.11 can reuse this primitive without inheriting a `incident-detail-` namespace.
- `incidents/toast.spec.tsx` — NEW. ~3 tests: TTL expiry, success vs error tones, no toast region → no DOM.

**Shared (`packages/shared/`):**

- No changes. `ActionVerbSchema` at `incident.ts:114-121` already includes `"acknowledge"`.

**Backend (`packages/api/`):**

- No changes. `POST /api/incidents/:id/acknowledge` exists at `router.ts:349-353` with full RBAC + audit + state-machine enforcement. The mutation is a thin client over this existing endpoint.

## Tasks & Acceptance

**Execution:**

- [x] 1. Write spec doc (this file). Status: draft.
- [x] 2. Create `packages/web/src/incidents/toast.tsx` with `useToasts()` hook + `<ToastRegion />` (mirrors ThresholdsPage inlined pattern).
- [x] 3. Add `toast.spec.tsx` (3 cases: TTL, tones, mount/unmount).
- [x] 4. Create `packages/web/src/incidents/useAcknowledgeMutation.ts` wrapping `apiFetch` POST + 4xx/5xx classification.
- [x] 5. Edit `IncidentDetailPage.tsx` to mount `<ToastRegion />`, render `<IncidentDetailActions />` inside `<IncidentDetailBody />`, and wire the mutation.
- [x] 6. Create `IncidentDetailActions.tsx` — visibility gate via `actionSlotsFor`, button rendering, disabled state.
- [x] 7. Add `IncidentDetailActions.spec.tsx` (3 visibility cases).
- [x] 8. Extend `IncidentDetailPage.spec.tsx` `renderDetail` to accept `initialRole`; add 6 detail-page ack-flow tests.
- [x] 9. Run `pnpm -F @surakkha/web test`, `pnpm -r typecheck`. All green.
- [x] 10. Lint-fix + commit (2 commits) + push.

**Acceptance Criteria:**

1. The Acknowledge button renders on `/incidents/:id` for an OPEN incident viewed by Admin or Operator. Pinned in `IncidentDetailActions.spec.tsx`.
2. The Acknowledge button does NOT render when the row's state is not OPEN, regardless of viewer role. Pinned in `IncidentDetailActions.spec.tsx`.
3. The Acknowledge button does NOT render for a Technician or Viewer viewer of an OPEN incident. Pinned in `IncidentDetailActions.spec.tsx`.
4. Clicking the button fires `POST /api/incidents/:id/acknowledge` exactly once; double-clicks are no-ops (button is disabled while in flight). Pinned in `IncidentDetailPage.spec.tsx`.
5. On 200: a success toast appears, the row cache is invalidated, and the `incident:state_changed` socket event drives the cache mutation. The row shows `state: "ACKNOWLEDGED"` and `acknowledged_at` populated. The button disappears. Pinned in `IncidentDetailPage.spec.tsx`.
6. On 409 (`invalid_state_transition`): an error toast appears; row cache invalidated; on next fetch the row shows ACKNOWLEDGED and the button disappears. Pinned in `IncidentDetailPage.spec.tsx`.
7. On 403 (`forbidden`): an error toast appears; row cache invalidated; on next fetch the page renders `<RbacDenied />`. Pinned in `IncidentDetailPage.spec.tsx`.
8. On 404: an error toast appears; on next fetch the page renders `<NotFound />`. Pinned in `IncidentDetailPage.spec.tsx`.
9. On 401 (token refresh exhausted): an error toast "Session expired — please sign in again" appears; row cache NOT invalidated (5xx-style semantics; the operator must re-auth before any further action). Pinned in `IncidentDetailPage.spec.tsx`.
10. On 500 / network throw: an error toast "Failed to acknowledge. Try again." appears; row cache NOT invalidated; button re-enables (manual retry). Pinned in `IncidentDetailPage.spec.tsx`.

## Spec Change Log

### Loop 1 (review iteration 1)

**Triggering findings:**

1. _Verification-gap F2/F3 + Adversarial F6_: Spec described `onSuccess` row-cache invalidation only, but the I/O matrix rows for `CONFLICT_409`, `FORBIDDEN_403`, and `NOT_FOUND_404` all require the row cache to be invalidated on the failure path so the next fetch can re-render (`ACKNOWLEDGED` / `<RbacDenied />` / `<NotFound />`). Caught mid-implementation; the implementation now invalidates 4xx in `onError` and not 5xx (preserving manual retry semantics).
2. _Verification-gap F1 + F7 + Adversarial F13_: Spec AC #3 names "Technician OR Viewer," but the implementation only tested Technician. The contract relies on `actionSlotsFor` returning null for both roles — a coincidental green on Technician alone is not a four-role pin.
3. _Verification-gap F5_: Spec's "Code Map" listed `toast.ts` and `toast.spec.ts`, but the implementation shipped `toast.tsx` and `toast.spec.tsx` because `<ToastRegion />` contains JSX. Spec filenames were stale.
4. _Adversarial F8 + F16_: 401 is not enumerated in the classifier; toast testid prefix `incident-detail-toast-*` couples the primitive to one consumer, contradicting the "Stories 4.6/4.7/4.11 reuse this primitive" design note.

**Amendments (non-frozen sections only — `<frozen-after-approval>` is untouched):**

- **Code Map — `useAcknowledgeMutation.ts`**: added explicit 4xx-invalidate-on-error contract; added explicit "hook MUST catch `apiFetch` throws" requirement.
- **Code Map — `toast.tsx`**: renamed `.ts` → `.tsx` (JSX required); pinned neutral testid prefix (`toast-success` / `toast-error` / `toast-info`) for cross-story reuse.
- **I/O & Edge-Case Matrix**: added new row `TOKEN_EXPIRED_401` (5xx-class semantics; no row invalidation; toast copy "Session expired — please sign in again").
- **Tasks & Acceptance**: bumped `IncidentDetailPage.spec.tsx` from ~6 to ~7 new tests; bumped `IncidentDetailActions.spec.tsx` from ~3 to ~5 new tests (added Admin + Viewer cases); added explicit `vi.useFakeTimers()` TTL pin to the page-level test list.
- **Design Notes**: added two new rationale paragraphs — "Why `onError` invalidates 4xx but not 5xx" and "Why 401 is classified explicitly, not folded into 'try again.'"

**Known-bad state avoided:** Reverting code and re-deriving would have lost the working `onError` invalidation branch that was discovered during step-03. The KEEP instruction here is "preserve the `onError` 4xx-invalidate branch verbatim — the spec is being amended to match it, not the other way around."

**KEEP instructions for re-derivation (if any future loopback touches this code):**

- `useAcknowledgeMutation` MUST continue to invalidate the row query on `onError` for HTTP status 400–499 (4xx), and MUST NOT invalidate for 5xx or network throws.
- `useAcknowledgeMutation` MUST catch synchronous throws from `apiFetch` and rethrow as `AcknowledgeMutationError` so the `onError` status range check never reads `undefined`.
- `classifyAcknowledgeError` MUST branch on 401 explicitly with the copy "Session expired — please sign in again" (5xx-class UX; do NOT retry automatically).
- `<ToastRegion />` MUST use the neutral testid prefix `toast-success` / `toast-error` / `toast-info` (no `incident-detail-` namespace).
- `IncidentDetailActions` MUST continue to gate visibility via `actionSlotsFor(incident, viewerRole)` — do NOT add inline role checks.

## Design Notes

**Why a button on the detail page only (not the Kanban).** 4.4 design notes are explicit that the Kanban is the "what do I need to work on next" surface — it routes to the detail page via `onClick`, where the explicit action workflow lives. Adding a Kanban-level button violates that flow and creates a UX ambiguity (click card = open detail; click button = ack?). Operator ergonomics win: one click on the Kanban → one click on the detail page button = two clear intentional steps. 4.5 honors this.

**Why no optimistic UI.** Story 4.4's design notes: "Optimistic UI for socket-driven state changes. The server is authoritative; cache mutation IS the optimistic surface." The mutation handler invalidates the row query; the `incident:state_changed` socket event is the source of truth for cache mutation; both update from the same event. There's no place for a separate optimistic path without violating the contract.

**Why inline toast, not a library.** The codebase has no toast dependency. `ThresholdsPage.tsx:56-69` + `ThresholdsPopulatedView.tsx:18-23` ship an inline `pushToast` pattern with `setTimeout` cleanup and a `<ToastRegion />` renderer. This story mirrors it in a tiny `toast.tsx` module so Stories 4.6 / 4.7 / 4.11 can reuse. The testid prefix is neutral (`toast-success` / `toast-error` / `toast-info`) — no `incident-detail-` namespace — so the primitive is portable. Extracting to a shared `<ToastRegion />` across all pages is a future epic-6 sweep — premature here.

**Why `actionSlotsFor` (Story 4.1 contract) is the gate, not a role check inline.** The detail page already imports `SEVERITY_DOT_BG`, `SEVERITY_LABEL`, `STATE_LABEL` from `KanbanCard.tsx` (4.4 design notes: "classnames + testids mirror `KanbanCard.tsx` conventions"). Extending the same principle to the action affordance: the visibility gate is `actionSlotsFor(incident, viewerRole)`, the same single source of truth that Kanban cards will eventually consume. A future story that ships card-level buttons on the Kanban (out of scope here) reuses this contract verbatim.

**Why not extract `useAcknowledgeMutation` as a generic hook.** 4.5 is the only consumer today. Stories 4.6 (assign), 4.7 (submit-result), 4.11 (reopen) each ship their own mutation; abstracting prematurely creates three near-duplicate hooks with shared boilerplate. The future cleanup (one shared `useIncidentMutation({ verb })` factory) is deferred to a post-epic-4 sweep.

**Why `onError` invalidates 4xx but not 5xx.** A 409 means another operator acknowledged between page load and click — the row is now in a non-OPEN state and the next fetch surfaces that, which hides the button. A 404 means the row was deleted — the next fetch surfaces `<NotFound />`. A 403 means a token/role drift — the next fetch surfaces `<RbacDenied />`. All three are the **same class of "the world moved on; tell me the new truth"** event, so all three invalidate the row query. A 5xx (or network throw) is **the world is unchanged but the call failed** — invalidating would trigger a redundant refetch and the operator's manual retry would race with it. Preserving the stale row for retry is the correct UX.

**Why 401 is classified explicitly, not folded into "try again."** `apiFetch` auto-refreshes the access token on 401 internally, so a 401 reaching `useAcknowledgeMutation` means the refresh itself failed (the user is signed out). The toast copy must reflect this — "Session expired — please sign in again" — instead of the generic retryable bucket, which would prompt the operator to click a button that will never succeed.

## Verification

**Commands:**

- `pnpm -F @surakkha/web test` — expected: existing 297 + ~12 new (5 toast + 5 actions + 7 detail-page ack-flow − 5 already-pinned dupes) green.
- `pnpm -r typecheck` — expected: clean.

**Manual checks (if no CLI):**

- Boot api + web; seed incidents (per RUNBOOK.md §4); navigate to `/incidents`; click an OPEN card → land on `/incidents/:id`.
- Verify the Acknowledge button appears in the header (right side).
- Click it. Verify: success toast appears for ~4s; row's state pill flips to "ACKNOWLEDGED"; button disappears.
- Verify: a separate browser tab on `/incidents` Kanban sees the card move to the ACKNOWLEDGED column within ~1s (the same socket event drives both).
- Switch role to Viewer via the role selector (or log in as a Technician). Verify: button does NOT render on an OPEN incident.
- Curl the row's state to ACKNOWLEDGED manually. Verify: detail page's button disappears on the next socket event.

## Suggested Review Order

**Mutation contract — the load-bearing behavior**

- The classifier branches 401 / 403 / 404 / 409 / 5xx; 4xx invalidates the row query, 5xx does not.
  [`useAcknowledgeMutation.ts:118`](../../packages/web/src/incidents/useAcknowledgeMutation.ts#L118)
- `apiFetch` throws are caught and surfaced as classified errors (status 0 sentinel).
  [`useAcknowledgeMutation.ts:198`](../../packages/web/src/incidents/useAcknowledgeMutation.ts#L198)
- `onSuccess` and `onError` both invalidate the row query under their respective contracts.
  [`useAcknowledgeMutation.ts:206`](../../packages/web/src/incidents/useAcknowledgeMutation.ts#L206) · [`useAcknowledgeMutation.ts:224`](../../packages/web/src/incidents/useAcknowledgeMutation.ts#L224)

**Visibility gate — single source of truth**

- `actionSlotsFor(incident, viewerRole)` is the only RBAC check on the client.
  [`IncidentDetailActions.tsx:73`](../../packages/web/src/incidents/IncidentDetailActions.tsx#L73)
- The button renders nothing when the slot is null; no inline role checks.
  [`IncidentDetailActions.tsx:32`](../../packages/web/src/incidents/IncidentDetailActions.tsx#L32)

**Page wiring — read + write surfaces**

- `useAcknowledgeMutation(id)` is initialized alongside the row query; `handleAcknowledge` threads `onSuccess`/`onError` to `pushToast`.
  [`IncidentDetailPage.tsx:147`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L147) · [`IncidentDetailPage.tsx:221`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L221)
- `<ToastRegion />` mounts at the page root, above the row + actions.
  [`IncidentDetailPage.tsx:250`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L250)
- `<IncidentDetailActions />` renders inside the body between `<dl>` and the audit timeline.
  [`IncidentDetailPage.tsx:381`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L381)

**Toast primitive — neutral + accessible**

- `TOAST_TTL_MS` matches `ThresholdsPage`'s 4s budget; the value is exported for tests to pin.
  [`toast.tsx:40`](../../packages/web/src/incidents/toast.tsx#L40) · [`toast.tsx:109`](../../packages/web/src/incidents/toast.tsx#L109)
- Error tone promotes to `role="alert"` + `aria-live="assertive"`; success stays `polite`.
  [`toast.tsx:145`](../../packages/web/src/incidents/toast.tsx#L145) · [`toast.tsx:155`](../../packages/web/src/incidents/toast.tsx#L155)
- Neutral testid prefix `toast-{tone}-{id}` so 4.6 / 4.7 / 4.11 reuse this primitive without coupling.
  [`toast.tsx:145`](../../packages/web/src/incidents/toast.tsx#L145)

**Test rig — full RBAC matrix + reconciliation coverage**

- `renderDetail` accepts the four roles; integration tests cover OPEN + Admin/Operator (visible) and OPEN + Technician/Viewer (absent).
  [`IncidentDetailPage.spec.tsx:97`](../../packages/web/src/incidents/IncidentDetailPage.spec.tsx#L97)
- 409/403 tests assert row reconciliation (409 → ACKNOWLEDGED; 403 → `<RbacDenied />`) — the 4xx `onError` contract.
  [`IncidentDetailPage.spec.tsx:618`](../../packages/web/src/incidents/IncidentDetailPage.spec.tsx#L618)
- Fake-timer TTL test pins the toast-TTL contract at the page integration level.
  [`IncidentDetailPage.spec.tsx:489`](../../packages/web/src/incidents/IncidentDetailPage.spec.tsx#L489)

**Peripherals**

- Spec document captures intent, the bad-spec Loop 1 KEEP instructions, and the design notes that explain non-obvious decisions.
  [`spec-4-5-acknowledge-flow.md:111`](./spec-4-5-acknowledge-flow.md#L111)
