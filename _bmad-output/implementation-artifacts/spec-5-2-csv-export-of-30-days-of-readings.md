---
title: "Story 5.2 — CSV Export of 30 Days of Readings"
type: "feature"
created: "2026-09-01"
status: "done"
review_loop_iteration: 1
baseline_commit: "25578754e479cc88317895deb73fdd230f2f4ac3"
context: []
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot.
     Cohesive cross-layer story (BE+UI) stays in ONE file. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Operators and Admins need a portable artifact of a device's recent telemetry for incident reports, school handover, and regulator audits. Today the only data path is the live Dashboard UI; there is no way to extract a sensor's readings for offline review.

**Approach:** Add a streaming `GET /api/devices/{deviceId}/readings.csv` endpoint + an "Export CSV (30d)" affordance on the Incident detail page. The endpoint streams CSV row-by-row from the DB (never buffers the full result in memory), writes one `csv_exported` audit row on success, and caps the response at 100,000 rows. Non-admin / non-operator calls return 403. RBAC matrix entry `export Reading` already grants Operator + Admin (`packages/shared/src/rbac.ts:170, 240`); audit enum value `csv_exported` already exists (`packages/shared/src/rbac.ts:527`) — **no matrix or enum change needed.**

## Boundaries & Constraints

**Always:**

- Operator + Admin only. Technician / Viewer calls return 403 with `forbidden` body.
- Streamed (`Transfer-Encoding: chunked`); never buffer the full result in memory.
- Capped at 100,000 rows per request; rows beyond the cap return `truncated: true` in the CSV trailer.
- Audit row written AFTER the stream completes successfully: `{ auditAction: "csv_exported", outcome: "success", subject: userId, resource: deviceId, payload: { rowCount, since, until, truncated } }`.
- CSV is one row per `(reading, metric)` — 6 known metric keys × ~17,280 readings/day ≈ ~104k rows/30d for a busy device, so the 100k cap is genuinely reachable.
- Wire headers: `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="device-{deviceId}-readings-{since}.csv"`.
- Window defaults to last 30 days when `?since` is omitted; `?since` and `?until` accept ISO-8601.

**Ask First:**

- _Resolved during step-01:_ RBAC matrix entry + audit enum value already exist — no Ask-First needed.
- _Resolved during step-02:_ raw `Reading` table is the source of truth for the 30d window. Story 5.4's `ReadingAggregate` 5-min buckets will replace this for older windows once shipped, but for v1 raw rows are correct.

**Never:**

- No new socket event (mirrors 5.1 / 4.10 polling convention — a one-shot download does not need it).
- No retroactive migration.
- No write surface (this is a pure read).
- No buffering the full result set in memory — must stream row-by-row.
- No new RBAC matrix entry — `export Reading` already covers Operator + Admin.

## I/O & Edge-Case Matrix

| Scenario            | Input / State                                                      | Expected Output / Behavior                                                 | Error Handling |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------- |
| HAPPY_PATH_OPERATOR | Operator requests `/api/devices/{id}/readings.csv`; 50 rows in 30d | 200 + streamed CSV: header + 50 data rows + `truncated:false` trailer      | n/a            |
| HAPPY_PATH_ADMIN    | Admin requests same path                                           | 200 + same shape (matrix grants both)                                      | n/a            |
| HAPPY_PATH_EMPTY    | Device has 0 readings in 30d                                       | 200 + CSV header + `truncated:false` trailer only                          | n/a            |
| TRUNCATED           | Device has 250,000 rows in 30d                                     | 200 + first 100,000 rows + `truncated:true` trailer                        | n/a            |
| RBAC_DENIED_TECH    | Technician calls endpoint                                          | 403 + `forbidden` body + `rbac_denied` audit emit (handled by `authorize`) | n/a            |
| RBAC_DENIED_VIEWER  | Viewer calls endpoint                                              | 403 + `forbidden` body                                                     | n/a            |
| UNAUTH              | No bearer token                                                    | 401 upstream (handled by `authenticate`)                                   | n/a            |
| UNKNOWN_DEVICE      | `deviceId` does not exist                                          | 404 + `not_found` body                                                     | n/a            |
| INVALID_DATE        | `?since` parses to invalid ISO-8601                                | 400 + `validation_error` body                                              | n/a            |
| INVALID_WINDOW      | `?since` after `?until`                                            | 400 + `validation_error` body                                              | n/a            |
| DB_THROW_MID_STREAM | Prisma throws during row iteration                                 | Connection closed mid-stream; no audit row written                         | console.error  |
| CSV_QUOTE_ESCAPE    | Metric value contains `"` or `,` or `\n`                           | RFC 4180 quoting: `"value with, comma"`                                    | n/a            |

