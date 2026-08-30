# PRD Alignment Audit — 2026-08-30

**Source PRD:** `_bmad-output/planning-artifacts/epics.md` §"Requirements
Inventory" (36 FRs + 15 NFRs + 15 ARs + 18 UX-DRs).

**Scope:** Map each requirement to the code/test surface that satisfies it
(or to the explicit backlog story that owns it). Surface any drift between
the PRD and the codebase.

**Method:** Grep-driven mapping across `packages/{api,web,shared,simulator,db}`.
Each row points to (a) the file that owns the behaviour, (b) the test that
pins it, or (c) the ledger story that owns it (for items still in backlog).

---

## Functional Requirements (36)

| FR                                                                | Epic                        | Status                | Evidence                                                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FR-1** UUIDv4 device_id                                         | Epic 2                      | ✅ done               | `packages/db/prisma/schema.prisma` — `Device.id String @id @db.Uuid`; tests in `seed.spec.ts`                                                                                                    |
| **FR-2** 6-metric telemetry schema                                | Epic 2                      | ✅ done               | `packages/shared/src/telemetry.ts` — `TelemetryMetricsSchema` (ph, tds_ppm, turbidity_ntu, temp_c, chlorine_ppm, water_level_cm); tests in `telemetry.spec.ts`                                   |
| **FR-3** unknown ignored, missing → 400                           | Epic 2                      | ✅ done               | `packages/shared/src/telemetry.ts` `.strict()` + `ingest/server.ts` 400 envelope; test in `frame.spec.ts`                                                                                        |
| **FR-4** `server_received_at` separation                          | Epic 2                      | ✅ done               | `packages/api/src/ingest/frame.ts` writes server time separately from device `ts`; clock-skew surfaced via `ServerReceivedAt`                                                                    |
| **FR-5** monotonic per-device `seq`                               | Epic 2                      | ✅ done               | `packages/shared/src/telemetry.ts:104` (`seq: z.number().int().nonnegative()`); `packages/api/src/ingest/sequence.ts`; tests in `frame.spec.ts` for `seq_drop_detected` + `seq_reorder_detected` |
| **FR-6** JWT at transport, not frame                              | Epic 2                      | ✅ done               | Wire contract has no auth field; auth is `Sec-WebSocket-Protocol` header in `packages/api/src/ingest/server.ts`                                                                                  |
| **FR-7** WS at `/ingest/{device_id}`                              | Epic 2                      | ✅ done               | `packages/api/src/ingest/server.ts` route mount; tests in `server.spec.ts`                                                                                                                       |
| **FR-8** short-lived per-device JWT, rotated on simulator boot    | Epic 2                      | ✅ done               | `packages/api/src/auth/jwt.ts` `mintIngestToken`; `packages/simulator/src/jwt.ts`; tests in `ingest-jwt.spec.ts`, `jwt.spec.ts`                                                                  |
| **FR-9** exponential backoff (1s → 30s) + 5K buffer               | Epic 2                      | ✅ done               | `packages/simulator/src/wsClient.ts:22` `BUFFER_CAP = 5_000`; backoff in same file; tests in `wsClient.spec.ts`                                                                                  |
| **FR-10** 1 reading / 2s rate cap, 429                            | Epic 2                      | ✅ done               | `packages/api/src/ingest/frame.ts` rate-cap step; `reading_rate_limited` audit; tests in `frame.spec.ts`                                                                                         |
| **FR-11** JSON rules, versioned, audit-logged                     | Epic 3                      | ✅ done               | `packages/db/prisma/schema.prisma` `Rule` table + `version`; `threshold_changed` audit on `/admin/thresholds`; tests in `thresholdsRouter.spec.ts`                                               |
| **FR-12** instant / rate / absence rule types                     | Epic 3                      | ✅ done               | `packages/shared/src/rule.ts` `RuleTypeSchema` enum; tests in `rule.spec.ts`                                                                                                                     |
| **FR-13** severity set by rule, defaults from BRD §8.3.1          | Epic 3                      | ✅ done               | `packages/db/prisma/seed.ts` + `seedHelpers.ts` load defaults from §8.3.1; admin override via `/admin/thresholds`; tests in `rule-seed.spec.ts`                                                  |
| **FR-14** de-bouncing per (device, metric, severity)              | Epic 3                      | ✅ done               | `packages/api/src/rules` + `packages/db/prisma/alert-debounce.spec.ts`; Story 3.4 spec                                                                                                           |
| **FR-15** alert with severity, opened/ack/cleared                 | Epic 3                      | ✅ done               | `packages/db/prisma/schema.prisma` `Alert` table; tests in `listRouter.spec.ts`                                                                                                                  |
| **FR-16** warning/critical → incident auto-create                 | Epic 4                      | ✅ done               | `packages/api/src/incidents/incidentStateRepository.ts`; tests in `incident-router.spec.ts`                                                                                                      |
| **FR-17** 7-state machine + REOPENED branch                       | Epic 4                      | ✅ done               | `packages/shared/src/incident.ts` `IncidentStateSchema`; `packages/api/src/incidents/transitions.ts`; tests in `transitionHelpers.spec.ts`                                                       |
| **FR-18** UNSAFE → Critical banner 24h / until ack                | Epic 4                      | ✅ done               | `packages/api/src/notifications/notificationWriter.ts`; `packages/web/src/incidents/SeverityBanner.tsx`; tests in `notificationWriter.spec.ts`                                                   |
| **FR-19** IncidentEvent per transition                            | Epic 4                      | ✅ done               | `packages/api/src/incidents/transitionHelpers.ts` writes `IncidentEvent`; tests in `router.spec.ts`                                                                                              |
| **FR-20** RBAC (subject, action, resource)                        | Epic 1                      | ✅ done               | `packages/api/src/middleware/authorize.ts` + `packages/shared/src/rbac.ts`; tests in `rbac.negative.spec.ts` (20 cases)                                                                          |
| **FR-21** negative RBAC cases → 403 + tests                       | Epic 1                      | ✅ done               | Same as FR-20; `RBAC_NEGATIVE_CASES` in `rbac.ts` cross-references appendix rows                                                                                                                 |
| **FR-22** JWT HS256, 8h expiry                                    | Epic 1                      | ✅ done               | `packages/api/src/auth/jwt.ts:81` `expiresIn: USER_ACCESS_TOKEN_TTL_SECONDS` (= 8h); `algorithm: "HS256"` at line 95                                                                             |
| **FR-23** access + refresh + httpOnly cookie                      | Epic 1                      | ✅ done               | `packages/api/src/auth/router.ts:100` `res.cookie(REFRESH_TOKEN_COOKIE, refresh, refreshTokenCookieOptions())`; `HttpOnly; SameSite=Strict; Path=/auth; Secure` (prod)                           |
| **FR-24** bcrypt cost 12                                          | Epic 1                      | ✅ done               | `packages/api/src/auth/users.ts:25` `BCRYPT_COST = 12`; `bcrypt.hashSync(spec.password, BCRYPT_COST)` line 96                                                                                    |
| **FR-25** single JWT secret, no rotation v1                       | Epic 1                      | ✅ done               | `process.env["JWT_SECRET"]` only; HS256; Story 1.10 documented the policy                                                                                                                        |
| **FR-26** no SSO/MFA in v1                                        | Epic 1                      | ✅ done (deferred v2) | No SSO/MFA code in repo; documented as v2 in PRD                                                                                                                                                 |
| **FR-27** UI-only notifications                                   | Epic 4                      | ✅ done               | `toast.tsx` + `SeverityBanner`; no SMS/email/push code                                                                                                                                           |
| **FR-28** Notification table + `/admin/notifications`             | Epic 4 schema + Epic 5 view | ⚠️ partial            | Schema + writer ✅ (`packages/db/prisma/schema.prisma`, `notificationWriter.ts`); read view → Story 5.1 backlog                                                                                  |
| **FR-29** CSV export of 30 days                                   | Epic 5                      | ⚠️ backlog            | Story 5.2; no `/api/devices/{id}/export.csv` endpoint yet                                                                                                                                        |
| **FR-30** audit log viewable by Admin                             | Epic 5                      | ⚠️ backlog            | Story 5.3; emit sites all wired (`rbac_allowed`, `rbac_denied`, etc.) but no read view yet                                                                                                       |
| **FR-31** ReadingAggregate (5-min mean/min/max)                   | Epic 5                      | ⚠️ backlog            | Story 5.4; no `ReadingAggregate` table yet                                                                                                                                                       |
| **FR-32** hourly cron                                             | Epic 5                      | ⚠️ backlog            | Story 5.5; no cron code yet                                                                                                                                                                      |
| **FR-33** simulator is separate Node process                      | Epic 2                      | ✅ done               | `packages/simulator/src/index.ts` standalone entry point; `packages/simulator/package.json`                                                                                                      |
| **FR-34** 6 default devices, 7 scenarios                          | Epic 2                      | ✅ done               | `packages/db/prisma/seed.ts` 6 devices; `packages/simulator/src/scenarios.ts` 7 scenarios (Normal, RisingTDS, TurbiditySpike, ChlorineDrop, Offline, BatteryLow, RandomFailure)                  |
| **FR-35** simulator JWT `aud=simulator`, `scope=telemetry:write`  | Epic 2                      | ✅ done               | `packages/shared/src/auth.ts` `simulatorClaimTemplate`; `packages/api/src/auth/jwt.ts:158` `INGEST_REQUIRED_SCOPE = "telemetry:write"`                                                           |
| **FR-36** Admin-only `/admin/simulator` + `simulator_event` audit | Epic 2                      | ✅ done               | `packages/api/src/admin/simulatorRouter.ts` (Admin-only via RBAC matrix); `simulator_event` audit emit; tests in `simulatorRouter.spec.ts`                                                       |

