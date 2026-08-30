# Story 4.12 — Technician-Filtered Kanban — review distillation

**Sources:**

- Spec Change Log Loop 0 of `spec-4-12-technician-filtered-kanban.md:182-189` (baseline review).
- Spec Change Log Loop 1 of `spec-4-12-technician-filtered-kanban.md:191-230` (step-04 review of baseline commit `8a3c889..a5d04f7`).

**Step-04 reviewers:** parallel (blind-hunter + edge-case-hunter + verification-gap).
**Severities:** Loop 0 = 6 findings (all cosmetic + 1 type widening); Loop 1 = **1 HIGH-severity bug** + 7 medium/low findings.
**Outcome:** All findings + the Loop 1 HIGH bug addressed in commit `a5d04f7`. Re-verification: clean.

---

## Loop 0 — baseline review (cosmetic + 1 type widening)

| #   | Severity | Surface                                                                  | Pin / Fix                                                                                                                                                               |
| --- | -------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | LOW      | `useKanbanBoardSocket.ts` JSDoc                                          | Aligned with actual return type `ActiveCacheEnvelope \| undefined`.                                                                                                     |
| 2   | LOW      | `incidentStateRepository.ts` JSDoc                                       | `findMany` `take` semantics clarified as caller-owned.                                                                                                                  |
| 3   | MEDIUM   | `CurrentRoleContext`                                                     | New seam needed — exposes `userId` to `KanbanBoard`'s render-time filter. Spec assumed this existed but it didn't.                                                      |
| 4   | MEDIUM   | `KanbanBoard.spec.tsx:98` typed `"Admin" \| "Operator" \| "Viewer"` only | Widen to `"Admin" \| "Operator" \| "Viewer" \| "Technician"`.                                                                                                           |
| 5   | LOW      | `applyStateChangeToCache` JSDoc aspirational                             | Claimed `"mutated" \| "removed" \| "dropped"` return type; actual is `ActiveCacheEnvelope \| undefined`. Aligned; renamed JSDoc tags to match the silent-drop contract. |
| 6   | LOW      | `rbac.ts` line numbers (109/167/228)                                     | Off by 1-3 from actual (106/165/227); detail-endpoint Tech check 245-259 → 246-265. Updated Code Map.                                                                   |

**No ACs amended** — all Loop 0 deviations are mechanical type widenings + a new seam (`CurrentRoleContext.userId`) the spec assumed existed.

---

## Loop 1 — step-04 review (1 HIGH + 7 medium/low)

### HIGH-severity bug: socket helper drops other-Tech rows from SeverityBanner's cache

**Diagnosis (verification-gap reviewer):** The original implementation put the Tech filter at THREE places:

1. **Server `WHERE`** `assigneeUserId = req.user.id` (the security boundary — kept).
2. **Socket helper** `applyStateChangeToCache` `TECH_FILTER_DROP` (dropped rows whose `assignee_user_id !== currentUserId`).
3. ~~Implied client render-time filter~~ (NONE — original design relied on server filter alone).

**The bug:** `useSeverityBanner` (Story 4.8) reads the SAME shared cache key `["incidents", "active"]` (`SEVERITY_BANNER_QUERY_KEY = KANBAN_ACTIVE_QUERY_KEY`). 4.8 mandates a global safety surface — every UNSAFE row must be visible to every role, not just the row's assignee. If the socket helper drops other-Tech rows at cache-write time, the banner silently loses those rows on every state transition. **AC9 violation**: "SeverityBanner is NOT Tech-filtered — global safety surface."

### Loop 1 patches (1 HIGH + 5 supporting fixes)

| Fix | Surface                                                      | Resolution                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/web/src/incidents/useKanbanBoardSocket.ts:100-104` | **Remove `TECH_FILTER_DROP` from `applyStateChangeToCache`** — helper reverts to 4.3's contract: drop on `RESOLVED`, mutate-in-place otherwise. No `currentUserId` parameter.                                                                             |
| 2   | `useKanbanBoardSocket.ts`                                    | **Remove `useCurrentUserId` from the hook** — no longer reads user id.                                                                                                                                                                                    |
| 3   | `packages/web/src/incidents/KanbanBoard.tsx`                 | **Add render-time filter** — `renderedIncidents = useMemo` filters by `assignee_user_id === currentUserId` for Technicians. Columns derive from `renderedIncidents`; cache stays unfiltered; banner sees the global view; Kanban sees the Tech-only view. |
| 4   | `KanbanBoard.tsx`                                            | **`isTechEmpty` counts `renderedIncidents.length`** (not raw envelope) — a Tech whose server envelope has rows but none are theirs sees the Tech empty state.                                                                                             |
| 5   | `KanbanBoard.tsx`                                            | **`!query.isLoading && !query.isFetching` guard** on `isTechEmpty` — prevents one-frame flash of "No incidents assigned to you." during the initial fetch.                                                                                                |

### Other Loop 1 patches (medium/low)

- **P2** — Added Viewer test in `activeRouter.spec.ts` (widened `tokenForRole` to include "Viewer"; pinned `assigneeUserId === undefined` for Viewer path).
- **P4** — `incidentStateRepository.ts` JSDoc on `findMany` `take` — caller-owned.
- **P6** — JSDoc warning on widened `where.assigneeUserId` field — share-scope caution.
- **P8** — Defensive `req.user` check in `activeRouter.ts` — when Tech request lacks `req.user.id`, return 500 instead of leaking unfiltered list.

### Spec amendments applied

- Updated **"Always" boundary for the socket helper** (no longer filters).
- Updated **"Always" boundary for the filter location** (now dual: server security + client render UX).

---

## KEEP for next reviewer (load-bearing seams)

1. **Dual filter architecture** — server `WHERE assigneeUserId = self` for Technicians (security boundary) + client render-time `useMemo` slice (UX + shared-cache safety). The render-time filter must NOT be promoted into the socket helper (that's the bug we just fixed).
2. **`!query.isLoading && !query.isFetching` guard** on `isTechEmpty` — without this, every Tech sees a one-frame flash of "No incidents assigned to you." on initial page load. The guard is small; the regression would be subtle.
3. **`applyStateChangeToCache` does NOT filter by Tech** — the contract is "drop on RESOLVED, mutate-in-place otherwise." A future contributor adding cache-write-time filtering would silently break the banner.

## Verification re-run after patches

- `pnpm --filter @surakkha/api test` — green (new Viewer test in `activeRouter.spec.ts`).
- `pnpm --filter @surakkha/web test` — green.
- `pnpm -r typecheck` — clean.
- **Pre-existing failures noted:** 6 alerts/rules failures (AI-3.1) are unrelated.

## Deferrals

4 entries appended to `_bmad-output/implementation-artifacts/deferred-work.md` under "Deferred from: code review of 4-12-technician-filtered-kanban (2026-08-30)". The dual-filter redundancy is intentional defense-in-depth; not flagged for future work.
