# Surakkha — Business Requirements Document (BRD)

**Document type:** Business Requirements Document
**Source:** Derived from `architecture.md` (v1.0, 2026-08-20; refactored from the original combined spec)
**Audience:** Stakeholders, product owner, development team, future contributors
**Status:** Draft v1.0
**Date:** 2026-08-20
**Owner:** Solo / 2-person team

---

## 1. Executive Summary

Surakkha is a **real-time water safety monitoring and incident-management platform for schools in Bangladesh**. The platform connects IoT water-quality sensors installed at school water sources to a central dashboard, automatically detects contamination events, generates alerts, creates incident reports, and routes them through a defined workflow until resolution.

The v1 release is a **portfolio-grade MVP** scoped to one vertical (schools), one region (Bangladesh), and one end-to-end workflow (Sensor → Reading → Rule → Alert → Incident → Resolution). It uses a hardware-shape-faithful simulator instead of real devices so it can be built and demonstrated in 2–4 weeks.

The system is designed for the operating realities of Bangladesh: intermittent power (load-shedding), intermittent connectivity (2G/3G), one caretaker per school with a basic mobile, and an established chain of authority from headmaster → education officer → BSTI.

**Strategic value:** Demonstrates an operator-grade monitoring workflow (not just CRUD) on a portfolio timescale. The device contract is designed so that real hardware later replaces the simulator by changing only the transport, and a future generic metric registry enables other verticals (apartments, factories, community points) to drop in **without code change to the platform core** — matching BO-5.

---

## 2. Business Background and Problem Statement

### 2.1 Problem

Children in Bangladeshi government primary schools drink water from on-site sources (tube wells, storage tanks, municipal supply) that can become unsafe between manual inspections. Existing monitoring is:

- **Reactive**, not preventative — incidents surface only when a child falls ill.
- **Manual and infrequent** — inspections happen monthly or quarterly, if at all.
- **Undocumented** — there is no shared audit trail of what was tested, when, and by whom.
- **Disconnected from escalation paths** — the headmaster who sees a problem has no defined route to the Upazila Education Office or BSTI.

A contamination event at a single school affects 200–1,500 children and is a politically and socially visible incident. The absence of a continuous monitoring layer is a gap with both humanitarian and reputational stakes.

### 2.2 Opportunity

Bangladesh has ~130,000 government primary schools. Even capturing 10 schools for the MVP is operationally realistic; scaling is a sales problem, not a technical problem. The same platform, with the same device contract, extends to other customer segments (apartment complexes, factories, markets, rural community water points) and other verticals (air, electricity, cold-chain) without architectural change.

### 2.3 Why now

- Sensor hardware (pH, TDS, turbidity, chlorine, temperature, level) is off-the-shelf and inexpensive.
- Edge buffering + intermittent cellular connectivity is a solved problem; the device contract in this platform is shaped for that reality from day one.
- Bangladesh's BSTI standards for drinking water provide a clear threshold reference source.
- A portfolio-grade MVP can be built, demonstrated, and used as a sales artefact within a single calendar quarter.

---

## 3. Business Objectives

| # | Objective | Success Measure |
|---|-----------|----------------|
| BO-1 | Demonstrate a complete Sensor → Resolution workflow end-to-end | A reviewer can reproduce the DHAKA-SCHOOL-023 contamination flow from a fresh clone in under 15 minutes |
| BO-2 | Validate the device contract as the seam between simulator and real hardware | Simulator and real-device integration paths use identical wire contract (§6) |
| BO-3 | Establish operator-grade audit and permissioning patterns | Every state transition is timestamped and attributed; permission matrix in §4 of the spec is enforced on every endpoint |
| BO-4 | Keep v1 shippable inside a 2–4 week build window | 100% of v2 backlog items in §15 of the spec remain deferred; no creep |
| BO-5 | Make a defensible platform-vs-vertical claim | Documented device abstraction (§6) and rules engine abstraction (§7) that, without code change, support other verticals |

---

## 4. Scope

### 4.1 In scope (v1)

- Schools in Bangladesh as the only customer vertical.
- One end-to-end workflow: Sensor reading → Rule evaluation → Alert → Incident → Assignment → Resolution.
- 4 user roles (Admin, Operator, Technician, Viewer) with the explicit permission matrix in spec §4.
- 6 simulated devices (representing 6 schools), each capable of multiple behavioural scenarios.
- Real-time dashboard, sensor list, sensor detail (with charts), alert list, incident Kanban, incident detail, maintenance view, CSV export, audit log.
- WebSocket-based live updates for readings, alerts, and incidents.
- 30-day raw retention with hourly 5-minute aggregation.
- UI in English with Bangla-friendly typography tokens (Bangla locale text deferred to v2).
- Single Docker Compose deployment for local demo.

