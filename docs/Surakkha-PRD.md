# Surakkha — Product Requirements Document (PRD)

**Document type:** Product Requirements Document
**Source:** Bridges `Surakkha-BRD.md` (business intent) and `architecture.md` (technical invariants and contracts).
**Audience:** Engineering team building v1.0; product owner; portfolio reviewer.
**Status:** Draft v1.0
**Date:** 2026-08-20
**Owner:** Solo / 2-person team
**Release scope:** v1.0 only (the 2–4 week portfolio MVP)

---

## 1. Release Summary

| | |
|---|---|
| **Release** | Surakkha v1.0 — Portfolio MVP |
| **Release date target** | 2–4 weeks from build start |
| **Customer vertical** | Government primary schools in Bangladesh (single vertical) |
| **Region** | Bangladesh (single region) |
| **Devices** | 6 simulated devices, one per school, in a separate Node process |
| **Users in scope** | 4 system roles: Admin, Operator, Technician, Viewer |
| **Workflow in scope** | One: Sensor → Alert → Incident → Resolution |
| **Deployment** | Local Docker Compose on a laptop |
| **Out of scope** | See §10; the v2 backlog lives in BRD Appendix B |

**One-line description:** A real-time water-safety monitoring and incident-management platform that demonstrates a complete Sensor → Resolution workflow on simulated devices, in 2–4 weeks, designed to be portfolio-defensible.

---

## 2. Goals & Non-Goals

### 2.1 Product goals

| # | Goal | Acceptance signal |
|---|------|-------------------|
| G-1 | The demo story in BRD §13 is reproducible by any reviewer in ≤15 minutes from a fresh clone | BRD §11.15 |
| G-2 | The wire contract is a real seam — replacing the simulator with a real device requires only a transport change, no platform change | BRD §11.16 |
| G-3 | The two-layer metric schema is provable — a v2 metric addition requires no data migration | BRD §11.17 |
| G-4 | RBAC is enforced as `(subject, action, resource)` on every endpoint, with negative tests | BRD §11.5; spec §4 |
| G-5 | The dashboard is comprehensible in 60 seconds by a reviewer who has never seen the project | NFR-8 |
| G-6 | Onboarding a new school, sensor, and rule takes ≤5 minutes via the UI | NFR-9; FR-1, US-1 |
| G-7 | End-to-end alert latency (breach → dashboard) is <3 seconds | NFR-1; FR-10 |
| G-8 | The system tolerates a 60-second device disconnect mid-incident without losing state | NFR-4; FR-9 |

### 2.2 Non-goals (explicit)

The following are **out of scope for v1.0** and belong to v2 (BRD Appendix B). They are listed here so engineers do not accidentally build them:

- Real IoT hardware (MQTT, LoRaWAN, ESP32 firmware).
- Mobile application (Android / iOS).
- Bangla (bn) locale content (locale *scaffold* is in scope; content is not).
- Multi-tenant data isolation.
- Cryptographic signing of telemetry frames; hash-chained audit log.
- Time-series database (TimescaleDB / ClickHouse).
- Redis pub/sub, BullMQ background-job queue, microservices.
- Real SMS, email, WhatsApp Business API.
- BSTI/WHO compliance certification; Bangladesh data-protection compliance.
- Sensor calibration management; per-firmware-version data lineage.
- Production deployment (TLS, monitoring, backups, JWKS/RS256, key rotation).

---

## 3. Personas

The four system roles in v1.0. Headmaster and Caretaker are personas but **not v1.0 user accounts** (BRD §5).

| Role | Primary motivation | Key screens | Frequency |
|------|--------------------|-------------|-----------|
| **Admin** | Operate the platform, run demos | `/`, `/admin/users`, `/admin/thresholds`, `/admin/simulator`, `/admin/notifications`, `/audit` | Daily |
| **Operator** | Triage alerts, drive incidents to resolution | `/`, `/alerts`, `/incidents`, `/incidents/:id`, `/sensors` | Reactive (alert-driven) |
| **Technician** | Work assigned incidents in the field | `/incidents` (filtered), `/incidents/:id` | Daily during working hours |
| **Viewer** | Read-only visibility for stakeholders | `/`, `/sensors`, `/incidents`, `/reports` | Periodic (weekly) |

---

## 4. MoSCoW Prioritization

MoSCoW applied to all 36 functional requirements and 15 non-functional requirements from the BRD. The classification is what engineering builds first.

### 4.1 P0 — Must-have (v1.0 ships or fails on these)

These are non-negotiable. If any P0 is missing, v1.0 is not releasable.

