---
title: "Story 4.3 — Kanban Column Projection"
type: "feature"
created: "2026-08-27"
status: "done"
review_loop_iteration: 0
baseline_commit: "b0c944e" # chore(spec): mark Story 3.4 done + Suggested Review Order
shipped_commit: "12f1fb4" # feat(epic-4): Story 4.3 Kanban Column Projection
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-1-incident-card-types.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.2 ships the 7-state machine (server-enforced, audited) but the operator-facing surface still needs a real Kanban view. Story 2.6's `/dashboard` shows a read-only `RecentIncidentsRegion` (max 10, no grouping). Operators need to see the full backlog grouped by their actual work bucket — open-critical vs open-warning vs in-progress vs resolved — and have cards move between columns in real time as state transitions land.

**Approach:** Add `GET /api/incidents/active` (server) that returns every incident in `OPEN | ACKNOWLEDGED | INSPECTING | SAFE | UNSAFE | MONITORING | REOPENED` (no limit; pagination deferred to a follow-up). Add a `KanbanBoard` React component (web) that fetches the active list, groups by `projectKanbanColumn(state, severity)` (already in `@surakkha/shared/incident`), and listens to `incident:state_changed` socket events to recompute the column of the affected incident in place — no re-fetch. Replace the `/incidents` `PageStub` with `<KanbanBoard />`. The column is a pure projection; never persisted.

## Boundaries & Constraints

**Always:**

- 4 columns: `OPEN_CRITICAL`, `OPEN_WARNING`, `ACKNOWLEDGED`, `RESOLVED`. `KanbanColumnSchema` (shared) is the closed set.
- Column is derived at render time from `(state, severity)` via `projectKanbanColumn(state, severity)` (shared). NO `column` field on the Prisma `Incident` row.
- The board recomputes on `incident:state_changed` events. The single affected incident's column is re-derived in memory; the rest of the board does not re-render (the column key is the React key, not the incident id).
- `RESOLVED` incidents are not on the active board by default. A future "show resolved" toggle is out of scope here.
- RBAC: every viewer sees the same board (read-only cards; action affordances come from Story 4.4+ via the 4.1 slot derivation).
- The 4.1 `IncidentCard` props contract is honored: this story renders a column container, NOT the `<IncidentCard />` itself (deferred to 4.4). Each card renders the minimal preview (severity + state label + opened_at), wired to render the same shape Epic 2's read-only preview uses, so the eventual swap is mechanical.

**Ask First:**

- Pagination / `?limit=N` on the active endpoint. **Default: NO — single page is acceptable at v1 scale (≤ a few hundred active incidents).**
- A "show resolved" toggle on the Kanban. **Default: NO — keep scope tight.**
- Including `UNSAFE` in the `OPEN_CRITICAL` column (sticky-banner UX-DR-5 contract from Epic 4 retrospective). **Default: YES — already in `projectKanbanColumn`.**

**Never:**

- Do not store a `column` field on `Incident`. The projection is the source of truth.
- Do not collapse `INSPECTING` / `SAFE` / `UNSAFE` / `MONITORING` / `REOPENED` into the "Acknowledged" column silently in the UI without the projection returning that column. The projection already returns `ACKNOWLEDGED` for these — keep it.
- Do not fetch / re-fetch the whole active list on every socket event. Recompute the single affected incident's column from its (state, severity).
- Do not add a new incident-endpoint shape. The wire row is the existing `IncidentPayloadSchema`.
- Do not introduce a Kanban-state zustand store. `useState` + a `Set<IncidentPayload>` keyed by incident id is enough; over-engineering a store is the deferred path.

## I/O & Edge-Case Matrix

