---
title: 'Story 2.7 — Map View'
type: 'feature'
created: '2026-08-24'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'eea8dee' # docs(bmad): reconcile sprint-status — Stories 2.5 and 2.6 → done
context:
  - _bmad-output/planning-artifacts/epics.md#story-27
  - _bmad-output/implementation-artifacts/2-6-dashboard-shell.md
  - _bmad-output/implementation-artifacts/epic-2-context.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Story 2.6 dashboard shell ships `MapRegion` as a placeholder card with the hint "Story 2.7 wires the real surface." A reviewer running `docker compose up` lands on `/dashboard` and sees the four-region shell with an empty-state message instead of a real geographic map — the demo loop ends at "six devices on the simulator tab" rather than "six markers on the map, one of them pulsing red."

**Approach:** Replace `MapRegion`'s placeholder body with a Leaflet map (already a dep of `packages/web`). Six markers render at the seeded coordinates; each marker is a `divIcon` (14px circle, severity `fill`, 2px white border, severity icon) keyed off `placeholderSeverity` so the same severity function the KPI band uses drives the map colour. Critical markers carry the 2000ms `animate-pin-pulse` halo from `motion.pin_pulse_ms`; non-critical markers are static. A click opens a popup with the device name, the breached metric + value, a severity dot, and a link to `/devices/{device_id}`. To make the markers render we add `lat` + `lng` columns to `Device`, extend the seed to backfill coordinates from `devices.json`, expose `/api/devices` for the six-row device roster with `last_reading_at`, and have the latest-readings router join that roster so the map knows the position of every device (including offline ones whose reading has lapsed).

## Boundaries & Constraints

