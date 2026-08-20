# Surakkha — Architecture

**Document type:** Architecture (the invariants + contracts + deployment shape)
**Source:** Extracted from the original `Surakkha-water-monitoring-system-spec.md`; refactored for clarity.
**Companion to:** `Surakkha-BRD.md` (business intent), `Surakkha-PRD.md` (product requirements), `Surakkha-idea-refined.md` (decision log), `Surakkha-water-monioring-system-idea.md` (original brainstorm, historical).
**Audience:** Engineering team building v1.0; future contributors; bmad-create-epics-and-stories.
**Status:** v1.0 (post-validation pass)
**Date:** 2026-08-20

---

## 1. What this document is

This document captures the **architectural invariants** of Surakkha — the decisions a future builder *cannot* read off compliant code, and the seams designed so v2 can extend without re-architecting.

Non-invariants (mission, personas, business objectives, acceptance criteria, v2 backlog) live in the BRD. Product details (feature deep-dives, slicing plan, success metrics) live in the PRD. This document only covers: system shape, wire contract, rules engine contract, data model, simulator contract, deployment shape, and a concise invariants list.

A load-bearing decision made in this document is one where two engineers, building independently, could plausibly choose incompatibly. Those are the decisions fixed here. Other decisions are seed — true at cold-start, owned by code once it exists.

---

## 2. System shape

```
React (Vite + TS, Tailwind + shadcn/ui)
   │
   ├── REST (Express + Zod-validated)
   └── WebSocket (Socket.IO)  ← live readings + alerts
        │
        ▼
Node.js (Express, single process for v1)
   │
   ├── Ingestion service (WS, validates frames)
   ├── Rules engine (in-memory, de-bouncing)
   ├── Alert manager
   ├── Workflow engine (incident state machine)
   └── Background jobs (node-cron: aggregation, retention)
        │
        ▼
PostgreSQL 15 (Docker, single instance for v1)

   ┌────────────────────────────────────────┐
   │  packages/simulator  (separate Node    │
   │  process, same wire contract)          │
   └────────────────────────────────────────┘
```

**Why a single Node process for the api:** the simulator plus rules engine plus ingestion fits comfortably in one process for 10–100 devices. The wire contract (§3) is the seam for splitting later — not a reason to over-engineer now.

