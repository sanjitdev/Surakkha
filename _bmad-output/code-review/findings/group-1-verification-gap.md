# Verification Gap Findings — Group 1 (Story 4.2)

### `applyTransition` writer has no direct test — ackedAt/resolvedAt write-side invariants ship untested

- **Changed surface:** `applyTransition` in `packages/api/src/incidents/incidentStateRepository.ts:291-364` — specifically the `ackedAt` computation (`currentRow.acknowledgedAt ?? (nextState !== "OPEN" && nextState !== "REOPENED" ? at : null)`) and `resolvedAt = nextState === "RESOLVED" ? at : currentRow.resolvedAt`.
- **Impacted consumer or site:** Every successful POST to `/api/incidents/:id/...` mounted in `packages/api/src/index.ts`; the writer's per-row stamps feed the `GET /api/incidents/:id` payload via `incidentRowToPayload`.
- **Existing test evidence:** I grepped `packages/api/src/incidents/router.spec.ts` for `applyTransition` — the only hit is a code-comment at line 87. There is no dedicated `incidentStateRepository.spec.ts` in this diff; the only consumer tests are `router.spec.ts`, and every test in `router.spec.ts` provides a `nextRow` override so `applyTransition`'s write is never observed.
- **Missing verification:** No test asserts that `applyTransition` writes the same `acknowledged_at`/`resolved_at` shape that `projectNextIncident` projects — they share identical-looking logic but the tests never compare them through the real writer.
- **Suggested test shape:** A `incidentStateRepository.spec.ts` that drives `applyTransition` with a hand-rolled stub repo and asserts on the `data` passed to `tx.incident.updateMany` (and on the `incidentEvent.create` payload).

### `reopen` HTTP path doesn't verify that `resolved_at` survives the commit

- **Changed surface:** Writer contract on reopen: `resolvedAt = nextState === "RESOLVED" ? at : currentRow.resolvedAt`.
- **Impacted consumer or site:** `POST /api/incidents/:id/reopen` mounted at `router.ts:1523-1527`.
- **Existing test evidence:** The reopen happy-path test `Admin can reopen a RESOLVED incident (200)` provides a `nextRow` whose `resolvedAt` is `new Date("2026-08-27T02:00:00.000Z")` — the test only asserts `body.state === "OPEN"` and never checks `body.resolved_at`.
- **Missing verification:** No HTTP-level assertion on the `resolved_at` field of the reopen response payload.
- **Suggested test shape:** A reopen happy-path test that asserts `body.resolved_at === preUpdateResolvedAt` through the HTTP boundary — i.e. doesn't pass a `nextRow` override.

### `incident:opened` payload shape is not asserted at any consumer boundary

- **Changed surface:** New `incident:opened` emit on two rooms; payload includes `incident_id`, `device_id`, `severity`, `metric`, `value`, `opened_at`, `alert_id`.
- **Impacted consumer or site:** Dashboard incidents preview + deferred Story 4.4 detail page.
- **Existing test evidence:** `hooks.spec.ts` asserts `broadcastStub.emits` has length 3, then asserts `emit[0] === "alert:opened"` on the device room, `emit[1].event === "incident:opened"` on the device room, and `emit[2].event === "incident:opened"` on the per-incident room. No field of any of those three payloads is asserted.
- **Missing verification:** No test parses the emitted `incident:opened` payload back through `IncidentOpenedEventSchema` or asserts any of its fields.
- **Suggested test shape:** Augment `hooks.spec.ts` to assert at least one payload field per emit (e.g. `incidentEmitRoom.payload.incident_id` matches the auto-created id; `incidentEmitRoom.payload.severity` matches the rule severity).

### `applyTransition` rollback behavior on `incidentEvent.create` failure has no test

- **Changed surface:** The atomicity claim at `incidentStateRepository.ts:108-112`: "any throw inside the `$transaction` callback rolls back the entire transaction."
- **Existing test evidence:** No test asserts that a failure in `tx.incidentEvent.create` after a successful `tx.incident.updateMany` rolls the incident row back.
- **Suggested test shape:** A `incidentStateRepository.spec.ts` with a stub `$transaction` that invokes the callback but with an `incidentEvent.create` that throws — assert the thrown error propagates.

### `recentRouter` consumer of the new `Incident` row — state field presence / drift untested

- **Changed surface:** `Incident` gains a `state` column with default `OPEN`.
- **Impacted consumer or site:** `packages/api/src/incidents/recentRouter.ts` (not in this diff but reads from `Incident`).
- **Missing verification:** No test asserts that the `recentRouter` endpoint emits `state` on each row after the migration.
- **Suggested test shape:** Extend `recentRouter.spec.ts` (or add a new one) to assert the wire shape of `GET /api/incidents/recent` after the migration includes `state: "OPEN"` for every row.