</frozen-after-approval>

## Code Map

- `packages/shared/src/rbac.ts:170` (Admin), `:240` (Operator) — `export Reading: Y` already granted; no matrix change.
- `packages/shared/src/rbac.ts:527` — `"csv_exported"` already in `AuditActionSchema` enum; no schema change.
- `packages/shared/src/telemetry.ts:58-89` — `MetricKeySchema` (6 keys), `TelemetryMetricsSchema`; CSV row layout derives from these.
- `packages/api/src/audit.ts:29` — `outcome` enum already has `"success" | "failure" | "allow"`; CSV uses `outcome: "success"` like `incident_state_changed`.
- `packages/api/src/middleware/authorize.ts:197-242` — `authorize({action:"export", resource:"Reading"}, audit)` factory; emits `rbac_allowed` on allow and `rbac_denied` on deny. The csv handler MUST emit its own `csv_exported` row on stream success.
- `packages/api/src/devices/router.ts:62-87` — pattern to mirror: `router.get("/api/devices", authorize(...), async (_req, res) => {...})`. New `csvRouter.ts` will follow the same shape but stream.
- `packages/api/src/readings/wiring.ts:53-76` — `resolvePrismaClient` lazy-resolver + `(client as any)` boundary pattern for raw `$queryRaw` reads. The new repo function will follow this seam (no schema drift in `PrismaClient` type).
- `packages/api/src/readings/latestRouter.spec.ts:49-68` — test rig pattern to mirror: real `express` + `createServer(127.0.0.1:0)` + `authenticate` middleware + stubbed repo + `audit.emit: () => undefined`. Tokens via `issueAccessToken({ userId, role })`.
- `packages/api/src/index.ts:81` — router mount seam. New `buildCsvRouter` mounts at `/api/devices/:deviceId/readings.csv`.
- `packages/db/prisma/schema.prisma:79-95` — `Reading` model: `id, deviceId, ts, serverReceivedAt, metrics: Json, seq, flags[]`. Indexes: `@@index([deviceId, ts])` for the export query path.
- `packages/web/src/api/apiClient.ts:179-198` — `apiFetch` returns raw `Response`; callers check `res.ok` + consume `res.blob()` for non-JSON.
- `packages/web/src/incidents/IncidentDetailActions.tsx:73-74, 178-200` — `ACTION_BUTTON_BASE` constant + existing button pattern. New "Export CSV" button slots in alongside Acknowledge / Assign / Submit / Reopen.
- `packages/web/src/incidents/IncidentDetailPage.tsx:531-543` — `<IncidentDetailActions>` mount point. New button + loading state added here.
- `packages/web/src/notifications/useNotificationBell.ts:84-111` — RBAC-aware query pattern to mirror for any future non-incident CSV surface (not used in v1 since the affordance is on `IncidentDetailPage`, not a top-level route).

## Tasks & Acceptance

**Execution:**