**Always:**
- DOM order remains KPI band → Map → Live Readings → Recent Incidents (Story 2.6; do not reorder).
- The map subscribes to the same `readings:latest` socket stream the rest of the dashboard uses — `useDashboardSocket`'s `["readings", "latest"]` invalidation is the single realtime path. The map does NOT open its own socket.
- Markers are Leaflet `divIcon` instances; no raster marker icons. Severity colour comes from `color.severity.{sev}.fill`; the 2px white border and 14px size are fixed.
- Critical pin pulse uses the existing `animate-pin-pulse` Tailwind utility (already wired to `surakkha-pin-pulse` 2000ms keyframes in `index.css`). `prefers-reduced-motion` already disables it — no new motion code.
- Markers are redrawn on every `readings:latest` invalidation, not animated individually — Leaflet's `setLatLng` updates the position without remounting the marker. The popup re-renders from the cached reading.
- The popup shows: device name, breached metric (the first metric outside `PLACEHOLDER_HEALTHY_RANGES`) + value, a severity dot, and a link to `/devices/{device_id}`. Popup is dismissible with Escape (Leaflet default).
- Offline state: a device with `last_reading_at` older than `OFFLINE_THRESHOLD_MS` (60 s default; the simulator's tick_interval is 2 s, so 30× a normal tick = clearly lapsed) renders with the `offline` severity token (grey `fill`, no halo).
- One new REST surface: `GET /api/devices` returning `{ devices: ReadonlyArray<{ id, name, lat, lng, last_reading_at }> }`. RBAC: `authorize({ action: "read", resource: "Device" }, audit)`. Sorted by `id ASC`.
- Devices with no reading yet (never connected) surface `last_reading_at: null` and render with the `offline` severity token.

**Ask First:**
- Whether `last_reading_at > 60 s ago` is the right threshold for "offline" colour. The simulator's tick is 2 s, so 60 s = 30 ticks lapsed; an actual real device might be on a 30 s or 60 s tick and still be considered healthy. Resolve before implementation.
- Whether `/devices/{device_id}` should land as a stub route in this story (placeholder page that says "Device detail ships with Story X.Y") or whether the popup link should be `href="#"` with `aria-disabled` for now. Resolve before implementation.
- Whether the seed should backfill `lat`/`lng` for ALL six devices in one migration, or whether it should leave existing rows untouched and only fill on insert (idempotent re-run). Resolve before implementation.

**Never:**
- Do not introduce a new map library. Leaflet is already in `packages/web/package.json`. `react-leaflet` is NOT a dep and adding it requires a justification (vanilla Leaflet keeps the bundle smaller and the surface area minimal).
- Do not import `@surakkha/api` from `@surakkha/web`. The web talks to the api over HTTP only.
- Do not render an action button that calls an Epic 4 transition endpoint. The popup is read-only.
- Do not introduce new design tokens. Severity `fill`/`value`/`text`/`bg`/`glow` already exist; the existing `animate-pin-pulse` keyframes drive the halo.
- Do not animate on first render. Empty state ("No devices") is static.
- Do not unmount the map on socket reconnect. The queryClient owns the data; React never depends on socket state.
- Do not change the wire shape of `LatestReadingPayload`. Add lat/lng to the device roster endpoint, not the readings payload.
- Do not store markers in React state keyed by device_id with a `useState`-driven remount — use Leaflet's `Marker.addTo(map)` + `setLatLng` API.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Operator lands on `/dashboard` after seed | 6 devices with lat/lng, 5 reading, 1 Offline-scenario device whose `last_reading_at > 60 s` ago | 6 markers render at the seeded coordinates; the offline one is grey with no halo; the other 5 carry the severity from their latest reading (4 healthy green, 1 critical red with halo) | N/A |
| Operator lands on `/dashboard` before any readings arrive | 6 seeded devices, no readings in DB | 6 markers render in the `offline` severity token (grey); popup says "No reading yet" instead of a breached metric | N/A |
| Viewer role on `/dashboard` | Viewer can read Device | Same as Operator; the popup is read-only (no acknowledge / assign / submit-result buttons) | RBAC passes; no change |
| `reading:new` arrives for a healthy device | Socket event payload + cached reading refresh | The marker stays green; if it was previously offline and a fresh reading lands within the threshold, the colour flips to green without a remount; the existing marker's icon class updates | Socket reconnect handled silently; no spinner (Story 2.9 owns that surface) |
| A device transitions to Offline scenario | Simulator's WsClient closes; no `reading:new` for >60 s | The marker's severity flips to `offline` (grey), the halo disappears, the popup says "Offline — last seen 1m ago" | Threshold-based; not real-time |
| Operator clicks a marker | Click event | Popup opens with: device name, breached metric + value (or "—" if healthy), severity dot, link to `/devices/{device_id}` (placeholder route per Ask-First) | Leaflet closes the popup on the next outside click or Escape |
| Operator presses Escape with a popup open | Keyboard event | Popup closes | Leaflet default |
| `GET /api/devices` 500 (DB unavailable) | DB down | The map region renders its empty state ("No devices") and the KPI band / Live Readings table still work — the map's failure is isolated | TanStack Query's `isError` for the devices query; the readings query keeps working |
| Map renders before the devices query resolves | Cold load | The placeholder "Loading map…" text appears in the map container; the map mounts on the api's response (≤1 s) | The map's container is always present so layout doesn't shift |
| Leaflet CSS fails to load (e.g., offline) | CSP blocks leaflet.css | The map container renders but markers render without border / sizing. Functional but visually degraded. | No console error; the rest of the dashboard still works |
| Marker click while offline (no reading ever) | Click on a never-connected device | Popup says "No reading yet" + the device name + the link. Severity dot is grey. | N/A |
| Reading with all six metrics NaN | Simulator emits `NaN` on one tick | Marker renders with the `critical` severity token (placeholderSeverity returns `critical` for non-finite values). Popup shows "—" for the breached metric value. | NaN contract from Story 2.6 applies |
| 6 devices seeded but only 4 have `last_reading_at` | Partial connect | 4 markers render with severity from readings; 2 markers render in `offline` grey; the popup for the offline markers reads "No reading yet" | N/A |
| Operator uses `prefers-reduced-motion: reduce` | System preference | The `animate-pin-pulse` utility is already disabled by the existing `index.css` rule — the marker renders without the halo but is still red | No change to map behaviour; existing CSS already handles this |

## Tasks & Acceptance

1. **Wire DB schema** — Add `lat` + `lng` columns to `Device` (`Float @db.DoublePrecision`). Migration is non-destructive (nullable columns; existing rows get `null`). Run `prisma migrate dev` and commit the migration.
2. **Extend seed** — Update `packages/simulator/src/devices.json` to include `lat` + `lng` for each of the six devices; update `seed.ts` to upsert those coordinates idempotently. Coordinates: six representative schools around Dhaka, BD (use real lat/lng for school placements — not `0,0`). Update `seedHelpers.ts` if needed.
3. **Add `/api/devices` endpoint** — `GET /api/devices` (RBAC-gated `read Device`). Joins `Device` to `MAX(Reading.serverReceivedAt)` per device. Returns `{ devices: ReadonlyArray<{ id, name, lat, lng, last_reading_at: string | null }> }`. Empty: `{ devices: [] }`. Order by `id ASC`.
4. **Add shared device summary type** — `packages/shared/src/dashboard.ts` exports `DeviceSummary` and `DevicesResponse`. The wire shape is locked here.
5. **Map component** — Replace `MapRegion`'s placeholder body with a `<MapView>` that uses Leaflet. Initializes a `Map` on a `<div ref={mapRef}>`; subscribes to `useQuery(["devices"])` and `useDashboardReadings()`; renders one `Marker` per device joined to its latest reading (severity from `placeholderSeverity`); critical markers apply `animate-pin-pulse`.
6. **Popup affordance** — Click handler opens a `Popup` with: device name, breached metric (first metric outside `PLACEHOLDER_HEALTHY_RANGES`) + value, severity dot, and link to `/devices/{device_id}`. Popup is dismissible via Escape (Leaflet default).
7. **Offline detection** — `isOffline(device, now)` helper: true when `last_reading_at === null` OR `now - last_reading_at > OFFLINE_THRESHOLD_MS` (default 60 s). Exported from `packages/shared/src/dashboard.ts` so the KPI band can adopt it later (out of scope here).
8. **Wire map to realtime** — On `["readings", "latest"]` cache invalidation (already wired by `useDashboardSocket`), the map re-evaluates marker severities via the existing TanStack Query refetch. No new socket subscription.
9. **Empty / loading states** — When the devices query is loading, the map container renders "Loading map…". When the devices query errors (5xx), the map region falls back to the "No devices" empty state. When the devices query succeeds with an empty list, the map region renders "No devices" (no map mounts).
10. **Tests** — `MapRegion.spec.tsx` covers: 6 markers from 6 devices; offline threshold applied; popup content (name, metric, severity dot, link); Escape closes the popup; `prefers-reduced-motion` doesn't crash; the empty state when the devices query 500s.
11. **Lint, type-check, prettier** — green.

## Acceptance Criteria

1. Given the operator is authenticated and visits `/dashboard` with six seeded devices (each with `lat`/`lng`) and at least one fresh reading per non-offline device
   When the page renders
   Then the map shows six markers at the seeded coordinates
   And each marker uses the severity `fill` token from `color.severity.{sev}.fill`

2. Given a critical marker
   When the marker renders
   Then it carries the 2000ms halo from `animate-pin-pulse`
   And non-critical markers render without the halo

3. Given the operator clicks any marker
   When the popup opens
   Then it shows the device name, the breached metric + value, a severity dot, and a link to `/devices/{device_id}`
   And the popup closes on Escape or an outside click

4. Given a device's `last_reading_at > 60 s` (or `null`)
   When the marker re-renders
   Then its colour shifts to the `offline` severity (`#94a3b8`-family grey)
   And the halo disappears
   And the popup reads "Offline — last seen …" or "No reading yet" when `last_reading_at === null`

5. Given the operator's role is Viewer
   When the popup opens
   Then no action buttons (Acknowledge / Assign / Submit Result) render in the popup — the surface is read-only
   And the role gate does not redirect or hide the page

6. Given `GET /api/devices` returns 500
   When the dashboard renders
   Then the map region renders its empty state ("No devices")
   And the KPI band + Live Readings table continue to render from the working readings cache

## Cross-Story Dependencies

- Story 2.5 added `Device.name`; Story 2.7 adds `Device.lat` + `Device.lng` in the same additive style (nullable columns; idempotent backfill).
- Story 2.6 ships `MapRegion` as a placeholder; this story replaces the placeholder body while keeping the `data-testid="dashboard-map-region"` contract.
- Story 2.6's `useDashboardSocket` and `["readings", "latest"]` query key are reused. The map does not subscribe to a separate socket.
- Story 2.9 (Connection State + Offline UX) is independent — its `Reconnecting…` banner rides the socket lifecycle, not the per-device offline threshold. The map's `offline` marker is per-device staleness, distinct from the global banner.
- Story 4.x (Device detail page) is the home of `/devices/{device_id}`. The popup link is a placeholder; resolve Ask-First before merging.
- The `OFFLINE_THRESHOLD_MS` constant lives in `packages/shared/src/dashboard.ts` so the KPI band's `offline` count (currently hard-coded `0`) can adopt it later without a wire change.

## Open Questions (must resolve before / during build)

1. **`OFFLINE_THRESHOLD_MS`.** 60 s default is a guess for the simulator's 2 s tick. A real device on a 30 s tick is fine; a real device on a 60 s tick is borderline. Resolve: confirm with ops.
2. **`/devices/{device_id}` route.** The popup AC says "link to `/devices/{device_id}`" but that route doesn't exist (Epic 4 / 5 territory). Resolve: ship a stub route in this story, or `href="#"` with `aria-disabled`, or omit the link and just show the device_id.
3. **Seed backfill semantics.** Devices seeded before this migration have `lat` = `null`, `lng` = `null`. Add an idempotent update branch in `seed.ts` (matching the Story 2.5 pattern for `name` and `scenario`), or require a one-shot data migration step. Resolve: prefer the Story 2.5 pattern for symmetry.

## Implementation Notes

**Where the work lands:**
- `packages/db/prisma/schema.prisma` — add `lat Float?`, `lng Float?` to `Device`.
- `packages/db/prisma/migrations/<timestamp>_device_coordinates/migration.sql` — generated.
- `packages/simulator/src/devices.json` — six devices with realistic Dhaka-area coordinates.
- `packages/db/prisma/seed.ts` + `seedHelpers.ts` — backfill coordinates idempotently.
- `packages/shared/src/dashboard.ts` — new `DeviceSummary` + `DevicesResponse` types; export `OFFLINE_THRESHOLD_MS` + `isOffline()` helper.
- `packages/api/src/devices/router.ts` (new) — `GET /api/devices` RBAC-gated.
- `packages/api/src/index.ts` — mount the new router.
- `packages/api/src/devices/router.spec.ts` (new) — covers six-device seed, empty DB, partial readings, prisma-error path.
- `packages/web/src/dashboard/MapRegion.tsx` — replace placeholder body with `<MapView>`.
- `packages/web/src/dashboard/MapView.tsx` (new) — Leaflet container + marker management + popup binding.
- `packages/web/src/dashboard/useDashboardDevices.ts` (new) — TanStack Query hook for `["devices"]`.
- `packages/web/src/dashboard/MapRegion.spec.tsx` (new) — covers ACs 1–6.
- `packages/web/src/dashboard/Dashboard.spec.tsx` — extend AC7 with the map-region-empty case (the test already verifies the empty state; assert the testid stays `dashboard-map-region` after the swap).

**Leaftlet usage:**
- Import `L` from `"leaflet"` and the leaflet CSS via the existing `index.css` (if not already linked). The container needs an explicit height (`h-[420px]` or similar) so the map renders.
- Use `L.divIcon({ className: "leaflet-pin-" + severity, html: "<span …/>" })` so the existing Tailwind severity tokens (`bg-severity-{sev}-value`) drive the colour.
- The `Marker` API: `L.marker([lat, lng], { icon }).addTo(map)`. Updating severity: `marker.setIcon(newIcon)` — no remount.
- The popup API: `marker.bindPopup(html)`; the `html` is a static string with placeholders for the breached metric.

**Realtime path:**
- `useDashboardSocket` (existing) invalidates `["readings", "latest"]` on every `reading:new`. The map's `useDashboardReadings` refetches and the markers re-evaluate severities. The map's `useDashboardDevices` does NOT refetch on `reading:new`; only the readings query does.

## Suggested Review Order

**Schema + seed (the additive change behind the map)**

- Device gains nullable `lat` / `lng`; mirrors Story 2.5's `name` / `scenario` pattern.
  [`schema.prisma:41`](../../packages/db/prisma/schema.prisma#L41)
- Postgres `ALTER TABLE` migration; both columns nullable so existing rows stay valid.
  [`migration.sql:15`](../../packages/db/prisma/migrations/20260824010000_device_coordinates/migration.sql#L15)
- Six seeded devices gain real Dhaka-area coordinates (not 0,0); ~23.78N, 90.41E cluster.
  [`devices.json:7`](../../packages/simulator/src/devices.json#L7)
- Seed backfill reuses the Story 2.5 idempotent-update pattern; coordinates only fill when both null.
  [`seedHelpers.ts:79`](../../packages/db/prisma/seedHelpers.ts#L79)

**Shared contract (the wire-shape lock)**

- `OFFLINE_THRESHOLD_MS = 60_000` plus `isOffline()` helper exported for future KPI adoption.
  [`dashboard.ts:176`](../../packages/shared/src/dashboard.ts#L176)
- `DeviceSummary` / `DevicesResponse` types pin the new endpoint's payload.
  [`dashboard.ts:188`](../../packages/shared/src/dashboard.ts#L188)
- `deviceMapSeverity` resolves per-device severity by joining device roster + latest reading.
  [`dashboard.ts:231`](../../packages/shared/src/dashboard.ts#L231)
- `breachedMetric` returns the first metric outside its healthy band — popup's "what tipped" answer.
  [`dashboard.ts:253`](../../packages/shared/src/dashboard.ts#L253)

**API (the new endpoint)**

- `GET /api/devices` router: RBAC-gated `read Device`, returns 500 on prisma throw (AC6).
  [`router.ts:66`](../../packages/api/src/devices/router.ts#L66)
- Router catch surfaces a 500 so the dashboard's empty state fires when the api can't give us devices.
  [`router.ts:77`](../../packages/api/src/devices/router.ts#L77)
- Production wiring: `listDevicesRosterFromPrisma` runs the GROUP BY / MAX join; mounted with the rest of the routers.
  [`index.ts:151`](../../packages/api/src/index.ts#L151)

**Web — TanStack Query layer**

- `useDashboardDevices` adds the `["devices"]` query; 60 s `staleTime` matches the offline threshold.
  [`useDashboardDevices.ts:41`](../../packages/web/src/dashboard/useDashboardDevices.ts#L41)

**Web — Map surface (the entry point)**

- `<MapView>`: Leaflet mount + markers lifecycle; renders one `divIcon` per device.
  [`MapView.tsx:239`](../../packages/web/src/dashboard/MapView.tsx#L239)
- `buildIconHtml` builds the 14px circle, severity fill, 2px white border, pulse class for critical.
  [`MapView.tsx:105`](../../packages/web/src/dashboard/MapView.tsx#L105)
- `buildPopupHtml` formats the device name + breached metric + severity dot + `/devices/{id}` link.
  [`MapView.tsx:121`](../../packages/web/src/dashboard/MapView.tsx#L121)
- Markers effect: `addTo` + `setIcon` so severity flips without unmounting the marker.
  [`MapView.tsx:312`](../../packages/web/src/dashboard/MapView.tsx#L312)
- `<MapRegion>`: four rendering states (loading / error / empty / populated) — replace Story 2.6's placeholder.
  [`MapRegion.tsx:37`](../../packages/web/src/dashboard/MapRegion.tsx#L37)

**Tests + supporting changes**

- New `MapRegion.spec.tsx` covers AC1–AC6 + reduced-motion + loading + live severity flip + stale popup body.
  [`MapRegion.spec.tsx:1`](../../packages/web/src/dashboard/MapRegion.spec.tsx#L1)
- `breachedMetric` ordering pinned by a two-out-of-range test (Story 2.7 review patch).
  [`dashboard.spec.ts:228`](../../packages/shared/src/__tests__/dashboard.spec.ts#L228)
- `Dashboard.spec.tsx` AC3 / AC7 waitFor the new devices query (Story 2.7's loading state is now real).
  [`Dashboard.spec.tsx:337`](../../packages/web/src/dashboard/Dashboard.spec.tsx#L337)
- Sprint-status: `2-7-map-view` moves from `backlog` to `in-progress`; epic-2 stays `in-progress`.
  [`sprint-status.yaml:84`](../../_bmad-output/implementation-artifacts/sprint-status.yaml#L84)
</content>