### `requireOwner` import marker — runtime ownership check diverges from `requireOwner` shape

- **Changed surface:** `router.ts` declares `const _requireOwnerMarker = requireOwner; void _requireOwnerMarker;` as an "import-forcing anchor". The actual ownership check is inline in `runOwnershipCheck`.
- **Missing verification:** No test asserts the response body of a Technician-only-mine 403 matches `requireOwner`'s documented shape. If `requireOwner`'s canonical response shape drifts from the inline `runOwnershipCheck` shape, no test catches it.
- **Suggested test shape:** A unit test on `runOwnershipCheck` that asserts the response body keys match `requireOwner`'s documented contract; or remove the marker and explicitly invoke `requireOwner` instead of inlining.

### Hooks test for `incident:opened` count — pass-through test doesn't observe `alert_id` despite schema-required field

- **Changed surface:** `applyTransition.ts:3301` builds `incidentPayload.alert_id = resolvedAlertId`.
- **Missing verification:** No test asserts `incident:opened.payload.alert_id === createdAlertId` (when present) or `=== null` (when absent).
- **Suggested test shape:** Add `expect(incidentEmitRoom.payload.alert_id).toBe(expectedAlertId)` to `hooks.spec.ts`'s de-bouncing test.

### `auto_create` observability log uses a verb literal not in `ActionVerbSchema` — no test pins this surface

- **Changed surface:** `applyTransition.ts:3323-3333` logs an `incident_transition` event with `verb: "auto_create"` — a string NOT in `ActionVerbSchema`.
- **Impacted consumer or site:** Downstream log parsers / dashboards that consume the `incident_transition` event JSON.
- **Missing verification:** No test pins that `verb === "auto_create"` for the auto-create log line or that downstream consumers accept this verb.
- **Suggested test shape:** Either widen `ActionVerbSchema` to include `auto_create` and add a source-walk pin, or split the auto-create log into a distinct event name (e.g. `incident_auto_created`) and add a test that asserts no `incident_transition` log is emitted on the auto-create path.

### `incidentRowToPayload` `Date | string` branch is dead at the consumer

- **Changed surface:** `incidentRowToPayload` handles the case where `openedAt` / `acknowledgedAt` / `resolvedAt` might be either `Date` or `string`. Prisma returns `Date`.
- **Missing verification:** No test asserts the wire-shape of `opened_at` (or any other ISO8601 field) is a valid ISO 8601 string when the underlying value is a `Date`. The `string` fallback branch is untested.
- **Suggested test shape:** A direct unit test on `incidentRowToPayload` covering both the `Date` input and a hypothetical `string` input.

### "EMITS notification:critical" test only checks the spy was called — payload assertion exists but `recipientRole` is not pinned

- **Changed surface:** `incidentStateRepository.ts:344-354` writes a `Notification` row with `severity: "critical"`, `incidentId`, `alertId: null`, `recipientRole: "Operator"`.
- **Missing verification:** No test asserts `recipientRole === "Operator"` and no test asserts the absence of `alertId` (or that it's explicitly `null`).
- **Suggested test shape:** Extend the existing test to assert `call?.data.recipientRole === "Operator"` and `call?.data.alertId === null`.

### Migration `Incident_state_openedAt_idx` — no migration test would catch a typo

- **Changed surface:** The new forward migration adds four columns on `Incident`, four enums, four tables, four foreign keys, and four indices including the partial unique index for notification idempotency.
- **Missing verification:** No `incident-state.migration.spec.ts` or equivalent in this diff. A typo in the column name, a missing FK, or a wrong index predicate would not be caught.
- **Suggested test shape:** A `incident-state.migration.spec.ts` that applies the migration against a test database and asserts the expected schema shape.

## Other findings

- **Demo-user ID divergence between `users.ts` and `seedUsers.ts`**: `packages/api/src/auth/users.ts:13-31` claims "Six canonical demo users matching the Prisma `seedUsers.ts`" but `users.ts` uses IDs `a001..a007` while `packages/db/prisma/seedUsers.ts` uses `a001`, `b001`, `b002`, `c001`, `c002`, `d001`. Worth flagging.
- **`transitions.spec.ts:2637-2650` test name vs. assertion mismatch**: the test name "clears assignee_user_id to null on resolve if input is null" describes behavior the test then explicitly contradicts with the comment `// preserved when route passes null` and the assertion `expect(next.assignee_user_id).toBe(TECH_ID);`. Stale test name that obscures intent.
- **`IncidentOpenedEventSchema` referenced but no consumer test pins the wire shape**: the schema defines a closed wire contract for `incident:opened`, but the only test that observes the emit (`hooks.spec.ts`) doesn't parse the payload through the schema.