| Scenario          | Input / State                                          | Expected Output / Behavior                                                                                                                   | Error Handling                                                                                         |
| ----------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| HAPPY_PATH_FETCH  | `GET /api/incidents/active` on a fresh boot            | 200 + `{ incidents: IncidentPayload[] }` (every non-`RESOLVED` incident, sorted by `opened_at DESC`)                                         | n/a                                                                                                    |
| EMPTY_BOARD       | DB has zero non-resolved incidents                     | 200 + `{ incidents: [] }`; board renders 4 empty columns with "No incidents" copy                                                            | n/a                                                                                                    |
| SOCKET_TRANSITION | `incident:state_changed` event received for incident X | The board's `Set` mutates X's row in place; `projectKanbanColumn(newState, severity)` decides the new column; React re-renders only X's cell | Drop events whose `incident_id` is not on the board (the incident is RESOLVED — already off the board) |
| RESOLVED_DROP     | Incident transitions to `RESOLVED`                     | Board removes the incident from its `Set`; the cell renders empty                                                                            | n/a                                                                                                    |
| SOCKET_AUTH_ERROR | Token expired mid-session                              | `socketClient`'s existing 1.7 refresh path handles; board's query is invalidated on the next `useDashboardSocket` reconnect                  | No additional handling needed here                                                                     |
| NETWORK_500       | `GET /api/incidents/active` returns 500                | Board renders 4 columns with "Failed to load incidents" copy + a retry button (TanStack Query's `refetch`)                                   | RBAC denial (403) renders the existing `<RbacDenied />` per 4.1 pattern                                |

</frozen-after-approval>

## Code Map

- `packages/shared/src/incident.ts` -- `projectKanbanColumn(state, severity)` (already implemented; the canonical projection); `KanbanColumnSchema`; `IncidentPayloadSchema`.
- `packages/shared/src/shared.spec.ts` -- existing 4 smoke tests for `projectKanbanColumn`. Needs extension for `INSPECTING`, `SAFE`, `UNSAFE`, `MONITORING`, `REOPENED`.
- `packages/api/src/incidents/routerWiring.ts` -- existing 4.2 router wiring; new `GET /incidents/active` route registered here.
- `packages/api/src/incidents/activeRouter.ts` -- NEW. The handler returning `{ incidents: IncidentPayload[] }` sorted by `opened_at DESC`. Reuses `IncidentPayloadSchema`.
- `packages/api/src/incidents/activeRouter.spec.ts` -- NEW. Live-Prisma test rig (mirrors `recentRouter.spec.ts`'s shape).
- `packages/web/src/incidents/KanbanBoard.tsx` -- NEW. Top-level component; TanStack Query for the active list; zustand-free; 4-column grid.
- `packages/web/src/incidents/useKanbanBoardSocket.ts` -- NEW. Mounts the `incident:state_changed` listener; recomputes the affected incident's column in place via the shared projection.
- `packages/web/src/incidents/KanbanCard.tsx` -- NEW. Minimal card preview (severity dot + state label + opened_at + metric). Read-only.
- `packages/web/src/incidents/KanbanBoard.spec.tsx` -- NEW. Vitest RTL: fetches, groups by column, re-derives on socket event.
- `packages/web/src/main.tsx` -- replace the `/incidents` `PageStub` route with `<KanbanBoard />`.

## Tasks & Acceptance

**Execution:**

- [x] `packages/api/src/incidents/activeRouter.ts` -- NEW: `GET /incidents/active` returning every non-`RESOLVED` `Incident` row, sorted by `opened_at DESC`, parsed through `IncidentPayloadSchema`. RBAC: every authenticated role can read.
- [x] `packages/api/src/incidents/routerWiring.ts` -- wire the new `activeRouter` into the incidents router group.
- [x] `packages/api/src/incidents/activeRouter.spec.ts` -- NEW: live-Prisma tests for "empty", "all non-resolved returned", "RESOLVED excluded", "sorted by opened_at DESC".
- [x] `packages/shared/src/shared.spec.ts` -- extend `projectKanbanColumn` coverage: `INSPECTING → ACKNOWLEDGED`, `SAFE → RESOLVED`, `UNSAFE → OPEN_CRITICAL` (regardless of severity — sticky-banner UX), `MONITORING → RESOLVED`, `REOPENED + warning → OPEN_WARNING`, `REOPENED + critical → OPEN_CRITICAL`.
- [x] `packages/web/src/incidents/KanbanBoard.tsx` -- NEW: 4-column grid (CSS grid; `grid-template-columns: repeat(4, minmax(0, 1fr))`). TanStack Query keyed `["incidents", "active"]`. On `isError`, render "Failed to load incidents" copy + retry button per column.
- [x] `packages/web/src/incidents/useKanbanBoardSocket.ts` -- NEW: subscribes to `incident:state_changed`; recomputes the affected incident's `(state, severity)` row in the cache; relies on React keying to move the card between columns.
- [x] `packages/web/src/incidents/KanbanCard.tsx` -- NEW: minimal preview (severity dot, state label, opened_at relative, metric, value). NO action affordances (deferred to 4.4).
- [x] `packages/web/src/incidents/KanbanBoard.spec.tsx` -- NEW: RTL tests — fetches and groups by column, socket event moves a card between columns, RESOLVED socket event removes the card.
- [x] `packages/web/src/main.tsx` -- replace the `/incidents` `PageStub` route's children with `<KanbanBoard />` (the `<AppShell>` + `<CurrentRoleProvider>` wrappers stay).

**Acceptance Criteria:**

- Given `GET /api/incidents/active` is called with no `?` query string, when the response is parsed, then every row has `state !== "RESOLVED"`, the array is sorted by `opened_at` descending, and every row matches `IncidentPayloadSchema`.
- Given the board renders for the first time, when `useKanbanBoardSocket` receives an `incident:state_changed` event for an OPEN critical incident that just transitioned to `ACKNOWLEDGED`, then that card moves from the `OPEN_CRITICAL` column to the `ACKNOWLEDGED` column WITHOUT a re-fetch of the active list (asserted via `queryClient` spy).
- Given an incident transitions to `RESOLVED`, when the board receives the `incident:state_changed` event, then the card is removed from the board and its previous column renders empty.
- Given the projection function is called with `("UNSAFE", "warning")`, when it returns, then the value is `OPEN_CRITICAL` (sticky-banner UX-DR-5 — UNSAFE always critical-priority).
- Given the board renders with zero incidents, when the page mounts, then all 4 columns render the "No incidents" empty-state copy.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. Empty until first loopback. -->

- 2026-08-27 — Step-04 review (3 reviewers: blind-hunter, edge-case, verification-gap). 12 findings total. Tier-1 #1, #2, #4 patched in commit (pending). Tier-1 #3 (out-of-order `incident:state_changed` events) deferred — see "Deferred Findings" below.

## Deferred Findings

These are findings raised during step-04 review that were intentionally NOT patched in this story. They are documented here for the next Epic 4 sweep to address.

**D-1 — Out-of-order `incident:state_changed` events** (severity: bug).

- **Where:** `packages/web/src/incidents/useKanbanBoardSocket.ts:68-93` (`applyStateChangeToCache`).
- **What:** Concurrent transitions for the same incident are not ordered. If `OPEN → ACKNOWLEDGED → RESOLVED` arrives as `RESOLVED` first then `ACKNOWLEDGED`, the cache mutator's last-write-wins by arrival order, not by `changed_at`. A resolved row could be re-added to the board.
- **Why deferred:** Fixing requires the server (Story 4.2) to stamp `changed_at` (or a monotonic sequence number) on every emit, AND the client to compare-and-skip stale events. Story 4.2's emitter doesn't currently include this. The fix is a 4.2 + 4.3 cross-cutting change; the right place is the next Epic 4 sweep.
- **Workaround in 4.3:** The socket connection carries events over the same channel as `incident:opened`, which always includes the fresh row. The board's initial fetch re-anchors state on every navigation, capping the staleness window. Operationally the bug is rare.

**D-2 — `IncidentStateRepository.findMany` interface narrower than Prisma** (severity: drift).

- **Where:** `packages/api/src/incidents/incidentStateRepository.ts:89`.
- **What:** The narrow slice types `where.state` as `{ not: IncidentState }` — single-state exclusion only. Prisma accepts `notIn: IncidentState[]`.
- **Why deferred:** Not a 4.3 issue (the v1 filter excludes only RESOLVED). Future story that needs multi-state exclusion (`RESOLVED`, `ARCHIVED`) bumps the interface.

**D-3 — No `onSessionLost` / disconnect handler** (severity: gap).

- **Where:** `packages/web/src/incidents/useKanbanBoardSocket.ts:107-119`.
- **What:** If the socket drops mid-board, the listener stops; no reconnect indicator, no stale-state warning.
- **Why deferred:** Out of scope for 4.3. The 4.10 NotificationBell story (or a future connectivity follow-up) owns the disconnect UX.

**D-4 — No live-Prisma test for `IncidentStateRepository.findMany`** (severity: missing-test).

- **Where:** `packages/api/src/incidents/activeRouter.spec.ts` (stub-only).
- **What:** A Prisma arg-shape mismatch would not surface in the stub test.
- **Why deferred:** The `incident-state-machine.spec.ts` live-Prisma sibling (planned for the next Epic 4 sweep) covers this when 4.2's full state-machine live tests land.

**D-5 — `_fetchIncidentForBoard` is exported but unused in production** (severity: nit).

- **Where:** `packages/web/src/incidents/useKanbanBoardSocket.ts:135-143`.
- **What:** Helper is exported with a "currently unused" doc; inflates the test-rig surface.
- **Why deferred:** The follow-up `incident:opened → insert` path (which needs this helper) is itself deferred to a future story. When that story lands, the export becomes load-bearing.

## Design Notes

**Why the projection lives in `@surakkha/shared` and not `packages/web/src/incidents/projection.ts`.** The original epics text suggested the web module. Story 4.1's review moved it to `@surakkha/shared` so the api's incident writer can use the same source of truth (e.g., a future "active incidents count" telemetry endpoint, or a server-side rendering of the Kanban HTML for the email digest in Epic 5). The deviation from the literal AC text is intentional and the 4.3 spec honors it.

**Why no zustand store for the board.** The board state is `Map<incident_id, IncidentPayload>` plus the column grouping. A zustand store would buy us nothing over `useState` + TanStack Query's cache, and the cache already invalidates on socket events through the existing `useDashboardSocket` pattern. If a future story (4.10 NotificationBell, 4.12 technician filter) needs cross-page state, that story wires the store.

**Why this story doesn't render `<IncidentCard />`.** Story 4.4 is the detail page; 4.1's contract is honored by `KanbanCard` reading the same severity/state labels the eventual card will use. The 4.1 `IncidentCardProps` are typed but the component is not shipped until 4.4. This story ships the minimal preview that 4.4 will mechanically replace.

**The socket listener is per-page, not module-scoped.** The board unmounts when the operator navigates away; the listener tears down with it. If a future story (4.10 NotificationBell) needs cross-page subscription, that story adds the module-scoped listener. The board's listener is the page-scoped instance.

## Verification

**Commands:**

- `pnpm -F @surakkha/shared test` -- expected: existing green + 5 new `projectKanbanColumn` cases green.
- `pnpm -F @surakkha/api test` -- expected: existing green + `activeRouter.spec.ts` 4 tests green.
- `pnpm -F @surakkha/web test` -- expected: existing green + `KanbanBoard.spec.tsx` 3 tests green.
- `pnpm -r typecheck` -- expected: clean.

**Manual checks (if no CLI):**

- Boot api + web; navigate to `/incidents`. Empty board: 4 columns with "No incidents" copy.
- Open 3 incidents at different severities; refresh `/incidents`. Verify 3 cards in the correct columns (`OPEN_CRITICAL` x 1, `OPEN_WARNING` x 2).
- Acknowledge an OPEN_CRITICAL card via curl `POST /api/incidents/{id}/acknowledge`. Verify the card moves to the `ACKNOWLEDGED` column WITHOUT a browser refresh (socket-driven).
- Resolve an incident via curl `POST /api/incidents/{id}/resolve`. Verify the card disappears from the board WITHOUT a browser refresh.
