---
title: 'Story 2.5 — /admin/simulator Admin Tab'
type: 'feature'
created: '2026-08-22'
status: 'done'
review_loop_iteration: 1
baseline_commit: '6dffb1b' # feat(simulator): Story 2.4 — process + six default devices + seven scenarios
context:
  - docs/architecture.md#6-simulator-contract
  - docs/architecture.md#7-admin-operations
  - _bmad-output/planning-artifacts/epics.md#story-25
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.4 ships the simulator process and six devices, but the only way to switch scenarios is editing `devices.json` and restarting the process — useless for a demo or for an on-call Admin responding to a real incident. The audit trail for scenario changes does not exist.

**Approach:** Add an `Admin → Simulator` tab at `/admin/simulator` that lists the six devices with their current scenario and exposes per-device Start / Pause / Switch-scenario controls. All switches are POSTed to a new `/admin/simulator/{device_id}/scenario` api endpoint, which authenticates the simulator over a new `SIMULATOR_SECRET` symmetric channel and writes an `AuditLog` row (`auditAction: "simulator_event"`, payload `{ device_id, scenario }`). When `SIMULATOR_SECRET` is unset on either side the controls render in a calm disabled state with copy "Simulator disabled. Set SIMULATOR_SECRET."

## Boundaries & Constraints

**Always:**
- RBAC gate `authorize({ action: "drive", resource: "Simulator" }, audit)` — Admin-only, non-admins hit Story 1.6's `<RbacDenied />` and the api returns 403.
- `SIMULATOR_SECRET` is a symmetric secret shared by api and simulator. The api sends it as `X-Simulator-Secret` on the control request; the simulator compares with `crypto.timingSafeEqual`. Missing/short on either side → disabled state, never fail-fast exit.
- One `AuditLog` row per action with `auditAction: "simulator_event"`, `actor_user_id` from the JWT, `payload: { device_id, scenario }`. The enum member `simulator_event` is already declared at `packages/shared/src/rbac.ts:409` — no schema change.
- Device list sourced from the same six deterministic UUIDv4 device IDs in `packages/simulator/src/devices.json:1-29`. Add a `Device.name` and `Device.scenario` column to the Prisma schema so the api can serve the listing without re-reading the simulator's local file.
- Scenario switch must apply on the device within 5 s of the api's POST returning 200.

**Ask First:**
- Whether to also expose a Pause/Resume primitive on top of Start (the AC says "Start / Pause / Switch scenario"; Pause semantics — pause the tick loop vs. close the socket — must be confirmed before coding).
- Whether `AuditLog` becomes a real Prisma model in this story (gap-filling) or whether the existing structured-logger `AuditLogger.emit` is sufficient and the api query is read from logs.

**Never:**
- Do not import `@surakkha/api` from `@surakkha/web`. The web app talks to the api over HTTP only.
- Do not import `@surakkha/simulator` from anywhere in `packages/`. The simulator is a separate process; the api reaches it over HTTP.
- Do not introduce WebSocket / Socket.IO for the control channel. Plain HTTPS POST is sufficient for a 1 RPS admin action.
- Do not allow the simulator to push state to the api beyond what the existing telemetry WS already carries. The control channel is api → simulator only.
- Do not add a per-device process. The simulator stays a single Node process with six `WsClient` instances in-memory.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin renders page, secret set | GET `/admin/simulator` | Six rows: device name, current scenario, scenario `<select>`, Start / Pause / Switch buttons | N/A |
| Admin renders page, secret unset on api | GET `/admin/simulator` (api returns 503 with `{ disabled: true }`) | Disabled banner: "Simulator disabled. Set SIMULATOR_SECRET." — no controls rendered | 503 propagates to `<DisabledBanner />` |
| Admin renders page, non-admin role | GET `/admin/simulator` (api returns 403) | Story 1.6 `<RbacDenied />`; no API call beyond the role gate | 403 handled by RbacRoute |
| Admin clicks Switch to RisingTDS | POST `/admin/simulator/{device_id}/scenario` body `{ scenario: "RisingTDS" }` | 200 `{ applied: true }`; new scenario active in ≤5 s; `AuditLog` row written | Api 5xx → toast "Switch failed"; row only written on success |
| Admin clicks Switch, unknown scenario name | POST with `{ scenario: "Bogus" }` | Api 400 `{ error: "invalid_scenario" }`; no write to simulator; no `AuditLog` row | Api validates against `SCENARIO_NAMES` |
| Admin clicks Switch, simulator unreachable | POST returns 502 `{ error: "simulator_unreachable" }` | Toast "Simulator unreachable"; `AuditLog` row NOT written (action did not apply) | Api distinguishes connect-time failure from apply-time failure |
| Admin clicks Switch, simulator rejects secret | POST 403 `{ error: "secret_mismatch" }` | Toast "Simulator disabled." — same banner state as missing secret | Same code path as missing-secret |
| Admin clicks Switch while another switch is in flight (same device) | Second POST within 5 s | Second request is queued (single-flight per device) — never silently dropped | 409 with `{ error: "switch_in_progress" }` if the queue is full |

