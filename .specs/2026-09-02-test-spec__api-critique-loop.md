# Test spec — `packages/api/src` critique loop (2026-09-02)

## Scope

Regression pins for the 2026-09-02 `/impeccable critique packages/api/src` loop.

Critique artifact: `.impeccable/critique/2026-09-02T22-00-00Z__packages-api-src.md`. Score: **24/40**. Six P1 fixes (6 narrative headers > 38 lines; 9 "Extracted from the route handler to keep the closure under `complexity: 10`" rationale blocks in `notificationRouter.ts`; 2 "Loop 1 review finding E2/E5" markers; 10 "Patch (code review 2026-08-27 #N)" markers; stale `IncidentCard.tsx` reference in `idempotency.ts`; cross-file line-number references across 7 files) and ~48 P2 fixes shipped in this PR.

## Behavioural pins (router / middleware)

### incidents/router.ts

| #   | Given                                                      | When                                | Then                                                                                 |
| --- | ---------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Valid UUID + transition verb + matrix-allowed role         | `POST /api/incidents/:id/<verb>`    | Handler runs `prepareTransitionContext` → `runTransitionPipeline` → `respondSuccess` |
| 2   | Invalid UUID in path                                       | `POST /api/incidents/:id/<verb>`    | 400 `validation_error` with Zod issues                                               |
| 3   | Non-Admin caller                                           | `POST /api/incidents/:id/reopen`    | 403 `forbidden` (per-cell gate in `maybeReopenAdminDenied`)                          |
| 4   | Admin caller                                               | `POST /api/incidents/:id/reopen`    | Pipeline proceeds (per-cell gate passes)                                             |
| 5   | Two near-simultaneous acks (same Idempotency-Key)          | Second `POST` within 5 min          | Second response = byte-for-byte replay of first (cached status + body)               |
| 6   | Two near-simultaneous acks (different Idempotency-Keys)    | `count === 1` vs `count === 0`      | First commits, second re-reads + returns 200 with existing row (idempotent path)     |
| 7   | Two near-simultaneous acks (no Idempotency-Key)            | State machine natural serialization | Same as #6 (state machine + compare-and-set guard the boundary)                      |
| 8   | Prisma P2002 (partial-unique-index race)                   | `commitTransition` catches          | 409 `invalid_state_transition` with `reason: "concurrent_modification"` (NOT 500)    |
| 9   | Prisma P2003 (FK violation on `assigneeUserId`)            | `commitTransition` catches          | 400 `invalid_assignee` with `reason: "not_found"` (NOT 500)                          |
| 10  | `OptimisticConcurrencyError` thrown                        | `commitTransition` catches          | 409 with `reason: "concurrent_modification"`; `invalid_transition_attempt` audit     |
| 11  | Technician viewer requesting incident they're not assignee | `GET /api/incidents/:id`            | 403 `forbidden` (per-row ownership check)                                            |
| 12  | Technician viewer requesting incident they ARE assignee    | `GET /api/incidents/:id`            | 200 with `IncidentPayload`                                                           |
| 13  | Admin / Operator / Viewer                                  | `GET /api/incidents/:id`            | 200 with `IncidentPayload` (no per-row check)                                        |
| 14  | Caller requests `GET /api/incidents/:id/events`            | Render                              | 200 with `{ events: IncidentEventPayload[] }` in chronological `createdAt ASC` order |
| 15  | StrictMode-double-mount of `idempotencyMw` (per-builder)   | Two parallel transition POSTs       | Second test isolation is preserved (per-builder `IdempotencyStore` doesn't share)    |

### incidents/transitionHelpers.ts

| #   | Given                                                     | When                                              | Then                                                                                                            |
| --- | --------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 16  | Verb = `reopen` + body `{ reason: "too short" }`          | `parseBody`                                       | `{ ok: false, issues: [...] }` (Zod min-length failure)                                                         |
| 17  | Verb = `reopen` + body `{ reason: "    " }` (whitespace)  | `parseBody`                                       | `{ ok: false, issues: [...] }` (Zod trim → min-length failure)                                                  |
| 18  | Verb = `reopen` + body `{ reason: 2001-char string }`     | `parseBody`                                       | `{ ok: false, issues: [...] }` (Zod max-length failure)                                                         |
| 19  | Verb = `acknowledge` + missing body                       | `parseBody`                                       | `{ ok: true, body: {} }` (empty body is allowed for empty-body verbs)                                           |
| 20  | Verb = `assign` + body `{ assignee_user_id: "not-uuid" }` | `parseBody`                                       | `{ ok: false, issues: [...] }`                                                                                  |
| 21  | Verb = `submit_result` + body `{ outcome: "INVALID" }`    | `parseBody`                                       | `{ ok: false, issues: [...] }` (InspectionOutcomeSchema rejects)                                                |
| 22  | State machine miss (`OPEN → RESOLVED` direct)             | `respondInvalidAttempt`                           | 409 envelope `{ error: "invalid_state_transition", from: "OPEN", attempted: "resolve" }`                        |
| 23  | Concurrency loss in `applyTransition`                     | `commitTransition` catches                        | 409 envelope `{ error: "invalid_state_transition", reason: "concurrent_modification" }` (no `from`/`attempted`) |
| 24  | `notify:critical` write attempts during concurrent ops    | P2002 raised                                      | 409 with `reason: "concurrent_modification"` (benign idempotency)                                               |
| 25  | `response.json` shape per Zod parse                       | `InvalidStateTransitionEnvelopeSchema.parse(...)` | Result matches the schema (catches adapter drift on the canonical envelope)                                     |
| 26  | `logTransition` for every successful transition           | Console warn                                      | Line contains `event: "incident_transition"`, `from`, `to`, `verb`, `actor_user_id`, `at`                       |

### notifications/notificationRouter.ts

| #   | Given                                                    | When                                       | Then                                                                                          |
| --- | -------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 27  | `req.user.role` = "Operator"                             | `GET /api/notifications`                   | 200 with `{ notifications: NotificationPayload[] }`, role-scoped, `acknowledgedAt: null` only |
| 28  | `req.user.role` = "Viewer"                               | `GET /api/notifications`                   | 403 (matrix grants `read × Notification` = N for Viewer)                                      |
| 29  | `take: 50` enforced                                      | More than 50 unread rows                   | Response bounded at 50; `createdAt DESC` ordering preserved                                   |
| 30  | First ack by Technician                                  | `PATCH /api/notifications/:id/acknowledge` | `count === 1` → 200 with row; `console.warn first=true`; `recipientRole` matches actor        |
| 31  | Re-ack of already-acked row                              | `PATCH /api/notifications/:id/acknowledge` | `count === 0` → 200 with existing row; `console.warn first=false`; NO `acknowledgedAt` change |
| 32  | Actor acknowledges row of different `recipientRole`      | `PATCH /api/notifications/:id/acknowledge` | 403 `forbidden`; `rbac_denied` audit; `required_role` = `row.recipientRole`                   |
| 33  | Admin caller                                             | `GET /api/notifications/admin/list`        | 200 with `{ notifications: AdminNotificationPayload[] }` (leaks `acknowledgedByUserId`)       |
| 34  | Non-Admin caller                                         | `GET /api/notifications/admin/list`        | 403 (matrix grants `read_all × Notification` = Admin only)                                    |
| 35  | `?severity=critical&severity=warning`                    | `parseAdminQueryParams`                    | Filters narrowed to `{ severity: { in: ["critical", "warning"] } }` (de-duplicated)           |
| 36  | `?severity=` (empty) + other chips active                | `parseAdminQueryParams`                    | Empty values dropped; non-empty chips survive                                                 |
| 37  | `?severity=foo` (unknown enum value)                     | `parseAdminQueryParams`                    | 400 `validation_error` with `code: "invalid_enum_value"`, `path: ["severity"]`                |
| 38  | `?since=2026-09-01T00:00:00Z&until=2026-08-01T00:00:00Z` | `parseAdminQueryParams`                    | 400 `invalid_range` ("`since` must be strictly less than `until`")                            |
| 39  | `?since=2026-09-01T00:00:00Z&until=2026-09-02T00:00:00Z` | `parseAdminQueryParams`                    | Filters set; `since` < `until` passes                                                         |
| 40  | `parseAdminQueryParams` returns `kind: "error"`          | `buildAdminEnvelope` not invoked           | Response already sent (handler returns early)                                                 |
| 41  | Adapter drift drops `acknowledgedByUserId`               | `buildAdminEnvelope`                       | 500 `internal_error` + `console.error` (NOT silent `undefined` propagation)                   |
| 42  | Vanishingly rare: row vanishes between fetch + update    | `refetchRow` returns null                  | 404 `not_found` (defensive)                                                                   |
| 43  | `take: 100` enforced on admin list                       | More than 100 rows                         | Response bounded at 100                                                                       |

### attachments/attachmentRouter.ts

| #   | Given                                          | When                                  | Then                                                                |
| --- | ---------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| 44  | Caller = Admin + valid URL + valid label       | `POST /api/incidents/:id/attachments` | 201 with `AttachmentPayload`                                        |
| 45  | Caller = Operator + valid URL                  | `POST /api/incidents/:id/attachments` | 201 (matrix grants `create × Attachment` to Operator)               |
| 46  | Caller = Technician + assigned to incident     | `POST /api/incidents/:id/attachments` | 201 (per-row ownership passes)                                      |
| 47  | Caller = Technician + NOT assigned to incident | `POST /api/incidents/:id/attachments` | 403 `forbidden`; `rbac_denied` audit; `required_role: "Technician"` |
| 48  | Caller = Viewer                                | `POST /api/incidents/:id/attachments` | 403 (matrix grants `create × Attachment` = N for Viewer)            |
| 49  | URL = `javascript:alert(1)`                    | `validateHttpUrl` rejects             | 400 `invalid_payload` with `path: ["url"]`                          |
| 50  | URL = `data:text/html,<script>...`             | `validateHttpUrl` rejects             | 400 `invalid_payload`                                               |
| 51  | URL = `file:///etc/passwd`                     | `validateHttpUrl` rejects             | 400 `invalid_payload`                                               |
| 52  | URL = `vbscript:msgbox(1)`                     | `validateHttpUrl` rejects             | 400 `invalid_payload`                                               |
| 53  | URL = relative path (`/foo`)                   | `validateHttpUrl` rejects             | 400 `invalid_payload`                                               |
| 54  | URL = malformed (e.g. `not a url`)             | `validateHttpUrl` rejects             | 400 `invalid_payload`                                               |
| 55  | Body has `mime: "not-a-mime"`                  | `createBodySchema.safeParse` fails    | 400 `invalid_payload`                                               |
| 56  | Body has `label` 201+ chars                    | `createBodySchema.safeParse` fails    | 400 `invalid_payload` (max 200)                                     |
| 57  | Caller = original uploader (not Admin)         | `DELETE /api/attachments/:id`         | 204 `no_content` (per-row ownership: uploader can delete own)       |
| 58  | Caller = different Operator / Technician       | `DELETE /api/attachments/:id`         | 403 `forbidden` (per-row ownership fails; `required_role: "Admin"`) |
| 59  | Caller = Admin                                 | `DELETE /api/attachments/:id`         | 204 `no_content` (matrix-level grant; Admin bypass)                 |
| 60  | Caller = any role                              | `GET /api/incidents/:id/attachments`  | 200 with `{ attachments: AttachmentPayload[] }`, `createdAt DESC`   |
| 61  | Caller = Technician + assigned to incident     | `GET /api/incidents/:id/attachments`  | 200 (per-row ownership passes)                                      |
| 62  | Caller = Technician + NOT assigned to incident | `GET /api/incidents/:id/attachments`  | 403 `forbidden` (per-row ownership fails)                           |

### alerts/acknowledgeRouter.ts

| #   | Given                                                                      | When                                        | Then                                                                                            |
| --- | -------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 63  | Caller = Admin                                                             | `POST /api/alerts/:alert_id/acknowledge`    | 200 with `AlertAcknowledgeResponse`; `console.warn first=true`; `alert:acknowledged` emit fires |
| 64  | Caller = Operator                                                          | `POST /api/alerts/:alert_id/acknowledge`    | 200 (matrix grants `acknowledge × Alert` to Operator)                                           |
| 65  | Caller = Viewer                                                            | `POST /api/alerts/:alert_id/acknowledge`    | 403 + audit                                                                                     |
| 66  | Caller = Technician                                                        | `POST /api/alerts/:alert_id/acknowledge`    | 403 + audit (matrix grants `acknowledge × Alert` = N for Technician)                            |
| 67  | First ack                                                                  | `count === 1`                               | 200 + emit + `first=true` log line                                                              |
| 68  | Re-ack by same actor                                                       | `count === 0`                               | 200 with existing row values; NO emit; `first=false` log line                                   |
| 69  | Re-ack by different actor                                                  | `count === 0`                               | 200 with existing row values (idempotent path preserves first-actor's `acknowledgedByUserId`)   |
| 70  | Concurrent acks (race)                                                     | `count === 1` vs `count === 0`              | Exactly one 200 with new values; the other 200 with existing values (no double-emit)            |
| 71  | Non-UUID `:alert_id`                                                       | Path-param parse fails                      | 400 `validation_error`                                                                          |
| 72  | Unknown `:alert_id`                                                        | `count === 0` + `findUnique` returns null   | 404 `not_found`                                                                                 |
| 73  | Race: row deleted between updateMany + findUnique                          | `count === 0` + `findUnique` returns null   | 404 `not_found` (vanishingly rare, defensive)                                                   |
| 74  | Same `now()` passed to DB write + response body                            | Inspect response + DB row                   | Identical `acknowledgedAt` (no 1ms drift)                                                       |
| 75  | Emit throws post-commit                                                    | `try/catch` around `broadcast.to(...).emit` | 200 still returned; `console.warn` logs the emit failure                                        |
| 76  | `AlertAcknowledgeResponseSchema` drift                                     | `safeParse` fails                           | 500 `internal_error`; NO emit fires (drift-500 must not produce phantom emit)                   |
| 77  | Structurally impossible: `acknowledgedAt` set, `acknowledgedByUserId` null | `data_corruption` kind                      | 500 `internal_error`; `console.error` log                                                       |

### middleware/idempotency.ts

| #   | Given                                                                   | When                               | Then                                                                           |
| --- | ----------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| 78  | `Idempotency-Key` header present + valid UUIDv4                         | First request                      | `next()` runs; response captured in store; status + body recorded              |
| 79  | `Idempotency-Key` header present + valid UUIDv4 (duplicate)             | Second request within 5 min        | Cached response replayed byte-for-byte; handler NOT invoked                    |
| 80  | `Idempotency-Key` header absent                                         | Request                            | `next()` runs (no caching; route's natural state-machine idempotency applies)  |
| 81  | `Idempotency-Key` header present + malformed (non-UUIDv4)               | Request                            | 400 `invalid_idempotency_key`                                                  |
| 82  | `Idempotency-Key` header present + valid UUIDv4 (duplicate after 5 min) | Request                            | First request's response expired; second request runs `next()` + records fresh |
| 83  | Handler responds 2xx                                                    | `res.json` interception            | Status + body recorded in store (`< 500`)                                      |
| 84  | Handler responds 4xx                                                    | `res.json` interception            | Status + body recorded in store (`< HTTP_STATUS_MAX_CACHEABLE`)                |
| 85  | Handler responds 5xx                                                    | `res.json` interception            | Status + body NOT recorded (transient failures must not poison cache)          |
| 86  | `IdempotencyStore.lookup` for expired key                               | `lookup(key, nowMs)`               | Returns `null` + auto-evicts (cache stays bounded)                             |
| 87  | `IdempotencyStore.record` writes                                        | `record(key, status, body, nowMs)` | Cache key set with `expiresAtMs = nowMs + IDEMPOTENCY_TTL_MS`                  |
| 88  | `IdempotencyStore.reset` (test rig)                                     | Wipe between cases                 | `cache.clear()` invoked; `lookup` returns `null` for prior keys                |
| 89  | `idempotency` factory without store arg                                 | `idempotency()`                    | Default process-wide `defaultStore` is used (tests can pass their own)         |
| 90  | Per-builder `IdempotencyStore` isolation                                | Two `buildIncidentsRouter` calls   | Each router's middleware uses its own store (no cross-test pollution)          |

### rules/applyTransition.ts + incidents/incidentStateRepository.ts

| #   | Given                                                                     | When                           | Then                                                                                                    |
| --- | ------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 91  | `transition.kind === "open"`                                              | `applyTransition`              | `applyOpenTransition` runs in `$transaction` (findOpenAlert + alert.create + ruleDebounceState.upsert)  |
| 92  | `transition.kind === "clear"`                                             | `applyTransition`              | `applyClearTransition` runs in `$transaction` (findOpenAlert + alert.update + ruleDebounceState.upsert) |
| 93  | `$transaction` callback throws                                            | Prisma rolls back              | No orphan `Alert` row; no orphan `ruleDebounceState` row                                                |
| 94  | Post-commit `AlertOpenedEventSchema.safeParse` fails                      | `applyOpenTransition`          | Emit skipped; `console.warn` logs the drift                                                             |
| 95  | Post-commit `IncidentOpenedEventSchema.safeParse` fails                   | `applyOpenTransition`          | Emit skipped; `console.warn` logs the drift                                                             |
| 96  | `applyOpenTransition` resolves `alertId` inside transaction               | Post-commit emit               | `alert:opened` emit carries the in-transaction `alertId` (not a pre-transaction guess)                  |
| 97  | `applyClearTransition` resolves `alertId` via partial-index lookup        | In-transaction findUnique      | Emit references the partial-index-resolved `alertId` (resolves the loopback-1 mismatch)                 |
| 98  | `IncidentStateRepository.findMany` (active endpoint)                      | State filter `not: "RESOLVED"` | Returns the full active list; `select: never` (interface-enforced)                                      |
| 99  | `IncidentStateRepository.findMany` (Technician viewer)                    | `assigneeUserId: req.user.id`  | Returns only the Technician's assigned incidents                                                        |
| 100 | `IncidentStateRepository.findMany` (Admin / Operator)                     | No `assigneeUserId`            | Returns the full active list (no per-row narrowing)                                                     |
| 101 | `IncidentStateRepository.updateMany` (optimistic concurrency)             | Concurrent writer beat us      | `count: 0` → route maps to 409 (NOT 500; NOT silent overwrite)                                          |
| 102 | `IncidentStateRepository.notification.create` (UNSAFE outcome)            | Inside the same `$transaction` | Notification row commits atomically with the incident + event                                           |
| 103 | `IncidentStateRepository.notification.create` (partial unique index race) | P2002 raised                   | Caller's P2002 catch in `commitTransition` maps to 409                                                  |

## Static / lint pins

| #   | Property                                                                                                                          | Required value                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 104 | All 8 source file opening headers                                                                                                 | ≤ 7 lines. Pre-loop: 28-58 lines                                                                                                                                                          |
| 105 | `notificationRouter.ts` "Extracted from the route handler to keep the closure under `complexity: 10`" block count                 | Exactly **0** (one canonical reference at the top of the helper block). Pre-loop: 9                                                                                                       |
| 106 | `notificationRouter.ts` "Loop 1 review finding E2 / E5" marker count                                                              | Exactly **0**. Pre-loop: 2                                                                                                                                                                |
| 107 | `transitionHelpers.ts` + `router.ts` "Patch (code review 2026-08-27 #N)" marker count                                             | Exactly **0**. Pre-loop: 10                                                                                                                                                               |
| 108 | `idempotency.ts` "Web client follow-up" footer                                                                                    | Removed (the web follow-up has shipped via the `idempotencyKey.ts` plan; the stale `IncidentCard.tsx` reference is gone)                                                                  |
| 109 | Cross-file line-number references (e.g. `acknowledgeRouter.ts:349-443`, `router.ts:251-265`, `incidentStateRepository.ts:20-161`) | Exactly **0** across all 8 files. Pre-loop: 10+                                                                                                                                           |
| 110 | `transitionHelpers.ts` opening header                                                                                             | ≤ 6 lines. Pre-loop: 18                                                                                                                                                                   |
| 111 | `router.ts` opening header                                                                                                        | ≤ 7 lines. Pre-loop: 58                                                                                                                                                                   |
| 112 | `notificationRouter.ts` opening header                                                                                            | ≤ 6 lines. Pre-loop: 41                                                                                                                                                                   |
| 113 | `attachmentRouter.ts` opening header                                                                                              | ≤ 6 lines. Pre-loop: 38                                                                                                                                                                   |
| 114 | `acknowledgeRouter.ts` opening header                                                                                             | ≤ 12 lines (kept the AC1/AC1e/AC12b/AC1c + RBAC summary as the wire-contract pin). Pre-loop: 64                                                                                           |
| 115 | `idempotency.ts` opening header                                                                                                   | ≤ 8 lines (kept the wire-contract summary as the seam pin). Pre-loop: 40                                                                                                                  |
| 116 | `applyTransition.ts` opening header                                                                                               | ≤ 6 lines. Pre-loop: 32                                                                                                                                                                   |
| 117 | `incidentStateRepository.ts` opening header                                                                                       | ≤ 6 lines. Pre-loop: 28                                                                                                                                                                   |
| 118 | Story-internal jargon                                                                                                             | No "Story 3.5 (FR-15)" / "Story 4.2" / "Story 4.3" / "Story 4.4" / "Story 4.9" / "Story 4.10" / "Story 4.11" / "Story 4.12" / "Story 4.13" / "Story 5.1" / "Finding #N" in source headers |
| 119 | AC codes in source headers                                                                                                        | No "AC1" / "AC1c" / "AC1d" / "AC1e" / "AC4" / "AC12" / "AC12b" in source headers                                                                                                          |
| 120 | Matrix-row codes in source headers                                                                                                | No "ACK_VIEWER_DENIED" / "ACK_TECHNICIAN_DENIED" / "ACK_RACE_LOSER" / "MARK_AS_READ_IDEMPOTENT" / "ACK_RESPONSE_SCHEMA_DRIFT" in source headers                                           |
| 121 | Code-review-patch markers in source headers                                                                                       | No "Patch (code review 2026-08-27 #N)" markers in source                                                                                                                                  |
| 122 | `idempotency.ts` exports                                                                                                          | `idempotency`, `IdempotencyStore`, `IDEMPOTENCY_TTL_MS`                                                                                                                                   |
| 123 | `router.ts` re-exports                                                                                                            | `PrepareCtxInput`, `TransitionContext` (re-exported so the test rig can import from `./router.js`)                                                                                        |

## Negative pins (regression guards)

| #   | Behaviour                                            | Must NOT happen                                                                                                                                          |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 124 | `transitionHelpers.ts` 409 envelope                  | Drift between `{ from, attempted }` and `{ reason }` shapes — must always be a discriminated union via `InvalidStateTransitionEnvelopeSchema.parse(...)` |
| 125 | `router.ts` 5 transition POSTs                       | Drop the `idempotencyMw` — every transition POST must wrap the handler in `idempotency(...)`                                                             |
| 126 | `notificationRouter.ts` 403 path                     | Allow cross-role `recipientRole` mismatch — must emit `rbac_denied` audit + 403                                                                          |
| 127 | `notificationRouter.ts` admin list                   | Silently drop unknown `?severity=foo` — must 400 with `invalid_enum_value`                                                                               |
| 128 | `notificationRouter.ts` admin list                   | Silently accept `?since > ?until` — must 400 with `invalid_range`                                                                                        |
| 129 | `attachmentRouter.ts` URL validation                 | Accept `javascript:` / `data:` / `file:` / `vbscript:` / relative paths — must 400 with `invalid_payload`                                                |
| 130 | `attachmentRouter.ts` MIME validation                | Accept arbitrary strings — must 400 with regex failure                                                                                                   |
| 131 | `attachmentRouter.ts` Tech-ownership                 | Skip the per-row check — must 403 for Technicians not assigned to the incident                                                                           |
| 132 | `acknowledgeRouter.ts` emit                          | Fire on re-ack (`count === 0`) — must emit ONLY on first-ack                                                                                             |
| 133 | `acknowledgeRouter.ts` response                      | Drift between the DB `acknowledgedAt` and the response `acknowledged_at` — must pass the same `Date` instance to both                                    |
| 134 | `idempotency.ts` 5xx responses                       | Be cached — must NOT cache transient failures                                                                                                            |
| 135 | `idempotency.ts` malformed `Idempotency-Key`         | Pass through — must 400 with `invalid_idempotency_key`                                                                                                   |
| 136 | `applyTransition.ts` post-commit                     | Run the emit BEFORE the `$transaction` commits — must emit AFTER (per Design Note "Socket emit happens post-commit")                                     |
| 137 | `applyTransition.ts` open transition                 | Resolve `alertId` BEFORE the transaction — must resolve INSIDE (the partial-index lookup happens within the txn)                                         |
| 138 | `incidentStateRepository.ts` `$transaction` callback | Roll forward on a throw — must roll back (Prisma's `$transaction` semantics)                                                                             |
| 139 | `incidentStateRepository.ts` `updateMany`            | Silently overwrite on concurrent writer — must return `count: 0` so the route can 409                                                                    |
| 140 | Source file headers                                  | Re-introduce a 38+ line narrative block re-telling Story / AC / matrix-row / Patch-N codes                                                               |

## Verification commands

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/incidents src/notifications src/attachments src/middleware src/rules src/alerts
cd packages/api && npx vitest run
```

Existing specs: `incidents/transitions.spec.ts`, `incidents/router.spec.ts`, `incidents/applyTransition.spec.ts`, `incidents/activeRouter.spec.ts`, `incidents/recentRouter.spec.ts`, `notifications/notificationRouter.spec.ts`, `notifications/notificationRowToPayload.spec.ts`, `attachments/attachmentRouter.spec.ts`, `middleware/idempotency.spec.ts`, `middleware/authorize.spec.ts`, `alerts/acknowledgeRouter.spec.ts`, `alerts/listRouter.spec.ts`, `rules/__tests__/engine.spec.ts`, `rules/__tests__/hooks.spec.ts`, `rules/__tests__/cache.spec.ts`, `rules/__tests__/debounce.spec.ts`, `admin/simulatorRouter.spec.ts`, `admin/thresholdsRouter.spec.ts`, `auth/router.spec.ts`, `auth/ingest-jwt.spec.ts`, `auth/users.spec.ts`, `auth/jwt.spec.ts`, `ingest/server.spec.ts`, `ingest/frame.spec.ts`, `ingest/rateLimit.spec.ts`, `ingest/sequence.spec.ts`, `ingest/subscriber.spec.ts`, `ingest/subscriberSocket.spec.ts`, `readings/latestRouter.spec.ts`, `devices/router.spec.ts`. All must stay green; the canonical 409 envelope shape + the `idempotency` wire contract + the compare-and-set `count === 1` vs `count === 0` discriminator are load-bearing for the discriminator assertions in those specs.
