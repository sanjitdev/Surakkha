---
title: "Story 4.4 — Incident Detail Page (Read-Only)"
type: "feature"
created: "2026-08-27"
status: "done"
review_loop_iteration: 1
baseline_commit: "36995af" # test(4.3): step-04 patches — wire-schema equivalence, silent-drop contract, mount/unmount cleanup
shipped_commit: "8e8be1d"
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-3-kanban-column-projection.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.3 ships the Kanban board at `/incidents`. The board's `KanbanCard` exposes an `onClick` slot (wired but unconsumed — `KanbanBoard` does not pass `onClick` to its cards today). Story 4.2 ships the `/api/incidents/:id` endpoint but only the row, not the IncidentEvent audit timeline. Operators have no place to read the full history of a single incident — opened_at, metric, value, assignee, acknowledged/resolved timestamps, and the trail of state transitions.

**Approach:** Wire the Kanban's `onClick` slot to a real detail view at `/incidents/:id`. Add a sibling `GET /api/incidents/:id/events` endpoint (the timeline). The detail page is read-only — no action buttons. Subscribe to `incident:state_changed` and mutate the cached row in place, KEEPING resolved rows visible (the detail page is read-only; resolved incidents are first-class citizens, unlike the Kanban which drops them from the active board).

## Boundaries & Constraints

**Always:**

