# Test spec — `packages/shared/src` critique loop

**Date:** 2026-09-02
**Surface:** `packages/shared/src/` (refinement of headers + cross-file refs + story jargon)
**Companion critique:** `.impeccable/critique/2026-09-02T23-00-00Z__packages-shared-src.md` (22/40, 4 P1 + 56 P2)

This spec pins the load-bearing wire contracts + invariants that survived the refactor pass. The header-trim and cross-file-reference removal work does not change behaviour; this spec verifies the contracts that depend on the surface (RBAC matrix, telemetry wire contract, error envelope discriminator, admin/user notification schema divergence) still hold.

## Behavioural pins (Given/When/Then)

### RBAC matrix (rbac.ts)

- **B-RBAC-1**: Given `RoleSchema = z.enum(["Admin","Operator","Technician","Viewer"])`, when any role literal is parsed, then the inferred type is the closed 4-element union.
- **B-RBAC-2**: Given `ActionSchema = z.enum([...14 entries])`, when `pnpm lint:rbac` runs across the api routers, then every `authorize({ action, resource })` call passes a literal that compiles against the `Action` union.
- **B-RBAC-3**: Given `ResourceSchema = z.enum([...12 entries])`, then `Attachment` is in the resource set (Story 4.13) and `AuditLog` is in the resource set.
- **B-RBAC-4**: Given `RBAC_MATRIX.Admin.read_all.Notification = true`, when `isAllowed({ subject: "Admin", action: "read_all", resource: "Notification" })` is called, then it returns `true`.
- **B-RBAC-5**: Given `RBAC_MATRIX.Operator.read_all.Notification = false`, when `isAllowed({ subject: "Operator", action: "read_all", resource: "Notification" })` is called, then it returns `false`.
- **B-RBAC-6**: Given `RBAC_MATRIX.Viewer.submit_result.Incident = false`, when `isAllowed({ subject: "Viewer", action: "submit_result", resource: "Incident" })` is called, then it returns `false`.
- **B-RBAC-7**: Given `isAllowed({ subject: "Hacker", action: "read", resource: "Device" })` (unknown subject), then it returns `false` (fail-closed invariant).
- **B-RBAC-8**: Given `isAllowed({ subject: "Admin", action: "skydive", resource: "Device" })` (unknown action), then it returns `false` (fail-closed invariant).
- **B-RBAC-9**: Given `isAllowed({ subject: "Admin", action: "read", resource: "QuantumFlux" })` (unknown resource), then it returns `false` (fail-closed invariant).
- **B-RBAC-10**: Given `RBAC_NEGATIVE_CASES`, when the api's Story 1.8 negative tests run, then every case maps to the documented `appendixRow` in `docs/architecture-appendix-rbac.md`.

### Incident state machine (incident.ts)

- **B-INC-1**: Given `IncidentStateSchema = z.enum([...8 entries])`, then the 8 states are `OPEN | ACKNOWLEDGED | INSPECTING | SAFE | UNSAFE | MONITORING | RESOLVED | REOPENED`.
- **B-INC-2**: Given `INCIDENT_STABLE_STATES`, then `REOPENED` is excluded (it is a transition alias, not a stable state).
- **B-INC-3**: Given `shouldCreateIncident("warning")` and `shouldCreateIncident("critical")`, both return `true`.
- **B-INC-4**: Given `shouldCreateIncident("info")`, it returns `false` (informational alerts do not generate work items).
- **B-INC-5**: Given `shouldCreateIncident("garbage")`, it returns `false` (fail-closed invariant).
- **B-INC-6**: Given `projectKanbanColumn("OPEN", "critical")`, it returns `OPEN_CRITICAL` (UX-DR-9 split).
- **B-INC-7**: Given `projectKanbanColumn("OPEN", "warning")`, it returns `OPEN_WARNING`.
- **B-INC-8**: Given `projectKanbanColumn("RESOLVED", "critical")`, it returns `RESOLVED`.
- **B-INC-9**: Given `projectKanbanColumn("SAFE", "info")`, it returns `RESOLVED` (state-driven, severity irrelevant).
- **B-INC-10**: Given `projectKanbanColumn("UNSAFE", "info")`, it returns `OPEN_CRITICAL` (UNSAFE forces critical column).
- **B-INC-11**: Given `ActionVerbSchema`, the 5 verbs are `acknowledge | assign | submit_result | resolve | reopen`.
- **B-INC-12**: Given `ActionVerb` enum and `ActionSchema`'s incident verbs (in rbac.ts), then both sets are the same 5 verbs (source-walk pin in `incident-actions.schema.spec.ts`).