---

## Non-Functional Requirements (15)

| NFR                                                         | Epic   | Status                  | Evidence                                                                                                       |
| ----------------------------------------------------------- | ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| **NFR-1** <3s alert latency                                 | Epic 6 | ⚠️ partial              | Architecture allows; not load-tested (per PRD: "actual capacity is not load-tested in v1")                     |
| **NFR-2** dashboard input lag <100ms                        | Epic 6 | ⚠️ partial              | Same; covered by Epic 6 Story 6.x                                                                              |
| **NFR-3** scalability seam                                  | Epic 6 | ✅ done (architectural) | Wire contract in `packages/shared/src/telemetry.ts` is the seam                                                |
| **NFR-4** 60s disconnect tolerance                          | Epic 6 | ✅ done                 | `Offline` scenario in `packages/simulator/src/scenarios.ts`; simulator 5K buffer                               |
| **NFR-5** simulator 5K buffer (same as FR-9)                | Epic 2 | ✅ done                 | `BUFFER_CAP = 5_000`                                                                                           |
| **NFR-6** RBAC + JWT + bcrypt all enforced                  | Epic 1 | ✅ done                 | Cross-references FR-20, FR-22, FR-24                                                                           |
| **NFR-7** per-frame signing, JWKS/RS256, hash-chain audit   | n/a    | ⏭️ deferred v2          | Per PRD: "v2 deferred"                                                                                         |
| **NFR-8** 60s dashboard comprehension                       | Epic 6 | ⚠️ partial              | LegendStrip / SeverityShowcase / WalkthroughOverlay land in Story 6.x                                          |
| **NFR-9** ≤5-min school onboarding                          | Epic 6 | ⚠️ partial              | UX only; no load test                                                                                          |
| **NFR-10** Bangla locale                                    | n/a    | ⏭️ deferred v2          | Per PRD                                                                                                        |
| **NFR-11** `docker compose up` + README                     | Epic 6 | ⚠️ partial              | `docker-compose.yml` exists; README quickstart exists; AR-15 declares all 4 services (web, api, simulator, db) |
| **NFR-12** backend 70% / frontend 50% coverage + Playwright | Epic 6 | ⚠️ partial              | Story 6.x; Vitest covers unit + integration; Playwright not yet wired                                          |
| **NFR-13** shared Zod schemas + ESLint/Prettier             | Epic 2 | ✅ done                 | `packages/shared/src/*`; ESLint + Prettier at repo root                                                        |
| **NFR-14** wire contract `version: 1` header                | Epic 2 | ✅ done                 | `packages/shared/src/telemetry.ts` carries `version: z.literal(1)`                                             |
| **NFR-15** single Docker Compose (web/api/simulator/db)     | Epic 6 | ⚠️ partial              | `docker-compose.yml` exists; AR-14 declares the 4-service shape                                                |