| FR/NFR | What | Why P0 |
|--------|------|--------|
| FR-1 | Stable UUIDv4 device_id, persists across SIM/MAC | Wire-contract foundation |
| FR-2 | Telemetry frame schema (six metrics) | Wire-contract foundation |
| FR-3 | Unknown fields ignored; missing required → 400 | Robust ingestion |
| FR-4 | server_received_at separate from device ts | Operational visibility |
| FR-5 | Monotonic per-device seq counter | Drop / reorder detection |
| FR-6 | Per-device JWT at transport layer | Auth without frame signing |
| FR-7 | WebSocket at `/ingest/{device_id}` | Simulator-real-device parity |
| FR-8 | Short-lived per-device JWT, rotated on simulator start | Auth lifecycle |
| FR-9 | Reconnect with exponential backoff, 5K buffer, flush on reconnect | Bangladesh load-shedding reality |
| FR-10 | Per-device rate cap 1/2s; bursts → 429 | Server protection |
| FR-11 | JSON rules per device or global, versioned, audit-logged | Threshold governance |
| FR-12 | Three rule types: instant, rate, absence | Rules engine contract |
| FR-13 | Severity explicit per rule; defaults: turbidity>5 critical, chlorine<0.2 critical | Threshold baseline |
| FR-14 | min_duration_seconds + hysteresis_seconds, tracked per (device, metric, severity) | De-bouncing |
| FR-15 | Threshold breach → Alert with severity, opened_at, acknowledged_at, cleared_at | Alert lifecycle |
| FR-16 | Warning/critical alerts auto-create incident | The workflow |
| FR-17 | Incident state machine OPEN→ACK→INSPECTING→{SAFE, UNSAFE, MONITORING}→RESOLVED with REOPENED | Core workflow |
| FR-18 | UNSAFE → Critical notification banner, 24h or until acknowledged | Safety escalation |
| FR-19 | Every state transition recorded in IncidentEvent | Audit trail |
| FR-20 | RBAC enforced as (subject, action, resource) on every endpoint | Security foundation |
| FR-21 | Negative RBAC cases covered by tests | RBAC regression prevention |
| FR-22 | JWT HS256, 8h expiry | Auth |
| FR-23 | Access + refresh tokens; refresh in httpOnly cookie | Auth UX |
| FR-24 | bcrypt cost 12 | Password storage |
| FR-25 | Single JWT secret, no rotation in v1 | Scope discipline |
| FR-27 | UI-only notifications (toast + banner) | Notification scope discipline |
| FR-30 | All state changes / threshold changes / simulator events in audit log | Auditability |
| FR-33 | Simulator is a separate Node process on the same wire contract | The seam |
| FR-34 | 6 default devices, 7 scenarios including Offline | Demo coverage |
| FR-35 | Simulator JWTs aud=simulator, read-only-equivalent scope | Security boundary |
| FR-36 | /admin/simulator Admin-only, emits __simulator_event audit entries | Operator UX + audit |
| NFR-1 | <3s end-to-end alert latency under 6-device load | Demo headline metric |
| NFR-4 | Tolerate 60s disconnect mid-incident; Offline scenario exercises this | Bangladesh realism |
| NFR-6 | All endpoints enforce RBAC; JWT validated; bcrypt 12 | Security posture |
| NFR-8 | 60-second comprehension SLA from dashboard | Reviewer experience |
| NFR-9 | ≤5-minute school onboarding via UI | Demo onboarding flow |
| NFR-11 | Reproducible locally with `docker compose up` + 5-min README | Reviewer onboarding |
| NFR-12 | Backend 70% / frontend 50% coverage; Playwright happy path | Quality gate |
| NFR-13 | Lint+format enforced; shared Zod schemas consumed by both api and simulator | Wire-contract seam |
| NFR-14 | Wire contract frozen behind version:1 header | Contract review cadence |
| NFR-15 | Single Docker Compose with `web`, `api`, `simulator`, `db` services; Postgres 15 with volume-mounted data | Deployment shape |

**Total P0: 41 items** (31 functional requirements + 10 NFRs). Of these, the **load-bearing subset** for the demo story (BRD §13) is FR-1, FR-2, FR-7, FR-9, FR-10, FR-12, FR-15, FR-16, FR-17, FR-19, FR-30, FR-33, FR-36, NFR-1. Everything else P0 supports this subset.

### 4.2 P1 — Should-have (ship if time allows; demo can survive without)

| FR/NFR | What | Why P1 |
|--------|------|--------|
| FR-26 | No SSO/MFA (documented as v2) | Scope discipline; already implicit |
| FR-28 | /admin/notifications page listing recorded notifications | Operational debugging |
| FR-29 | CSV export of 30 days of readings | Reporting completeness |
| FR-31 | Aggregation cron: 30-day raw retention → 5-min mean/min/max | Realistic data story |
| FR-32 | Hourly cron drives retention/aggregation | Implementation of FR-31 |
| NFR-2 | Dashboard UI responsive (input lag <100ms) under 6-device load | Performance baseline |
| NFR-5 | Simulator buffers 5,000 readings without loss | Buffer rationale |
| NFR-7 | Per-frame signing, JWKS/RS256, hash-chained audit (all v2) | Security roadmap |

**Total P1: 8 items.** FR-29, FR-31, FR-32 are the only ones that add visible product capability beyond the demo story.

### 4.3 P2 — Could-have (only if ahead of schedule)

| FR/NFR | What | Why P2 |
|--------|------|--------|
| FR-3 polish | Friendly error bodies for 400/429 (not just status codes) | UX nicety |
| US-4 polish | User CRUD UI affordances (search, filter, role badges) | UX nicety |
| US-18 polish | Simulator scenario timing controls (start time, repeat count) | Demo flexibility |

### 4.4 W — Won't-have (deferred; tracked in BRD Appendix B)

All items from spec §15 and BRD §4.2 / Appendix B. Not in this PRD.

### 4.5 Decision rule during the build