### 4.2 Out of scope (v1) — explicitly deferred to v2

- Real IoT hardware (MQTT, LoRaWAN, ESP32 firmware), real SMS / email / push delivery.
- Mobile app (Android / iOS).
- Bangla (bn) locale content.
- Multi-tenant data isolation across NGOs or municipalities.
- Cryptographic signing of telemetry frames, signed/hash-chained audit log.
- Time-series database (TimescaleDB / ClickHouse), Redis pub/sub for WS horizontal scaling, BullMQ background-job queue.
- WhatsApp Business API, BD carrier SMS integrations (Grameenphone, Banglalink, Robi).
- BSTI/WHO compliance certification, Bangladesh data-protection law compliance.
- Sensor calibration management, per-firmware-version data lineage, cost/pricing model.

Each deferred item is logged for the v2 BRD.

---

## 5. Stakeholders

| Stakeholder | Interest | Engagement in v1 |
|-------------|----------|------------------|
| **Solo / 2-person dev team** | Build, demo, iterate | Build, operate, document |
| **Future hiring managers / portfolio reviewers** | Assess engineering judgment, scope discipline, workflow thinking | Primary audience for the live demo |
| **Schools (represented, not onboarded)** | Validates operator realism of UX | Persona-driven design only in v1 |
| **Headmaster (persona)** | Decision-maker at school level | Informs the Admin/Operator role split; **not a v1 user account** |
| **Caretaker (persona)** | Sensor operator, on-the-ground responder | Maps to the **Operator** role in v1 |
| **Technician (persona)** | Visits site, submits results | Maps to the **Technician** role in v1 |
| **Upazila Education Office (future)** | Escalation recipient | Out of v1 user set; documented as escalation path |
| **BSTI (future)** | Standards authority for thresholds | Threshold defaults hard-coded from WHO for v1; BSTI alignment deferred to v2 |

---

## 6. Personas

### 6.1 Admin

- **Who:** Platform owner / system administrator.
- **Goal:** Operate the system, manage users, configure thresholds, run demo scenarios, review audit trail.
- **Permissions:** Everything in the spec §4 matrix.
- **Frequency of use:** Daily.

### 6.2 Operator

- **Who:** Caretaker or school-level operator (often with intermittent connectivity and a basic mobile).
- **Goal:** See what's happening at their school, acknowledge alerts, create incidents, assign technicians.
- **Permissions:** View all sensors, acknowledge alerts, create incidents, assign technicians, update incident status, add comments, resolve.
- **Frequency of use:** Reactive (driven by alerts); UI must be legible on low-end devices.

### 6.3 Technician

- **Who:** Field technician who physically visits the school.
- **Goal:** See only the incidents assigned to them, update status as they work the problem.
- **Permissions:** View assigned incidents, update status, add comments/attachments. **Cannot** see other technicians' work.
- **Frequency of use:** Daily during working hours.

### 6.4 Viewer

- **Who:** Read-only stakeholder (e.g. education officer, NGO partner monitoring the deployment).
- **Goal:** Visibility without operational risk.
- **Permissions:** View all sensors, view assigned incidents (i.e. all), export CSV.
- **Frequency of use:** Periodic (weekly reviews, reports).

---

## 7. User Stories

### 7.1 Onboarding and configuration

- **US-1 (Admin):** As an Admin, I can onboard a new school with upazila, district, GPS coordinates, and a contact user in under 5 minutes.
- **US-2 (Admin):** As an Admin, I can register a new sensor to a school with a `device_id`, human label, and firmware version.
- **US-3 (Admin):** As an Admin, I can configure thresholds (rules) per device or globally, with version history.
- **US-4 (Admin):** As an Admin, I can manage users — create, disable, change role.

### 7.2 Live monitoring

- **US-5 (any role):** As any role, I can see the executive dashboard with KPI cards, a map of schools, and live readings updating in real time.
- **US-6 (any role):** As any role, I can drill into a sensor to see a real-time chart of recent metrics with threshold reference lines and an event timeline.
- **US-7 (Operator/Admin):** As an Operator/Admin, I see an open alert on the dashboard within 3 seconds of the breach being detected end-to-end.

### 7.3 Incident workflow

- **US-8 (Operator/Admin):** As an Operator, when a warning or critical alert fires, an incident is auto-created and shown to me for acknowledgement.
- **US-9 (Operator/Admin):** As an Operator, after acknowledgement I can assign a Technician from a list.
- **US-10 (Technician):** As a Technician, I see only my assigned incidents; I can update status to Inspecting and submit a result (Safe / Unsafe / Monitoring) with comments and attachments.
- **US-11 (Operator/Admin):** As an Operator, after the Technician submits a result, I review and resolve (or reopen) the incident.
- **US-12 (Admin):** As an Admin, every transition in the incident lifecycle — who, when, what — appears in the audit log.

