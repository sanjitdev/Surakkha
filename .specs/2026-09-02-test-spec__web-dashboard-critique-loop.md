# Test spec — `packages/web/src/dashboard` critique loop (2026-09-02)

## Scope

Regression pins for the 2026-09-02 `/impeccable critique packages/web/src/dashboard` loop.

Critique artifact: `.impeccable/critique/2026-09-02T20-00-00Z__packages-web-src-dashboard.md`. Score: **28/40**. Eight P1 fixes (11 oversized narrative headers; 4 Tailwind-JIT-caveat duplicates; self-critique narratives in MapView + severityTokens; 4 wire-shape-mismatch blocks across 2 hook files; LiveReadingsRow 45-line header; METRIC_PRECISION table re-implementing spec; useDashboardSocket 40-line header) and ~27 P2 fixes shipped in this PR.

## Behavioural pins (UI / RTL)

### Dashboard

| #   | Given                           | When         | Then                                                                        |
| --- | ------------------------------- | ------------ | --------------------------------------------------------------------------- |
| 1   | Mount                           | First render | `data-testid="dashboard-root"` visible                                      |
| 2   | Always                          | Render       | DOM order: KpiBand → MapRegion → LiveReadingsRegion → RecentIncidentsRegion |
| 3   | All queries loading             | Render       | Four regions render with empty-state copy in place of data                  |
| 4   | Readings query 500              | Render       | All four regions render empty-state copy (KPI counts default to 0/0/0/0)    |
| 5   | Socket disconnects + reconnects | Real-time    | The component does NOT unmount; `reading:new` resumes invalidation          |

### KpiBand

| #   | Given                                                          | When   | Then                                                                                                                      |
| --- | -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 6   | Always                                                         | Render | `data-testid="dashboard-kpi-band"` shows 4 cards in `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`                           |
| 7   | `counts = { healthy: 0, warning: 0, critical: 0, offline: 0 }` | Render | Each card shows `value="0"` + `sub="—"` (the "no data" calm hint)                                                         |
| 8   | `counts = { healthy: 5, warning: 2, critical: 1, offline: 0 }` | Render | Cards show `value="5"` / `"2"` / `"1"` / `"0"` + `sub="within range"` / `"de-bounced"` / `"out of range"` / `"no signal"` |

### MapRegion

| #   | Given                       | When   | Then                                                                                     |
| --- | --------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| 9   | Devices loading             | Render | `data-testid="dashboard-map-loading"` ("Loading map…") visible; no `MapView` mount       |
| 10  | Devices query errored       | Render | `data-testid="dashboard-map-empty"` ("No devices") visible; no map                       |
| 11  | Devices query returned `[]` | Render | `data-testid="dashboard-map-empty` visible                                               |
| 12  | Devices populated           | Render | `data-testid="dashboard-map-view"` mounted; header reads "N devices on the map" (plural) |
| 13  | 1 device                    | Render | Header reads "1 device on the map" (singular)                                            |

### MapView

| #   | Given                                    | When        | Then                                                                                                                                                 |
| --- | ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | Always                                   | Render      | `data-testid="dashboard-map-view"` is a `<div role="region" aria-label="Devices map">` with literal class `h-[420px]` (Tailwind scanner picks it up) |
| 15  | 6 devices, fresh readings                | Render      | 6 Leaflet markers mount; positions = seeded coordinates; severity fill classes applied                                                               |
| 16  | Device severity flips critical → healthy | Real-time   | Marker's `divIcon` is swapped via `marker.setIcon(...)` (not unmounted); popup re-renders                                                            |
| 17  | Device's `last_reading_at` > 24h ago     | Render      | Popup body shows "Offline — last seen Nd ago"                                                                                                        |
| 18  | Device's `last_reading_at` 1h-24h ago    | Render      | Popup body shows "Offline — last seen Nh ago"                                                                                                        |
| 19  | Device's `last_reading_at` < 1h ago      | Render      | Popup body shows "Offline — last seen Nm ago"                                                                                                        |
| 20  | Device's `last_reading_at` unparseable   | Render      | Popup body shows "Offline" (no age label)                                                                                                            |
| 21  | Device's `last_reading_at` is null       | Render      | Popup body shows "No reading yet"                                                                                                                    |
| 22  | Device name contains `<script>`          | Render      | Popup escapes via `escapeHtml`; the literal text is shown, no script execution                                                                       |
| 23  | Device has no lat/lng                    | Render      | No marker mounted for that device (others still render)                                                                                              |
| 24  | StrictMode double-mount                  | Mount cycle | Map mounts once; cleanup correctly tears down via `map.remove()` + `markers.clear()`                                                                 |

### LiveReadingsRegion