</frozen-after-approval>

## Code Map

**Web (packages/web)**

- `src/main.tsx:258-269` — `/admin/simulator` route stub already mounted; replace inner `<PageStub>` with the new page component.
- `src/access/RbacRoute.tsx:26-36` — role gate. Story 2.5 reuses as-is.
- `src/access/RbacDenied.tsx:46` — denied-state component, already pinned with testids `rbac-denied*`.
- `src/shell/nav.ts:57-61` — Simulator already in the Admin nav group.
- `src/api/apiClient.ts:191` — `apiFetch(path, init)` auto-Bearer + refresh; reuse for the control POST.
- `src/auth/CurrentRoleContext.tsx:79` — `useCurrentRole()` for client-side role read.
- `src/components/KpiStat.tsx:105` — KPI card primitive; not needed for the device rows but the page chrome follows the same grid pattern (`grid-cols-1 md:grid-cols-2`).
- **Gap**: TanStack Query is declared at `packages/web/package.json:20` but no provider, no query keys convention. Story 2.5 must bootstrap `QueryClient`/`QueryClientProvider` in `main.tsx` (one-time setup) and define keys as `["admin", "simulator", "devices"]` and `["admin", "simulator", "secret-status"]`.

**Api (packages/api)**

- `src/audit.ts:11-17` — `AuditLogger.emit({ auditAction, userId?, outcome, context? })` is the v1 audit contract. Story 2.5 uses this contract; does NOT introduce a Prisma `AuditLog` model unless Ask-First resolves "yes".
- `src/middleware/authorize.ts:189-192` — `authorize({ action, resource }, audit)` factory; the new route uses `{ action: "drive", resource: "Simulator" }` (Admin-only grant at `packages/shared/src/rbac.ts:152-158`).
- `src/middleware/authorize.ts:212-222` — RBAC-deny-path audit emit (`auditAction: "rbac_denied"`); already covers the non-admin case.
- `src/index.ts:69-94` — router mount site. Mount new `/admin/simulator` router with `app.use("/admin/simulator", adminSimulatorRouter)`.
- `src/auth/router.ts:106-110` — success-path audit emit shape; mirror for `simulator_event`.
- `src/__tests__/rbacNegativeRouter.ts:93,172` — pre-existing fixture 403 test for `POST /admin/simulator/x/scenario` with `action: "drive", resource: "Simulator"`. Reuse the fixture, do not duplicate.

**Shared (packages/shared)**

- `src/rbac.ts:409` — `AuditActionSchema` already includes `"simulator_event"`. No schema change.
- `src/rbac.ts:152-158` — Admin-only grant for `drive × Simulator`. No change.
- `src/telemetry.ts` — `SCENARIO_NAMES` is in `@surakkha/simulator/src/scenarios.ts:35-44` (closed enum of 7 names). The api must mirror this for input validation — import from simulator is forbidden, so re-declare the closed Zod enum in `@surakkha/shared/src/simulator.ts` (new file).

**Simulator (packages/simulator)**

- `src/index.ts:239-315` — `boot()` holds a `clients: WsClient[]` array in closure (line 266). The new control server needs a reference to the same array, so move the array into a module-scoped registry that both `boot()` and the new HTTP server can read.
- `src/index.ts:67-75` — `failFast` pattern; do NOT use for `SIMULATOR_SECRET`. Use the discriminated-union `{ ok: true, value } | { ok: false, reason: "missing" }` shape from `src/jwt.ts:40-49` (`resolveJwtSecret`) so the boot can take the env-disabled path.
- `src/index.ts:195-233` — `resolveConfig` siblings. Add `resolveSimulatorSecret(): { ok: true, value: string } | { ok: false; reason: "missing" }` here.
- `src/wsClient.ts:62-84` — `WsClientOptions.scenario` already a constructor param (line 64); runtime swap is a new `setScenario(name: ScenarioName)` method on the `WsClient` class that updates the field — no signature change to the constructor.
- `src/scenarios.ts:35-44` — `SCENARIO_NAMES` is the closed enum for input validation; reuse.
- `src/devices.json:1-29` — six UUIDv4 device IDs are the canonical list; the api's `GET /admin/simulator/devices` response uses these.
- `.env.example:13-18` — `SIMULATOR_SECRET` placeholder already present, including the disabled-state copy. No copy change.

**Database (packages/db)**

- `prisma/schema.prisma:24-31` — current `Device` model has only `id` + `lastSeenAt`. Add `name: String?`, `scenario: String?` (nullable to keep migration safe for existing rows). Migration is a follow-up of Story 2.3's "name + scenario on Device" placeholder comment (`schema.prisma:19-23`).
- **Gap**: No `AuditLog` Prisma model. Story 2.5 writes only via the structured-logger `AuditLogger.emit` (path A). The `AuditLog` table is deferred unless Ask-First resolves "yes".