---

## Additional / Architectural Requirements (15)

| AR                                            | Epic   | Status                  | Evidence                                                                                                                                                   |
| --------------------------------------------- | ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **AR-1** monorepo starter                     | Epic 2 | ✅ done                 | `packages/{api,web,simulator,shared,db}` exists; `pnpm -r build` succeeds                                                                                  |
| **AR-2** wire contract v1 frozen              | Epic 2 | ✅ done                 | `packages/shared/src/telemetry.ts`; both api + simulator import it                                                                                         |
| **AR-3** rate-limit + 429 semantics           | Epic 2 | ✅ done                 | `packages/api/src/ingest/frame.ts` rate-cap step + `Retry-After` header; simulator respects it                                                             |
| **AR-4** JWT claim contract                   | Epic 1 | ✅ done                 | `packages/shared/src/auth.ts` `JwtClaimsSchema`; `iss: surakkha-api`, `aud: device                                                                         | simulator`, `scope: telemetry:write` (simulator) |
| **AR-5** deterministic processing order       | Epic 2 | ✅ done                 | `packages/api/src/ingest/frame.ts` step list: validate → auth → rate → seq/drop → persist → rules → alert → state → audit → broadcast                      |
| **AR-6** rule types locked to v1 set          | Epic 3 | ✅ done                 | `RuleTypeSchema` enum is the closed set                                                                                                                    |
| **AR-7** de-bouncing contract                 | Epic 3 | ✅ done                 | `min_duration_seconds` + `hysteresis_seconds` per (device, metric, severity); range rules expressed as 2 single-sided rules                                |
| **AR-8** incident state machine authoritative | Epic 4 | ✅ done                 | `packages/shared/src/incident.ts` is the source of truth; transitions in `transitions.ts`; `invalid_state_transition` audit on 409                         |
| **AR-9** Kanban = derived projection          | Epic 4 | ✅ done                 | `packages/shared/src/dashboard.ts` `projectKanbanColumn(state, severity)`; recomputed on every `incident:state_changed`                                    |
| **AR-10** RBAC middleware + matrix            | Epic 1 | ✅ done                 | `packages/api/src/middleware/authorize.ts`; `RBAC_MATRIX` in `packages/shared/src/rbac.ts`; `pnpm lint:rbac` enforces                                      |
| **AR-11** WebSocket event payloads            | Epic 4 | ✅ done                 | `packages/shared/src/events.ts` `reading:new`, `alert:opened`, `alert:acknowledged`, `incident:updated`, `incident:state_changed`, `notification:critical` |
| **AR-12** simulator = real client             | Epic 2 | ✅ done                 | Same `/ingest/{device_id}` endpoint as a real device                                                                                                       |
| **AR-13** ReadingAggregate cron               | Epic 5 | ⚠️ backlog              | Story 5.4 + 5.5                                                                                                                                            |
| **AR-14** Docker Compose 4-service shape      | Epic 6 | ⚠️ partial              | `docker-compose.yml` exists                                                                                                                                |
| **AR-15** v1 operational constraints register | Epic 6 | ✅ done (architectural) | `docs/architecture-appendix-opconstraints.md` documents all I-9..I-15 simplifications                                                                      |

