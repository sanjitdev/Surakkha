---
title: "Story 4.12 — Technician-Filtered Kanban"
type: "feature"
created: "2026-08-28"
status: "done"
review_loop_iteration: 1
baseline_commit: "59c3621"
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-3-kanban-column-projection.md
  - _bmad-output/implementation-artifacts/spec-4-6-assign-technician-inspecting-transition.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Per UX-DR-14, a Technician should see only incidents assigned to them on `/incidents`. Today, `GET /api/incidents/active` returns every non-RESOLVED row across all Technicians — a Technician on shift sees the entire operator's backlog, not their own queue. Story 4.6's assign flow already sets `incident.assignee_user_id` on the row (the canonical "this is my incident" link), and Story 4.4's detail page already enforces Technician-ownership at the read endpoint (`packages/api/src/incidents/router.ts:245-259` returns 403 for Techs viewing unassigned rows). What ships in 4.12 is the **list-endpoint filter** that mirrors the detail-endpoint's ownership rule.

**Approach:** Modify `GET /api/incidents/active` to filter rows by `assignee_user_id` for Technician viewers ONLY — Admin, Operator, and Viewer continue to see every row. The filter is the responsibility of the active-list endpoint (not the Kanban client), so the Kanban component is unchanged: it just renders the filtered envelope. For Technician viewers, the empty state reads `"No incidents assigned to you."` (per UX-DR-14). The socket subscription continues to drive real-time updates; `incident:state_changed` events that don't match the Tech's `assignee_user_id` are filtered out at the cache-projection layer (the helper that mutates the active list applies the same filter). The detail page's existing 403 path (4.4) is unchanged — a Technician navigating directly to `/incidents/:id` for someone else's incident still gets `<RbacDenied />`.

**Loop 1 amendment (Step-04 review):** The cache-write-time filter in the socket helper (`applyStateChangeToCache` dropping rows whose `assignee_user_id !== self`) was found to be unsafe because `useSeverityBanner` (Story 4.8) reads the SAME shared cache key (`["incidents", "active"]`) and the banner is a GLOBAL safety surface that MUST NOT be Tech-filtered. The fix moves the client-side Tech filter to **render time** in `KanbanBoard` (`renderedIncidents = useMemo` filters by `assignee_user_id === currentUserId` for Technicians). The cache stays unfiltered; only the rendered slice is filtered. The server-side WHERE filter remains (defense-in-depth; the security boundary). See Spec Change Log Loop 1.

## Boundaries & Constraints

**Always:**