## Tasks & Acceptance

**Execution:**

- [x] `packages/shared/src/simulator.ts` -- Create -- closed Zod enum of 7 `SCENARIO_NAMES` mirroring `packages/simulator/src/scenarios.ts` so the api can validate input without importing the simulator. Re-export the `ScenarioName` type.
- [x] `packages/shared/src/simulator.spec.ts` -- Tests -- pin the 7 names + reject unknown.
- [x] `packages/db/prisma/schema.prisma` -- Migration -- add `name String?` + `scenario String?` to `Device` (nullable for safe backfill); generate the migration; backfill names from `packages/simulator/src/devices.json` via `prisma/seed.ts`.
- [x] `packages/api/src/admin/simulatorRouter.ts` -- Create -- mount at `/admin/simulator`. Three routes: `GET /devices` (Admin-only via `authorize({ action: "read", resource: "Simulator" }, audit)` — note: Admin.read.Simulator is `N` at `packages/shared/src/rbac.ts:113`, so use a different gate — see Ask-First), `GET /status` (returns `{ enabled: bool }` — bypasses RBAC because disabled-banners must render for unauthenticated users too), `POST /:device_id/scenario` (gated by `authorize({ action: "drive", resource: "Simulator" }, audit)`).
- [x] `packages/api/src/admin/simulatorRouter.spec.ts` -- Tests -- per AC matrix: happy path, 403 (Operator), 400 (Bogus scenario), 502 (simulator unreachable), 503 (secret disabled), 409 (switch_in_progress).
- [x] `packages/api/src/admin/simulatorClient.ts` -- Create -- outbound HTTP client to the simulator control server. `fetch(SIMULATOR_URL, { headers: { "X-Simulator-Secret": SECRET } })` with 5 s timeout. Surface three failure modes as typed errors: `unreachable`, `secret_mismatch`, `unknown`.
- [x] `packages/simulator/src/control/server.ts` -- Create -- inbound HTTP server using Node `http.createServer`. Routes: `POST /admin/simulator/:device_id/scenario`, `GET /admin/simulator/status`. `X-Simulator-Secret` checked with `crypto.timingSafeEqual` against `process.env.SIMULATOR_SECRET` (constant-time). Missing env → `/status` returns `{ enabled: false }` and the POST returns 403.
- [x] `packages/simulator/src/control/server.spec.ts` -- Tests -- pin: secret match accepts; secret mismatch 403; missing env → status disabled; valid POST swaps the WsClient scenario; invalid scenario name 400; unknown device_id 404.
- [x] `packages/simulator/src/wsClient.ts` -- Edit -- add `setScenario(name: ScenarioName): void` setter that updates `this.opts.scenario`. No constructor change. Test seam: `__test__scenario()`.
- [x] `packages/simulator/src/index.ts` -- Edit -- register the new HTTP server alongside `boot()`; lift the `clients[]` array from boot closure into a module-scoped registry so `control/server.ts` can read it; add `resolveSimulatorSecret()` discriminated-union helper.
- [x] `packages/web/src/admin/simulator/SimulatorPage.tsx` -- Create -- replaces the `<PageStub>` at `main.tsx:258-269`. Fetches `GET /admin/simulator/devices` and `GET /admin/simulator/status`. Renders `<DeviceRow />` per device. Each row has: device name, current scenario badge, scenario `<select>` (the 7 SCENARIO_NAMES), Switch button, Start/Pause toggle.
- [x] `packages/web/src/admin/simulator/DeviceRow.tsx` -- Create -- single device control row. Reuses `<KpiStat>`-style chrome (`grid-cols-1 md:grid-cols-2`).
- [x] `packages/web/src/admin/simulator/DisabledBanner.tsx` -- Create -- calm disabled state when `enabled === false`. Copy: "Simulator disabled. Set SIMULATOR_SECRET." Pinned by test.
- [x] `packages/web/src/admin/simulator/useSimulatorDevices.ts` -- Create -- TanStack Query hook: query key `["admin", "simulator", "devices"]`, mutation invalidates the same key.
- [x] `packages/web/src/admin/simulator/SimulatorPage.spec.tsx` -- Tests -- per AC matrix: Admin renders 6 rows; non-admin → RbacDenied; disabled-banners on; Switch posts and shows toast; failure shows toast and does not update UI optimistically.
- [x] `packages/web/src/main.tsx` -- Edit -- replace `<PageStub name="Simulator" />` at line 258 with `<SimulatorPage />`. Wrap the route tree in `<QueryClientProvider>` one time only (cross-cutting bootstrap; one provider for the whole app).
- [x] `packages/web/src/queryClient.ts` -- Create -- single `QueryClient` instance with `staleTime: 5_000`, `retry: 1`. Re-exported for the admin hooks.
- [x] `packages/web/.env.example` -- Edit -- document `VITE_API_BASE_URL` if not already present; pin that the web app does NOT need `SIMULATOR_SECRET` (api → simulator only).
- [x] `.env.example` -- Edit -- confirm `SIMULATOR_SECRET=<min-32-chars>` placeholder already at lines 13-18 covers both api and simulator sides; add a one-liner comment that the secret must match across both services.

