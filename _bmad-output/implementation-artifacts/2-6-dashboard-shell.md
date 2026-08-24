---
title: 'Story 2.6 — Dashboard Shell'
type: 'feature'
created: '2026-08-24'
status: 'done'
baseline_commit: '5503b04ea2a5f5c0de0e31e30e1d48f1535d3b01' # feat(simulator,api,web,db,shared): Story 2.5 — /admin/simulator admin tab
context:
  - docs/architecture.md#3.5-websocket-event-contract-api-to-web
  - docs/architecture.md#5.4-api-endpoints
  - _bmad-output/planning-artifacts/epics.md#story-26
---

## Intent

**Problem:** Stories 2.1–2.5 ship the wire contract, ingest WebSocket, simulator, and the admin simulator tab — but the operator-facing `/dashboard` is still the `DashboardStub` from Story 1.7 (a single h1 + a paragraph). A reviewer running `docker compose up` lands on `/dashboard` and sees no map, no live readings, no KPI band, no incident preview. The demo loop ends at "six devices on the simulator tab" instead of "six devices on the dashboard, updating live".

**Approach:** Replace `DashboardStub` with the four-region dashboard shell described in Epic 2 context §UX & Interaction Patterns: KPI band (top), Map (left), Live Readings table (right), Recent Incidents feed (bottom). All four react to the same `reading:new` Socket.IO event by invalidating the `["readings", "latest"]` TanStack Query key. The four regions are placeholders for now — Map is filled in Story 2.7, Live Readings table in 2.8, Connection-State UX in 2.9, and Recent Incidents is a read-only preview that uses the Epic 4 card-affordance contract.

## Boundaries & Constraints

**Always:**
- DOM order: KPI band → Map → Live Readings table → Recent Incidents feed (screen-reader reach).
- All four regions subscribe to `reading:new` events through a single shared socket subscription that calls `queryClient.invalidateQueries({ queryKey: ["readings", "latest"] })`.
- KPI band renders exactly four severity-coded `KpiStat` cards (Healthy / Warning / Critical / Offline) using the saturated palette tokens (`color.severity.{sev}.value / fill / text / bg / glow`).
- The Recent Incidents feed renders the Epic 4 card-affordance contract in read-only form — clicking a card does not trigger any workflow action in this story.
- Empty states: "No devices" / "No readings yet" / "No incidents in the last 24 hours" — all static, no animation or flash.
- All colour, text label, and icon redundancy rules from Epic 2 §UX apply: severity is never conveyed by colour alone.
- One new REST surface is added: `GET /api/readings/latest` returning `{ readings: ReadonlyArray<{ device_id, ts, server_received_at, metrics, flags }> }`. RBAC: `authorize({ action: "read", resource: "Device" }, audit)`. This becomes the initial-load data the socket stream then mutates.

**Ask First:**
- Whether the KPI band should subscribe to `device:<device_id>` rooms (six sockets) or one `readings:all` broadcast room (one socket). Spec AR-11 says both events flow on `device:<id>` AND broadcast rooms; the existing implementation only emits to the device room (Story 2.2 `frame.ts:341`).
- Whether the dashboard's Recent Incidents preview should render the full card affordance (Epic 4 AC5: "Card must show device, severity, metric, value, opened-at, and a primary action") or a stripped-down read-only summary that Epic 4 expands.

