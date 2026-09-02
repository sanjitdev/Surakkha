# Critique — `packages/web/src/` remaining feature dirs

**Date:** 2026-09-02
**Surface:** 13 dirs, ~30 files, ~2300 LOC
**Scoring:** Nielsen 10-heuristics + AI-slop detection

## Scope

```
packages/web/src/access/             — RBAC route guards + NotFound + RbacDenied
packages/web/src/admin-notifications/ — AdminNotificationsPage (audit-lens surface)
packages/web/src/attachments/        — 6 source files (hooks + form + list + section)
packages/web/src/audit-log/          — useAuditLogList + tagged error
packages/web/src/components/         — KpiStat + IncidentCard.types + barrel
packages/web/src/dashboard/          — already refined in 1a55995 (skipped)
packages/web/src/forms/              — FormField primitive
packages/web/src/notifications/      — already refined in c75cec7 (skipped)
packages/web/src/realtime/           — backoffTimer + connectionStateStore + socketClient + useConnectionState
packages/web/src/shell/              — already refined in 570ab41 (skipped)
packages/web/src/auth/               — jwtDecode + tokenStore already refined in 267051e (skipped)
packages/web/src/queryClient.ts      — TanStack Query setup
packages/web/src/main.tsx            — SPA boot, router
packages/web/src/test-setup.ts       — vitest setup
```

Spec files (`*.spec.ts`, `tokens.spec.ts`) out of scope.

## Files SKIPPED (already refined in prior loops)

- `packages/web/src/dashboard/*` (commit `1a55995`)
- `packages/web/src/notifications/*` (commit `c75cec7`)
- `packages/web/src/auth/jwtDecode.ts` + `tokenStore.ts` + `LoginShell.tsx` + `CurrentRoleContext.tsx` (commit `267051e`)
- `packages/web/src/shell/*` (commit `570ab41`)
- All `*.spec.ts`, `*.spec.tsx`, `tokens.spec.ts` (per "Spec files out of scope" rule)

## Files IN scope (this loop)

| #   | Path                                           | LOC | Orig header |
| --- | ---------------------------------------------- | --- | ----------- |
| 1   | access/NotFound.tsx                            | 58  | 23 lines    |
| 2   | access/RbacRoute.tsx                           | 36  | 17 lines    |
| 3   | access/RbacDenied.tsx                          | 134 | 36 lines    |
| 4   | admin-notifications/AdminNotificationsPage.tsx | 463 | 32 lines    |
| 5   | attachments/useAttachments.ts                  | 95  | 28 lines    |
| 6   | attachments/useCreateAttachment.ts             | 158 | 35 lines    |
| 7   | attachments/useDeleteAttachment.ts             | 144 | 33 lines    |
| 8   | attachments/AttachmentForm.tsx                 | 200 | 37 lines    |
| 9   | attachments/AttachmentList.tsx                 | 153 | 34 lines    |
| 10  | attachments/AttachmentsSection.tsx             | 234 | 34 lines    |
| 11  | audit-log/AdminAuditLogRbacDeniedError.ts      | 38  | 31 lines    |
| 12  | audit-log/useAuditLogList.ts                   | 243 | 26 lines    |
| 13  | components/IncidentCard.types.ts               | 160 | 40 lines    |
| 14  | components/KpiStat.tsx                         | 129 | 21 lines    |
| 15  | components/index.ts                            | 13  | 8 lines     |
| 16  | forms/FormField.tsx                            | 110 | 16 lines    |
| 17  | realtime/backoffTimer.ts                       | 48  | 30 lines    |
| 18  | realtime/connectionStateStore.ts               | 84  | 34 lines    |
| 19  | realtime/socketClient.ts                       | 273 | 43 lines    |
| 20  | realtime/useConnectionState.ts                 | 41  | 24 lines    |
| 21  | queryClient.ts                                 | 28  | 13 lines    |
| 22  | main.tsx                                       | 357 | 25 lines    |
| 23  | test-setup.ts                                  | 9   | 7 lines     |

## Findings (scored 1-4 per heuristic, weighted /40 — per-file averaged)