**Acceptance Criteria:**

- Given `SIMULATOR_SECRET` is set on api AND simulator, when an Admin renders `/admin/simulator`, then six device rows render with current scenario badges and the full per-device Start / Pause / Switch control set.
- Given `SIMULATOR_SECRET` is unset on either side, when the Admin renders `/admin/simulator`, then the disabled banner "Simulator disabled. Set SIMULATOR_SECRET." renders; no controls are clickable.
- Given a non-Admin role (Operator / Technician / Viewer) renders `/admin/simulator`, then Story 1.6's `<RbacDenied />` renders; no `/admin/simulator/*` api call is made.
- Given an Admin clicks "Switch to RisingTDS" on device A, when the api's `POST /admin/simulator/A/scenario` returns 200, then within 5 s the simulator emits frames under the new scenario AND one `AuditLog` row exists with `auditAction: "simulator_event"`, `actor_user_id` from the JWT, `payload: { device_id: "A", scenario: "RisingTDS" }`.
- Given an Admin POSTs an unknown scenario name, when the api processes it, then it returns 400 `{ error: "invalid_scenario" }` and no `AuditLog` row is written.
- Given the simulator is unreachable, when an Admin clicks Switch, then the api returns 502 `{ error: "simulator_unreachable" }`, the UI shows a toast, and no `AuditLog` row is written (the action did not apply).
- Given two Switch requests for the same device land within 5 s, when the api processes them, then the second is queued (single-flight per device) and never silently dropped; if the queue is full the second returns 409 `{ error: "switch_in_progress" }`.
- Given the secret mismatch case (api has `SIMULATOR_SECRET=a`, simulator has `SIMULATOR_SECRET=b`), when an Admin clicks Switch, then the api returns 403 `{ error: "secret_mismatch" }` and the UI shows the same disabled banner state as missing-secret.

## Spec Change Log

### Loopback 1 — setScenario target field
- **Triggering finding:** VerificationGap — spec text said `setScenario` updates `this.opts.scenario`; implementation mutates `this.currentScenario` to keep `WsClientOptions` immutable.
- **Amended:** No spec change; logged deviation so future readers don't flag it as a regression.
- **Known-bad state avoided:** Mutating `opts` would silently break the constructor invariant that the public `WsClientOptions` shape is immutable (test seam `__test__setSocket` relies on it).
- **KEEP:** `WsClient.setScenario(name)` and `WsClient.setPaused(paused)` mutators; `__test__scenario` and `__test__paused` test seams; no constructor signature change.

## Suggested Review Order

**Simulator control plane (highest leverage)**