### Notification schemas (notification.ts)

- **B-NOTIF-1**: Given `NotificationPayloadSchema`, the inferred type has NO `acknowledgedByUserId` field.
- **B-NOTIF-2**: Given `AdminNotificationPayloadSchema`, the inferred type HAS `acknowledgedByUserId: string | null`.
- **B-NOTIF-3**: Given `NotificationPayloadSchema.parse(...)` is called with the api's operator-facing wire payload, then `safeParse` succeeds.
- **B-NOTIF-4**: Given `NotificationPayloadSchema.parse(...)` is called with the api's admin-facing wire payload (carrying `acknowledgedByUserId`), then `safeParse` succeeds (the field is silently dropped — `.strict()` is NOT applied).
- **B-NOTIF-5**: Given `AdminNotificationPayloadSchema.parse(...)` is called with the api's admin-facing wire payload, then `safeParse` succeeds.
- **B-NOTIF-6**: Given `AdminNotificationPayloadSchema.parse(...)` is called WITHOUT `acknowledgedByUserId`, then `safeParse` FAILS (the admin schema is strict about the audit-lens field).
- **B-NOTIF-7**: Given `AdminNotificationFilters`, then `severity?: readonly NotificationSeverity[]`, `since?: string`, `until?: string`, `sincePresetMs?: number`.

### Telemetry wire contract (telemetry.ts)

- **B-TEL-1**: Given `TelemetryFrameSchema`, the inferred type is `{ version: 1, device_id: uuid, ts: int>=0, fw: 1..64 chars, seq: int>=0, metrics: TelemetryMetrics }`.
- **B-TEL-2**: Given `TelemetryFrameSchema` is `.strict()`, then an unknown TOP-LEVEL key (e.g. `extra_a`) rejects with `unrecognized_keys`.
- **B-TEL-3**: Given `TelemetryMetricsSchema` is NOT `.strict()`, then an unknown metric key is silently dropped (forward-compat per ADR 0001).
- **B-TEL-4**: Given a metric value `NaN` or `Infinity`, then `rangedFloat` rejects with `expected number, received NaN`.
- **B-TEL-5**: Given `STALE_FRAME_THRESHOLD_MS = 5 * MS_PER_MINUTE = 300_000`, the threshold is 5 minutes.
- **B-TEL-6**: Given `CLOCK_SKEW_DETECT_MS = MS_PER_MINUTE = 60_000`, the threshold is 60 seconds.
- **B-TEL-7**: Given `classifyFlags({ ...valid, ts: now - 90s }, now)`, the helper returns `["clock_skew_detected"]`.
- **B-TEL-8**: Given `classifyFlags({ ...valid, ts: now - 30s }, now)`, the helper returns `[]`.
- **B-TEL-9**: Given `translateZodError` issues with paths `["metrics", "ph"]` and `["metrics", "ph"]` and codes `["invalid_type", "too_small"]`, then both `metrics.ph` entries appear in `missing_fields` (de-dup by `path + code`, not by path alone).
- **B-TEL-10**: Given `translateZodError` with an `unrecognized_keys` issue carrying `keys: ["extra_a", "extra_b"]`, then BOTH `extra_a` and `extra_b` appear in `missing_fields` (separate entries, not `extra_a.extra_b`).
- **B-TEL-11**: Given `PROCESSING_ORDER`, the 10-step ordering is `validate → auth check → rate check → seq/drop check → persist → rule evaluation → alert emission → state-machine update → audit append → socket broadcast`.