| #   | Given            | When   | Then                                                                      |
| --- | ---------------- | ------ | ------------------------------------------------------------------------- |
| 25  | 0 readings       | Render | `data-testid="dashboard-live-readings-empty"` ("No readings yet") visible |
| 26  | 0 readings       | Render | Header right-side reads "0 devices"                                       |
| 27  | 1 reading        | Render | Header right-side reads "1 device" (singular)                             |
| 28  | N readings       | Render | Header right-side reads "N devices"                                       |
| 29  | Mixed severities | Render | Rows sorted: critical → warning → healthy, then `device_id ASC`           |
| 30  | 4-column header  | Render | Column headers: Device, Metric, Severity, Age (right-aligned)             |

### LiveReadingsRow

| #   | Given                                            | When      | Then                                                                                                                                     |
| --- | ------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 31  | Critical reading                                 | Render    | Outer row has literal `border-l-4 border-severity-critical-value ... shadow-elevation-row-critical` class (Tailwind scanner picks it up) |
| 32  | Healthy / warning reading                        | Render    | Outer row has plain `border border-neutral-border`                                                                                       |
| 33  | Critical reading                                 | Render    | Severity cell has `aria-live="polite"`; aria-label = "{sev} severity"                                                                    |
| 34  | Non-critical reading                             | Render    | Severity cell has no `aria-live`                                                                                                         |
| 35  | Reading's metric is breached                     | Render    | Metric cell shows `<breachedKey>=<value>` with per-metric precision                                                                      |
| 36  | Reading is healthy                               | Render    | Metric cell shows `ph=<value>` (fallback)                                                                                                |
| 37  | Metric value is NaN                              | Render    | Metric cell shows `<key>=—`                                                                                                              |
| 38  | First render                                     | Mount     | Row does NOT pulse (initial mount skip)                                                                                                  |
| 39  | `server_received_at` advances                    | Re-render | Row replays the 1200ms `animate-live-pulse` glow (remove → reflow → add)                                                                 |
| 40  | Re-render with same `server_received_at`         | Re-render | Row does NOT re-pulse                                                                                                                    |
| 41  | Age < 5s                                         | Render    | "just now"                                                                                                                               |
| 42  | 5s ≤ Age < 60s                                   | Render    | "Ns ago"                                                                                                                                 |
| 43  | Age ≥ 60s                                        | Render    | "Nm ago"                                                                                                                                 |
| 44  | Age unparseable                                  | Render    | "—" (em dash)                                                                                                                            |
| 45  | Metric key missing from payload                  | Render    | Falls back to "—"                                                                                                                        |
| 46  | Severity precision: ph                           | Render    | `value.toFixed(1)`                                                                                                                       |
| 47  | Severity precision: tds_ppm / water_level_cm     | Render    | `value.toFixed(0)`                                                                                                                       |
| 48  | Severity precision: turbidity_ntu / chlorine_ppm | Render    | `value.toFixed(2)`                                                                                                                       |

### RecentIncidentsRegion

| #   | Given                                | When   | Then                                                                                    |
| --- | ------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| 49  | 0 incidents                          | Render | `data-testid="dashboard-recent-incidents-empty"` ("No incidents in the last 24 hours.") |
| 50  | N incidents                          | Render | `data-testid="dashboard-recent-incidents-list"` with N `<li>` rows                      |
| 51  | Each row                             | Render | Shows `<Severity Label> · <metric> · <value>`; no action buttons                        |
| 52  | Severity = info / warning / critical | Render | Label is "Info" / "Warning" / "Critical"                                                |

### useDashboardReadings

| #   | Given                                        | When                                | Then                                                                                                     |
| --- | -------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 53  | api 200 + valid envelope                     | `useDashboardReadings().refetch()`  | Returns `{ readings: [...] }`                                                                            |
| 54  | api 500                                      | refetch                             | Throws `Error("/api/readings/latest failed: 500")`                                                       |
| 55  | api 200 + malformed envelope                 | refetch                             | Throws `Error("readings/latest wire-shape mismatch")`; `console.error` called with that label + ZodError |
| 56  | api 200 + valid incidents                    | `useDashboardIncidents().refetch()` | Returns `{ incidents: [...] }`                                                                           |
| 57  | api 200 + malformed incidents                | refetch                             | Throws `Error("incidents/recent wire-shape mismatch")`                                                   |
| 58  | `summarizeReadings([])`                      | Call                                | Returns `{ healthy: 0, warning: 0, critical: 0, offline: 0 }`                                            |
| 59  | `summarizeReadings([3 healthy, 2 critical])` | Call                                | Returns `{ healthy: 3, warning: 0, critical: 2, offline: 0 }`                                            |

### useDashboardSocket

| #   | Given                                       | When                  | Then                                                                          |
| --- | ------------------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| 60  | Mount                                       | First effect run      | Subscribes to `reading:new` on `connectSocket({ url: "/dashboard" })`         |
| 61  | `reading:new` event                         | Receives              | `queryClient.invalidateQueries({ queryKey: ["readings", "latest"] })` invoked |
| 62  | Unmount                                     | Cleanup               | `socket.off("reading:new", handleReading)` invoked                            |
| 63  | `connectSocket` returns 401 / token_expired | `onSessionLost` fires | Navigates to `/login?next=/dashboard`                                         |
| 64  | Custom `url` arg                            | Mount                 | Socket connects to that URL (test seam)                                       |

