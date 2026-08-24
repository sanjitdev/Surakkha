---
title: 'Story 2.8 — Live Readings Table'
type: 'feature'
created: '2026-08-24'
status: 'done'
baseline_commit: '252b08125da1685ad5a62ba9b90235703e3dfe1e' # feat(web): Story 2.7 — /dashboard map view with severity-coded Leaflet markers
review_loop_iteration: 0
context:
  - _bmad-output/planning-artifacts/epics.md#story-28
  - _bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/EXPERIENCE.md
  - _bmad-output/implementation-artifacts/2-6-dashboard-shell.md
  - _bmad-output/implementation-artifacts/spec-2-7-map-view.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Story 2.6 dashboard shell ships `LiveReadingsRegion` as a placeholder card with the hint "Story 2.8 wires the real surface." A reviewer running `docker compose up` lands on `/dashboard` and sees the four-region shell with a "No readings yet" empty card instead of an operator-scannable table — the demo loop ends at "six markers on the map" rather than "six markers on the map AND six rows in the live readings table, one of them glowing red after a TDS spike lands".

**Approach:** Replace `LiveReadingsRegion`'s placeholder body with a monospace, severity-coded row-per-device table that mounts once and stays mounted through `reading:new` cache invalidations. Each row carries a transient 1200ms `animate-live-pulse` glow when its value updates (the glow is replayed — not keyframed — by toggling the class on a per-row ref keyed off the reading's `server_received_at`). Critical rows adopt the documented UX-DR-2 visual hierarchy (4px critical left border + 3px inner + 8px outer glow); non-critical rows keep a calm border. The Viewer role gets the same read-only surface; no sort, no per-row buttons, and the visual severity rules apply across every role.

## Boundaries & Constraints

**Always:**
- DOM order remains KPI band → Map → Live Readings → Recent Incidents (Story 2.6; do not reorder).
- One row per device; columns are exactly: device (name + id), metric (key + value, value monospace), severity (dot + label), age (relative, e.g., "just now" / "12s ago").
- Rows are ordered deterministically: by severity rank (critical → warning → healthy → offline), then by `device_id ASC` so the freshly-tripped critical row always sits at the top.
- The table subscribes to no socket of its own. `useDashboardSocket`'s `["readings", "latest"]` invalidation is the single realtime path. Row glows replay via a per-row `server_received_at` ref — no re-mount.
- Critical row visual hierarchy per UX-DR-2: 4px critical left border (`border-l-4 border-severity-critical-value`), 3px calm inner border (`border-r border-t border-b border-severity-critical-value`), 8px outer glow (`shadow-[0_0_8px_#EF444433]` — reuses the existing `boxShadow.elevation-banner-critical` literal). Non-critical rows: `border border-neutral-border`.
- The 1200ms transient pulse uses the EXISTING `animate-live-pulse` Tailwind utility (already wired to `surakkha-live-pulse` keyframes in `index.css:141` — `transitionDuration["live-pulse"] = "1200ms"`). `prefers-reduced-motion` already disables it.
- Severity dot reuses `bg-severity-{sev}-value` (the same lookup `MapView.tsx:76` already exports — keep parity so the four markers, the four KPI cards, and the four row dots use identical colour tokens).
- Severity label uses the existing severity enum (`healthy | warning | critical`); the table never invents new labels.
- Age column: live-update logic computes "just now" within 5 s of `server_received_at`, then rounds to "<n>s ago" / "<n>m ago". The pulse and the "just now" reset happen together — a `reading:new` flips the row into a 1200ms glow and resets the age text in lockstep.
- Empty / loading / error: the same Region wrapper stays in the tree (Story 2.6 contract). Empty (`readings.length === 0`) renders the static "No readings yet" copy (no animation). Error (`isError`) renders the same empty copy — never blanks the page.
- Viewer role: read-only surface, no sort control, no per-row action buttons, no acknowledge / assign / submit-result affordances (those land in Epic 4). Visual severity rules apply identically across Viewer / Operator / Admin.

