---
stepsCompleted: [1, 2, 2-elicitation, 3, 4]
inputDocuments:
  - docs/Surakkha-PRD.md
  - docs/Surakkha-BRD.md
  - docs/architecture.md
  - docs/Surakkha-idea-refined.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/EXPERIENCE.md
validation:
  step4_verdict: READY
  step4_optional_polish:
    applied:
      - explicit incident:updated emission line added to Story 4.5
      - NFR-2 tagged on Story 2.6 (dashboard input lag)
      - NFR-9 tagged on Story 1.2a (≤5-min onboarding affordances)
  advanced_elicitation_method_3_boundary_sweep:
    total_findings: 35
    applied_high_impact: 7
    deferred_low_impact: 6
    skipped_already_covered: 1
    applied_edges:
      - "1.4 JWT_SECRET missing/weak fail-fast on startup"
      - "2.2 seq=0 first frame + per-device rate cap independence"
      - "2.4 5K buffer cap eviction + __simulator_event audit row"
      - "3.6 alert dedup on existing (device,metric,severity) OPEN incident"
      - "4.5 concurrent acknowledge race → 409 + 'Acknowledged by {other}' toast"
      - "4.9 duplicate UNSAFE submit idempotency (one event, one row)"
      - "5.5 cron double-invocation skew lock + 'skipped_overlap' outcome"
  advanced_elicitation_method_4_hindsight_reflection:
    total_findings: 8
    applied: 8
    deferred: 0
    applied_changes:
      - split: "Story 1.2 → 1.2a (Tokens + Density) + 1.2b (Responsive Shell)"
      - merge: "Stories 2.4 + 2.5 → 2.4 (Simulator + Six Default Devices + Seven Scenarios)"
      - merge: "Stories 4.8 + 4.9 → 4.8 (Sticky SeverityBanner + RBAC)"
      - merge: "Stories 6.1 + 6.2 → 6.1 (Docker Compose + README Quickstart)"
      - move: "Story 3.8 → Epic 6 as 6.9 (Telemetry-to-Alert Latency Test)"
      - move: "Story 6.10 → Epic 1 as 1.10 (Single-Secret JWT Rotation Policy)"
      - drop: "Story 4.15 (Auto-Reopen split — clarification already in 4.11)"
      - reorder: "Story 1.6 stays at slot 6 (no change required — was already in forward position)"
    net_story_count: 56
  deferred_to_v2:
    - NFR-7 (per-frame crypto signing, JWKS/RS256, hash-chain audit)
    - NFR-10 (Bangla locale content)
---

# Surakkha — Epic Breakdown

## Overview

This document decomposes the requirements from the BRD, PRD, UX spine pair, refined idea, and architecture into implementable epics and stories for Surakkha — a water-safety monitoring and incident-management platform for Bangladeshi government primary schools. The wire contract is the seam between the api, the simulator, and the frontend; every cross-process contract lands in shared Zod schemas consumed by both sides. The MVP demonstrates one operational workflow: **Sensor → Alert → Incident → Assignment → Inspection → Resolution**, scoped to six simulated devices, four severity-mixed Kanban columns, and a 15-minute portfolio demo story.

## Requirements Inventory

### Functional Requirements