If a feature is not in P0 and the demo story in BRD §13 cannot ship without it, **promote to P0**. Otherwise, ship what time allows in P1 → P2 order. Never silently add a feature that is not in this PRD — that is a scope cut conversation, not an engineering surprise.

---

## 5. Feature Specifications (P0 deep-dives)

The 14 P0 feature areas, with full user-flow + UI-state + data + failure-mode + success-metric detail. Each feature has a stable identifier `F-N` for traceability.

### F-1. Wire contract & telemetry ingestion

**User:** None (system-to-system). Devices send frames; platform stores them.

**Trigger:** Simulator (or future real device) opens a WebSocket to `ws://<host>/ingest/{device_id}` and authenticates with a per-device JWT.

**UI flow:** None. The downstream effect is visible in the dashboard (F-7) and live readings (F-8).

**Data created:** A `Reading` row per accepted frame: `device_id`, `ts` (device time), `server_received_at`, `fw`, `seq`, `metrics jsonb`.

**Frame validation rules:**

| Condition | Outcome |
|-----------|---------|
| JWT missing / invalid / wrong `aud` | `WS close 4401` (no payload ack) |
| `device_id` in path ≠ `device_id` in JWT | `WS close 4403` |
| Frame fails Zod parse (missing required field) | `400` over a one-shot HTTP error frame, then close |
| Frame has unknown fields | Accepted; unknowns ignored |
| Frame `seq` ≤ last seen for that device | Stored but flagged as `out_of_order` in DB column |
| Frame arrives <2s since last accepted from same device | `429` over WS, frame rejected |
| Frame passes all checks | Stored; broadcast on Socket.IO room `device:<device_id>` |

**Failure modes / edge cases:**
- **Slow consumer:** Socket.IO has built-in backpressure; if a dashboard client falls behind, the server drops the slowest subscriber rather than queueing.
- **Clock skew:** `server_received_at` is always server time; if `|ts - server_received_at| > 60s`, the row is flagged `clock_skew_detected`.
- **Reorder within burst:** tolerated; seq flag captures it. Reorder across minutes may trigger rule-engine de-bouncing.

**Success metric:** ≥99% of accepted frames reach the readings table within 100ms of arrival. Zero unauthenticated frames reach the readings table (BRD §11.16).

**Traceability:** FR-1 to FR-10; spec §6; packages/shared Zod schema consumed by both api and simulator.

---

### F-2. Rules engine & alert creation

**User:** None directly (system). Admin configures rules via UI; the engine evaluates each reading.

**Trigger:** Every accepted reading triggers rules-engine evaluation.

**UI flow:** Admin edits rules at `/admin/thresholds`. The form shows current rule per (device, metric) pair with operator, value, severity, hysteresis, min_duration. Save emits a `ThresholdChange` audit entry.

**Three rule types (FR-12):**

| Type | Shape | Example |
|------|-------|---------|
| `instant` | `metric OP value` | `tds_ppm >= 300` |
| `rate` | `metric delta_per_minute OP value` | `turbidity_ntu delta_per_minute >= 0.5` |
| `absence` | `metric no_reading_for_seconds >= N` | `ph no_reading_for_seconds >= 300` |

**De-bouncing state (FR-14):**
- For each `(device_id, metric, severity)`, the engine tracks `in_violation_since` and `cleared_at`.
- A violation only fires an alert when `now - in_violation_since >= min_duration_seconds`.
- After clearing, a new alert cannot fire until `now - cleared_at >= hysteresis_seconds`.

**Alert lifecycle (FR-15, FR-16):**
- Alert created on first fire with `severity`, `opened_at`.
- If severity is `warning` or `critical`, an Incident is auto-created linked to the alert and the school.
- Alert cleared when reading drops below threshold for `hysteresis_seconds` (or rule no longer applies).

**Failure modes:**
- **No rules for a device:** global rules apply (those with `device_id IS NULL`).
- **Conflicting rules:** last-write-wins; engine doesn't try to reconcile.
- **Rule disabled mid-violation:** engine stops tracking, any open alert remains open until cleared.
- **Metric missing in reading:** that rule is skipped for this reading (no alert, no error).

**Success metric:** No false alerts during a 60-second Normal-scenario simulation (verified by Playwright in BRD §11.13).

**Traceability:** FR-11 to FR-19; spec §7.

---

### F-3. Incident workflow

**User:** Operator (primary), Technician (field), Admin (oversight).

**Trigger:** Warning/critical alert auto-creates an Incident.

**UI flow:** Operator sees new incident in `/incidents` Kanban (Open column), clicks through to `/incidents/:id` to acknowledge. Status transitions drive columns.

**State machine (FR-17):**

```
OPEN → ACKNOWLEDGED → INSPECTING → (SAFE | UNSAFE | MONITORING) → RESOLVED
                                                         ↘ REOPENED → ...
```