**Ask First:**
- Whether the row sort order (severity rank DESC, then `device_id ASC`) is the operator-preferred view for the live-readings table, or whether the operator expects a chronological "newest at top" order (matching the api's `server_received_at DESC`). Resolve before implementation.
- Whether the breached metric column should show the first metric outside `PLACEHOLDER_HEALTHY_RANGES` (and only when severity is `critical`) or always show all six metrics as the data surface. Resolve before implementation.

**Never:**
- Do not unmount the table on socket reconnect. `useDashboardReadings`'s queryClient owns the data; React never depends on socket state (Story 2.6 AC5 contract).
- Do not animate on first render. The static "No readings yet" empty state never pulses.
- Do not introduce new design tokens. Severity `fill`/`value`/`text`/`bg`/`glow` already exist; the existing `animate-live-pulse` keyframes drive the transient glow.
- Do not introduce a sort control. AC4 is "read-only, no sort" — a sort button on the region would violate the read-only contract.
- Do not add per-row action buttons (Acknowledge / Assign / Submit Result). Epic 4 owns those endpoints; this story stays read-only.
- Do not keyframe a new 1200ms pulse. The existing `.animate-live-pulse` Tailwind utility (`index.css:141`) is exactly what AC3 wants — reuse it by toggling the class on each affected row.
- Do not import `@surakkha/api` from `@surakkha/web`. The web talks to the api over HTTP only.
- Do not change the wire shape of `LatestReadingPayload`. The table reads the same `/api/readings/latest` payload the KPI band and the map already consume.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Operator lands on `/dashboard` after seed | 6 devices, 5 with fresh readings + 1 Offline-scenario device with `last_reading_at > 60 s` ago | 6 rows render. The offline row renders with `severity = offline` (no red glow, no border-l-4). The 5 fresh rows render with their reading's severity; the critical row gets the 4/3/8 hierarchy and `aria-live="polite"` | N/A |
| Operator lands on `/dashboard` before any readings arrive | 6 seeded devices, no readings in DB | Region renders the static "No readings yet" empty state (no animation, no spinner) | N/A |
| Viewer role on `/dashboard` | Viewer can read Device + Reading | Same as Operator; no sort control, no per-row action buttons | RBAC passes; no change to surface |
| `reading:new` arrives for a healthy device | Socket event payload + cached reading refresh | Affected row plays the 1200ms `animate-live-pulse` glow once; the row's `server_received_at` ref triggers the age column to reset to "just now"; the row stays mounted (no remount) | N/A |
| `reading:new` arrives for a device that was previously healthy and now breaches | Socket event + cached reading refresh | Affected row's severity flips to `critical`; the row applies the 4/3/8 hierarchy; the 1200ms glow plays once on the same render | N/A |
| `reading:new` arrives for a previously critical device that returns to healthy | Socket event + cached reading refresh | Affected row's severity flips to `healthy`; the 4/3/8 hierarchy drops; the 1200ms glow plays once | N/A |
| Operator presses `Tab` while focused on the table | Keyboard nav | Each row is reachable in DOM order; each row has a `role="row"`; the severity cells announce `aria-label="critical severity"` etc. | N/A |
| `GET /api/readings/latest` 500 (DB down) | DB unavailable | Region renders the static "No readings yet" empty state; the KPI band + Map still work from independent queries; the page does not blank | TanStack Query's `isError` flag drives the empty-state branch |
| `prefers-reduced-motion: reduce` is set | System preference | The `animate-live-pulse` utility is already disabled by the existing `index.css:188` rule — the row renders without the glow but the age reset still happens | No change to row data |
| Six readings, sorted critical→warning→healthy→offline by severity | Orderly seed | Rows render in the documented rank order; the `device_id` tiebreaker keeps order stable across re-renders when severities overlap | N/A |
| All six metrics NaN (RandomFailure scenario) | Simulator emits `NaN` on one tick | Row stays present; the value cell renders `—` (`\u2014`); the row's severity is `critical` (per `placeholderSeverity` non-finite contract) | NaN contract from Story 2.6 applies |

## Code Map

- `_bmad-output/planning-artifacts/epics.md:884-912` — verbatim Story 2.8 ACs (4 bullets; operator persona; covers UX-DR-2 row portion + UX-DR-6).
- `packages/web/src/dashboard/LiveReadingsRegion.tsx:1-45` — Story 2.6 placeholder to replace; static "No readings yet" copy stays as the empty-state branch. Header contract (`data-testid="dashboard-live-readings-region"`, `data-region="live-readings"`, `aria-label="Live Readings"`, `rounded-card border border-neutral-border bg-neutral-surface p-density-card`) holds.
- `packages/web/src/dashboard/Dashboard.tsx:71-74` — `<LiveReadingsRegion readings={readings} />` already wired with the same `readings` array the KPI band + Map consume. No new prop.
- `packages/web/src/dashboard/useDashboardReadings.ts:66-84` — `useDashboardReadings()` returns `{ data, isError, isLoading }`. The Region uses `data?.readings ?? []` and the same `isError` → empty-state branch the KPI band already uses.
- `packages/shared/src/dashboard.ts:131-146` — `placeholderSeverity(reading)` returns `healthy | warning | critical`. Use this verbatim. The row severity also has `offline` only for devices whose `last_reading_at` lapsed — derive via `isOffline(device, now)` (Story 2.7 helper, `packages/shared/src/dashboard.ts:212`). The Live Readings rows have no `DeviceSummary` (only `LatestReadingPayload`); therefore `offline` for a row means the reading's `server_received_at` lapsed past `OFFLINE_THRESHOLD_MS`. **Note**: the table rows are keyed off readings, not devices — a device that never connected has no reading, no row.
- `packages/web/src/dashboard/MapView.tsx:76-81` — `SEVERITY_CLASS: Record<MapSeverity, string>` maps severity → `bg-severity-{sev}-value`. Mirror this in the row's severity-dot and severity-bar tokens. Same literal table.
- `packages/web/tailwind.config.ts:53-83` — already exposes `color.severity.{sev}.{value, text, fill, bg, glow}`. Reuse directly; no Tailwind edit.
- `packages/web/tailwind.config.ts:163` — `transitionDuration["live-pulse"] = "1200ms"` is already wired.
- `packages/web/src/index.css:130-143` — `@keyframes surakkha-live-pulse` + `.animate-live-pulse` utility (1200ms ease-out, single iteration). Reduced-motion override at lines 187-197 disables it. **No new CSS** — toggle the existing class.
- `packages/web/src/index.css:148-167` — `@keyframes surakkha-critical-pulse` is the steady-state 1500ms heartbeat. Not used here — UX-DR-6 says critical pulse is reserved for KPI / banner; the row's 1200ms transient is the live-update path only.
- `packages/shared/src/rbac.ts:278-336` — Viewer grants `read Device = true` + `read Reading = true`. The page is mounted inside `CurrentRoleProvider` (Story 2.6); no `<RbacRoute>` wrapper needed. AC4's read-only contract comes from this matrix — the table never has buttons to hide.
- `packages/web/src/dashboard/MapView.tsx:175-191` — `escapeHtml` helper (the Leaflet popup sinks HTML). The table is React-rendered (not innerHTML), so React's escaping covers us — do NOT call `escapeHtml` in the row.
- `packages/web/src/dashboard/Dashboard.tsx:54-57` — `readings = readingsQuery.data?.readings ?? []`. The Region reads the same array; sorting by severity-rank + `device_id` is a per-render `useMemo` inside `LiveReadingsRegion`.
- `packages/web/src/dashboard/Dashboard.spec.tsx` — six existing ACs (Story 2.6 + 2.7 patches). Story 2.8 ADDS new tests for the live-readings surface (table rendering, severity borders, transient pulse, age reset, Viewer read-only, 500 fallback); does NOT regress the existing six matrix rows.

## Tasks & Acceptance

1. [x] `packages/web/src/dashboard/LiveReadingsRow.tsx` (NEW) — Render one row from a `LatestReadingPayload`. Props: `readonly reading: LatestReadingPayload`. Computes severity via `placeholderSeverity` + age via `server_received_at`; uses a `useRef<HTMLDivElement>` keyed off `reading.server_received_at` to toggle `animate-live-pulse` on every render where `server_received_at` advanced. Renders the four columns; applies the 4/3/8 critical border hierarchy when severity is `critical`; announces `aria-live="polite"` only on critical rows.
2. [x] `packages/web/src/dashboard/LiveReadingsRegion.tsx` (MOD) — Replace Story 2.6 placeholder body with the table. Branch: `isError || readings.length === 0` → static "No readings yet" empty state (preserves the existing `data-testid="dashboard-live-readings-empty"`). Otherwise: `<table role="table" aria-label="Live readings"><thead><tr>... columns ...</tr></thead><tbody>{sortedRows}</tbody></table>`. Sort: `severityRank(sev) DESC` first, then `device_id ASC`. Header row: device / metric / severity / age.
3. [x] `packages/web/src/dashboard/LiveReadingsRegion.spec.tsx` (NEW) — Test: six rows render from six readings; critical row carries the 4/3/8 hierarchy; `aria-live="polite"` only on critical rows; `animate-live-pulse` toggles on when `server_received_at` advances (DOM update test — assert the class is present on the affected row after a re-render); age text resets to "just now" within 5 s; Viewer role renders the same read-only surface (assert no buttons exist); `isError` falls back to "No readings yet".
4. [x] `packages/web/src/dashboard/Dashboard.spec.tsx` (MOD) — Existing AC4 (`live-readings-empty` textContent) still passes. No regression on AC1–AC7.
5. [x] `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` — green across all five packages.

**Acceptance Criteria:**

1. Given six devices are connected and `/api/readings/latest` returns six readings
   When the dashboard renders
   Then the Live Readings region shows six rows in document order
   And each row has columns: device (name + id), metric (key + monospace value), severity (dot + label), age (relative text)
2. Given a row's severity is `critical`
   When the row renders
   Then it has a 4px critical left border, a 3px critical inner border, and an 8px outer critical glow
   And the row uses `aria-live="polite"`
3. Given a `reading:new` event updates a row's payload
   When the row re-renders
   Then the row toggles the `animate-live-pulse` class for 1200ms
   And the age column resets to "just now"
4. Given the operator's role is Viewer
   When the dashboard renders
   Then the table is read-only with no sort control and no per-row action buttons
   And the visual severity rules apply identically

## Design Notes

**Severity rank order** — critical → warning → healthy → offline. A critical row floats to the top so a freshly-tripped device is the operator's first read; ties break on `device_id ASC` so order stays stable across re-renders.

**Transient pulse** — `animate-live-pulse` is a one-shot keyframe (single iteration at `animation: surakkha-live-pulse 1200ms ease-out 1` per `index.css:142`). To replay it on every `reading:new`, the row holds a `ref<HTMLDivElement>` and toggles `classList` from `animate-live-pulse` → `""` → `animate-live-pulse` in a `useEffect` keyed on `server_received_at`. The `animation` property replays because the browser sees a fresh class application, not a `classList.add` on a node that already owns the class.

**Age text** — pure function: `formatAge(server_received_at, now) → "just now" | "<n>s ago" | "<n>m ago"`. Capped at `<n>m ago` so a stale row never shows "2h 17m ago" — the offline threshold is the more meaningful signal (Story 2.7's `isOffline()` flips to `offline` at 60 s).

## Suggested Review Order

**Entry point — the row's surface contract**

- The single highest-leverage file for AC1/AC2/AC3 contracts (border hierarchy, aria-live, pulse replay, metric cell).
  [`LiveReadingsRow.tsx:174`](../../packages/web/src/dashboard/LiveReadingsRow.tsx#L174)

- Border-literal Tailwind class is a single static string — the JIT scanner sees it whole (the HIGH-severity fix).
  [`LiveReadingsRow.tsx:103`](../../packages/web/src/dashboard/LiveReadingsRow.tsx#L103)

- Pulse-replay useEffect: ref-guard, first-mount skip, two-tick classList toggle keyed off `server_received_at`.
  [`LiveReadingsRow.tsx:190`](../../packages/web/src/dashboard/LiveReadingsRow.tsx#L190)

- Per-metric display precision + `formatMetricCell` (breached metric on critical, falls back to `ph` otherwise).
  [`LiveReadingsRow.tsx:136`](../../packages/web/src/dashboard/LiveReadingsRow.tsx#L136)

- `formatAge` pure function: 5s/60s thresholds, negative-delta clamp, non-finite timestamp guard.
  [`LiveReadingsRow.tsx:72`](../../packages/web/src/dashboard/LiveReadingsRow.tsx#L72)

**Region — table assembly, sort, empty state**

- Region replaces Story 2.6 placeholder with the sorted rows + header row; preserves the empty-state `data-testid`.
  [`LiveReadingsRegion.tsx:70`](../../packages/web/src/dashboard/LiveReadingsRegion.tsx#L70)

- Severity-rank comparator + tiebreaker — the spec contract "critical → warning → healthy, then device_id ASC".
  [`LiveReadingsRegion.tsx:54`](../../packages/web/src/dashboard/LiveReadingsRegion.tsx#L54)

**Shared tokens**

- Severity class + glyph extracted from `MapView.tsx` so map markers, KPI dots, and row dots share one literal table.
  [`severityTokens.ts:1`](../../packages/web/src/dashboard/severityTokens.ts#L1)

- `MapView` swaps its local copies for the imported lookup; behaviour unchanged.
  [`MapView.tsx:55`](../../packages/web/src/dashboard/MapView.tsx#L55)

**Tests**

- 20-test spec covers all four ACs + sort stability + idempotency + stale→fresh transition + empty-state.
  [`LiveReadingsRegion.spec.tsx:109`](../../packages/web/src/dashboard/LiveReadingsRegion.spec.tsx#L109)
