---
title: "Story 4.10 — NotificationBell Dropdown"
type: "feature"
created: "2026-08-28"
status: "done"
review_loop_iteration: 0
baseline_commit: "4777b37"
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-9-notification-writer.md
  - _bmad-output/implementation-artifacts/spec-4-8-sticky-severity-banner-rbac.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.9 ships the data path that writes `Notification` rows (`packages/api/src/notifications/notificationWriter.ts:106-167`) on `notification:critical` (UNSAFE transitions) and `notification:warning` (auto-create from warning-severity alerts). The writer is in production, the rows are accumulating, and **there is no UI for an operator to see them**. `TopBar.tsx:12-13` reserves the bell placeholder ("NotificationBell (Epic 4)") but the slot is empty. Without this story, the `recipientRole: "Operator"` rows are written but unreadable — Operators can't act on critical UNSAFE follow-ups because they don't know the rows exist.

**Approach:** Mount a `NotificationBell` icon in `TopBar` (next to the role badge). Clicking it opens a dropdown panel listing the unread notifications for the current viewer. Each row shows severity, the linked `incident_id` (clickable → `/incidents/:id`), and a "Mark as read" affordance that hits `PATCH /api/notifications/:id/acknowledge`. A red unread-count badge overlays the bell icon. Backend ships two new endpoints — `GET /api/notifications` (read, role-scoped) and `PATCH /api/notifications/:id/acknowledge` (mark single read). The unread-count query subscribes to a real-time socket channel so the badge increments the moment a new `Notification` row lands.

## Boundaries & Constraints

**Always:**

- The bell mounts inside `TopBar.tsx` — NOT a new AppShell slot. The TopBar already reserves the place; `AppShell.spec.tsx`'s stacking contract (4.8) is unaffected.
- The bell uses the same `data-testid` + `role` + `aria-live` conventions as 4.8's `SeverityBanner` (`data-testid="notification-bell"` on the trigger, `role="status"` + `aria-live="polite"` on the unread badge).
- The read endpoint enforces `read × Notification` RBAC per `packages/shared/src/rbac.ts` — Viewer is `N`; Admin/Operator/Technician is `Y`. 403 returns a `KanbanRbacDeniedError`-equivalent (a new `NotificationsRbacDeniedError` class, kept separate to avoid cross-module coupling).
- The read endpoint filters by `recipientRole === viewerRole` for v1 (writer pins `recipientRole: "Operator"` today; future multi-role fan-out is deferred).
- Mark-as-read records `acknowledgedAt = NOW()` + `acknowledgedByUserId = jwt.sub.userId`. Idempotent: re-acknowledging an already-read row is a no-op (200 with the row).
- The unread-count uses the same `["notifications", "unread", role]` TanStack Query key; mark-as-read optimistically decrements the count for instant badge feedback.
- The dropdown panel uses the existing `Tailwind` design tokens (no inline colors, no template-literal class strings — Story 2.8 VG-1 lesson).
- The dropdown panel closes on: (a) clicking outside, (b) Escape key, (c) clicking a row's incident link (navigates → panel unmounts with the route change).
- Severity rows render with the existing severity color tokens — `text-severity-critical-value` for `critical`, `text-severity-warning-value` for `warning`, default for `info`.

**Ask First:**

- Whether Viewer should see ANY notification surface at all. RBAC matrix says `Viewer.read.Notification = N`. **Decision: render a disabled bell with `data-testid="notification-bell-disabled"` and a tooltip "Notifications are not available for your role."** No hidden write paths; Viewer simply gets no data and no interaction surface. Documented as known UX limitation; can revisit if a future story adds Viewer-targeted fan-out.
- Whether the dropdown should paginate. **Decision: NO pagination in v1.** Bounded by the operator's recent criticals (typically <10/day). Pagination is a follow-up.
- Whether the bell should auto-open when a new critical notification arrives. **Decision: NO auto-open** — Operators may be mid-action; the badge increments and a toast fires (existing inline toast pattern from 4.5). The user opens the dropdown when ready.