| Transition | Actor | UI affordance | Side effect |
|-----------|-------|---------------|-------------|
| `OPEN → ACKNOWLEDGED` | Operator or Admin | "Acknowledge" button on `/incidents/:id` | IncidentEvent written |
| `ACKNOWLEDGED → INSPECTING` | Technician or Operator | "Start inspection" + assign self | IncidentAssignment written |
| `INSPECTING → SAFE` | Technician or Operator | "Mark Safe" + comment (optional) | IncidentEvent written |
| `INSPECTING → UNSAFE` | Technician or Operator | "Mark Unsafe" + comment (required) | Critical banner fires (FR-18) |
| `INSPECTING → MONITORING` | Technician or Operator | "Mark Monitoring" + comment | Monitoring interval recorded |
| `(SAFE\|UNSAFE\|MONITORING) → RESOLVED` | Operator or Admin | "Resolve" + closing comment | Incident closed |
| `RESOLVED → REOPENED` | Operator or Admin | "Reopen" + reason | New incident lifecycle starts |
| Any → `RESOLVED` (force-close) | Admin only | "Force close" + reason | Audit entry tagged `force_close` |

**Failure modes:**
- **Two technicians race to update the same incident:** optimistic concurrency check via `updated_at`; second writer gets a 409 and is asked to refresh.
- **Operator tries to assign a Technician who doesn't exist:** dropdown is the source of truth; no free-text assignment.
- **Technician tries to update an incident not assigned to them:** FR-21 — API returns 403; UI hides the action.
- **Resolve with no comments:** allowed (comment is optional, not required).
- **Mark Unsafe with empty comment:** blocked client-side; comment required.

**Success metric:** BRD §11.4 — full state machine reproducible by Playwright from OPEN to RESOLVED with every transition audited.

**Traceability:** FR-15 to FR-19; spec §5.

---

### F-4. RBAC enforcement

**User:** All four roles.

**Trigger:** Every authenticated request.

**UI flow:** All UI elements are role-aware. Operators never see "Manage users" links. Technicians only see their assigned incidents. The dashboard route table is gated per role.

**Permission matrix (spec §4):** 13 actions × 4 roles = 52 cells. Every cell is enforced as `(subject, action, resource) → allow | deny`.

**The 13 actions:**

| # | Action |
|---|--------|
| A-1 | Manage users |
| A-2 | Onboard new school + sensor |
| A-3 | Configure thresholds |
| A-4 | View all sensors |
| A-5 | Acknowledge alert |
| A-6 | Create incident from alert |
| A-7 | Assign technician |
| A-8 | View assigned incidents |
| A-9 | Update incident status |
| A-10 | Add incident comment / attachment |
| A-11 | Resolve incident |
| A-12 | View audit log |
| A-13 | Export CSV |

**Resource shape:**
- `User`: scoped globally.
- `School`: scoped globally (single-tenant).
- `Device`: scoped by `school_id`.
- `Alert`: scoped by `device_id → school_id`.
- `Incident`: scoped by `id → school_id → assignments`.
- `Rule`: scoped by `device_id` (or global).
- `AuditEvent`: Admin-only.

**Negative test cases (must all return 403):**

| # | Test |
|---|------|
| T-1 | Technician GET `/incidents/:id` where `id` is assigned to a *different* Technician |
| T-2 | Viewer POST `/incidents` (create) |
| T-3 | Operator GET `/admin/users` |
| T-4 | Viewer GET `/audit` |
| T-5 | Technician POST `/admin/thresholds` |
| T-6 | Viewer POST `/alerts/:id/acknowledge` |
| T-7 | Operator POST `/admin/simulator` (start scenario) |
| T-8 | Any role GET `/admin/notifications` (Admin only) |

**Failure modes:**
- **JWT expired:** refresh-token flow handles this transparently; on refresh failure, redirect to `/login`.
- **Role changed mid-session:** next request re-evaluates; no stale cached role.
- **Permission matrix cell forgotten:** the negative test above for that action fails; CI red.

**Success metric:** BRD §11.5 — all 8 negative tests pass in CI.

**Traceability:** FR-20, FR-21; spec §4.

---

### F-5. Authentication

**User:** All roles.

**Trigger:** User submits email + password at `/login`.

**UI flow:** `/login` form → on success, `accessToken` stored in memory; `refreshToken` in httpOnly cookie. On 401 from any API call, attempt refresh once; on second failure, redirect to `/login`.

**Session shape:**
- `accessToken`: HS256, 8h expiry, contains `{ sub, role, iat, exp }`.
- `refreshToken`: HS256, 7d expiry, contains `{ sub, jti }`; rotated on use; jti tracked for revocation.

**Failure modes:**
- **Wrong password:** generic "Invalid credentials" message (no enumeration).
- **Account locked after N failed attempts (N=5 in v1.0):** locked for 15 minutes; Admin can unlock.
- **JWT_SECRET missing in env:** server refuses to start (fail-fast).
- **Token signature mismatch:** 401 with reason `invalid_token`; refresh attempted.

**Success metric:** No password ever stored or logged in plaintext; bcrypt hash only; verified by a unit test that asserts no log line contains the cleartext.

**Traceability:** FR-22 to FR-26; spec §12.

---

### F-6. Sensor Simulator

**User:** Admin (via `/admin/simulator`); system (as the simulated device).

**Trigger:** Admin clicks Start on a (device, scenario, params) row in `/admin/simulator`.

**UI flow:** Tab shows 6 devices, each with current scenario and a "Stop / Restart" button. New scenario picker modal lets Admin pick `scenario` from `Normal | RisingTDS | TurbiditySpike | ChlorineDrop | Offline | BatteryLow | RandomFailure`, set `duration_seconds` (optional), and click Start.

**Scenario behavior:**

