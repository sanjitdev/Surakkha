# Critique — `packages/web/src/notifications`

**Date:** 2026-09-02  
**Surface:** `packages/web/src/notifications/` (1 component + 3 hooks + 2 sentinel error classes)  
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File                                   | LOC       | Heuristic score    | Findings                    |
| -------------------------------------- | --------- | ------------------ | --------------------------- |
| `NotificationBell.tsx`                 | 525       | 26/40              | 1 P1 (38-line header), 6 P2 |
| `useNotificationBell.ts`               | 120       | 24/40              | 1 P1 (35-line header), 5 P2 |
| `useAdminNotificationList.ts`          | 217       | 24/40              | 1 P1 (35-line header), 6 P2 |
| `useMarkAsRead.ts`                     | 166       | 24/40              | 1 P1 (32-line header), 6 P2 |
| `NotificationsRbacDeniedError.ts`      | 32        | 28/40              | 1 P1 (26-line header), 1 P2 |
| `AdminNotificationsRbacDeniedError.ts` | 38        | 26/40              | 1 P1 (32-line header), 1 P2 |
| **Surface total**                      | **~1098** | **25/40 weighted** | **6 P1, 25 P2**             |

The notifications surface has the densest AI-slop concentration so far. Every file has a 22-40 line narrative header that re-tells the Story 4.10 / 5.1 contract (RBAC matrix, polling cadence, cache-key identity, MARK_AS_READ_403 matrix row references). The 5-line sentinel error classes carry 26-32 line rationale blocks explaining why they're separate classes. Multiple "Loop N review hardening" markers explain the bug history of `useAdminNotificationList`. The 4 hook files share a `safeParse + console.error` pattern that's mostly avoided but `useAdminNotificationList` has its own single-instance variant that can be flattened.

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

1. **All 6 source files open with 22-40 line narrative headers.** Every header re-tells the story (Story 4.10, 5.1), matrix-row references (MARK_AS_READ_403, VIEWER_DISABLED, GET_403, GET_500, RBAC_NO_FETCH, ZERO_UNREAD, NAV_FROM_ROW, CLICK_OUTSIDE, E1, E5), and references to design docs. The contract is documented in the epic + DESIGN.md; the surface is the renderer. Same anti-pattern as the previous six surfaces — readers outside the dev context cannot decode the matrix-row codes.
2. **`NotificationsRbacDeniedError.ts:5-25` + `AdminNotificationsRbacDeniedError.ts:8-32`**: 22-25 line "Why a new class (not reusing `KanbanRbacDeniedError`)" rationale blocks. The classes are 5 lines of code; the rationale lives in the critique artifact, not the source.
3. **Loop-N-review-hardening markers throughout `useAdminNotificationList.ts`.** Lines 13-20 ("Pre-Loop 1, the filter was a single-valued severity that silently dropped the filter when 2-3 chips were active…"), lines 59-66 ("Loop 2 review hardening: pre-Loop 2, `since` was in the queryKey AND frozen in the page's `useMemo` deps at first paint…"), lines 122-127 ("Loop 1 fix: pre-Loop 1 the page emitted `?severity=critical` only; 2-chip and 3-chip selections silently dropped the filter…"), lines 128-131 ("Loop 2 fix: pass an explicit `now` parameter…"), lines 158-163 ("Loop 1 review hardening (E1 + E5): Pass `queryFn`'s `signal` to `apiFetch`…"). Five separate "fix history" markers that belong in git, not source.
4. **Cross-file line-number references that drift on every refactor.** `useMarkAsRead.ts:45` ("Mirrors `useAcknowledgeMutation.ts:77`"), `useMarkAsRead.ts:49` ("Mirrors `useAcknowledgeMutation.ts:90-91`"), `useMarkAsRead.ts:71` ("Mirrors `useAcknowledgeMutation.ts:118-135`"), `useNotificationBell.ts:53-55` ("Mirrors `KANBAN_ACTIVE_QUERY_KEY` in 4.3's `useKanbanBoardSocket.ts:48`"), `useNotificationBell.ts:69-71` ("Mirrors the `filterUnsafeWithin24h` helper at `packages/web/src/incidents/useSeverityBanner.ts:110-122`"), `useAdminNotificationList.ts:69-71` ("Mirrors `UNREAD_NOTIFICATIONS_QUERY_KEY` in 4.10's `useNotificationBell.ts:57-59`"), `NotificationsRbacDeniedError.ts:11` ("Kanban's `instanceof KanbanRbacDeniedError` check at `KanbanBoard.tsx:225` is load-bearing for the SeverityBanner's cache-error assertion (`SeverityBanner.spec.tsx:458-461`)"). Every refactor breaks these references — they're a maintenance liability.
5. **`NotificationBell.tsx:34-37` Tailwind-JIT-caveat block** re-explains Story 2.8's `VG-1` lesson. Same anti-pattern as the dashboard/ surface (4 duplicates consolidated to 1). The single line in the dashboard/ header is enough; the lessons-learned belongs in the project's design-doc history.
6. **`NotificationBell.tsx:298-309` "Optional test escape hatch" prop docstring.** 10 lines explaining "the bell reads `useToasts()` by default, but a parent may inject its own `pushToast`". The pattern (fallback to a hook when no prop) is documented in React's docs; the bell's specific reason for it is a one-line comment.

