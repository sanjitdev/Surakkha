# Test spec — `packages/web/src/notifications` critique loop (2026-09-02)

## Scope

Regression pins for the 2026-09-02 `/impeccable critique packages/web/src/notifications` loop.

Critique artifact: `.impeccable/critique/2026-09-02T21-00-00Z__packages-web-src-notifications.md`. Score: **25/40**. Six P1 fixes (6 narrative headers > 22 lines; 2 sentinel error classes' "Why a new class" rationale blocks; 5 "Loop N review hardening" markers in `useAdminNotificationList.ts`; cross-file line-number references in 6 files; duplicate Tailwind-JIT-caveat block in `NotificationBell.tsx`; 10-line "Optional test escape hatch" prop docstring) and ~25 P2 fixes shipped in this PR.

## Behavioural pins (UI / RTL)

### NotificationBell

| #   | Given                                                             | When          | Then                                                                                                               |
| --- | ----------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `useCurrentRole()` returns `null` (unauthenticated)               | First render  | Renders the disabled variant (`data-testid="notification-bell-disabled"`, `aria-disabled="true"`)                  |
| 2   | `viewerRole === "Viewer"`                                         | First render  | Disabled variant renders; NO fetch fires (the hook is gated by `enabled: false`)                                   |
| 3   | `viewerRole === "Admin"` and `apiFetch("/api/notifications")` 200 | First render  | `data-testid="notification-bell"` visible; `data-testid="notification-bell-badge"` absent when `unreadCount === 0` |
| 4   | `unreadCount > 0`                                                 | Render        | `data-testid="notification-bell-badge"` shows the count; `aria-live="polite"`                                      |
| 5   | Active bell, click                                                | Click         | `data-testid="notification-dropdown"` opens; `aria-expanded="true"`                                                |
| 6   | Active bell, dropdown open, Escape key                            | Keydown       | Dropdown closes                                                                                                    |
| 7   | Active bell, dropdown open, click outside                         | MouseEvent    | Dropdown closes                                                                                                    |
| 8   | Active bell, dropdown open, click row link to `/incidents/:id`    | Navigation    | Dropdown unmounts (React Router navigation); no manual close needed                                                |
| 9   | Active bell, `notifications.length === 0`                         | Open dropdown | `data-testid="notification-dropdown-empty"` ("No new notifications.")                                              |
| 10  | Active bell, `query.isError === true`                             | Open dropdown | `data-testid="notification-dropdown-error"` + retry button (`data-testid="notification-dropdown-retry"`)           |
| 11  | Dropdown retry button clicked                                     | Click         | `query.refetch()` invoked                                                                                          |
| 12  | Active bell, GET 403                                              | Render        | Disabled variant renders (`instanceof NotificationsRbacDeniedError` branch)                                        |
| 13  | Active bell, critical-severity row                                | Open dropdown | Row has literal `border-l-4 border-severity-critical-value` class                                                  |
| 14  | Active bell, warning-severity row                                 | Open dropdown | Row has literal `border-l-4 border-severity-warning-value` class                                                   |
| 15  | Active bell, info-severity row                                    | Open dropdown | Row has literal `border-l-4 border-severity-healthy-value` class                                                   |
| 16  | StrictMode double-mount                                           | Mount cycle   | Disabled path + active path each call the same number of hooks (no "rendered fewer hooks" warning)                 |

### useNotificationBell

| #   | Given                                                 | When                 | Then                                                                                                        |
| --- | ----------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| 17  | `viewerRole === "Viewer"`                             | Mount                | `enabled: false`; `refetchInterval` not started; no `apiFetch` call                                         |
| 18  | `viewerRole !== "Viewer"`, api 200 + valid envelope   | `queryFn` invocation | Returns `NotificationListEnvelope`; `notifications` array preserved; `unreadCount === notifications.length` |
| 19  | api 403                                               | `queryFn` invocation | Throws `NotificationsRbacDeniedError`                                                                       |
| 20  | api 500                                               | `queryFn` invocation | Throws `Error("/api/notifications failed: 500")`                                                            |
| 21  | api network throw                                     | `queryFn` invocation | Error propagates (NOT classified as `NotificationsRbacDeniedError`)                                         |
| 22  | `query.error instanceof NotificationsRbacDeniedError` | Render               | `notifications = []`, `unreadCount = 0` (the badge falls back to zero-unread so it doesn't mis-render)      |
| 23  | `refetchInterval`                                     | Config               | Equals `30_000` ms when enabled                                                                             |
| 24  | `UNREAD_NOTIFICATIONS_QUERY_KEY(role)`                | Call                 | Returns `["notifications", "unread", role]` as `const` (cache-identity pin)                                 |
| 25  | `countUnread([])`                                     | Call                 | Returns `0`                                                                                                 |
| 26  | `countUnread([n1, n2, n3])`                           | Call                 | Returns `3`                                                                                                 |

### useAdminNotificationList

| #   | Given                                                      | When                            | Then                                                                                                    |
| --- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 27  | api 200 + valid envelope                                   | `queryFn` invocation            | Returns `AdminNotificationListEnvelope`                                                                 |
| 28  | api 403                                                    | `queryFn` invocation            | Throws `AdminNotificationsRbacDeniedError`                                                              |
| 29  | api 500                                                    | `queryFn` invocation            | Throws `Error("/api/notifications/admin/list failed: 500")`                                             |
| 30  | api 200 + malformed envelope                               | `queryFn` invocation            | Throws `Error("/api/notifications/admin/list returned malformed envelope: ...")`                        |
| 31  | Filters: `{ severity: ["critical", "warning"] }`           | `buildAdminQueryString`         | Returns `"?severity=critical&severity=warning"` (REPEATED query param)                                  |
| 32  | Filters: `{ sincePresetMs: 60_000 }`, `now = T`            | `buildAdminQueryString`         | `since` query = `new Date(T - 60_000).toISOString()` (slides forward on each poll)                      |
| 33  | Filters: `{ since: "2026-09-01T00:00:00Z" }`               | `buildAdminQueryString`         | `since` query = `"2026-09-01T00:00:00Z"` (verbatim when `sincePresetMs` unset)                          |
| 34  | Filters: `{ severity: undefined }`                         | `buildAdminQueryString`         | No `severity=` query param                                                                              |
| 35  | Empty filters `{}`                                         | `buildAdminQueryString`         | Returns `""` (no leading `?`)                                                                           |
| 36  | Filters: `{ severity: ["critical"] }`                      | `ADMIN_NOTIFICATIONS_QUERY_KEY` | Cache key includes `severity: ["critical"]`                                                             |
| 37  | Filters: `{ since: "..." }`                                | `ADMIN_NOTIFICATIONS_QUERY_KEY` | `since` / `until` STRIPPED from cache key (request-scoped, recomputed per poll)                         |
| 38  | Filters toggle chip                                        | Re-render                       | New cache slot → TanStack Query aborts the prior in-flight fetch via `signal` propagation to `apiFetch` |
| 39  | `query.error instanceof AdminNotificationsRbacDeniedError` | Render                          | `notifications = []`, `query` error preserved (page gates `<RbacDenied />` on the `instanceof`)         |

### useMarkAsRead

| #   | Given                                 | When         | Then                                                                                                             |
| --- | ------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| 40  | api 200 + valid `NotificationPayload` | `mutationFn` | Returns the payload; on success `queryClient.invalidateQueries({ queryKey: UNREAD_NOTIFICATIONS_QUERY_KEY })`    |
| 41  | api 401                               | `mutationFn` | Throws `MarkAsReadMutationError(401, "Session expired — please sign in again")`; `onError` toast fires           |
| 42  | api 403                               | `mutationFn` | Throws `MarkAsReadMutationError(403, "Not authorized")`; cache invalidated; NO toast (per spec MARK_AS_READ_403) |
| 43  | api 404                               | `mutationFn` | Throws `MarkAsReadMutationError(404, "Notification not found")`; cache invalidated; `onError` toast fires        |
| 44  | api 500                               | `mutationFn` | Throws `MarkAsReadMutationError(500, "Failed to acknowledge notification. Try again.")`; cache NOT invalidated   |
| 45  | api network throw                     | `mutationFn` | Throws `MarkAsReadMutationError(0, "...")` (status 0 so `onError`'s range check stays valid)                     |
| 46  | `MarkAsReadMutationError.status`      | Property     | Preserved on the thrown error; `onError` reads it to discriminate                                                |

### Sentinel error classes (load-bearing invariants)

| #   | Given                                             | When   | Then                                                                                                               |
| --- | ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| 47  | `new NotificationsRbacDeniedError().name`         | Access | Equals `"NotificationsRbacDeniedError"` (stable; `useNotificationBell.spec.tsx` + cross-module asserts rely on it) |
| 48  | `new AdminNotificationsRbacDeniedError().name`    | Access | Equals `"AdminNotificationsRbacDeniedError"` (stable; `useAdminNotificationList.spec.tsx` `instanceof` assert)     |
| 49  | `new NotificationsRbacDeniedError().message`      | Access | Equals `"RBAC denied for /api/notifications"`                                                                      |
| 50  | `new AdminNotificationsRbacDeniedError().message` | Access | Equals `"RBAC denied for /api/notifications/admin/list"`                                                           |
| 51  | `throw new NotificationsRbacDeniedError()`        | Catch  | `err instanceof NotificationsRbacDeniedError === true`                                                             |
| 52  | `throw new AdminNotificationsRbacDeniedError()`   | Catch  | `err instanceof AdminNotificationsRbacDeniedError === true`                                                        |

## Static / lint pins

| #   | Property                                                                                                   | Required value                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 53  | All 6 source file opening headers                                                                          | ≤ 7 lines. Pre-loop: 22-40 lines                                                                                                                                                        |
| 54  | `NotificationsRbacDeniedError.ts` opening header                                                           | ≤ 6 lines (kept the load-bearing "name MUST stay stable" note for `instanceof` discriminator consumers)                                                                                 |
| 55  | `AdminNotificationsRbacDeniedError.ts` opening header                                                      | ≤ 7 lines (kept the load-bearing "name MUST stay stable" note for `useAdminNotificationList.spec.tsx` `instanceof` assert)                                                              |
| 56  | "Loop N review hardening" marker count in `useAdminNotificationList.ts`                                    | Exactly **0** (5 markers removed). Pre-loop: 5                                                                                                                                          |
| 57  | Cross-file line-number references (e.g. `useAcknowledgeMutation.ts:77`, `SeverityBanner.spec.tsx:458-461`) | Exactly **0** across all 6 files. Pre-loop: 7+                                                                                                                                          |
| 58  | Tailwind-JIT-caveat duplication in `NotificationBell.tsx`                                                  | Exactly **0** (canonical reference lives in `severityTokens.ts`). Pre-loop: 1                                                                                                           |
| 59  | "Optional test escape hatch" prop docstring in `NotificationBell.tsx`                                      | ≤ 4 lines (the React fallback-to-hook pattern is documented in React's docs). Pre-loop: 10                                                                                              |
| 60  | `useAdminNotificationList.ts` re-exports `AdminNotificationFilters`                                        | The `export type { AdminNotificationFilters }` line is preserved (backwards-compatibility pin for prior imports)                                                                        |
| 61  | `useAdminNotificationList.ts` wire-shape validation                                                        | `AdminNotificationListEnvelopeSchema.safeParse(raw)` runs on every fetch; failure throws with `"/api/notifications/admin/list returned malformed envelope: ..."` copy                   |
| 62  | `NotificationBell.tsx` total line count                                                                    | ≤ 380 (post-refactor). Pre-loop: 525                                                                                                                                                    |
| 63  | `useAdminNotificationList.ts` total line count                                                             | ≤ 130 (post-refactor). Pre-loop: 217                                                                                                                                                    |
| 64  | `useNotificationBell.ts` opening header                                                                    | ≤ 7 lines. Pre-loop: 35                                                                                                                                                                 |
| 65  | `useMarkAsRead.ts` opening header                                                                          | ≤ 6 lines. Pre-loop: 32                                                                                                                                                                 |
| 66  | Story-internal jargon                                                                                      | No "MARK_AS_READ_403" / "GET_403" / "GET_500" / "VIEWER_DISABLED" / "ZERO_UNREAD" / "NAV_FROM_ROW" / "CLICK_OUTSIDE" / "RBAC_NO_FETCH" / "E1" / "E5" matrix-row codes in source headers |
| 67  | Sentinel error class `.name` field                                                                         | Stable string identifier (NOT removed by minifier); documented as load-bearing                                                                                                          |

## Negative pins (regression guards)

| #   | Behaviour                                        | Must NOT happen                                                                                                                                               |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 68  | Sentinel error `.name`                           | Be renamed to `"Error"` or removed — must remain a stable discriminator string                                                                                |
| 69  | `useMarkAsRead` 4xx-not-403                      | Skip cache invalidation — must invalidate so the next refetch drops the row                                                                                   |
| 70  | `useMarkAsRead` 401 / 5xx / network              | Invalidate cache — must NOT invalidate (avoid extra round-trip on a confirmed failure)                                                                        |
| 71  | `useMarkAsRead` 403                              | Toast the operator — must stay silent (spec MARK_AS_READ_403 = "no toast (3.5 noise reduction)")                                                              |
| 72  | `NotificationBell` Viewer path                   | Mount `useNotificationBell` — must short-circuit at the parent (the hook call lives in `ActiveNotificationBell`, gated by `viewerRole !== "Viewer"`)          |
| 73  | `NotificationBell` GET_403 path                  | Mount `useState` / `useRef` / `useEffect` — must short-circuit before `OpenNotificationBell` so React's hook-order guard is preserved                         |
| 74  | `useNotificationBell` Viewer                     | Send a network request — must gate at `enabled: false` so no DevTools network-tab leak                                                                        |
| 75  | `useAdminNotificationList` cache key             | Include `since` / `until` fields — must strip them so the 30s poll doesn't key the cache on the wall-clock (which would invalidate every 30s)                 |
| 76  | `useAdminNotificationList` wire-shape validation | Skip `safeParse` and propagate `unknown` — must validate the envelope so adapter drift surfaces as a parse failure rather than silent `undefined` propagation |
| 77  | Source file headers                              | Re-introduce a 22+ line narrative block re-telling Story 4.10 / 5.1 / matrix-row codes                                                                        |
| 78  | `useAdminNotificationList`                       | Re-add "Loop 1 / Loop 2 review hardening" fix-history markers                                                                                                 |

## Verification commands

```bash
cd packages/web && npx tsc -b
cd packages/web && npx eslint src/notifications
cd packages/web && npx vitest run src/notifications
```

Existing specs: `NotificationBell.spec.tsx`, `useMarkAsRead.spec.tsx`, `useNotificationBell.spec.tsx`, `useAdminNotificationList.spec.tsx`. All must remain green; `NotificationsRbacDeniedError.name` + `AdminNotificationsRbacDeniedError.name` are load-bearing for the `instanceof` discriminator assertions in those specs.