- The detail page is read-only. NO acknowledge / assign / submit-result / reopen buttons. Those are Stories 4.5 / 4.6 / 4.7 / 4.11.
- The timeline lives behind a separate endpoint `GET /api/incidents/:id/events` — NOT embedded in the existing `GET /api/incidents/:id` response. Rationale: keeps the row response small, makes pagination trivial later, matches the optional `events` field noted in the `IncidentPayloadSchema` docstring.
- RBAC for the timeline endpoint mirrors the parent: `authorize({action: "read", resource: "Incident"})` + inline Technician-ownership check (Technicians only see incidents they're assigned to).
- Detail page subscribes to `incident:state_changed` and mutates the row's `state` in place. RESOLVED transitions DO NOT drop the row.
- The 404 surface is a NEW pattern for the codebase (the Kanban doesn't have one because the active list never 404s). Ship a minimal `<NotFound />` component for reuse.
- Classnames + testids mirror `KanbanCard.tsx` conventions; `SEVERITY_DOT_BG` / `SEVERITY_LABEL` / `STATE_LABEL` are imported from `KanbanCard.tsx`, not duplicated.

**Never:**

- Action buttons on the detail page. (Story 4.5 ships `IncidentCardProps.actionSlotsFor` integration; this story is the static frame.)
- Embedded `events` in the GET response. (Future story; documented in Out of Scope.)
- Optimistic UI for socket-driven state changes. The server is authoritative; cache mutation IS the optimistic surface.
- Pagination on the timeline. The v1 transition model produces ≤ ~10 IncidentEvent rows per incident. Pagination is a follow-up.
- Pagination on the active list (deferred from 4.3; remains deferred).

## I/O & Edge-Case Matrix

| Case                        | Trigger                                                                                                    | Expected                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `HAPPY_PATH`                | `GET /api/incidents/:id` 200 + `GET /api/incidents/:id/events` 200 with `{events: IncidentEventPayload[]}` | Page renders the row + timeline; `data-testid="incident-detail-root"` + per-field testids + per-event testids.                          |
| `EMPTY_TIMELINE`            | events endpoint returns `{events: []}`                                                                     | Page renders the row + "No audit events yet" copy in the timeline section.                                                              |
| `404_NOT_FOUND`             | `GET /api/incidents/:id` returns 404                                                                       | Page renders `<NotFound />` with `data-testid="not-found"`. No row, no timeline.                                                        |
| `403_RBAC`                  | Tech viewing an incident they're not assigned to (Tech-ownership violation)                                | Page renders `<RbacDenied />` with `data-testid="rbac-denied"`.                                                                         |
| `500_GENERIC`               | Any of the two endpoints throws                                                                            | Page renders the "Failed to load incident" copy + retry button.                                                                         |
| `SOCKET_STATE_CHANGED`      | `incident:state_changed` event for the displayed incident arrives                                          | Row's `data-state` attribute updates in place; no re-fetch. Timeline appends a new `<li data-testid="incident-detail-event-${newId}">`. |
| `SOCKET_RESOLVED_KEEPS_ROW` | `incident:state_changed` with `to_state: "RESOLVED"` arrives                                               | Row STAYS visible (different from Kanban); `data-state` updates to `"RESOLVED"`.                                                        |
| `NAV_FROM_KANBAN`           | User clicks a card on `/incidents`                                                                         | URL navigates to `/incidents/:id`; detail page mounts and renders.                                                                      |

## Code Map

**Backend (`packages/api/`):**

- `incidents/incidentStateRepository.ts` — add `IncidentEventRow` type + `incidentEvent.findMany` narrow slice + `incidentEventRowToPayload` helper (parallel to `incidentRowToPayload` at lines 328-352).
- `incidents/router.ts` — add `GET /api/incidents/:id/events` route after line 263 (sibling to the existing GET). Mirrors the existing route's RBAC + Tech-ownership + 404 + 500 patterns.
- `incidents/router.spec.ts` — add 6-7 tests covering the new endpoint.
- `incidents/routerWiring.ts` — no change (the mount adapter already covers all routes in `router.ts`; verify only).

**Web (`packages/web/`):**

- `incidents/IncidentDetailPage.tsx` — NEW. The page component. Header (severity dot, state label, opened_at) + definition list (device, metric, value, assignee, acknowledged_at, resolved_at) + audit timeline list.
- `incidents/useIncidentDetailSocket.ts` — NEW. Page-scoped listener that mutates the row cache in place (KEEPS resolved rows).
- `incidents/cacheMutators.ts` — NEW. Shared `applyTransitionToCachedRow(row, event)` helper. Both `useKanbanBoardSocket` (after refactor) and `useIncidentDetailSocket` consume this. Single source of truth for the row-update shape.
- `incidents/IncidentDetailPage.spec.tsx` — NEW. ~9 tests mirroring `KanbanBoard.spec.tsx` rig.
- `incidents/KanbanBoard.tsx` — one-line edit at line 269: `useNavigate()` + `onClick={(id) => navigate(\`/incidents/${id}\`)}`.
- `incidents/KanbanBoard.spec.tsx` — add 1 nav-from-Kanban test.
- `access/NotFound.tsx` — NEW. Minimal 404 surface mirroring `RbacDenied.tsx`. Single `data-testid="not-found"` seam.
- `main.tsx` — add `<Route path="/incidents/:id" element={...} />` between line 222 (end of `/incidents`) and line 223 (start of `/alerts`).

**Shared (`packages/shared/`):**

- No changes. `IncidentEventPayloadSchema` and `IncidentEventTypeSchema` already exist at `src/incident.ts:130-138` and `:172-180`.

## Tasks & Acceptance

**Tasks (in order):**

- [ ] 1. Write spec doc (this file). Status: in-progress.
- [ ] 2. Extend `IncidentStateRepository` with `IncidentEventRow` + `findMany` + `incidentEventRowToPayload` + adapter wiring.
- [ ] 3. Add `GET /api/incidents/:id/events` to `router.ts` mirroring the parent route's RBAC + Tech-ownership.
- [ ] 4. Add 6-7 tests to `router.spec.ts`.
- [ ] 5. Create `packages/web/src/access/NotFound.tsx`.
- [ ] 6. Create `packages/web/src/incidents/cacheMutators.ts` with `applyTransitionToCachedRow`.
- [ ] 7. Create `packages/web/src/incidents/useIncidentDetailSocket.ts` consuming the shared mutator.
- [ ] 8. Create `packages/web/src/incidents/IncidentDetailPage.tsx`.
- [ ] 9. Register `/incidents/:id` in `main.tsx`.
- [ ] 10. Edit `KanbanBoard.tsx` to wire `useNavigate()` + `onClick` on each card.
- [ ] 11. Add `IncidentDetailPage.spec.tsx` (9 cases).
- [ ] 12. Add 1 nav-from-Kanban case to `KanbanBoard.spec.tsx`.
- [ ] 13. Run `pnpm -F @surakkha/api test`, `pnpm -F @surakkha/web test`, `pnpm -r typecheck`. All green.
- [ ] 14. Lint-fix + commit (3 commits) + push.

**Acceptance Criteria:**

1. `GET /api/incidents/:id/events` returns `{events: IncidentEventPayload[]}` sorted by `createdAt ASC`; 200 happy path is pinned in `router.spec.ts`.
2. Technician requesting `/events` for an incident they're NOT assigned to gets 403 (the same Tech-ownership contract as the parent GET). Pinned in `router.spec.ts`.
3. `404` (incident doesn't exist) returns `{error: "not_found"}` with status 404. The detail page renders `<NotFound />`. Pinned in both layers.
4. Clicking a card on the Kanban at `/incidents` navigates to `/incidents/:id` and the detail page renders. Pinned in `KanbanBoard.spec.tsx` + `IncidentDetailPage.spec.tsx`.
5. The detail page subscribes to `incident:state_changed` and mutates the row's `data-state` in place on every event — including `RESOLVED` (which keeps the row visible). Pinned in `IncidentDetailPage.spec.tsx`.

## Design Notes

**Why a separate `/events` endpoint instead of embedding in the GET response.** The existing `IncidentPayloadSchema` docstring at `packages/shared/src/incident.ts:140-153` notes that `events` is an optional embedded form — but the actual Zod schema (lines 154-165) does NOT include it. The docstring is aspirational; 4.4 honors the actual schema. Two endpoints also means the timeline can be paginated / filtered independently in the future without bumping the row's wire shape.

**Why the detail page keeps resolved rows visible.** The Kanban is the operator's "what do I need to work on next" surface — a resolved incident is done and drops off. The detail page is the operator's "what happened with this incident" surface — resolved incidents are first-class (the resolved_at timestamp is part of the row; the timeline ends with the `resolve` event). Different surfaces, different drop semantics.

**Why extract `cacheMutators.ts` instead of duplicating the cache mutation logic.** The Kanban (4.3) and the detail page (4.4) both subscribe to `incident:state_changed` and mutate TanStack Query caches. The Kanban drops resolved rows; the detail page does not. The shared shape — find row by `incident_id`, update `state` in place — belongs in one place. The divergence is the RESOLVED-handling, which lives in the per-hook wrapper.

**Why `<NotFound />` is a NEW component.** The 404 surface is the codebase's first (the Kanban never 404s because the active list is a list endpoint). Establishing the component here lets Stories 4.5 / 4.6 / 4.7 / 4.11 reuse it without each one inventing its own.

## Verification

**Commands:**

- `pnpm -F @surakkha/api test` — expected: existing green + 6-7 new `router.spec.ts` cases green.
- `pnpm -F @surakkha/web test` — expected: existing green (268+1=269) + 9 new `IncidentDetailPage.spec.tsx` cases + 1 new `KanbanBoard.spec.tsx` nav case.
- `pnpm -r typecheck` — expected: clean; no signature drift on `IncidentStateRepository`.

**Manual checks (if no CLI):**

- Boot api + web; navigate to `/incidents`. Click a card. Verify URL changes to `/incidents/:id` and the detail page renders.
- Verify the timeline renders all IncidentEvent rows for the incident in chronological order.
- Curl `POST /api/incidents/:id/acknowledge`. Verify the Kanban card moves to ACKNOWLEDGED AND the detail page's `data-state` updates without a refresh.
- Curl `POST /api/incidents/:id/resolve`. Verify the Kanban card disappears AND the detail page's row STAYS visible with `data-state="RESOLVED"`.

## Out of scope (deferred to subsequent Epic 4 sweeps)

- 4.5 (acknowledge button), 4.6 (assign UI), 4.7 (submit-result UI), 4.11 (reopen UI). The detail page surfaces the data; the buttons live in those stories.
- 4.10 (NotificationBell), 4.13 (attachments UI) — separate surfaces; no overlap with 4.4.
- Embedded `events` in the GET response — explicitly out of scope per the Design Notes rationale.
- Timeline pagination / filtering — the v1 transition model produces ≤ ~10 rows per incident.
- `Incident.assignee_user_id` column index — the detail page's read path doesn't need it for v1; add if/when query plans regress.
- Refactoring `useKanbanBoardSocket.ts` to consume `cacheMutators.ts` — out of scope for 4.4; the existing 4.3 mutator stays as-is. A future cleanup pass swaps it.

</frozen-after-approval>

## Spec Change Log

### Loop 1 (review_loop_iteration: 0 → 1)

Applied at commit `8e8be1d` on 2026-08-27 during step-04 review triage. Step-04 surfaced ~30 adversarial findings + ~25 edge-case paths + 7 verification gaps; most route to `defer` (forward-compat enum drift, intra-mount id transitions, internationalization, etc.) or `reject` (noise). The patches below are the "caused-or-exposed-by-this-change" fixes the review surfaced.

**KEEP (no spec change required — these are forward-compat / out-of-scope; defer to follow-up):**

- **`cacheMutators.ts` not consumed by `useKanbanBoardSocket.ts`** — explicit deferral per the spec's Out of Scope section. The 4.3 mutator stays as-is; a future cleanup pass swaps it. Refactor candidate.
- **Forward-compat enum drift on `IncidentEventType`** — the wire schema accepts `invalid_transition_attempt` (single underscore; canonical); a future event type would extend the enum. The page renders all event types via `JSON.stringify(payload)` so unknown types render gracefully. No change needed; project-wide enum-drift pattern.
- **Internationalization on `<NotFound />` text** — strings are hardcoded English; i18n is project-wide deferred.
- **Timeline 401-while-row-200 branch** — current behavior: the row renders + a "Failed to load timeline" copy (best-effort); the spec matrix doesn't enumerate this case. Forward-compat; document in a follow-up if users complain.
- **Intra-mount id transitions** — `useIncidentDetailSocket` re-subscribes when `:id` changes; tested manually but no test pins the unmount-then-resubscribe path. Forward-compat.

**PATCH (spec contract unchanged; code/test edits applied to close review findings):**

- **`IncidentDetailPage.tsx` — collapsed duplicate `IncidentDetailEnvelope` / `IncidentDetailRow` interfaces into one** (`IncidentDetailEnvelope` was the actual envelope, the `Row` alias was unused ceremony). Dropped `[...queryKey]` spread on the row query + invalidate call — `incidentDetailQueryKey` already returns a readonly tuple; the spread was dead work.
- **`useIncidentDetailSocket.ts` — renamed `KANBAN_SOCKET_URL` → `DEFAULT_SOCKET_URL`**. The constant is the shared dashboard socket URL, not a Kanban-domain concern; the old name leaked the Kanban naming from the detail file.
- **`NotFound.tsx` — dropped dead `not-found-back` CSS class**. The style is set inline (PRIMARY bg); no stylesheet rule references this class.
- **`router.ts` — stripped raw UUID from the timeline endpoint's error log**. The 5xx catch-all now logs `id=${row?.id ?? "missing"}` instead of the raw request param. Prevents PII in error logs if the route is ever re-targeted at an externally-supplied id.
- **`cacheMutators.spec.ts` — parametrized the no-special-case test over all 7 stable states** (was 5). The table now covers every stable state so a future state-added refactor can't silently drop a state.
- **`NotFound.spec.tsx` — NEW dedicated unit test** (4 cases). Covers the default render (role=status, aria-live=polite, default headline + message + backHref=/incidents + backLabel), the override-prop surface (headline / message / backHref / backLabel), and the back link's `href` target. The first 404 surface in the codebase now has its own contract pin — future per-entity detail pages (4.5 / 4.6 / 4.7 / 4.11) reuse this with confidence.
- **`IncidentDetailPage.spec.tsx` — renamed the timeline-404 test** from `"renders <NotFound /> when the row succeeds but the timeline returns 404"` to `"renders the row + empty timeline (NOT <NotFound />) when the timeline returns 404"` + added an `expect(screen.queryByTestId("not-found")).toBeNull()` pin. The old name lied about the contract; the actual implementation only renders NotFound on a row-level 404.

**Verification commands at the time of patch:**

- `pnpm -r typecheck` — clean.
- `pnpm -F @surakkha/api test` — 401 pass / 5 fail. The 5 failures are pre-existing in `alerts/listRouter.spec.ts` (Story 3.5 test-fixture drift; tracked as AI-3.1 in the retrospective, NOT this story's surface). All `incidents/router.spec.ts` (45 tests) including the new timeline endpoint tests pass.
- `pnpm -F @surakkha/web test` — 297 / 297 pass. Includes the new `cacheMutators` parametrized table (11 tests, was 5) and the new `NotFound.spec.tsx` (4 tests).

---

## Suggested Review Order

**Spec**

- Story 4.4 spec — intent, AC matrix, design notes (read first).
  [`spec-4-4-incident-detail-page.md:15`](spec-4-4-incident-detail-page.md#L15)

**Backend — timeline endpoint (sibling to parent GET, mirrors its RBAC + 404)**

- New `GET /api/incidents/:id/events` — RBAC + Tech-ownership + 404 + 500 patterns copied from the parent route.
  [`packages/api/src/incidents/router.ts:282`](../../packages/api/src/incidents/router.ts#L282)

- `incidentEventRowToPayload` + `IncidentEventRow` type — parallel to the existing row mapper.
  [`packages/api/src/incidents/incidentStateRepository.ts:386`](../../packages/api/src/incidents/incidentStateRepository.ts#L386)

- `findMany` adapter on the repo wiring (passthrough).
  [`packages/api/src/incidents/routerWiring.ts:94`](../../packages/api/src/incidents/routerWiring.ts#L94)

**Web — detail page composition (read-only frame)**

- Top-level page: two parallel queries + dispatch + retry.
  [`packages/web/src/incidents/IncidentDetailPage.tsx:130`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L130)

- Dispatch — picks NotFound / RbacDenied / error / skeleton / body branches from row query state.
  [`packages/web/src/incidents/IncidentDetailPage.tsx:222`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L222)

- Body — header (severity + state), definition list, timeline list.
  [`packages/web/src/incidents/IncidentDetailPage.tsx:255`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L255)

**Web — shared row-update shape + detail socket subscription**

- `applyTransitionToCachedRow` — single source of truth for the row-replacement.
  [`packages/web/src/incidents/cacheMutators.ts:30`](../../packages/web/src/incidents/cacheMutators.ts#L30)

- `applyStateChangeToDetailCache` — per-hook wrapper (keeps RESOLVED).
  [`packages/web/src/incidents/useIncidentDetailSocket.ts:70`](../../packages/web/src/incidents/useIncidentDetailSocket.ts#L70)

- Detail-page socket mount/unmount.
  [`packages/web/src/incidents/useIncidentDetailSocket.ts:89`](../../packages/web/src/incidents/useIncidentDetailSocket.ts#L89)

**Web — Kanban nav hand-off + first 404 surface**

- `KanbanBoard` one-liner: `onClick` → `useNavigate` → `/incidents/:id`.
  [`packages/web/src/incidents/KanbanBoard.tsx:269`](../../packages/web/src/incidents/KanbanBoard.tsx#L269)

- `<NotFound />` — first 404 surface; overridable props for future per-entity pages.
  [`packages/web/src/access/NotFound.tsx:40`](../../packages/web/src/access/NotFound.tsx#L40)

- Route registration in `main.tsx`.
  [`packages/web/src/main.tsx:237`](../../packages/web/src/main.tsx#L237)

**Tests — repository + endpoint + page + shared helper**

- `incidentStateRepository` spec — wire-shape mapping + null projection + mutation safety.
  [`packages/api/src/incidents/incidentStateRepository.spec.ts:241`](../../packages/api/src/incidents/incidentStateRepository.spec.ts#L241)

- `router.spec.ts` — timeline endpoint tests (ASC sort, empty envelope, 401/403/404/500, RBAC matrix).
  [`packages/api/src/incidents/router.spec.ts:810`](../../packages/api/src/incidents/router.spec.ts#L810)

- Detail page spec — 12 cases covering the I/O & Edge-Case Matrix.
  [`packages/web/src/incidents/IncidentDetailPage.spec.tsx`](../../packages/web/src/incidents/IncidentDetailPage.spec.tsx)

- Cache mutators spec — parametrized `describe.each` over `INCIDENT_STABLE_STATES` (structural pin).
  [`packages/web/src/incidents/cacheMutators.spec.ts:94`](../../packages/web/src/incidents/cacheMutators.spec.ts#L94)

- NotFound spec — first 404 surface contract pin.
  [`packages/web/src/access/NotFound.spec.tsx`](../../packages/web/src/access/NotFound.spec.tsx)

- Nav-from-Kanban test.
  [`packages/web/src/incidents/KanbanBoard.spec.tsx:438`](../../packages/web/src/incidents/KanbanBoard.spec.tsx#L438)
