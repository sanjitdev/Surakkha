---
title: "Story 4.5 — Acknowledge Flow (Operator One-Click)"
type: "feature"
created: "2026-08-28"
status: "done"
review_loop_iteration: 0
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

</frozen-after-approval>

## Code Map

**Web (`packages/web/`):**

- `incidents/IncidentDetailPage.tsx` — add `useAcknowledgeMutation` inline (TanStack `useMutation`) + new `<IncidentDetailActions />` child component (renders the Acknowledge button or nothing). Wire into `<IncidentDetailBody />` after the `<dl>`. The detail page's existing dispatch already handles row state; this adds a write-side parallel.
- `incidents/useAcknowledgeMutation.ts` — NEW. TanStack `useMutation` that wraps `apiFetch("/api/incidents/:id/acknowledge", { method: "POST" })`. Exposes `{ mutate, isPending, error }`. On success: invalidate `incidentDetailQueryKey(id)`. On error: classifies 4xx (tagged toast) vs 5xx (retry-able toast).
- `incidents/IncidentDetailPage.spec.tsx` — extend `renderDetail` to accept `initialRole`. Add ~6 new tests: HAPPY_PATH, NOT_OPEN (button absent for ACKNOWLEDGED row), RBAC_DENIED (Technician viewer), MUTATION_IN_FLIGHT (button disabled during mutate), CONFLICT_409 (toast + row reconciled), NOT_FOUND_404 (toast + NotFound renders), SERVER_ERROR_500 (toast + button re-enabled).
- `incidents/IncidentDetailActions.spec.tsx` — NEW. ~3 unit tests for the button's visibility logic (OPEN + Operator → visible; OPEN + Technician → not; ACKNOWLEDGED + Operator → not).
- `incidents/toast.ts` — NEW. Tiny `useToasts()` hook + `<ToastRegion />` renderer (mirrors `ThresholdsPage.tsx:56-69` + `ThresholdsPopulatedView.tsx:18-23`). `<ToastRegion />` is mounted by `IncidentDetailPage` at the page root.
- `incidents/toast.spec.ts` — NEW. ~3 tests: TTL expiry, success vs error tones, no toast region → no DOM.

**Shared (`packages/shared/`):**

- No changes. `ActionVerbSchema` at `incident.ts:114-121` already includes `"acknowledge"`.

**Backend (`packages/api/`):**

- No changes. `POST /api/incidents/:id/acknowledge` exists at `router.ts:349-353` with full RBAC + audit + state-machine enforcement. The mutation is a thin client over this existing endpoint.

## Tasks & Acceptance

**Execution:**

- [x] 1. Write spec doc (this file). Status: draft.
- [x] 2. Create `packages/web/src/incidents/toast.ts` with `useToasts()` hook + `<ToastRegion />` (mirrors ThresholdsPage inlined pattern).
- [x] 3. Add `toast.spec.ts` (3 cases: TTL, tones, mount/unmount).
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
7. On 404: an error toast appears; on next fetch the page renders `<NotFound />`. Pinned in `IncidentDetailPage.spec.tsx`.
8. On 500: an error toast appears; the button re-enables (manual retry). Pinned in `IncidentDetailPage.spec.tsx`.

## Spec Change Log

_Empty until the first bad_spec loopback._

## Design Notes

**Why a button on the detail page only (not the Kanban).** 4.4 design notes are explicit that the Kanban is the "what do I need to work on next" surface — it routes to the detail page via `onClick`, where the explicit action workflow lives. Adding a Kanban-level button violates that flow and creates a UX ambiguity (click card = open detail; click button = ack?). Operator ergonomics win: one click on the Kanban → one click on the detail page button = two clear intentional steps. 4.5 honors this.

**Why no optimistic UI.** Story 4.4's design notes: "Optimistic UI for socket-driven state changes. The server is authoritative; cache mutation IS the optimistic surface." The mutation handler invalidates the row query; the `incident:state_changed` socket event is the source of truth for cache mutation; both update from the same event. There's no place for a separate optimistic path without violating the contract.

**Why inline toast, not a library.** The codebase has no toast dependency. `ThresholdsPage.tsx:56-69` + `ThresholdsPopulatedView.tsx:18-23` ship an inline `pushToast` pattern with `setTimeout` cleanup and a `<ToastRegion />` renderer. This story mirrors it in a tiny `toast.ts` module so Stories 4.6 / 4.7 / 4.11 can reuse. Extracting to a shared `<ToastRegion />` across all pages is a future epic-6 sweep — premature here.

**Why `actionSlotsFor` (Story 4.1 contract) is the gate, not a role check inline.** The detail page already imports `SEVERITY_DOT_BG`, `SEVERITY_LABEL`, `STATE_LABEL` from `KanbanCard.tsx` (4.4 design notes: "classnames + testids mirror `KanbanCard.tsx` conventions"). Extending the same principle to the action affordance: the visibility gate is `actionSlotsFor(incident, viewerRole)`, the same single source of truth that Kanban cards will eventually consume. A future story that ships card-level buttons on the Kanban (out of scope here) reuses this contract verbatim.

**Why not extract `useAcknowledgeMutation` as a generic hook.** 4.5 is the only consumer today. Stories 4.6 (assign), 4.7 (submit-result), 4.11 (reopen) each ship their own mutation; abstracting prematurely creates three near-duplicate hooks with shared boilerplate. The future cleanup (one shared `useIncidentMutation({ verb })` factory) is deferred to a post-epic-4 sweep.

## Verification

**Commands:**

- `pnpm -F @surakkha/web test` — expected: existing 297 + ~9 new (3 toast + 3 actions + 6 detail-page ack-flow − 3 already-pinned duplicate cases) green.
- `pnpm -r typecheck` — expected: clean.

**Manual checks (if no CLI):**

- Boot api + web; seed incidents (per RUNBOOK.md §4); navigate to `/incidents`; click an OPEN card → land on `/incidents/:id`.
- Verify the Acknowledge button appears in the header (right side).
- Click it. Verify: success toast appears for ~4s; row's state pill flips to "ACKNOWLEDGED"; button disappears.
- Verify: a separate browser tab on `/incidents` Kanban sees the card move to the ACKNOWLEDGED column within ~1s (the same socket event drives both).
- Switch role to Viewer via the role selector (or log in as a Technician). Verify: button does NOT render on an OPEN incident.
- Curl the row's state to ACKNOWLEDGED manually. Verify: detail page's button disappears on the next socket event.