- One-file overview of the inbound HTTP control server: route parsing + secret gate + scenario apply.
  [`server.ts:309`](../../packages/simulator/src/control/server.ts#L309)

- Constant-time secret compare + `resolveSimulatorSecret` discriminated-union for the disabled state.
  [`server.ts:105`](../../packages/simulator/src/control/server.ts#L105)

- WsClient runtime mutators (`setScenario` / `setPaused`) + test seams + `currentScenario` field.
  [`wsClient.ts:214`](../../packages/simulator/src/wsClient.ts#L214)

- Boot integration: module-scoped `clientsRegistry`, control server start, SIGINT/SIGTERM cleanup.
  [`index.ts:247`](../../packages/simulator/src/index.ts#L247)

**Api router + outbound client**

- Three router surfaces: public `/status`, Admin `/devices`, Admin `/devices/:id/scenario`.
  [`simulatorRouter.ts:253`](../../packages/api/src/admin/simulatorRouter.ts#L253)

- Single-flight queue (size 1): `pendingSwitches` + `pendingDepth`, third concurrent request 409.
  [`simulatorRouter.ts:85`](../../packages/api/src/admin/simulatorRouter.ts#L85)

- Body validation: Zod schema + `invalid_scenario` 400 + `validation_error` for malformed bodies.
  [`simulatorRouter.ts:66`](../../packages/api/src/admin/simulatorRouter.ts#L66)

- Outbound `fetch` client: `validateSimulatorBaseUrl`, 5 s AbortController, typed result.
  [`simulatorClient.ts:72`](../../packages/api/src/admin/simulatorClient.ts#L72)

**Shared wire contract**

- Closed Zod enum mirroring the simulator's 7 `SCENARIO_NAMES` (api cannot import simulator).
  [`simulator.ts`](../../packages/shared/src/simulator.ts)

**Web admin tab**

- TanStack Query provider bootstrap (one-time, app-wide) + route replacement at `/admin/simulator`.
  [`main.tsx`](../../packages/web/src/main.tsx)

- SimulatorPage: 3 states (loading / disabled / enabled), error banner for failed devices fetch.
  [`SimulatorPage.tsx:57`](../../packages/web/src/admin/simulator/SimulatorPage.tsx#L57)

- DeviceRow: optimistic Pause toggle reverted on failure, Switch/Pause shared `isPending` disable.
  [`DeviceRow.tsx`](../../packages/web/src/admin/simulator/DeviceRow.tsx)

- TanStack Query hooks with the `["admin","simulator",…]` key convention.
  [`useSimulatorDevices.ts:40`](../../packages/web/src/admin/simulator/useSimulatorDevices.ts#L40)

- DisabledBanner with the pinned calm copy.
  [`DisabledBanner.tsx`](../../packages/web/src/admin/simulator/DisabledBanner.tsx)

**Database**

- Device model: nullable `name` + `scenario` columns + migration + seed backfill.
  [`schema.prisma`](../../packages/db/prisma/schema.prisma)

- One-shot migration SQL.
  [`migration.sql`](../../packages/db/prisma/migrations/20260822000000_device_name_scenario/migration.sql)

- Seed reads `packages/simulator/src/devices.json` and upserts 6 devices.
  [`seed.ts`](../../packages/db/prisma/seed.ts)

**Config / env**

- `.env.example` updated with `SIMULATOR_SECRET` shared-secret comment.
  [`.env.example`](../../.env.example)

- Simulator-side `SIMULATOR_CONTROL_PORT` (default 4001) + `SIMULATOR_SECRET`.
  [`.env.example`](../../packages/simulator/.env.example)

- Web-side `VITE_API_BASE_URL` pin (no `SIMULATOR_SECRET`).
  [`.env.example`](../../packages/web/.env.example)

**Peripherals**

- WsClient integration tests for `setScenario` swap + `setPaused` short-circuit + unknown-name throw.
  [`wsClient.spec.ts:437`](../../packages/simulator/src/__tests__/wsClient.spec.ts#L437)

- Simulator control server: secret match/mismatch/too-short + equal-length-different-content + body cap.
  [`server.spec.ts`](../../packages/simulator/src/control/server.spec.ts)

- Api router: AC matrix (happy / 403 / 400 invalid_scenario / 502 / 503 / 409 queue / 409 overflow / 403 secret).
  [`simulatorRouter.spec.ts`](../../packages/api/src/admin/simulatorRouter.spec.ts)

- Web page: 6 rows render, RbacDenied, disabled banner, Switch happy, Switch failure (no optimistic update), Pause control, 409 toast.
  [`SimulatorPage.spec.tsx`](../../packages/web/src/admin/simulator/SimulatorPage.spec.tsx)

- Shared simulator enum pinning: 7 names, order, uniqueness, Zod acceptance/rejection.
  [`simulator.spec.ts`](../../packages/shared/src/simulator.spec.ts)

## Design Notes

**Why an explicit HTTP server in the simulator instead of bi-directional polling or WebSocket:**
- Admin actions are 1 RPS at most — polling the api would burn the wire contract for nothing.
- A 5 s POST/PUT is a well-understood HTTP shape; the api already runs Node 20 with global `fetch`.
- The control channel is unidirectional (api → simulator). The existing telemetry WS is bidirectional. Mixing them would muddy the wire contract and break the `socket.io-client` dep already pinned at 4.8.0.

**Why AuditLog is structured-logger only in this story, not a Prisma model:**
- The existing `AuditLogger.emit` contract is the canonical v1 surface. Promoting it to a Prisma table is a Story 2.3 follow-up deferred item, not a Story 2.5 concern.
- A real `AuditLog` table requires a retention policy, a query API, and a feed surface — all of which are out of scope for an admin tab.
- If Ask-First resolves "yes", the migration is additive and the `simulator_event` enum value already exists.

**Why module-scope for the `clients[]` registry instead of class-scope:**
- The boot function is a single 75-line procedure; nesting a registry inside `boot()` would force every test to import `boot()` to set up state. Module-scope keeps the test surface flat.
- The `clients[]` is read-only after `boot()` completes (the only writes are `start()` at boot and `setScenario()` per device). A module-scoped `readonly` registry is safe.

**Single-flight per device:**
- Without it, two rapid Switch clicks would race the scenario field; the second click could overwrite the first before the first apply completes. The 5-second SLA gives enough headroom for a queue of size 1 (single in-flight); size 2+ is overkill for an admin UI.

**TanStack Query bootstrap:**
- The provider must wrap the entire route tree once, not per-page. `main.tsx:138-146` is the wired entry; `<QueryClientProvider>` slots in there alongside the existing `<BrowserRouter>`.

## Verification

**Commands:**

- `pnpm --filter @surakkha/simulator test` -- expected: all green (≥64 tests; existing 59 + new control/server specs).
- `pnpm --filter @surakkha/api test` -- expected: all green (≥104 tests; existing 97 + new admin/simulatorRouter specs).
- `pnpm --filter @surakkha/web test` -- expected: all green (≥96 tests; existing 88 + new SimulatorPage specs).
- `pnpm --filter @surakkha/shared test` -- expected: all green (≥86 tests; existing 80 + new simulator spec).
- `pnpm typecheck` -- expected: 4/4 packages clean.
- `pnpm lint` -- expected: 4/4 packages clean (no warnings).
- `pnpm lint:rbac` -- expected: 13 handler files checked; the new `admin/simulatorRouter.ts` mounts are referenced by the matrix.
- `pnpm build` -- expected: 4/4 packages built.

**Manual checks (if no CLI):**

- Start simulator with `SIMULATOR_SECRET=test-secret-32-chars-or-more-please-1234` and api with the same value; load `/admin/simulator` as Admin; click Switch to `RisingTDS`; confirm frames start climbing TDS within 5 s; restart simulator with `SIMULATOR_SECRET` unset; reload page; confirm disabled banner and no controls clickable.

## Review Findings

> Group 1 only (Shared + DB). Groups 2 (API + Simulator control) and 3 (Web) reviewed separately.
> Sources: blind-hunter + edge-case-hunter + verification-gap + acceptance-auditor.

### Decision-Resolved (by user: A — accept spec two-step)

- [x] [Review][Defer] G1-22 — Migration vs split seed atomicity — deferred, spec intent. Migration adds nullable columns only; `prisma/seed.ts` is a separate step owned by the spec Tasks.

### Patch

- [ ] [Review][Patch] G1-02 — `simulatorRouter.spec.ts` asserts only `device_id`; `name` and `scenario` regression-untested [`packages/api/src/admin/simulatorRouter.spec.ts:139-145`] *(out of Group 1 surface; flag for Group 2 review)*
- [x] [Review][Patch] G1-03 — Seed has zero test coverage; `deriveName` and path math untested [`packages/db/prisma/seed.ts`, `packages/db/prisma/seedHelpers.ts`, `packages/db/prisma/seed.spec.ts`]
- [x] [Review][Patch] G1-06/G1-07/G1-13 — Seed `update` branch is destructive; split into `create` + null-guarded `update` (only fill `name` / `scenario` when null) [`packages/db/prisma/seed.ts`]
- [x] [Review][Patch] G1-10 — `deriveName` collision risk; use last 4 hex digits [`packages/db/prisma/seedHelpers.ts`]
- [x] [Review][Patch] G1-12 — `devices.json` parsed with unchecked cast; validate against `SCENARIO_NAMES` before upsert [`packages/db/prisma/seed.ts`, `seedHelpers.ts:assertValidScenario`]
- [x] [Review][Patch] G1-14/15/16 — Seed error handling: try/catch around `readFileSync` + `JSON.parse` + `Array.isArray`; descriptive error + exit 1 [`packages/db/prisma/seed.ts:loadDevicesFile`]
- [x] [Review][Patch] G1-17 — `deriveName("")` produces `"DEVICE-"` with no guard [`packages/db/prisma/seedHelpers.ts:UUID_V4_PATTERN`]
- [ ] [Review][Patch] G1-19 — Pre-Story-2.5 Device rows have NULL `name`/`scenario`; api rendering must handle null fallback *(out of Group 1 surface; flag for Group 2 review)* [`packages/db/prisma/schema.prisma:24-31`]
- [x] [Review][Patch] G1-24 — Migration comment claims "back-fills" but SQL has no UPDATE; rewrite comment [`packages/db/prisma/migrations/20260822000000_device_name_scenario/migration.sql:3-13`]
- [x] [Review][Patch] G1-25 — `packages/shared/src/index.ts` missing trailing newline [`packages/shared/src/index.ts:14`] *(was already correctly terminated; verified, no change)*
- [x] [Review][Patch] G1-28 — Add `// @ts-expect-error` exhaustiveness test for `ScenarioName` type [`packages/shared/src/simulator.spec.ts`]
- [x] [Review][Patch] G1-01 — Seed doc-comment says "no cross-package dependency" but the file does read `devices.json` at runtime; rewrite comment to acknowledge the runtime read [`packages/db/prisma/seed.ts:1-32`]

### Out of Group 1 scope (flagged for Group 2 review)

- G1-02 — `simulatorRouter.spec.ts` does not assert `name` / `scenario` fields. Will be addressed in Group 2 review of API changes.
- G1-19 — Pre-Story-2.5 Device rows have NULL `name` / `scenario`; api surface must handle null fallback. Will be addressed in Group 2 review.

### Defer

- [x] [Review][Defer] G1-04 — Shared ↔ Simulator `SCENARIO_NAMES` drift has no cross-package test — deferred, pre-existing. Already tracked as F-2.5-1 in `deferred-work.md`.
- [x] [Review][Defer] G1-11 — `deriveName` placeholder contradicts spec example `DHAKA-SCHOOL-023` — deferred, pre-existing. Canonical school labels land in Story 2.3; v1 placeholder is the deliberate fallback the spec accepts.
- [x] [Review][Defer] G1-27 — `Device.name` has no length cap — deferred, pre-existing. Admin-only input; production-hardening concern.

### Dismissed (15)

G1-05 (ScenarioNameSchema not adopted — out of Group 1 scope), G1-08 (migration timestamp predates commit), G1-09 (no DB CHECK constraint — by design), G1-18 (duplicate device_id in devices.json — defense-in-depth, Story 2.4 owns), G1-20 (seed wiring present — reviewer missed line 13), G1-21 (two import paths — consistent with existing subpath exports), G1-23 (nullable mismatch — spec explicit), G1-26 (export order — alphabetical not a stated convention), G1-29 (redundant `""` test — coverage is good), G1-30 (zod re-bundle bloat — consistent with existing modules), G1-31 (schema vs type-only ambiguity — both exported), G1-32 (non-string types — zod default rejection).

### Group 2 (API + Simulator control) — 2026-08-24

> Sources: blind-hunter + edge-case-hunter + verification-gap + acceptance-auditor.
> Consolidated triage: `_bmad-output/implementation-artifacts/.review-2.5-group2/TRIAGE.md`.

### Decision-Resolved (by user: apply all 26 patches)

- [x] [Review][Patch] G2-01 — Simulator-side POST missing-secret returns 503 → 403 `{ error: "secret_mismatch", reason: "missing" }` to align with spec line 110 and the AC2 "same banner regardless of which side is unset" intent (api's secret_mismatch path → SPA disabled banner via AC8). [`packages/simulator/src/control/server.ts:disabledResponse`]
- [x] [Review][Patch] G2-02 — `listDevicesFromPrisma` constructed `new PrismaClient()` per-request → leaks SQLite handles under burst. Hoisted to a shared lazy `resolvePrismaClient()` singleton (reused by `resolveReadingDelegate`). [`packages/api/src/index.ts`]
- [x] [Review][Patch] G2-03 — Api-side `resolveSimulatorConfig` enforced 1-char minimum → enforced 32-char minimum to mirror the simulator's `resolveSimulatorSecret`. Symmetric enforcement (spec line 26). [`packages/api/src/admin/simulatorRouter.ts`]
- [x] [Review][Patch] G2-04 — Single-flight queue invariant: documented in code; removed the `pendingDepth.set` on the 409 path that leaked depth under burst. [`packages/api/src/admin/simulatorRouter.ts`]
- [x] [Review][Patch] G2-05 — Renamed `WsClient.__test__deviceId` → `WsClient.deviceId` (production getter, not a test seam). [`packages/simulator/src/wsClient.ts`, `packages/simulator/src/index.ts:boot`]
- [x] [Review][Patch] G2-06..G2-26 — See TRIAGE.md for the full 26-patch list (verification-gap filling, audit-row shape, body-parser cleanup, header casing, etc.).

### Defer (Group 2)

- [x] [Review][Defer] F-2.5-9 — Audit `context` → `payload` rename. Cross-cutting; Story 5.6.
- [x] [Review][Defer] F-2.5-10 — Body-size asymmetry (api 32 KB / sim 16 KB). Production hardening.
- [x] [Review][Defer] F-2.5-11 — Outbound fetch `User-Agent` header.
- [x] [Review][Defer] F-2.5-12 — Boot-window buffer-replay race.
- [x] [Review][Defer] F-2.5-13 — DNS rebinding / SSRF hardening.
- [x] [Review][Defer] F-2.5-14 — SCENARIO_NAMES cross-package drift (already F-2.5-1/5).
- [x] [Review][Defer] F-2.5-15 — disabledResponse body shape change ripples to web clients (Group 3).
- [x] [Review][Defer] F-2.5-16 — `parseRoute` bare-GET fallback removed (G2-14); per-device GET endpoint deferred.

### Dismissed

- Out-of-scope hardening (User-Agent, DNS pinning, redirect-handling).
- Test-harness nits (env save/restore, vitest worker parallelism).
- Already-implemented verification (intentional design choices: `setScenario` mutates `currentScenario` per loopback-1, `setPaused` is pause-the-tick semantics, `/status` mounted twice for safety, etc.).
- Pre-existing concerns already tracked as F-2.5-1..8 from Group 1.

### Group 3 (Web) — 2026-08-24

> Sources: blind-hunter + edge-case-hunter + verification-gap + acceptance-auditor.
> Consolidated triage: `_bmad-output/implementation-artifacts/.review-2.5-group3/TRIAGE.md`.

### Decision-Resolved (by user: apply all 18 patches)

- [x] [Review][Patch] G3-01 — `useSimulatorStatus` collapsed ALL non-200 into "disabled" — masks real outages. Branched the status query on the actual HTTP code: 200 → enabled, 503 → disabled, anything else → throw so TanStack Query surfaces `isError`. [`packages/web/src/admin/simulator/useSimulatorDevices.ts`]
- [x] [Review][Patch] G3-02 — `useSwitchScenario` mutation error type didn't extend the declared discriminated union (wrapper class made `err.kind` undefined → empty toasts). Dropped the wrapper class; throw the discriminated union directly with `Error`-shape compatibility for TanStack-Query. [`useSimulatorDevices.ts`]
- [x] [Review][Patch] G3-03 / G3-04 — 503-disabled and 403-secret_mismatch Switch responses now transition the page into the disabled-banner branch (via `statusQuery.refetch()`), not a transient toast. Matches AC2 / AC8 narrative. [`useSimulatorDevices.ts`, `SimulatorPage.tsx`]
- [x] [Review][Patch] G3-06 — `useSimulatorDevices` parsed the response without validating shape — silent zero-devices on wire drift. Added a Zod schema (`DevicesResponseSchema`) at the wire boundary; throws on `safeParse` failure. [`useSimulatorDevices.ts`]
- [x] [Review][Patch] G3-07 — Added 8 missing tests: 400 invalid_scenario toast text, 403 secret_mismatch → disabled banner transition, 409 toast text, 502 toast text, success-toast text, Pause→Resume label transition, devices 5xx with Retry button, loading state visibility, status 5xx → status-error banner, `{ disabled: true }` wire shape acceptance. [`SimulatorPage.spec.tsx`]
- [x] [Review][Patch] G3-08 / G3-09 — Toast `id` and TTL timer leak: replaced `Date.now() + Math.random()` with a monotonic `useRef` counter; tracked TTL timers in a `useRef<Set>` and cleared them on unmount. [`SimulatorPage.tsx`]
- [x] [Review][Patch] G3-10 — `errorMessage` no longer references an unused `assertNever`; the exhaustive switch returns a string for all five `SwitchScenarioError` kinds. [`SimulatorPage.tsx`]
- [x] [Review][Patch] G3-11 — Disabled-banner accepts `{ disabled: true, reason }` wire shape (the api's documented 503 body) — pass through verbatim instead of synthesizing a fresh object. [`useSimulatorDevices.ts`]
- [x] [Review][Patch] G3-12 — Devices-error branch renders a Retry button calling `devicesQuery.refetch()`. [`SimulatorPage.tsx`]
- [x] [Review][Patch] G3-13 — `.env.example` rewritten to document the actual proxy model: SPA always uses same-origin `/api`; no `VITE_API_BASE_URL` knob. Removes dead documentation. [`packages/web/.env.example`]
- [x] [Review][Patch] G3-14 — Switch submit bundles the row's local `paused` state so a scenario change can't leave the device "stuck paused". Added a no-op short-circuit (don't POST when scenario+paused both match) to avoid audit-log noise. [`DeviceRow.tsx`]
- [x] [Review][Patch] G3-15 — Documented token-refresh navigate + TanStack-Query retry interaction; no special-case here (apiClient handles the navigate; the new error type uses `Error`-shape so the mutation's `retry: 0` won't replay). [`useSimulatorDevices.ts`]
- [x] [Review][Patch] G3-16 — `<select>` re-syncs to `device.scenario` when the device list invalidates (via `useEffect`). [`DeviceRow.tsx`]
- [x] [Review][Patch] G3-17 — Disabled-banner test mock now returns `{ disabled: true, reason: "missing" }` matching the api wire shape. [`SimulatorPage.spec.tsx`]
- [x] [Review][Patch] G3-18 — UUID `<p>` renders with `truncate` + `title` for narrow viewports. [`DeviceRow.tsx`]

### Defer (Group 3)

- [x] [Review][Defer] F-2.5-17 — `paused` server-truthful state in `SimulatorDevice` (api doesn't expose it yet; v1 ships local state).
- [x] [Review][Defer] F-2.5-18 — Start button vs Pause/Resume semantic collapse (spec amendment).
- [x] [Review][Defer] F-2.5-19 — RBAC downgrade mid-session (full `<RbacDenied />` re-routing).
- [x] [Review][Defer] F-2.5-20 — StrictMode double-fire masking.
- [x] [Review][Defer] F-2.5-21 — Status query `refetchInterval` for secret rotation.

### Dismissed (Group 3, 9)

G3-D1 (test viewport setup — cosmetic), G3-D2 (`vi` imports — false alarm), G3-D3 (naming inconsistency), G3-D4 (`aria-live` redundancy), G3-D5 (`<select>` label wrapping — correct), G3-D6 (`DISABLED_BANNER_COPY` export — intentional pin), G3-D7 (singleton-vs-test-builder), G3-D8 (`endsWith` path matching — sufficient), G3-D9 (`overrides.onError` future-proofing).