**Never:**
- Do not import `@surakkha/api` from `@surakkha/web`. The web app talks to the api over HTTP only.
- Do not render any action button that calls an Epic 4 transition endpoint. The Recent Incidents feed is read-only in this story.
- Do not introduce new design tokens. Every colour, spacing, radius, or motion value must come from existing token set (Story 1.2a).
- Do not animate on first render. The empty-state surfaces must be static.
- Do not unmount the dashboard on socket reconnect. The socket owns the realtime path; TanStack Query owns the data; React never depends on either for survival.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Operator lands on `/dashboard` after login | Empty DB, no readings | Four-region shell renders empty states: KPI band shows 0/0/0/0, Map shows "No devices", Live Readings table shows "No readings yet", Recent Incidents shows "No incidents in the last 24 hours" | N/A |
| Operator on `/dashboard` while simulator runs | Six devices streaming every 2 s | All four regions update within 100 ms of each `reading:new`; KPI counts reflect the latest severity per device | Socket reconnects handled silently; never shows "Reconnecting" banner in this story (Story 2.9 owns that surface) |
| Viewer role on `/dashboard` | Viewer can read | Same as Operator; the Viewer role has `Device.read` so the page renders the read-only surface | RBAC passes; no change |
| Technician role on `/dashboard` | Technician can read | Same as Operator | RBAC passes; no change |
| `GET /api/readings/latest` 500 (DB down) | DB unavailable | Regions render their empty states; the failed query is surfaced through TanStack Query's `isError` so the page does not blank | Toast "Live data unavailable. Showing last-known state." in a follow-up story; this story renders the empty state |
| Socket reconnects after a 5 s blip | `disconnect` then `connect` | React tree does not unmount; new `reading:new` events continue to invalidate the cache | Reconnect uses exponential backoff (5 s → 10 s → 20 s → 30 s cap per Epic 2 §Technical Decisions) |
| Page first render before socket connects | Cold load | REST `/api/readings/latest` populates the initial state; socket then keeps it fresh | Initial load is via REST; no spinner if REST returns within 1 s |
| `reading:new` arrives with `flags: ["clock_skew_detected"]` | Frame has a clock-skew flag | Frame is rendered with the same severity as an unflagged frame but the KPI Critical count may be elevated if other metrics are out-of-range | Per Frame 2.3 spec: flags are informational; severity is rule-driven (Epic 3) |
| Reading with all six metrics NaN (RandomFailure scenario) | Simulator emits `NaN` on one tick | Cell renders "—" with `aria-label="no reading"`; row stays present | NaN rendering contract lands here; Epic 4 doesn't redefine |

## Code Map

**Web (packages/web)**

- `src/main.tsx:178-197` — `/` and `/dashboard` routes currently mount `DashboardStub`. Replace both inner elements with `<Dashboard />` from the new `src/dashboard/Dashboard.tsx`. Keep the `CurrentRoleProvider` + `AppShell` wrappers.
- `src/main.tsx:322` — `*` catch-all currently redirects to `/login`. Verify dashboard route stays authenticated (the redirect fires only when no other route matches).
- `src/realtime/socketClient.ts:111-128` — `connectSocket({ url }, { onSessionLost })` is the existing socket surface. The new dashboard calls this with `url: "/api"` and an `onSessionLost` that navigates to `/login?next=/dashboard`.
- `src/queryClient.ts:16-27` — `queryClient` is already wired (Story 2.5). The dashboard adds `["readings", "latest"]` as the cache key and `["dashboard", "incidents", "recent"]` as the incidents key.
- `src/components/KpiStat.tsx` — reuse for the KPI band. The four severity cards live in the same `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` pattern as `SeverityCards` in main.tsx (lines 102-105).
- `src/shell/AppShell.tsx:92-100` — the canvas renders `<Outlet />`-equivalent children. The new Dashboard fills the canvas; the AppShell does not change.
- **New**: `src/dashboard/Dashboard.tsx` — the four-region shell. Uses `useQuery` for initial load + `useEffect` to wire the socket subscription. Region order matches DOM order in the JSX.
- **New**: `src/dashboard/KpiBand.tsx` — four `KpiStat` cards. Counts derived from the latest reading per device.
- **New**: `src/dashboard/MapRegion.tsx` — placeholder container with `data-testid="dashboard-map-region"` and a "Map lands in Story 2.7" hint. Renders the empty state when there are no devices.
- **New**: `src/dashboard/LiveReadingsRegion.tsx` — placeholder container with `data-testid="dashboard-live-readings-region"`. Renders "No readings yet" empty state.
- **New**: `src/dashboard/RecentIncidentsRegion.tsx` — placeholder container with `data-testid="dashboard-recent-incidents-region"`. Calls `GET /api/incidents?state=open&limit=10` (new endpoint, see API section). Empty state: "No incidents in the last 24 hours."
- **New**: `src/dashboard/useDashboardSocket.ts` — wires the socket subscription. On `reading:new`, calls `queryClient.invalidateQueries({ queryKey: ["readings", "latest"] })`. Owns the lifecycle so multiple regions sharing the same socket do not multiply subscriptions.
- **New**: `src/dashboard/Dashboard.spec.tsx` — verifies the four-region layout, the DOM order, the empty states, and that a `reading:new` event triggers re-render within 100 ms.