| #   | Heuristic        | Avg | Note                                                                                                                                                                                              |
| --- | ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visibility       | 4   | Status surfaces via role-correct fields; no `console.*` drift                                                                                                                                     |
| 2   | Match real world | 4   | Hooks read like TanStack idioms, components read like shadcn-disavowed hand-rolled                                                                                                                |
| 3   | User control     | 4   | `onSessionLost` / `onOffline` / `onClose` injection seams all present                                                                                                                             |
| 4   | Consistency      | 2   | "(Story X.Y)" header bloat inconsistent across files (realtime/\*.ts heaviest)                                                                                                                    |
| 5   | Error prevention | 4   | `safeParse` (Zod) + `Math.max(0, Math.floor)` + backoff cap all correct                                                                                                                           |
| 6   | Recognition      | 2   | Cross-file refs to other stories + AC-N markers restate the contract                                                                                                                              |
| 7   | Flexibility      | 4   | `configureApiClient` + `viewerRole` + `pushToast` injection seams correct                                                                                                                         |
| 8   | Minimalist       | 1   | **Heaviest offenders**: socketClient (43-line header), RbacDenied (36), useCreateAttachment (35), useDeleteAttachment (33), AttachmentsSection (34), useAttachments (28), IncidentCard.types (40) |
| 9   | Recoverability   | 4   | Single-flight refresh + invalidate-on-success + defense-in-depth RBAC intact                                                                                                                      |
| 10  | Help docs        | 1   | All rationale lives in code comments; zero external docs reference these comment walls                                                                                                            |

**Weighted average: 29/40.**

## AI-slop detection

### P1 (block merge) — duplication + restate-the-code blocks

- **P1-1: `socketClient.ts` header (43 lines)** — restates Story 1.7 + 2.9 AC, the 4-step reconnect flow walk-through, the `auth.token` payload note, the `path: "/ingest/"` namespace story-history with cross-ref to `packages/api/src/index.ts isSubscriberConnection`, AND the "Why we never unmount" rationale. Trim to ≤10 lines.
- **P1-2: `RbacDenied.tsx` 36-line header** — restates EXPERIENCE.md §RBAC denied contract + Accessibility Floor + Story 6.11 Riley persona fix + the 403-prose-not-literal-status rationale + `complexity: 10` ESLint rationale that explains why a helper was extracted. Trim to ≤6 lines.
- **P1-3: `IncidentCard.types.ts` 40-line header** — restates Epic 2/3 contract pattern + three "Locked facts" (6 reasons why types-only) + AC5-AC9 cross-ref. The `STATE_SLOTS` lookup is the contract; the 40-line essay restates it. Trim to ≤6 lines.
- **P1-4: `AttachmentsSection.tsx` 34-line header + 27-line secondary block** — restates the RBAC contract per role + "Why a prop" + "hooks owned here" + Tailwind constraint repeated from `useAttachments:32`. Two restate-the-code blocks. Trim primary to ≤6 lines, drop secondary entirely.
- **P1-5: `useAttachments.ts` 28-line header + 16-line `ATTACHMENTS_QUERY_KEY` doc-block + 14-line secondary header** — three separate "why" essays for a TanStack query. Trim to ≤6 lines + ≤3 lines + ≤6 lines.
- **P1-6: `useCreateAttachment.ts` 35-line header** — restates `useMarkAsRead.ts:140-141` invalidate-on-success pattern + 4xx classification + why no optimistic insert + 5xx branch. Trim to ≤6 lines.
- **P1-7: `useDeleteAttachment.ts` 33-line header + 14-line secondary header** — same pattern as P1-6 (mutation = 4xx classify + invalidate). Trim to ≤6 + ≤6.
- **P1-8: `AttachmentForm.tsx` 37-line header + 12-line secondary header** — restates the validateHttpUrl shared-helper invariant + the inline-form pattern + 4 contract bullets + 3 submit-feedback bullets. Trim to ≤6 + ≤6.
- **P1-9: `AttachmentList.tsx` 34-line header + 14-line secondary header** — XSS_LABEL row narrative + Tailwind constraint repeated + 7-bullet RBAC row-delete contract. Trim to ≤6 + ≤4.
- **P1-10: `AdminAuditLogRbacDeniedError.ts` 31-line header** — 3 reasons to introduce a sibling class + 5-line "indirection benefit is large" + "name field MUST stay stable" stability annotation repeated later. Trim to ≤8 lines.

### P2 (apply before merge) — review markers + cross-refs

#### Story codes / AC-N codes / AC-X / F-P# / Patch / "distilled" / Loop-N / Step-NN

