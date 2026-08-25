# Surakkha

> A real-time water-safety monitoring and incident-management platform that demonstrates a complete Sensor → Resolution workflow on simulated devices, in 2–4 weeks, designed to be portfolio-defensible.

**Status:** Planning complete; implementation pending. The implementation-readiness gate v3 returns **READY** — 36 / 36 FRs covered, 15 / 15 NFRs covered, 55 stories across 6 epics + Step 0 Foundation Seam, 0 critical issues, 0 major issues, 4 minor (all pre-documented design choices). See [`_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-21.md`](./_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-21.md).

**Last verified on:** 2026-08-21.

**Substrate readiness:** Step 0 Foundation Seam scaffolded — `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`, five workspace packages (`api`, `web`, `simulator`, `shared`, `db`), `docker-compose.yml` with the four services, Dockerfiles per service. `pnpm install && pnpm -r build` is the next action before Story 1.1 lands.

---

## Contents

- [What is Surakkha?](#what-is-surakkha)
- [Quickstart](#quickstart)
- [Demo walkthrough](#demo-walkthrough)
- [What's inside](#whats-inside)
- [Implementation path](#implementation-path)
- [Architecture in 60 seconds](#architecture-in-60-seconds)
- [JWT contract](#jwt-contract)
- [UX in 60 seconds](#ux-in-60-seconds)
- [Tests and coverage](#tests-and-coverage)
- [Environment variables](#environment-variables)
- [Roles and permissions](#roles-and-permissions)
- [Default thresholds](#default-thresholds)
- [Incident state machine](#incident-state-machine)
- [Operational constraints (v1, not durable)](#operational-constraints-v1-not-durable)
- [Deployment plan](#deployment-plan-deferred)
- [Roadmap beyond v1](#roadmap-beyond-v1)
- [License](#license)

---

## What is Surakkha?

Surakkha is a single-process Node 20 backend, a Vite + React frontend, a Postgres 15 database, and a separate simulator process that emits realistic water-quality telemetry over WebSocket. Six simulated devices stream metrics (pH, TDS, turbidity, temperature, chlorine, water level) every 2 seconds; a rules engine fires alerts when a threshold is breached; incidents flow through a seven-state workflow from OPEN to RESOLVED. The named key-journey protagonist is Rahim, an Operator, who acknowledges an alert, assigns a Technician, follows the inspection, and audits the outcome.

The four roles are **Admin**, **Operator**, **Technician**, **Viewer**. The demo runs in 15 minutes on a clean machine: six simulated devices, seven scenarios, a four-column severity-mixed Kanban, a sticky Critical banner for UNSAFE inspection results.

The product is built for Bangladeshi government primary schools, with Bengali typography registered now so a v2 locale is a content drop, not a refactor.

---

## Quickstart

These commands reach the demo state in under 15 minutes on a clean machine. Once implementation lands, this is the path.

**Prerequisites:** Docker, Docker Compose, Git, and Node 20 (only if you want to develop outside the Compose sandbox).

**First-clone setup:** `pnpm install` registers a husky-managed `pre-commit` hook (`.husky/pre-commit`) that runs ESLint on staged `.ts` / `.tsx` files. Skip with `git commit --no-verify` for documented escape-hatch cases — but note the bypass in your PR body. See [CONTRIBUTING.md § Pre-commit lint hook](./CONTRIBUTING.md#pre-commit-lint-hook) for the full convention.

```bash
# 1. Clone
git clone <repo-url> surakkha
cd surakkha

# 2. Environment
cp .env.example .env
# Edit .env and set JWT_SECRET to a random string of 32+ characters.
# The api process fails fast on a missing or weak JWT_SECRET.

# 3. Bring up the stack (db → api → web → simulator)
docker compose up

# 4. Open the dashboard
# http://localhost:8080
# Log in as the seeded Admin user (see Seeded users below).

# 5. Clean up
docker compose down -v
```

### Services and ports

| Service     | Image / Runtime            | Port       | Notes                                                        |
| ----------- | -------------------------- | ---------- | ------------------------------------------------------------ |
| `db`        | `postgres:15`              | 5432       | Volume-mounted data directory. Healthcheck via `pg_isready`. |
| `api`       | Node 20 + Express + Prisma | 3000       | Waits on `db` healthcheck before starting.                   |
| `web`       | Nginx (Vite build)         | 8080       | Single-page app.                                             |
| `simulator` | Node 20                    | (internal) | Same wire contract as a real device.                         |

### Seeded users

Four seeded accounts ship with the demo, one per role:

| Role       | Purpose                                                  |
| ---------- | -------------------------------------------------------- |
| Admin      | Drives scenarios, edits thresholds, browses audit log.   |
| Operator   | Acknowledges incidents, assigns Technicians, resolves.   |
| Technician | Submits inspection results (SAFE / UNSAFE / MONITORING). |
| Viewer     | Read-only access to dashboard and incidents.             |

Credentials are documented in `.env.example`. Change them before any non-local deployment.

---

## Demo walkthrough

The 10-step BRD §13 walkthrough is the operational definition of "v1 done." A presenter can tick each step on a clean machine.

1. Clone the repo.
2. Run `docker compose up`.
3. Open the dashboard.
4. Open `/admin/simulator`, pick a device, select the **`RisingTDS`** scenario, click Start.
5. Within seconds — an alert appears; an incident is auto-created and visible in `/incidents`.
6. Log in as **Operator** — acknowledge the incident; assign a Technician.
7. Log in as **Technician** — mark the incident `Inspecting`; submit result **`UNSAFE`** with a one-line note.
8. The Critical banner fires — every Admin session sees a sticky top-of-page red banner for 24 hours or until acknowledged.
9. Log in as **Operator** — review the Technician's submission; resolve (or reopen).
10. Open `/audit` — every transition is recorded with actor and timestamp.

The climax beat is step 9: the moment the Critical banner clears after the Operator reviews and closes the incident.

### The 7 simulator scenarios

The simulator ships seven scenarios (`Normal`, `RisingTDS`, `TurbiditySpike`, `ChlorineDrop`, `Offline`, `BatteryLow`, `RandomFailure`). One device per scenario is assigned by default across six seeded devices. The seventh scenario is selectable via `/admin/simulator`.

---

## What's inside

The repo ships the full BMAD planning corpus. Every file referenced from this README is committed.

| File / Folder                                                                                                                                                            | Purpose                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/Surakkha-PRD.md`](./docs/Surakkha-PRD.md)                                                                                                                         | Product requirements: 36 FRs, 15 NFRs, 14 P0 feature deep-dives.                                                                    |
| [`docs/Surakkha-BRD.md`](./docs/Surakkha-BRD.md)                                                                                                                         | Business requirements (source for FRs).                                                                                             |
| [`docs/Surakkha-idea-refined.md`](./docs/Surakkha-idea-refined.md)                                                                                                       | Decision log from the brainstorm.                                                                                                   |
| [`docs/architecture.md`](./docs/architecture.md)                                                                                                                         | Build substrate: invariants and seed.                                                                                               |
| [`_bmad-output/planning-artifacts/epics.md`](./_bmad-output/planning-artifacts/epics.md)                                                                                 | 55 stories across 6 epics + Step 0 Foundation Seam.                                                                                 |
| [`_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/`](./_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/)                             | UX spine pair: `DESIGN.md` (visual identity) + `EXPERIENCE.md` (behaviour), 6 promoted key-screen mocks, `.memlog.md` decision log. |
| [`_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-20-v2.md`](./_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-20-v2.md) | Implementation-readiness gate v2 — verdict **READY**.                                                                               |
| `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-20.md`                                                                                          | Earlier v1 report (superseded; 3 blockers resolved).                                                                                |

### The 6 epics

| Epic | Title                  | Stories | FRs / NFRs / ARs / UX-DRs                                                                                             |
| ---- | ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | Auth & User Management | 11      | FR-20..26, AR-4, AR-10, UX-DR-1, UX-DR-2, UX-DR-3, UX-DR-4, UX-DR-6, UX-DR-12, UX-DR-13, UX-DR-15, UX-DR-17, UX-DR-18 |
| 2    | Devices & Telemetry    | 9       | FR-1..10, FR-33..36, AR-1, AR-2, AR-3, AR-5, AR-12, NFR-5, NFR-13, NFR-14, UX-DR-11                                   |
| 3    | Rules & Alerts         | 4       | FR-11..16, AR-6, AR-7                                                                                                 |
| 4    | Incidents & Workflow   | 13      | FR-16..19, FR-27, FR-28 (write), AR-8, AR-9, AR-11, UX-DR-5, UX-DR-9, UX-DR-10 (bell + writes), UX-DR-14              |
| 5    | Reporting & Audit      | 6       | FR-28 (read), FR-29..32, AR-13                                                                                        |
| 6    | Cross-cutting NFRs     | 9       | NFR-1..4, NFR-8, NFR-9, NFR-11, NFR-12, NFR-15, AR-14, AR-15, UX-DR-7, UX-DR-8, UX-DR-16                              |

(Full traceability: every story in `epics.md` carries an explicit "Covers:" line.)

### Step 0 — Foundation Seam

Step 0 is not an epic; it is the cross-cutting foundation every epic imports from but no epic owns. It produces:

| Sub-step | What it delivers                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| F-0.1    | Monorepo scaffold: `packages/{web,api,simulator,shared,db}`; pnpm install + build succeeds on a clean clone.  |
| F-0.2    | `packages/shared` skeleton with five files: `telemetry.ts`, `auth.ts`, `events.ts`, `incident.ts`, `rbac.ts`. |
| F-0.3    | ESLint + Prettier config at the repo root with per-package inheritance. `pnpm lint` succeeds.                 |
| F-0.4    | Docker Compose with the four services (web, api, simulator, db).                                              |
| F-0.5    | README quickstart (this file is the v1 of that contract; NFR-11).                                             |

**Cross-cutting rule (binding for every epic):** No epic may `import type` from another epic's directory. All cross-epic types live in `packages/shared/src` only. The AI coding agent is explicitly bound by this rule; any candidate code that violates it is wrong.

---

## Implementation path

The plan is ready. Implementation lands in **8 slices over 20 working days** (PRD §6 sequencing plan).

| Slice | Name                 | Days | What it delivers                                                                                                                        |
| ----- | -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Skeleton             | 2    | Monorepo, ESLint, Prettier, Docker Compose scaffold, README quickstart.                                                                 |
| 2     | Wire contract        | 2    | `packages/shared/src/telemetry.ts`, `/ingest/{device_id}` WebSocket, deterministic frame processing order.                              |
| 3     | Rules + alerts       | 3    | Three rule types (instant / rate / absence), de-bouncing, nine-row default seed, alert lifecycle, auto-create incident.                 |
| 4     | Incidents + workflow | 3    | Seven-state machine, four-column Kanban projection, sticky SeverityBanner for Admin, Notification writer.                               |
| 5     | Dashboard + sensors  | 3    | Executive dashboard, Leaflet map, live readings table, sensor detail with combined Recharts chart.                                      |
| 6     | Admin surface        | 3    | `/admin/simulator`, `/admin/thresholds`, `/admin/notifications`, `/audit`, CSV export, hourly retention cron.                           |
| 7     | Auth + RBAC          | 2    | JWT + refresh + httpOnly cookie, RBAC middleware, negative RBAC tests, role-aware nav, RBAC denied state.                               |
| 8     | E2E + polish         | 2    | Playwright happy-path, latency SLA test, accessibility audit, comprehension aids (LegendStrip / SeverityShowcase / WalkthroughOverlay). |

**Start here:** Step 0 Foundation Seam (F-0.1 → F-0.5), then Epic 1, Epic 2, ..., Epic 6.

**Wire contract is frozen:** The telemetry frame is `version: 1` and frozen. Any change to it is a contract bump and edits only `packages/shared/src/telemetry.ts`.

---

## Architecture in 60 seconds

- **Single Node process** for api + ingestion + rules + alerts + workflow + cron (architecture invariant I-9).
- **Simulator is a separate Node process** on the same wire contract as a real device (AR-12). No back-door endpoints.
- **Postgres 15 only.** No Redis, no message queue, no time-series database (I-10).
- **HS256 JWT, single secret, no rotation in v1** (I-13, FR-25). The api process fails fast on a missing or weak `JWT_SECRET`.
- **Plain `ws://` WebSocket transport**, no mTLS in v1 (I-14).
- **Hourly cron, max 10,000 rows per run** drives the 30-day retention and 5-minute aggregation (I-15, FR-31/32).
- **Four Docker Compose services**: `web` (Nginx serving the Vite build), `api` (Node 20 + Express + Prisma), `simulator` (Node 20), `db` (Postgres 15).

For the full substrate, see [`docs/architecture.md`](./docs/architecture.md). For the v1 operational constraints register (the "do not mistake v1 simplifications for durable decisions" doc), see [`docs/architecture-appendix-opconstraints.md`](./docs/architecture-appendix-opconstraints.md) — produced by Story 6.7.

---

## JWT contract

**v1 uses HS256 with a single `JWT_SECRET`. No key rotation. v2 may introduce JWKS / RS256.**

The api process loads exactly one signing key from `process.env.JWT_SECRET`. The api process fails fast (`exit(1)`) at startup if the secret is missing, empty, or shorter than 32 characters — there is no degraded mode and no unsigned-fallback. Access tokens carry `iss: "surakkha-api"`, `aud: "device"` or `aud: "simulator"` or `aud: "user"`, `sub: <uuid>`, an optional `role` claim, and an 8-hour expiry. Refresh tokens are httpOnly cookies scoped to the api origin with `SameSite=Strict`.

Rotation is **not** a v1 capability. The api source tree contains an invariant test ([`packages/api/__tests__/auth.no-rotation.spec.ts`](./packages/api/__tests__/auth.no-rotation.spec.ts), Story 1.10) that walks every api source file and asserts no rotation-related env var is referenced — `JWT_PUBLIC_KEY`, `JWT_PRIVATE_KEY`, `JWT_KEY_SET`, `JWT_KEY_ID`, `JWT_ALGORITHM`, `JWT_KEY_ROTATION_INTERVAL`. A future change that wants to introduce JWKS / RS256 must:

1. Bump the wire contract to `version: 2` (see `packages/shared/src/auth.ts`).
2. Update the operational constraints register — relax constraint [I-13](./docs/architecture-appendix-opconstraints.md#i-13--hs256-single-secret-no-rotation) from "single secret, no rotation" to "JWKS-driven RS256 with rotation".
3. Update the PR description with a v2-bump justification that names the wire-contract bump, the operational-constraint change, and the migration path for issued tokens (existing access tokens issued under the old key must continue to verify or be revoked).

For the v1 operational constraint and the "do not mistake" warning, see [`docs/architecture-appendix-opconstraints.md` I-13](./docs/architecture-appendix-opconstraints.md#i-13--hs256-single-secret-no-rotation).

---

## UX in 60 seconds

- **Critical-first visual hierarchy.** Critical saturates red and pulses; warning glows amber; healthy is calm green.
- **Two distinct pulses.** A persistent **1500 ms critical pulse** on critical KPI / LiveReadingRow / SeverityBanner is the steady-state severity heartbeat. A transient **1200 ms per-update glow** fires on every `reading:new` socket update and is a per-update affordance, not a continuous pulse. The map pin halo pulses at **2000 ms**.
- **Dark sidebar + light canvas.** The sidebar surface is `#0F172A` with light text; the main canvas is `#F5F7F9`.
- **14 routes** across 3 nav groups: **Monitor** (Dashboard, Sensors, Incidents, Alerts), **Operate** (Reports, Audit), **Admin** (Simulator, Notifications, Thresholds, Users, Schools).
- **Four-column severity-mixed Kanban** at `/incidents`: `Open · Critical` · `Open · Warning` · `Acknowledged` · `Resolved`. The columns are a derived projection over the seven-state machine, not stored state.
- **`prefers-reduced-motion: reduce`** disables the continuous critical pulse, the map pin pulse, and the banner fade-in. Severity is still conveyed by colour, text, and icon.
- **No manual theme toggle in v1.** Light + dark themes honour system preference. Manual toggle is a v2 polish.

For the visual identity, see [`DESIGN.md`](./_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/DESIGN.md). For the behavioural contract (component patterns, state patterns, key flows, accessibility floor), see [`EXPERIENCE.md`](./_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/EXPERIENCE.md). Six rendered HTML key-screen mocks (dashboard, incident detail, admin simulator, login, sensor detail, incident Kanban) live in [`mockups/`](./_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/mockups/).

---

## Tests and coverage

- **Backend ≥ 70% line coverage; frontend ≥ 50%** enforced in CI (NFR-12, Story 6.5).
- **Playwright happy path** (`__tests__/e2e/happy-path.spec.ts`) drives the full demo story: log in as Operator → see a reading → trigger `RisingTDS` → see the alert → acknowledge → assign a Technician → submit `UNSAFE` → see the SeverityBanner → resolve the incident. Runs in under 60 seconds.
- **Telemetry-to-alert latency test** (`__tests__/e2e/latency.spec.ts`) asserts the **< 3 seconds** end-to-end alert SLA (NFR-1, Story 6.9). Uses a 2.8-second assertion on a 3-second SLA so the test does not flake.
- **Negative RBAC tests** (`__tests__/rbac.negative.spec.ts`) cover at least 10 negative cases — Technician accessing another Technician's incident, Viewer creating an incident, Operator accessing the audit log, and so on (FR-21, Story 1.8).
- **Audit-coverage tests** (`__tests__/audit.coverage.spec.ts`) assert at least 8 cases: state changes, threshold changes, simulator events, RBAC denials (FR-30, Story 5.6).
- **60-second comprehension test** (`docs/demo-script.md`) verifies a fresh reviewer understands the workflow in one minute (NFR-8, Story 6.8).
- **Accessibility audit** (`__tests__/a11y.reduced-motion.spec.ts` plus axe-core) enforces WCAG 2.1 AA on every page (UX-DR-16, Story 6.4).

---

## Environment variables

| Variable           | Required | Purpose                                                                                               |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`       | Yes      | HS256 signing secret. Must be ≥ 32 characters. The api process fails fast on missing or weak secrets. |
| `DATABASE_URL`     | Yes      | Postgres connection string for Prisma.                                                                |
| `SIMULATOR_SECRET` | Yes      | Gates `/admin/simulator`; without it the page renders "Simulator disabled. Set SIMULATOR_SECRET."     |
| `RETENTION_CRON`   | No       | Hourly cron schedule for the retention/aggregation job (default: hourly).                             |
| `POSTGRES_USER`    | Yes      | Postgres username (used by the `pg_isready` healthcheck).                                             |
| `POSTGRES_DB`      | Yes      | Postgres database name (used by the `pg_isready` healthcheck).                                        |

`.env.example` ships with all required keys. Copy it to `.env` and edit before running `docker compose up`.

---

## Roles and permissions

Four roles, enforced server-side as `(subject, action, resource)` on every endpoint via a single `authorize.ts` middleware (architecture §8.3, Story 1.5). No implicit "Admin can do everything" — every grant is explicit.

| Role       | What they can do                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Admin      | Drives scenarios, edits thresholds, browses audit log, manages users, sees the SeverityBanner. |
| Operator   | Acknowledges incidents, assigns Technicians, resolves incidents, exports CSV.                  |
| Technician | Submits inspection results (SAFE / UNSAFE / MONITORING). Sees only their assigned incidents.   |
| Viewer     | Read-only access to the dashboard and incident Kanban.                                         |

The full RBAC matrix lives at `docs/architecture-appendix-rbac.md` (Story 1.1 deliverable). Direct URL hits to forbidden routes render a calm full-page empty state: "You don't have access to this page. Contact an Admin." Sidebar items are hidden entirely when the user lacks permission.

---

## Default thresholds

The rules engine ships with **nine** default thresholds seeded from BRD §8.3.1 (WHO / BSTI source of truth). These are global rules (device_id IS NULL); Admins can override any rule per device.

| Metric           | Operator | Threshold | Severity |
| ---------------- | -------- | --------- | -------- |
| `ph`             | `<`      | 6.5       | critical |
| `ph`             | `>`      | 8.5       | critical |
| `tds_ppm`        | `>=`     | 300       | warning  |
| `tds_ppm`        | `>=`     | 1000      | critical |
| `turbidity_ntu`  | `>`      | 5         | critical |
| `chlorine_ppm`   | `<`      | 0.2       | critical |
| `chlorine_ppm`   | `>`      | 1.5       | warning  |
| `temp_c`         | `>`      | 45        | warning  |
| `water_level_cm` | `<`      | 20        | warning  |

The server does not compute defaults at runtime — these are seeded into the `Rule` table on a fresh database and the engine reads from there. Editing a rule via `/admin/thresholds` versions the row (`version` increments), preserves the previous row for audit, and writes an `AuditLog` row.

---

## Incident state machine

The authoritative state machine has seven states (architecture §5.1, Story 4.2):

```
OPEN → ACKNOWLEDGED → INSPECTING → { SAFE | UNSAFE | MONITORING } → RESOLVED
                                                                       │
                                                                       ▼
                                                              (Admin comment of severity=critical)
                                                                       │
                                                                       ▼
                                                                     OPEN
```

The Kanban at `/incidents` is a **derived projection** (Story 4.3), not a stored state:

| Kanban column     | What lands here                                                                 |
| ----------------- | ------------------------------------------------------------------------------- |
| `Open · Critical` | `OPEN` incidents with severity critical.                                        |
| `Open · Warning`  | `OPEN` incidents with severity warning.                                         |
| `Acknowledged`    | `ACKNOWLEDGED` / `INSPECTING` / `SAFE` / `UNSAFE` / `MONITORING` (in-progress). |
| `Resolved`        | `RESOLVED`.                                                                     |

Every transition records an `IncidentEvent` with `actor_user_id`, `type`, `payload`, and `created_at`. Invalid transitions return `409 invalid_state_transition` and write a `__invalid_transition_attempt` audit row.

---

## Operational constraints (v1, not durable)

These are deliberate v1 simplifications. The AI coding agent must not mistake any of them for durable decisions — they may be relaxed in v2 without a contract bump.

| ID   | Constraint              | v1 posture                                                         | v2 may relax by …                                    |
| ---- | ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| I-9  | Single Node process     | api + ingestion + rules + alerts + workflow + cron in one process. | Introduce pub/sub layer; split ingestion from rules. |
| I-10 | Postgres only           | No Redis, no message queue, no time-series database.               | Add a message queue; consider TSDB for readings.     |
| I-13 | HS256 single secret     | One `JWT_SECRET` env var, no key rotation, fail-fast on weak.      | Move to JWKS / RS256 with rotation.                  |
| I-14 | Plain `ws://` transport | No mTLS, no per-frame signing.                                     | Add mTLS; add per-frame signing.                     |
| I-15 | Hourly cron retention   | Max 10,000 rows per run; cursor-based; idempotent.                 | Continuous aggregation worker.                       |

The full register with "do not mistake for durable" warnings per constraint lives at [`docs/architecture-appendix-opconstraints.md`](./docs/architecture-appendix-opconstraints.md) (Story 6.7 deliverable).

---

## Deployment plan (deferred)

Deployment is intentionally deferred until the project ships. The decision space, hosting matrix, and concrete next steps are tracked in [`docs/deployment.md`](./docs/deployment.md). TL;DR — the recommended path when we're ready is **Vercel (web SPA) + Fly.io (api + simulator) + Neon (Postgres)** — all three have permanent free tiers, the architecture maps1:1 onto what we already have, and Fly is the only platform that lets Socket.IO run free without 5-min reconnects. Three open questions for the user are listed in §7 of that doc.

---

## Roadmap beyond v1

The following items are explicitly deferred from v1:

| Item                                | Source      | v2 posture                                                            |
| ----------------------------------- | ----------- | --------------------------------------------------------------------- |
| Per-frame cryptographic signing     | NFR-7       | Sign each frame; verify on ingest.                                    |
| Hash-chained audit log immutability | NFR-7       | Tamper-evident audit chain.                                           |
| JWKS / RS256 with rotation          | FR-25, I-13 | Multi-key JWT verification; rotation policy.                          |
| Bengali locale content (`bn`)       | NFR-10      | Tailwind tokens already registered; locale content is a content drop. |
| SSO / MFA                           | FR-26       | Federation with the Ministry of Education identity provider.          |
| Manual light/dark theme toggle      | UX-DR-17    | User-controlled theme switcher.                                       |
| Search across surfaces              | UX IA       | Global search across devices, alerts, incidents, audit.               |
| Drag-to-reorder Kanban              | UX-DR-9     | Drag-and-drop cards between Kanban columns.                           |

---

## License

_To be filled by the project owner._

---

**Last verified on:** 2026-08-20.