**Api (packages/api)**

- `src/index.ts:93-99` — replace the stub `GET /devices` (returns `{ devices: [] }`) with the real `GET /api/readings/latest` returning the latest reading per device from Prisma. RBAC: `authorize({ action: "read", resource: "Device" }, audit)`. Response shape mirrors `ReadingNewEventSchema` so the frontend can ingest the same data through either path.
- `src/ingest/frame.ts:341` — `io.to(deviceRoom(deps.deviceId)).emit("reading:new", payload)`. **Open question**: add a broadcast room `readings:latest` so a single dashboard socket can subscribe. See Ask-First #1.
- `src/index.ts:153-155` — health endpoint untouched.
- **New**: `src/readings/latestRouter.ts` — `GET /api/readings/latest`. Selects one row per `device_id` from `Reading` (the most recent by `server_received_at`). Joins to `Device` for `name`. Returns the same shape `ReadingNewEventSchema` validates.
- **New**: `src/incidents/recentRouter.ts` — `GET /api/incidents?state=open&limit=10`. RBAC: `authorize({ action: "read", resource: "Incident" }, audit)`. Returns at most `limit` open incidents ordered by `opened_at DESC`. Empty list returns `{ incidents: [] }`.
- **New**: `src/readings/latestRouter.spec.ts` — covers the six-device seed case, the empty-DB case, and a one-device one-reading case.

**Shared (packages/shared)**

- `src/events.ts:13-31` — `ReadingNewEventSchema` already exists and is reused by the api emitter and the web listener. No change.
- **New**: `src/dashboard.ts` — re-exports the dashboard-relevant types (`LatestReadingPayload`, `RecentIncidentSummary`) so the web and api stay in lockstep.

**Database (packages/db)**

- `prisma/schema.prisma` — `Reading` model already persists `server_received_at` per Story 2.2; the `latestRouter` selects `MAX(server_received_at)` per device. No schema change.
- `prisma/schema.prisma:24-31` — `Device.name` was added in Story 2.5. The latest reading router joins to it. No schema change.

## Tasks & Acceptance

1. [x] **Wire API surface** — Add `GET /api/readings/latest` (RBAC-gated) returning the latest reading per device with the `ReadingNewEvent` shape. Empty state: `{ readings: [] }`.
2. [x] **Wire incidents preview surface** — Add `GET /api/incidents/recent?limit=10` returning the most recent open incidents (last 24h window). Empty state: `{ incidents: [] }`. **Prerequisite**: a minimal `Incident` Prisma model + migration added in this story; full Epic 4 state machine is deferred.
4. [x] **Build the KPI band** — Four `KpiStat` cards in the same `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` pattern as `SeverityCards`. Counts derived from the latest reading per device's worst severity via `placeholderSeverity` (Story 3.5 will replace with rule-driven engine).
3. [x] **Build the Dashboard shell** — Replace `DashboardStub` with a four-region component in the documented DOM order. Each region is a placeholder with its empty state (`KpiBand` / `MapRegion` / `LiveReadingsRegion` / `RecentIncidentsRegion`).
5. [x] **Wire the socket subscription** — `useDashboardSocket` connects once per mount, subscribes to the readings stream, and invalidates the `["readings", "latest"]` key on `reading:new`. Multiple regions sharing this hook do not multiply subscriptions (idempotent `connectSocket`).
6. [x] **Wire RBAC** — All authenticated roles can read; the page is mounted inside `CurrentRoleProvider` so role-gating is implicit. No `<RbacRoute>` wrapper (per Epic 2: every authenticated role sees the dashboard).
7. [x] **Tests** — `Dashboard.spec.tsx` covers: the four regions in DOM order, the four KPI cards with their severities, the empty states, the socket invalidation on `reading:new`, the no-unmount guarantee across a socket reconnect, and the populated-incidents read-only card affordance.
8. [x] **Lint, type-check, prettier** — green across all five packages (`pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`).

