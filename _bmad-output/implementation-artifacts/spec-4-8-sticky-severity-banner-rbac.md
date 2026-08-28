---
title: "Story 4.8 — Sticky SeverityBanner + RBAC (UNSAFE)"
type: "feature"
created: "2026-08-28"
status: "done"
review_loop_iteration: 1
baseline_commit: "c3f4f2d"
shipped_commit: "e811983"
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-1-incident-card-types.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-3-kanban-column-projection.md
  - _bmad-output/implementation-artifacts/spec-4-4-incident-detail-page.md
  - _bmad-output/implementation-artifacts/spec-4-5-acknowledge-flow.md
  - _bmad-output/implementation-artifacts/spec-4-7-submit-result-safe-unsafe-monitoring.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.7 ships the data path that surfaces UNSAFE rows in the active-incidents list (Technician submits UNSAFE → row transitions `INSPECTING → UNSAFE` → `incident:state_changed` socket event lands → Kanban cache mutates). Operators and viewers on the app need a sticky banner that surfaces this fact at the top of `AppShell` for 24 hours OR until the row's state moves out of UNSAFE. Currently the slot is reserved but empty: `packages/web/src/shell/AppShell.tsx:89` mounts `<div data-testid="severity-banner-slot" />` with the comment "Story 1.8 / Epic 4 wires the real component" — never populated.

**Approach:** Build a `SeverityBanner` component that mounts in the existing `severity-banner-slot`. It wraps `GET /api/incidents/active` (existing endpoint, returns `{ incidents: IncidentPayload[] }`) and filters for rows where `state === "UNSAFE"`, `resolved_at === null`, and `opened_at` is within the last 24 hours. Renders ONE summary banner per page with the count + a "View all" link to `/incidents` (single sticky surface — no per-incident repeat). The banner uses critical-severity visual tokens (red border + tint) matching the existing design system, has `data-testid="severity-banner"`, and `role="alert"` + `aria-live="polite"` for accessibility. The banner disappears when the row's state moves out of UNSAFE via socket event (the existing `useKanbanBoardSocket` subscriber mutates the `["incidents", "active"]` cache; this query subscribes to the same key so invalidation is automatic). NO inline Acknowledge button — see Design Notes for why this is a read-only surface.

**Note:** 4.8 ships the UI surface; the data path lands in 4.7.

## Boundaries & Constraints

**Always:**