**Never:**

- Touching `packages/api/src/notifications/notificationWriter.ts` — the writer is locked from 4.9.
- Touching the Prisma `Notification` schema — fields, indexes, enums are locked.
- Adding a new socket event emission on the backend (no `notification:*` event ships with 4.10). The bell uses **polling** (TanStack `refetchInterval`) for real-time freshness until a future story wires the socket channel. Documented as deferred work.
- A toast library dependency. Inline toast only (4.5 pattern).
- Modifying `SeverityBanner` / `KanbanBoard` / `useKanbanBoardSocket` — the bell is a NEW surface.
- Tailwind template-literal classes (Story 2.8 VG-1 lesson).
- Optimistic UI that hides the row from the dropdown on mark-as-read before the server returns — a failed PATCH would leave the operator thinking they acknowledged when they didn't. Wait for server response, then re-derive.

## I/O & Edge-Case Matrix

| Scenario                  | Input / State                                                                                                              | Expected Output / Behavior                                                                                                                                                                                          | Error Handling                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `HAPPY_PATH_OPERATOR`     | Operator viewer, 3 unread notifications (2 critical + 1 warning).                                                          | Bell renders with red badge `"3"`. Click opens dropdown listing all 3 rows in reverse-chronological order (newest first). Each row shows severity + incident link.                                                  | N/A                                                         |
| `ZERO_UNREAD`             | Operator viewer, 0 unread notifications.                                                                                   | Bell renders WITHOUT badge. Click opens dropdown with `"No new notifications."` empty state.                                                                                                                        | N/A                                                         |
| `HAPPY_PATH_ADMIN`        | Admin viewer, 1 unread critical.                                                                                           | Bell renders with badge `"1"`. Dropdown lists the row.                                                                                                                                                              | N/A                                                         |
| `HAPPY_PATH_TECHNICIAN`   | Technician viewer, 0 unread (writer pins `recipientRole: "Operator"`; Technicians get no rows today).                      | Bell renders WITHOUT badge. Dropdown empty state.                                                                                                                                                                   | N/A — defer multi-role fan-out                              |
| `VIEWER_DISABLED`         | Viewer role.                                                                                                               | Bell renders as a DISABLED icon (`data-testid="notification-bell-disabled"`, `aria-disabled="true"`, no badge, no dropdown, no click handler). Tooltip via `title="Notifications are not available for your role."` | RBAC gated at UI layer; backend never receives the request. |
| `MARK_AS_READ_HAPPY`      | Operator clicks "Mark as read" on a single critical row.                                                                   | PATCH fires. On 200: row disappears from the unread list (re-fetched), badge decrements. Optimistic update via TanStack mutation on success (NOT before).                                                           | N/A                                                         |
| `MARK_AS_READ_IDEMPOTENT` | Operator clicks "Mark as read" on a row that's already `acknowledgedAt != null`.                                           | PATCH returns 200 with the existing row; UI is a no-op (row already filtered out of unread list).                                                                                                                   | N/A                                                         |
| `MARK_AS_READ_403`        | Operator tries to mark-as-read a notification not addressed to their role (race: a different role's row briefly surfaces). | PATCH returns 403; bell re-fetches; row stays unread. No toast (3.5 noise reduction).                                                                                                                               | Re-fetch unread list.                                       |
| `MARK_AS_READ_500`        | PATCH returns 500.                                                                                                         | Inline toast `toast-error-ack-failed`. Bell re-fetches to recover. Row stays unread.                                                                                                                                | Toast + re-fetch.                                           |
| `GET_403`                 | Operator's JWT expires mid-session; refresh fails.                                                                         | GET `/api/notifications` returns 403. Bell renders disabled state (same as `VIEWER_DISABLED`).                                                                                                                      | UI gates on 403; no toast.                                  |
| `GET_500`                 | Server returns 500.                                                                                                        | Bell renders WITHOUT badge (query is in error state; `data ?? []` fallback). Dropdown shows `"Unable to load notifications. Click to retry."` with a retry button.                                                  | Inline retry button calls `query.refetch()`.                |
| `NETWORK_OFFLINE`         | Connection drops.                                                                                                          | Bell continues to show last-known state (cached). Re-validates on reconnect (TanStack default `refetchOnReconnect: true`).                                                                                          | ConnectionStateBanner (2.9) covers the global offline UX.   |
| `POLL_TICK`               | TanStack `refetchInterval: 30_000` ticks while dropdown is closed.                                                         | Query refetches. Badge updates if new rows arrived. No re-render of dropdown (it's unmounted).                                                                                                                      | N/A                                                         |
| `POLL_TICK_OPEN`          | Dropdown is OPEN; `refetchInterval` continues to tick.                                                                     | Dropdown re-derives on each tick (preserves user scroll position via React keyed identity).                                                                                                                         | N/A                                                         |
| `CLICK_OUTSIDE`           | Dropdown is open; user clicks outside the bell + panel.                                                                    | Dropdown closes. Unread count persists.                                                                                                                                                                             | N/A                                                         |
| `ESCAPE_KEY`              | Dropdown is open; user presses Escape.                                                                                     | Dropdown closes. Unread count persists.                                                                                                                                                                             | N/A                                                         |
| `NAV_FROM_ROW`            | User clicks the incident link inside a dropdown row.                                                                       | React Router navigates to `/incidents/:id`; AppShell re-renders with the route change; dropdown unmounts.                                                                                                           | N/A                                                         |
| `RBAC_VIEWER_NO_FETCH`    | Viewer role.                                                                                                               | NO network request fires (UI gates the read). No data leaked via DevTools network tab.                                                                                                                              | UI gate prevents backend 403.                               |
| `MOUNT_UNMOUNT`           | AppShell mounts; bell mounts; user logs out; AppShell unmounts.                                                            | Query tears down. No orphan timers (TanStack GC).                                                                                                                                                                   | N/A                                                         |

</frozen-after-approval>

## Code Map

**Shared (`packages/shared/`):**

- `src/notification.ts` — NEW. `NotificationPayloadSchema` (wire shape: drops `acknowledgedByUserId`; keeps `id`, `severity`, `incidentId`, `alertId`, `recipientRole`, `createdAt`, `acknowledgedAt`). `NotificationListEnvelopeSchema` (`{ notifications: NotificationPayload[] }`). Re-export `NotificationSeverityEnum` from `@prisma/client`-equivalent shared enum (mirror `IncidentStateSchema` pattern at `incident.ts:15-25`).
- `src/rbac.ts` — MODIFY. Add `acknowledge: { Notification: Y }` row for Admin/Operator/Technician (Viewer stays `N`); the mark-as-read endpoint enforces this.

**Backend (`packages/api/`):**

- `src/notifications/notificationRepository.ts` — NEW. Narrow Prisma slice: `notification.findMany({ where: { recipientRole, acknowledgedAt: null }, orderBy: { createdAt: "desc" }, take: 50 })` + `notification.update({ where: { id }, data: { acknowledgedAt, acknowledgedByUserId } })` + `notification.findUnique({ where: { id } })`. Pure functions; mirrors the 4.4 `incidentStateRepository` pattern.
- `src/notifications/notificationRowToPayload.ts` — NEW. Pure adapter; mirrors `incidentRowToPayload` at `incidentStateRepository.ts:328-352`.
- `src/notifications/notificationRouter.ts` — NEW. Two routes:
  - `GET /api/notifications` — `authenticate` + `authorize({ action: "read", resource: "Notification" })` → `findMany({ where: { recipientRole: req.user.role } })` → envelope.
  - `PATCH /api/notifications/:id/acknowledge` — `authenticate` + `authorize({ action: "acknowledge", resource: "Notification" })` → `findUnique` → 404 if missing → 403 if `row.recipientRole !== req.user.role` (NOT in matrix; runtime check) → `update({ acknowledgedAt: NOW(), acknowledgedByUserId: req.user.id })` → row payload. Idempotent: already-acknowledged row returns 200 with the row (NOT a 409).
- `src/notifications/notificationRouter.spec.ts` — NEW. ~9 tests: GET happy-path (Operator + 3 rows), GET empty, GET Viewer 403, GET no auth 401, GET 500, PATCH happy-path, PATCH idempotent (already-acknowledged), PATCH 403 cross-role, PATCH 404.
- `src/notifications/notificationRepository.spec.ts` — NEW. ~3 tests: pure-helper coverage on the filter (`recipientRole` + `acknowledgedAt: null`), the update shape, and the findUnique-by-id shape. Uses the 4.4 `makeMockRepo` pattern.
- `src/notifications/index.ts` — NEW. Barrel export for `notificationRouter` + `notificationRepository`.
- `src/notifications/notificationWriter.ts` — NO CHANGE. Locked from 4.9.
- `src/index.ts` — MODIFY. Mount the new `notificationRouter` (alongside the incidents mount at line 658).

**Web (`packages/web/`):**

- `src/notifications/useNotificationBell.ts` — NEW. TanStack `useQuery` for the unread list: key `["notifications", "unread", viewerRole]`, `refetchInterval: 30_000`, `staleTime: 0`. Returns `{ notifications, unreadCount, query }`. Filters at the helper boundary: `state.error instanceof NotificationsRbacDeniedError → query.data ?? []` fallback (zero unread, Viewer-disabled UI).
- `src/notifications/useMarkAsRead.ts` — NEW. TanStack `useMutation` wrapping `apiFetch("/api/notifications/:id/acknowledge", { method: "PATCH" })`. On success: `queryClient.invalidateQueries({ queryKey: ["notifications", "unread", viewerRole] })`. On 403: re-fetch + no toast (3.5 noise reduction). On 500: emit inline toast via the 4.5 pattern.
- `src/notifications/NotificationsRbacDeniedError.ts` — NEW. Class mirroring `KanbanRbacDeniedError` (cross-module isolation; avoids coupling bell RBAC semantics to the Kanban's).
- `src/notifications/NotificationBell.tsx` — NEW. The component.
  - For Viewer: returns `<button data-testid="notification-bell-disabled" aria-disabled="true" title="..." />` (icon + dim).
  - For Admin/Operator/Technician: returns `<button data-testid="notification-bell" onClick={toggleDropdown}>` + `<span data-testid="notification-bell-badge">{unreadCount}</span>` (red badge when count > 0) + `<NotificationDropdown open={open} notifications={...} onClose={...} />` when open.
  - The dropdown is a `<div role="dialog" aria-label="Notifications">` panel positioned absolute below the bell. Click-outside + Escape close it.
- `src/notifications/NotificationBell.spec.tsx` — NEW. ~10 tests mirroring `SeverityBanner.spec.tsx`'s rig: happy-path Operator, zero-unread, Viewer-disabled (no fetch), Admin, Technician, mark-as-read happy, mark-as-read idempotent, mark-as-read 403 (re-fetch, no toast), GET 500 (retry button), poll-tick refresh.
- `src/shell/TopBar.tsx` — MODIFY. Replace the placeholder comment with `<NotificationBell />`. Add a `data-testid="notification-bell-slot"` wrapper div (NOT inside AppShell's slot hierarchy — TopBar is its own layout block).
- `src/shell/TopBar.spec.tsx` — MODIFY. Add 1 test: `notification-bell` mounts as a direct child of `notification-bell-slot`.

## Tasks & Acceptance

**Execution:**

- [x] 1. Write spec doc (this file). Status: draft.
- [x] 2. Create `packages/shared/src/notification.ts` — `NotificationPayloadSchema` + `NotificationListEnvelopeSchema` + `NotificationSeveritySchema`.
- [x] 3. Modify `packages/shared/src/rbac.ts` — add `acknowledge.Notification = Y` for Admin/Operator/Technician.
- [x] 4. Create `packages/api/src/notifications/notificationRowToPayload.ts` + `notificationRepository.ts` (narrow slice).
- [x] 5. Create `packages/api/src/notifications/notificationRouter.ts` (GET + PATCH) + `notificationRouter.spec.ts` (~9 tests) + `notificationRepository.spec.ts` (~3 tests).
- [x] 6. Modify `packages/api/src/index.ts` — mount `notificationRouter`.
- [x] 7. Create `packages/web/src/notifications/NotificationsRbacDeniedError.ts`.
- [x] 8. Create `packages/web/src/notifications/useNotificationBell.ts` + `useMarkAsRead.ts`.
- [x] 9. Create `packages/web/src/notifications/NotificationBell.tsx` + `NotificationBell.spec.tsx` (~10 tests).
- [x] 10. Modify `packages/web/src/shell/TopBar.tsx` — mount `<NotificationBell />` + slot wrapper + `TopBar.spec.tsx` direct-child test.
- [x] 11. Run `pnpm --filter @surakkha/api test`, `pnpm -F @surakkha/web test`, `pnpm -r typecheck`. Lint-fix any failures.
- [x] 12. Commit `feat(Story 4.10): NotificationBell dropdown + read/ack endpoints` with the standard trailer.
- [x] 13. Step-04 review (3 parallel reviewers: adversarial, edge-case-hunter, verification-gap). Triage findings. Apply patches as `fix(Story 4.10): review fixes — <list>`.
- [x] 14. Append `## Suggested Review Order`. Flip status to `done`. Update `sprint-status.yaml`. Commit `chore(spec): mark Story 4.10 done + append Suggested Review Order`.

**Acceptance Criteria:**

1. The `<NotificationBell />` mounts inside `TopBar` for Admin, Operator, and Technician viewers with `data-testid="notification-bell"`; for Viewer it mounts the disabled variant `data-testid="notification-bell-disabled"`. Pinned in `NotificationBell.spec.tsx`.
2. The bell renders a badge `<span data-testid="notification-bell-badge">N</span>` when unread count > 0; no badge when count === 0. Pinned in `NotificationBell.spec.tsx`.
3. Clicking the bell toggles a dropdown panel listing all unread notifications in reverse-chronological order, each row showing severity color + incident link. Pinned in `NotificationBell.spec.tsx`.
4. The dropdown closes on click-outside, Escape key, and clicking a row's incident link. Pinned in `NotificationBell.spec.tsx`.
5. `GET /api/notifications` returns `{ notifications: NotificationPayload[] }` filtered by `recipientRole === req.user.role` for Admin/Operator/Technician; returns 403 for Viewer; returns 401 for unauthenticated. Pinned in `notificationRouter.spec.ts`.
6. `PATCH /api/notifications/:id/acknowledge` records `acknowledgedAt` + `acknowledgedByUserId`, returns 200 with the row; idempotent on already-acknowledged rows; returns 403 cross-role; returns 404 for missing id. Pinned in `notificationRouter.spec.ts`.
7. The bell's `useQuery` polls every 30 seconds via `refetchInterval` so the badge increments without user action. Pinned in `useNotificationBell.spec.ts` (or `NotificationBell.spec.tsx` with a fake-timer test).
8. Mark-as-read optimistically invalidates the unread query on success (badge decrements). Pinned in `NotificationBell.spec.tsx`.
9. The bell does NOT fetch for Viewer viewers (UI gate prevents the network request; no 403 in DevTools). Pinned in `NotificationBell.spec.tsx` (`VIEWER_DISABLED`).
10. The bell renders a retry button on `GET` 500 with no badge. Pinned in `NotificationBell.spec.tsx`.
11. The bell uses `border-severity-critical-value` + `text-severity-critical-value` design tokens for critical rows (no inline colors, no template-literal Tailwind classes). Pinned in `NotificationBell.spec.tsx` (class-string assertion).
12. The bell's notification-fetch `queryFn` throws `NotificationsRbacDeniedError` on 403 (mirror of the 4.8 `KanbanRbacDeniedError` pattern). Pinned in `useNotificationBell.spec.ts` (`HTTP_FORBIDDEN` path).

## Spec Change Log

Append-only. Populated by step-04 during review loops. Empty until the first bad_spec loopback.

## Design Notes

**Why the bell mounts in `TopBar`, not as a new `AppShell` slot.** The 4.8 retro reinforced AppShell's stacking contract: each slot has a strict stacking order (connection-state above severity-banner above TopBar above canvas). Adding a bell slot there would either (a) break the stacking order (bell belongs ABOVE TopBar, not below) or (b) require a third banner slot. TopBar already reserves the bell placeholder (`TopBar.tsx:12-13`); mounting it there keeps AppShell's stacking contract intact and matches the bell's "global header affordance" UX class.

**Why polling (`refetchInterval: 30_000`) instead of a socket subscription.** The writer emits `notification:critical` events to a Prisma row but does NOT emit a `notification:*` socket event on the backend (confirmed by full-tree grep of `packages/api/src/**`). Wiring a socket channel would require backend changes (emit on every `writeNotification` call) — which violates the "Don't touch `notificationWriter.ts`" constraint. Polling is the load-bearing decision for v1: 30 seconds is fast enough for operator UX, slow enough to not hammer the API, and degrades gracefully on flaky networks (TanStack's `refetchOnReconnect: true` handles the offline path). A future story that wires the socket channel can swap polling out — the cache-key contract is the seam.

**Why Viewer gets a disabled bell (not a hidden bell).** Three reasons. First, RBAC matrix says `Viewer.read.Notification = N` — hiding the bell entirely would mean a Viewer doesn't know the feature exists. Second, the disabled variant with a tooltip explains WHY the feature is unavailable ("Notifications are not available for your role"), which is a better operator-UX signal than absence. Third, the disabled bell is a stable mount — no layout shift if/when a future story adds Viewer-targeted notifications (the slot stays put; the disabled state becomes enabled). This matches the Epic 6 "graceful degradation" principle.

**Why mark-as-read is a separate endpoint (`PATCH`), not a query param on `GET`.** Two reasons. First, REST semantics: `GET` is safe + idempotent; `PATCH` is the right verb for a partial-state mutation. Second, audit trail: the `acknowledgedAt` + `acknowledgedByUserId` fields are a record of who acknowledged what when — they belong in a separate write that emits `AuditLog` (per 4.2's pattern). A future story may thread `auditWrite` into the PATCH; for v1 the columns are populated but no `AuditLog` row is written (notification-acknowledgement is a soft action, not a state transition).

**Why `NotificationsRbacDeniedError` is a new class (not reusing `KanbanRbacDeniedError`).** Cross-module isolation. The Kanban's `instanceof KanbanRbacDeniedError` check at `KanbanBoard.tsx:218-220` is load-bearing for the SeverityBanner's cache-error assertion (`SeverityBanner.spec.tsx:458-461`). Coupling the bell's RBAC semantics to that class would either (a) introduce a circular import between `notifications/` and `incidents/` modules or (b) require the bell to import from `incidents/KanbanRbacDeniedError` — a leaky boundary. A new class is 5 lines and keeps the modules decoupled. The shared invariant is "throw the same HTTP status (403)"; the class identity is per-module.

**Why `recipientRole: "Operator"` is the only fan-out target today (not multi-role).** The 4.9 writer pins `recipientRole: "Operator"` in both call sites (`notificationWriter.ts:121, 133, 160`). The bell's read filter is `recipientRole === viewerRole` — which means ONLY Operators see notifications today. Admin + Technician viewers get an empty list. This matches v1's "Operator is the on-call escalation channel" contract; the bell surface ships the read path so that the future fan-out story (multi-role notification distribution) only has to touch the writer's `recipientRole` pin. Documented as deferral.

**Why the dropdown panel uses `role="dialog"`.** A dropdown panel with focusable rows is a dialog surface per WAI-ARIA 1.2. `role="dialog"` + `aria-label="Notifications"` + Escape-to-close + click-outside-to-close is the standard pattern. The 4.5 "Acknowledge" button (which opens a confirm modal) is precedent; the bell reuses the same a11y vocabulary.

## Verification

**Commands:**

- `pnpm -F @surakkha/api test` — expected: green; `notificationRouter.spec.ts` adds ~9 tests, `notificationRepository.spec.ts` adds ~3 tests. Pre-existing 5 Story 3.5 alerts/list failures (AI-3.1) are unrelated — documented, not fixed.
- `pnpm -F @surakkha/web test` — expected: existing 391 + ~10 new (NotificationBell) + ~1 new (TopBar slot) = ~402 green.
- `pnpm -r typecheck` — expected: clean across 4 active packages (`api`, `web`, `shared`, `simulator`; `prisma` is typecheck-skipped).

**Manual checks (if no CLI):**

- Boot api + web; seed incidents; trigger an UNSAFE outcome → wait 30 seconds → verify bell badge increments.
- Click bell → verify dropdown lists the row → click "Mark as read" → verify badge decrements.
- Switch role to Viewer → verify bell renders disabled with tooltip; verify NO network request in DevTools.
- Click outside the dropdown → verify it closes.
- Press Escape → verify it closes.
- Navigate to `/incidents/:id` via the dropdown's row link → verify URL changes and dropdown unmounts.

## Suggested Review Order

A reviewer should walk the change in this order to catch the load-bearing seams first:

1. **Wire schema** — `packages/shared/src/notification.ts`. The wire payload drops `acknowledgedByUserId` (audit lives in DB). Read this BEFORE the router — the router's `notificationRowToPayload` is the only path that builds the wire row.
2. **RBAC matrix** — `packages/shared/src/rbac.ts`. The matrix grants `acknowledge.Notification` to Admin/Operator/Technician (Viewer = N). The reader must confirm this is the load-bearing cell before reading the router (the matrix is the canonical authority source per Story 1.1).
3. **Notification router** — `packages/api/src/notifications/notificationRouter.ts`. Two routes, GET + PATCH. The cross-role RBAC check (`row.recipientRole !== actorRole → 403`) lives inside the handler (NOT middleware) because the matrix grants role-level access; the per-row ownership check is the handler's job.
4. **Notification repository** — `packages/api/src/notifications/notificationRepository.ts`. Narrow Prisma slice. The `updateMany({ where: { id, acknowledgedAt: null }, data: { ... } })` is the compare-and-set point — the `acknowledgedAt: null` predicate is what makes the PATCH idempotent.
5. **NotificationsRbacDeniedError** — `packages/web/src/notifications/NotificationsRbacDeniedError.ts`. New class (not reusing `KanbanRbacDeniedError`) — cross-module isolation. The `name` field is load-bearing for the bell's `queryFn` 403 path.
6. **useNotificationBell** — `packages/web/src/notifications/useNotificationBell.ts`. The cache key is `["notifications", "unread", viewerRole]` — role-scoped so Admin and Operator counts never collide. `enabled: viewerRole !== "Viewer"` is the UI gate that prevents Viewer fetches.
7. **useMarkAsRead** — `packages/web/src/notifications/useMarkAsRead.ts`. 4xx classification: 403→no-toast+re-fetch (3.5 noise reduction), 404→toast+re-fetch, 401→"Session expired", 5xx→toast. The mutation does NOT touch the cache directly; it relies on invalidate + refetch so the server's verdict is the source of truth.
8. **NotificationBell** — `packages/web/src/notifications/NotificationBell.tsx`. Top-level export branches on Viewer (disabled variant, no fetch) vs Admin/Operator/Technician (active variant, full dropdown). Tailwind literal class strings only.
9. **TopBar mount** — `packages/web/src/shell/TopBar.tsx`. Bell mounts inside its own `data-testid="notification-bell-slot"` wrapper inside the right cluster (NOT inside AppShell's slot hierarchy).
10. **Spec doc + ACs** — `_bmad-output/implementation-artifacts/spec-4-10-notificationbell-dropdown.md`. Each AC bullet maps to a specific test file.