| Scenario | Behavior |
|----------|----------|
| `Normal` | Random walk around healthy baseline; metrics stay in `safe` band |
| `RisingTDS` | TDS ramps +20 ppm/5s until threshold; holds |
| `TurbiditySpike` | turbidity_ntu jumps from baseline to >5 in 1 reading (triggers critical) |
| `ChlorineDrop` | chlorine_ppm drops from baseline to <0.2 over 30s (triggers critical) |
| `Offline` | Stops emitting readings; later reconnects with backoff |
| `BatteryLow` | Adds a `battery_pct` metric falling toward 0 (scaffolded for v2) |
| `RandomFailure` | Picks a random other scenario after 60s |

**Lifecycle:**
- Simulator boots → connects 6 devices over WS → each runs its base scenario.
- Admin-triggered scenarios stop on duration expiry or explicit Stop.
- Every scenario start/stop emits a `__simulator_event` audit entry.

**Failure modes:**
- **Simulator crashes:** reconnects with exponential backoff (1s → 30s); readings buffered up to 5,000.
- **JWT for simulator expires:** rotates on every simulator start; mid-run expiry is a v2 problem.
- **Scenario creates runaway state:** Admin can Stop; the engine's de-bouncing prevents alert spam regardless.

**Success metric:** BRD §11.16 — integration test verifies simulator authenticates, rate-limits, reconnects, has no back-door path. BRD §11.12 — every scenario start emits audit entry.

**Traceability:** FR-33 to FR-36; spec §10.

---

### F-7. Executive dashboard

**User:** All roles (with role-appropriate filtering).

**Trigger:** User navigates to `/`.

**UI flow:** Single page with four regions: KPI cards, map, live readings table, recent incidents feed.

**Component layout:**

```
+------------------------------------------------------+
| WATER SAFETY OVERVIEW                  [user] [out]  |
+------------------------------------------------------+
|  6  |   4   |  1   |  1   |                          |
| Sens| Healt| Warn | Crit |   (KPI cards)            |
+-----+------+------+------+--------------------------+
|                                                      |
|             WATER QUALITY MAP                         |
|     [Leaflet, OSM tiles, 6 markers]                 |
|                                                      |
+----+---------------------+---------------------------+
| LIVE READINGS                                        |
| DHAKA-SCHOOL-023  pH 7.1  TDS 184  ✓ Healthy         |
| DHAKA-SCHOOL-007  pH 6.4  TDS 312  ⚠ Warning         |
| ... (live updates via Socket.IO)                     |
+----+---------------------+---------------------------+
| RECENT INCIDENTS                                     |
| #INC-042 DHAKA-SCHOOL-023  Unsafe  3m ago            |
| #INC-041 DHAKA-SCHOOL-007  Open    11m ago           |
+------------------------------------------------------+
```

**KPI definitions:**
- `Sensors` = total devices visible to the user.
- `Healthy` = sensors whose latest reading is not in any rule's `instant` violation band.
- `Warning` = sensors with at least one open `warning` alert.
- `Critical` = sensors with at least one open `critical` alert.

**Live updates:** TanStack Query invalidated on each `reading`, `alert.opened`, `alert.cleared`, `incident.updated` push.

**Failure modes:**
- **WS disconnected:** banner shows "Reconnecting…"; KPI cards show last-known values; map markers stay at last-known color.
- **Map tiles fail to load:** graceful fallback to a plain list of devices.
- **Empty data set (before simulator connects):** all cards show `0`; map shows markers at default location.

**Success metric:** BRD §11.7 — 60-second comprehension: a reviewer can describe the workflow after 60 seconds on this page. BRD §11.2 — input lag <100ms with 6 live devices (NFR-2).

**Traceability:** spec §11.2; BRD §13 (step 3 of demo story).

---

### F-8. Sensor detail and live chart

**User:** All roles.

**Trigger:** User clicks a sensor in the dashboard or navigates to `/sensors/:device_id`.

**UI flow:** Single sensor page with: header (label, school, last-seen, firmware), live chart (Recharts, last 10 minutes), threshold lines overlaid, event timeline at bottom.

**Chart design:**
- One chart per metric (six charts in v1.0), or one combined chart with toggleable series (TBD per UI iteration).
- Threshold reference lines for active rules on that metric.
- Auto-scrolls to show latest reading; pause-on-hover.

**Failure modes:**
- **No readings yet:** empty state with "Waiting for first reading from this device."
- **Device offline:** chart shows last 10 minutes before silence; banner "Device silent for 12 min."
- **Many rules active:** legend collapses by default; hover to expand.

**Success metric:** Reviewer can identify the most recent violation on the chart within 10 seconds.

**Traceability:** spec §11.2; FR-30 (timeline events recorded).

---

### F-9. Alert list and acknowledgement

**User:** Operator (primary), Admin, Viewer (read-only).

**Trigger:** User navigates to `/alerts`.

**UI flow:** Table with columns: `opened_at`, `device`, `metric`, `value`, `severity`, `acknowledged_by`, `cleared_at`. Filters: severity, status (open/acknowledged/cleared), device. Row click → incident detail if linked.

**Actions:**
- **Acknowledge (Operator, Admin):** marks `acknowledged_at` + `acknowledged_by`. If linked to incident, transitions incident to ACKNOWLEDGED.
- **Filter by date range:** last 24h / 7d / 30d.