### Error envelope (error-envelope.ts)

- **B-ENV-1**: Given `InvalidStateTransitionEnvelopeSchema`, the inferred type has `error: "invalid_state_transition"`, `from?: string`, `attempted?: string`, `reason?: string`.
- **B-ENV-2**: Given a typed state-machine miss envelope `{ error: "invalid_state_transition", from: "OPEN", attempted: "acknowledge" }` (no `reason`), then `safeParse` succeeds.
- **B-ENV-3**: Given a DB-layer concurrency envelope `{ error: "invalid_state_transition", reason: "concurrent_modification" }` (no `from`/`attempted`), then `safeParse` succeeds.
- **B-ENV-4**: Given the web helper parses a 409 body via `InvalidStateTransitionEnvelopeSchema.safeParse(...)`, the discriminator branch is selected by which optional fields are present.

### Audit (audit.ts)

- **B-AUD-1**: Given `AuditLogResourceSchema`, the 13 resources include `Device | Reading | Alert | Incident | Rule | User | School | Notification | Simulator | SeverityBanner | Attachment | Session | Other`.
- **B-AUD-2**: Given `AuditLogEntrySchema.actorUserId` is `nullable`, then a deleted actor's audit rows still surface with `actorUserId: null` (FK is `ON DELETE SET NULL`).
- **B-AUD-3**: Given `AuditLogEntrySchema.auditAction` is `z.string()` (NOT the closed `AuditActionSchema` enum), then a future writer-side action added before this read surface knows about it still renders in the admin UI.
- **B-AUD-4**: Given `AuditLogEntrySchema.payload` is `z.unknown()`, then any JSON-deserialisable value is accepted.

### Reading aggregate (reading-aggregate.ts)

- **B-RA-1**: Given `ReadingAggregateMetricSchema`, the 6 metrics include `tds | turbidity | ph | temperature | battery | signal` (battery + signal are device-health channels aggregated identically).
- **B-RA-2**: Given `floorToFiveMinutes(new Date("2026-09-02T12:34:00Z"))`, the result is `new Date("2026-09-02T12:30:00Z")` (floor to nearest 5 minutes).
- **B-RA-3**: Given `floorToFiveMinutes(new Date("2026-09-02T12:35:00Z"))`, the result is `new Date("2026-09-02T12:35:00Z")` (already aligned).
- **B-RA-4**: Given `floorToFiveMinutes(new Date(NaN))`, it throws `TypeError("floorToFiveMinutes: input Date is not finite")`.

### Retention (retention.ts)

- **B-RET-1**: Given `CronRunStatusSchema`, the 3 statuses are `"running" | "success" | "failure"`.
- **B-RET-2**: Given `CronTickResult`, the discriminated union has `{ status: "success", aggregatedRows, deletedRows }` and `{ status: "skipped", reason: "lock_held" }` arms.
- **B-RET-3**: Given `RetentionConfigSchema`, the 4 fields are `retentionWindowDays` (positive int), `batchSize` (positive int), `intervalMs` (positive int), `lockKey` (bigint).

### Alerts (alerts.ts)

- **B-ALERT-1**: Given `AlertSummarySchema.linked_alerts` is REQUIRED (`z.array(AlertLinkedSchema)`), then a payload with the field omitted fails `safeParse`.
- **B-ALERT-2**: Given `AlertAcknowledgeResponseSchema`, the inferred type mirrors `AlertAcknowledgedEventSchema` (snake_case, all required) so REST + socket surfaces are interchangeable.

### Rules (rule.ts)