The 36 FRs (FR-1 through FR-36) below are authoritative from `docs/Surakkha-BRD.md` §8.1–§8.10. PRD §4 groups them by MoSCoW priority (P0=must, P1=should, P2=could, W=won't-have v1).

**FR-1.** Every device has a stable UUIDv4 `device_id` generated at factory provisioning; the `device_id` is referenced in every reading, event, and command, and persists across SIM/MAC changes.
**FR-2.** Telemetry frames MUST validate against the schema (device*id, ts, fw, seq, metrics with `ph`, `tds_ppm`, `turbidity_ntu`, `temp_c`, `chlorine_ppm`, `water_level_cm`). These six metrics are the v1 seed; the rules engine, charts, simulator, and tests know them by name, and the platform stores them in a `jsonb` blob so v2 metric additions require no data migration.
**FR-3.** Unknown fields MUST be ignored; missing required fields MUST cause a `400` response.
**FR-4.** Each device MUST transmit `server_received_at` (server time) separately from device `ts`, and clock-skew MUST be exposed to ops.
**FR-5.** Each frame MUST carry a monotonically increasing per-device `seq` counter; the server MUST detect dropped and reordered readings.
**FR-6.** Frames in v1 are unauthenticated at the frame level; authentication is at the transport layer via short-lived per-device JWT.
**FR-7.** Devices connect to the platform over WebSocket at `ws://<host>/ingest/{device_id}`.
**FR-8.** Auth is a short-lived JWT minted per device, rotated on simulator start (every process boot).
**FR-9.** Simulator MUST reconnect with exponential backoff (1s → 30s cap) on disconnect; up to 5,000 readings buffer in the simulator process and flush on reconnect.
**FR-10.** Server MUST enforce a per-device rate cap of 1 reading per 2 seconds; bursts MUST be rejected with `429`.
**FR-11.** Rules are JSON, stored per `device_id` (or globally when `device_id` is null), versioned, and audit-logged on change.
**FR-12.** v1 supports exactly three rule types: `instant` (operators `>=`, `>`, `<=`, `<`, `==`), `rate` (`delta_per_minute`), `absence` (`no_reading_for_seconds`).
**FR-13.** Severity is explicitly set by the rule, not inferred. The full v1.0 default threshold set is specified in BRD §8.3.1 (WHO/BSTI source of truth). Admins may override any rule per device; global rules (device_id IS NULL) are mutable via `/admin/thresholds`.
**FR-14.** Rules engine MUST support de-bouncing via `min_duration_seconds` (reading must be in violation this long before alert fires) and `hysteresis_seconds` (once cleared, must stay clear this long before re-firing), tracked per `(device, metric, severity)`.
**FR-15.** Threshold breach MUST produce an alert with severity (`info | warning | critical`), opened_at, acknowledged_at, cleared_at.
**FR-16.** Alerts of severity `warning` or `critical` MUST auto-create an incident linked to the alert and the school.
**FR-17.** Incident lifecycle follows the state machine: `OPEN → ACKNOWLEDGED → INSPECTING → (SAFE | UNSAFE | MONITORING) → RESOLVED`, with a `REOPENED` branch via Admin comment of `severity=critical` (RESOLVED → OPEN).
**FR-18.** Status `UNSAFE` MUST automatically raise a Critical notification banner to all Admins for 24 hours or until acknowledged. The 24-hour auto-dismiss is implemented but not tested in v1; the until-acknowledged dismissal is tested.
**FR-19.** Every state transition MUST be recorded in `IncidentEvent` with actor_user_id, type, payload, and timestamp.
**FR-20.** The permission matrix MUST be enforced on every endpoint as a `(subject, action, resource)` check. There is no implicit "Admin can do everything."
**FR-21.** Negative cases (Technician accessing other Technicians' incidents, Viewer creating an incident, Operator accessing the audit log) MUST return `403` and MUST be covered by automated tests.
**FR-22.** JWT (HS256) with 8-hour expiry, signed with `JWT_SECRET` env var.
**FR-23.** Login MUST issue access + refresh tokens; refresh token MUST be stored in an httpOnly cookie.
**FR-24.** Passwords MUST be hashed with bcrypt cost factor 12.
**FR-25.** v1 uses a single secret with no key rotation; JWKS / RS256 is a v2 requirement.
**FR-26.** v1 has no SSO or MFA; documented as a v2 item.
**FR-27.** v1 notifications are UI-only (toast + banner); no real SMS, email, or push.
**FR-28.** The platform MUST record every notification that \_would* have been sent to a `Notification` table, visible on `/admin/notifications`.
**FR-29.** Users with export permission MUST be able to download 30 days of readings for any sensor as CSV.
**FR-30.** All state changes, threshold changes, and simulator events MUST appear in a queryable audit log viewable only by Admin role.
**FR-31.** Raw readings older than 30 days MUST be aggregated into 5-minute mean/min/max rows and the raw rows deleted.
**FR-32.** An hourly cron MUST drive the retention/aggregation job.
**FR-33.** The simulator is a separate Node process that authenticates and connects via the same wire contract as a real device.
**FR-34.** The simulator MUST ship 6 default devices, one per school, each running one of 7 base scenarios (`Normal`, `RisingTDS`, `TurbiditySpike`, `ChlorineDrop`, `Offline`, `BatteryLow`, `RandomFailure`).
**FR-35.** Simulator JWTs MUST be issued with `aud=simulator` and read-only-equivalent scope, and MUST NOT be able to execute admin actions even if compromised.
**FR-36.** Simulator scenario controls MUST be exposed via an Admin-only `/admin/simulator` tab and MUST emit a `__simulator_event` audit entry on every state change.

### Non-Functional Requirements

The 15 NFRs (NFR-1 through NFR-15) below are authoritative from `docs/Surakkha-BRD.md` §9. PRD §4 surfaces the P0/P1 subsets (NFR-1, NFR-4, NFR-6, NFR-8, NFR-9, NFR-11, NFR-12, NFR-13, NFR-14, NFR-15 are P0; NFR-2 and NFR-5 are P1; NFR-3, NFR-7, NFR-10 are deferred/structural).

**NFR-1.** Performance — End-to-end alert latency (breach → alert visible on dashboard) MUST be under 3 seconds under nominal load (6 devices).
**NFR-2.** Performance — Dashboard UI MUST remain responsive (input lag under 100ms) with 6 live devices at 1 reading / 2s each.
**NFR-3.** Scalability (design) — The device contract is designed as the seam for v2 horizontal scaling (a future pub/sub layer). v1's single-process architecture supports the 6-device demo and is expected to support 10–100 devices without redesign; actual capacity is not load-tested in v1.
**NFR-4.** Reliability — The platform MUST tolerate a 60-second disconnect mid-incident without losing state. The simulator MUST include an `Offline` scenario that exercises this.
**NFR-5.** Reliability — Simulator MUST buffer up to 5,000 readings and flush on reconnect without loss.
**NFR-6.** Security — All endpoints MUST enforce the permission matrix; JWTs MUST be validated on every request; passwords MUST use bcrypt cost 12.
**NFR-7.** Security (v2 deferred) — Per-frame cryptographic signing, JWKS/RS256, audit-log immutability via hash chains.
**NFR-8.** Usability — A reviewer who has never seen the project MUST understand the workflow within 60 seconds from the dashboard.
**NFR-9.** Usability — A school (school row, sensors, rules, primary contact) MUST be onboardable in under 5 minutes via the UI.
**NFR-10.** Localisability (deferred) — v1 ships English-only with a translation file structure and Tailwind tokens ready for Bangla fonts (locale content v2).
**NFR-11.** Operability — The platform MUST be reproducible locally with a single `docker compose up` plus a 5-minute README quickstart.
**NFR-12.** Test coverage — Backend MUST target 70% line coverage; frontend 50%. Playwright MUST cover the happy path: login → see reading → trigger scenario → resolve incident.
**NFR-13.** Maintainability — Lint and format MUST be enforced (ESLint + Prettier); type-safety MUST be end-to-end via shared Zod schemas consumed by both api and simulator.
**NFR-14.** Compatibility — The wire contract MUST be frozen behind a `version: 1` header and treated as a contract review item every sprint.
**NFR-15.** Deployment — v1 deployment MUST be a single Docker Compose file with three services: web (Nginx-served Vite build), api (Node 20), db (Postgres 15 with volume-mounted data).

### Additional Requirements

These come from `docs/architecture.md` and are technical requirements that bind implementation:

- **AR-1 (Starter template).** The architecture document does NOT bind a specific starter template; this is greenfield. The recommended paved path is a Node 20 monorepo (`packages/api`, `packages/web`, `packages/simulator`, `packages/shared`) with a Postgres 15 backend and a Vite 5 frontend, shipped via a single `docker-compose.yml` per NFR-15. The web layer uses shadcn/ui + Tailwind per UX stack.
- **AR-2 (Wire contract freeze).** The telemetry frame wire contract is `version: 1` and frozen (architecture I-1, I-11). Both api and simulator consume the same Zod schema in `packages/shared/src/telemetry.ts`. Any change to it is a contract bump (architecture §8.4).
- **AR-3 (Rate limit semantics).** Server enforces `1 reading / 2s` per device (I-2). 429 responses carry `Retry-After`; the simulator MUST respect it and buffer (no silent drop). Reorder/drop detection via monotonic per-device `seq` counter (I-1 + FR-5).
- **AR-4 (JWT auth contracts).** `iss: surakkha-api`; `aud: device` (24h) or `aud: simulator` (1h); HS256, single `JWT_SECRET` (I-3, I-13). Simulator tokens carry `scope: telemetry:write` only and cannot reach admin endpoints even if leaked (I-4).
- **AR-5 (Deterministic processing order per frame).** Validate → auth check → rate check → seq/drop check → persist → rule evaluation → alert emission → state-machine update → audit append → socket broadcast. Architecture §3.2 mandates this order.
- **AR-6 (Rule types locked to v1 set).** Rules engine supports exactly `instant`, `rate`, `absence` (I-5). Severity is set by the rule, not inferred (I-6). Defaults are loaded from `prisma/seed.ts` per BRD §8.3.1 — server does NOT compute defaults at runtime (I-8).
- **AR-7 (De-bouncing).** Every rule carries `min_duration_seconds` and `hysteresis_seconds`; tracked per `(device, metric, severity)`. Range rules are expressed as two single-sided rules because v1's `instant` operators don't support `between` (BRD §8.3.1).
- **AR-8 (Incident state machine authoritative).** The 7-state machine in architecture §5.1 is the source of truth: `OPEN → ACKNOWLEDGED → INSPECTING → {SAFE | UNSAFE | MONITORING} → RESOLVED → (REOPENED via Admin comment of severity=critical)`. Each transition records an `IncidentEvent`. Invalid transitions return `409 invalid_state_transition` and write a `__invalid_transition_attempt` audit entry.
- **AR-9 (Kanban columns are derived).** Architecture §5.1.1 documents the 4-column severity-mixed Kanban view as a derived projection over the 7-state machine — Kanban state is recomputed on every `incident.state_changed` socket event, not stored separately.
- **AR-10 (RBAC enforcement middleware).** Single source: `packages/api/src/middleware/authorize.ts` (architecture §8.3). Runs after auth, before handler. Failed check → `403 forbidden` with `{error, required_role}` body and audit entry. **The full RBAC matrix (`docs/architecture-appendix-rbac.md`) is to be generated by this workflow as a load-bearing input to the auth epic** — it does not yet exist.
- **AR-11 (WebSocket event payloads).** `reading:new`, `alert:opened`, `alert:acknowledged`, `incident:updated`, `incident:state_changed`, `notification:critical` (architecture §3.5). TanStack Query is invalidated per event.
- **AR-12 (Simulator is real-client).** Same `ws://<host>/ingest/{device_id}` path as a real device (I-12). No back-door endpoints. Reads only what the wire contract exposes (I-4).
- **AR-13 (Aggregations & retention).** `ReadingAggregate` table (5-minute mean/min/max) populated by an hourly cron (architecture §5 + BRD FR-31/FR-32). v1 cron caps at 10,000 rows per run (I-15).
- **AR-14 (Deployment shape).** `docker-compose.yml` with three services (web, api, simulator, db) — note architecture uses four services (I-9 + NFR-15 reconcile as: web / api / simulator / db). Single Postgres volume for persistence.
- **AR-15 (v1 operational constraints, not durable).** Single Node process for api + ingestion + rules + alerts + workflow + cron (I-9); Postgres only, no Redis/MQ (I-10); HS256 single secret (I-13); plain `ws://`, no mTLS (I-14); cron-driven retention (I-15). These are deliberate v1 simplifications and may be relaxed in v2 without a contract bump.

### UX Design Requirements

UX Design Requirements are extracted from the bmad-ux spine pair (`DESIGN.md` + `EXPERIENCE.md`) for the run `ux-Surakkha-2026-08-20` (final 2026-08-20). Each UX-DR must be specific enough to generate a story with testable acceptance criteria.

- **UX-DR-1 (Saturated severity tokens).** Implement the severity palette: each severity (`healthy`, `warning`, `critical`, `offline`) carries `value` (border/KPI stripe), `text` (label), `fill` (vivid marker/KPI icon/banner bolt), `bg` (pills/soft fill), and `glow` (rgba α0.2 for shadows). Tokens are registered in Tailwind `theme.extend` and consumed via shadcn/ui wrappers. Critical surface is saturated red `#DC2626 / fill #EF4444`; warning is amber `#D97706 / fill #F59E0B`; healthy is calmer green `#1F9D55 / fill #16A34A`. (DESIGN.md Colors + tokens.)
- **UX-DR-2 (Critical-first visual hierarchy).** KPIs / LiveReadingRows / MetricCards use a 4px critical left border + 3px inner + 8px outer critical glow + continuous 1500ms pulse; warning uses 2px + 2px glow; healthy uses 3px calm. KPI numerals are 40px (44px critical). Card depth = `elevation.card` (layered shadow `0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)`). (DESIGN.md Elevation, KPI, LiveReadingRow.)
- **UX-DR-3 (Dark sidebar).** Sidebar surface uses `color.neutral.sidebar #0F172A` with light text (`#CBD5E1` inactive, `#FFFFFF` active). Active item gets a `aria-current="page"` highlight in `#1E293B` and a brand-tinted icon (`#38BDF8`). (DESIGN.md Sidebar row.)
- **UX-DR-4 (Primary gradient brand).** Brand mark and login hero use `color.primary_gradient` `linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)`. Login is split-screen at ≥1024px (gradient hero left, form right) and collapses to form-only below 1024px. (DESIGN.md Brand & Style, Layout & Spacing.)
- **UX-DR-5 (Severity banner sticky + persistent).** Admin-only `SeverityBanner` shows across all routes when an UNSAFE result is submitted. Sticky under the topbar with 4px top + 4px bottom critical border, 24px outer glow (`elevation.banner_critical`), 200ms fade-in. Dismisses on acknowledge OR after 24h. (DESIGN.md SeverityBanner + banner tokens; EXPERIENCE.md F3.)
- **UX-DR-6 (Live-update pulse + critical pulse distinction).** Two distinct pulses: `motion.live_pulse_ms 1200` outline glow per socket update, transient; `motion.critical_pulse_ms 1500` continuous pulse on critical KPI / LiveReadingRow / SeverityBanner as the persistent severity signal. Map marker halos pulse at `motion.pin_pulse_ms 2000`. (DESIGN.md Elevation & Depth, KPI; EXPERIENCE.md Live update State Pattern.)
- **UX-DR-7 (prefers-reduced-motion compliance).** Under `prefers-reduced-motion: reduce`, the continuous critical pulse, the map-pin pulse, and the banner fade-in are all disabled. The 1200ms per-update glow collapses to a single instant frame but is preserved (it's a transient affordance, not continuous). Severity is still conveyed by colour + text + icon. (DESIGN.md Do's and Don'ts; EXPERIENCE.md Prefer reduced motion State Pattern.)
- **UX-DR-8 (Comprehension aids).** Permanent `LegendStrip` (Healthy/Warning/Critical pills) and `SeverityShowcase` (three side-by-side cards explaining the severity vocabulary) appear on the dashboard. First-login `WalkthroughOverlay` runs a 3-step coach-mark cycle and persists a "seen" flag in user prefs. (DESIGN.md Components; EXPERIENCE.md F7.)
- **UX-DR-9 (Severity-mixed Kanban).** `/incidents` Kanban has exactly 4 columns: `Open · Critical`, `Open · Warning`, `Acknowledged`, `Resolved`. The 4 columns are a derived projection over the 7-state machine (architecture §5.1.1). Cards show id + severity + age + assignee; critical fresh cards get full-colour treatment + 1.2° tilt + pulse + a `New` badge. Drag is disabled in v1. (DESIGN.md KanbanColumn / KanbanCard; EXPERIENCE.md IA + KanbanColumn/KanbanCard Component Pattern.)
- **UX-DR-10 (NotificationBell + Notification log).** Topbar bell dropdown renders notifications with severity dot + timestamp; unread badge in `color.primary` (carried open question: switch to critical-tinted at high counts). `Notification` rows also surface on `/admin/notifications`. (DESIGN.md NotificationBell; EXPERIENCE.md NotificationBell Component Pattern.)
- **UX-DR-11 (Connection state + offline UX).** When the WebSocket is offline, the dashboard renders its last-known data; a top-of-page `Reconnecting…` banner appears; API-bound actions are disabled with tooltip "Unavailable while offline. Showing last-known data." Socket reconnects every 5s with exponential backoff to 30s. (EXPERIENCE.md Offline State Pattern.)
- **UX-DR-12 (401 refresh flow).** API `401` → TanStack Query interceptor attempts a single refresh on the refresh-token httpOnly cookie; on success the original request retries once, on failure the user is redirected to `/login` with the current URL preserved as `?next=`. Socket `401 token_expired` reconnects with a freshly-minted token without dropping the UI. (EXPERIENCE.md 401 refresh State Pattern.)
- **UX-DR-13 (RBAC denied state).** Role-lacking nav items are hidden entirely (no disabled-with-tooltip in v1). Direct URL hits to a forbidden route render a full-page empty state: "You don't have access to this page. Contact an Admin." with a link back to `/dashboard`. (EXPERIENCE.md RBAC denied State Pattern.)
- **UX-DR-14 (Tech-filtered Kanban view).** A Technician's `/incidents` view filters to incidents where they are the assignee (FR-21; EXPERIENCE.md KanbanColumn/KanbanCard, F5 Key Flow).
- **UX-DR-15 (Voice discipline in component copy).** All in-product strings use calm, factual, brief register: no exclamation marks, no marketing copy. Examples: "TDS is 312 ppm. Threshold is 300 ppm.", "Acknowledged at 10:42 by Rahim.", "Reconnecting…", "Simulator disabled. Set SIMULATOR_SECRET." (DESIGN.md voice; EXPERIENCE.md Voice and Tone.)
- **UX-DR-16 (Accessibility floor).** WCAG 2.1 AA, 4.5:1 contrast minimum, severity always colour + text + icon, full keyboard reachability with visible focus rings (primary 2px / 2px offset), `aria-current="page"`, `aria-live="polite"` on live readings region, `role="status"` on KPI updates, semantic HTML (`<main> / <nav> / <aside> / <table>`). Reduced-motion obligations per UX-DR-7. No screen-reader certification target in v1. (EXPERIENCE.md Accessibility Floor.)
- **UX-DR-17 (Theme + i18n scaffold).** Light + dark themes honour system preference (`theming.default: system`); no manual toggle in v1. Locale is `en` active, `bn` scaffolded; Noto Sans Bengali fallback registered in the fontFamily tokens for a v2 content drop. (DESIGN.md theming + type tokens.)
- **UX-DR-18 (Comfortable density + responsive shell).** Default density is comfortable: card padding 20px, row padding 12px, 10px card radius. Sidebar 240px on ≥1024px collapses to a topbar hamburger below. Canvas padding 24/16/12 by breakpoint. (DESIGN.md Density, Layout & Spacing.)

### FR Coverage Map

FR-1 → Epic 2 (Devices & Telemetry) — UUIDv4 device identity
FR-2 → Epic 2 (Devices & Telemetry) — six-metric telemetry schema
FR-3 → Epic 2 (Devices & Telemetry) — unknown/missing field handling
FR-4 → Epic 2 (Devices & Telemetry) — `server_received_at` separation
FR-5 → Epic 2 (Devices & Telemetry) — monotonic per-device `seq`
FR-6 → Epic 2 (Devices & Telemetry) — JWT at transport, not frame
FR-7 → Epic 2 (Devices & Telemetry) — WebSocket `/ingest/{device_id}`
FR-8 → Epic 2 (Devices & Telemetry) — short-lived per-device JWT, rotated on simulator boot
FR-9 → Epic 2 (Devices & Telemetry) — exponential backoff + 5K buffer + flush
FR-10 → Epic 2 (Devices & Telemetry) — 1 reading / 2s rate cap, 429
FR-11 → Epic 3 (Rules & Alerts) — JSON rules, versioned, audit-logged
FR-12 → Epic 3 (Rules & Alerts) — instant / rate / absence rule types
FR-13 → Epic 3 (Rules & Alerts) — severity explicit; defaults from BRD §8.3.1
FR-14 → Epic 3 (Rules & Alerts) — `min_duration_seconds` + `hysteresis_seconds` per (device, metric, severity)
FR-15 → Epic 3 (Rules & Alerts) — alert with severity, opened_at, ack_at, cleared_at
FR-16 → Epic 4 (Incidents & Workflow) — warning/critical alert → incident
FR-17 → Epic 4 (Incidents & Workflow) — incident state machine (7 states + REOPENED branch)
FR-18 → Epic 4 (Incidents & Workflow) — UNSAFE → Critical banner 24h / until acknowledged
FR-19 → Epic 4 (Incidents & Workflow) — `IncidentEvent` per transition
FR-20 → Epic 1 (Auth & User Management) — RBAC `(subject, action, resource)` middleware
FR-21 → Epic 1 (Auth & User Management) — negative RBAC cases covered by tests
FR-22 → Epic 1 (Auth & User Management) — JWT HS256, 8h expiry
FR-23 → Epic 1 (Auth & User Management) — access + refresh token + httpOnly cookie
FR-24 → Epic 1 (Auth & User Management) — bcrypt cost 12
FR-25 → Epic 1 (Auth & User Management) — single JWT secret, no rotation v1
FR-26 → Epic 1 (Auth & User Management) — no SSO/MFA in v1 (deferred to v2)
FR-27 → Epic 4 (Incidents & Workflow) — UI-only notifications (toast + banner)
FR-28 → Epic 4 (Incidents & Workflow) owns the `Notification` schema + writer; Epic 5 (Reporting & Audit) owns the `/admin/notifications` read view
FR-29 → Epic 5 (Reporting & Audit) — CSV export of 30 days of readings
FR-30 → Epic 5 (Reporting & Audit) — audit log of state/threshold/simulator events
FR-31 → Epic 5 (Reporting & Audit) — `ReadingAggregate` (5-min mean/min/max) cron
FR-32 → Epic 5 (Reporting & Audit) — hourly cron drives retention/aggregation
FR-33 → Epic 2 (Devices & Telemetry) — simulator is a separate Node process on the same wire contract
FR-34 → Epic 2 (Devices & Telemetry) — 6 default devices, 7 scenarios
FR-35 → Epic 2 (Devices & Telemetry) — simulator JWT `aud=simulator`, scope `telemetry:write`
FR-36 → Epic 2 (Devices & Telemetry) — `/admin/simulator` Admin-only, `__simulator_event` audit entries

NFR-1 → Epic 6 (Cross-cutting NFRs) — <3s alert latency SLA
NFR-2 → Epic 6 (Cross-cutting NFRs) — dashboard input lag <100ms
NFR-3 → Epic 6 (Cross-cutting NFRs) — single-process scalability seam
NFR-4 → Epic 6 (Cross-cutting NFRs) — 60s disconnect tolerance
NFR-5 → Epic 2 (Devices & Telemetry) — simulator 5K buffer
NFR-6 → Epic 1 (Auth & User Management) — RBAC + JWT + bcrypt enforced
NFR-7 → deferred (v2)
NFR-8 → Epic 6 (Cross-cutting NFRs) — 60s dashboard comprehension SLA
NFR-9 → Epic 6 (Cross-cutting NFRs) — ≤5-min school onboarding
NFR-10 → deferred (v2 Bangla locale)
NFR-11 → Epic 6 (Cross-cutting NFRs) — `docker compose up` + 5-min README
NFR-12 → Epic 6 (Cross-cutting NFRs) — backend 70% / frontend 50% coverage + Playwright
NFR-13 → Epic 2 (Devices & Telemetry) — shared Zod schemas + ESLint/Prettier
NFR-14 → Epic 2 (Devices & Telemetry) — wire contract `version: 1` header
NFR-15 → Epic 6 (Cross-cutting NFRs) — single Docker Compose (web/api/simulator/db)

AR-1 → Epic 2 (Devices & Telemetry) — monorepo starter
AR-2 → Epic 2 (Devices & Telemetry) — wire contract v1 frozen
AR-3 → Epic 2 (Devices & Telemetry) — rate-limit + 429 semantics
AR-4 → Epic 1 (Auth & User Management) — JWT claim contract
AR-5 → Epic 2 (Devices & Telemetry) — deterministic frame processing order
AR-6 → Epic 3 (Rules & Alerts) — rule types + severity-from-rule
AR-7 → Epic 3 (Rules & Alerts) — de-bouncing contract
AR-8 → Epic 4 (Incidents & Workflow) — incident state machine
AR-9 → Epic 4 (Incidents & Workflow) — Kanban 4-column derived projection
AR-10 → Epic 1 (Auth & User Management) — RBAC middleware + matrix
AR-11 → Epic 4 (Incidents & Workflow) — WebSocket event payloads
AR-12 → Epic 2 (Devices & Telemetry) — simulator = real client (no back-door)
AR-13 → Epic 5 (Reporting & Audit) — `ReadingAggregate` cron
AR-14 → Epic 6 (Cross-cutting NFRs) — Docker Compose deployment shape
AR-15 → Epic 6 (Cross-cutting NFRs) — v1 operational constraints register

UX-DR-1 → Epic 1 (Auth & User Management) — saturated severity tokens
UX-DR-2 → Epic 1 (Auth & User Management) — critical-first visual hierarchy
UX-DR-3 → Epic 1 (Auth & User Management) — dark sidebar
UX-DR-4 → Epic 1 (Auth & User Management) — primary gradient + login split-screen
UX-DR-5 → Epic 4 (Incidents & Workflow) — sticky SeverityBanner
UX-DR-6 → Epic 1 (Auth & User Management) — live-update vs critical pulse distinction
UX-DR-7 → Epic 6 (Cross-cutting NFRs) — `prefers-reduced-motion` compliance
UX-DR-8 → Epic 6 (Cross-cutting NFRs) — comprehension aids (LegendStrip, SeverityShowcase, WalkthroughOverlay)
UX-DR-9 → Epic 4 (Incidents & Workflow) — 4-column severity-mixed Kanban
UX-DR-10 → Epic 4 (Incidents & Workflow) — NotificationBell + log (read); Epic 5 (Reporting & Audit) — `/admin/notifications` view (FR-28 schema lives in Epic 4)
UX-DR-11 → Epic 2 (Devices & Telemetry) — connection-state + offline UX
UX-DR-12 → Epic 1 (Auth & User Management) — 401 refresh flow
UX-DR-13 → Epic 1 (Auth & User Management) — RBAC denied state (hidden nav + 403 page)
UX-DR-14 → Epic 4 (Incidents & Workflow) — Technician-filtered Kanban
UX-DR-15 → Epic 1 (Auth & User Management) — voice discipline in component copy
UX-DR-16 → Epic 6 (Cross-cutting NFRs) — accessibility floor (WCAG 2.1 AA)
UX-DR-17 → Epic 1 (Auth & User Management) — theme + i18n scaffold
UX-DR-18 → Epic 1 (Auth & User Management) — comfortable density + responsive shell

## Step 0 — Foundation Seam (pre-epic)

Step 0 is not an epic. It establishes the **shared package** that every epic imports from but no epic owns. It is the seam that lets the wire contract (architecture I-1, NFR-14), the type-safety guarantee (NFR-13), the simulator-as-real-client invariant (AR-12, I-12), and the cross-epic socket-event contracts (AR-11) all be enforced in one place.

**`packages/shared` contents:**

| File               | Defines                                                                                                                                                                               | Why foundation                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---- | ------ | ---------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `src/telemetry.ts` | Zod schema for the `version: 1` telemetry frame (FR-2, AR-2). Metric type/range validation per architecture §3.2.                                                                     | Both api and simulator import this; a contract bump requires editing only this file.      |
| `src/auth.ts`      | JWT claim shape (`iss: surakkha-api`, `aud: device                                                                                                                                    | simulator`, `scope`), the access/refresh token DTOs (FR-22, FR-23, AR-4).                 | Epic 1's middleware and Epic 2's simulator both type-check against the same shape. |
| `src/events.ts`    | WebSocket event payloads (`reading:new`, `alert:opened`, `alert:acknowledged`, `incident:updated`, `incident:state_changed`, `notification:critical`) per architecture §3.5.          | Backend emitters (Epic 4) and frontend listeners (Epic 2) agree on shape by construction. |
| `src/incident.ts`  | Incident state enum (`OPEN                                                                                                                                                            | ACKNOWLEDGED                                                                              | INSPECTING                                                                         | SAFE | UNSAFE | MONITORING | RESOLVED`) per architecture §5.1. | One source of truth for the state machine — no epic renumbers or renames a state. |
| `src/rbac.ts`      | Role enum, action enum, resource enum, and the `(subject, action, resource)` predicate (architecture §8.3) — imported by Epic 1's middleware and by every other epic's handler tests. | Tests on this file catch every RBAC regression Epic 1 enables.                            |

**Cross-cutting rule (binding for every epic):** No epic may `import type` from another epic's directory. All cross-epic types live in `packages/shared/src` only. The AI coding agent is explicitly bound by this rule; any candidate code that violates it is wrong, regardless of what the agent's pattern matching suggests.

**Sub-steps:**

| ID    | Sub-step                                                                                                                                                                                                                                                                                                                                                                                                                                       | Done when                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| F-0.1 | Monorepo scaffold (Vite + React + TypeScript + Tailwind + shadcn-ui frontend _(note: shadcn-ui was on the original plan but the implementation shipped hand-rolled Tailwind primitives on the `tailwind.config.ts` token system — no Radix, CVA, or lucide installed)_, Node 20 + Express + Prisma backend, separate simulator process, Postgres 15 — `packages/web`, `packages/api`, `packages/simulator`, `packages/shared`, `packages/db`). | `pnpm install && pnpm -r build` succeeds on a clean clone.                                                    |
| F-0.2 | `packages/shared` skeleton with the five files above (stub Zod schemas + enums).                                                                                                                                                                                                                                                                                                                                                               | `pnpm -F shared test` runs (even if no tests).                                                                |
| F-0.3 | ESLint + Prettier config at the repo root with the per-package inheritance.                                                                                                                                                                                                                                                                                                                                                                    | `pnpm lint` succeeds.                                                                                         |
| F-0.4 | Docker Compose with the four services (web, api, simulator, db).                                                                                                                                                                                                                                                                                                                                                                               | `docker compose up` brings everything up; `docker compose down -v` cleans up.                                 |
| F-0.5 | README quickstart (NFR-11).                                                                                                                                                                                                                                                                                                                                                                                                                    | A fresh user reaches the demo state in under 15 minutes via `git clone && docker compose up && README steps`. |

**Why this isn't Epic 1's Story 1.1:** Step 0 produces no user-visible functionality. Per the bmad-advanced-elicitation Pre-mortem + Assumption Audit (A2, A7), if it lives inside Epic 1, Epic 1's start has to wait for shared types to be defined _while_ it's already writing JWTs — the right types never get a chance to be canonical because they didn't exist before auth code did. Step 0 is the foundation seam; Epic 1 consumes from it.

## Epic List

### Epic 1: Auth & User Management

Operators, Technicians, Admins, and Viewers can sign in, see only what their role allows, and have their actions audited. The login shell, role-aware nav, the global RBAC middleware, the foundation design tokens, and the responsive layout shell all land here so every later epic ships against a known access boundary and a known visual language.
**FRs covered:** FR-20, FR-21, FR-22, FR-23, FR-24, FR-25, FR-26
**ARs covered:** AR-4, AR-10
**UX-DRs covered:** UX-DR-1, UX-DR-2, UX-DR-3, UX-DR-4, UX-DR-6, UX-DR-12, UX-DR-13, UX-DR-15, UX-DR-17, UX-DR-18
**Stories:** 1.1, 1.2a, 1.2b, 1.3–1.10 (11 stories)

### Epic 2: Devices & Telemetry

Operators can see live telemetry from six simulated devices, with a stable device identity, the wire-contract seam, and a working simulator that emits realistic frames. The dashboard shell, the saturated severity KPI band, the live readings table, and the map are all wired to the same socket stream so the demo story starts here.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-33, FR-34, FR-35, FR-36
**ARs covered:** AR-1, AR-2, AR-3, AR-5, AR-12
**NFRs covered:** NFR-5, NFR-13, NFR-14
**UX-DRs covered:** UX-DR-11
**Stories:** 2.1–2.9 (9 stories)

### Epic 3: Rules & Alerts

Operators can see when a sensor reading breaches a threshold, with de-bounced alerts that auto-create incidents. The rules engine supports `instant`, `rate`, and `absence` rule types; defaults are seeded from BRD §8.3.1; severity is set by the rule, not inferred; alerts are de-bounced per `(device, metric, severity)`.
**FRs covered:** FR-11, FR-12, FR-13, FR-14, FR-15
**ARs covered:** AR-6, AR-7
**Stories:** 3.1–3.7 (7 stories)

### Epic 4: Incidents & Workflow

Operators, Technicians, and Admins can move an incident through the full state machine, see the severity banner for UNSAFE results, and resolve or reopen with a full audit trail. The 4-column severity-mixed Kanban is the day-to-day surface; the underlying 7-state machine governs transitions and remains auditable. Epic 4 also owns the `Notification` row writer (FR-28 schema side) and the card-action-affordance contract that Epic 2's read-only incident preview consumes.
**FRs covered:** FR-16, FR-17, FR-18, FR-19, FR-27; FR-28 (schema + writer only — read view lives in Epic 5)
**ARs covered:** AR-8, AR-9, AR-11
**UX-DRs covered:** UX-DR-5, UX-DR-9, UX-DR-10 (bell + log writes), UX-DR-14
**Stories:** 4.1–4.13 (13 stories)

### Epic 5: Reporting & Audit

Admins and Operators can export readings, see the notification log, browse the audit trail, and trust that data older than 30 days has been aggregated into 5-minute mean/min/max rows. The hourly retention cron is the seam for v2 to swap in a continuous aggregation worker. Epic 5 owns the read side of `Notification` (FR-28 view side); the writer and schema land in Epic 4 because that's where `incident:state_changed` events emit notifications.
**FRs covered:** FR-28 (read view only), FR-29, FR-30, FR-31, FR-32
**ARs covered:** AR-13
**Stories:** 5.1–5.6 (6 stories)

### Epic 6: Cross-cutting NFRs

The non-functional backbone: Docker Compose deployment, README quickstart, lint/format, test coverage, observability, accessibility audit, `prefers-reduced-motion` enforcement, comprehension aids (LegendStrip / SeverityShowcase / WalkthroughOverlay), the operational constraints register that prevents the AI coding agent from mistaking v1 simplifications for durable decisions, and the cross-epic shared-package rule. The visual layer's foundation tokens and the responsive shell ship in Epic 1 so they don't have to ship last.
**FRs covered:** (no new FRs; this epic realises NFRs)
**NFRs covered:** NFR-1, NFR-2, NFR-3, NFR-4, NFR-8, NFR-9, NFR-11, NFR-12, NFR-15
**ARs covered:** AR-14, AR-15
**UX-DRs covered:** UX-DR-7, UX-DR-8, UX-DR-16
**Stories:** 6.1–6.9 (9 stories)

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic 1: Auth & User Management

Operators, Technicians, Admins, and Viewers can sign in, see only what their role allows, and have their actions audited. The login shell, role-aware nav, and the global RBAC middleware all land here so every later epic ships against a known access boundary.

**Goal:** A reviewer can sign in as any of the four seeded users, see role-appropriate nav items, and confirm that direct URL hits to forbidden routes render the RBAC denied state. Every failed authorisation attempt is written to the audit log.

### Story 1.1: RBAC Matrix Lock

As an architect,
I want the full role × action × resource matrix documented as `docs/architecture-appendix-rbac.md`,
So that Epic 1's middleware and every other epic's handler tests have one canonical, machine-readable authority source.

**Acceptance Criteria:**

**Given** the architecture §8.3 lists subjects (Admin, Operator, Technician, Viewer), actions, and resources but no consolidated matrix exists yet
**When** the agent writes `docs/architecture-appendix-rbac.md`
**Then** the file contains a Markdown table with one row per (role, action, resource) tuple and a `yes/no` cell
**And** every endpoint listed in `docs/architecture.md` appears as at least one row in the matrix

**Given** the matrix table is written
**When** a developer opens the file
**Then** `packages/shared/src/rbac.ts` re-exports the matrix as a typed TypeScript constant, not as duplicated prose
**And** any future RBAC drift is detected by a CI lint that fails when handler code references an action not in the matrix

**Given** an Admin row exists for every action
**When** the matrix is reviewed
**Then** no row reads "implicit admin can do everything" — every grant is explicit
**And** negative tests in Story 1.8 reference this file by section number

**Covers:** AR-10.

### Story 1.2a: Design Tokens + Density

As a developer,
I want the saturated severity palette, the dark sidebar tokens, the primary gradient, the typography scale, and the comfortable density baseline registered in Tailwind and the shared component layer,
So that every later epic ships against a known visual language and known spacing rhythm.

**Acceptance Criteria:**

**Given** the DESIGN.md tokens are defined
**When** the agent configures `tailwind.config.ts`
**Then** `theme.extend.colors.severity.{healthy,warning,critical,offline}` exposes `value`, `text`, `fill`, `bg`, and `glow` for each severity
**And** `color.primary_gradient` resolves to `linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)`

**Given** the tokens are registered
**When** the agent renders a sample severity pill
**Then** the pill's computed `background-color` matches the `fill` token for that severity
**And** the pill's text contrast ratio against its background is ≥ 4.5:1

**Given** the design system is in place
**When** the developer inspects a card on the dashboard
**Then** its padding is 20px, its radius is 10px, and its elevation matches `elevation.card` (`0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)`)

**Covers:** UX-DR-1, UX-DR-2, UX-DR-3, UX-DR-4, UX-DR-15, UX-DR-17, UX-DR-18, NFR-9.

### Story 1.2b: Responsive Layout Shell

As a developer,
I want the sidebar/topbar shell rendered with the documented breakpoint behaviour,
So that every later epic has a known canvas to lay out against.

**Acceptance Criteria:**

**Given** viewport width is ≥ 1024px
**When** the authenticated layout mounts
**Then** a 240px dark sidebar (`color.neutral.sidebar #0F172A`) is visible on the left
**And** a topbar with the brand mark and primary gradient appears at the top

**Given** viewport width is < 1024px
**When** the authenticated layout mounts
**Then** the sidebar collapses to a hamburger button in the topbar
**And** opening the hamburger reveals the same nav items in a drawer

**Given** viewport width is between 768px and 1023px
**When** the canvas renders
**Then** horizontal padding is 16px
**And** below 768px, padding is 12px

**Covers:** UX-DR-18.

### Story 1.3: Login Shell

As a user,
I want to see a calm, split-screen login screen with a gradient hero and a sign-in form,
So that I can sign in quickly and understand I am in the right product.

**Acceptance Criteria:**

**Given** an unauthenticated visitor navigates to `/login` on a viewport ≥ 1024px
**When** the login shell renders
**Then** the left half shows the primary gradient hero with the brand mark and tagline
**And** the right half shows email + password fields and a "Sign in" button

**Given** the viewport is < 1024px
**When** the login shell renders
**Then** the gradient hero is hidden
**And** the form fills the viewport width with 24/16/12 canvas padding per breakpoint

**Given** the user enters an email and a password
**When** they click "Sign in"
**Then** the form submits to the auth endpoint established in Story 1.4
**And** the button is disabled with the label "Signing in…" while the request is in flight

**Given** any rendered string in the login shell
**When** a reviewer inspects the copy
**Then** no string contains an exclamation mark and no string uses marketing language

**Covers:** PRD F-5; UX-DR-4 (login portion).

### Story 1.4: JWT Auth + Refresh

As a user,
I want to sign in once and have the platform issue me an access token and a refresh token,
So that my session survives short-lived access expiry without re-entering my password.

**Acceptance Criteria:**

**Given** a seeded user with a bcrypt-hashed password (cost factor 12)
**When** the user submits valid credentials to `/auth/login`
**Then** the response body contains `{ access_token }` with HS256, 8-hour expiry, `iss: surakkha-api`, `aud: device`
**And** the response sets a `refresh_token` httpOnly cookie scoped to the api origin with `SameSite=Strict`

**Given** a user submits an unknown email or a wrong password
**When** the login endpoint is called
**Then** the endpoint returns `401 unauthorized` with a generic `{ error: "invalid_credentials" }` body
**And** no audit entry is written on a wrong-password failure

**Given** a valid access token is presented to a protected endpoint
**When** the token is within its 8-hour expiry
**Then** the endpoint accepts the request
**And** the token's `aud` claim matches the audience the endpoint expects

**Given** the access token is within 60 seconds of expiry
**When** the user navigates the SPA
**Then** the TanStack Query interceptor from Story 1.7 attempts a single refresh on the httpOnly cookie
**And** the original request retries once on success

**Given** a developer inspects the password storage
**When** they query the database
**Then** the password column is a bcrypt hash with cost factor 12
**And** the plaintext password never appears in logs

**Given** the api process starts
**When** `JWT_SECRET` is missing, empty, or shorter than 32 characters
**Then** the process exits with code 1 and a logged `JWT_SECRET missing or weak` error
**And** no route handlers are registered (fail-fast mirrors FR-25)

**Covers:** FR-22, FR-23, FR-24, FR-25, AR-4.

### Story 1.5: RBAC Middleware

As an architect,
I want a single `authorize.ts` middleware that runs after auth and before every handler,
So that every protected endpoint enforces `(subject, action, resource)` and there is one place to audit.

**Acceptance Criteria:**

**Given** an authenticated user with role `Operator` calls an endpoint requiring role `Admin`
**When** the request reaches `authorize.ts`
**Then** the middleware returns `403 forbidden` with `{ error: "forbidden", required_role: "Admin" }`
**And** an `AuditLog` row is written with `actor_user_id`, `action`, `resource`, `outcome: "denied"`

**Given** the matrix from Story 1.1 has a `yes` for `(role, action, resource)`
**When** the same user calls the endpoint
**Then** the middleware calls `next()` and the handler executes

**Given** an unauthenticated request reaches `authorize.ts`
**When** no access token is present
**Then** the middleware returns `401 unauthorized` and the handler does not run

**Given** a developer inspects the middleware file
**When** they review the imports
**Then** the role/action/resource predicates come from `packages/shared/src/rbac.ts` only — no duplicated literals
**And** no handler is allowed to bypass the middleware without an explicit `// PUBLIC` comment that is CI-lint-checked

**Covers:** FR-20, AR-10.

### Story 1.6: Role-Aware Nav + RBAC Denied State

As a user,
I want the sidebar to show only the nav items I have permission to use,
So that I do not see options that will deny me, and if I navigate directly to a forbidden route I see a calm explanation.

**Acceptance Criteria:**

**Given** a Viewer logs in
**When** the sidebar renders
**Then** items requiring Operator or Admin (e.g., "Thresholds", "Audit") are not rendered in the DOM
**And** items the Viewer can access (e.g., "Dashboard", "Incidents (read)") are rendered

**Given** an Operator types `/audit` into the address bar
**When** the route renders
**Then** the page shows the empty state: "You don't have access to this page. Contact an Admin."
**And** the empty state contains a link back to `/dashboard`

**Given** the RBAC denied state renders
**When** the developer inspects the component
**Then** it uses semantic HTML (`<main>`, `<h1>`) and announces itself via `role="status"`
**And** the page is keyboard-reachable with a visible focus ring

**Covers:** FR-21, UX-DR-13.

### Story 1.7: 401 Refresh Flow

As a user,
I want my SPA to silently refresh an expired access token once,
So that a token rotation does not interrupt my workflow, and a genuine session loss redirects me to login without losing my target URL.

**Acceptance Criteria:**

**Given** the user is on `/dashboard` with an access token that just expired
**When** an API call returns `401 unauthorized`
**Then** the TanStack Query interceptor calls `/auth/refresh` once with the httpOnly cookie
**And** the original request is retried exactly once with the new access token

**Given** the refresh call also returns `401`
**When** the interceptor receives the failure
**Then** the user is redirected to `/login?next=/dashboard`
**And** after successful login, the SPA navigates back to `/dashboard`

**Given** an open Socket.IO connection receives a `401 token_expired` event
**When** the socket layer handles it
**Then** the socket reconnects with a freshly minted access token
**And** the UI does not unmount or flash a loading screen

**Given** the refresh interceptor is invoked
**When** a network error occurs during refresh
**Then** the user sees the offline state from UX-DR-11 rather than being logged out
**And** the interceptor does not retry refresh more than once per API call

**Covers:** UX-DR-12.

### Story 1.8: Negative RBAC Tests

As a developer,
I want automated tests covering the documented negative RBAC cases,
So that future refactors cannot silently re-introduce role bypass.

**Acceptance Criteria:**

**Given** an Operator session
**When** the test issues `GET /audit`
**Then** the response is `403 forbidden` with `{ required_role: "Admin" }`
**And** an audit entry is written

**Given** a Viewer session
**When** the test issues `POST /incidents` with a valid payload
**Then** the response is `403 forbidden`
**And** no `Incident` row is created

**Given** a Technician session
**When** the test issues `GET /incidents/{id}` for an incident assigned to another Technician
**Then** the response is `403 forbidden`
**And** the Technician does not see the incident in their `/incidents` list

**Given** the test suite runs in CI
**When** it executes
**Then** at least 10 negative RBAC cases run and pass
**And** the test file is namespaced `__tests__/rbac.negative.spec.ts`

**Covers:** FR-21.

### Story 1.9: Critical-First Visual Hierarchy on the Login Shell

As a developer,
I want to verify the saturated severity palette renders correctly on the authenticated shell,
So that the login shell's design system inheritance is observable before any data lands.

**Acceptance Criteria:**

**Given** the user has just authenticated and the authenticated shell mounts
**When** the shell renders
**Then** a sample severity card uses `value`, `text`, `fill`, `bg`, and `glow` from the registered tokens
**And** the card border, KPI stripe, and shadow all resolve to the `critical` severity

**Given** a critical KPI numeral renders
**When** the developer measures its computed style
**Then** the font-size is 44px (40px for non-critical)
**And** the left border is 4px solid using the critical `value` token

**Given** the user navigates between routes
**When** a critical state is present
**Then** the pulse animation runs at `motion.critical_pulse_ms 1500`
**And** a healthy state shows no continuous animation (only the transient per-update glow from UX-DR-6)

**Covers:** UX-DR-2, UX-DR-6.

### Story 1.10: Single-Secret JWT Rotation Policy

As an architect,
I want the single-secret, no-rotation policy documented in the auth domain and tested,
So that no future contributor confuses HS256 + single secret with a rotation-ready posture.

**Acceptance Criteria:**

**Given** the README documents the JWT contract
**When** a developer reads the "JWT" section
**Then** it states: "v1 uses HS256 with a single `JWT_SECRET`. No key rotation. v2 may introduce JWKS / RS256."
**And** it links to `docs/architecture-appendix-opconstraints.md` (I-13)

**Given** the test suite runs
**When** it executes
**Then** an invariant test asserts the api never reads a `JWT_PUBLIC_KEY` env var (rotation is explicitly disabled)
**And** the test is named `__tests__/auth.no-rotation.spec.ts`

**Given** the policy is documented
**When** a code review sees a PR introducing JWKS support
**Then** the PR description must include a v2-bump justification

**Covers:** FR-25, I-13.

## Epic 2: Devices & Telemetry

Operators can see live telemetry from six simulated devices, with a stable device identity, the wire-contract seam, and a working simulator that emits realistic frames. The dashboard shell, the saturated severity KPI band, the live readings table, and the map are all wired to the same socket stream so the demo story starts here.

**Goal:** A reviewer can launch the docker-compose stack, log in, and see six devices on the map and live readings in the table updating at the configured rate, with no manual setup beyond `docker compose up` and the 5-minute README.

### Story 2.1: Wire Contract Schemas

As an architect,
I want the full `version: 1` telemetry frame, JWT claim, metric type, and metric range defined as Zod schemas in `packages/shared`,
So that both api and simulator import the same source of truth and a contract bump edits only this file.

**Acceptance Criteria:**

**Given** the shared package skeleton from Step 0
**When** the agent expands `packages/shared/src/telemetry.ts`
**Then** the frame schema requires `version: literal(1)`, `device_id: uuid()`, `ts: number()`, `fw: string()`, `seq: number().int().nonnegative()`, and `metrics` with all six metrics
**And** each metric has a numeric type and the BRD §8.3.1 range: `ph 0-14`, `tds_ppm 0-5000`, `turbidity_ntu 0-1000`, `temp_c -10-80`, `chlorine_ppm 0-5`, `water_level_cm 0-500`

**Given** `packages/shared/src/auth.ts`
**When** the agent defines the JWT claim schema
**Then** it requires `iss: literal("surakkha-api")`, `aud: enum(["device","simulator"])`, `scope: string()`, `sub: uuid()`
**And** the simulator claim template is exported as a factory function

**Given** the schemas are written
**When** a frame fails validation
**Then** the schema's safeParse returns a structured `ZodError`
**And** the api handler translates that error to `400 bad_request` with `{ error, missing_fields }`

**Given** the deterministic processing order from architecture §3.2
**When** a developer inspects the comment block at the top of `packages/api/src/ingest/frame.ts`
**Then** the order is documented as: validate → auth check → rate check → seq/drop check → persist → rule evaluation → alert emission → state-machine update → audit append → socket broadcast

**Covers:** FR-2, AR-2, AR-5.

### Story 2.2: Ingest WebSocket Endpoint

As a device,
I want to connect to `/ingest/{device_id}` over WebSocket and stream frames at the configured rate,
So that the platform persists my readings and broadcasts them to the dashboard.

**Acceptance Criteria:**

**Given** a per-device JWT with `aud: device` and `scope: telemetry:write`
**When** the device opens `ws://<host>/ingest/{device_id}` with the JWT as a query token
**Then** the server accepts the connection and assigns the device_id from the URL path
**And** the JWT's `sub` claim must equal the URL `device_id`

**Given** an authenticated device sends a valid frame within 2 seconds of the last accepted frame
**When** the server processes it
**Then** the frame is persisted to `Reading` with `server_received_at = now()`
**And** a `reading:new` event is broadcast on the room `device:<device_id>`

**Given** the same device sends a frame less than 2 seconds after the last accepted frame
**When** the server rate-checks it
**Then** the server closes the frame with `429` and includes `Retry-After: 2`
**And** the simulator in Story 2.4 respects `Retry-After`

**Given** a frame's `seq` is less than the highest stored `seq` for that device
**When** the seq/drop check runs
**Then** the frame is persisted as a `seq_reorder` outcome (recorded in metrics, not dropped) and a counter increments
**And** a gap between seq values is recorded as a `seq_drop` event

**Given** a JWT is missing or has `aud: simulator` for an `/ingest/{device_id}` connection
**When** the auth check runs
**Then** the connection is closed with `4401 forbidden` and no frame is accepted

**Given** a device's very first frame after provisioning arrives with `seq: 0` and no prior row exists
**When** the seq/drop check runs
**Then** the frame is accepted (boundary on the "≤ last seen" comparison — `last_seen` defaults to -1, so 0 passes)
**And** `last_seen` is updated to 0

**Given** two devices each send their first frame within the same 2-second window
**When** the per-device rate cap is evaluated
**Then** both frames are accepted (rate limit is per-device, not global)
**And** each device's `last_accepted_at` advances independently

**Covers:** FR-5, FR-7, FR-8, FR-10, AR-3, I-2.

### Story 2.3: Unknown/Missing Field Handling

As a server,
I want to reject frames missing required fields and silently ignore unknown fields,
So that the wire contract is forgiving for forward-compatibility but strict on required fields.

**Acceptance Criteria:**

**Given** a frame missing `device_id` or `ts`
**When** the validation step runs
**Then** the server returns `400 bad_request` with `{ error: "missing_required_field", missing_fields: ["device_id"] }`
**And** no row is written to `Reading`

**Given** a frame with an unknown top-level field (e.g., `experimental_v2_thing`)
**When** the validation step runs
**Then** the unknown field is stripped and the frame is processed as if it had only known fields
**And** no error is returned

**Given** a frame with `ts` 5 minutes in the future
**When** the server clock-skew check runs
**Then** the frame is accepted and a `clock_skew_seconds` metric is exposed at `/admin/ops?device_id=...`
**And** the frame is persisted with `server_received_at` as the canonical "seen at" time

**Given** a frame with `ts` more than 24 hours in the past
**When** the server checks it
**Then** the frame is rejected with `400 stale_frame`
**And** the rejection is counted in a metrics counter

**Covers:** FR-3, FR-4.

### Story 2.4: Simulator Process + Six Default Devices + Seven Scenarios

As a developer,
I want a separate Node process that connects as a real device on the same wire contract,
So that the demo runs end-to-end without hardware and the wire contract stays exercised.

**Acceptance Criteria:**

**Given** the simulator process is started via `pnpm -F simulator start`
**When** it boots
**Then** it mints a JWT with `aud: simulator`, `scope: telemetry:write`, 1-hour expiry
**And** it opens a WebSocket to `/ingest/{device_id}` for each of the six seeded devices

**Given** the simulator's socket disconnects
**When** it reconnects
**Then** it uses exponential backoff: 1s, 2s, 4s, …, capped at 30s
**And** any readings produced during the disconnect are buffered in memory (up to 5,000) and flushed in seq order on reconnect

**Given** the server replies with `429 Retry-After: 2`
**When** the simulator receives it
**Then** the simulator pauses emitting for that device for `Retry-After` seconds
**And** no readings are silently dropped

**Given** a simulator JWT leaks
**When** an attacker uses it to call `/admin/thresholds`
**Then** the request is rejected with `403 forbidden` because the scope does not include admin actions
**And** the audit log records `actor: simulator_jwt` with `outcome: denied`

**Given** the in-memory buffer reaches 5,000 readings while the socket is still disconnected
**When** additional readings are produced
**Then** the oldest readings are dropped (FIFO eviction) to make room
**And** a `__simulator_event` audit row is written per drop with `{ event: "buffer_overflow", device_id, dropped_count }` so no reading is silently lost

**Given** the seed script in `packages/db/prisma/seed.ts`
**When** the database is freshly migrated
**Then** six rows exist in `Device`, one per `School`, with stable UUIDv4 `device_id`
**And** each device is assigned one of the seven scenarios by default

**Given** the `RisingTDS` scenario
**When** it runs for 10 minutes
**Then** `tds_ppm` walks from ~150 to ~600 over the curve in a plausible shape (not a step function)
**And** the other metrics stay near their healthy baselines

**Given** the `Offline` scenario
**When** it runs
**Then** the device stops emitting frames for 60 seconds, then reconnects
**And** the simulator's reconnect logic handles the gap

**Given** the `RandomFailure` scenario
**When** it runs
**Then** a random metric produces a critical breach once during the scenario lifetime
**And** the breach produces an alert per Epic 3

**Given** the seven scenario names
**When** a developer reads the constants in `packages/simulator/src/scenarios.ts`
**Then** the names are exactly: `Normal`, `RisingTDS`, `TurbiditySpike`, `ChlorineDrop`, `Offline`, `BatteryLow`, `RandomFailure`

**Covers:** FR-9, FR-33, FR-34, FR-35, AR-12, I-3, I-4, I-12, NFR-5.

### Story 2.5: `/admin/simulator` Admin Tab

As an Admin,
I want a tab at `/admin/simulator` that lets me start/stop scenarios and observe device state,
So that I can drive the demo from the UI and every action is audit-logged.

**Acceptance Criteria:**

**Given** an Admin visits `/admin/simulator`
**When** the page renders
**Then** it lists all six devices with their current scenario and a per-device "Start / Pause / Switch scenario" control
**And** the page refuses to render any control when `SIMULATOR_SECRET` env is unset, with a calm message: "Simulator disabled. Set SIMULATOR_SECRET."

**Given** an Admin clicks "Switch to RisingTDS" on device A
**When** the action posts to `/admin/simulator/{device_id}/scenario`
**Then** the simulator process applies the new scenario within 5 seconds
**And** an `AuditLog` row is written with `event: __simulator_event`, `actor_user_id`, `payload: { device_id, scenario }`

**Given** a non-Admin (Operator / Technician / Viewer) navigates to `/admin/simulator`
**When** the route renders
**Then** the page renders the RBAC denied state from Story 1.6
**And** no API call to the simulator endpoints is allowed (403)

**Covers:** FR-36, AR-12.

### Story 2.6: Dashboard Shell

As an Operator,
I want the dashboard to show a KPI band, a map, a live readings table, and a recent incidents feed,
So that I see the state of all six devices at a glance.

**Acceptance Criteria:**

**Given** the user is authenticated and on `/dashboard`
**When** the page renders
**Then** it shows four regions: KPI band (top), Map (left), Live Readings table (right), Recent Incidents feed (bottom)
**And** the regions are reachable in this DOM order for screen readers

**Given** a `reading:new` socket event arrives
**When** the dashboard's TanStack Query cache invalidates the `readings.latest` key
**Then** the KPI band and Live Readings table re-render within 100ms
**And** the new value appears with the 1200ms transient per-update glow (UX-DR-6)

**Given** there is no incident
**When** the Recent Incidents feed renders
**Then** it shows the empty state: "No incidents in the last 24 hours."
**And** the empty state does not animate or flash

**Covers:** PRD F-7, NFR-2, UX-DR-2 (numerical portion), UX-DR-11 (offline state surface).

### Story 2.7: Map View

As an Operator,
I want to see the six devices on a Leaflet map with severity-coloured markers,
So that I can spot trouble geographically.

**Acceptance Criteria:**

**Given** the six seeded devices have a `lat` and `lng`
**When** the map renders
**Then** six markers appear at the seeded coordinates
**And** each marker uses the severity `fill` token: green (healthy), amber (warning), red (critical), grey (offline)

**Given** a critical marker
**When** it renders
**Then** it shows the continuous 2000ms pin halo pulse from `motion.pin_pulse_ms`
**And** a non-critical marker shows no halo pulse

**Given** the Operator clicks any marker
**When** the popup opens
**Then** it shows: device name, latest reading for the breached metric, severity dot, and a link to `/devices/{device_id}`
**And** the popup is dismissible with Escape

**Given** a device transitions to offline
**When** its marker updates
**Then** the marker colour shifts to the `offline` severity
**And** the `Reconnecting…` banner from Story 2.9 is also visible

**Covers:** UX-DR-2 (map portion), UX-DR-11.

### Story 2.8: Live Readings Table

As an Operator,
I want a monospace, severity-coded live readings table that pulses on update,
So that I can scan the most recent state of every device at a glance.

**Acceptance Criteria:**

**Given** six devices are connected
**When** the Live Readings table renders
**Then** it shows one row per device with columns: device, metric, value (monospace), severity (dot + label), age
**And** the value column uses a monospaced font for column alignment

**Given** a row's severity is `critical`
**When** the row renders
**Then** it has a 4px critical left border, 3px inner border, and an 8px outer critical glow
**And** the row is announced via `aria-live="polite"`

**Given** a `reading:new` event updates a row
**When** the row's value re-renders
**Then** the row plays the 1200ms transient per-update glow (UX-DR-6)
**And** the age column resets to "just now"

**Given** the operator's role is Viewer
**When** the dashboard renders
**Then** the Live Readings table is read-only (no sort, no action buttons)
**And** the table still respects all visual severity rules

**Covers:** UX-DR-2 (row portion), UX-DR-6.

### Story 2.9: Connection State + Offline UX

As an Operator,
I want to see a clear "Reconnecting…" banner and disabled API actions when the WebSocket is down,
So that I understand the system is offline and do not act on stale data without knowing.

**Acceptance Criteria:**

**Given** the socket is connected
**When** the dashboard renders
**Then** no banner appears and API-bound actions (e.g., "Acknowledge") are enabled

**Given** the socket disconnects for any reason
**When** the connection state changes
**Then** a `Reconnecting…` banner appears at the top of the page with the offline severity
**And** all API-bound action buttons are disabled with the tooltip "Unavailable while offline. Showing last-known data."

**Given** the socket is disconnected
**When** the client retries
**Then** it uses exponential backoff: 5s, 10s, 20s, capped at 30s
**And** the banner stays visible until the socket reconnects

**Given** the socket reconnects
**When** a fresh `reading:new` event arrives
**Then** the banner disappears
**And** the Live Readings table re-renders with fresh values

**Covers:** UX-DR-11.

## Epic 3: Rules & Alerts

Operators can see when a sensor reading breaches a threshold, with de-bounced alerts that auto-create incidents. The rules engine supports `instant`, `rate`, and `absence` rule types; defaults are seeded from BRD §8.3.1; severity is set by the rule, not inferred; alerts are de-bounced per `(device, metric, severity)`.

**Goal:** When the simulator runs a `RisingTDS` scenario, an `instant` rule on `tds_ppm >= 300` de-bounces over `min_duration_seconds`, then fires a warning alert, then auto-creates an OPEN incident, all within the 3-second latency SLA.

### Story 3.1: Rules Table + Prisma Schema

As a developer,
I want a `Rule` Prisma model with the fields required by BRD §8.3.1,
So that the rules engine has a typed source of truth and migrations are reproducible.

**Acceptance Criteria:**

**Given** the `packages/db/prisma/schema.prisma` file
**When** the agent adds the `Rule` model
**Then** it has fields: `id (uuid)`, `device_id (uuid, nullable for global rules)`, `metric (enum)`, `operator (enum)`, `threshold (float)`, `severity (enum)`, `rule_type (enum: instant|rate|absence)`, `min_duration_seconds (int)`, `hysteresis_seconds (int)`, `version (int)`, `created_by (uuid)`, `created_at`, `updated_at`, `is_active (bool)`
**And** a unique constraint on `(device_id, metric, operator, threshold, version)` exists

**Given** the migration runs on a clean database
**When** the migration completes
**Then** the `Rule` table exists and is empty until the seed script from Story 3.3 runs

**Given** a developer wants to add a new rule
**When** they write to the table
**Then** they MUST provide `version` (incremented per change), `created_by`, and the rule is audit-logged on insert

**Covers:** FR-11.

### Story 3.2: Three Rule Types + Evaluation Engine

As a developer,
I want a typed evaluation engine that supports `instant`, `rate`, and `absence` rule types,
So that the rules engine is bounded to the v1 set and the contract is testable in isolation.

**Acceptance Criteria:**

**Given** a rule of type `instant` with `operator: ">="` and `threshold: 300` on `tds_ppm`
**When** a reading `tds_ppm: 312` arrives
**Then** the engine returns `breach: true`
**And** the engine supports operators `>=`, `>`, `<=`, `<`, `==` and rejects other operators at registration

**Given** a rule of type `rate` with `delta_per_minute: 50` on `tds_ppm`
**When** the engine evaluates the last 60 seconds of readings
**Then** it computes the slope and returns `breach: true` when the slope exceeds the threshold
**And** the engine does not need readings older than 60s for rate evaluation

**Given** a rule of type `absence` with `no_reading_for_seconds: 60` on `device_id`
**When** no reading has arrived in the last 60s
**Then** the engine returns `breach: true`
**And** the breach is cleared as soon as any reading arrives

**Given** a rule type other than the three above is requested
**When** the rule is registered
**Then** the registration throws `unsupported_rule_type`
**And** no evaluation ever runs for it

**Covers:** FR-12, AR-6, I-5.

### Story 3.3: Default Thresholds Seed Script

As a developer,
I want `packages/db/prisma/seed.ts` to insert the nine default threshold rows from BRD §8.3.1,
So that the demo runs with WHO/BSTI-aligned defaults and the server never computes defaults at runtime.

**Acceptance Criteria:**

**Given** a fresh database after migration
**When** `pnpm -F db seed` runs
**Then** nine `Rule` rows are inserted with `device_id: null` (global rules) and `version: 1`
**And** the rows are exactly: `ph < 6.5 critical`, `ph > 8.5 critical`, `tds_ppm >= 300 warning`, `tds_ppm >= 1000 critical`, `turbidity_ntu > 5 critical`, `chlorine_ppm < 0.2 critical`, `chlorine_ppm > 1.5 warning`, `temp_c > 45 warning`, `water_level_cm < 20 warning`

**Given** the seed has run
**When** a new device is onboarded
**Then** the device inherits all nine global rules automatically
**And** the device may override any rule with its own per-device rule

**Given** an Admin edits a threshold via Story 3.7
**When** the edit saves
**Then** the original row's `version` is incremented and a new active row is inserted
**And** the previous row is preserved for audit (not deleted)

**Covers:** FR-13, AR-6, I-8.

### Story 3.4: De-bouncing

As a developer,
I want the engine to honour `min_duration_seconds` and `hysteresis_seconds` per `(device, metric, severity)`,
So that brief blips do not produce alerts and a re-fire requires a sustained clear.

**Acceptance Criteria:**

**Given** a rule with `min_duration_seconds: 30` on `tds_ppm >= 300 warning`
**When** the reading breaches for 25 seconds then drops
**Then** no alert fires
**And** an internal `in_violation_since` timestamp is reset on the drop

**Given** the same reading breaches for 31 continuous seconds
**When** the engine evaluates
**Then** an `alert:opened` event is emitted
**And** the `Alert` row is created with `severity: warning` and `opened_at = now()`

**Given** the reading drops back below threshold
**When** the engine evaluates the cleared state
**Then** the alert is not cleared immediately if `hysteresis_seconds: 60` is set
**And** the alert is cleared only after the reading stays below threshold for `hysteresis_seconds`

**Given** a range rule (e.g., `ph < 6.5` AND `ph > 8.5`)
**When** the agent registers it
**Then** the rule is stored as two single-sided rules per AR-7
**And** both rules share the same `min_duration_seconds` and `hysteresis_seconds` per severity

**Covers:** FR-14, AR-7.

### Story 3.5: Alert Lifecycle

As a developer,
I want an `Alert` row with severity, opened_at, acknowledged_at, and cleared_at,
So that every alert is a queryable record and the dashboard can show its lifecycle.

**Acceptance Criteria:**

**Given** the engine decides to fire a breach
**When** the alert is created
**Then** an `Alert` row is inserted with `severity`, `opened_at`, `acknowledged_at: null`, `cleared_at: null`
**And** a `alert:opened` socket event is emitted on the room `device:<device_id>`

**Given** an Operator clicks "Acknowledge" on an alert
**When** the request is processed
**Then** `acknowledged_at` is set to `now()` and the actor_user_id is recorded
**And** a `alert:acknowledged` socket event is emitted

**Given** the reading drops back below threshold for `hysteresis_seconds`
**When** the engine clears the alert
**Then** `cleared_at` is set to `now()`
**And** no socket event is emitted for clear (UI derives clear from a fresh reading)

**Covers:** FR-15.

### Story 3.6: Auto-Create Incident from Warning/Critical Alert

As a developer,
I want every warning/critical alert to auto-create an `Incident` linked to the alert and the school,
So that the operator sees the right workflow surface immediately.

**Acceptance Criteria:**

**Given** an alert with `severity: warning` is opened
**When** the engine emits `alert:opened`
**Then** an `Incident` row is created with `state: OPEN`, `severity: warning`, `school_id`, `sensor_id`, `alert_id`
**And** the dashboard's Recent Incidents feed shows the new incident

**Given** an alert with `severity: critical` is opened
**When** the engine emits `alert:opened`
**Then** an `Incident` row is created with `state: OPEN`, `severity: critical`, and the `Open · Critical` Kanban column receives it
**And** the incident appears within the NFR-1 latency budget

**Given** an alert with `severity: info`
**When** the engine emits `alert:opened`
**Then** no `Incident` row is created
**And** the alert is visible only on the alerts log

**Given** an OPEN incident already exists for `(device_id, metric, severity)`
**When** a second alert fires for the same tuple before the first incident is RESOLVED
**Then** no second `Incident` row is created
**And** the new `alert_id` is appended to the existing incident's `linked_alerts` list
**And** if the new alert's severity is higher than the current incident severity, the incident severity is escalated and the Kanban column re-projects via Story 4.3

**Covers:** FR-16.

### Story 3.7: `/admin/thresholds` Admin Tab

As an Admin,
I want a tab at `/admin/thresholds` that lists all rules and lets me edit any of them,
So that I can tune the platform without touching the database.

**Acceptance Criteria:**

**Given** an Admin visits `/admin/thresholds`
**When** the page renders
**Then** it lists all global rules and any per-device overrides, filterable by metric and severity
**And** each row shows: metric, operator, threshold, severity, version, updated_at, updated_by

**Given** an Admin edits a rule's `threshold` and clicks Save
**When** the request is processed
**Then** a new `Rule` row is inserted with `version = old.version + 1` and `is_active: true`
**And** the previous row's `is_active` is set to `false`
**And** an `AuditLog` row is written with `event: threshold_changed`, `actor_user_id`, `payload: { rule_id, old, new }`

**Given** a non-Admin (Operator / Technician / Viewer) navigates to `/admin/thresholds`
**When** the route renders
**Then** the page renders the RBAC denied state from Story 1.6
**And** no edit endpoints accept non-Admin tokens

**Covers:** FR-11; FR-30 (audit side).

## Epic 4: Incidents & Workflow

Operators, Technicians, and Admins can move an incident through the full state machine, see the severity banner for UNSAFE results, and resolve or reopen with a full audit trail. The 4-column severity-mixed Kanban is the day-to-day surface; the underlying 7-state machine governs transitions and remains auditable.

**Goal:** An Operator can acknowledge an OPEN incident, assign a Technician, the Technician submits a result (`SAFE` / `UNSAFE` / `MONITORING`), an Operator reviews and resolves, and every step is recorded as an `IncidentEvent` with the actor and timestamp.

### Story 4.1: Card Action Affordance Contract

As a developer,
I want a locked `IncidentCard` component whose action slots are computed from the underlying state (never the column),
So that Epic 2's read-only incident preview and Epic 4's interactive workflow consume the same affordance.

**Acceptance Criteria:**

**Given** an `IncidentCard` component in `packages/web/src/components/IncidentCard.tsx`
**When** a developer inspects its props
**Then** the prop shape is `{ incident: Incident; onAction: (slot: ActionSlot) => void; isInteractive: boolean }`
**And** `ActionSlot` is an exported type union: `"acknowledge" | "assign" | "submit-result" | "resolve" | "reopen" | null`

**Given** an incident in state `OPEN`
**When** the card renders
**Then** the `acknowledge` slot is rendered and the `submit-result` slot is not
**And** the available slots are derived from `incident.state`, not from a column name

**Given** an incident in state `RESOLVED`
**When** an Admin views the card
**Then** the `reopen` slot is rendered with the visible label "Reopen (Admin critical comment)"
**And** the slot is not rendered for non-Admin viewers

**Given** Epic 2's read-only incident preview consumes this contract
**When** the preview renders
**Then** all slots are passed `isInteractive: false` and the card renders text-only labels

**Covers:** UX-DR-9 (contract portion).

### Story 4.2: Incident State Machine Implementation

As a developer,
I want a server-enforced 7-state machine with an explicit transition table,
So that every transition is testable and invalid attempts are rejected and audited.

**Acceptance Criteria:**

**Given** the architecture §5.1 state machine
**When** the agent implements `packages/api/src/incident/transitions.ts`
**Then** the file exposes a `transition(incident, action, actor)` function and a `TRANSITIONS` table
**And** the table maps every valid `(from_state, action) → to_state` tuple

**Given** an incident in state `OPEN`
**When** an Operator calls `POST /incidents/{id}/acknowledge`
**Then** the incident transitions to `ACKNOWLEDGED`
**And** an `IncidentEvent` row is written with `actor_user_id`, `type: "acknowledge"`, `payload: {}`, `created_at`

**Given** an incident in state `RESOLVED`
**When** an Operator calls `POST /incidents/{id}/acknowledge`
**Then** the endpoint returns `409 invalid_state_transition` with `{ from: "RESOLVED", attempted: "acknowledge" }`
**And** an `AuditLog` row is written with `event: __invalid_transition_attempt`, `actor_user_id`, `payload: { incident_id, attempted }`

**Given** the transition table
**When** a developer inspects it
**Then** every transition in the table is covered by a unit test
**And** no transition is allowed without an actor_user_id

**Covers:** FR-17, FR-19, AR-8, I-7.

### Story 4.3: Kanban Column Projection

As a developer,
I want the 4-column severity-mixed Kanban to be a derived projection over the 7-state machine,
So that the Kanban and the state machine can never disagree.

**Acceptance Criteria:**

**Given** an `incident:state_changed` socket event
**When** the dashboard receives it
**Then** the Kanban recomputes the column for the affected incident
**And** the recomputation is a pure function `(state, severity) → column` exported from `packages/web/src/incidents/projection.ts`

**Given** the column mapping
**When** a developer inspects it
**Then** `OPEN + critical → "Open · Critical"`, `OPEN + warning → "Open · Warning"`, `ACKNOWLEDGED → "Acknowledged"` (regardless of severity), `RESOLVED → "Resolved"` (regardless of severity)
**And** states `INSPECTING`, `SAFE`, `UNSAFE`, `MONITORING`, and `REOPENED` all map to "Acknowledged" (in-progress bucket)

**Given** the Kanban renders
**When** an incident transitions from `INSPECTING` to `SAFE`
**Then** the card visually stays in the "Acknowledged" column until it transitions to `RESOLVED`
**And** no Kanban state is persisted in the database

**Covers:** UX-DR-9, AR-9.

### Story 4.4: Incident Detail Page

As an Operator,
I want an incident detail page that shows the incident header, timeline, attachments, and action buttons,
So that I have all context to act on an incident from one screen.

**Acceptance Criteria:**

**Given** an Operator navigates to `/incidents/{id}`
**When** the page renders
**Then** the header shows: incident id (short), severity (dot + label), current state, opened_at, age, school name
**And** the timeline lists every `IncidentEvent` in chronological order with actor and timestamp

**Given** the incident has attachments
**When** the page renders
**Then** the attachments list shows filename, uploader, timestamp, and a download link
**And** each link opens in a new tab

**Given** the incident is in `OPEN` state
**When** the action buttons render
**Then** the Operator sees "Acknowledge" and "Assign Technician"
**And** the Technician sees nothing (read-only until assigned)

**Given** the incident is in `INSPECTING` state
**When** the page renders
**Then** the assigned Technician sees "Submit result (SAFE / UNSAFE / MONITORING)"
**And** other roles see read-only

**Covers:** FR-17, FR-19.

### Story 4.5: Acknowledge Flow

As an Operator,
I want to acknowledge an OPEN incident with one click,
So that the alert stops being unowned and the SLA starts.

**Acceptance Criteria:**

**Given** an OPEN incident
**When** the Operator clicks "Acknowledge"
**Then** the state transitions to `ACKNOWLEDGED` via Story 4.2
**And** `acknowledged_at` is set on the linked `Alert` row
**And** the Kanban card moves from "Open · Critical" or "Open · Warning" to "Acknowledged"

**Given** the same Operator clicks "Acknowledge" twice in quick succession
**When** the second request lands
**Then** the endpoint returns `409 invalid_state_transition` (already ACKNOWLEDGED)
**And** no duplicate `IncidentEvent` is written

**Given** the test suite runs the SLA test
**When** it executes
**Then** the SLA test asserts acknowledge-to-card-move latency under 1 second
**And** the test is named `__tests__/incident.acknowledge.sla.spec.ts`

**Given** the acknowledge transition completes
**When** the engine emits the post-write socket events
**Then** both `incident:state_changed` and `incident:updated` events are emitted on the room `incident:{id}` so the Kanban and the detail page stay in sync
**And** the `incident:updated` payload includes the new `state`, `assignee_user_id` (if set), and `updated_at`

**Given** two Operators click "Acknowledge" on the same OPEN incident within the same millisecond
**When** both requests land
**Then** one request transitions the incident to `ACKNOWLEDGED` and the other returns `409 invalid_state_transition` (optimistic-concurrency check on `updated_at`)
**And** the loser sees a toast: "Acknowledged by {other_user} at {time}."
**And** exactly one `IncidentEvent` row is written

**Covers:** FR-17, FR-19, AR-11.

### Story 4.6: Assign Technician + INSPECTING Transition

As an Operator,
I want to assign a Technician to an ACKNOWLEDGED incident from a role-filtered modal,
So that field work can begin and the incident moves to `INSPECTING`.

**Acceptance Criteria:**

**Given** an ACKNOWLEDGED incident
**When** the Operator clicks "Assign Technician"
**Then** a modal lists only users with role `Technician`, searchable by name
**And** the modal shows each Technician's current open incident count

**Given** the Operator selects a Technician and clicks "Assign"
**When** the request is processed
**Then** the incident transitions to `INSPECTING`
**And** an `IncidentEvent` row is written with `type: "assign"`, `payload: { assignee_user_id }`
**And** the Kanban card stays in the "Acknowledged" column (per Story 4.3)

**Given** the assigned Technician logs in
**When** they visit `/incidents`
**Then** the incident appears in their filtered list per Story 4.12
**And** the incident is the only one in their "Acknowledged" column with a "Submit result" action

**Covers:** FR-17, FR-19, FR-21 (Technician visibility).

### Story 4.7: Submit Result (SAFE / UNSAFE / MONITORING)

As a Technician,
I want to submit the inspection result with a required comment,
So that the operator has evidence to resolve the incident.

**Acceptance Criteria:**

**Given** an incident in state `INSPECTING`
**When** the Technician submits a result with a comment ≥ 10 characters
**Then** the incident transitions to `SAFE`, `UNSAFE`, or `MONITORING` based on the selection
**And** an `IncidentEvent` is written with `type: "submit_result"`, `payload: { result, comment }`

**Given** the Technician submits without a comment or with a comment < 10 chars
**When** the form validates
**Then** the submit button is disabled
**And** the helper text reads: "Add a one-line note describing what you observed."

**Given** the Technician submits a result of `UNSAFE`
**When** the request completes
**Then** the `notification:critical` event from Story 4.9 fires
**And** every Admin sees the `SeverityBanner` from Story 4.8

**Given** a non-Technician (Operator / Viewer) attempts to submit a result
**When** the endpoint is called
**Then** it returns `403 forbidden` with `{ required_role: "Technician" }`

**Covers:** FR-17, FR-18, FR-19.

### Story 4.8: Sticky SeverityBanner + RBAC

As an Admin,
I want a sticky `SeverityBanner` that persists across routes when any incident is UNSAFE,
So that I cannot miss a critical water-safety outcome — and the banner must be invisible to non-Admin sessions even when UNSAFE results exist.

**Acceptance Criteria:**

**Given** an Admin is signed in
**When** any incident transitions to `UNSAFE`
**Then** a `SeverityBanner` appears at the top of every authenticated route
**And** the banner has a 4px top + 4px bottom critical border and a 24px outer critical glow

**Given** the banner mounts
**When** it animates in
**Then** it uses a 200ms fade-in
**And** the fade respects `prefers-reduced-motion` (Epic 6)

**Given** the Admin clicks "Acknowledge" on the underlying incident
**When** the acknowledgement is recorded
**Then** the banner dismisses immediately
**And** no banner reappears unless a new UNSAFE result is submitted

**Given** the Admin does not acknowledge
**When** 24 hours pass
**Then** the banner auto-dismisses (timer implemented; not tested in v1 per FR-18)

**Given** an Operator is signed in
**When** an incident transitions to `UNSAFE`
**Then** no `SeverityBanner` appears in the Operator's UI on any route
**And** the Operator sees the UNSAFE result only on the incident detail page

**Given** a Technician is signed in
**When** an incident they are not assigned to transitions to `UNSAFE`
**Then** no `SeverityBanner` appears in the Technician's UI
**And** the API endpoint that serves banner state returns 403 for non-Admin tokens

**Given** a Viewer is signed in
**When** an incident transitions to `UNSAFE`
**Then** no `SeverityBanner` appears and the Viewer sees no state change

**Covers:** FR-18, FR-21, UX-DR-5.

### Story 4.9: Notification Writer

As a developer,
I want a `Notification` row written for every `notification:critical` event,
So that the platform records what _would_ have been sent in v1 and v2 can replay them via real channels.

**Acceptance Criteria:**

**Given** an incident transitions to `UNSAFE`
**When** the engine emits `notification:critical`
**Then** a `Notification` row is written with `severity: critical`, `incident_id`, `recipient_role: "Admin"`, `created_at`
**And** the row is visible at `/admin/notifications` (read view lives in Epic 5)

**Given** an alert of severity `warning` is opened
**When** the engine emits `notification:warning`
**Then** a `Notification` row is written with `severity: warning`
**And** the UI surfaces a toast (Story 4.10) but no banner

**Given** the schema migration runs
**When** it completes
**Then** the `Notification` table has fields: `id`, `severity`, `incident_id` (nullable), `alert_id` (nullable), `recipient_role`, `created_at`, `acknowledged_at`, `acknowledged_by_user_id`

**Given** the Technician double-clicks "Submit UNSAFE" within one second
**When** both requests land
**Then** exactly one `notification:critical` event is emitted and one `Notification` row is written (idempotency keyed on `(incident_id, severity: critical)` for the open banner window)
**And** the second request returns `409 already_emitted` and the UI surfaces a calm "Already submitted." toast

**Covers:** FR-28 (write side); FR-27 (UI-only delivery).

### Story 4.10: NotificationBell Dropdown

As an Operator or Admin,
I want a bell in the topbar that shows recent notifications,
So that I do not miss warnings and criticals.

**Acceptance Criteria:**

**Given** the user is authenticated
**When** the topbar renders
**Then** a `NotificationBell` icon appears on the right
**And** the bell shows an unread count badge in `color.primary`

**Given** the user clicks the bell
**When** the dropdown opens
**Then** it lists the 20 most recent notifications with: severity dot, short text, timestamp
**And** clicking a row navigates to the underlying incident

**Given** a notification is unread
**When** it appears in the dropdown
**Then** it has a 2px left border in the severity `value` colour
**And** reading it marks `acknowledged_at` for that notification row

**Covers:** UX-DR-10 (bell portion).

### Story 4.11: Reopen Path

As an Admin,
I want to reopen a RESOLVED incident by submitting a comment with `severity=critical`,
So that a misclassified incident returns to active workflow.

**Acceptance Criteria:**

**Given** a RESOLVED incident
**When** an Admin submits a comment with `severity: critical` and text ≥ 10 chars
**Then** the incident transitions `RESOLVED → OPEN`
**And** an `IncidentEvent` is written with `type: "reopen"`, `payload: { reason, actor_user_id }`

**Given** an Operator or Technician attempts the same action
**When** the endpoint is called
**Then** it returns `403 forbidden` with `{ required_role: "Admin" }`
**And** no transition occurs

**Given** the reopen transition occurs
**When** the engine processes it
**Then** the Kanban card moves to "Open · Critical" (severity is forced critical on reopen)
**And** the audit log records `event: __reopen`, `actor_user_id`, `payload: { incident_id, previous_state }`

**Covers:** FR-17 (REOPENED branch).

### Story 4.12: Technician-Filtered Kanban

As a Technician,
I want my `/incidents` view to show only incidents assigned to me,
So that I see my own queue and nothing else.

**Acceptance Criteria:**

**Given** a Technician is signed in
**When** they navigate to `/incidents`
**Then** the Kanban renders only incidents where `incident.assignee_user_id == current_user.id`
**And** the empty state reads: "No incidents assigned to you."

**Given** a Technician navigates directly to `/incidents/{id}` for an incident not assigned to them
**When** the route resolves
**Then** the API returns `403 forbidden`
**And** the SPA renders the RBAC denied state from Story 1.6

**Given** a new incident is assigned to the Technician via Story 4.6
**When** the `incident:state_changed` socket event arrives
**Then** the new card appears in the Technician's Kanban without a page refresh

**Covers:** FR-21, UX-DR-14.

### Story 4.13: Attachments

As an Operator or Technician,
I want to attach an external URL (e.g., a photo link) to an incident,
So that evidence travels with the incident.

**Acceptance Criteria:**

**Given** an Operator or Technician opens an incident
**When** they click "Add attachment"
**Then** a form accepts: external URL (required), label (optional), mime type (auto-detected)
**And** the URL must be `http://` or `https://` (no `javascript:`, no `data:`)

**Given** the form submits a valid URL
**When** the attachment is created
**Then** an `Attachment` row is written with `incident_id`, `url`, `label`, `mime`, `uploaded_by_user_id`, `created_at`
**And** v1 stores no binary blobs

**Given** a Viewer attempts to upload
**When** the endpoint is called
**Then** it returns `403 forbidden`
**And** no row is written

**Covers:** BRD §5.2 (attachment affordance).

## Epic 5: Reporting & Audit

Admins and Operators can export readings, see the notification log, browse the audit trail, and trust that data older than 30 days has been aggregated into 5-minute mean/min/max rows. The hourly retention cron is the seam for v2 to swap in a continuous aggregation worker.

**Goal:** An Operator can download a CSV of 30 days of readings for any sensor; an Admin can browse the audit log filtered by actor / entity / date; the hourly cron correctly aggregates raw readings older than 30 days.

### Story 5.1: `/admin/notifications` Read View

As an Admin,
I want a page at `/admin/notifications` that lists every notification the platform has emitted,
So that I can audit what was raised, when, and for whom.

**Acceptance Criteria:**

**Given** an Admin visits `/admin/notifications`
**When** the page renders
**Then** it shows the 100 most recent `Notification` rows in a table: severity dot, short text, recipient role, created_at, acknowledged state
**And** the page supports filters: severity (multi-select), date range (last 24h / 7d / 30d / custom)

**Given** a non-Admin navigates to `/admin/notifications`
**When** the route resolves
**Then** the RBAC denied state from Story 1.6 renders
**And** the API endpoint returns `403 forbidden`

**Given** a notification row is clicked
**When** the row expands
**Then** it shows the full payload JSON and a link to the underlying incident (if any)

**Covers:** FR-28 (read side).

### Story 5.2: CSV Export of 30 Days of Readings

As an Operator or Admin,
I want to download a CSV of the last 30 days of readings for any sensor,
So that I can share data with field officers and external auditors.

**Acceptance Criteria:**

**Given** an Operator or Admin visits `/devices/{device_id}`
**When** they click "Export CSV (30 days)"
**Then** a CSV download starts with columns: `received_at, ts, seq, ph, tds_ppm, turbidity_ntu, temp_c, chlorine_ppm, water_level_cm`
**And** the file is named `surakkha-<device_id>-<YYYY-MM-DD>.csv`

**Given** the export runs
**When** the server generates the file
**Then** it streams the rows (no full materialisation in memory)
**And** an `AuditLog` row is written with `event: __csv_export`, `actor_user_id`, `payload: { device_id, row_count }`

**Given** the export would exceed 100,000 rows
**When** the user clicks "Export"
**Then** the UI warns: "This export will be large. Continue?"
**And** the export still succeeds but the file is chunked server-side

**Given** a Technician or Viewer attempts the export
**When** the endpoint is called
**Then** it returns `403 forbidden`

**Covers:** FR-29.

### Story 5.3: Audit Log Surface at `/audit`

As an Admin,
I want a queryable audit log at `/audit`,
So that I can answer "who did what, when" across state changes, threshold changes, and simulator events.

**Acceptance Criteria:**

**Given** an Admin visits `/audit`
**When** the page renders
**Then** it shows the 100 most recent `AuditLog` rows: actor (user id + name), event, resource (entity id), outcome, created_at
**And** filters support: actor (multi-select), event (free-text), resource type, date range

**Given** an `AuditLog` row references an incident or threshold
**When** the row is clicked
**Then** it navigates to the underlying entity (e.g., `/incidents/{id}` or `/admin/thresholds?rule_id=...`)
**And** no editing is possible from the audit view

**Given** a non-Admin (Operator / Technician / Viewer) visits `/audit`
**When** the route resolves
**Then** the RBAC denied state from Story 1.6 renders
**And** the API endpoint returns `403 forbidden`

**Covers:** FR-30.

### Story 5.4: `ReadingAggregate` Table

As a developer,
I want a `ReadingAggregate` Prisma model with 5-minute mean/min/max rows,
So that the retention cron has a typed destination and queries are fast.

**Acceptance Criteria:**

**Given** `packages/db/prisma/schema.prisma`
**When** the agent adds the `ReadingAggregate` model
**Then** it has fields: `id`, `device_id`, `bucket_start (timestamp)`, `metric (enum)`, `mean (float)`, `min (float)`, `max (float)`, `sample_count (int)`
**And** a unique constraint on `(device_id, bucket_start, metric)`

**Given** the migration runs
**When** it completes
**Then** the table exists and is empty
**And** the dashboard's chart layer can fall back to aggregate rows when raw rows are absent

**Given** a row exists for `(device A, bucket_start 2026-08-19T10:05, tds_ppm)`
**When** a query joins it with the device
**Then** the response returns mean/min/max/sample_count without touching the `Reading` table

**Covers:** FR-31.

### Story 5.5: Hourly Retention Cron

As an operator,
I want an hourly cron that aggregates raw readings older than 30 days into 5-minute buckets and deletes the raw rows,
So that the database stays bounded and the demo data shape is predictable.

**Acceptance Criteria:**

**Given** the cron process is started
**When** it runs (every hour, configurable via `RETENTION_CRON`)
**Then** it selects raw readings older than 30 days in batches of ≤ 10,000 rows
**And** for each `(device_id, metric, 5-minute bucket)`, it inserts a `ReadingAggregate` row with mean/min/max/sample_count

**Given** the aggregate rows are written
**When** the cron continues
**Then** the original raw rows are deleted in the same transaction
**And** a `cron_runs` row records `started_at`, `finished_at`, `aggregated_rows`, `deleted_rows`

**Given** the cron hits the 10,000 row cap
**When** the run ends
**Then** the next hourly run continues from where the previous run stopped (idempotent, cursor-based)
**And** no raw rows older than 30 days remain after two consecutive runs on a small dataset

**Given** the cron runs concurrently with live ingestion
**When** a reading arrives during a retention run
**Then** it is not affected by the retention cursor (it is too young to be aggregated)

**Given** the cron is invoked while a previous run is still active
**When** the second invocation starts
**Then** it exits early without overlap (cursor-based lock via `SELECT ... FOR UPDATE` on the `cron_runs` row, or a `cron.lock` advisory lock)
**And** the second invocation's `cron_runs` row is written with `outcome: "skipped_overlap"`
**And** no double-aggregation or duplicate `ReadingAggregate` rows are written

**Covers:** FR-31, FR-32, AR-13, I-15.

### Story 5.6: Negative Tests for the Audit Log

As a developer,
I want automated tests proving that every audited action writes an audit row,
So that the audit log cannot silently degrade.

**Acceptance Criteria:**

**Given** an Operator acknowledges an incident
**When** the test inspects the audit log
**Then** a row exists with `event: state_change`, `actor_user_id`, `resource: incident:{id}`, `outcome: success`

**Given** an Admin edits a threshold
**When** the test inspects the audit log
**Then** a row exists with `event: threshold_changed`, `payload: { rule_id, old, new }`

**Given** an Admin switches a scenario via Story 2.5
**When** the test inspects the audit log
**Then** a row exists with `event: __simulator_event`, `payload: { device_id, scenario }`

**Given** a Technician attempts an unauthorised action
**When** the test inspects the audit log
**Then** a row exists with `event: __rbac_denied`, `actor_user_id`, `outcome: denied`

**Given** the test suite runs in CI
**When** it executes
**Then** at least 8 audit-coverage cases run and pass
**And** the test file is namespaced `__tests__/audit.coverage.spec.ts`

**Covers:** FR-30.

## Epic 6: Cross-cutting NFRs

The non-functional backbone: Docker Compose deployment, README quickstart, lint/format, test coverage, observability, accessibility, the visual layer's critical-first design system, and the operational constraints register that prevents the AI coding agent from mistaking v1 simplifications for durable decisions.

**Goal:** A reviewer on a clean machine can reach the demo state in 15 minutes via `git clone && docker compose up`. The README is the artefact. The visual layer's critical-first design system is implemented, observable, and `prefers-reduced-motion`-aware.

### Story 6.1: Docker Compose + README Quickstart

As a reviewer,
I want a single `docker-compose.yml` that brings up web, api, simulator, and db, and a README that gets me to the demo state in under 15 minutes,
So that the demo is reproducible on any developer machine.

**Acceptance Criteria:**

**Given** a clean checkout of the repo
**When** `docker compose up` is run
**Then** four services start: `web` (Nginx serving the Vite build), `api` (Node 20 + Express + Prisma), `simulator` (Node 20, simulator process), `db` (Postgres 15 with a volume-mounted data directory)
**And** the api waits on the db healthcheck before starting

**Given** all services are running
**When** the user opens `http://localhost:8080`
**Then** the web app loads and the api responds at `/health` with `{ status: "ok" }`

**Given** the user wants to clean up
**When** they run `docker compose down -v`
**Then** all services stop and the volume is removed
**And** no orphan containers or networks remain

**Given** a fresh clone on a clean machine
**When** the reviewer follows the README
**Then** they reach the dashboard in under 15 minutes by: `git clone`, `docker compose up`, open `http://localhost:8080`, log in with a seeded user
**And** the README lists the four seeded user accounts and their roles

**Given** the README is updated
**When** the maintainer commits the change
**Then** the change is tested on a clean machine before every demo
**And** the "Last verified on" date is shown at the top of the README

**Given** the README mentions env vars
**When** the reviewer reads it
**Then** every env var (`JWT_SECRET`, `SIMULATOR_SECRET`, `DATABASE_URL`, `RETENTION_CRON`) has a one-line explanation

**Covers:** NFR-11, NFR-15, AR-14, BRD §13.

### Story 6.2: Comprehension Aids

As a new reviewer,
I want `LegendStrip`, `SeverityShowcase`, and `WalkthroughOverlay` on the dashboard,
So that I understand the severity vocabulary in under 60 seconds.

**Acceptance Criteria:**

**Given** an authenticated user visits the dashboard
**When** the page renders
**Then** a `LegendStrip` appears with three pills: Healthy, Warning, Critical
**And** a `SeverityShowcase` appears with three side-by-side cards explaining the severity vocabulary

**Given** it is the user's first login
**When** the dashboard mounts
**Then** a `WalkthroughOverlay` runs a 3-step coach-mark cycle: "Reading", "Alert", "Incident"
**And** the overlay persists a `seen_walkthrough: true` flag in user prefs

**Given** the user closes the walkthrough early
**When** they revisit the dashboard
**Then** the walkthrough does not reappear
**And** a small "Replay tour" link is available in the help menu

**Covers:** UX-DR-8.

### Story 6.3: `prefers-reduced-motion` Compliance

As a user with motion sensitivity,
I want all continuous animations disabled under `prefers-reduced-motion: reduce`,
So that the dashboard remains usable and non-distracting.

**Acceptance Criteria:**

**Given** the OS-level setting `prefers-reduced-motion: reduce` is active
**When** the dashboard renders a critical KPI
**Then** the 1500ms continuous critical pulse is disabled
**And** the severity is still conveyed by colour + text + icon

**Given** the same setting is active
**When** a map marker would pulse
**Then** the 2000ms pin halo pulse is disabled
**And** the marker colour is the only visual signal

**Given** the same setting is active
**When** the `SeverityBanner` mounts
**Then** the 200ms fade-in is disabled (instant mount)
**And** the 1200ms transient per-update glow is preserved as a single instant frame

**Given** the test suite runs in CI
**When** it executes with `prefers-reduced-motion: reduce` emulated
**Then** no `animation: ... infinite` CSS rules apply
**And** the test is named `__tests__/a11y.reduced-motion.spec.ts`

**Covers:** UX-DR-7.

### Story 6.4: Accessibility Audit

As a developer,
I want a WCAG 2.1 AA audit on every page,
So that the platform is keyboard-reachable and severity is never conveyed by colour alone.

**Acceptance Criteria:**

**Given** the audit script runs against the dashboard, login, incidents, and audit pages
**When** it completes
**Then** every page passes WCAG 2.1 AA automated checks (axe-core)
**And** no violation has severity "serious" or "critical"

**Given** a user navigates with the keyboard only
**When** they Tab through any page
**Then** every interactive element is reachable and shows a 2px focus ring with 2px offset
**And** the focus order matches the visual order

**Given** a critical KPI renders
**When** a screen reader inspects it
**Then** the KPI announces severity + value + threshold (e.g., "Critical. TDS is 1012 ppm. Threshold is 1000 ppm.")
**And** the live readings region carries `aria-live="polite"`

**Covers:** UX-DR-16.

### Story 6.5: Backend ≥ 70% / Frontend ≥ 50% Coverage

As a maintainer,
I want Jest (api) and Vitest (web) coverage gates enforced in CI,
So that coverage cannot regress silently.

**Acceptance Criteria:**

**Given** the CI pipeline runs
**When** the api tests execute
**Then** line coverage is reported and the build fails if backend coverage drops below 70%
**And** the report is uploaded as a CI artefact

**Given** the CI pipeline runs
**When** the web tests execute
**Then** line coverage is reported and the build fails if frontend coverage drops below 50%
**And** the report is uploaded as a CI artefact

**Given** a developer adds a new module
**When** they push
**Then** the coverage delta is shown in the PR comment

**Covers:** NFR-12 (coverage portion).

### Story 6.6: Playwright Happy Path

As a developer,
I want a Playwright test that drives the full demo story,
So that the canonical user journey is locked.

**Acceptance Criteria:**

**Given** a clean docker-compose stack is up
**When** the Playwright test runs
**Then** it logs in as Operator, sees at least one reading on the dashboard, triggers a `RisingTDS` scenario, sees the alert appear, acknowledges the incident, assigns a Technician, has the Technician submit `UNSAFE`, sees the SeverityBanner, and resolves the incident
**And** every assertion passes within a 60-second overall budget

**Given** the test runs in CI
**When** it executes
**Then** it is the canonical smoke test for the demo
**And** the test is named `__tests__/e2e/happy-path.spec.ts`

**Covers:** NFR-12 (Playwright portion).

### Story 6.7: Operational Constraints Register

As an architect,
I want `docs/architecture-appendix-opconstraints.md` listing I-9..I-15 with "do not mistake for durable" warnings,
So that the AI coding agent cannot silently re-introduce v1 simplifications as v2 decisions.

**Acceptance Criteria:**

**Given** the architecture §8 lists I-9 through I-15
**When** the agent writes `docs/architecture-appendix-opconstraints.md`
**Then** each constraint gets its own section with: name, current v1 posture, one-line "do not mistake for durable" warning
**And** the warning text uses the calm voice discipline: no exclamation marks

**Given** the doc exists
**When** a developer reads it
**Then** the doc is linked from the README's "Architecture" section
**And** the doc includes a code-comment snippet that can be copy-pasted into v1 modules

**Covers:** AR-15.

### Story 6.8: 60-Second Comprehension Test

As a demo presenter,
I want a documented 60-second comprehension check,
So that I can verify a fresh reviewer understands the workflow in one minute.

**Acceptance Criteria:**

**Given** a fresh reviewer with no prior context
**When** they are placed in front of the dashboard
**Then** the demo script instructs them to: read the KPI band (10s), click a critical card (10s), follow the incident from alert → assign → submit → resolve (40s)
**And** at the end, they can verbally describe the workflow without prompting

**Given** the demo is rehearsed
**When** the presenter times the comprehension check
**Then** the entire cycle fits inside 60 seconds
**And** the script lives in `docs/demo-script.md`

**Covers:** NFR-8.

### Story 6.9: Telemetry-to-Alert Latency Test

As a developer,
I want a Playwright test that asserts end-to-end alert latency under 3 seconds,
So that the NFR-1 SLA is enforced on every PR. (Moved from Epic 3 to keep SLA tests grouped.)

**Acceptance Criteria:**

**Given** the simulator is running and the dashboard is open in Playwright
**When** the test programmatically triggers a `RisingTDS` scenario on device A
**Then** the test waits for an alert to appear in the Recent Incidents feed
**And** the elapsed time from trigger to alert is asserted to be under 3 seconds

**Given** the test runs in CI
**When** it executes
**Then** it does not flake under normal jitter (the assertion uses a 2.8s threshold on a 3s SLA)
**And** the test is named `__tests__/e2e/latency.spec.ts`

**Given** the simulator is paused
**When** the latency test starts
**Then** the test skips with a clear "Simulator not running" message rather than failing

**Covers:** NFR-1.

### Story 6.10: `/impeccable critique` Findings Triage Pipeline

As a maintainer,
I want every critique artifact in `.impeccable/critique/` to flow into the epics backlog as discrete, triaged follow-ups,
So that critique findings never get lost between monthly runs and the project's health score trends visibly upward over time.

**Acceptance Criteria:**

**Given** a critique artifact exists at `.impeccable/critique/<timestamp>__<slug>.md`
**When** the triage pipeline runs (manual workflow, monthly cadence per RUNBOOK.md §11)
**Then** every P0 and P1 finding in the artifact has a corresponding story stub appended to this section
**And** every P2 and P3 finding has a single-line entry under "Carried in critique only" so the trend is visible without becoming story spam

**Given** a P0 finding has been triaged into a story stub
**When** the story is closed
**Then** the artifact frontmatter `p0_count` reflects the closure (one fewer P0 outstanding)
**And** the trend table at the bottom of this story shows the score moving upward over consecutive runs

**Given** three consecutive monthly runs have shipped with no new P0/P1 findings
**When** a critique completes
**Then** the maintainer is encouraged (in RUNBOOK.md §11) to relax the cadence from monthly to quarterly
**And** the workflow file `.github/workflows/impeccable-critique-reminder.yml` is updated to reflect the new cron

**Covers:** the binding contract from `AGENTS.md §4.1` + `RUNBOOK.md §11`.

#### Carried in critique only (P2/P3 — recorded for trend, not blocking)

<!-- Entries here are appended by the triage workflow per critique run. Format:
     - <artifact-timestamp> <slug> · <finding-title> · <heuristic-id> · <closed-by-commit-sha-or-"open">
-->

#### Trend

<!-- Entries here are appended by the triage workflow per critique run. Format:
     | YYYY-MM | Target | Score | P0 | P1 | P2 | P3 | Commit |
-->

| Month   | Target             | Score | P0  | P1  | P2  | P3  | Commit                                                                     |
| ------- | ------------------ | ----- | --- | --- | --- | --- | -------------------------------------------------------------------------- |
| 2026-08 | `packages/web`     | 26/32 | 2   | 2   | 2   | 3   | `fb606cb` (Riley back-link + shadcn disavowal), `c2b7e17` (tailwind error) |
| 2026-08 | `packages/api/src` | 12/16 | 0   | 0   | 0   | 0   | `ffd3fcf` (Idempotency-Key + canonical 409), `013ee66` (index.ts distill)  |

**Given** an additional critique run lands (artifact `2026-XX-XX__<slug>.md`)
**When** the triage is committed
**Then** a new row appears in the Trend table above with the new score + finding counts
**And** any closed P0/P1 finding references the closing commit SHA