- **access/NotFound.tsx:2**: `404 not-found empty state — Surakkha web (Story 4.4)` — strip
- **access/NotFound.tsx:3-9**: `Mirrors the RbacDenied shape from access/RbacDenied.tsx so the two empty-state pages share the same visual language` — strip "Mirrors the X shape" narrative
- **access/NotFound.tsx:11-18**: `Why a dedicated component (and not a re-use of RbacDenied)...` — strip
- **access/RbacRoute.tsx:2**: `RbacRoute — Surakkha web (Story 1.6)` — strip
- **access/RbacRoute.tsx:3-8**: `consults the same NAV_GROUPS role list the sidebar hides by` — strip
- **access/RbacRoute.tsx:9-13**: `Why a thin wrapper (and not a <Navigate> redirect)` — strip
- **access/RbacRoute.tsx:14-17**: `server-side authoritative check is Story 1.5's RBAC middleware; this client gate is the visible mirror. Story 1.7's interceptor also routes 403` — strip
- **access/RbacRoute.tsx:31-33**: `// Story 6.11 — thread the role through` — strip
- **access/RbacDenied.tsx:2**: `RBAC denied empty state — Surakkha web (Story 1.6)` — strip
- **access/RbacDenied.tsx:27-36**: `Story 6.11 — Riley persona fix. The previous default back-label was...` — strip narrative
- **admin-notifications/AdminNotificationsPage.tsx:2**: `AdminNotificationsPage — Story 5.1` — strip
- **admin-notifications/AdminNotificationsPage.tsx:17-21**: `The chip row is the Loop-1 fix surface` — strip "Loop-1"
- **admin-notifications/AdminNotificationsPage.tsx:23-31**: `RBAC double-defense` block — strip
- **admin-notifications/AdminNotificationsPage.tsx:32**: `Read-only. No mark-as-read affordance — the bell owns that.` — strip
- **admin-notifications/AdminNotificationsPage.tsx:84-89**: `Loop 2 hardening: the hook re-derives` — strip "Loop 2 hardening"
- **admin-notifications/AdminNotificationsPage.tsx:152-165**: long in-function comment about useMemo + "without useMemo the IIFE would return a fresh object... infinite refetch loop" — strip narrative; the comment block is essentially restating the function
- **admin-notifications/AdminNotificationsPage.tsx:181-183**: `// Story 6.11 — read the viewer's role` — strip
- **admin-notifications/AdminNotificationsPage.tsx:243-258**: `Loop 1 review finding E3: the custom preset is a no-op v1 stub` block + `Critique 2026-08-31 finding: a tooltip alone is invisible...` block — strip the loop + critique markers, keep the aria-describedby UX code
- **admin-notifications/AdminNotificationsPage.tsx:286-289**: `Visually-hidden description consumed by the disabled Custom button's aria-describedby. sr-only utility is standard a11y pattern` — strip narrative
- **admin-notifications/AdminNotificationsPage.tsx:310-314**: `When the operator hasn't touched any filter the "match the current filters" phrasing is presumptuous (critique 2026-08-31 valley finding)` — strip "critique" marker; keep copy logic
- **admin-notifications/AdminNotificationsPage.tsx:368-372**: `Loop 1 review finding E6 + E7: keyboard users must be able to expand rows` — strip
- **admin-notifications/AdminNotificationsPage.tsx:441-449**: `Loop 1 review finding E15: clicking the incident link bubbles to the row's onClick` — strip
- **attachments/useAttachments.ts:42-44**: `Re-exported as ATTACHMENTS_QUERY_KEY so test rigs can pin cache identity (mirrors UNREAD_NOTIFICATIONS_QUERY_KEY in useNotificationBell.ts:57)` — strip cross-ref
- **attachments/useAttachments.ts:63-67**: `This matches the spec's LIST_403_OTHER_INCIDENT matrix row` — strip
- **attachments/useAttachments.ts:32-33**: `Tailwind-class constraint (Story 2.8 VG-1 lesson)` — strip
- **attachments/AttachmentList.tsx:32-34**: same Tailwind-class constraint repeat — strip
- **attachments/AttachmentsSection.tsx:32-34**: same Tailwind-class constraint repeat (3rd copy!) — strip
- **attachments/AttachmentsSection.tsx:90-94**: `mirrors the api's enforceDeleteOwnership helper (4.13 attachmentRouter.ts:enforceDeleteOwnership)` — strip cross-file module ref
- **attachments/useCreateAttachment.ts:13-17**: `mirrors useMarkAsRead.ts:140-141's invalidate-on-success pattern from 4.10` — strip cross-file line ref
- **attachments/useDeleteAttachment.ts:14-16**: same `useMarkAsRead.ts:140-141` cross-ref — strip
- **attachments/useDeleteAttachment.ts:97-111**: restate-the-code duplication of header (cache-invalidation policy spelled out twice) — consolidate to header only
- **attachments/useCreateAttachment.ts:151-157**: `Keep the 4xx range constants referenced so a future reader sees the explicit bounds` + `void [HTTP_4XX_MIN, HTTP_4XX_MAX];` — strip; the constant reference is pseudo-dead-code archeology
- **audit-log/useAuditLogList.ts:1-16**: header restates 5.1 pattern + `staleTime: 0 keeps the row current on every poll` + `On 403...` — strip "Mirrors the 5.1..." narrative; trim to ≤8 lines
- **audit-log/useAuditLogList.ts:47**: `The shared contract omits preset (it's a UI concept, not a wire concept); preset is forward-compat for that boundary` — strip; the comment doesn't help a future reader who opens the file
- **audit-log/useAuditLogList.ts:79-95**: `audit-log cache key` block restates the spec list — strip narrative
- **audit-log/useAuditLogList.ts:113-142**: `Build the audit-log query string. Mirrors buildAdminQueryString in useAdminNotificationList.ts:136-151 with the param names swapped to the audit-log vocabulary` + 7-bullet param-doc — strip narrative + cross-file line ref, keep param semantics as inline line comments
- **audit-log/useAuditLogList.ts:191-203**: restate-the-code "Loop-1 fix equivalent (carried over from 5.1)" — strip
- **audit-log/AdminAuditLogRbacDeniedError.ts:1-31**: 31-line header; strip down to "Tagged error for the audit log 403 path; mirrors the notification list's sibling class."
- **components/IncidentCard.types.ts:1-40**: 40-line header; trim to ≤6 lines
- **components/IncidentCard.types.ts:53-66**: restate-the-code `// <IncidentCard /> props (deferred UI — Story 4.4)` — strip
- **components/IncidentCard.types.ts:68-82**: AC5-AC9 + STATE_SLOTS cross-ref narrative — strip
- **components/IncidentCard.types.ts:89-94**: `// The submit-result slot is Technician-only-mine. The ownership rule (assignee_user_id === viewerUserId) lives in slotsForInspecting; the role gate lives here so the helper stays role-free (the helper itself doesn't read viewerRole)` — strip (the code already says it)
- **components/IncidentCard.types.ts:102-110**: `Per-state × per-role slot matrix. INSPECTING is special-cased...` — strip
- **components/index.ts:1-8**: header's `Story 1.9 ships the KpiStat card; later stories will add MetricCard, LiveReadingRow, ScenarioTile, etc. Each new component lands in this barrel` — strip
- **components/KpiStat.tsx:1-20**: 20-line header — strip down to ≤4 lines
- **components/KpiStat.tsx:32-42**: `Tailwind className per severity. Each entry is the exact token the design mandates — no inline literals` — strip narrative; the table is self-explanatory
- **forms/FormField.tsx:1-16**: 16-line header — trim to ≤4 lines
- **forms/FormField.tsx:64-79**: `{/* eslint-disable react/forbid-dom-props -- the helper <p> and error <p> are deliberately the targets of aria-describedby; the rule's intent (avoid duplicate / colliding DOM ids) does not apply to unique useId-derived values. */}` — trim to a single-line `// eslint-disable-line -- useId-derived ids can't collide`
- **forms/FormField.tsx:85-89**: `Convenience wrapper that renders a <input type="text"|"email"|"password"|"search" ...>` — strip
- **realtime/backoffTimer.ts:17-30**: `Walk-through: attempt 1 → ...` + `Math.max(0, Math.floor(attempt))` defensive code-read — strip the walk-through; keep the formula and clamp
- **realtime/connectionStateStore.ts:9-22**: `Why a zustand store and not per-component useState:` + `Initial state (isConnected: true) is deliberate: the banner stays silent until the socket actually disconnects` — strip narrative
- **realtime/connectionStateStore.ts:23-28**: `Store shape (matches _bmad-output/implementation-artifacts/spec-2-9-connection-state-offline-ux.md Task #1)` — strip plan-file ref
- **realtime/connectionStateStore.ts:30-33**: `Consumers should subscribe via useConnectionState() (the memoized selector in useConnectionState.ts)` — strip cross-file ref
- **realtime/socketClient.ts**: see P1-1 above (43-line header blocks merge before single P2 marker fires)
- **realtime/socketClient.ts:55-56**: `The store itself is a React-side artifact (zustand); these helpers are the imperative mutation surface` — strip narrative
- **realtime/socketClient.ts:69-73**: `Tag the server emits (or socket middleware rejects with) to signal that the access token has expired. String matches the api's Socket.IO handler (Story 2.2 wire contract)` — strip cross-ref + Story code
- **realtime/socketClient.ts:104-109**: `Schedule a single reconnect attempt on the given socket. retryAttempt is the POST-INCREMENT value from the store — the caller MUST have called incrementRetry() first` — strip "MUST" docspeak; the function body is small
- **realtime/socketClient.ts:122-127**: `Apply a freshly-minted token to the socket and reconnect. The socket.io client mutates socket.auth as a documented side-effect of reconnect-with-different-credentials` — strip narrative
- **realtime/socketClient.ts:135-142**: `Story 2.9: every connect flips the store to connected and zeros the retry counter. The connect event is the only path that clears isConnected; token rotation is mid-flight and does not pass through here` — strip
- **realtime/socketClient.ts:144-149**: `Spec §"Reconnect succeeds mid-backoff": on a successful connect, the pending backoff timer MUST clear — otherwise a stray socket.connect() fires after the socket is already connected, doubling the connect counter and confusing debugging tooling. The cancel is idempotent so a connect with no pending timer is a no-op` — strip (function says it)
- **realtime/socketClient.ts:155-159**: `Story 2.9: transport-level disconnect (NOT preceded by a token-rejection connect_error) bumps the retry counter THEN schedules a backoff reconnect. We increment FIRST so the formula in scheduleBackoffReconnect sees the post-increment value (5s for the first attempt, not 0s)` — strip
- **realtime/socketClient.ts:186-191**: `Network failure path (timeout, 5xx, err.message === undefined). Mark the store as disconnected so the banner appears. We do NOT reschedule here — Socket.IO emits connect_error first, then disconnect on transport failure` — strip
- **realtime/socketClient.ts:225-230**: `The api's Socket.IO server is mounted at path: "/ingest/" (Story 2.2). The web subscriber connects with the namespace /dashboard so the server-side connection handler can distinguish subscribers (session-token authenticated) from ingest devices (UUID + device-JWT authenticated). See packages/api/src/index.ts isSubscriberConnection for the matching server-side check` — strip cross-file module ref
- **realtime/socketClient.ts:243-256**: `disconnectSocket` rationale (zombie-timer) restated; trim to ≤4 lines
- **realtime/socketClient.ts:259-263**: `// Test helper. Used by the refresh.spec.ts to assert that the socket is wired without opening a real connection` — strip cross-file module ref
- **realtime/socketClient.ts:266-272**: `Story 2.9 test helper: read the current backoff-timer slot. The Dashboard.spec.tsx test uses this to assert the pending timer is cancelled after disconnectSocket` — strip cross-file module ref + Story code
- **realtime/useConnectionState.ts:1-23**: 23-line header — trim to ≤4 lines (the selector pattern speaks for itself)
- **queryClient.ts**: already tight (13 lines). Drop `(Story 2.5)` + `(e.g. useSimulatorDevices)` persona example + "TanStack Query's contract is that there is exactly one QueryClient per app" generic
- **main.tsx**: see P1 critique in spirit — many inline route element comments cite Story 4.4 / 4.3 / 4.5 / 4.6 / 4.11 / 4.7 + cross-file TanStack cache key strings. Trim each `<Route>` block to retain only the route path + element + RBAC wrap; strip inline `Story X.Y` JSX comments
- **main.tsx:54-57**: `Stub dashboard — removed in Story 2.6; the real <Dashboard /> four-region shell now renders inside <AppShell>. Keeping the old identifier only as a story-history note` — strip "story-history note"
- **main.tsx:60-65**: `Generic page placeholder for routes whose content lives in later stories` — trim to a one-liner
- **main.tsx:76-83**: `SeverityCards — Story 1.9 / AC1 + AC3` — strip Story code + AC
- **main.tsx:101-117**: 17-line `API_ORIGIN` essay restating nginx config, the "previous value `/api` broke `/auth/login`" historical note. Trim to ≤4 lines
- **test-setup.ts**: already tight; trim "Surakkha web" + "Loaded by vitest before each test file (configured in vitest.config.ts)"