- **B-RULE-1**: Given `RULE_METRICS`, the 6 metric keys are `ph | tds_ppm | turbidity_ntu | chlorine_ppm | temp_c | water_level_cm`.
- **B-RULE-2**: Given `RULE_OPERATORS`, the 5 operators are `gte | gt | lte | lt | eq` (Prisma enum identifiers).
- **B-RULE-3**: Given `RULE_SEVERITIES`, the 3 severities are `info | warning | critical`.
- **B-RULE-4**: Given `RULE_RULE_TYPES`, the 3 rule types are `instant | rate | absence`.
- **B-RULE-5**: Given `RulePatchRequestSchema`, the discriminated union enforces "exactly one of `supersede: true` or `activate: false`" via `.refine(...)` (empty body rejected; both fields rejected).

### Dashboard (dashboard.ts)

- **B-DASH-1**: Given `placeholderSeverity({ metrics: { ph: 7.2, tds_ppm: 180, ... } })` (Normal scenario), it returns `"healthy"`.
- **B-DASH-2**: Given `placeholderSeverity({ metrics: { ph: 7.2, tds_ppm: 600, ... } })` (above `tds_ppm.max = 500`), it returns `"critical"`.
- **B-DASH-3**: Given `placeholderSeverity({ metrics: { ph: NaN, ... } })`, it returns `"critical"` (silent NaN = metric is wrong).
- **B-DASH-4**: Given `isOffline({ last_reading_at: null }, now)`, it returns `true`.
- **B-DASH-5**: Given `isOffline({ last_reading_at: now - 90s }, now)`, it returns `true` (lapsed > 60s).
- **B-DASH-6**: Given `isOffline({ last_reading_at: now - 30s }, now)`, it returns `false`.
- **B-DASH-7**: Given `deviceMapSeverity({ last_reading_at: null }, undefined, now)`, it returns `"offline"`.
- **B-DASH-8**: Given `breachedMetric({ metrics: { ph: 7.2, tds_ppm: 600, ... } })`, it returns `{ key: "tds_ppm", value: 600 }`.

### Auth (auth.ts)

- **B-AUTH-1**: Given `USER_ACCESS_TOKEN_TTL_SECONDS = 28800`, that's 8 hours.
- **B-AUTH-2**: Given `REFRESH_TOKEN_TTL_SECONDS = 2592000`, that's 30 days.
- **B-AUTH-3**: Given `DEVICE_TOKEN_TTL_SECONDS = 86400`, that's 24 hours.
- **B-AUTH-4**: Given `SIMULATOR_TOKEN_TTL_SECONDS = 3600`, that's 1 hour.
- **B-AUTH-5**: Given `refreshTokenCookieOptions()`, the shape is `{ httpOnly: true, sameSite: "strict", path: "/auth", secure: false }` (dev mode).
- **B-AUTH-6**: Given `refreshTokenCookieOptions()` with `NODE_ENV=production`, `secure: true`.
- **B-AUTH-7**: Given `assertUuidV4("not-a-uuid")`, it throws.
- **B-AUTH-8**: Given `assertUuidV4("12345678-1234-1234-8234-123456789012")` (valid UUIDv4), no throw.

### Schemas (schemas.ts)

- **B-SCH-1**: Given `UUID_V4_REGEX.test("550e8400-e29b-41d4-a716-446655440000")` (valid UUIDv4), `true`.
- **B-SCH-2**: Given `UUID_V4_REGEX.test("550e8400-e29b-11d4-a716-446655440000")` (UUIDv1 — version nibble `1`), `false`.
- **B-SCH-3**: Given `UUID_V4_REGEX.test("550e8400-e29b-41d4-c716-446655440000")` (variant nibble `c`, invalid), `false`.
- **B-SCH-4**: Given `idPathSchema.parse({ id: "550e8400-e29b-41d4-a716-446655440000" })`, succeeds.
- **B-SCH-5**: Given `idPathSchema.parse({ id: "not-a-uuid" })`, fails.

### URL validation (urlValidation.ts)