### P2 — Apply before merge, won't block on its own

1. **`NotificationBell.tsx:60-65`**: "Disabled-bell testid + tooltip" 6-line comment. The `DISABLED_BELL_TESTID` + `DISABLED_BELL_TITLE` constants are self-documenting; the comment restates their purpose.
2. **`NotificationBell.tsx:69-73`**: 5-line "Severity row border class" comment with "Maps the closed enum to the existing `border-severity-{level}-value` design tokens. Literal class strings only (Story 2.8 VG-1 lesson)." — the lookup table + `as const` enum carry the meaning.
3. **`NotificationBell.tsx:92-96`**: 5-line `formatRelative` JSDoc restating "Format a notification's `createdAt` ISO string into a short 'Xm ago' / 'Xh ago' relative-time string for the dropdown rows. Pure helper (no React), easy to pin in tests." The function name + signature carry the meaning.
4. **`NotificationBell.tsx:111-115`**: 5-line `severityClasses` JSDoc ("Pure helper — group severity styling for a single row. Extracted so the dropdown rows read at one place. Literal class strings only.") — restates the return type.
5. **`NotificationBell.tsx:132-138`**: 7-line `NotificationRow` JSDoc ("`NotificationRow` — single dropdown row. Severity dot + label + incident link + relative-time + 'Mark as read' button. Clicking the incident link closes the dropdown via React Router's `<Link>` unmount cycle (NAV_FROM_ROW matrix row).") — the matrix-row reference belongs in the design doc.
6. **`NotificationBell.tsx:194-212`**: 19-line `NotificationDropdown` JSDoc. The function body is short (< 60 lines) and self-documenting; the comment re-narrates the close-on paths, the empty-state copy, the error-state copy.
7. **`NotificationBell.tsx:311-321`**: 11-line "ActiveNotificationBell" docstring. The component name + the `viewerRole !== "VIEWER"` gate carry the meaning.
8. **`NotificationBell.tsx:336-350`**: 15-line "DisabledNotificationBell" JSDoc explaining "Two sites render it: Viewer role (RBAC matrix: Viewer.read.Notification = N). GET_403 from `/api/notifications` (the spec's GET_403 matrix row: 'Bell renders disabled state (same as VIEWER_DISABLED)'…)". The constant `DISABLED_BELL_TESTID` + `DISABLED_BELL_TITLE` carry the meaning.
9. **`NotificationBell.tsx:365-371`**: 7-line "ActiveNotificationBell" JSDoc ("The Admin / Operator / Technician variant. Extracted so the Viewer's disabled surface doesn't mount the TanStack `useQuery` (the `enabled` flag is the primary gate; isolating the hook call keeps the JSX tree shallow).") — the hook-order rationale is a complex-but-correct design choice; reduce to 1 line.
10. **`NotificationBell.tsx:390-403`**: 14-line inline comment in `ActiveNotificationBell` ("Spec GET_403 — 'Bell renders disabled state (same as VIEWER_DISABLED)'. The api rejected the read mid-session (token expired, role revoked, etc.). The bell short-circuits to the shared disabled variant BEFORE mounting the click-outside effect / dropdown state, so a hook added to this component below this check would not be called on the disabled path (tripping React's 'rendered fewer hooks' guard). If you need another hook here, gate it on the same condition (or wrap this in a sub-component that owns the disabled branch). NO retry affordance — the recovery path is 'log out + log back in'.") — the hook-order concern is correct but the explanation is 14 lines; reduce to 2.
11. **`NotificationBell.tsx:418-425`**: 8-line "OpenNotificationBell" JSDoc ("Extracted so the disabled-bell render path (which lacks the useState/useRef/useEffect trio below) does not share a component identity with the open-bell render path; that would trip React's 'rendered fewer hooks' guard on transitions between enabled/disabled.") — restates the hook-order concern from #10.
12. **`NotificationBell.tsx:480-482`**: 3-line `tooltip` useMemo comment ("The role label shows on the bell's tooltip — keeps the operator aware of which role's notification list they're viewing (defense-in-depth against future role confusion).") — the tooltip string itself shows the role-aware label; the comment narrates intent that's already visible.
13. **`NotificationBell.tsx:322-327`**: 6-line "useCurrentRole may be `null` (unauthenticated). Treat that as Viewer" — the `?? VIEWER` line shows this.
14. **`NotificationBell.tsx:380-383`**: 4-line "Only call `useToasts` if no external `pushToast` was injected — keeps the hook count stable across the optional-prop boundary (always either 0 calls or 1 call to `useToasts`, never conditional). React's hook-order guard requires this." — the code structure (`const fallback = useToasts()` unconditionally, then `pushToast = pushToastProp ?? fallback.pushToast`) shows this.
15. **`useNotificationBell.ts:47-56`**: 10-line "TanStack Query key for the unread notification list" JSDoc with the cache-key defense-in-depth rationale + the cross-file `KANBAN_ACTIVE_QUERY_KEY` mirror reference.
16. **`useNotificationBell.ts:67-72`**: 6-line `countUnread` JSDoc ("Pure filter — returns the count of unread notifications. Exported for direct test coverage (mirrors the `filterUnsafeWithin24h` helper at `packages/web/src/incidents/useSeverityBanner.ts:110-122`).") — the function body is `notifications.length`.
17. **`useNotificationBell.ts:76-83`**: 8-line `useNotificationBell` JSDoc restating what the function name + signature already show.
18. **`useNotificationBell.ts:113-116`**: 4-line inline comment "On error (any kind — RBAC, 5xx, network), the bell falls back to the zero-unread state so the badge doesn't mis-render. The dropdown's 'Unable to load notifications' branch is gated on `query.isError` separately." — the `notifications = query.data?.notifications ?? []` shows this.
19. **`useNotificationBell.ts:90-100`**: 11-line `if (res.status === HTTP_FORBIDDEN)` branch comment ("RBAC denial — throw the tagged error so the bell can distinguish RBAC from generic failures without a separate `error` type. The Viewer case is gated at `enabled: false` above, so this branch is for the race condition where a Technician's token expires mid-session…") — the throw + class name show the intent; the 4-line "race condition" explanation belongs in the design doc.
20. **`useMarkAsRead.ts:10-16`**: 7-line "The spec is explicit: 'Wait for server response, then re-derive. No optimistic UI…'" inline comment — the design rationale for not optimistically updating lives in the spec.
21. **`useMarkAsRead.ts:18-32`**: 15-line "4xx classification / 5xx classification / Network throws / On 403" block in the header — every per-status branch already has its own line in `classifyMarkAsReadError`.
22. **`useMarkAsRead.ts:52-58`**: 7-line `MarkAsReadMutationError` class JSDoc ("Tagged error class for the mutation. The `.message` is the operator-facing toast copy…") — the class shape shows this.
23. **`useMarkAsRead.ts:68-72`**: 5-line `classifyMarkAsReadError` JSDoc ("Classify the api's failure response into the operator-facing copy. Mirrors `useAcknowledgeMutation.ts:118-135` with copy tailored to the mark-as-read surface.") — cross-file reference (already pinned in P1 #4).
24. **`useMarkAsRead.ts:86-96`**: 11-line `UseMarkAsReadDeps` JSDoc on the `onError` field — the prop name + type show the intent.
25. **`useMarkAsRead.ts:98-116`**: 19-line `useMarkAsRead` JSDoc restating "On success: invalidates… On 4xx failure: invalidates… On 5xx / 401 / network: no invalidation… The mutation does NOT push toasts on 403 — the spec's `MARK_AS_READ_403` matrix row pins this as 'No toast (3.5 noise reduction)'…". The body shows each branch.
26. **`useMarkAsRead.ts:144-146`**: 3-line "Spec MARK_AS_READ_403 — 'No toast (3.5 noise reduction)'" inline comment — the branch + the no-`deps.onError` call show this.
27. **`useMarkAsRead.ts:150-153`**: 4-line "4xx-not-403 failures (404 + 401) and 5xx + network: emit the toast" inline comment.
28. **`useMarkAsRead.ts:131-133`**: 3-line "Rethrow tagged errors verbatim; classify network throws as status 0 so the `onError` range check stays valid" — the catch block is 4 lines; the comment narrates every line.
29. **`useAdminNotificationList.ts:30-35`**: 6-line "On 403 the hook's `queryFn` throws `AdminNotificationsRbacDeniedError`…" header comment.
30. **`useAdminNotificationList.ts:47-52`**: 6-line "Re-export the shared filter type for backwards compatibility with imports that previously resolved the type from this file" comment — the `export type { AdminNotificationFilters }` line shows this.
31. **`useAdminNotificationList.ts:73-92`**: 20-line `ADMIN_NOTIFICATIONS_QUERY_KEY` JSDoc with "Strip request-scoped fields from the cache key…`severity` and `sincePresetMs` are the fields that drive cache-slot invalidation…" + Loop 2 review hardening narrative. The constant's strip-the-since-fields logic is documented by the destructure line.
32. **`useAdminNotificationList.ts:100-107`**: 8-line `resolveEffectiveSince` JSDoc.
33. **`useAdminNotificationList.ts:118-135`**: 18-line `buildAdminQueryString` JSDoc with Loop 1 fix + Loop 2 fix narratives (P1 #3).
34. **`useAdminNotificationList.ts:152-171`**: 20-line `useAdminNotificationList` JSDoc with the Loop 1 review hardening (E1 + E5) narrative.
35. **`useAdminNotificationList.ts:175-180`**: 6-line "Loop 2 hardening: re-derive `since` on every fetch…" inline comment.
36. **`useAdminNotificationList.ts:182-189`**: 7-line "Defense-in-depth — the route-level `<RbacRoute>` should already short-circuit a non-Admin" inline comment.
37. **`useAdminNotificationList.ts:193-198`**: 6-line "Strict shape check — pin the wire contract so adapter drift (e.g. `acknowledgedByUserId` accidentally omitted) surfaces as a parse failure…" inline comment.
38. **`useAdminNotificationList.ts:210-214`**: 5-line "On error (any kind — RBAC, 5xx, network), the page falls back to the empty-rows state…" inline comment.

### Non-findings (verified, not raised)

- `MarkAsReadMutationError` (useMarkAsRead.ts:59-66) — extends `Error` with a `status: number` field; the discriminator pattern is correct. The class is well-typed and the toast routing in `onError` reads `err.status` cleanly.
- The `useMarkAsRead` `onError` 4xx-vs-403-vs-5xx-vs-network branch logic is correct; the per-status code (lines 154-162) classifies each branch.
- `useAdminNotificationList`'s `signal` propagation to `apiFetch` (line 181) is correct — TanStack Query's `queryFn` receives `{ signal }` and the abort cleanly tears down the in-flight fetch on chip-toggle.
- `NotificationBell.tsx`'s `useToasts()` unconditional call before the `disabled` branch return is correct — React's hook-order guard requires the call site to be in the same position on every render.
- `NotificationBell.tsx`'s `useCurrentRole()` returning `null` (unauthenticated) → `Viewer` fallback is correct — the auth gate handles real unauthenticated navigation separately.
- `countUnread` returning `notifications.length` is correct — the function exists for the explicit test pin (mirrors the `filterUnsafeWithin24h` test-rig pattern).
- The `resolveEffectiveSince` exporting the `now` parameter (default `new Date()`) is correct — test-rig injection point.

## Plan

### 1. Header trim pass (all 6 files)

Each `/** ... */` opening block compresses to ≤ 6 lines stating what the file exports + which DESIGN.md section it implements. Story codes (Story 4.10, 5.1, 4.3, 4.8, 4.9), matrix-row codes (MARK_AS_READ_403, GET_403, GET_500, VIEWER_DISABLED, ZERO_UNREAD, NAV_FROM_ROW, CLICK_OUTSIDE, RBAC_NO_FETCH, E1, E5), and self-critique markers (Loop 1 / Loop 2 review hardening) move to the critique artifact (this file).

### 2. Drop the 5-line sentinel error classes' rationale blocks

The 26-32 line "Why a new class (not reusing `KanbanRbacDeniedError`)" blocks in both `*RbacDeniedError.ts` files collapse to 1 line each. The cross-module isolation decision belongs in the critique artifact + git history, not the source.

### 3. Drop cross-file line-number references

Remove all `Mirrors useAcknowledgeMutation.ts:N`, `useKanbanBoardSocket.ts:48`, `KanbanBoard.tsx:225`, `SeverityBanner.spec.tsx:458-461`, etc. references. They break on every refactor. If a cross-file mirror relationship is load-bearing for correctness, write a test that pins the contract instead.

### 4. Drop the Tailwind-JIT-caveat block from `NotificationBell.tsx:34-37`

The constant tables (`SEVERITY_BORDER_CLASS`, `SEVERITY_TEXT_CLASS`, `SEVERITY_LABEL`) are LITERAL class strings; the JIT caveat is already documented once in `severityTokens.ts` (the canonical reference after the dashboard/ refactor).

### 5. Drop `useAdminNotificationList.ts`'s 5 "Loop N review hardening" markers

5 separate fix-history markers (lines 13-20, 59-66, 122-127, 128-131, 158-163) move to the critique artifact. The current code already encodes the fixes (severity-array on the wire, since-stripped-from-cache-key, signal-propagation).

### 6. Drop inline comments that restate the JSX

~15 inline comments across the 6 files restate what the JSX / function names / type signatures already show. Keep comments that explain a non-obvious _decision_ (the hook-order boundary in `NotificationBell.tsx` is correct to keep — trim from 14 lines to 2).

## Out of scope

- The `MarkAsReadMutationError` class shape (status + message) is correct as-is.
- The `useMarkAsRead` 4xx classification per-status copy ("Not authorized", "Notification not found", "Session expired", "Failed to acknowledge") is intentional — leave the toast copy alone.
- The 30s polling interval (`POLL_INTERVAL_MS = 30_000`) is correct per spec.
- `AdminNotificationFilters` re-export for backwards compatibility is intentional — keep the re-export.

## Verification

```bash
cd packages/web && npx tsc -b
cd packages/web && npx eslint src/notifications
cd packages/web && npx vitest run src/notifications
```

Existing specs: `NotificationBell.spec.tsx`, `useMarkAsRead.spec.tsx`, `useNotificationBell.spec.tsx`, `useAdminNotificationList.spec.tsx`. All must stay green; `NotificationsRbacDeniedError.name` + `AdminNotificationsRbacDeniedError.name` are load-bearing for the `instanceof` discriminator assertions in those specs.