### Cross-file line refs (consolidated list)

- `attachments/useAttachments.ts:43-45` → `useNotificationBell.ts:57`
- `attachments/useDeleteAttachment.ts:14-16` → `useMarkAsRead.ts:140-141`
- `attachments/useDeleteAttachment.ts:97-111` → `useMarkAsRead.ts:94-95` (callback wiring)
- `attachments/useCreateAttachment.ts:50-51` → `useMarkAsRead.ts:46, 49-50`
- `attachments/useCreateAttachment.ts:13-17` → `useMarkAsRead.ts:140-141`
- `attachments/AttachmentsSection.tsx:90-94` → `attachmentRouter.ts:enforceDeleteOwnership`
- `audit-log/useAuditLogList.ts:78` → spec-4-10 (bell), 5.1 (admin notifications)
- `audit-log/useAuditLogList.ts:127-128` → `useAdminNotificationList.ts:136-151`
- `audit-log/AdminAuditLogRbacDeniedError.ts:5-7` → `AdminNotificationsRbacDeniedError`
- `access/RbacDenied.tsx:62-63` → ESLint `complexity: 10` reason ref
- `realtime/socketClient.ts:55` → zustand inline reason ref
- `realtime/socketClient.ts:70-73` → api `Socket.IO handler (Story 2.2 wire contract)`
- `realtime/socketClient.ts:225-230` → `packages/api/src/index.ts isSubscriberConnection`
- `realtime/socketClient.ts:259-263` → `refresh.spec.ts`
- `realtime/socketClient.ts:266-272` → `Dashboard.spec.tsx`
- `realtime/connectionStateStore.ts:23-28` → `_bmad-output/implementation-artifacts/spec-2-9-...md`
- `realtime/connectionStateStore.ts:30-33` → `useConnectionState.ts`
- `forms/FormField.tsx:64-69` → ESLint `react/forbid-dom-props` rule's "intent"