### 7.4 Permissions

- **US-13 (Technician):** As a Technician, attempts to access other Technicians' incidents are denied at the API and hidden from the UI.
- **US-14 (Viewer):** As a Viewer, I can view sensors and incidents but cannot acknowledge, create, assign, or resolve anything.
- **US-15 (Operator):** As an Operator, I cannot perform Admin actions (user CRUD, threshold CRUD, simulator control, audit log view).

### 7.5 Reporting and audit

- **US-16 (Admin/Operator/Viewer):** I can export a CSV of the last 30 days of readings for any sensor.
- **US-17 (Admin):** As an Admin, I can view a complete, filterable audit log of all state changes, threshold changes, and simulator events.

### 7.6 Demo and operator simulation

- **US-18 (Admin):** As an Admin, I can open the Simulator tab, pick a device and a scenario (RisingTDS, TurbiditySpike, ChlorineDrop, Offline, BatteryLow, RandomFailure), set a duration, and click Start to drive a live demo of the workflow.
- **US-19 (Admin):** I can reproduce the DHAKA-SCHOOL-023 RisingTDS → UNSAFE → resolved flow from a fresh repository clone inside 15 minutes.

---

## 8. Functional Requirements

Each requirement carries a stable identifier (FR-N) for traceability to test cases.

### 8.1 Device and telemetry

- **FR-1.** Every device has a stable UUIDv4 `device_id` generated at factory provisioning; the `device_id` is referenced in every reading, event, and command, and persists across SIM/MAC changes.
- **FR-2.** Telemetry frames MUST validate against the schema in spec §6.2 (device_id, ts, fw, seq, metrics with `ph`, `tds_ppm`, `turbidity_ntu`, `temp_c`, `chlorine_ppm`, `water_level_cm`). These six metrics are the **v1 seed** of the two-layer metric schema (see §10.1): the rules engine, charts, simulator, and tests know these by name, and the platform stores them in a `jsonb` blob so that v2 metric additions require no data migration.
- **FR-3.** Unknown fields MUST be ignored; missing required fields MUST cause a `400` response.
- **FR-4.** Each device MUST transmit `server_received_at` (server time) separately from device `ts`, and clock-skew MUST be exposed to ops.
- **FR-5.** Each frame MUST carry a monotonically increasing per-device `seq` counter; the server MUST detect dropped and reordered readings.
- **FR-6.** Frames in v1 are unauthenticated at the frame level; authentication is at the transport layer via short-lived per-device JWT.

### 8.2 Transport

- **FR-7.** Devices connect to the platform over WebSocket at `ws://<host>/ingest/{device_id}`.
- **FR-8.** Auth is a short-lived JWT minted per device, rotated on simulator start (every process boot).
- **FR-9.** Simulator MUST reconnect with exponential backoff (1s → 30s cap) on disconnect; up to 5,000 readings buffer in the simulator process and flush on reconnect.
- **FR-10.** Server MUST enforce a per-device rate cap of 1 reading per 2 seconds; bursts MUST be rejected with `429`.

### 8.3 Rules engine

- **FR-11.** Rules are JSON, stored per `device_id` (or globally when `device_id` is null), versioned, and audit-logged on change.
- **FR-12.** v1 supports exactly three rule types: `instant` (operators `>=`, `>`, `<=`, `<`, `==`), `rate` (`delta_per_minute`), `absence` (`no_reading_for_seconds`).
- **FR-13.** Severity is explicitly set by the rule, not inferred. The full v1.0 default threshold set is specified in §8.3.1 ("Threshold Defaults and Source Authority") and is the canonical source of truth for which `severity` is attached to which `metric` condition. Admins may override any rule per device; global rules (device_id IS NULL) ship from this table and are mutable via `/admin/thresholds`.
- **FR-14.** Rules engine MUST support de-bouncing via `min_duration_seconds` (reading must be in violation this long before alert fires) and `hysteresis_seconds` (once cleared, must stay clear this long before re-firing), tracked per `(device, metric, severity)`.

#### 8.3.1 Threshold Defaults and Source Authority

The table below is the **canonical v1.0 threshold set** for government primary schools in Bangladesh. Each row seeds the `Rule` table on first boot (the global rules; per-device overrides are possible but start absent). Values marked **WHO** are derived from WHO Guidelines for Drinking-water Quality (5th edition); values marked **BSTI** from Bangladesh Standard BDS 1240 (drinking water); values marked **engineering** are operational, not health-based, and exist to detect device or supply faults rather than toxicity.

