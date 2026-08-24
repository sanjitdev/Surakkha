---
title: 'Story 2.6 — Dashboard Shell'
type: 'feature'
created: '2026-08-24'
status: 'ready-for-dev'
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

1. **Wire API surface** — Add `GET /api/readings/latest` (RBAC-gated) returning the latest reading per device with the `ReadingNewEvent` shape. Empty state: `{ readings: [] }`.
2. **Wire incidents preview surface** — Add `GET /api/incidents?state=open&limit=10` returning the most recent open incidents. Empty state: `{ incidents: [] }`. **Prerequisite**: a real `Incident` Prisma model or a structured-logger read; resolve the Ask-First #2 decision before starting.
3. **Build the Dashboard shell** — Replace `DashboardStub` with a four-region component in the documented DOM order. Each region is a placeholder with its empty state.
4. **Build the KPI band** — Four `KpiStat` cards in the same `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` pattern as `SeverityCards`. Counts derived from the latest reading per device's worst severity.
5. **Wire the socket subscription** — `useDashboardSocket` connects once per mount, subscribes to the readings stream, and invalidates the `["readings", "latest"]` key on `reading:new`. Multiple regions sharing this hook do not multiply subscriptions.
6. **Wire RBAC** — All authenticated roles can read; the page is mounted inside `CurrentRoleProvider` so role-gating is implicit. No `<RbacRoute>` wrapper (per Epic 2: every authenticated role sees the dashboard).
7. **Tests** — `Dashboard.spec.tsx` covers: the four regions in DOM order, the four KPI cards with their severities, the empty states, the socket invalidation on `reading:new`, and the no-unmount guarantee across a socket reconnect.
8. **Lint, type-check, prettier** — green.

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

## Open Questions (must resolve before / during build)

1. **Broadcast room vs per-device subscription.** `frame.ts:341` emits to `device:<device_id>`. The dashboard wants a single subscription that fans out to all six devices. Add a broadcast room `readings:latest` (recommended — single socket, simple semantics), or open six sockets per dashboard (more complex, but uses existing wiring without modification).
2. **Incident model.** The Recent Incidents feed needs `GET /api/incidents`. The `Incident` Prisma model is owned by Story 4.2. Either (a) ship a stub `Incident` model in Story 2.6 (cleaner — makes the dashboard truly demo-ready), or (b) defer the feed to Story 4.4 and ship a "Recent Incidents feed ships with Story 4.4" empty state. Recommend (a) so the demo loop closes here.
3. **Severity for the KPI count.** The KPI band derives its count from the latest reading's worst severity. But the spec says severity is rule-driven (Epic 3, Story 3.5). Until Epic 3 lands, the dashboard can derive severity from the same threshold defaults seeded by Story 3.3 (or, if 3.3 has not landed either, a minimal placeholder severity function: any metric outside its healthy range is critical, otherwise is healthy). Resolve before the KPI band implementation task.