- [ ] `packages/api/src/readings/csvRepository.ts` -- NEW repo function `streamForCsv(deviceId, since, until, maxRows): AsyncIterable<ReadingRow>` using keyset pagination on `(ts, id)` via `$queryRaw`; stops yielding when `maxRows` reached; yields in `ts ASC` order. Mirrors `wiring.ts:58-76` lazy-resolver seam.
- [ ] `packages/api/src/readings/csvSerialization.ts` -- NEW pure helper `readingRowToCsvRows(row): string[]` that flattens `row.metrics` into one CSV line per metric key (RFC 4180 quoting for values containing `"`, `,`, `\n`); emits a header line + trailer line.
- [ ] `packages/api/src/readings/csvRouter.ts` -- NEW Express router; `router.get("/api/devices/:deviceId/readings.csv", authorize({action:"export", resource:"Reading"}, audit), handler)`; handler validates query params (since/until ISO-8601), sets `Content-Type: text/csv; charset=utf-8` + `Content-Disposition`, streams via `res.write(...)` in a loop, ends on completion OR error (no audit row on error); on success emits `csv_exported` audit row with `{ rowCount, since, until, truncated }`.
- [ ] `packages/api/src/readings/csvRouter.spec.ts` -- NEW spec covering the I/O matrix (happy path operator + admin, empty, truncated at 100k, RBAC denied tech + viewer, 401, unknown device 404, invalid date 400, invalid window 400, DB throw mid-stream, CSV quote escape). Mirrors `latestRouter.spec.ts:49-68` rig.
- [ ] `packages/api/src/index.ts` -- INSERT `app.use(buildCsvRouterMount(...))` AFTER the existing `buildDevicesRouterMount(...)` mount (mirrors 4.13 catch-all-order discipline per RUNBOOK §6a).
- [ ] `packages/web/src/incidents/useDownloadReadingsCsvMutation.ts` -- NEW TanStack mutation hook: `apiFetch(/api/devices/{id}/readings.csv)` → `res.blob()` → `URL.createObjectURL(blob)` → temp `<a download="...">` click → revoke object URL. Mirrors the 4.10 RBAC-error pattern: throw tagged `ReadingsCsvExportRbacDeniedError` on 403.
- [ ] `packages/web/src/incidents/IncidentDetailActions.tsx` -- ADD "Export CSV (30d)" button gated on `canExportCsv` (Operator + Admin); `disabled={isExporting}`; loading text "Exporting…"; on success shows a transient toast "Downloaded readings export".
- [ ] `packages/web/src/incidents/IncidentDetailPage.tsx` -- PASS `onExportCsv` + `isExporting` props to `<IncidentDetailActions>`; wires `useDownloadReadingsCsvMutation` against `incident.deviceId`.
- [ ] `packages/web/src/incidents/IncidentDetailActions.spec.tsx` -- ADD ~5 cases: button visible for Operator, hidden for Technician/Viewer, click triggers download, RBAC denial surfaces toast, loading state disables button.

**Acceptance Criteria:**

- Given an Operator views an OPEN incident, when they click "Export CSV (30d)", then a CSV file downloads with name `device-{deviceId}-readings-{since}.csv`, containing the header row, one CSV line per (reading, metric) for the device's last 30 days, and a `truncated:false` trailer when row count ≤ 100k.
- Given a Technician views any incident, when the page renders, then the "Export CSV (30d)" button is NOT shown (RBAC hidden via `canExportCsv` gate) AND `GET /api/devices/{id}/readings.csv` returns 403.
- Given an Admin requests `/api/devices/{id}/readings.csv` for a device with 0 readings, when the endpoint resolves, then the response is 200 with the header row only and a `truncated:false` trailer.
- Given any role exports 30 days of readings, when the stream completes successfully, then exactly ONE audit row is written with `auditAction: "csv_exported"`, `outcome: "success"`, `subject: userId`, `resource: deviceId`, `payload: { rowCount, since, until, truncated }`.
- Given a Prisma throw mid-stream, when the connection closes with an error, then NO audit row is written and the client sees the truncated download (the `csv_exported` audit is gated on full success).

## Spec Change Log

_Empty until first bad_spec loopback._

## Design Notes

**Why stream row-by-row rather than buffer:** A 30-day window for a busy device can reach ~104k rows (6 metrics × ~17,280 readings/day). Buffering the full result would allocate ~10MB of JSON in the api process. Express's `res.write()` + `Transfer-Encoding: chunked` is the canonical fit.

**Why one row per metric rather than wide format:** The 6 known metrics (per `MetricKeySchema`) plus the schema's `.non-strict()` forward-compat rule (per ADR 0001) mean a wide-format CSV would either (a) leak a fixed 6-column shape that breaks if a future metric is added, or (b) require a schema migration to widen. Long format trades row count for forward compat — and the 100k cap is the existing safety belt for cardinality.

**Why no new matrix entry:** `export Reading` is already granted to Operator + Admin (matrix lines 170, 240). The 5.1 admin-list spec's lesson ("new matrix entry so `pnpm lint:rbac` catches drift") does not apply here — the entry already exists; the work is just to USE it. A grep for `export Reading` in `rbac.ts` is the verification step.

**Why no new audit enum value:** `"csv_exported"` is at `packages/shared/src/rbac.ts:527`. The 5.0 sweep's lesson ("three-state outcome to distinguish state-change success from permit log") does not apply — CSV export is a state-change success like `incident_state_changed`, so `outcome: "success"` is correct.

**Why no socket event:** Mirrors 5.1 / 4.10 — a one-shot download doesn't need real-time push. The audit row is the durability anchor; the polling pattern is for list surfaces.