**Failure modes:**
- **Alert acknowledged by another Operator concurrently:** 409; UI refreshes and shows the new acknowledgement.
- **No alerts:** empty state "No alerts in selected window."

**Success metric:** Alert visible on dashboard within 3 seconds of breach (NFR-1).

**Traceability:** FR-15, FR-16, FR-18; spec §5.

---

### F-10. Incident Kanban and detail

**User:** Operator (primary), Technician (filtered), Admin, Viewer (read-only).

**Trigger:** User navigates to `/incidents` or `/incidents/:id`.

**Kanban columns:** `OPEN`, `ACKNOWLEDGED`, `INSPECTING`, `AWAITING REVIEW` (post-`SAFE|UNSAFE|MONITORING`), `RESOLVED`. Card shows: id, device, severity, age, assignee.

**Detail page (`/incidents/:id`):**
- Header: id, state, severity, opened_at, age.
- Timeline: every state transition with actor + timestamp.
- Comments thread: chronological, with role badges.
- Attachments: file upload (image/pdf), with mime type guards.
- Actions panel: state-machine buttons appropriate to current state and viewer role.
- Linked readings: most recent readings at the time of the breach.

**Technician view restriction (FR-21):** Kanban shows only incidents where the technician is the assignee.

**Failure modes:**
- **State transition race:** optimistic concurrency check.
- **Comments empty:** comment box has placeholder; no validation on length.
- **Attachment upload too large (>10MB):** rejected client-side before upload.

**Success metric:** BRD §11.4 — Playwright happy path reproduces OPEN → RESOLVED with every transition audited.

**Traceability:** FR-17 to FR-19; spec §5.

---

### F-11. Audit log

**User:** Admin only.

**Trigger:** User navigates to `/audit`.

**UI flow:** Append-only list with filters: actor, event_type, date range. Each row: `ts`, `actor`, `type`, `resource`, `payload (jsonb, expandable)`.

**Event types recorded:**
- `User.created`, `User.disabled`, `User.role_changed`
- `School.created`
- `Device.created`, `Device.fw_updated`
- `Rule.created`, `Rule.updated`, `Rule.disabled`
- `Alert.opened`, `Alert.acknowledged`, `Alert.cleared`
- `Incident.created`, `Incident.state_changed`, `Incident.assigned`, `Incident.commented`, `Incident.attachment_added`, `Incident.resolved`, `Incident.reopened`
- `ThresholdChange`
- `__simulator_event`

**Failure modes:**
- **DB write fails:** the parent operation rolls back; audit is part of the same transaction.
- **Payload contains PII:** shown only to Admin; never logged to stdout.

**Success metric:** BRD §11.4 — every transition in the demo story appears in `/audit` with actor + timestamp.

**Traceability:** FR-19, FR-30, FR-36.

---

### F-12. School onboarding (admin)

**User:** Admin.

**Trigger:** Admin navigates to `/admin/users` → "Onboard new school" or `/admin/users` flow.

**UI flow:** Multi-step form: School (name, upazila, district, lat, lng, contact user) → Device (label, fw_version, initial thresholds) → Review → Submit. Time-to-completion is the success metric (NFR-9).

**Steps:**
1. Pick or create contact user (existing user list with quick-create inline).
2. School fields: name, upazila (dropdown of Bangladesh upazilas), district, lat/lng (map picker or paste).
3. Device fields: label (e.g. `DHAKA-SCHOOL-023`), fw_version (`1.0.3` default), initial rule set (copy-from-template or custom).
4. Review summary.
5. Submit → creates School, Device, Rule rows; first reading arrives within 1 simulator cycle.

**Failure modes:**
- **Duplicate school name in district:** allowed; warned in UI but accepted (no v1.0 uniqueness enforcement).
- **Invalid lat/lng:** rejected client-side; range check.
- **Contact user doesn't exist:** inline quick-create.

**Success metric:** BRD §11.1 / NFR-9 — full onboarding flow completes in <5 minutes in a timed test.

**Traceability:** US-1, US-2, US-3.

---

### F-13. Threshold management (admin)

**User:** Admin.

**Trigger:** Admin navigates to `/admin/thresholds`.

**UI flow:** List of rules with filters: device (or "global"), metric, severity. Each row: operator, value, hysteresis, min_duration. Edit inline; changes emit `ThresholdChange` audit entry and bump rule version.

**Defaults (FR-13):**
- `turbidity_ntu > 5 = critical` (instant)
- `chlorine_ppm < 0.2 = critical` (instant)
- `tds_ppm >= 300 = warning` (instant)
- `ph < 6.5 or > 8.5 = warning` (instant)
- `temp_c > 45 = warning` (instant)
- `water_level_cm < 20 = warning` (instant)

**Failure modes:**
- **Edit rule while an alert is open:** allowed; new rule applies to next reading; open alert stays until cleared.
- **Delete rule with active version:** soft-delete; rule marked `active=false`, retained for audit.

**Success metric:** Admin can change a threshold and see the change reflected in `/sensors/:id` within 30 seconds.

**Traceability:** FR-11, FR-13; spec §7.

---

### F-14. Deployment & quickstart

**User:** Reviewer / new contributor.

**Trigger:** `git clone` followed by `docker compose up`.

**UI flow:** N/A (operational, not user-facing).

**`docker-compose.yml` shape (NFR-15):**