### Long narrative rationale blocks (5+ line restate-the-code)

- `attachments/useAttachments.ts:5-15` (8 lines) — header restating the cache-key reason
- `attachments/useAttachments.ts:51-67` (16 lines) — restating "RBAC denied envelope"
- `attachments/useCreateAttachment.ts:1-35` (35 lines) — entire header
- `attachments/useDeleteAttachment.ts:1-33` (33 lines) — entire header
- `attachments/AttachmentForm.tsx:1-37` (37 lines) — entire header
- `attachments/AttachmentForm.tsx:42-50` — `Submit handler. Wired by <AttachmentsSection /> to the useCreateAttachment mutation. The form does NOT call the mutation directly — keeps the component presentational and testable with a stub onSubmit.`
- `attachments/AttachmentsSection.tsx:1-34` — entire header
- `attachments/AttachmentsSection.tsx:69-95` (27 lines) — restate-the-code "Hooks owned here / RBAC helpers"
- `audit-log/useAuditLogList.ts:113-142` (29 lines) — `Build the audit-log query string...` block
- `admin-notifications/AdminNotificationsPage.tsx:1-32` (32 lines) — entire header
- `access/RbacDenied.tsx:1-36` (36 lines) — entire header
- `access/RbacDenied.tsx:42-47` — `Map the viewer's role to the surface they actually navigate from. Key journeys per EXPERIENCE.md §Personas`
- `access/RbacDenied.tsx:55-64` (10 lines) — `Resolve the back-link destination... Extracted so the parent RbacDenied body stays under the complexity: 10 ESLint ceiling`
- `access/RbacDenied.tsx:101-107` (7 lines) — duplicate of `Role-aware default (Story 6.11)` rationale already in the header
- `components/IncidentCard.types.ts:1-40` (40 lines) — entire header
- `components/IncidentCard.types.ts:53-66` (14 lines) — `Locked fact 2` restate-the-code
- `components/IncidentCard.types.ts:79-82` — AC5-AC9 cross-ref
- `forms/FormField.tsx:64-79` (16 lines) — `eslint-disable` rationale essay + `// eslint-enable` close
- `realtime/backoffTimer.ts:1-30` (30 lines) — entire header
- `realtime/connectionStateStore.ts:1-33` (33 lines) — entire header
- `realtime/socketClient.ts:1-43` (43 lines) — entire header (heaviest offender)
- `realtime/socketClient.ts:139-149` (11 lines) — `connect` listener rationale
- `realtime/socketClient.ts:155-159` (5 lines) — `disconnect` rationale
- `realtime/socketClient.ts:166-174` (9 lines) — `connect_error` rationale
- `realtime/socketClient.ts:225-230` (6 lines) — `io(url, { path: "/ingest/" })` rationale
- `realtime/useConnectionState.ts:1-23` (23 lines) — entire header
- `main.tsx:54-57` — stub-dashboard history note
- `main.tsx:60-65` — page-stub rationale
- `main.tsx:76-83` — SeverityCards rationale
- `main.tsx:101-117` (17 lines) — `API_ORIGIN` rationale
- `main.tsx:218-220, 232-237, 273-275, 302-307` — inline JSX comments restating Story 4.3 / 4.4 / 5.3 / 5.1 + cache keys
- `queryClient.ts:1-13` — TanStack contract restate