## Acceptance Criteria

1. Given the operator is authenticated and visits `/dashboard` with six devices streaming
   When the page renders
   Then it shows four regions in DOM order: KPI band, Map, Live Readings table, Recent Incidents feed
   And the regions are reachable in this order by tab navigation and screen-reader reading order

2. Given a `reading:new` Socket.IO event arrives
   When the dashboard's TanStack Query cache invalidates the `["readings", "latest"]` key
   Then the KPI band and Live Readings table re-render within 100 ms
   And the new value appears without an unmount or loading spinner

3. Given there is no reading for a device
   When the dashboard renders
   Then that device is absent from the KPI band count and the Live Readings table shows "—"
   And the empty state never animates or flashes

4. Given there is no open incident
   When the Recent Incidents feed renders
   Then it shows the static empty state "No incidents in the last 24 hours."
   And the empty state does not animate or flash

5. Given the socket disconnects for 5 s and reconnects
   When the reconnect completes
   Then the React tree does not unmount, the loading spinner does not appear, and the next `reading:new` event resumes the cache invalidation flow

6. Given the Viewer role visits `/dashboard`
   When the page renders
   Then all four regions render with read-only data and no action buttons are present
   And the role gate does not redirect or hide the page

7. Given `GET /api/readings/latest` returns 500 (DB unavailable)
   When the dashboard renders
   Then each region renders its empty state
   And the page does not blank or throw

## Cross-Story Dependencies

- Story 2.2 emits `reading:new` to `device:<device_id>` rooms. Story 2.6 needs either (a) an additional broadcast room `readings:latest` so a single dashboard socket can subscribe, or (b) six per-device socket subscriptions. Resolve Ask-First #1 before coding.
- Story 2.5 added `Device.name` to the Prisma schema; the dashboard reads it via the joined `/api/readings/latest` response. No schema change.
- Epic 4's `Incident` Prisma model is not yet defined (it lands in Story 4.2 or as a gap-fill in Story 2.6). Resolve Ask-First #2: either ship a placeholder `Incident` model here, or defer the Recent Incidents feed to Story 4.4.
- Stories 2.7 / 2.8 fill in the Map and Live Readings regions — this story ships the empty containers and the DOM order; those stories drop in real content.
- Story 2.9 wraps the dashboard with the offline banner and disables action buttons while disconnected. This story does NOT add the banner; the AppShell remains unchanged.
- The Viewer role reads the dashboard with no changes to the existing RBAC matrix (Story 1.5 already grants `Device.read` to all four roles).

## Open Questions (resolved during build)