```yaml
services:
  db:        # postgres:15, port 5432, volume-mounted data
  api:       # node:20, port 3000, depends_on db, simulator
  web:       # nginx serving the Vite build, port 5173, depends_on api
  simulator: # node:20, separate process, depends_on api
```

**Quickstart steps (≤5 minutes, NFR-11):**

1. `git clone <repo>`
2. `cp .env.example .env`
3. `docker compose up`
4. Open `http://localhost:5173`
5. Login as `admin@example.com / password` (seeded)
6. See 6 simulated devices reporting

**Failure modes:**
- **Port collision:** README documents defaults; user adjusts `.env`.
- **First-run DB migration:** Prisma runs migrations on container start; idempotent.
- **Simulator can't reach api:** retry with backoff; clear error in logs.

**Success metric:** BRD §11.11 — fresh-clone-to-dashboard in ≤5 minutes.

**Traceability:** spec §14; NFR-15.

---

## 6. Sequencing Plan (8 vertical slices)

The build is organised into 8 vertical slices, each ending with something runnable. Most slices are 2–3 days of focused work; the total sums to 20 working days (4 weeks single-threaded, 2.5–3 weeks with slices 5/6/7 partially parallel — UI work is independent of RBAC enforcement). Total budget: 2–4 weeks. Any slice that overruns triggers a scope cut (R-10).

| # | Slice | Days | Deliverable | P0 features covered |
|---|-------|------|-------------|---------------------|
| 1 | **Skeleton** | 2 | Monorepo + Postgres + `/healthz` + README skeleton | F-14 (deployment shell) |
| 2 | **Wire contract** | 2 | `packages/shared` Zod schema, api WS ingestion, simulator with 6 devices on Normal | F-1, F-6 (boot only) |
| 3 | **Rules + alerts** | 3 | Three rule types, de-bouncing, alert creation, `/alerts` page | F-2, F-9 |
| 4 | **Incidents + workflow** | 3 | State machine, assignment, `/incidents` Kanban + detail | F-3, F-10 |
| 5 | **Dashboard + sensors** | 3 | `/`, `/sensors`, `/sensors/:id` with Recharts + Leaflet | F-7, F-8 |
| 6 | **Admin surface** | 3 | User CRUD, threshold CRUD, audit log, `/admin/simulator`, `/admin/notifications` | F-11, F-12, F-13, F-6 (full UI) |
| 7 | **Auth + RBAC** | 2 | Login, JWT, RBAC enforcement, all 8 negative tests | F-4, F-5 |
| 8 | **E2E + polish** | 2 | Playwright happy path, coverage gates, `.env.example`, DHAKA-SCHOOL-023 demo | BRD §11.13–17 |

**Critical path:** Slices 1 → 2 → 3 → 4 → 7 → 8 are sequential (each unblocks the next). Slices 5 and 6 can run in parallel with 7 (UI work independent of RBAC enforcement) but block before 8.

**Demo story timing check (BRD §13):**
- The 10-step walkthrough becomes reproducible after slice 6 (all screens exist).
- It becomes *complete* (step 8 Critical banner works) after slice 7 (RBAC enforcement).
- It becomes *automated* (Playwright happy path) after slice 8.

---

## 7. Cross-cutting Concerns

These apply to every slice, not a single feature.

### 7.1 Type safety (NFR-13)

- `packages/shared/src/telemetry.ts` — the wire contract Zod schema; both api and simulator import from this.
- `packages/shared/src/permissions.ts` — the permission matrix as a typed function `(subject, action, resource) => boolean`.
- No `any` in the api or simulator code; CI lint rule enforces.

### 7.2 Testing (NFR-12)

- **Unit tests (Vitest):** api domain logic (rules engine, alert lifecycle, incident state machine), permissions utility.
- **Integration tests (Vitest):** WS ingestion happy path, RBAC negative cases, simulator-as-real-client seam test.
- **E2E (Playwright):** the 10-step demo story from BRD §13.
- **Coverage gates:** backend 70%, frontend 50%; CI fails below.

### 7.3 Observability

- Structured logging (`pino`) on api and simulator; no `console.log` in shipped code.
- Health endpoint `/healthz` returns `{ db: 'ok', simulator: 'connected' | 'disconnected' }`.
- Clock-skew flag visible in ops view (FR-4).

### 7.4 Security

- All env secrets via `.env`; `.env.example` ships; `.env` gitignored.
- bcrypt cost 12 (FR-24); no plaintext passwords anywhere.
- CORS locked to `localhost:5173` for v1.0.
- Rate limit on `/login` (10 req/min/IP); on `/ingest` per-device (1/2s, FR-10).

---

## 8. Success Metrics

How we'll know v1.0 worked.

| Metric | Target | Source |
|--------|--------|--------|
| Demo story reproducibility | ≤15 minutes from `git clone` to step 10 | BRD §11.15; BRD §13 |
| Alert latency | <3 seconds end-to-end, p95 | NFR-1; BRD §11.3 |
| Onboarding time | ≤5 minutes via UI | NFR-9; BRD §11.1 |
| Comprehension SLA | 60 seconds from dashboard | NFR-8; BRD §11.7 |
| Live devices | 6 simulated devices, continuous updates | BRD §11.2 |
| RBAC negative tests | 8/8 passing | BRD §11.5 |
| Wire contract seam | Simulator is a real client (no back-door) | BRD §11.16 |
| Two-layer schema | 6 metrics in `MetricDefinition` registry on startup | BRD §11.17 |
| Coverage | backend 70% / frontend 50% | NFR-12 |
| Build time | ~20 working days across 8 slices, fits within the 2–4 week budget (slices 5/6/7 partially parallel) | R-10 mitigation |