Where WHO and BSTI differ, BSTI is authoritative for Bangladesh deployments and is what ships in v1.0. Where the standard is silent, an engineering default is used and the rationale column documents why.

| Metric | Operator | Value | Severity | Hysteresis (s) | Min duration (s) | Source | Rationale |
|--------|----------|-------|----------|----------------|------------------|--------|-----------|
| `ph` | `<` | 6.5 | warning | 300 | 30 | WHO/BSTI | Below pH 6.5: corrosive water, potential metal leaching |
| `ph` | `>` | 8.5 | warning | 300 | 30 | WHO/BSTI | Above pH 8.5: scale formation, aesthetic and operational impact |
| `tds_ppm` | `>=` | 300 | warning | 300 | 60 | WHO (aesthetic) | TDS > 300 ppm: noticeable taste; > 1000 ppm is health concern but rare in schools |
| `tds_ppm` | `>=` | 1000 | critical | 600 | 30 | WHO | TDS ≥ 1000 ppm: health-based upper limit per WHO guideline |
| `turbidity_ntu` | `>` | 5 | critical | 600 | 30 | WHO/BSTI | Turbidity > 5 NTU: interferes with disinfection; immediate health risk |
| `chlorine_ppm` | `<` | 0.2 | critical | 600 | 60 | WHO | Free chlorine < 0.2 mg/L: insufficient residual disinfection |
| `chlorine_ppm` | `>` | 1.5 | warning | 300 | 60 | WHO | Free chlorine > 1.5 mg/L: taste complaint, operational concern |
| `temp_c` | `>` | 45 | warning | 600 | 120 | engineering | Water above 45°C: supply fault (heater proximity, sun-exposed tank); not a chemical health risk |
| `water_level_cm` | `<` | 20 | warning | 300 | 60 | engineering | Level below 20 cm: tank near empty; supply or pump fault |

**Notes on the table:**

- **Range rules** (e.g. pH `6.5–8.5`) are implemented as **two single-sided rules** (one `< 6.5`, one `> 8.5`) because the v1.0 rules engine supports only `instant` operators `>=, >, <=, <, ==` (FR-12). Both fire independently and de-bounce independently.
- **Severity ordering.** When a reading triggers two rules (e.g. TDS 1500 ppm triggers both the 300 warning and the 1000 critical), the alert uses the **higher severity**. The rules engine stores the lower-severity alert as `cleared` once the higher-severity alert fires, preventing alert spam.
- **De-bouncing rationale.** `min_duration_seconds` prevents flap on noisy sensors. `hysteresis_seconds` is longer than `min_duration_seconds` to prevent alert thrash when readings oscillate around a threshold. The exact values come from typical sensor noise profiles for low-cost water-quality probes.
- **WHO/BSTI authoritative link.** WHO Guidelines for Drinking-water Quality (5th edition, 2022) and BSTI BDS 1240 (Bangladesh Standard for Drinking Water). Both documents are public; the exact cited clauses must be verified by an operator before any production rollout. v1.0 ships the values; v2 will add a `ThresholdSource` column on the `Rule` table with citations and version tracking.
- **Out-of-standard scenarios.** If a school's water source has unusual chemistry (high natural iron, arsenic-prone aquifer, etc.), Admin can override per device via `/admin/thresholds`. v1.0 does not support time-bounded or seasonal overrides (deferred to v2).
- **Bangladesh-specific risk: arsenic.** Arsenic in groundwater is a known Bangladesh public-health issue (WHO recommends ≤ 10 μg/L). Arsenic is **not** in the v1.0 metric set because it requires an additional sensor and lab confirmation pattern that v1.0 does not model. Adding arsenic as a v2 metric is documented in BRD Appendix B as a high-priority v2 candidate.
- **Bangladesh-specific risk: iron.** Iron in groundwater is common and affects turbidity indirectly. The current `turbidity_ntu > 5` rule catches the failure mode even without a dedicated iron sensor.

### 8.4 Alerts and incidents

- **FR-15.** Threshold breach MUST produce an alert with severity (`info | warning | critical`), opened_at, acknowledged_at, cleared_at.
- **FR-16.** Alerts of severity `warning` or `critical` MUST auto-create an incident linked to the alert and the school.
- **FR-17.** Incident lifecycle follows the state machine in spec §5: `OPEN → ACKNOWLEDGED → INSPECTING → (SAFE | UNSAFE | MONITORING) → RESOLVED`, with a `REOPENED` branch.
- **FR-18.** Status `UNSAFE` MUST automatically raise a Critical notification banner to all Admins for 24 hours or until acknowledged. The 24-hour auto-dismiss is implemented but not covered by automated tests in v1 (would require time mocking); the *until-acknowledged* dismissal is tested.
- **FR-19.** Every state transition MUST be recorded in `IncidentEvent` with actor_user_id, type, payload, and timestamp.