**Why a top-level `IncidentDetailActions` button rather than a new route:** No `DevicesPage` exists in v1 (per step-02 web investigation). The incident detail page is the only context where an Operator/Admin has a specific deviceId in scope and would want to export readings. A future Story 5.x could add a `/admin/devices` listing if operator demand surfaces.

## Verification

**Commands:**

- `pnpm --filter @surakkha/api test -- csvRouter` -- expected: ~11 new cases pass; existing readings tests unaffected.
- `pnpm --filter @surakkha/web test -- IncidentDetailActions` -- expected: ~5 new cases pass; existing 4.10/4.11/4.12 tests unaffected.
- `pnpm --filter @surakkha/api test` -- expected: 524 + 11 = 535 tests pass.
- `pnpm --filter @surakkha/web test` -- expected: 527 + 5 = 532 tests pass (current total 524/524 — see `package.json:22` `pnpm -r test`).
- `pnpm -r typecheck` -- expected: clean across all 5 packages; no signature drift on `buildDevicesRouterMount` or `IncidentDetailActions` props.
- `pnpm lint:rbac` -- expected: passes; `export Reading` matrix entry is recognized (no new entry needed).
- `pnpm lint` -- expected: passes; no tailwind/hex/prose regressions in the new files.

**Manual checks (if no CLI):**

- Boot api + web; log in as Operator; navigate to an OPEN incident; click "Export CSV (30d)"; verify a CSV file downloads with the expected filename and a non-empty body; verify the audit log contains one `csv_exported` row.
- Log in as Technician; verify the "Export CSV (30d)" button is hidden on any incident detail page.
- Log in as Admin; export a 30-day window with no readings; verify the CSV body is the header + trailer only.
- Force a Prisma error mid-stream (e.g. drop the DB connection after the first chunk); verify NO audit row is written.

## Suggested Review Order

**API endpoint — entry point first**

- The router that owns streaming + audit + RBAC; complexity-10 helper-extraction pattern is the seam.
  [`csvRouter.ts:393`](../../packages/api/src/readings/csvRouter.ts#L393)
- Lazy-resolver seam that keeps `streamForCsv` pure while letting prod inject the real Prisma client.
  [`csvRepository.ts:191`](../../packages/api/src/readings/csvRepository.ts#L191)
- Pure helper: RFC 4180 quoting + cap+1 truncation detection + v2 forward-compat metric iteration.
  [`csvSerialization.ts:119`](../../packages/api/src/readings/csvSerialization.ts#L119)
- Mount seam: CSV router registered AFTER the devices roster (RUNBOOK §6a catch-all discipline).
  [`index.ts:168`](../../packages/api/src/index.ts#L168)

**Web affordance**

- Button visibility derived from the canonical RBAC matrix via `isAllowed`, not hard-coded role strings.
  [`IncidentDetailActions.tsx:184`](../../packages/web/src/incidents/IncidentDetailActions.tsx#L184)
- Page-level wiring: branches on the RBAC vs retryable error class for distinct toast copy.
  [`IncidentDetailPage.tsx:364`](../../packages/web/src/incidents/IncidentDetailPage.tsx#L364)
- Mutation contract: tagged errors, blob→anchor download, filename from `Content-Disposition`.
  [`useDownloadReadingsCsvMutation.ts:124`](../../packages/web/src/incidents/useDownloadReadingsCsvMutation.ts#L124)
- Sibling tagged error class so the file respects `max-classes-per-file: 1`.
  [`ReadingsCsvExportError.ts`](../../packages/web/src/incidents/ReadingsCsvExportError.ts)

**Tests + specs (peripherals)**

- The 16 csv-router test cases — every I/O matrix row pinned by name.
  [`csvRouter.spec.ts`](../../packages/api/src/readings/csvRouter.spec.ts)
- 13 pure-helper cases pinning RFC 4180 quoting + metric coercion.
  [`csvSerialization.spec.ts`](../../packages/api/src/readings/csvSerialization.spec.ts)
- 5 mutation cases — the contract that wasn't verified until the patch round.
  [`useDownloadReadingsCsvMutation.spec.tsx`](../../packages/web/src/incidents/useDownloadReadingsCsvMutation.spec.tsx)
- 5 button visibility + RBAC cases on the actions component.
  [`IncidentDetailActions.spec.tsx`](../../packages/web/src/incidents/IncidentDetailActions.spec.tsx)