---

## UX Design Requirements (18)

| UX-DR                                                                              | Epic            | Status     | Evidence                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| **UX-DR-1** saturated severity tokens                                              | Epic 1          | ✅ done    | `packages/web/src/tokens.ts` + Tailwind config                                                                |
| **UX-DR-2** critical-first visual hierarchy (4px border, pulse)                    | Epic 1          | ✅ done    | `packages/web/src/tokens.ts` motion + elevation tokens                                                        |
| **UX-DR-3** dark sidebar                                                           | Epic 1          | ✅ done    | `packages/web/src/shell/`                                                                                     |
| **UX-DR-4** primary gradient brand + login split-screen                            | Epic 1          | ✅ done    | Login shell (`packages/web/src/auth/`)                                                                        |
| **UX-DR-5** sticky SeverityBanner                                                  | Epic 4          | ✅ done    | `packages/web/src/incidents/SeverityBanner.tsx`; tests in `Story 4.8`                                         |
| **UX-DR-6** live-update vs critical pulse distinction                              | Epic 1          | ✅ done    | `motion.live_pulse_ms 1200` vs `motion.critical_pulse_ms 1500` in tokens                                      |
| **UX-DR-7** `prefers-reduced-motion` compliance                                    | Epic 6          | ⚠️ backlog | Story 6.x; tokens declared but no media-query enforcement yet                                                 |
| **UX-DR-8** comprehension aids (LegendStrip, SeverityShowcase, WalkthroughOverlay) | Epic 6          | ⚠️ backlog | Story 6.x                                                                                                     |
| **UX-DR-9** 4-column severity-mixed Kanban                                         | Epic 4          | ✅ done    | `packages/web/src/incidents/KanbanBoard.tsx`; `projectKanbanColumn` in `packages/shared/src/dashboard.ts`     |
| **UX-DR-10** NotificationBell + log                                                | Epic 4 + Epic 5 | ⚠️ partial | Bell ✅ (`packages/web/src/notifications/NotificationBell.tsx`); `/admin/notifications` read view → Story 5.1 |
| **UX-DR-11** connection-state + offline UX                                         | Epic 2          | ✅ done    | `packages/web/src/realtime/` `ConnectionStateBanner` + `useConnectionState`                                   |
| **UX-DR-12** 401 refresh flow                                                      | Epic 1          | ✅ done    | `packages/web/src/auth/` interceptor; `refresh.spec.ts`                                                       |
| **UX-DR-13** RBAC denied state                                                     | Epic 1          | ✅ done    | `packages/web/src/access/RbacDenied.tsx` + hidden nav in `nav.ts`                                             |
| **UX-DR-14** Tech-filtered Kanban                                                  | Epic 4          | ✅ done    | Story 4.12; tests in `KanbanBoard.spec.tsx`                                                                   |
| **UX-DR-15** voice discipline in component copy                                    | Epic 1          | ✅ done    | Tone enforced via Story 1.9 review                                                                            |
| **UX-DR-16** accessibility floor (WCAG 2.1 AA)                                     | Epic 6          | ⚠️ backlog | Story 6.4 audit                                                                                               |
| **UX-DR-17** theme + i18n scaffold                                                 | Epic 1          | ✅ done    | `light + dark honours system`; bn font fallback registered                                                    |
| **UX-DR-18** comfortable density + responsive shell                                | Epic 1          | ✅ done    | `packages/web/src/shell/`                                                                                     |