- **B-URL-1**: Given `validateHttpUrl("https://example.com/photo.png")`, succeeds with `{ url: URL }`.
- **B-URL-2**: Given `validateHttpUrl("javascript:alert(1)")`, throws `InvalidUrlError`.
- **B-URL-3**: Given `validateHttpUrl("data:text/plain,hello")`, throws `InvalidUrlError`.
- **B-URL-4**: Given `validateHttpUrl("file:///etc/passwd")`, throws `InvalidUrlError`.
- **B-URL-5**: Given `validateHttpUrl("/relative/path")`, throws `InvalidUrlError`.
- **B-URL-6**: Given `validateHttpUrl("not-a-url")`, throws `InvalidUrlError`.
- **B-URL-7**: Given `validateHttpUrl("")`, throws `InvalidUrlError` ("URL must be a non-empty string").

### MIME auto-detect (mimeAutoDetect.ts)

- **B-MIME-1**: Given `detectMimeFromURL("https://example.com/photo.png")`, returns `"image/png"`.
- **B-MIME-2**: Given `detectMimeFromURL("https://example.com/file.unknown")`, returns `"application/octet-stream"`.
- **B-MIME-3**: Given `detectMimeFromURL("https://example.com/api/v1/x")` (no extension), returns `"application/octet-stream"`.
- **B-MIME-4**: Given `detectMimeFromURL("https://example.com/photo.PNG")` (uppercase), returns `"image/png"` (normalised).

### Simulator (simulator.ts)

- **B-SIM-1**: Given `SCENARIO_NAMES`, the 7 scenarios are `Normal | RisingTDS | TurbiditySpike | ChlorineDrop | Offline | BatteryLow | RandomFailure`.
- **B-SIM-2**: Given `SIMULATOR_FW_VERSION = "1.4.0"`, the simulator package must mirror this constant.
- **B-SIM-3**: Given `BASELINE_METRICS`, the 6 baseline values are pinned (`ph: 7.2`, `tds_ppm: 180`, `turbidity_ntu: 0.4`, `temp_c: 27`, `chlorine_ppm: 0.6`, `water_level_cm: 80`).

### Attachment (attachment.ts)