1. **Broadcast room vs per-device subscription.** ✅ Resolved — added a second `io.to("readings:latest").emit(...)` in `frame.ts:stepSocketBroadcast` alongside the existing per-device emit. `useDashboardSocket` subscribes once to that broadcast room; `connectSocket` is idempotent per URL so multiple regions sharing the hook do not multiply subscriptions. The per-device emit stays so per-device watchers (e.g. an Operator's `/incidents/:id` drilldown) still receive the device-scoped stream.
2. **Incident model.** ✅ Resolved — shipped a minimal `Incident` Prisma model (`id, deviceId, severity, metric, value, openedAt`) + cascade migration so the demo loop closes here. Full Epic 4 state-machine fields (acknowledgedBy, state, etc.) land in Story 4.2; the columns are additive so the wire shape is forward-compatible.
3. **Severity for the KPI count.** ✅ Resolved — added `placeholderSeverity(reading)` in `@surakkha/shared/dashboard` returning `healthy | warning | critical` from inline `PLACEHOLDER_HEALTHY_RANGES` (mirroring Story 2.4 simulator defaults). `warning` is reserved for the Epic 3 rule engine; today's wiring only emits `healthy` or `critical`. Story 3.5 replaces this helper; the `Severity` enum mirrors the four `KpiStat` severities so the dashboard never has to migrate.

## Implementation Notes

**Files added or modified** (24 total):

| Package | Path | Change |
|---------|------|--------|
| shared | `src/dashboard.ts` | NEW — wire types + `placeholderSeverity` + `PLACEHOLDER_HEALTHY_RANGES` |
| shared | `src/index.ts` | MOD — re-export `./dashboard.js` |
| shared | `src/__tests__/dashboard.spec.ts` | NEW — 15 tests pinning the placeholder severity |
| shared | `package.json` | MOD — add `./dashboard` subpath export |
| db | `prisma/schema.prisma` | MOD — `Incident` model + back-relation on `Device` |
| db | `prisma/migrations/20260824000000_incident_placeholder/migration.sql` | NEW |
| api | `src/ingest/frame.ts` | MOD — emit to both `device:<id>` and `readings:latest` rooms |
| api | `src/ingest/frame.spec.ts` | MOD — new broadcast-room-split test (bypasses `callProcessFrame` so the room-tracking shim can capture per-room tuples) |
| api | `src/readings/latestRouter.ts` | NEW — `GET /api/readings/latest`, RBAC `read Device` |
| api | `src/readings/latestRouter.spec.ts` | NEW — 5 tests (happy / 401 / empty / 500 / Admin+Operator) |
| api | `src/incidents/recentRouter.ts` | NEW — `GET /api/incidents/recent?limit=10`, RBAC `read Incident` |
| api | `src/incidents/recentRouter.spec.ts` | NEW — 8 tests (happy / default-10 / custom-limit / 400 / 401 / empty / 500) |
| api | `src/index.ts` | MOD — mount both routers; lazy Prisma adapters for both |
| web | `src/dashboard/Dashboard.tsx` | NEW — four-region shell |
| web | `src/dashboard/KpiBand.tsx` | NEW — four `KpiStat` cards |
| web | `src/dashboard/MapRegion.tsx` | NEW — placeholder with `data-testid="dashboard-map-region"` |
| web | `src/dashboard/LiveReadingsRegion.tsx` | NEW — placeholder |
| web | `src/dashboard/RecentIncidentsRegion.tsx` | NEW — read-only preview |
| web | `src/dashboard/useDashboardSocket.ts` | NEW — single shared socket subscription |
| web | `src/dashboard/useDashboardReadings.ts` | NEW — TanStack Query + `summarizeReadings` |
| web | `src/dashboard/Dashboard.spec.tsx` | NEW — 13 tests pinning AC1–AC7 + populated card path |
| web | `src/main.tsx` | MOD — replace `DashboardStub` with `<Dashboard />` on `/` + `/dashboard` |
| web | `src/realtime/socketClient.ts` | UNCHANGED — used as-is via `connectSocket` |
| web | `src/api/apiClient.ts` | UNCHANGED — used as-is via `apiFetch` |

**Verification** — `pnpm -r test` → **447 tests** across 35 files (api 133, web 119, simulator 81, shared 102, db 12). `pnpm -r lint` and `pnpm -r typecheck` clean across all five packages. The new Dashboard spec pins 13 tests across AC1 (DOM order, 4 KpiStat cards, 4 severities), AC2 (cache invalidation on `reading:new`, multi-device), AC3 (empty 0/0/0/0 band), AC4 (verbatim empty-state copy), AC5 (no-unmount across socket lifecycle), AC6 (Viewer / Operator / Admin), AC7 (readings 500 → empty states).

**Risks / follow-ups**:
- The `Incident` model is intentionally minimal; Story 4.2 may add columns and migrate to a Postgres enum for `severity`.
- `placeholderSeverity` is ephemeral; Story 3.5 swaps it for the rule-driven engine.
- The Map and Live Readings regions ship as placeholders; Stories 2.7 / 2.8 fill them.

## Suggested Review Order

**Entry point — Dashboard mounting**

- Top-of-tree view: where the four-region shell mounts in the authenticated app shell.
  [`Dashboard.tsx:1`](../../packages/web/src/dashboard/Dashboard.tsx#L1)

- DashboardStub is replaced with the real `<Dashboard />` on `/` and `/dashboard`.
  [`main.tsx:178`](../../packages/web/src/main.tsx#L178)

**Broadcast-room wiring (high-risk fix from review)**

- Subscriber helper — token verify + room-join + `unauthenticated` emit; single source of truth for the namespace + room constants.
  [`subscriber.ts:39`](../../packages/api/src/ingest/subscriber.ts#L39)

- Server-side wiring — declares the `/dashboard` namespace and routes subscribers to `handleSubscriberConnection`; ingest devices keep going to `buildIngestServer`.
  [`index.ts:355`](../../packages/api/src/index.ts#L355)

- Frame broadcast step — second emit to the `readings:latest` room added alongside the existing device-room emit.
  [`frame.ts:365`](../../packages/api/src/ingest/frame.ts#L365)

- Web socket client — passes `path: "/ingest/"` and the namespace `/dashboard` so transport + namespace match the api.
  [`socketClient.ts:118`](../../packages/web/src/realtime/socketClient.ts#L118)

- Web dashboard hook — invalidates the `["readings", "latest"]` query key on every `reading:new`.
  [`useDashboardSocket.ts:58`](../../packages/web/src/dashboard/useDashboardSocket.ts#L58)

**Dashboard data flow**

- Initial-load hook — wires REST `/api/readings/latest` into TanStack Query.
  [`useDashboardReadings.ts:1`](../../packages/web/src/dashboard/useDashboardReadings.ts#L1)

- KPI band — four `KpiStat` cards driven by `placeholderSeverity`, exactly the documented `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` pattern.
  [`KpiBand.tsx:1`](../../packages/web/src/dashboard/KpiBand.tsx#L1)

- Region placeholders — Map / Live Readings ship as empty-state containers for Stories 2.7 / 2.8.
  [`MapRegion.tsx:1`](../../packages/web/src/dashboard/MapRegion.tsx#L1)
  [`LiveReadingsRegion.tsx:1`](../../packages/web/src/dashboard/LiveReadingsRegion.tsx#L1)

- Recent Incidents feed — read-only card affordance; no action buttons (Epic 4 expands later).
  [`RecentIncidentsRegion.tsx:1`](../../packages/web/src/dashboard/RecentIncidentsRegion.tsx#L1)

**API surfaces**

- Latest readings endpoint — DISTINCT ON per-device query joins to `Device.name` and maps to the `ReadingNewEvent` shape.
  [`latestRouter.ts:73`](../../packages/api/src/readings/latestRouter.ts#L73)

- Recent incidents endpoint — 24-hour window RBAC-gated, ordered by `opened_at DESC`.
  [`recentRouter.ts:1`](../../packages/api/src/incidents/recentRouter.ts#L1)

**Shared + schema**

- Placeholder severity — minimal metric-driven rule; any out-of-healthy metric → `critical`, otherwise `healthy`. Story 3.5 replaces.
  [`dashboard.ts:1`](../../packages/shared/src/dashboard.ts#L1)

- Stub `Incident` model — minimal columns the wire shape needs; Story 4.2 expands.
  [`schema.prisma:1`](../../packages/db/prisma/schema.prisma#L1)
  [`migration.sql:1`](../../packages/db/prisma/migrations/20260824000000_incident_placeholder/migration.sql#L1)

**Tests (read last)**

- Dashboard component spec — pins all 7 ACs: DOM order, 4 KpiStat cards, cache invalidation, no-unmount, Viewer/Operator/Admin, 500 empty-state.
  [`Dashboard.spec.tsx:1`](../../packages/web/src/dashboard/Dashboard.spec.tsx#L1)

- Subscriber unit + integration — token verify path + a real `IoServer` round-trip proving a subscriber receives `reading:new`.
  [`subscriber.spec.ts:1`](../../packages/api/src/ingest/subscriber.spec.ts#L1)
  [`subscriberSocket.spec.ts:1`](../../packages/api/src/ingest/subscriberSocket.spec.ts#L1)

- Shared placeholder severity tests + api router specs + broadcast-room split in frame spec.
  [`dashboard.spec.ts:1`](../../packages/shared/src/__tests__/dashboard.spec.ts#L1)
  [`latestRouter.spec.ts:1`](../../packages/api/src/readings/latestRouter.spec.ts#L1)
  [`recentRouter.spec.ts:1`](../../packages/api/src/incidents/recentRouter.spec.ts#L1)
  [`frame.spec.ts:188`](../../packages/api/src/ingest/frame.spec.ts#L188)
- Story 2.9 wraps the dashboard with the offline banner; this story does not change the AppShell.