### useDashboardDevices

| #   | Given               | When    | Then                                                            |
| --- | ------------------- | ------- | --------------------------------------------------------------- |
| 65  | api 200 + valid     | refetch | Returns `{ devices: [...] }`                                    |
| 66  | api 500             | refetch | Throws `Error("/api/devices failed: 500")`                      |
| 67  | api 200 + malformed | refetch | Throws `Error("devices wire-shape mismatch")`                   |
| 68  | `staleTime`         | Config  | Equals `OFFLINE_THRESHOLD_MS` from `@surakkha/shared/dashboard` |

## Static / lint pins

| #   | Property                                                                           | Required value                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 69  | All 11 source files                                                                | Opening `/** ... */` block ≤ 6 lines. Pre-loop: 14-45 lines                                                                                                                                                                                           |
| 70  | `safeParse + console.error + throw new Error("X wire-shape mismatch")` block count | Exactly **1** (the shared `assertWireShape<T>` helper in `useDashboardReadings.ts`). Pre-loop: 4 across 2 files                                                                                                                                       |
| 71  | Tailwind-JIT-caveat duplication count                                              | Exactly **1** canonical reference (kept inline at the `PIN_SIZE_PX` constant block in `MapView.tsx` + one on `CRITICAL_BORDER_CLASS` in `LiveReadingsRow.tsx`). Pre-loop: 4                                                                           |
| 72  | `severityTokens.ts` opening header                                                 | ≤ 5 lines. Pre-loop: 22 lines                                                                                                                                                                                                                         |
| 73  | `MapView.tsx` opening header                                                       | ≤ 6 lines. Pre-loop: 43 lines                                                                                                                                                                                                                         |
| 74  | `LiveReadingsRow.tsx` opening header                                               | ≤ 6 lines. Pre-loop: 45 lines                                                                                                                                                                                                                         |
| 75  | `useDashboardSocket.ts` opening header                                             | ≤ 5 lines. Pre-loop: 40 lines                                                                                                                                                                                                                         |
| 76  | `useDashboardReadings.ts` opening header                                           | ≤ 6 lines. Pre-loop: 14 lines                                                                                                                                                                                                                         |
| 77  | Story-internal jargon                                                              | No "Story 2.6 AC1/AC2/AC3/AC5/AC7" / "Story 2.7's MapView.tsx:76" / "Story 2.8 review extracted" / "Critique 2026-08-31 valley finding" / "Verification-Gap review VG-1" / "VG-4" / "Epic 2 §UX" / "Epic 3 rule engine" in source headers or comments |
| 78  | `useDashboardReadings.ts` exports                                                  | Exports `assertWireShape`, `useDashboardReadings`, `useDashboardIncidents`, `summarizeReadings`, `KpiCounts`                                                                                                                                          |
| 79  | `useDashboardDevices.ts` import path                                               | `import { assertWireShape } from "./useDashboardReadings"` (the helper lives in the readings file, not a separate `assertWireShape.ts`)                                                                                                               |
| 80  | MapView `divIcon` construction                                                     | Single `L.divIcon({...})` per iteration (extracted out of the if/else duplication)                                                                                                                                                                    |
| 81  | `MapView.tsx` total line count                                                     | ≤ 280 (post-refactor). Pre-loop: 377                                                                                                                                                                                                                  |

## Negative pins (regression guards)

| #   | Behaviour                                  | Must NOT happen                                                                                                         |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 82  | `useDashboardReadings` wire-shape mismatch | Throw a bare `new Error("ZodError")` — must throw with the operation label (`readings/latest` / `incidents/recent`)     |
| 83  | `MapView` marker lifecycle                 | Unmount + remount a marker on severity change — must `setIcon` instead                                                  |
| 84  | `LiveReadingsRow` pulse                    | Pulse on initial mount — must skip via `firstMountRef`                                                                  |
| 85  | `MapRegion` 5xx                            | Toast the operator — must silently fall through to "No devices" (out of scope per critique; behaviour preservation pin) |
| 86  | Source file headers                        | Re-introduce a 14+ line narrative block re-telling the story                                                            |
| 87  | `severityTokens.ts`                        | Re-add "Story 2.7's `MapView.tsx:76` originally owned this lookup" narrative                                            |

## Verification commands

```bash
cd packages/web && npx tsc -b
cd packages/web && npx eslint src/dashboard
cd packages/web && npx vitest run src/dashboard
```

Existing specs: `Dashboard.spec.tsx`, `MapRegion.spec.tsx`, `LiveReadingsRegion.spec.tsx`. All must remain green.