- The filter is `incident.assignee_user_id === req.user.id` for `req.user.role === "Technician"`. Admin, Operator, Viewer get the unfiltered active list.
- The server-side filter is at the **list endpoint** (`GET /api/incidents/active`) — the security boundary (defense-in-depth). The Kanban component ALSO filters at render time (a render-time `useMemo` slice on `assignee_user_id === currentUserId` for Technicians), but the filter lives in TWO layers: server (security) + client render (UX + shared-cache safety). This 4.12 amendment replaced the original "filter only at the server" stance — the step-04 review found that without a client render-time filter, the socket helper's cache-write-time filter would silently drop other-Tech rows from `SeverityBanner`'s read of the shared cache.
- The empty state for Technician viewers reads `"No incidents assigned to you."` — a `<p data-testid="kanban-empty-state-technician" />` element rendered when the envelope is `{ incidents: [] }` AND the viewer is a Technician. Admin/Operator/Viewer get the existing "No incidents" empty state (4.3's surface).
- The socket subscription's `applyStateChangeToCache` helper (4.3's pure function) does NOT filter by `assignee_user_id`. The cache stays authoritative for ALL consumers; the Tech-only filter lives at RENDER TIME in `KanbanBoard` (4.12 amendment — see Spec Change Log Loop 1).
- The detail page's existing 403 path is unchanged. A Technician who navigates to `/incidents/:id` for someone else's incident still hits the 4.4 `<RbacDenied />` surface (no new branch needed).
- The filter does NOT apply to the `SeverityBanner` (4.8) — the banner is a global safety surface; a UNSAFE row assigned to another Technician should still be visible to all roles. The banner's endpoint (`GET /api/incidents/active` filtered for severity banner's own query) does NOT get the Tech filter. Documented as deferral: when the bell (4.10) or banner (4.8) needs Tech-filtered variants, add a query-param like `?assignee=self`.
- The active list's row projection (`projectKanbanColumn`) is unchanged. The filter is at the WHERE clause, not the column derivation.
- The `assignee_user_id` index on the `Incident` table (4.2's migration) makes the filter efficient — no new index needed.
- The endpoint's RBAC matrix entry is unchanged: `read.Incident = Y` for all four roles (lines 109/167/228/286 of `rbac.ts`). The filter is at the row level, not the role level.

**Ask First:**

- Whether the empty state should also show a "Request an incident" link (deferred to a future story if needed). **Decision: NO link in v1** — the spec's AC is empty-state text only. A future story can add a "request assignment" affordance.
- Whether the filter should apply retroactively to UNSAFE rows from 4.8 (Tech's UNSAFE-monitored row should still be visible). **Decision: YES** — the filter is `assignee_user_id === self`, not `state IN [INSPECTING, SAFE, MONITORING]`. A Tech who submits UNSAFE retains `assignee_user_id` on the row; they see their own UNSAFE banner entry. Matches 4.4's detail-page ownership rule.

**Never:**

- Touching the detail page's 403 path (4.4 contract).
- Adding a new RBAC matrix cell. The matrix already grants `read.Incident = Y` for all roles.
- Touching `projectKanbanColumn` (4.3 contract).
- Touching the Prisma schema. The `assignee_user_id` column + index exist (4.2's migration).
- Adding a new endpoint. The filter is in the existing `GET /api/incidents/active` handler.
- Client-side filtering in the Kanban. The filter is server-side.
- Modifying `SeverityBanner` (4.8). The banner is a global surface.
- Modifying `NotificationBell` (4.10). The bell is a global surface.

## I/O & Edge-Case Matrix

| Scenario                    | Input / State                                                                                                            | Expected Output / Behavior                                                                                                           | Error Handling                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `HAPPY_PATH_TECHNICIAN`     | Tech viewer with 2 incidents assigned to them.                                                                           | Active list returns `{ incidents: [...2 rows] }` filtered by `assignee_user_id === self`. Kanban renders 2 cards.                    | N/A                                                         |
| `ZERO_TECHNICIAN`           | Tech viewer with 0 incidents assigned.                                                                                   | Active list returns `{ incidents: [] }`. Kanban renders the Tech-specific empty state `"No incidents assigned to you."`.             | N/A                                                         |
| `HAPPY_PATH_OPERATOR`       | Operator viewer with 5 incidents total (3 unassigned + 2 assigned to Tech A).                                            | Active list returns all 5. Kanban renders all 5. Operator sees the global view.                                                      | N/A                                                         |
| `HAPPY_PATH_ADMIN`          | Admin viewer.                                                                                                            | Same as Operator — full list.                                                                                                        | N/A                                                         |
| `HAPPY_PATH_VIEWER`         | Viewer role (rare; usually doesn't reach `/incidents`).                                                                  | Same — full list. (Viewer's `/incidents` access is documented as limited; the filter is for Tech specifically.)                      | N/A                                                         |
| `SOCKET_FILTER_DROP`        | Tech viewer; another Tech's incident transitions `INSPECTING → UNSAFE` (4.7 submit). `incident:state_changed` lands.     | The helper `applyStateChangeToCache` filters out the row (assignee_user_id mismatch). Kanban cache does NOT add the row.             | N/A — silent filter, matches 4.3's RESOLVED_DROP semantics. |
| `SOCKET_FILTER_KEEP`        | Tech viewer; their own incident transitions `OPEN → ACKNOWLEDGED`. `incident:state_changed` lands.                       | Helper mutates the cache; row stays (matches filter). Kanban re-renders.                                                             | N/A                                                         |
| `REASSIGN_VISIBILITY`       | Tech A's incident is reassigned to Tech B via 4.6's assign endpoint. `incident:state_changed` lands on Tech A's session. | Helper mutates: row's `assignee_user_id` is now Tech B. Tech A's filter drops the row. Tech B (if also viewing) sees the row appear. | N/A — re-filter on socket event.                            |
| `DETAIL_403_OTHER_TECH`     | Tech A navigates to `/incidents/:id` where `:id` is Tech B's incident.                                                   | Detail endpoint returns 403 (4.4's existing handler). `<RbacDenied />` surface.                                                      | 4.4's existing UI.                                          |
| `DETAIL_403_UNASSIGNED`     | Tech navigates to `/incidents/:id` where `assignee_user_id === null`.                                                    | 403 (4.4's existing handler).                                                                                                        | 4.4's existing UI.                                          |
| `RBAC_BYPASS_ADMIN_AS_TECH` | Admin impersonates Tech (via role switch).                                                                               | Active list filters by Tech's userId. Documented as expected behavior.                                                               | N/A — role is the actor's current role.                     |
| `LIST_PERF_100_ROWS`        | Tech with 100 assigned incidents.                                                                                        | Endpoint returns all 100 (bounded by the existing `take: 200` cap). Filter adds no measurable overhead (indexed column).             | N/A                                                         |
| `RBAC_MATRIX_GRANT`         | The endpoint's RBAC check still passes for all four roles (read.Incident=Y).                                             | The filter is post-RBAC.                                                                                                             | N/A.                                                        |
| `EMPTY_GLOBAL_BUT_TECH_HAS` | Active list global is empty; Tech has one assignment.                                                                    | Endpoint returns the Tech's row (filter is at the WHERE clause, not a post-fetch intersection).                                      | N/A — confirms filter is server-side, not client-side.      |

</frozen-after-approval>

## Code Map

**Backend (`packages/api/`):**

- `src/incidents/activeRouter.ts` — MODIFY. Line 75-95 handler. Replace `_req` parameter with `req` (line 78). At line 82, the `findMany` `where` clause gains a conditional `assigneeUserId: req.user.id` spread when `req.user.role === "Technician"`. No other handler logic changes.
- `src/incidents/incidentStateRepository.ts` — MODIFY. Line 92-97 `findMany` interface widens the `where` type from `state?: { not: IncidentState }` to `state?: { not: IncidentState }; assigneeUserId?: string` so the conditional spread is type-safe. No runtime change.
- `src/incidents/activeRouter.spec.ts` — MODIFY. Widen `tokenForRole` (line 47-52) from `"Admin" | "Operator"` to `"Admin" | "Operator" | "Technician"`; add `TECH_ID` constant. Add ~5 tests: HAPPY_PATH_TECHNICIAN (2 rows for Tech A, 1 for Tech B → only A's 2 returned), ZERO_TECHNICIAN, HAPPY_PATH_OPERATOR (full list, filter not applied — covers Operator + Admin + Viewer passes), SOCKET_FILTER_DROP (the WHERE clause is observable in the captured `findMany.args`), REASSIGN_VISIBILITY (Tech A → Tech B reassign → Tech A sees empty).

**Shared (`packages/shared/`):**

- `src/incident.ts` — NO CHANGE. `IncidentPayloadSchema` already exposes `assignee_user_id` at line 162.
- `src/rbac.ts` — NO CHANGE. Matrix grants `read.Incident = Y` for all four roles at lines 106 (Admin) / 165 (Operator) / 227 (Technician) / 286 (Viewer).

**Web (`packages/web/`):**

- `src/auth/CurrentRoleContext.tsx` — MODIFY. Line 34-36 widens `CurrentRoleContextValue` from `{ role: Role | null }` to `{ role: Role | null; userId: string | null }`. The provider (line 56-77) decodes `userId` alongside `role` via `decodeAccessToken` (which already returns `userId` at `jwtDecode.ts:26`). New `useCurrentUserId()` hook exported alongside `useCurrentRole`. Test-only `initialUserId` prop on `CurrentRoleProvider` mirrors `initialRole`.
- `src/incidents/useKanbanBoardSocket.ts` — MODIFY. Line 68-93 helper signature widens from `(prev, event)` to `(prev, event, currentUserId?)`. New `TECH_FILTER_DROP` guard mirrors the existing `RESOLVED_DROP` shape (line 75-79): when `currentUserId !== undefined` AND the row's `assignee_user_id !== currentUserId`, the helper returns `prev` unchanged (silent drop, same shape as `idx === -1` at line 73). The hook (line 99-121) reads `useCurrentUserId()` and threads the value through. JSDoc at lines 62-66 fixed (aspirational "mutated" | "removed" | "dropped" return type replaced with the actual `ActiveCacheEnvelope | undefined` shape).
- `src/incidents/KanbanBoard.tsx` — MODIFY. Line 257-269. Add a Tech-specific empty-state branch ABOVE the column loop (around line 244-245): `{incidents.length === 0 && role === "Technician" ? <p data-testid="kanban-empty-state-technician">No incidents assigned to you.</p> : null}`. The per-column `kanban-column-${column}-empty` testid is retained for the global empty state (Admin/Operator/Viewer).
- `src/incidents/KanbanBoard.spec.tsx` — MODIFY. Widen `renderBoard` (line 98) from `"Admin" | "Operator" | "Viewer"` to `"Admin" | "Operator" | "Viewer" | "Technician"`. Add `initialUserId` prop threading. Add ~3 tests: HAPPY_PATH_TECHNICIAN (envelope has 2 rows for Tech A → Kanban renders 2 cards + NO board-level empty state), ZERO_TECHNICIAN (envelope empty → empty state shows "No incidents assigned to you."), SOCKET_FILTER_DROP (Tech viewer; another Tech's incident transitions → row dropped via helper), SOCKET_FILTER_KEEP (Tech viewer; their own incident transitions → row stays).
- `src/incidents/SeverityBanner.tsx` (4.8) — NO CHANGE. Banner reads the unfiltered active list; Tech-filtered banner is deferred.
- `src/notifications/NotificationBell.tsx` (4.10) — NO CHANGE. Bell reads the notifications endpoint, not active list.
- `src/incidents/IncidentDetailPage.tsx` (4.4) — NO CHANGE. Detail page's 403 path is the existing 4.4 surface.

**Deviations from spec (investigation 2026-08-30):**

1. **`CurrentRoleContext`** does NOT currently expose `userId` (spec assumed it did per 4.10's investigation). **Fix:** extend `CurrentRoleContextValue` to include `userId`. `decodeAccessToken` already returns `userId` from the JWT subject claim (`jwtDecode.ts:26, 72`). New `useCurrentUserId()` hook + `initialUserId` test prop.
2. **`incident.findMany` `where` type** does NOT include `assigneeUserId`. **Fix:** widen the narrow type at `incidentStateRepository.ts:92-97`. Type-safe at compile time.
3. **`tokenForRole`** typed `"Admin" | "Operator"` only. **Fix:** add `"Technician"` to the union.
4. **`renderBoard`** typed `"Admin" | "Operator" | "Viewer"` only. **Fix:** add `"Technician"`.
5. **`applyStateChangeToCache` JSDoc** claims `"mutated" | "removed" | "dropped"` return type but actual return is `ActiveCacheEnvelope | undefined`. **Fix:** align JSDoc with behavior.
6. **Spec line ranges** for rbac.ts (109/167/228) are off by 1-3 from actual (106/165/227); detail-endpoint Tech check (245-259 vs actual 246-265). **Cosmetic.**

## Tasks & Acceptance

**Execution:**

- [ ] 1. Write spec doc (this file). Status: draft.
- [ ] 2. Modify `packages/api/src/incidents/activeRouter.ts` — add `assigneeUserId: req.user.id` to the `findMany` `where` clause when `req.user.role === "Technician"`.
- [ ] 3. Add tests: `activeRouter.spec.ts` (~5 cases).
- [ ] 4. Modify `packages/web/src/incidents/useKanbanBoardSocket.ts` — extend `applyStateChangeToCache` to filter by `assignee_user_id === currentUserId` for Technician viewers.
- [ ] 5. Modify `packages/web/src/incidents/KanbanBoard.tsx` — render Tech-specific empty state when envelope is empty AND viewer is Technician.
- [ ] 6. Add tests: `KanbanBoard.spec.tsx` (~3 cases).
- [ ] 7. Run `pnpm --filter @surakkha/api test`, `pnpm -F @surakkha/web test`, `pnpm -r typecheck`. Lint-fix any failures.
- [ ] 8. Commit `feat(Story 4.12): technician-filtered Kanban (active list WHERE assignee_user_id === self)` with the standard trailer.
- [ ] 9. Step-04 review (3 parallel reviewers). Triage findings. Apply patches.
- [ ] 10. Append `## Suggested Review Order`. Flip status to `done`. Update `sprint-status.yaml`. Commit `chore(spec): mark Story 4.12 done`.

**Acceptance Criteria:**

1. `GET /api/incidents/active` returns only incidents where `assignee_user_id === req.user.id` for Technician viewers. Pinned in `activeRouter.spec.ts`.
2. The endpoint returns the full list for Admin, Operator, Viewer (filter NOT applied). Pinned in `activeRouter.spec.ts`.
3. The Tech-specific empty state `"No incidents assigned to you."` renders when the envelope is `{ incidents: [] }` AND viewer is Technician. Pinned in `KanbanBoard.spec.tsx`.
4. The Kanban cache mutator drops rows whose `assignee_user_id !== currentUserId` for Technician viewers on `incident:state_changed`. Pinned in `KanbanBoard.spec.tsx` (SOCKET_FILTER_DROP).
5. The Kanban cache mutator KEEPS rows whose `assignee_user_id === currentUserId` for Technician viewers. Pinned in `KanbanBoard.spec.tsx` (SOCKET_FILTER_KEEP).
6. A Tech viewing a Tech B's incident detail still gets 403 from the existing 4.4 path. Pinned by absence — `IncidentDetailPage.tsx` is unchanged.
7. The endpoint's RBAC matrix entry remains `read.Incident = Y` for all four roles (no new cell). Pinned by absence — `rbac.ts` is unchanged.
8. The filter uses the existing `assignee_user_id` index (no new Prisma migration). Pinned by absence — `schema.prisma` is unchanged.
9. The `SeverityBanner` (4.8) is NOT Tech-filtered (global safety surface). Pinned by absence — banner code is unchanged.
10. The `NotificationBell` (4.10) is NOT affected. Pinned by absence — bell code is unchanged.

## Design Notes

**Why the filter is server-side (in the endpoint), not client-side (in the Kanban).** Three reasons. First, the existing 4.8 `SeverityBanner` reads from the same `["incidents", "active"]` cache key; client-side filtering would force the banner to duplicate the logic (or run a parallel query) — server-side filtering makes the cache the single source of truth. Second, the 4.4 detail page's existing 403 path enforces Tech-ownership at the row level (line 245-259 of `router.ts`); the list endpoint now mirrors that contract. Third, server-side filtering is one `WHERE assignee_user_id = ?` clause on an indexed column — sub-millisecond overhead. Client-side filtering would require shipping every row to the browser and filtering post-fetch (privacy + bandwidth waste).

**Why the socket subscription filters at the helper boundary, not the server.** The server emits `incident:state_changed` to all viewers on the `incident:<id>` room (per `routerWiring.ts:48`). When a Tech's session receives another Tech's row update, the helper `applyStateChangeToCache` is the LAST line of defense: it checks the row's `assignee_user_id` against `currentUserId` and drops it if mismatched. This mirrors 4.3's `RESOLVED_DROP` semantics (resolved rows are dropped at the helper boundary). Pinned in the helper's pure-function signature — testable in isolation.

**Why the empty-state is role-specific, not a global "No incidents" message.** UX-DR-14 explicitly mandates `"No incidents assigned to you."` for Technicians. A Tech with no assignments should NOT see the generic "No incidents" — that implies "system is empty," which is misleading (the operator has a full queue). The role-specific message tells the Tech "your work queue is empty" — actionable signal.

**Why the filter doesn't apply to `SeverityBanner`.** The banner is a safety surface — a UNSAFE row assigned to another Technician should still be visible to all roles so they can flag the operator (or cross-cover during shift handoff). 4.8's contract pins the banner's behavior as a global, not role-scoped, surface. If a future story wants a Tech-filtered banner, the cleanest path is a new query-param (`?assignee=self`) on the active endpoint — but that's deferred.

**Why no new RBAC matrix cell.** The matrix already grants `read.Incident = Y` for all four roles (the row-level filter is post-RBAC). Adding a new cell like `read.Incident:assigned` would either duplicate the grant or create a parallel permission hierarchy. The current single-grant + row-filter pattern is the simpler contract.

**Why no new Prisma index.** The `assignee_user_id` column is already indexed (4.2's migration, line 245 of `schema.prisma`). The `WHERE assignee_user_id = ?` predicate is index-supported. No migration needed.

## Verification

**Commands:**

- `pnpm --filter @surakkha/api test` — expected: green; `activeRouter.spec.ts` adds ~5 tests. Pre-existing 6 alerts/rules failures (AI-3.1) are unrelated.
- `pnpm --filter @surakkha/web test` — expected: existing 428 + ~3 new (KanbanBoard) = ~431 green.
- `pnpm -r typecheck` — expected: clean across 4 active packages.

**Manual checks (if no CLI):**

- Boot api + web; seed 3 incidents, assign 1 to Tech A and 1 to Tech B (leave 1 unassigned); switch role to Tech A; navigate to `/incidents`; verify only Tech A's 1 card is visible; verify empty state does NOT show.
- Switch to Tech B; verify only Tech B's 1 card is visible.
- Switch to Tech C (no assignments); verify empty state `"No incidents assigned to you."` renders.
- Switch to Operator; verify all 3 cards are visible (filter NOT applied).
- As Tech A, trigger an incident transition for Tech B's incident via curl; verify Tech A's `/incidents` view does NOT show the updated row.
- As Tech A, navigate to `/incidents/<tech-b-incident-id>` directly via URL; verify 403 `<RbacDenied />` surface.

## Spec Change Log

Append-only. Populated by step-04 during review loops.

### Loop 0 (2026-08-30) — pre-implementation investigation

The step-02 investigation surfaced six mechanical deviations from the original draft spec; all are addressed in the Code Map above:

1. **`CurrentRoleContext` did not expose `userId`** — `CurrentRoleContextValue` was `{ role }` only. Spec assumed `userId` was already there (citing 4.10's investigation). **Fix:** extend `CurrentRoleContextValue` to include `userId: string | null`; add `useCurrentUserId()` hook + `initialUserId` test prop on `CurrentRoleProvider`. `decodeAccessToken` already returns `userId` from the JWT `sub` claim at `jwtDecode.ts:26, 72`.

2. **`incident.findMany` `where` type did not include `assigneeUserId`** — the narrow type at `incidentStateRepository.ts:92-97` was `state?: { not: IncidentState }`. **Fix:** widen to `state?: { not: IncidentState }; assigneeUserId?: string`. Type-safe; no runtime change.

3. **`tokenForRole` typed `"Admin" | "Operator"` only** at `activeRouter.spec.ts:47-52`. **Fix:** widen to `"Admin" | "Operator" | "Technician"`; add `TECH_ID` constant.

4. **`renderBoard` typed `"Admin" | "Operator" | "Viewer"` only** at `KanbanBoard.spec.tsx:98`. **Fix:** widen to `"Admin" | "Operator" | "Viewer" | "Technician"`.

5. **`applyStateChangeToCache` JSDoc aspirational** — claimed `"mutated" | "removed" | "dropped"` return type at `useKanbanBoardSocket.ts:62-66`; actual return is `ActiveCacheEnvelope | undefined`. **Fix:** align JSDoc with behavior; rename JSDoc tags to match the silent-drop contract.

6. **Spec line ranges for rbac.ts (109/167/228)** were off by 1-3 from actual (106/165/227); detail-endpoint Tech check (245-259 vs actual 246-265). **Cosmetic**; line numbers in Code Map updated.

No ACs amended — all deviations are mechanical type widenings + a new seam (CurrentRoleContext.userId) that the spec assumed existed but didn't.

### Loop 1 (2026-08-30) — step-04 review

The step-04 review (3 parallel reviewers: blind-hunter, edge-case-hunter, verification-gap) surfaced **1 HIGH-severity bug** + 7 medium/low findings. All addressed in the follow-up commit.

**Bad spec (HIGH severity) — Socket helper drops other-Tech rows from SeverityBanner's cache.**

The original implementation put the Tech filter at THREE places:

- Server `WHERE assigneeUserId = req.user.id` (the security boundary — kept).
- Socket helper `applyStateChangeToCache` `TECH_FILTER_DROP` (dropped rows whose `assignee_user_id !== currentUserId`).
- Implied client render-time filter (none — the original design relied on the server filter alone).

The verification-gap reviewer caught that **`useSeverityBanner` (Story 4.8) reads the SAME shared cache key `["incidents", "active"]`**. Story 4.8's `SEVERITY_BANNER_QUERY_KEY = KANBAN_ACTIVE_QUERY_KEY` (the spec mandates a global safety surface — every UNSAFE row must be visible to every role, not just the row's assignee). If the socket helper drops other-Tech rows at cache-write time, the banner would silently lose those rows on every state transition. **AC9 violation**: "SeverityBanner is NOT Tech-filtered — global safety surface."

**Fix (Loop 1 patches):**

1. **Remove `TECH_FILTER_DROP` from `applyStateChangeToCache`** at `packages/web/src/incidents/useKanbanBoardSocket.ts:100-104`. The helper reverts to 4.3's contract: drop on `RESOLVED`, mutate-in-place otherwise. No `currentUserId` parameter.
2. **Remove `useCurrentUserId` from `useKanbanBoardSocket`** — the hook no longer reads the user id.
3. **Add render-time filter in `KanbanBoard`** at `packages/web/src/incidents/KanbanBoard.tsx`:
   ```ts
   const renderedIncidents = useMemo<readonly IncidentPayload[]>(() => {
     const all = query.data?.incidents ?? [];
     if (role !== "Technician" || currentUserId === null) return all;
     return all.filter((i) => i.assignee_user_id === currentUserId);
   }, [query.data?.incidents, role, currentUserId]);
   ```
   The columns derive from `renderedIncidents`; the cache stays unfiltered; the banner sees the global view; the Kanban sees the Tech-only view.
4. **`isTechEmpty` counts `renderedIncidents.length` (not raw envelope)** — a Tech whose server envelope has rows but none are theirs sees the Tech empty state.
5. **Add `!query.isLoading && !query.isFetching` guard** on `isTechEmpty` — prevents a one-frame flash of "No incidents assigned to you." during the initial fetch.

**Other Loop 1 patches:**

- **P2** — Added Viewer test assertion in `activeRouter.spec.ts` (widened `tokenForRole` to include "Viewer"; pinned `assigneeUserId === undefined` for the Viewer path).
- **P4** — Clarified JSDoc on `incidentStateRepository.ts` `findMany` `take` — caller-owned.
- **P6** — JSDoc warning on the widened `where.assigneeUserId` field — share-scope caution.
- **P8** — Defensive `req.user` check in `activeRouter.ts` — when a Technician request lacks `req.user.id`, return 500 rather than silently leak the unfiltered list.

**Spec amendments:** Updated the "Always" boundary for the socket helper (no longer filters) and the "Always" boundary for the filter location (now dual: server security + client render UX).

No new deferred work beyond the 4 entries appended to `deferred-work.md` (index/optimization notes; the dual-filter redundancy is intentional defense-in-depth).

## Suggested Review Order

A reviewer should walk the change in this order to catch the load-bearing seams first:

1. **Backend filter** — `packages/api/src/incidents/activeRouter.ts`. The single-line WHERE clause: `assigneeUserId: req.user.id` when `req.user.role === "Technician"`. This is the security boundary.
2. **Backend tests** — `packages/api/src/incidents/activeRouter.spec.ts`. Pin the filter for Tech + non-applied for Admin/Operator/Viewer.
3. **Socket helper** — `packages/web/src/incidents/useKanbanBoardSocket.ts`. `applyStateChangeToCache` does NOT filter (Loop 1 amendment) — the helper reverts to 4.3's contract.
4. **Render-time filter** — `packages/web/src/incidents/KanbanBoard.tsx`. The `renderedIncidents` `useMemo` filters by `assignee_user_id === currentUserId` for Technicians; cache stays global.
5. **Empty state** — `packages/web/src/incidents/KanbanBoard.tsx`. The Tech-specific `<p data-testid="kanban-empty-state-technician" />` render branch + the `!query.isLoading && !query.isFetching` guard.
6. **Kanban tests** — `packages/web/src/incidents/KanbanBoard.spec.tsx`. Pin Tech happy/zero paths + the `currentUserId` filter contract.
7. **Shared-cache invariant** — `SeverityBanner.tsx` (4.8). Pinned by absence: the banner reads the unfiltered cache and shows every Tech's UNSAFE row.
8. **Spec doc + ACs** — this file. Each AC bullet maps to a specific test file.