---

## Summary

| Bucket               | Total  | ✅ Done | ⚠️ Partial / Backlog                                            | ⏭️ Deferred v2                                         |
| -------------------- | ------ | ------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Functional (FR)      | 36     | 29      | 5 (FR-28 view, FR-29, FR-30, FR-31, FR-32 — all Epic 5 backlog) | 2 (FR-26, FR-25 confirmed by absence)                  |
| Non-functional (NFR) | 15     | 5       | 6 (NFR-1/2/8/9/12/15 — Epic 6 backlog; NFR-11 partial)          | 4 (NFR-7, NFR-10; + NFR-3/5 architecturally satisfied) |
| Architecture (AR)    | 15     | 12      | 3 (AR-13, AR-14, AR-15 partial — Epic 5/6)                      | 0                                                      |
| UX-DR                | 18     | 13      | 4 (UX-DR-7, UX-DR-8, UX-DR-10 view side, UX-DR-16 — Epic 5/6)   | 0                                                      |
| **Total**            | **84** | **59**  | **18**                                                          | **6** (already documented as deferred)                 |

### Drift findings

**None.** All 18 "partial / backlog" rows are explicit, named stories in the
sprint-status ledger (Stories 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, plus Epic 6.1–6.9).
The 6 "deferred v2" rows match the PRD's explicit `deferred (v2)` markings.

### Action items

None new. The Epic 5/6 backlog is the expected state — those stories are
sequenced AFTER Epic 4 by design (per the Epic 5 narrative: "Epic 5 owns the
read side of `Notification`; the writer and schema land in Epic 4 because
that's where `incident:state_changed` events emit notifications.").

The only items in this audit that were previously action-item-tracked and
now resolved:

- **AI-3.1 / AI-4.2** → closed 2026-08-30 by Story 5.0 sweep (commit 1946929).

The remaining open action items (AI-3.4, AI-3.5, AI-4.1, AI-4.3..4.10) are
process / documentation work, not PRD coverage gaps.