---

## 9. Risks (Top 5 for v1.0)

Top risks from BRD §12, ranked by likelihood × impact for the build phase. Full table in BRD; only the top 5 are tracked weekly.

| Rank | ID | Risk | Trigger condition | Owner action |
|------|----|------|-------------------|--------------|
| 1 | R-10 | Build window slips | Slice 8 overruns its 2-day budget | Scope-cut conversation; kill P2 features first |
| 2 | R-1 | Scope creep | A "small" feature request appears | Defer to v2 BRD; document the cut |
| 3 | R-2 | Wire contract drift | Simulator's frame shape diverges from api's Zod schema | CI red on PR; shared schema enforced |
| 4 | R-7 | Demo-day failure | Docker fails on reviewer's machine | Test README on a clean machine before any demo |
| 5 | R-14 | Bangladesh-realism scenarios break | 60s disconnect test fails | Re-run the Offline scenario; re-fix the buffer |

---

## 10. Out of Scope (v1.0)

Items NOT shipped in v1.0. Each maps to a v2 backlog entry in BRD Appendix B.

| Category | Items |
|----------|-------|
| Hardware | Real MQTT/LoRaWAN/ESP32 devices |
| Mobile | Android / iOS apps |
| Locale | Bangla (bn) content (locale scaffold is in scope) |
| Tenancy | Multi-tenant isolation across NGOs/municipalities |
| Crypto | Per-frame signing; hash-chained audit log |
| Storage | TimescaleDB / ClickHouse |
| Infra | Redis pub/sub, BullMQ, microservices, Kubernetes |
| Notifications | Real SMS (BD carriers), email, WhatsApp Business API |
| Compliance | BSTI/WHO certification, Bangladesh data-protection law |
| Operational | Sensor calibration management, per-firmware-version data lineage |
| Deployment | TLS, monitoring, backups, JWKS/RS256, key rotation |

Each row is recoverable as a v2 BRD item without re-architecting v1.0. The wire contract (FR-1–10) is the seam that makes this true.

---

## 11. Open Questions

To resolve during the build, not before:

1. Final Postgres schema — derived from spec §8 + FR-31's aggregation table.
2. Whether `MetricDefinition` table is queried at startup or per-event. **Recommend** startup, cached in memory.
3. Whether chart series are per-metric (six small charts) or one combined chart with toggles. **Recommend** combined, validated with portfolio reviewer.
4. Whether comments are required when marking Unsafe. **Recommend** yes (F-3 already specifies this).
5. Whether attachments in v1.0 are in-DB blobs or filesystem paths. **Recommend** filesystem under `/var/surakkha/attachments`, path in DB; clean for v2 to swap to S3.

None of these block slice 1 or 2.

---

## Appendix A — Traceability: PRD → BRD → Spec

| PRD Feature | BRD Section | Spec Section |
|-------------|-------------|--------------|
| F-1 Wire contract | §8.1, §8.2; NFR-13, NFR-14 | §6, §6.3 |
| F-2 Rules engine | §8.3; NFR-1 | §7 |
| F-3 Incident workflow | §8.4; NFR-4 | §5 |
| F-4 RBAC | §8.5; §11.5; NFR-6 | §4 |
| F-5 Auth | §8.6 | §12 |
| F-6 Simulator | §8.10; §11.12, §11.16 | §10 |
| F-7 Dashboard | §11.7, §11.8; NFR-8 | §11.2 |
| F-8 Sensor detail | §11.8 | §11.2 |
| F-9 Alerts list | §8.4; NFR-1 | §11.2 |
| F-10 Incidents | §8.4; §11.4 | §5, §11.2 |
| F-11 Audit log | §8.8; §11.12 | §8, §11.2 |
| F-12 Onboarding | §11.1; NFR-9 | §11.2 |
| F-13 Thresholds | §8.3 | §7 |
| F-14 Deployment | §11.11, §11.14; NFR-15 | §14 |

---

## Appendix B — Glossary (lightweight)

| Term | Plain definition |
|------|------------------|
| **Reading** | A single snapshot of all six water-quality metrics from one device at one moment |
| **Alert** | A "this looks wrong" signal raised by the rules engine when a reading crosses a threshold |
| **Incident** | The work item that exists when an alert needs human follow-up; tracks state from open to resolved |
| **Rule** | A threshold definition: "if `metric` `operator` `value` for `min_duration`, raise alert of `severity`" |
| **Simulator** | A separate Node process that pretends to be a real sensor, sending readings over the same wire contract |
| **Wire contract** | The agreement about what a telemetry frame looks like — the seam that lets real hardware replace the simulator without changing the platform |
| **Two-layer metric schema** | v1.0 has a fixed set of six metrics; a registry is scaffolded so v2 can add metrics without a data migration |
| **RBAC** | Role-based access control — the matrix that decides which user can do which thing to which resource |
| **De-bouncing** | Waiting a configured time before raising an alert, to prevent noise-driven false alarms |