### "we use X" / first-person plural in JSDoc

- `attachments/AttachmentForm.tsx:53, 117-121`: `The form does NOT call the mutation directly — keeps the component presentational and testable...` (`We` implied)
- `attachments/AttachmentList.tsx:108-112`: comment `The <a> link uses the URL only — even if a javascript: URL slipped past the server (it can't), the noopener noreferrer mitigates...` (opinionated second-person)
- `attachments/AttachmentsSection.tsx:121-122`: `// Viewer gating: when no role is set (unauthenticated), fall back to Viewer (no create + no delete affordance).` (passive form OK)
- `realtime/socketClient.ts:14, 38, 159, 173`: implicit "we" via commenting — but the imperative voice would still be acceptable. Review.
- `realtime/connectionStateStore.ts:68-72`: `// Defensive clamp: if the prior value was corrupted to NaN ... The clamp restores the counter to a known-good integer.` (passive is OK)

The `hedge-we-use` regex `\bwe use\b` does not fire on these — review confirms no explicit first-person plural prose remains after the strip pass.

### Non-findings (verified, not raised — load-bearing invariant)

- **`backoffTimer.ts` formula** — exponential base 2, cap 30s. **PRESERVED VERBATIM.**
- **`connectionStateStore` Zustand slice shape** — `isConnected`, `lastConnectedAt`, `lastDisconnectedAt`, `retryAttempt`. **PRESERVED VERBATIM.**
- **`computeBackoffMs(attempt)` signature + `BACKOFF_INITIAL_MS` / `BACKOFF_CAP_MS` exports** — **PRESERVED VERBATIM.**
- **TanStack Query defaults** — `staleTime: 5_000`, `retry: 1`, `refetchOnWindowFocus: false`, mutations `retry: 0`. **PRESERVED VERBATIM.**
- **`socketClient.ts` JWT-in-handshake** — `auth: { token }` with `getAccessToken()` + `path: "/ingest/"` + `transports: ["websocket"]` + `reconnection: false`. **PRESERVED VERBATIM.**
- **`SOCKET_TOKEN_EXPIRED` constant + `connect_error` token-rotation path + `reconnectWithToken`** — **PRESERVED VERBATIM.**
- **RBAC route guards** — `RbacRoute` consults `isPathAllowedForRole(NAV_GROUPS, pathname, role)`. **PRESERVED VERBATIM.**
- **`RbacDenied.viewerRole` + `resolveBackTarget` + `ROLE_BACK_LABEL`** — role-aware back-link wiring **PRESERVED VERBATIM** (only the docs above it are trimmed).
- **`NotFound` default `backHref: "/incidents"`, `backLabel: "Back to incidents"`** — preserved.
- **`attachmentRouter` hook invariants** — `ATTACHMENTS_QUERY_KEY(incidentId) = ["incidents", "detail", incidentId, "attachments"]`. **PRESERVED VERBATIM.**
- **`useAttachments` 403 throws plain `Error("forbidden")`** — surface contract for `<AttachmentsSection />`. **PRESERVED VERBATIM.**
- **`useAuditLogList` cache key** — filter-keyed (`actorIds`, `event`, `resource`, `preset`); `since`/`until` omitted; 30s polling; `staleTime: 0`; Zod `safeParse`. **PRESERVED VERBATIM.**
- **`AuditLogListEnvelopeSchema.safeParse(raw)` shape check** — preserved.
- **`AdminAuditLogRbacDeniedError.name = "AdminAuditLogRbacDeniedError"`** — discriminator stability **PRESERVED VERBATIM** (spec asserts on it).
- **`useCurrentRole()` + `useCurrentUserId()` + `useToasts()` injection in `AttachmentsSection`** — **PRESERVED VERBATIM.**
- **`IncidentCard.types.ts` `actionSlotsFor(state, role, userId)` signature + `STATE_SLOTS` matrix + `slotsForInspecting`** — **PRESERVED VERBATIM**.
- **`ActionSlot` literal union** + `<IncidentCard />` props contract — **PRESERVED VERBATIM**.
- **`KpiStat.severity` literal union + per-severity class table** — **PRESERVED VERBATIM** (every Tailwind class is a literal).
- **`FormField` `useId()` + `aria-describedby` + `FormTextInput` overload** — **PRESERVED VERBATIM**.
- **`main.tsx` route registry** — paths, RBAC wraps, `PageStub` placeholder, `LoginRoute` `?next=` SSR. **PRESERVED VERBATIM**.
- **`main.tsx` `<QueryClientProvider client={queryClient}>` + `<BrowserRouter>` + `<StrictMode>`** — **PRESERVED VERBATIM**.
- **`apiOrigin = ""` (same-origin)** — preserved.
- **`HTTP_UNAUTHORIZED = 401` sentinel in LoginRoute** — preserved.
- **`severityTokens.ts` (dashboard) and `useDashboardSocket`** — already refined in 1a55995, untouched.
- **`ATTACHMENTS_QUERY_KEY` import path** — preserved.

