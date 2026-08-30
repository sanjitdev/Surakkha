# Epic 5 Context: Reporting & Audit

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Admins and Operators can export readings, browse the notification log, browse the audit trail, and trust that data older than 30 days has been aggregated into 5-minute mean/min/max rows. The hourly retention cron is the seam for v2 to swap in a continuous aggregation worker.

## Stories

- Story 5.1: /admin/notifications Read View — admin list of all emitted notifications, severity + date filters, expandable row with full payload and link to underlying incident.
- Story 5.2: CSV Export of 30 Days of Readings — operator/admin can download a sensor's last 30 days; streamed, audited, capped at 100k rows.
- Story 5.3: Audit Log Surface at /audit — admin can query the append-only audit trail by actor / event / resource; click rows to navigate to the underlying entity.
- Story 5.4: ReadingAggregate Table — Prisma model + migration holding 5-minute mean/min/max/sample_count buckets; unique on `(device_id, bucket_start, metric)`.
- Story 5.5: Hourly Retention Cron — hourly job that aggregates raw readings >30d into 5-minute buckets and deletes the raw rows in the same transaction; cursor-based, idempotent, overlap-safe.
- Story 5.6: Negative Tests for the Audit Log — proves every audited action writes an audit row (incident ack, threshold edit, simulator scenario, RBAC denial).

## Requirements & Constraints

**Notification read surface (Story 5.1):**

- Admin-only list endpoint at `/api/notifications/admin/list` (NOT the existing operator-facing `/api/notifications` bell feed).
- Filters: severity (multi-select), date range (last 24h / 7d / 30d / custom).
- Returns the 100 most recent rows; the `recipientRole` filter is dropped (admin sees ALL rows).
- Wire payload must include enough information to render an expandable detail row with full payload JSON + a link to the underlying incident (if `incidentId` is set).
- Non-admin navigation to `/admin/notifications` renders the Story 1.6 RBAC denied state; the API endpoint returns 403.

**Audit and retention (Stories 5.3 / 5.4 / 5.5 / 5.6):**

- Audit log is append-only; editing from the audit view is impossible.
- Retention cron must be overlap-safe (cursor-based lock via `SELECT ... FOR UPDATE` on `cron_runs` row or `cron.lock` advisory lock).
- Retention cron batches ≤10,000 rows and writes a `cron_runs` row recording started/finished/aggregated/deleted counts.
- Negative audit tests must prove at least 8 audit-coverage cases run in CI; the file is namespaced `__tests__/audit.coverage.spec.ts`.

**Read-only invariants:**

- Admin surfaces (5.1 notifications list, 5.3 audit log) NEVER expose write affordances.
- The notification read surface is the read side of FR-28 (already partially covered by the 4.10 bell); 5.1 closes the read story with the admin's full view.

## Technical Decisions

**RBAC matrix (Story 5.1):** The existing 4.10 `read Notification` is granted to Admin / Operator / Technician. Story 5.1's admin-only list needs a SEPARATE action — likely `read_all Notification` or an inline role check in the handler. The matrix-as-code pattern from Story 1.5 (typed entries, lint-enforced) is the load-bearing convention; new actions must be added in `packages/shared/src/rbac.ts` so the lint enforcement (`pnpm lint:rbac`) catches drift.

**Wire schemas live in `@surakkha/shared/notification`:** The 4.10 story already established `NotificationPayloadSchema` (operator-facing, drops `acknowledgedByUserId`). Story 5.1 needs an ADMIN-FACING wire row that includes the full payload JSON and the recipient role resolution for cross-role review. Either (a) extend the existing schema with optional fields, or (b) create a sibling `AdminNotificationPayloadSchema`. Option (b) is the cleaner seam — the admin row is genuinely a different shape (it leaks information the operator-facing wire omits).

**Repository pattern:** The existing `NotificationRepository` (4.10) is a narrow Prisma slice. Story 5.1 needs `findMany` with NO `recipientRole` filter (admin sees all) and a date-range predicate. The clean path is to add a new method `findManyAdmin(args: { severity?, since?, until?, take })` to the existing repository interface — single data-layer seam, no schema drift.

**Mockup:** `_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-30/mockups/key-admin-notifications.html` is the canonical visual reference. The mockup uses the Admin role pill + the `/admin/notifications` sidebar item with `aria-current="page"`. The data model in the mockup is: 14 templates + 2,418 sent today; the actual v1 surface focuses on the notification LIST (the template editor is a deferred v2 surface per the mockup's annotations).

**No new socket emit:** The 4.10 spec explicitly forbade adding a `notification:*` socket event. The bell uses `refetchInterval: 30_000` polling. Story 5.1's admin list should mirror the same convention — the admin page polls for freshness, no new socket event.

**Cross-verb audit-write helper (AI-4.1):** Epic 4 retrospective flagged the need to extract the `createIncidentEvent + audit on success` pattern into a shared helper. Story 5.1 doesn't trigger incident events (it READS notifications, not writes), so this AI is NOT load-bearing for 5.1 — but the next Epic 4 follow-up will be relevant when 5.3 ships.

## UX & Interaction Patterns

- **Sidebar item placement:** `/admin/notifications` lives in the Admin nav group (matches the mockup). Disabled for non-Admin roles per UX-DR-13.
- **Filter chip pattern:** Reuses the `filter-chip` style with `pill` severity indicators (Critical / Warning / Info) per the alerts mockup.
- **Row expand pattern:** Click row → expand inline panel showing full payload `<pre>{JSON.stringify(payload, null, 2)}</pre>` + link to incident if `incidentId` set. No modal — keeps the operator's context.
- **RBAC denied state:** Reuse the Story 1.6 `<RbacDenied />` component (the same surface used for `/admin/audit`, `/admin/users`, etc.).
- **Empty state:** If no notifications match the filter, show `<empty-state>` with "No notifications in this window" — mirrors the alerts page empty pattern.

## Cross-Story Dependencies

- **Story 5.1 → Story 4.10:** Reuses the existing `NotificationRepository` slice (extend, don't replace). Reuses `@surakkha/shared/notification` schema (add sibling, don't mutate).
- **Story 5.1 → Story 1.6:** Reuses the RBAC denied state component.
- **Story 5.2 → Story 5.1:** Both render in the `/admin/*` nav group; the sidebar styling is shared.
- **Story 5.3 → Story 5.1:** Same admin-only pattern (single `read_all` action or inline role check). Story 5.3 establishes the audit-list template that Story 5.1 follows. If implementing in order, 5.3's audit-list code is the precedent.
- **Story 5.6 → Stories 5.1, 5.3:** The negative tests prove notification read doesn't accidentally write audit rows (it shouldn't, but the test is the contract).
- **AI-4.1 (Epic 4 retro):** Cross-verb audit-write helper. NOT load-bearing for 5.1's read path. Becomes relevant when 5.3 ships or any write happens.
- **AI-4.9 (Epic 4 retro):** ESLint complexity ceiling enforcement. Story 5.1's router methods must stay under complexity 12 — the 4.10 router established the `complexity: 10` ceiling via extracted helpers (see `enforceCrossRoleRecipient`, `fetchRowForAck`, etc.).