- **B-ATT-1**: Given `AttachmentPayloadSchema`, the 6 fields are `id | incident_id | url | label | mime | uploaded_by_user_id | created_at`.
- **B-ATT-2**: Given `AttachmentPayloadSchema.mime` is nullable, then a payload without the field parses (the api's nullable Prisma column).
- **B-ATT-3**: Given `AttachmentPayloadSchema.label` is nullable, then a payload without the field parses (operator may omit).

### Events (events.ts)

- **B-EVT-1**: Given `ReadingNewEventSchema.flags` has `.default([])`, then an unflagged frame parses with `flags: []`.
- **B-EVT-2**: Given `ReadingNewEventSchema.flags` has `.readonly()`, the inferred type is `readonly ReadingFlag[]`.
- **B-EVT-3**: Given `IncidentStateChangedEventSchema`, the 5 fields are `incident_id | from_state | to_state | changed_at | actor_user_id`.
- **B-EVT-4**: Given `INCIDENT_TRANSITION_VERB_LITERALS`, the 6 literals are `acknowledge | assign | submit_result | resolve | reopen | auto_create` (auto_create is system-driven, not in `ActionVerbSchema`).

## Static / lint pins (Property/Required value)

- **S-1**: All 18 modified source files in `packages/shared/src/` have NO `/** ... */` block opening longer than 7 lines (header trim target).
- **S-2**: No file in `packages/shared/src/` contains the string `Patch (code review 2026-08-27` (fix-history markers removed).
- **S-3**: No file in `packages/shared/src/` contains the string `Loop 1 review finding` or `Loop 2 hardening` (review-cycle markers removed).
- **S-4**: No file in `packages/shared/src/` contains the string `Renamed from` (fix-history markers removed).
- **S-5**: No file in `packages/shared/src/` contains the string `[Review][Patch] F-A8` (code-review markers removed).
- **S-6**: No file in `packages/shared/src/` contains the string `impeccable audit, 2026-09-01` (audit-loop markers removed).
- **S-7**: No file in `packages/shared/src/` contains a line reference of the form `\w+\.ts:\d+-\d+` (cross-file line refs removed; the regex catches both `:NN-NN` and `:NN` numeric refs).
- **S-8**: `pnpm lint:rbac` runs green on the api (matrix-shape compile-time check).
- **S-9**: `pnpm tsc -b` runs green on `packages/shared` (Zod schema inference pins).

## Behaviour / Must-NOT (negative pins)

- **N-1**: When `NotificationPayloadSchema` is the wire schema for the operator bell, then an `acknowledgedByUserId` field MUST NOT appear in the wire (operator-facing surface intentionally omits the audit-lens detail).
- **N-2**: When `AdminNotificationPayloadSchema` is the wire schema for the admin audit-lens, then omitting `acknowledgedByUserId` MUST fail `safeParse` (admin surface strictly pins the audit-lens field).
- **N-3**: When `TelemetryFrameSchema` is the wire schema for `reading:new`, then an unknown TOP-LEVEL key MUST reject (`unrecognized_keys`); an unknown metric key inside `metrics` MUST be silently dropped (forward-compat per ADR 0001).
- **N-4**: When `isAllowed` is called with any unknown triple (subject, action, or resource), it MUST return `false` (fail-closed invariant — no throw, no implicit grant).
- **N-5**: When `RBAC_MATRIX` is extended with a new `(Role, Action, Resource)` triple, then `tsc` MUST refuse to compile a handler that references the new action without an explicit matrix entry (the `as const satisfies Record<...>` pin enforces this).
- **N-6**: When the `error: "invalid_state_transition"` envelope is parsed, then both arms (state-machine miss + concurrency) MUST be distinguishable by which optional fields are present (`from`/`attempted` vs `reason`).
- **N-7**: When `validateHttpUrl` is called with a non-http(s) scheme, then it MUST throw `InvalidUrlError` with the message "URL must be http:// or https://" (XSS boundary).
- **N-8**: When `floorToFiveMinutes` is called with a non-finite `Date`, then it MUST throw `TypeError` (no silent propagation; the cron relies on this to skip corrupt rows).
- **N-9**: When `AdminNotificationPayloadSchema` is used as the wire schema for the admin list, then `payload.acknowledgedByUserId` MUST surface in the UI (the admin audit-lens exists specifically to expose this field).
- **N-10**: When `RulePatchRequestSchema` receives an empty body, it MUST reject via `.refine(...)` (the discriminated union enforces "exactly one of `supersede: true` or `activate: false`").

## Verification

```bash
cd packages/shared && npx tsc -b
cd packages/shared && npx eslint src/
cd packages/shared && npx vitest run
```

Existing specs (must stay green):

- `notification.spec.ts`
- `rbac.spec.ts`
- `reading-aggregate.spec.ts`
- `retention.spec.ts`
- `shared.spec.ts`
- `simulator.spec.ts`

The contract surfaces verified here are load-bearing for downstream consumers:

- `RBAC_MATRIX` → `pnpm lint:rbac` (api) + every authorize() call.
- `TelemetryFrameSchema` → `ingest/frame.ts` (api) + simulator scenarios.
- `InvalidStateTransitionEnvelopeSchema` → `transitionHelpers.ts` (api) + 4 web mutation hooks.
- `NotificationPayloadSchema` / `AdminNotificationPayloadSchema` → `notificationRouter.ts` (api) + `useNotificationBell.ts` / `useAdminNotificationList.ts` (web).
- `AuditLogEntrySchema` → `audit.ts` (api) + `/audit` admin page.
- `AttachmentPayloadSchema` → `attachmentRouter.ts` (api) + `useAttachments.ts` (web).
- `AdminNotificationFilters` → `useAdminNotificationList.ts` 30s polling loop.
