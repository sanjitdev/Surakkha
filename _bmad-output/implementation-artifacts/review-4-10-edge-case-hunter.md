# Step-04 Edge-Case-Hunter Review Prompt — Story 4.10

**Reviewer role:** Edge case hunter. The I/O matrix in the spec lists ~20 rows. Find the rows the implementation does NOT cover, and find the rows the spec MISSED that the implementation should still handle.

**Spec being reviewed:** `_bmad-output/implementation-artifacts/spec-4-10-notificationbell-dropdown.md`
**Baseline commit:** `4777b37`
**Review target (diff):** `_bmad-output/implementation-artifacts/review-target-4-10.patch` (3410 lines, 21 files)

## Preamble — read first

Story 4.10 ships:

- `GET /api/notifications` — role-filtered list of unread notifications.
- `PATCH /api/notifications/:id/acknowledge` — idempotent mark-as-read.
- `NotificationBell` UI with dropdown, badge, polling, RBAC.

The spec's I/O matrix has 19 rows: HAPPY_PATH_OPERATOR / ZERO_UNREAD / HAPPY_PATH_ADMIN / HAPPY_PATH_TECHNICIAN / VIEWER_DISABLED / MARK_AS_READ_HAPPY / MARK_AS_READ_IDEMPOTENT / MARK_AS_READ_403 / MARK_AS_READ_500 / GET_403 / GET_500 / NETWORK_OFFLINE / POLL_TICK / POLL_TICK_OPEN / CLICK_OUTSIDE / ESCAPE_KEY / NAV_FROM_ROW / RBAC_VIEWER_NO_FETCH / MOUNT_UNMOUNT.

## Edge-case hunter instructions

Read the patch. Then enumerate:

### A) Spec I/O matrix rows that the implementation does NOT have a test for

For each of the 19 matrix rows:

1. Is there an `it(...)` in either `notificationRouter.spec.ts` or `NotificationBell.spec.tsx` that pins the row's expected behavior?
2. Does the test actually verify the behavior end-to-end (real fetch + real assertion), or is it a stub that just exercises the happy path?

Report any matrix row without a covering test as a finding.

### B) Spec I/O matrix rows that the implementation DOES test but the test is wrong

Look for tests that:

- Assert on the WRONG thing (e.g., assert on `data-testid` count when the row requires a specific badge color).
- Use stubs that bypass the actual code path (e.g., `setQueryData(key, err)` for a 403 test, instead of letting the `queryFn` actually throw).
- Use brittle selectors that don't match the production DOM.
- Don't `await` async state mutations (e.g., cache invalidation after a mutation).

### C) Cases the spec matrix MISSED but the implementation should still handle

- Role switch mid-session (Operator → Viewer via JWT refresh) — bell state?
- Notification arrives between the page-load fetch and the user's first interaction — what happens to scroll position?
- PATCH fires while the dropdown is OPEN and the user clicks a different row.
- Notification `incidentId` references an incident that was just deleted (404 on the incident link).
- `severity: "info"` notifications — does the UI render them? Spec matrix doesn't include them.
- Notification with `alertId` set (warning-severity from auto-create-from-alert) — does the row show a different link?
- More than 50 unread notifications (the repository's `take: 50` cap) — does the badge show "50+" or "50"?
- Network switches from WiFi to cellular mid-poll — does the polling recover?
- Browser back-button after `NAV_FROM_ROW` — does the bell still show the marked-as-read count, or does it revert?
- PATCH 401 (token expired between read and ack) — spec matrix has GET_401 but not PATCH_401.

### D) Pure-helper coverage gaps

The spec mandates a pure repository function (`notificationRepository.findMany` / `update` / `findUnique`) and a pure adapter (`notificationRowToPayload`). Are these tested in isolation? Or only through the router?

### E) Boundary semantics

- `take: 50` — is the cap documented in the spec? Pinned by a test?
- `orderBy: createdAt desc` — is the ordering pinned by a test?
- `acknowledgedAt: null` filter — is the NULL-vs-undefined distinction pinned?
- `recipientRole === req.user.role` — case-sensitive? The Prisma enum is case-sensitive; does the JWT role come in capitalized or lowercase?

## Output format

Numbered list. Each finding:

- **ID:** `E1`, `E2`, etc.
- **Severity:** low / medium / high
- **Location:** file:line (or "spec matrix row X" if it's a coverage gap)
- **Claim:** one-sentence description
- **Evidence:** code snippet OR spec row quote
- **Suggested fix:** one or two sentences

Do NOT modify any files. Return only the findings list.