**Why Socket.IO over raw WS:** automatic reconnection, rooms per device (broadcast one device's readings to all watching dashboards), built-in heartbeat. Trivial to drop later if needed.

**Why a separate simulator process:** simulator authenticates and connects via the same wire contract as a real device (§3.3). No back-door path. The day real hardware lands, only the transport changes.

**No microservices. No Kubernetes. No Redis. No message queue.** Everything in §3–§6 is designed so that horizontal scaling later only adds a pub/sub layer; it does not require it now.

---

## 3. Wire contract (the seam)

This is the single most important architectural decision. Everything below derives from it.

### 3.1 Device identity

- Every device has a stable `device_id` (UUIDv4, generated at factory provisioning). Not the MAC, not the SIM — those change.
- `device_id` is referenced in every reading, event, and command. UI displays a human label (e.g. `DHAKA-SCHOOL-023`); internals use `device_id`.

### 3.2 Telemetry frame

```json
{
  "device_id": "9b1c…",
  "ts": "2026-08-20T10:31:04.123Z",
  "fw": "1.0.3",
  "seq": 8421,
  "version": 1,
  "metrics": {
    "ph": 7.2,
    "tds_ppm": 180,
    "turbidity_ntu": 0.4,
    "temp_c": 27.4,
    "chlorine_ppm": 0.6,
    "water_level_cm": 85
  }
}
```

**Field contracts:**

| Field | Type | Required | Rule |
|-------|------|----------|------|
| `device_id` | UUIDv4 string | yes | Must match the device-id segment of the WebSocket path; mismatch → `403` |
| `ts` | RFC3339 / ISO-8601 UTC string | yes | Server records `server_received_at` separately; `clock_skew_detected` flag set if `|server_received_at - ts| > 60s` |
| `fw` | semver string | yes | Free-form; surfaced in admin ops view; not validated by server in v1 |
| `seq` | non-negative integer | yes | Monotonically increasing per-device counter. Gaps ≤ 5 tolerated silently; gaps > 5 set `out_of_order` flag and are logged but accepted. Frames with `seq` ≤ last-seen `seq` are dropped silently (no error, no alert) |
| `version` | integer | yes | v1.0 is locked at `1`. Unknown versions rejected with `400 invalid_version` |
| `metrics` | object | yes | All six v1 metrics required. Missing metric → reject `400 missing_metric:<key>`. Unknown metric keys are ignored (forward-compat) |

**Metric type contract** (enforced by Zod in `packages/shared/src/telemetry.ts`):

| Key | Type | Unit | Range (typical) | Allowed null |
|-----|------|------|-----------------|--------------|
| `ph` | number | pH | 0–14 | no |
| `tds_ppm` | number | ppm | 0–5000 | no |
| `turbidity_ntu` | number | NTU | 0–3000 | no |
| `temp_c` | number | °C | -10 to 80 | no |
| `chlorine_ppm` | number | ppm | 0–10 | no |
| `water_level_cm` | number | cm | 0–500 | no |

Frames with any metric outside the allowed range are rejected with `400 metric_out_of_range:<key>`. NaN / Infinity rejected with `400 invalid_number`.

**Server processing order** (deterministic, single-threaded per device):

1. Auth check (JWT) → `401 unauthenticated` on fail.
2. JSON parse → `400 invalid_json` on fail.
3. Zod schema validation → `400` with `{error, missing_or_invalid}` body on fail.
4. Path / `device_id` match → `403 device_id_mismatch` on fail.
5. Rate cap (`1 reading / 2s` per device) → `429 rate_limited` with `Retry-After` header on reject; `rate_limited` flag set on `Reading` row.
6. Sequence check (drop if `seq ≤ last_seq`).
7. Persist `Reading` row with `server_received_at = now()`.
8. Evaluate rules (see §4).
9. Broadcast via Socket.IO room `device:<device_id>` (see §3.5).

The `metrics` shape is the **v1.0 seed** of the two-layer metric schema (BRD §10.1). v2 may add new metric keys by inserting into the `MetricDefinition` registry without changing the frame shape.

### 3.3 Transport

- Devices connect to the platform over **WebSocket** at `ws://<host>/ingest/{device_id}`.
- Auth: short-lived JWT minted per-device, rotated on simulator start (every process boot).
- Simulator reconnects with exponential backoff (1s → 30s) on disconnect; readings are buffered in simulator process (max 5,000) and flushed on reconnect.
- Server enforces a per-device rate cap (1 reading / 2s) and rejects bursts with `429`.
- **This contract will not change when real hardware lands** — only the transport underneath changes (MQTT, LoRaWAN).

### 3.4 Device authentication

- JWT claims (required, exact field names):
  - `sub`: device UUIDv4.
  - `aud`: `device` (real hardware) or `simulator` (privileged simulator).
  - `iss`: `surakkha-api`.
  - `iat`, `exp`: standard, with `exp - iat = 1h` for `aud=simulator`, `24h` for `aud=device`.
  - `scope`: space-separated string. For `aud=simulator`, locked to `telemetry:write`. For `aud=device`, locked to `telemetry:write` in v1.
- Server verifies with HS256 against `JWT_SECRET` from `.env`.
- Token expiry is checked with a 30s clock-skew tolerance.
- On expiry during an open connection, the server sends a `401 token_expired` Socket.IO event and closes the connection. The simulator / device must reconnect with a freshly minted token.
- Token refresh: in v1 the simulator mints its own token at process boot. Production token minting by an admin endpoint is v2.

### 3.5 WebSocket event contract (api → web)

Both events are emitted to the Socket.IO room `device:<device_id>` for live updates, and to the broadcast room `alerts:open` for new alerts / incidents.

**`reading:new`** (every accepted telemetry frame):

```json
{
  "device_id": "9b1c…",
  "ts": "2026-08-20T10:31:04.123Z",
  "server_received_at": "2026-08-20T10:31:04.456Z",
  "metrics": { "ph": 7.2, "...": "..." },
  "flags": []
}
```

**`alert:opened`** (when a rule fires and passes de-bouncing):

```json
{
  "alert_id": "uuid",
  "device_id": "9b1c…",
  "rule_id": "r-tds-std",
  "severity": "warning",
  "opened_at": "2026-08-20T10:31:04.789Z",
  "metric": "tds_ppm",
  "value": 312.4
}
```

**`incident:updated`** (any state-machine transition):

```json
{
  "incident_id": "uuid",
  "state": "ACKNOWLEDGED",
  "previous_state": "OPEN",
  "actor_user_id": "uuid",
  "ts": "2026-08-20T10:31:10.000Z"
}
```

**Client behavior on reconnect:**

- The client opens a new REST query for the latest state (`GET /api/devices/:id/latest-reading`, `GET /api/alerts?state=open`, `GET /api/incidents?state=open`) before resuming socket subscription.
- The client discards any cached `seq` it was tracking; the server's per-device `seq` is authoritative.
- WebSocket reconnects use exponential backoff `1s → 2s → 4s → … → 30s` and reset on successful connection.

### 3.6 What's intentionally NOT in the contract for v1

- No bi-directional commands (no downstream calibration, threshold push). Read-only telemetry for v1.
- No cryptographic signing per frame. Per-device JWT auth is enough for v1; signing deferred to v2.
- No on-device aggregation / down-sampling. Raw frames stream.

---

## 4. Rules engine contract

### 4.1 Rule shape

```json
{
  "rule_id": "r-tds-std",
  "metric": "tds_ppm",
  "window": "instant",
  "operator": ">=",
  "value": 300,
  "severity": "warning",
  "hysteresis_seconds": 60,
  "min_duration_seconds": 30
}
```

Rules are JSON, stored per `device_id` (or globally when `device_id` IS NULL), versioned, audit-logged on change.

### 4.2 v1 rule types

| Type | Operator set | Example |
|------|--------------|---------|
| `instant` | `>=`, `>`, `<=`, `<`, `==` | TDS >= 300 |
| `rate` | `delta_per_minute` | turbidity +0.5/min |
| `absence` | `no_reading_for_seconds` | silent 300s |

No multi-metric correlation, no ML, no seasonal baselines in v1.

### 4.3 Severity assignment

Severity is **explicitly set by the rule**, not inferred. The canonical v1.0 default threshold set is in BRD §8.3.1 (with source attribution to WHO and BSTI). Other defaults are `warning`.

### 4.4 De-bouncing

- `min_duration_seconds`: reading must be in violation for this long before alert fires. Prevents flapping on noise.
- `hysteresis_seconds`: once cleared, must stay clear this long before re-firing.
- Per-(device, metric, severity) state. Track `since`, `cleared_at`.

### 4.5 Rule evaluation semantics

**State machine per (device, rule):**

- `OK` — no current violation.
- `VIOLATING` — rule was tripped at `since`; if `since + min_duration_seconds` elapses while still tripping, the rule fires and transitions to `ALERTED`.
- `ALERTED` — an `Alert` row exists and the `incident:opened` event has been emitted. Stays `ALERTED` until the rule reads `OK` for `hysteresis_seconds`, then clears and emits `alert:cleared`.
- `CLEARED` — the alert is closed; `Alert.cleared_at` is set. The rule returns to `OK`.

**Multi-rule precedence and dedup:**

- For each `(device, metric, severity)` tuple, **at most one open `Alert`**. If a second rule on the same tuple would fire, it is **suppressed** and recorded in the audit log as `alert_suppressed:duplicate_rule`.
- Severity tie-break: if `instant` and `rate` rules both fire on the same reading, the higher severity wins; the lower-severity rule is suppressed.
- Deduplication window: a new `Incident` row is created only on the first `ALERTED` transition per `(device, metric, severity)` within 60s. Subsequent `ALERTED` transitions in that window attach to the existing incident.

**`rate` rule window model:**

- `delta_per_minute` is computed as a **linear regression slope** over the last 5 readings (sliding window), in the unit specified by the metric (e.g. NTU/min for turbidity). The threshold compares `slope >= value`.
- Minimum 5 readings required before the rule can fire; until then the rule is in `OK` regardless of slope.

**`absence` rule semantics:**

- Startup grace period: each device's absence timer begins when the device's first successful authentication completes. The grace period is `no_reading_for_seconds * 2` (default 600s for a 300s rule).
- After a connection drop and reconnection, the absence timer **resets** — the device is considered "recently seen" on reconnect.
- An `Offline` audit event is emitted on absence-rule fire. No automatic incident is created from an absence rule in v1; absence alerts are visible in the admin device-status panel only.

### 4.6 Out of scope for v1

- Rule DSL UI (config is JSON in DB; edit by Admin through a simple form, not a visual builder).
- Rule testing / dry-run.
- Rule impact preview before save.

---

## 5. Data model

PostgreSQL via Prisma. The schema below is the v1.0 entity set; final column types derive at build-time.

```
User (id, name, email, role, password_hash, created_at)
School (id, name, upazila, district, lat, lng, contact_user_id)
Device (id, school_id, device_id_uuid, label, fw_version, status, last_seen_at)
Reading (id, device_id, ts, server_received_at, metrics jsonb, seq, flags)
Rule (id, device_id [nullable = global], metric, operator, value, severity,
     hysteresis_seconds, min_duration_seconds, version, active)
Alert (id, device_id, rule_id, severity, opened_at, acknowledged_at, cleared_at)
Incident (id, alert_id, school_id, state, opened_at, resolved_at, severity)
IncidentEvent (id, incident_id, actor_user_id, type, payload jsonb, ts)
IncidentAssignment (incident_id, technician_user_id, assigned_at, assigned_by)
Comment (id, incident_id, actor_user_id, body, ts)
Attachment (id, incident_id, url, mime, uploaded_by, ts)
ThresholdChange (id, rule_id, old_value, new_value, reason, actor_user_id, ts)
MetricDefinition (key, label, unit, type, default_severity, default_rule_template)
Notification (id, channel, recipient_user_id, payload, simulated_at)
```

**Indexes (v1.0 minimum):**

- `Reading(device_id, ts DESC)` — primary query path for charts.
- `Reading(device_id, seq DESC)` — for replay / dedup.
- `Alert(device_id, opened_at DESC)`.
- `Incident(state, opened_at DESC)`.
- `MetricDefinition(key UNIQUE)`.
- `User(email UNIQUE)`.

**Schools, users, and the contact-role:**

- A `School` has zero or one `contact_user_id` (FK to `User`). The contact user receives notifications for that school and is the headmaster persona in v1.
- A `User` may be the contact for multiple schools only if explicitly granted by an Admin (rare; default Admin UI treats contact as 1:1).
- Devices are bound to a single `School` for their lifetime (`Device.school_id` is set on provisioning and is not changed in v1).

**Retention and aggregates:**

- Raw `Reading` rows older than 30 days are aggregated into `ReadingAggregate`:
  ```
  ReadingAggregate (device_id, bucket_start, metric, mean, min, max, count)
  ```
  Primary key: `(device_id, bucket_start, metric)`. Index: `(device_id, bucket_start DESC)`.
- Buckets are exactly 5 minutes wide, aligned to the wall clock (`floor(ts / 300s) * 300s`).
- The hourly cron `aggregate_old_readings` selects up to 10,000 rows per run, computes aggregates by SQL `GROUP BY`, inserts into `ReadingAggregate`, and deletes the raw rows. Idempotent on retry (PK collision causes insert to be skipped).
- Frontend charts query `Reading` for the last 30 days, `ReadingAggregate` for 30–365 days, and return empty for older.

**Notification semantics:**

- `Notification` rows in v1 are **UI-visible artifacts** of "we would have sent a notification if the channel were real." Every `alert:opened`, `incident:state_changed`, and `incident:resolved` event writes a `Notification` row with `channel = "ui"` and `simulated_at = now()`. The frontend reads these to render the bell-icon dropdown.
- `channel` is a string enum: `ui`, `email`, `sms`, `whatsapp`. Only `ui` is implemented in v1; other channels are stored as `payload` JSON but no delivery is attempted.
- No notification is sent to external systems in v1.

**`flags` on Reading** is a small enum column covering `out_of_order`, `clock_skew_detected`, `rate_limited` — surfaced to ops views.

### 5.1 Incident state machine

```
            (rule fire)
              │
              ▼
   ┌───► OPEN ───ack(Operator)───► ACKNOWLEDGED
   │                                │
   │                                ├──assign(Operator)──► INSPECTING
   │                                │                       │
   │                                │                       ├──submit_result(Operator)──► SAFE ──┐
   │                                │                       ├──submit_result(Operator)──► UNSAFE ───┐
   │                                │                       └──submit_result(Operator)──► MONITORING │ review(Operator)──┐
   │                                │                                                                                  │
   │                                │                                                                                  ▼
   │                                │                                                          RESOLVED ◄──resolve(Operator)──┘
   │                                │                                                                                              ▲
   │                                └──────────────────────────────────────────────────────────────────────────────────────────────┘
   │                                                                                                                              │
   └───(auto-reopen: comment with `severity=critical` from Admin)────────────────────────────────────────────────────────────────────┘
```

**Transition table (`actor` column is the required role):**

| From | To | Trigger | Actor | Audit event |
|------|----|---------|-------|-------------|
| (none) | OPEN | rule fires after de-bounce | system | `incident_opened` |
| OPEN | ACKNOWLEDGED | Operator acknowledges | Operator | `incident_acknowledged` |
| ACKNOWLEDGED | INSPECTING | Operator assigns Technician | Operator | `incident_assigned` |
| INSPECTING | SAFE | Operator submits result | Operator | `incident_result_submitted` |
| INSPECTING | UNSAFE | Operator submits result | Operator | `incident_result_submitted` (auto-emits `notification:critical` to all Admins) |
| INSPECTING | MONITORING | Operator submits result | Operator | `incident_result_submitted` |
| SAFE/UNSAFE/MONITORING | RESOLVED | Operator resolves | Operator | `incident_resolved` |
| RESOLVED | OPEN | Admin adds a comment with `severity=critical` | Admin | `incident_reopened` |

**Allowed actors per state:**

- Only `Operator` and `Admin` may transition states. `Technician` provides inspection results via the `add_comment` workflow (Operator consumes them).
- `Viewer` is read-only across all states.
- An attempt to transition out of an unexpected state returns `409 invalid_state_transition` and writes a `__invalid_transition_attempt` audit entry (defensive logging).

### 5.1.1 Kanban column projection (derived view)

The 7-state incident machine above is the source of truth. The Kanban UI on `/incidents` projects incidents into four severity-mixed triage columns. The projection is a *derived view*, not a parallel state machine — state transitions do not move cards between columns directly; a backend state change recomputes the column placement.

| Kanban column | Projected states |
|---|---|
| `Open · Critical` | `OPEN` with severity = `critical` |
| `Open · Warning` | `OPEN` with severity = `warning` |
| `Acknowledged` | `ACKNOWLEDGED`, `INSPECTING` |
| `Resolved` | `SAFE`, `UNSAFE`, `MONITORING`, `RESOLVED` |

Rules:

- The state machine is authoritative; transitions go through the actors and triggers in §5.1.
- The column projection is recomputed on every `incident.state_changed` socket event.
- An incident's underlying state is always discoverable from the card body (timeline, action set, header pill).
- Filter / sort on the Kanban operates on the underlying state, not the column.

This separation is what lets the Operator prioritise "what needs my attention" while the audit trail and the state machine remain unambiguous.

### 5.2 Attachments

- `Attachment` rows reference an external URL (not a binary blob) in v1. The Operator / Technician pastes a link to a photo host.
- `mime` is `image/jpeg`, `image/png`, or `application/pdf`. Size is not enforced server-side in v1 (the URL is opaque).
- Upload access requires role `Operator`, `Technician`, or `Admin`. `Viewer` may not upload.

---

## 6. Simulator contract

A separate Node process. Same wire contract as §3.3 — it authenticates, connects, streams frames, disconnects, reconnects. The simulator is a **real client**, not a back-door. Replacing it with real hardware changes nothing else.

### 6.1 Behaviour

- 6 default devices, one per school, each running one of 7 base scenarios: `Normal | RisingTDS | TurbiditySpike | ChlorineDrop | Offline | BatteryLow | RandomFailure`.
- Configurable per device: `scenario`, `tick_interval_ms`, `noise_sigma`.
- Internal state machine per device: each scenario walks the metrics through a realistic curve.
- Auto-reconnect with backoff, buffer up to 5,000 readings, flush on reconnect (matches §3.3).

### 6.2 Admin control

- A "Simulator" tab at `/admin/simulator`: pick device, pick scenario, set duration, click Start.
- Every scenario start/stop emits a `__simulator_event` audit entry.
- No production-code path is shared — the simulator only knows the wire contract.

### 6.3 Sim-only secret

Simulator JWTs are issued with `aud=simulator` and have read-only-equivalent scope. They cannot execute admin actions on the platform even if the simulator were compromised.

---

## 7. Deployment shape

**One Docker Compose file, four services:**

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `db` | `postgres:15` | 5432 | Single instance, volume-mounted data |
| `api` | Node 20 | 3000 | Express + WS ingestion + rules engine + workflow + cron |
| `web` | Nginx (serving Vite build) | 5173 | React SPA |
| `simulator` | Node 20 | (no external port) | Separate process, connects to `api` over WS |

**Environment:** `.env.example` ships with all required keys (`JWT_SECRET`, `DATABASE_URL`, `PORT`, simulator keys). README has a 5-minute quickstart.

**Startup order (Docker Compose `depends_on`):**

1. `db` becomes healthy (`pg_isready -U <POSTGRES_USER> -d <POSTGRES_DB>`).
2. `api` runs `prisma migrate deploy` against `DATABASE_URL`, then `prisma db seed` on a fresh volume, then starts the HTTP server. The API is not healthy until migrations and seed complete.
3. `simulator` waits for the API health endpoint, then starts its six devices.
4. `web` waits for the API health endpoint, then serves the Vite build.

**Health endpoints:**

- `GET /health/live` → process liveness; no DB check. Returns `200` while the Node process is running.
- `GET /health/ready` → DB connectivity + migrations applied. Returns `200 {"status":"ok"}` or `503 {"status":"not_ready"}` with the reason.
- The API Docker healthcheck calls `/health/live` every 10s. The Compose `depends_on: condition: service_healthy` gate uses `/health/ready`.

**Graceful shutdown:**

- On `SIGTERM` or `SIGINT`, the API stops accepting new WebSocket connections, finishes or cancels in-flight handlers within 10s, flushes pending cron work, closes Socket.IO, closes the Prisma pool, and exits with code 0. The simulator stops scenario generation and drains its 5,000-reading buffer before exiting.
- The v1 Docker Compose file does NOT run automatic database backups. Data is persisted in the local volume; backups are v2.

**Production deployment** (TLS, monitoring, backups, JWKS/RS256, key rotation, hosted URL) is **explicitly v2** (BRD Appendix B). v1.0 runs on a laptop.

---

## 8. Architectural invariants

These decisions are **load-bearing** — they bind the contract between api, simulator, and frontend, and a future builder cannot read them off compliant code. They are the only changes in this document that require a version bump.

### 8.1 Durable invariants (any change is a wire-contract-breaking change)

| # | Invariant | Binds | Prevents |
|---|-----------|-------|----------|
| I-1 | Wire contract `version` is `1`, with the field contract in §3.2, metric type contract in §3.2, and processing order in §3.2 | api, simulator, frontend decoder | Drift between framing (simulator) and parsing (api) |
| I-2 | Per-device server-side rate cap is `1 reading / 2s`; over-cap frames are rejected with `429 rate_limited` and `Retry-After` header. **The simulator MUST buffer and respect `Retry-After`, not silently drop.** | api, simulator | Server overload, alert spam, silent simulator drop |
| I-3 | Per-device JWT required; `aud` is either `device` (24h expiry) or `simulator` (1h expiry); `iss` is `surakkha-api`; HS256 with `JWT_SECRET`. Reconnect on `401 token_expired`. | api auth, simulator auth | Cross-device spoofing, simulator compromise leading to admin actions |
| I-4 | Simulator JWTs carry `aud=simulator` with scope locked to `telemetry:write`. They cannot execute any other API surface — including admin endpoints — even with a leaked token. | api auth, simulator auth | Privilege escalation via leaked simulator token |
| I-5 | Rules engine supports only `instant`, `rate`, `absence` rule types. New rule types require a wire-contract bump. | api | Rules-engine complexity explosion; v2 expansion must be deliberate |
| I-6 | Severity is set by the rule, not inferred by the engine. | rules engine | Auto-severity mistakes; false `critical` alerts |
| I-7 | `device_id` is UUIDv4, generated at provisioning, never derived from MAC/SIM. | platform | Identity drift across SIM swaps |
| I-8 | Default severity defaults and threshold values come from BRD §8.3.1 (WHO/BSTI source-of-truth); the database seed script `prisma/seed.ts` is the executable form of these defaults. **Server does not compute defaults at runtime** — it reads from the seeded `Rule` rows. | database seed, audit | Inconsistent thresholds across schools, undocumented defaults |
| I-11 | Wire contract is **read-only telemetry** in v1: the api NEVER sends a frame to a device. Calibration, threshold-push, and firmware-update flows are v2. | wire contract | Premature command surface; downstream commits |
| I-12 | Simulator uses the same `ws://<host>/ingest/{device_id}` path as real devices, with no back-door endpoints. | simulator, api | Hidden data-entry paths that bypass validation, rate cap, auth |

### 8.2 v1 operational constraints (NOT durable — may change in v2 without a contract bump)

These are deliberate v1 simplifications. They are listed here so the AI coding agent does not mistake them for durable decisions.

| # | Constraint | Why v1-only |
|---|-----------|-------------|
| I-9 | One Node process for api + ingestion + rules + alerts + workflow + cron (simulator separate) | Premature microservices; horizontal-scaling theatre. v2 may split into api + worker. |
| I-10 | Postgres is the only persistence layer (no Redis, no message queue, no time-series DB) | Operational complexity. v2 may add pub/sub for multi-process scaling. |
| I-13 | HS256 JWT (single secret) | Sufficient for single-tenant v1. v2 will move to RS256 + JWKS for key rotation. |
| I-14 | WebSocket transport over plain `ws://` (no mTLS) | Local demo only. Production deployment (BRD Appendix B) requires `wss://`. |
| I-15 | Cron-driven retention (hourly, max 10,000 rows per run) | Adequate for the demo dataset. v2 may switch to a continuous aggregation worker. |

### 8.3 RBAC enforcement contract

Every API endpoint MUST enforce `(subject, action, resource)` authorization. There is no implicit "Admin can do everything."

**Enforcement location:** `packages/api/src/middleware/authorize.ts`. The middleware runs **after** authentication (`req.user` is populated) and **before** the handler. It reads `(subject.role, action, resource.type, resource.owner_id)` and either calls `next()` or returns `403 forbidden`.

**Resource ownership model:**

- `School.contact_user_id`: a user may operate on a school's resources iff `req.user.role ∈ {Admin, Operator}` OR `req.user.id === school.contact_user_id`.
- `Incident.actor_user_id` is the assignment target — Technicians are assigned per-incident via `IncidentAssignment`. They may comment / add attachments only on assigned incidents.
- `Rule.device_id`: a device-scoped rule is owned by its school; a global rule (`device_id IS NULL`) is owned by the platform.
- `ThresholdChange` is Admin-only; Operators have read access via the audit log.

**Failed authorization response:** `403 forbidden` with body `{ "error": "forbidden", "required_role": "<role>" }`. Every failed attempt writes an audit entry with `actor_user_id`, `attempted_action`, `resource`, and `ip`.

**Auth matrix (full):** see `docs/architecture-appendix-rbac.md` (locked v1.0 matrix — to be generated by `bmad-create-epics-and-stories` if not already present).

### 8.4 Bump procedure

If a v2 change touches any of I-1 through I-12, it is a breaking change and requires:
- a wire-contract version bump (`version: 2` in the frame);
- a shared-types update in `packages/shared/src/telemetry.ts`;
- both sides of the boundary updated in lockstep;
- a CI-red release gate.

Changes to §8.2 (v1 operational constraints) are NOT contract-breaking and may be relaxed in v2 without a version bump.

---

## 9. How this document relates to the others

| Question | Document |
|----------|----------|
| Why are we building this? | BRD §1–2, refined idea §2 |
| Who is it for and what do they do? | BRD §3 (objectives), §6 (personas), §7 (stories) |
| When is v1.0 done? | BRD §11 (17 acceptance criteria) |
| What features ship, in what order? | PRD §4 (MoSCoW), §5 (P0 deep-dives), §6 (slicing) |
| What are the technical invariants? | **This document** |
| What is the wire contract / data model / simulator / deployment shape? | **This document** |
| Where did the v1.0 decisions come from? | Refined idea §13 (resolution table) |
| What is deferred to v2? | BRD Appendix B |
| What was the original brainstorm? | `Surakkha-water-monioring-system-idea.md` (historical) |

A new contributor should read the BRD first for context, this document second for the technical shape, then the PRD for the build plan. They do not need to read the original spec file — it no longer exists; its content has been refactored into this document and the BRD/PRD/refined idea.
