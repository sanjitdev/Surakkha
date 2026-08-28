# Step-04 Verification-Gap Review Prompt — Story 4.10

**Reviewer role:** Verification gap. The spec lists 12 acceptance criteria. For each, find whether the implementation has a passing test that verifies it. Find places where the spec contract is real but the implementation hides a behavior the test doesn't catch.

**Spec being reviewed:** `_bmad-output/implementation-artifacts/spec-4-10-notificationbell-dropdown.md`
**Baseline commit:** `4777b37`
**Review target (diff):** `_bmad-output/implementation-artifacts/review-target-4-10.patch` (3410 lines, 21 files)

## Preamble — read first

The spec's 12 acceptance criteria:

1. Bell mounts with `data-testid="notification-bell"` for Admin/Operator/Technician; `data-testid="notification-bell-disabled"` for Viewer.
2. Badge `<span data-testid="notification-bell-badge">N</span>` when count > 0; no badge when count === 0.
3. Click toggles a dropdown panel listing all unread notifications in reverse-chronological order, each row showing severity color + incident link.
4. Dropdown closes on click-outside, Escape, and clicking a row's incident link.
5. `GET /api/notifications` returns `{ notifications: NotificationPayload[] }` filtered by `recipientRole === req.user.role` for Admin/Operator/Technician; 403 for Viewer; 401 unauthenticated.
6. `PATCH /api/notifications/:id/acknowledge` records `acknowledgedAt` + `acknowledgedByUserId`, returns 200; idempotent on already-acknowledged; 403 cross-role; 404 missing.
7. `useQuery` polls every 30 seconds via `refetchInterval`.
8. Mark-as-read optimistically invalidates the unread query on success.
9. Bell does NOT fetch for Viewer viewers (UI gate).
10. Bell renders retry button on GET 500.
11. Bell uses `border-severity-critical-value` + `text-severity-critical-value` design tokens (no inline colors, no template-literal Tailwind classes).
12. `queryFn` throws `NotificationsRbacDeniedError` on 403.

## Verification gap instructions

For each of the 12 ACs, answer:

### Q1: Is there a test that pins the AC?

Yes / No / Partial. If yes, cite the file:line of the test. If partial, identify what part of the AC the test does NOT cover.

### Q2: Does the test actually exercise the behavior, or does it stub around it?

For example, AC9 says "no fetch fires for Viewer." A test that just checks the disabled UI is mounted does NOT pin this — it could still be that a fetch fires (and the UI hides the result). A test that spies on `globalThis.fetch` and asserts `fetchSpy.not.toHaveBeenCalled()` IS pinning it.

### Q3: Does the assertion match the AC's wording?

For example, AC2 says "badge `<span data-testid="notification-bell-badge">N</span>` when count > 0; no badge when count === 0." A test that asserts `expect(screen.queryByTestId("notification-bell-badge")).toBeNull()` for count=0 DOES pin it. A test that asserts `expect(screen.queryByTestId("notification-bell-badge")).toHaveTextContent("0")` does NOT pin it (badge with "0" is the wrong contract).

### Q4: Is the test bound to the production behavior, or to a side effect?

For example, AC8 says "mark-as-read optimistically invalidates the unread query on success." A test that asserts `queryClient.getQueryCache().find(key).isInvalidated === true` AFTER the mutation resolves IS pinning it. A test that just asserts the badge count decremented after a 1-second `waitFor` is NOT pinning it (could be a stale UI re-render).

## Output format

For each AC, a brief paragraph:

- **AC N:** [verdict: PASS / PARTIAL / MISSING]
  - Test file:line
  - What it pins
  - What it does NOT pin (if anything)
  - Suggested fix (if PARTIAL or MISSING)

Then a final summary table:
| AC | Verdict | Reason |
|----|---------|--------|
| 1 | ... | ... |
| ... | ... | ... |

Do NOT modify any files. Return only the assessment.