### 8.5 Permissions

- **FR-20.** The permission matrix in spec §4 MUST be enforced on every endpoint as a `(subject, action, resource)` check. There is no implicit "Admin can do everything."
- **FR-21.** Negative cases (Technician accessing other Technicians' incidents, Viewer creating an incident, Operator accessing the audit log) MUST return `403` and MUST be covered by automated tests.

### 8.6 Authentication

- **FR-22.** JWT (HS256) with 8-hour expiry, signed with `JWT_SECRET` env var.
- **FR-23.** Login MUST issue access + refresh tokens; refresh token MUST be stored in an httpOnly cookie.
- **FR-24.** Passwords MUST be hashed with bcrypt cost factor 12.
- **FR-25.** v1 uses a single secret with no key rotation; JWKS / RS256 is a v2 requirement.
- **FR-26.** v1 has no SSO or MFA; documented as a v2 item.

### 8.7 Notifications

- **FR-27.** v1 notifications are UI-only (toast + banner); no real SMS, email, or push.
- **FR-28.** The platform MUST record every notification that *would* have been sent to a `Notification` table, visible on `/admin/notifications`.

### 8.8 Reporting and audit

- **FR-29.** Users with export permission MUST be able to download 30 days of readings for any sensor as CSV.
- **FR-30.** All state changes, threshold changes, and simulator events MUST appear in a queryable audit log viewable only by Admin role.

### 8.9 Data retention

- **FR-31.** Raw readings older than 30 days MUST be aggregated into 5-minute mean/min/max rows and the raw rows deleted.
- **FR-32.** An hourly cron MUST drive the retention/aggregation job.

### 8.10 Simulator

- **FR-33.** The simulator is a separate Node process that authenticates and connects via the same wire contract as a real device (§6.3).
- **FR-34.** The simulator MUST ship 6 default devices, one per school, each running one of 6 base scenarios (`Normal`, `RisingTDS`, `TurbiditySpike`, `ChlorineDrop`, `Offline`, `BatteryLow`, `RandomFailure`).
- **FR-35.** Simulator JWTs MUST be issued with `aud=simulator` and read-only-equivalent scope, and MUST NOT be able to execute admin actions even if compromised.
- **FR-36.** Simulator scenario controls MUST be exposed via an Admin-only `/admin/simulator` tab and MUST emit a `__simulator_event` audit entry on every state change.

---

## 9. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-1 | Performance | End-to-end alert latency (breach → alert visible on dashboard) MUST be under 3 seconds under nominal load (6 devices). |
| NFR-2 | Performance | Dashboard UI MUST remain responsive (input lag under 100ms) with 6 live devices at 1 reading / 2s each. |
| NFR-3 | Scalability (design) | The device contract (§6) is designed as the seam for v2 horizontal scaling (a future pub/sub layer). v1's single-process architecture supports the 6-device demo and is expected to support 10–100 devices without redesign; actual capacity is not load-tested in v1. |
| NFR-4 | Reliability | The platform MUST tolerate a 60-second disconnect mid-incident (per spec §17 risk row) without losing state. The simulator MUST include an `Offline` scenario that exercises this. |
| NFR-5 | Reliability | Simulator MUST buffer up to 5,000 readings and flush on reconnect without loss. |
| NFR-6 | Security | All endpoints MUST enforce the permission matrix; JWTs MUST be validated on every request; passwords MUST use bcrypt cost 12. |
| NFR-7 | Security (v2 deferred) | Per-frame cryptographic signing, JWKS/RS256, audit-log immutability via hash chains. |
| NFR-8 | Usability | A reviewer who has never seen the project MUST understand the workflow within 60 seconds from the dashboard (per spec §3.8). |
| NFR-9 | Usability | A school (school row, sensors, rules, primary contact) MUST be onboardable in under 5 minutes via the UI (per spec §3.1). |
| NFR-10 | Localisability (deferred) | v1 ships English-only with a translation file structure and Tailwind tokens ready for Bangla fonts (locale content v2). |
| NFR-11 | Operability | The platform MUST be reproducible locally with a single `docker compose up` plus a 5-minute README quickstart. |
| NFR-12 | Test coverage | Backend MUST target 70% line coverage; frontend 50%. Playwright MUST cover the happy path: login → see reading → trigger scenario → resolve incident. |
| NFR-13 | Maintainability | Lint and format MUST be enforced (ESLint + Prettier); type-safety MUST be end-to-end via shared Zod schemas consumed by both api and simulator. |
| NFR-14 | Compatibility | The wire contract MUST be frozen behind a `version: 1` header and treated as a contract review item every sprint (per spec §17). |
| NFR-15 | Deployment | v1 deployment MUST be a single Docker Compose file with three services: web (Nginx-served Vite build), api (Node 20), db (Postgres 15 with volume-mounted data). |

---

## 10. Assumptions and Dependencies

### 10.1 Assumptions

- A 2-person team (or solo) can deliver v1 in 2–4 weeks of focused work.
- The hardware-shape simulator is an acceptable proxy for real devices for the MVP demo, with the constraint that the wire contract (§6) is the only thing that changes when real hardware lands.
- WHO conservative defaults for drinking-water thresholds are acceptable baseline values for v1; BSTI alignment is v2.
- 6 simulated devices on a single laptop is sufficient to demonstrate the workflow and the device contract.
- A reviewer can install Docker and follow a 5-minute README without prior context.
- **Two-layer metric schema.** v1 ships with a fixed set of six metrics (FR-2). A `MetricDefinition` registry (key, label, unit, type, default_severity, default_rule_template) is scaffolded in v1 — seeded with the six metrics, not empty — so that v2 can add metrics via configuration without a data migration. This is the only path by which future customer verticals can drop in; the device abstraction alone is not enough.

### 10.2 Dependencies

- **Cloud / hosting:** None for v1 (local Docker Compose). Production hosting deferred to v2.
- **Third-party services:** None for v1 (UI-only notifications). Real SMS / email / WhatsApp deferred.
- **Open source:** Vite, React, TanStack Query, Socket.IO, Express, Zod, Prisma, PostgreSQL 15, Tailwind, shadcn/ui, Recharts, Leaflet, react-i18next, Vitest, Playwright, node-cron, bcrypt, jsonwebtoken. All chosen under the constraint of "no microservices, no Kubernetes, no Redis, no message queue" (spec §9).
- **Internal:** A monorepo structure with `apps/web`, `apps/api`, `packages/simulator`, `packages/shared` (the shared package is the load-bearing piece that keeps the wire contract from drifting).

### 10.3 Constraints

- No microservices, Kubernetes, Redis, or message queue in v1 (spec §9).
- One Node process for api + ingestion + rules + alerts + workflow + scheduler (simulator is a separate process).
- Single JWT secret, no SSO/MFA.
- UI in English only; Bangla UI deferred to v2.
- Demo runs on a laptop; production deployment is v2.

---

## 11. Acceptance Criteria (v1 DoD)

The MVP is complete when **all** of the following hold (mirroring and extending spec §3 and §18):

1. **Onboarding SLA:** A new school, sensor, and rule can be created via the UI in under 5 minutes (NFR-9).
2. **Live monitoring SLA:** 6 simulated devices continuously update the dashboard in real time.
3. **Alert latency:** A contamination event reaches the dashboard as an alert in under 3 seconds (NFR-1).
4. **End-to-end workflow:** An alert auto-creates an incident, is assigned to a Technician, marked `Inspecting`, then `Safe | Unsafe | Monitoring`, and resolved — with the full audit trail visible.
5. **RBAC:** Operator cannot perform Admin actions; Technician sees only assigned incidents; negative cases covered by automated tests (FR-20/21).
6. **CSV export:** 30 days of readings can be exported per sensor.
7. **Comprehension SLA:** A reviewer who has never seen the project understands the workflow in under 60 seconds from the dashboard (NFR-8).
8. **All spec §11.2 screens implemented** and reachable from the executive dashboard (14 routes including `/admin/notifications`).
9. **Wire contract frozen** behind a `version: 1` header; both api and simulator consume the shared Zod schema.
10. **Rules engine** handles all three rule types in §7.2 with de-bouncing.
11. **Schema migrated**; the hourly retention/aggregation cron runs without error.
12. **Simulator** emits `__simulator_event` audit entries.
13. **Playwright E2E** passes the happy-path: login → see reading → trigger scenario → resolve incident.
14. **README** has a 5-minute quickstart; `.env.example` ships.
15. **Reproducible demo:** A fresh clone yields the DHAKA-SCHOOL-023 RisingTDS → UNSAFE → resolved flow reproducible by any reviewer **inside 15 minutes** (mirrors BO-1 and US-19).
16. **Simulator-as-real-client test (FR-33 seam proof):** An automated integration test verifies the simulator authenticates with a per-device JWT, is rate-limited to 1 reading / 2s (FR-10), reconnects with exponential backoff after a forced disconnect (FR-9), and has no back-door path into the readings table. The simulator's only data entry is the same WS ingestion handler a real device would use.
17. **MetricDefinition registry seeded (two-layer schema proof):** A startup-time check verifies the `MetricDefinition` table contains the six v1 metric rows (`ph`, `tds_ppm`, `turbidity_ntu`, `temp_c`, `chlorine_ppm`, `water_level_cm`) before the rules engine evaluates any reading. This is the visible artefact that v2 can add metrics via configuration, not via data migration.

---

## 12. Risks and Mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R-1 | Scope creeps back to the "everything" idea | High | Schedule slip, MVP never ships | Hard cutoff enforced: v2 backlog in spec §15 is a separate doc; any new ask defers to v2 BRD. |
| R-2 | Simulator wire contract drifts from intended real-hardware shape | Medium | Re-integration cost when hardware lands | The api and simulator consume a **shared Zod schema** in `packages/shared`. CI on every PR fails if either side modifies a wire-contract type without updating the other. Treated as a contract-review item every sprint. |
| R-3 | Rules engine complexity explodes | Medium | Time sink; v1 slips | Ship only the three rule types in §7.2; resist adding more in v1. |
| R-4 | Time-series storage costs blow up | Low (v1, 6 devices) / High (v2, scale) | Capacity surprise later | 30-day raw retention + 5-min aggregation cron; review at end of build before scaling. |
| R-5 | Bangla-speaking users cannot read the UI in v1 | Certain (deferred by design) | Accessibility / market-fit signal | Document as v2; preload a Bangla-capable font stack in Tailwind config and a `bn` locale scaffold in `react-i18next` so v2 is a content drop, not a refactor. |
| R-6 | Single Node process hits a wall at scale | Low (v1) / Inherent (v2) | Future re-architecture | §6 abstraction is the seam; do not entangle simulator with platform internals; keep the rules engine stateless wrt process. |
| R-7 | Bangladesh load-shedding breaks dev assumptions | Medium (realistic) | Demo reliability | Simulator `Offline` scenario; architecture test: 60s disconnect mid-incident must not lose state. |
| R-8 | Single JWT secret leaks | Low (v1, local demo) | Catastrophic (real deployment) | v1 constraint; v2 BRD mandates JWKS / RS256 + key rotation before any production rollout. |
| R-9 | Permission matrix regression | Medium | Security / workflow integrity | Automated negative-case tests for every matrix cell; PR-time lint check that any new endpoint declares its `(subject, action, resource)` triple. |
| R-10 | 2–4 week build window slips | High (common) | MVP doesn't ship; portfolio narrative weakens | Time-box each of the 8 vertical slices from §11 to 2–3 days; any slice that overruns triggers a scope-cut conversation, not a schedule-extension. Demo story (§14) is the must-have; everything else is should-have. |
| R-11 | Bus factor (single developer holds all knowledge) | Medium | Project becomes unmaintainable | All knowledge lives in the repo: README, three docs (spec / BRD / refinement), inline comments on non-obvious code, and an ADR log for decisions. No tribal knowledge. |
| R-12 | npm supply-chain compromise (transitive dependency attack) | Low (v1, local) / Medium (v2) | Build integrity, runtime exploit | `npm audit` runs in CI on every PR; lockfile is committed; dependencies are reviewed before additions. Production rollout deferred — not blocking v1 demo. |
| R-13 | Regulatory exposure (BSTI / Bangladesh data-protection) | Certain (deferred by design) | Legal/compliance gap if production rollout attempted on v1 code | v1 explicitly defers compliance (spec §15, Appendix B). The README must state "not for production use" prominently. Any future production BRD must include compliance as a non-negotiable first slice. |
| R-14 | Demo-day failure (Docker won't run on reviewer's machine; laptop battery dies mid-demo) | Medium (realistic) | Portfolio reviewer's 60-second comprehension SLA (NFR-8) fails | README quickstart is tested on a clean machine before every demo. Fallback: a recorded screencast of the demo is kept ready, plus a public hosted URL if budget allows. |

---

## 13. The 15-Minute Demo Story (the Portfolio Artefact)

The single most important deliverable from this project is not the codebase — it is the **reproducible demo**. This is the artefact a portfolio reviewer will judge the project on, and it is the test against which v1 ships or doesn't.

**Time budget:** 15 minutes from `git clone` to "incident resolved and audited." If a reviewer cannot reach step 10 inside 15 minutes, the demo story has failed. This is the operational form of the 60-second comprehension SLA (NFR-8) and the 5-minute onboarding SLA (NFR-9).

### The 10-step walkthrough

| # | Step | What the reviewer sees |
|---|------|------------------------|
| 1 | Clone the repo | Empty workspace |
| 2 | Run `docker compose up` | Postgres, api, web, simulator all come up healthy |
| 3 | Open the dashboard | DHAKA-SCHOOL-023 reporting healthy readings on a real-time chart, KPI cards green, map marker green |
| 4 | Open `/admin/simulator`, pick DHAKA-SCHOOL-023, scenario `RisingTDS`, click Start | Simulator starts ramping TDS by +20 ppm / 5s |
| 5 | Within seconds | An alert appears on the dashboard; an incident is auto-created and visible in `/incidents` |
| 6 | Log in as Operator | Acknowledge the incident; assign a Technician from the user list |
| 7 | Log in as Technician | Mark `Inspecting`; submit result `Unsafe` with a comment |
| 8 | Critical banner fires | All Admin sessions see a top-of-page red banner for 24h or until acknowledged |
| 9 | Log in as Operator | Review the Technician's submission; resolve (or reopen) the incident |
| 10 | Open `/audit` | See every transition — alert opened, incident auto-created, acknowledgement, assignment, status changes, resolution — with actor and timestamp |

### Why this is the test

- It exercises every layer: wire contract (FR-1–6), transport (FR-7–10), rules engine (FR-11–14), alerts + incidents (FR-15–19), RBAC (FR-20/21), audit log (FR-30), simulator (FR-33–36), and the dashboard comprehension SLA (NFR-8).
- It is reproducible on a fresh clone with no prior context.
- It is the only demo that matters. Every other screen in §11.2 exists to support this walkthrough.

### What "failed" looks like

| Symptom | Likely cause |
|---------|--------------|
| Docker won't start | README quickstart not tested on a clean machine → R-14 |
| Simulator connects but no readings appear | Wire contract drift between simulator and api → R-2 |
| Alert fires but no incident auto-created | Rules engine severity path broken → R-3 |
| Technician can see other Technicians' incidents | RBAC regression → R-9 |
| `/audit` shows nothing | Audit-log write path broken → verify FR-19 |
| Reviewer takes >15 min | One of the SLAs in §11 is unmet |

---

## 14. Approval and Sign-off

This BRD is approved when the following stakeholders agree that the requirements above accurately reflect the business intent and are achievable within the 2–4 week target:

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner |  |  |  |
| Tech Lead |  |  |  |
| Reviewer (portfolio) |  |  |  |

---

## Appendix A — Selected Requirements → Spec Cross-Reference

The matrix below traces the BRD's main functional sections back to the spec section they implement and the acceptance criterion they map to. It is not exhaustive: business objectives (§3), assumptions (§10.1), dependencies (§10.2), and risks (§12) are intentionally not in this table — they govern the project rather than implement a specific feature.

| BRD Section | Source in Spec | Mapped to DoD Item |
|-------------|----------------|---------------------|
| §6 Personas | §4 | §11.5 (RBAC) |
| §7 User Stories | §3, §4, §5, §7 | §11.1–§11.7 |
| §8.1 Device and telemetry | §6 | §11.9 |
| §8.2 Transport | §6.3 | §11.9 |
| §8.3 Rules engine | §7 | §11.10 |
| §8.4 Alerts and incidents | §5, §7 | §11.3, §11.4 |
| §8.5 Permissions | §4 | §11.5 |
| §8.6 Auth | §12 | §11.5 |
| §8.7 Notifications | §13 | §11.8 (route), §11.4 (workflow banner) |
| §8.8 Reporting and audit | §3.6, §18 | §11.6 (export), §11.4 (audit-trail-visible) |
| §8.9 Data retention | §8 | §11.11 |
| §8.10 Simulator | §10 | §11.2 (live devices), §11.12 (audit), §11.16 (seam test) |
| §9 NFRs | §3, §17 | §11.1, §11.2, §11.3, §11.7, §11.13 |

---

## Appendix B — v2 Backlog Candidates (for the next BRD)

Carried forward from spec §15 without modification:

- Real sensor hardware integration (MQTT, LoRaWAN, ESP32 firmware).
- Mobile application (Android / iOS).
- Bangla (bn) locale content.
- Multi-tenant data isolation across NGOs / municipalities.
- Audit-log immutability (hash chain, signed records).
- On-device cryptographic signing of telemetry frames.
- Time-series DB (TimescaleDB / ClickHouse).
- WebSocket horizontal scaling (Redis pub/sub) and BullMQ background-job queue.
- Real SMS (Grameenphone, Banglalink, Robi) and WhatsApp Business API integration.
- BSTI standards compliance, WHO water-quality alignment, Bangladesh data-protection law compliance.
- Sensor calibration management and per-firmware-version data lineage.
- Production deployment (TLS, monitoring, backups, key rotation, JWKS/RS256).

The v2 BRD will be written only after v1.0 ships and the v1 retrospective identifies which of these are highest-value to pursue.
