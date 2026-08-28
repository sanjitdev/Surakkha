# Step-04 Blind-Hunter Review Prompt — Story 4.10

**Reviewer role:** Adversarial. Assume the implementation is wrong; find every place it lies about its contract, hides a behavior, or shifts risk.

**Spec being reviewed:** `_bmad-output/implementation-artifacts/spec-4-10-notificationbell-dropdown.md`
**Baseline commit:** `4777b37`
**Review target (diff):** `_bmad-output/implementation-artifacts/review-target-4-10.patch` (3410 lines, 21 files)

## Preamble — read first

You are reviewing Story 4.10 (NotificationBell dropdown) for the Surakkha project. The implementation adds:

1. A new backend `notificationRouter` (GET + PATCH) in `packages/api/src/notifications/` with a narrow repository slice + payload adapter.
2. A new shared `notification.ts` wire schema + RBAC matrix `acknowledge.Notification` grants.
3. A new web `NotificationBell` component in `packages/web/src/notifications/` with `useNotificationBell` + `useMarkAsRead` hooks, a separate `NotificationsRbacDeniedError`, and a `TopBar` mount slot.

The spec's load-bearing decisions to validate against:

- `recipientRole === viewerRole` filter on read (so only Operators get rows today).
- 30-second polling, no socket event.
- Idempotent PATCH (returns 200 on already-acknowledged).
- Viewer role gets a DISABLED bell; no fetch fires.
- `NotificationsRbacDeniedError` is a NEW class (NOT `KanbanRbacDeniedError`).
- Tailwind literal class strings only.

## Adversarial instructions

Read the review target patch (3410 lines). Assume the implementation is wrong about at least 3 things. Look for:

### A) Contract lies

- Places where the implementation does NOT match the spec's I/O matrix rows.
- Hidden side effects (e.g., a "read" endpoint that writes to the DB; a "mark as read" that mutates `createdAt`).
- Silent fallbacks (e.g., `data ?? []` when the spec mandates a specific error surface).
- Spec promises the UI gates Viewer fetch — does the implementation actually gate it (no fetch fires), or does it just hide the response?

### B) State machine / RBAC violations

- Does the read filter actually enforce `recipientRole === viewerRole`, or is it a no-op that returns all rows?
- Does the PATCH cross-role check fire BEFORE or AFTER the update? If AFTER, the update leaks.
- Does the 401 path (no JWT) actually return 401, or does it bubble a 500?

### C) Race windows

- What happens if two operators mark the same notification as read concurrently?
- What happens if a poll-tick fires while a mark-as-read is in flight?
- What happens if the dropdown is OPEN and the role changes (JWT refresh)?

### D) Test rig

- The spec mandates a test for the Viewer-disabled no-fetch path. Does the test actually verify no fetch fires (mock spy + spy not called), or does it just verify the disabled UI?
- The spec mandates `instanceof NotificationsRbacDeniedError` on the cache error. Does the test assert on the cache's `state.error`, or just on the UI?
- Are 30-second poll tests using fake timers, or are they real-timed?

### E) Hidden deps

- Did the implementation import anything from `packages/web/src/incidents/`? (Cross-module coupling violation per Design Notes.)
- Did the implementation touch `packages/api/src/notifications/notificationWriter.ts` or the Prisma schema?

## Output format

Numbered list of findings. Each finding:

- **ID:** `A1`, `A2`, etc.
- **Severity:** low / medium / high
- **Location:** file:line
- **Claim:** one-sentence description
- **Evidence:** code snippet + spec quote
- **Suggested fix:** one or two sentences

Do NOT modify any files. Return only the findings list.

If a finding is just speculation without code-level evidence, drop it — adversarial reviewer's job is to surface REAL contract gaps, not to enumerate possibilities.