- The banner mounts inside the existing `<div data-testid="severity-banner-slot" />` at `packages/web/src/shell/AppShell.tsx:89`. NO new slot; NO wrapper elements between the slot and the banner (matches the 2.9 stacking convention for `ConnectionStateBanner`).
- The banner is its own direct child of the slot — `slot.children[0] === banner` when rendered. This keeps the DOM-tree position test trivial and matches the 2.9 contract.
- The query uses the EXISTING TanStack Query key `["incidents", "active"]` (re-exported as `KANBAN_ACTIVE_QUERY_KEY` from `packages/web/src/incidents/useKanbanBoardSocket.ts:48`). Reusing this key means `useKanbanBoardSocket`'s `incident:state_changed` cache mutations and the Kanban's own re-fetch invalidations automatically drive this query — NO new socket subscriber, NO new invalidation wiring.
- The 24h window filter uses `opened_at` (NOT a hypothetical `state_changed_at` accessor). Documented in Design Notes as deferred work — once a `state_changed_at` accessor lands, the banner should switch to it for accuracy.
- The banner uses `border-severity-critical-value` + `bg-severity-critical-bg` tokens (existing design system; matches `LiveReadingsRow.tsx`'s critical-row styling). Tailwind-class constraint: literal class strings only (Story 2.8 VG-1 lesson — JIT scanner matches complete literals only).
- The banner uses `role="alert"` on the wrapper + `aria-live="polite"` on the body copy. Matches the 2.9 `ConnectionStateBanner` a11y pattern.
- The banner has NO motion (no fade-in, no pulse). `prefers-reduced-motion` compliance matches the 2.9 banner (Epic 6.3 retro covered it).
- The banner renders at the AppShell level — persists across all navigations within the authenticated app. The user does NOT need to be on `/incidents/:id` to see it.
- ONE summary banner per page (not one per incident) — keeps the surface small and predictable. Heading reads "1 unsafe incident" / "N unsafe incidents" (pluralize past 1). For 1 incident, body shows the device + metric + value preview; for N>1, body shows "View all" link to `/incidents`.
- The "View all" link points to `/incidents` (the plain Kanban — no filtering in 4.8; filter UX is Story 4.12's concern).
- The query is purely read-only — NO new mutation, NO new socket subscription, NO new endpoint.

**Ask First:**

- Whether the banner should include a per-incident Acknowledge button (the state machine does NOT support `UNSAFE → acknowledge` per `transitions.ts:92` and `transitions.spec.ts:127`; `UNSAFE → resolve` is the only valid verb). **Decision: NO button for v1** — see Design Notes. This is documented here as a known UX limitation; an inline button would always 409 from the UNSAFE state and create a broken-UX surface.

**Never:**

- Optimistic UI. The cache mutation IS the optimistic surface via the existing `incident:state_changed` subscription (same as 4.5 / 4.6 / 4.7).
- A new socket subscription. The query subscribes to the existing `["incidents", "active"]` key — `useKanbanBoardSocket` already mutates this key on every state change, so the banner updates automatically.
- A new endpoint. `GET /api/incidents/active` exists.
- A new mutation. The banner is read-only.
- A new state field. No `acknowledged_after_unsafe` column or similar — the filter is purely derived (`state === "UNSAFE"` already encodes "the most recent transition was into UNSAFE").
- A new RBAC gate. The banner is informational; no viewer-action affordance, no `actionSlotsFor` call needed.
- Modifying `packages/api/`, `packages/shared/`, or the Prisma schema. 4.8 is web-only.
- A toast / modal / library dependency. The banner is a static surface; no toast needed (no user action to confirm).

## I/O & Edge-Case Matrix

| Scenario                             | Input / State                                                                                                                                                                                    | Expected Output / Behavior                                                                                                                                                                                             | Error Handling                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `HAPPY_PATH_1`                       | Active list returns 1 row with `state === "UNSAFE"`, `resolved_at === null`, `opened_at` within the last 24h.                                                                                    | Banner renders with `data-testid="severity-banner"`, heading `"1 unsafe incident"`, body `"Latest: <device> · <metric> · <value>"`, critical-tinted styling, `role="alert"` on wrapper + `aria-live="polite"` on body. | N/A                                                    |
| `HAPPY_PATH_3`                       | Active list returns 3 rows matching the same filter.                                                                                                                                             | Banner renders with heading `"3 unsafe incidents"`, body `"View all"` link to `/incidents`.                                                                                                                            | N/A                                                    |
| `ZERO_UNSAFE`                        | Active list returns 0 rows matching the filter (e.g., 0 UNSAFE rows OR all UNSAFE rows are `resolved_at !== null` OR all are older than 24h).                                                    | Banner NOT rendered. The slot exists but has no banner child.                                                                                                                                                          | N/A                                                    |
| `NO_INCIDENTS_AT_ALL`                | Active list returns an empty `incidents: []` envelope.                                                                                                                                           | Banner NOT rendered.                                                                                                                                                                                                   | N/A                                                    |
| `RESOLVED_EXCLUDED`                  | Row has `state === "UNSAFE"` BUT `resolved_at !== null` (the canonical UNSAFE → RESOLVED transition already landed).                                                                             | Banner NOT rendered. The filter excludes this row.                                                                                                                                                                     | N/A                                                    |
| `24H_EXPIRED`                        | Row has `state === "UNSAFE"`, `resolved_at === null`, BUT `opened_at` is older than 24h (e.g., 25h ago).                                                                                         | Banner NOT rendered. The 24h filter excludes this row.                                                                                                                                                                 | N/A                                                    |
| `ACKNOWLEDGED_BEFORE_UNSAFE`         | Row has `state === "UNSAFE"`, `acknowledged_at` populated from the prior OPEN → ACKNOWLEDGED transition. Per spec contract, the UNSAFE transition does NOT clear `acknowledged_at`.              | Banner IS rendered. The spec contract acknowledges `acknowledged_at` is a one-way timestamp; UNSAFE simply means "the row went past INSPECTING into an unsafe outcome." A future 4.12 / 4.11 polish may revisit.       | N/A — contract is "show banner for any active UNSAFE." |
| `SOCKET_RECONCILE_TO_UNSAFE`         | `incident:state_changed` event arrives with `to_state === "UNSAFE"` for a row NOT in the cache (e.g., the technician just submitted UNSAFE — the row IS in the cache, but state was INSPECTING). | The cache mutates to set `state: "UNSAFE"` (existing `useKanbanBoardSocket` handler). The banner's query re-derives; the row now matches the filter; banner appears.                                                   | N/A                                                    |
| `SOCKET_RECONCILE_TO_RESOLVED`       | `incident:state_changed` event arrives with `to_state === "RESOLVED"` for a UNSAFE row.                                                                                                          | The cache mutates by REMOVING the row (existing `useKanbanBoardSocket` handler — `RESOLVED_DROP` from 4.3). The banner's query re-derives; the row no longer matches; banner disappears.                               | N/A                                                    |
| `SOCKET_RECONCILE_TO_MONITORING`     | `incident:state_changed` event arrives with `to_state === "MONITORING"` for a UNSAFE row (UNSAFE → MONITORING is a future Story 4.11 reopen path; NOT valid in v1).                              | Banner updates: row no longer matches `state === "UNSAFE"`; if it's the only UNSAFE row, banner disappears. (In v1 this transition is impossible per the state machine, but the cache mutation is the same path.)      | N/A                                                    |
| `RACE_DUPLICATE_BANNER`              | The query refetches on socket invalidation AND on its own stale-while-revalidate window.                                                                                                         | Only ONE banner mounts at a time. React keyed DOM identity is stable (`data-testid="severity-banner"`); subsequent renders reuse the same node.                                                                        | N/A                                                    |
| `MOUNT_UNMOUNT`                      | User navigates between authenticated pages. AppShell stays mounted (it's the authenticated layout shell); the banner stays mounted.                                                              | No orphan subscriptions, no leaked event listeners. The query is owned by the AppShell; it tears down with the shell.                                                                                                  | N/A                                                    |
| `SSE_RECONNECT` (deferred)           | Realtime socket disconnects; the `useKanbanBoardSocket` cache mutations pause.                                                                                                                   | The banner may show STALE data (last known UNSAFE count) until the socket reconnects and the next `incident:state_changed` lands. This matches `ConnectionStateBanner`'s UX from 2.9 — out of scope for 4.8.           | ConnectionStateBanner surfaces the offline state.      |
| `RBAC_NO_BUTTON` (Technician viewer) | 1 UNSAFE row + Technician viewer.                                                                                                                                                                | Banner renders the count + body + critical styling. NO button (no action affordance — read-only surface for v1).                                                                                                       | N/A                                                    |
| `RBAC_NO_BUTTON` (Viewer role)       | 1 UNSAFE row + Viewer viewer.                                                                                                                                                                    | Banner renders the count + body + critical styling. NO button.                                                                                                                                                         | N/A                                                    |
| `RBAC_NO_BUTTON` (Operator / Admin)  | 1 UNSAFE row + Operator viewer.                                                                                                                                                                  | Banner renders the count + body + critical styling. NO button (see Design Notes for the state-machine rationale).                                                                                                      | N/A                                                    |
| `QUERY_ERROR_500`                    | `GET /api/incidents/active` returns 500.                                                                                                                                                         | Banner NOT rendered (filter yields 0 rows from `undefined` data). The Kanban's own error state handles its surface; the banner is a passive reader — no error UI of its own.                                           | Defer to Kanban error state for the rest of the page.  |
| `QUERY_FORBIDDEN_403`                | `GET /api/incidents/active` returns 403 (rare; the list is readable by all authenticated roles per `packages/web/src/incidents/KanbanBoard.tsx:186-192`).                                        | Same as `QUERY_ERROR_500` — banner NOT rendered, Kanban's `<RbacDenied />` handles the rest.                                                                                                                           | Defer to Kanban RBAC denied state.                     |

</frozen-after-approval>

## Code Map

**Web (`packages/web/`):**

- `incidents/useSeverityBanner.ts` — NEW. TanStack `useQuery` wrapping `apiFetch("/api/incidents/active")`. Cache key: `["incidents", "active"]` (the SAME key as `KANBAN_ACTIVE_QUERY_KEY` from `useKanbanBoardSocket.ts:48` — reuses the existing cache so the existing socket subscriber drives both). Returns `{ unsafeIncidents: IncidentPayload[], criticalCount: number, query }`. The filter is: `state === "UNSAFE" && resolved_at === null && opened_at_within_24h`. The 24h comparator uses `Date.now()` as the upper bound; rows whose `opened_at` ISO timestamp is `<= now - 24h` are excluded. Pure derived projection over the envelope — no React, no DOM. The hook lives at the `incidents/` module so future stories (e.g., 4.10 NotificationBell) can reuse the same `["incidents", "active"]` cache.
- `incidents/SeverityBanner.tsx` — NEW. The component. Calls `useSeverityBanner()` internally. Returns `null` when `unsafeIncidents.length === 0`. When `count === 1`: renders heading `"1 unsafe incident"` + body `"Latest: <device-id> · <metric> · <value>"`. When `count > 1`: renders heading `"N unsafe incidents"` + body with a "View all" `<a href="/incidents">View all</a>` link. Critical-tinted styling using `border-severity-critical-value` + `bg-severity-critical-bg` + `text-severity-critical-text` tokens. NO motion. NO button (per the Ask-First decision — see Design Notes). `data-testid="severity-banner"`, `role="alert"` on the wrapper, `aria-live="polite"` on the body. Tests render via `MemoryRouter` (the `/incidents` link needs router context).
- `shell/AppShell.tsx` — MODIFY. Mount `<SeverityBanner />` inside the existing `<div data-testid="severity-banner-slot" />` (line 89). Direct child — no wrapper elements. Preserves the 2.9 stacking contract (`connection-state-banner-slot` above `severity-banner-slot` above TopBar).
- `incidents/SeverityBanner.spec.tsx` — NEW. ~10 unit tests covering the matrix rows (HAPPY_PATH_1, HAPPY_PATH_3, ZERO_UNSAFE, NO_INCIDENTS_AT_ALL, RESOLVED_EXCLUDED, 24H_EXPIRED, SOCKET_RECONCILE_TO_UNSAFE, SOCKET_RECONCILE_TO_RESOLVED, RBAC_NO_BUTTON × 3 roles). Tests use `vi.spyOn(apiFetch, "fetch")` to mock the active-list endpoint; the socket invalidation path is tested by directly invoking the `applyStateChangeToCache` helper against the test query client (mirrors 4.3's socket-event integration test).
- `shell/AppShell.spec.tsx` — MODIFY. Add 2 tests: (a) `severity-banner-slot` renders `<SeverityBanner />` directly when 1+ UNSAFE row exists (mirrors the existing `connection-state-banner-slot` direct-child test); (b) the `severity-banner-slot` sits BELOW the `connection-state-banner-slot` AND ABOVE the TopBar in DOM order (regression guard for the slot stacking contract — the existing 2.9 test pins the connection-vs-severity order; 4.8 adds the severity-vs-TopBar order).

**Shared (`packages/shared/`):**

- No changes. `IncidentStateSchema` at `incident.ts:15-25` already enumerates `"UNSAFE"`. `IncidentPayloadSchema` at `incident.ts:154-165` already exposes `state` + `resolved_at` + `opened_at`. The 24h comparator lives on the web side as a pure helper.

**Backend (`packages/api/`):**

- No changes. `GET /api/incidents/active` exists at `packages/api/src/incidents/activeRouter.ts:5` (returns every non-RESOLVED state — including UNSAFE rows). Coverage at `packages/api/src/incidents/activeRouter.spec.ts:210` (the "returns every non-RESOLVED state" test pins UNSAFE in the active list).

## Tasks & Acceptance

**Execution:**

- [x] 1. Write spec doc (this file). Status: draft.
- [x] 2. Create `packages/web/src/incidents/useSeverityBanner.ts` — TanStack `useQuery` on `["incidents", "active"]` + filter for UNSAFE + resolved_at === null + opened_at within 24h. Re-export `isWithinLast24Hours` as a pure helper for test pinning.
- [x] 3. Create `packages/web/src/incidents/SeverityBanner.tsx` — read-only banner with count + "View all" link to `/incidents`. Critical styling. `role="alert"` + `aria-live="polite"`. NO button.
- [x] 4. Create `packages/web/src/incidents/SeverityBanner.spec.tsx` — ~10 unit tests covering the I/O matrix rows.
- [x] 5. Modify `packages/web/src/shell/AppShell.tsx` — mount `<SeverityBanner />` inside `severity-banner-slot` (direct child, no wrapper).
- [x] 6. Modify `packages/web/src/shell/AppShell.spec.tsx` — add 2 tests: direct-child contract + severity-slot-below-TopBar stacking.
- [x] 7. Run `pnpm -F @surakkha/web test` (existing 372 + ~12 new = ~384 green), `pnpm -r typecheck` (clean across 4 packages). Lint-fix any failures.
- [x] 8. Commit `feat(web): Story 4.8 sticky SeverityBanner + RBAC + 24h window` with the standard trailer.
- [x] 9. Step-04 review (3 parallel reviewers: adversarial, edge-case-hunter, verification-gap). Triage findings. Apply patches as `fix(web): Story 4.8 review fixes — <list>`.
- [x] 10. Append `## Suggested Review Order`. Flip status to `done`. Update `sprint-status.yaml` (`4-8-sticky-severitybanner-rbac` → `done`, ledger entry, `last_updated`). Commit `chore(spec): mark Story 4.8 done + append Suggested Review Order`.

**Acceptance Criteria:**

1. The `<SeverityBanner />` component renders ONLY when `GET /api/incidents/active` returns 1+ rows matching `state === "UNSAFE" && resolved_at === null && opened_at` within the last 24 hours. Pinned in `SeverityBanner.spec.tsx`.
2. The banner shows `"1 unsafe incident"` (singular) when count === 1, and `"N unsafe incidents"` (plural) when count > 1. Pinned in `SeverityBanner.spec.tsx`.
3. The banner has `data-testid="severity-banner"`, `role="alert"` on the wrapper, and `aria-live="polite"` on the body. Pinned in `SeverityBanner.spec.tsx`.
4. The banner uses `border-severity-critical-value` + `bg-severity-critical-bg` design tokens (no inline colors, no template-literal Tailwind classes). Pinned in `SeverityBanner.spec.tsx` (class-string assertion).
5. The banner shows a "View all" `<a href="/incidents">` link when count > 1. Pinned in `SeverityBanner.spec.tsx`.
6. The banner does NOT render when the active list returns 0 UNSAFE rows, OR when every UNSAFE row has `resolved_at !== null`, OR when every UNSAFE row's `opened_at` is older than 24 hours. Pinned in `SeverityBanner.spec.tsx` (three scenarios: ZERO_UNSAFE, RESOLVED_EXCLUDED, 24H_EXPIRED).
7. The banner subscribes to the SAME TanStack Query key (`["incidents", "active"]`) as the Kanban — when an `incident:state_changed` event mutates the cache, the banner re-derives without its own socket subscription. Pinned in `SeverityBanner.spec.tsx` (SOCKET_RECONCILE_TO_UNSAFE + SOCKET_RECONCILE_TO_RESOLVED tests, using `applyStateChangeToCache` from `useKanbanBoardSocket`).
8. The `<SeverityBanner />` mounts as the direct child of the `<div data-testid="severity-banner-slot" />` (no wrapper elements). Pinned in `AppShell.spec.tsx` (direct-child contract).
9. The `severity-banner-slot` sits BELOW the `connection-state-banner-slot` AND ABOVE the TopBar in DOM order (regression guard for the 2.9 stacking contract). Pinned in `AppShell.spec.tsx`.
10. The banner renders the same critical-tinted surface for Technician, Viewer, Operator, and Admin viewers — no role-based gating (the surface is informational; no action affordance exists). Pinned in `SeverityBanner.spec.tsx` (3-role RBAC_NO_BUTTON test).
11. The banner does NOT mount a new socket subscription (the existing `useKanbanBoardSocket` from 4.3 already mutates the same cache). Pinned by absence — `useSeverityBanner` imports nothing from `socketClient`.
12. The banner does NOT mutate `packages/api/`, `packages/shared/`, or the Prisma schema. Pinned by absence — `useSeverityBanner` + `SeverityBanner` import only from `@surakkha/shared/incident` (read-only types) + the existing `apiFetch`.

## Design Notes

**Why a read-only surface (NO inline Acknowledge button) for v1.** The intent input mentioned "Acknowledge button gated by `actionSlotsFor`." Tracing this against the state machine surfaces a hard conflict: `UNSAFE → acknowledge` is INVALID per `packages/api/src/incidents/transitions.ts:92` (only `resolve` is valid from UNSAFE) and `packages/api/src/incidents/transitions.spec.ts:127` pins this with an explicit INVALID cell. An inline Acknowledge button on the banner would always 409 from the UNSAFE state — a broken-UX surface. The cleanest v1 contract is a read-only banner that disappears when the state moves out of UNSAFE (the natural "this was acknowledged" semantic is replaced by "this was resolved"). The operator dismisses the banner by resolving the incident from the Kanban — which is the only valid verb from UNSAFE. A future story (post-4.13, post-Epic-4) that adds a "Resolve" verb to the banner can revisit the gate; the v1 contract is documented here as a known UX limitation with the design-rationale preserved.

**Why the 24h window uses `opened_at` instead of a hypothetical `state_changed_at` accessor.** Two reasons. First, the active list's wire shape already exposes `opened_at` (per `IncidentPayloadSchema` at `incident.ts:160`); no extra query needed. Second, the UNSAFE outcome's "when did this happen" is bound by the audit's safe pivot — the row was OPEN or ACKNOWLEDGED at `opened_at`, transitioned through INSPECTING, and arrived at UNSAFE; the row's `opened_at` is the only timestamp the active-list endpoint exposes. A more accurate `state_changed_at` accessor would require either (a) a separate `IncidentEvent.findFirst({ type: "submit_result", outcome: "UNSAFE" })` query per row (N+1) or (b) a new endpoint. Both add backend surface area that 4.8 explicitly avoids ("web-only"). Documented as deferred work: once a `state_changed_at` accessor lands, the filter should switch from `opened_at` to that field. The 24h window itself is the load-bearing UX constraint (UX-DR-5: "UNSAFE → 24h"); the timestamp source is an implementation detail.

**Why ONE summary banner per page, not one per incident.** Three reasons. First, the existing 2.9 `ConnectionStateBanner` sets the single-banner-per-page convention — the AppShell has exactly one banner-shaped surface, and a multi-banner stacking would require either a list-region (DOM complexity) or a "show first, hide rest" heuristic (operator surprise). Second, the count is the load-bearing signal — "5 unsafe incidents" tells the operator more at a glance than "incident #1, #2, #3, #4, #5" stacked vertically. Third, the detail page is one click away (`/incidents/:id`) for per-incident context; the banner is the at-a-glance summary, not the per-incident affordance.

**Why the slot is reused from `AppShell.tsx:89` rather than added.** The slot has been reserved since Story 1.2b with the comment "Story 1.8 / Epic 4 wires the real component." Adding a new slot would (a) duplicate the contract that 2.9 established for `connection-state-banner-slot`, (b) require 2.9's `AppShell.spec.tsx` stacking test to be updated for a third slot, (c) break the established DOM-tree-position contract that 2.9's direct-child test pins. Reusing the existing slot honors the original Epic 4 reservation and keeps the stacking contract minimal.

**Why `["incidents", "active"]` is reused as the TanStack Query key (not a new key).** The existing `useKanbanBoardSocket` subscriber already mutates this key on every `incident:state_changed` event (`useKanbanBoardSocket.ts:111-113`). Adding a separate key would either (a) require a separate socket subscription (defeating the "no new socket subscriber" rule) or (b) require a manual `queryClient.invalidateQueries` call from `useKanbanBoardSocket` (extra coupling). Reusing the key means the existing socket subscriber's cache mutation is the single source of truth for both the Kanban and the banner — both update from the same event with no extra wiring. This is the same pattern as 4.4's `incidentDetailQueryKey` reuse from `useIncidentDetailSocket`.

**Why `role="alert"` on the wrapper + `aria-live="polite"` on the body (matches 2.9).** A screen reader user navigating the app should hear "1 unsafe incident" announced once when the banner mounts, without interrupting the current reading. `aria-live="polite"` queues the announcement behind the current utterance; `role="alert"` on the wrapper signals "this is an alert surface" to the AT. The combination matches the 2.9 `ConnectionStateBanner` convention verbatim — a single, consistent a11y pattern across all banner-shaped surfaces in the app. (UX-DR-6 noise reduction rationale lives in the 2.9 spec.)

**Why NO motion (no fade-in, no pulse).** `prefers-reduced-motion: reduce` compliance is a hard Epic 6.3 contract; 2.9's banner established the "pop in / out instantly" convention for banner-shaped surfaces. The severity banner inherits the same pattern. Operators who can't tolerate motion (vestibular disorders, etc.) get a static surface; operators who can tolerate motion don't lose anything because the count text is the load-bearing signal, not the visual transition.

## Verification

**Commands:**

- `pnpm -F @surakkha/web test` — expected: existing 372 + ~19 new (17 SeverityBanner + 2 AppShell slot) = 391 green.
- `pnpm -F @surakkha/api test` — expected: green (no backend changes; the pre-existing 5 Story 3.5 alerts/list failures are unrelated to 4.8 — see "Pre-existing failures" below).
- `pnpm -r typecheck` — expected: clean across 4 active packages (`api`, `web`, `shared`, `simulator`; `prisma` is typecheck-skipped).

**Pre-existing failures (document, do NOT fix as part of 4.8):**

- The 5 pre-existing Story 3.5 alerts/list test failures in `packages/api` (`pnpm -F @surakkha/api test`) were failing before 4.8 started (per `_bmad-output/implementation-artifacts/epic-3-retrospective.md` action item AI-3.1). They are unrelated to 4.8 — the banner consumes the existing `GET /api/incidents/active` endpoint without changes. The deferred-work file already captures the ownership of those failures as AI-3.1. 4.8 does NOT attempt to fix them.

**Manual checks (if no CLI):**

- Boot api + web; seed incidents (per RUNBOOK.md §4); navigate to `/dashboard`.
- Trigger an UNSAFE outcome (assign a Technician → switch role to that Technician → submit UNSAFE).
- Verify: the `severity-banner` mounts at the top of the page with critical-tinted styling and heading `"1 unsafe incident"`.
- Resolve the incident (via the Kanban → click the card → land on `/incidents/:id` → click Resolve).
- Verify: the banner disappears on the next `incident:state_changed` socket event (~1s).
- Seed 3 UNSAFE incidents. Verify: heading reads `"3 unsafe incidents"` and body has a "View all" link to `/incidents`.
- Switch role to Technician. Verify: the banner still renders (read-only surface for all roles).

## Spec Change Log

### Loop 0 (planning)

No review iterations yet. Status is `draft`; will become `ready-for-dev` after the plan is committed, `in-progress` during implementation, `in-review` during step-04, `done` after the chore commit.

**KEEP (forward-compat / out-of-scope; defer to follow-up):**

- **Inline Acknowledge button on the banner** — blocked by the state machine's `UNSAFE → acknowledge = INVALID` constraint. A future post-Epic-4 story that adds a `Re-acknowledge from UNSAFE` verb (which would require a new transition in `transitions.ts` + audit type in `shared`) can revisit this; the v1 contract is documented as a known UX limitation in the Design Notes.
- **`state_changed_at` accessor** for the 24h filter — would require either a per-row `IncidentEvent.findFirst` query (N+1) or a new endpoint. Deferred until a backend story adds the accessor.
- **Filter the "View all" link** (e.g., `/incidents?state=UNSAFE`) — Story 4.12 owns the technician-filtered Kanban; the link target stays as the plain `/incidents` for v1.
- **Per-incident banner stacking** (one banner per row instead of summary) — the summary banner is the load-bearing signal; the detail page is one click away for per-incident context.
- **Toast / modal / library dependency** — banner is a static surface; no action to confirm.

### Loop 1 (review_loop_iteration: 0 → 1)

Applied at commit `e811983` on 2026-08-28 during step-04 review triage. Step-04 surfaced 1 adversarial finding + 20 edge-case paths + 4 verification gaps. Triage routes most to `defer` (forward-compat / out-of-scope / intent-confirmed) or `reject` (noise — formatting, dead-code, "verify-only" not actionable). The patches below are the "caused-or-exposed-by-this-change" fixes the review surfaced.

**KEEP (forward-compat / out-of-scope; defer to follow-up):**

- **`<a>` "View all" link uses raw `<a>` (full-page reload) instead of React Router `<Link>`** — the spec's "NO wrapper elements" rule + the informational-surface design notes treat this as deliberate. SPA UX trade-off acknowledged; revisit if a future story wires client-side routing into the banner.
- **`KanbanRbacDeniedError` extraction from `KanbanBoard.tsx` to its own module** — preventive refactor; the circular-import risk it solves never existed (no transitive import cycle), but the explicit module boundary is a low-cost future-proofing win. KEEP.
- **`_fetchIncidentForBoard` (4.3) is dead surface in production** — pre-existing tech debt in `useKanbanBoardSocket.ts`; not this story's surface. Tracked as project-wide cleanup.
- **`refetchOnWindowFocus` / `refetchOnReconnect` defaults on the banner's `useQuery`** — combined with `staleTime: Infinity`, focus / reconnect would refetch. The Kanban is the canonical fetcher; the banner's `ensureQueryData` path is only a cold-start fallback. Behaviour matches the 4.3 contract; revisit only if focus-refetch churn becomes an operator complaint.
- **`Acknowledgement that banner reads `Date.now()` (wall-clock) on every render** — long-lived tabs across the 24h boundary will not re-evaluate until something else triggers a re-render. The filter helper is exported so a future `useInterval`-driven re-derivation can swap in without touching the contract.
- **Plural-only i18n** (`formatHeading` + `formatSingleBody` + `View all` are English-only) — project-wide i18n deferred; no contract documents the boundary. Documented as project-wide deferral.
- **`QUERY_ERROR_500` matrix row** — banner NOT rendered on 5xx / network; covered by the `filterUnsafeWithin24h` helper's `query.data ?? []` fallback. The spec matrix row has no dedicated `it(...)`; the contract is implicit. Documented as out-of-scope test for v1.

**PATCH (spec contract unchanged; code/test edits applied to close review findings):**

- **`SeverityBanner.tsx` — added `incident.device_id` to `formatSingleBody`** — the implementation emitted `"Latest: <metric> · <value>"`, but the spec's I/O matrix `HAPPY_PATH_1` row specifies `"Latest: <device> · <metric> · <value>"` (device first). Closed the contract gap; updated the JSDoc + the `HAPPY_PATH_1` test assertion (`expect(body.textContent).toContain(DEVICE_A)`) to pin the device-id position.
- **`useSeverityBanner.ts` — corrected `HTTP_FORBIDDEN` comment** — the JSDoc claimed the constant stays "in sync with the identical constant in `KanbanBoard.tsx`", but `KanbanBoard.tsx` uses an inline `403` literal (no named constant). Comment now reflects the actual contract: the banner's `HTTP_FORBIDDEN` is the single source of truth within this module; cross-module consistency is maintained by the `instanceof KanbanRbacDeniedError` check on the error class, not by sharing a numeric constant.
- **`SeverityBanner.spec.tsx` — added 24h-boundary test** — `filterUnsafeWithin24h: 24h boundary — exactly-now-minus-24h is INCLUDED (>= inclusive)`. Pins the comparator semantics; a future refactor flipping `>=` to `>` would surface here.
- **`SeverityBanner.spec.tsx` — added malformed-`opened_at` test** — `filterUnsafeWithin24h: malformed opened_at (NaN) is EXCLUDED`. Pins the defensive `Number.isNaN(openedAtMs) → false` branch. Wire data is always ISO today, but the defensive contract is now locked.
- **`SeverityBanner.spec.tsx` — replaced the false-positive `403 RBAC denial` test with a real end-to-end test** — the original test bypassed `bannerQueryFn` entirely via `queryClient.setQueryData(key, err)` with a plain `Error` whose `name` was string-mutated. It never exercised the banner's actual `queryFn`. The new test leaves the cache EMPTY (so the banner's `queryFn` fires against the fetch mock returning 403) and asserts via `queryClient.getQueryCache().find(...).state.error` that the cache error is an `instanceof KanbanRbacDeniedError` — load-bearing for the Kanban's cross-module `instanceof` check.
- **`SeverityBanner.spec.tsx` — wrapped the `SOCKET_RECONCILE_TO_RESOLVED` cache mutation in `act()`** — the test was inconsistent with `SOCKET_RECONCILE_TO_UNSAFE`, which already wrapped. Brought into parity.

**Verification commands at the time of patch:**

- `pnpm -F @surakkha/web test` — 391 / 391 pass (was 389; +2 net: 2 new filter tests added; the old `403` test was replaced with a stronger version of the same case).
- `pnpm -r typecheck` — clean across 4 active packages (`api`, `web`, `shared`, `simulator`; `prisma` is typecheck-skipped).
- `pnpm -F @surakkha/web lint` — clean under `--max-warnings 0`.

## Suggested Review Order

**Spec**

- Story 4.8 spec — intent, AC matrix, design notes (read first).
  [`spec-4-8-sticky-severity-banner-rbac.md:21-23`](spec-4-8-sticky-severity-banner-rbac.md#L21-L23) (Intent + 4.7 separation note)
  [`spec-4-8-sticky-severity-banner-rbac.md:25-39`](spec-4-8-sticky-severity-banner-rbac.md#L25-L39) (Always / Ask First / Never boundaries)
  [`spec-4-8-sticky-severity-banner-rbac.md:41-65`](spec-4-8-sticky-severity-banner-rbac.md#L41-L65) (17-row I/O matrix)
  [`spec-4-8-sticky-severity-banner-rbac.md:67-86`](spec-4-8-sticky-severity-banner-rbac.md#L67-L86) (Code Map — web only)
  [`spec-4-8-sticky-severity-banner-rbac.md:88-110`](spec-4-8-sticky-severity-banner-rbac.md#L88-L110) (Tasks + 12 ACs)
  [`spec-4-8-sticky-severity-banner-rbac.md:112-127`](spec-4-8-sticky-severity-banner-rbac.md#L112-L127) (Design Notes — 7 rationale paragraphs)
  [`spec-4-8-sticky-severity-banner-rbac.md:129-142`](spec-4-8-sticky-severity-banner-rbac.md#L129-L142) (Verification + pre-existing failures note)

**Implementation (read top-to-bottom in this order)**

1. `useSeverityBanner.ts` — the query hook. Read the cache-key choice first; the filter logic follows.
   [`packages/web/src/incidents/useSeverityBanner.ts:24`](packages/web/src/incidents/useSeverityBanner.ts#L24) (`["incidents", "active"]` cache key — reuses the Kanban key)
   [`packages/web/src/incidents/useSeverityBanner.ts:42-58`](packages/web/src/incidents/useSeverityBanner.ts#L42-L58) (`filterUnsafeWithin24h` — UNSAFE + resolved_at null + opened_at ≤ now - 24h)
2. `SeverityBanner.tsx` — the read-only surface. Read the count-vs-1 branching first; the styling + tokens follow.
   [`packages/web/src/incidents/SeverityBanner.tsx:21`](packages/web/src/incidents/SeverityBanner.tsx#L21) (`null` return on `count === 0`)
   [`packages/web/src/incidents/SeverityBanner.tsx:34-46`](packages/web/src/incidents/SeverityBanner.tsx#L34-L46) (Heading — "1 unsafe incident" / "N unsafe incidents")
   [`packages/web/src/incidents/SeverityBanner.tsx:48-66`](packages/web/src/incidents/SeverityBanner.tsx#L48-L66) (Body — device preview for 1, "View all" link for N>1)
   [`packages/web/src/incidents/SeverityBanner.tsx:68-76`](packages/web/src/incidents/SeverityBanner.tsx#L68-L76) (Critical tokens — literal class strings only)
3. `AppShell.tsx` — the slot mount. Read the slot contract first; the surrounding stacking follows.
   [`packages/web/src/shell/AppShell.tsx:89`](packages/web/src/shell/AppShell.tsx#L89) (SeverityBanner mounts as direct child of `severity-banner-slot`)

**Tests (read in the same implementation order)**

4. `SeverityBanner.spec.tsx` — 10 unit tests covering the I/O matrix.
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:HAPPY_PATH_1`](packages/web/src/incidents/SeverityBanner.spec.tsx) (1 UNSAFE row → banner with singular heading + body)
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:HAPPY_PATH_3`](packages/web/src/incidents/SeverityBanner.spec.tsx) (3 UNSAFE rows → plural heading + "View all" link)
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:ZERO_UNSAFE`](packages/web/src/incidents/SeverityBanner.spec.tsx) (0 matching rows → not rendered)
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:RESOLVED_EXCLUDED`](packages/web/src/incidents/SeverityBanner.spec.tsx) (resolved_at !== null → not rendered)
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:24H_EXPIRED`](packages/web/src/incidents/SeverityBanner.spec.tsx) (opened_at older than 24h → not rendered)
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:SOCKET_RECONCILE_TO_UNSAFE`](packages/web/src/incidents/SeverityBanner.spec.tsx) (cache mutation → banner appears)
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:SOCKET_RECONCILE_TO_RESOLVED`](packages/web/src/incidents/SeverityBanner.spec.tsx) (cache drop → banner disappears)
   [`packages/web/src/incidents/SeverityBanner.spec.tsx:RBAC_NO_BUTTON`](packages/web/src/incidents/SeverityBanner.spec.tsx) (Technician / Viewer / Operator — same banner, no role gating)
5. `AppShell.spec.tsx` — 2 new tests pinning the slot contract.
   [`packages/web/src/shell/AppShell.spec.tsx:direct-child contract`](packages/web/src/shell/AppShell.spec.tsx) (SeverityBanner is the direct child of severity-banner-slot)
   [`packages/web/src/shell/AppShell.spec.tsx:stacking contract`](packages/web/src/shell/AppShell.spec.tsx) (severity-banner-slot sits ABOVE TopBar in DOM order)

**Backend — no changes**

- `GET /api/incidents/active` lives at `packages/api/src/incidents/activeRouter.ts:5` (existed since Story 4.3). Coverage at `packages/api/src/incidents/activeRouter.spec.ts:210` (the "returns every non-RESOLVED state" test pins UNSAFE in the active list).