## Plan

### Strip pass (applied)

1. Drop `Story 1.6` / `Story 4.4` / `Story 5.3` / `Story 5.1` / `Loop 1 review` / `Loop 2 hardening` / `Loop-1 fix` / `Critique 2026-08-31 valley finding` / `Step-NN` / `F-P#` / `Patch` markers everywhere.
2. Drop cross-file line refs (`useMarkAsRead.ts:140-141`, `useNotificationBell.ts:57`, `attachmentRouter.ts:enforceDeleteOwnership`, `_bmad-output/.../spec-2-9-...md`, `useAdminNotificationList.ts:136-151`, `Dashboard.spec.tsx`, `refresh.spec.ts`, `packages/api/src/index.ts isSubscriberConnection`, `useConnectionState.ts`).
3. Drop restate-the-code blocks (header duplications of body semantics).
4. Drop the `void [HTTP_4XX_MIN, HTTP_4XX_MAX]` archeology in `useCreateAttachment.ts`.
5. Drop the `eslint-disable` rationale essay (16 lines) in `FormField.tsx` → single-line disable.
6. Drop first-person-plural prose (`we use`, `we extend`, "we never unmount", "we increment first", "we do not reschedule").

### Trim pass (applied)

7. Header trim ≤10 lines for all 23 files in scope.
8. Header trim ≤6 lines for the heaviest (socketClient, RbacDenied, IncidentCard.types, AttachmentsSection, useCreateAttachment, useDeleteAttachment, AttachmentForm, AttachmentList).

### Preserved (load-bearing — see above)

### Refinements not made

- **Behavior changes** — none. All cache keys, retry policies, RBAC predicates, and wire shapes stay identical.
- **Type changes** — none. Zod schemas and `ActionSlot` literal union stay verbatim.
- **Spec changes** — none.

## Verification

```bash
npx --prefix packages/web tsc -b packages/web 2>&1 | tail -10
npx --prefix packages/web eslint packages/web/src/access packages/web/src/admin-notifications packages/web/src/attachments packages/web/src/audit-log packages/web/src/components packages/web/src/dashboard packages/web/src/forms packages/web/src/notifications packages/web/src/realtime packages/web/src/shell packages/web/src/auth packages/web/src/queryClient.ts packages/web/src/main.tsx packages/web/src/test-setup.ts
cd packages/web && npx vitest run src 2>&1 | tail -15
node scripts/lint-prose.mjs
```

Pre-existing errors in `useThresholds.ts` / `useIncidentTransitionMutation.ts` are NOT in this PR's scope (commits `b4111cd` / `85a711f`).
