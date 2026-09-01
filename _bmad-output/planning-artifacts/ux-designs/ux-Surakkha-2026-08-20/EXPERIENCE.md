---
status: final
created: 2026-08-20
updated: 2026-08-20
owner: Sanjit
project: Surakkha
purpose: Behavioural and information-architecture contract for Surakkha
form_factor: responsive-web
reference_width: 1280px
min_width: 360px
ui_system: Hand-rolled Tailwind utilities on a strict token system (Tailwind config is the single source of truth at `packages/web/tailwind.config.ts`; primitives live in `packages/web/src/components/`). shadcn/ui was on the original plan but was not adopted — see `DESIGN.md` §`ui_system` for the binding definition.
stack:
  - Vite
  - React 18
  - TypeScript
  - TanStack Query
  - Socket.IO client
  - Tailwind CSS
  - Recharts
  - Leaflet
  - react-i18next
i18n:
  active: en
  scaffolded: bn
theming:
  modes: [light, dark]
  default: system
  manual_toggle: false
sources:
  - docs/Surakkha-PRD.md
  - docs/Surakkha-BRD.md
  - docs/architecture.md
  - docs/Surakkha-idea-refined.md
mocks:
  - .working/key-dashboard.html
  - .working/key-incident-detail.html
  - .working/key-admin-simulator.html
  - .working/key-login.html
  - .working/key-sensor-detail.html
  - .working/key-incident-kanban.html
spine_only_surfaces:
  - alerts list
  - audit log
  - admin/users
  - admin/thresholds
  - admin/notifications
  - reports
  - sensors list
  - login-only state
protagonist: Rahim, Operator
route_inventory:
  - { path: /login, role: public, surface: login }
  - { path: /dashboard, role: any-auth, surface: executive dashboard }
  - { path: /sensors, role: any-auth, surface: sensors list, spine_only: true }
  - { path: /sensors/:id, role: any-auth, surface: sensor detail }
  - { path: /incidents, role: any-auth, surface: incident Kanban }
  - { path: /incidents/:id, role: any-auth, surface: incident detail }
  - { path: /alerts, role: any-auth, surface: alerts list, spine_only: true }
  - { path: /reports, role: operator+, surface: reports, spine_only: true }
  - { path: /admin/simulator, role: admin, surface: admin simulator }
  - { path: /admin/notifications, role: admin, surface: notification log, spine_only: true }
  - { path: /admin/thresholds, role: admin, surface: threshold management, spine_only: true }
  - { path: /admin/users, role: admin, surface: user management, spine_only: true }
  - { path: /admin/schools, role: admin, surface: school onboarding }
  - { path: /audit, role: admin, surface: audit log, spine_only: true }
---

# Surakkha — EXPERIENCE.md

> **Spines win on conflict with any mock, wireframe, or import. This file owns _how the product works_. Visual identity lives in DESIGN.md.**

## Foundation

> **How to read tokens.** `{path.to.token}` references in this file use dotted token paths declared in `DESIGN.md` frontmatter and list bodies. Examples: `{color.severity.healthy.value}`, `{motion.live_pulse_ms}`, `{layout.sidebar_width}`, `{banner.critical.dismiss}`. When a token is nested under a `tokens:` block in DESIGN.md, the experience-side path is the dotted child key (e.g. `color.severity.healthy.value`). When a token is at the top level (e.g. `voice.register`, `stack`), the path is the plain key. This convention is the canonical Google Labs DESIGN.md syntax; do not rewrite wholesale interpolations as nested paths.
>
> **Acronyms.** RBAC = role-based access control; MQTT = message-queuing telemetry transport (the device transport in v1); HTTPS = HTTP over TLS (the device REST fallback); TDS = total dissolved solids (water-safety metric, ppm); pH = acidity/alkalinity (water-safety metric, unitless 0–14); PRD = product requirements document; BRD = business requirements document; NFR = non-functional requirement; KPI = key performance indicator; JWT = JSON Web Token; CSS / JSON / SVG / HTML = standard web acronyms; Socket.IO = bidirectional WebSocket transport; TanStack Query = server-state cache for React; Recharts / Leaflet = chart and map libraries; Inter = the brand typeface; Tailwind CSS = utility CSS framework; shadcn/ui = accessible component primitives.

- Product: water-safety monitoring platform (Surakkha) — devices push telemetry over MQTT/HTTPS; rules engine emits alerts; incidents are opened, assigned, and closed by named humans.
- Roles (BRD §6): **Admin**, **Operator**, **Technician**, **Viewer** — RBAC enforced server-side and mirrored in nav.
- Protagonist (key journey): **Rahim, Operator** — sees a TDS breach, acknowledges, assigns a Technician, follows the incident to RESOLVED, and audits the outcome.
- Form factor: responsive web-first, reference width `{layout.breakpoint_reference}` 1280px, usable down to `{min_width}` 360px phones.
- Theming: `{theming.modes}` light + dark, `{theming.default}` system preference, `{theming.manual_toggle}` false.
- Locale: `{i18n.active}` English only in v1; `{i18n.scaffolded}` Bengali keys registered now.
- Density: `{density.mode}` comfortable (`{density.card_padding}` card padding, `{density.row_padding}` row padding).
- Stack: `{stack}` list.
- Stack notes (architecture §2): Socket.IO delivers `alert.created`, `alert.acknowledged`, `incident.state_changed`, `reading.updated`; TanStack Query is the cache layer and is invalidated on socket events.
- Visual layer is critical-first: Critical is saturated red and pulsing, Warning is saturated amber and glowing, Healthy is calm green. Reference width `{reference_width}` 1280px and minimum width `{min_width}` 360px are unchanged.

## Information Architecture

- Navigation shell: left sidebar `{layout.sidebar_width}` 240px on `{layout.sidebar_collapse_below}` ≥ 1024px; collapses to hamburger below. The sidebar surface uses `{color.neutral.sidebar}` with `{color.neutral.sidebar_text}` and `{color.neutral.sidebar_text_active}` (memlog 2026-08-20); the IA itself is unchanged.
- Role-aware nav items are entirely hidden when the user lacks permission (disabled-with-tooltip is a v2 polish — memlog 2026-08-20).
- Global chrome (top of every authenticated page): `SeverityBanner` slot → `TopBar` → sidebar + canvas.

| Group   | Items                                                | Roles            |
| ------- | ---------------------------------------------------- | ---------------- |
| Monitor | Dashboard, Sensors, Incidents, Alerts                | any-auth         |
| Operate | Reports, Audit                                       | operator+, admin |
| Admin   | Simulator, Notifications, Thresholds, Users, Schools | admin            |

- Route inventory (14 routes, see frontmatter): all entries have at least one Component Pattern entry below; 8 routes are marked `spine_only` in the inventory and are covered by prose-only flows.
- Dashboard ordering (PRD F-7): KPI band → full-width map → live readings table → recent incidents feed. Permanent `LegendStrip` underneath KPIs.
- Incident Kanban columns are a **severity-mixed triage view**, not a state-by-state view (memlog 2026-08-20). Columns: **Open · Critical**, **Open · Warning**, **Acknowledged**, **Resolved**. The 7-state incident machine in architecture §5.1 (OPEN / ACKNOWLEDGED / INSPECTING / SAFE / UNSAFE / MONITORING / RESOLVED) remains authoritative for transitions and audit; the Kanban columns are a derived projection that prioritises "what needs my attention" over "what stage is each incident in." Specifically: incidents in `OPEN` state appear in `Open · Critical` or `Open · Warning` by severity; incidents in `ACKNOWLEDGED` / `INSPECTING` appear in `Acknowledged`; incidents in `SAFE` / `UNSAFE` / `MONITORING` / `RESOLVED` appear in `Resolved`. Technician view is filtered to assigned incidents.
- Search: top-bar `search` field is placeholder-only in v1 (cross-surface search deferred to v2).

## Voice and Tone

- Register: `{voice.register}` — short sentences, factual, no exclamation marks, no marketing copy.
- Examples in spec (memlog): "TDS is 312 ppm. Threshold is 300 ppm." / "Acknowledged at 10:42 by Rahim."
- Severity narration always names the value, threshold, and unit: "pH 5.8. Threshold range 6.5–8.5."
- Time is rendered absolute for record events ("10:42 by Rahim"), relative for live ("3 min ago") with both visible on hover/expand.
- Empty-state copy offers a next action, never a slogan.
- Forbidden: `{voice.forbidden}`.

## Component Patterns

> Each pattern binds a component to its behavioural contract. Visual spec lives in DESIGN.md → Components. Token references are inline as `{path.to.token}`.

### `TopBar`

- Sticky; contains brand, global `search` (placeholder-only v1), `NotificationBell`, role pill, user avatar menu.
- Receives `SeverityBanner` slot above itself when active.
- Citation: PRD F-7 (executive dashboard header), PRD F-5 (auth-aware role pill), architecture §11.2.

### `Sidebar`

- 240px (`{layout.sidebar_width}`) on ≥ 1024px, hamburger drawer below.
- Dark surface: `{color.neutral.sidebar}` background with `{color.neutral.sidebar_text}` for inactive items and `{color.neutral.sidebar_text_active}` for the active item, hover, and group labels.
- Active nav item gets a lighter tint and a brand-tinted icon (the icon switches to `{color.primary}`).
- Items hidden when role lacks permission (memlog). `aria-current="page"` for the active route.
- Order fixed per Information Architecture table.
- Citation: PRD F-4 (role-aware UI affordances), PRD F-7, architecture §11.2.

### `KPIStat`

- Renders one number with semantic severity. Stripe + number colour follow `{color.severity.*}`; the leading icon background uses `{color.severity.*.fill}` and is backed by `{color.severity.*.glow}` for halo depth.
- Numeral uses `{kpi.numeral_size}` 40; critical KPI uses `{kpi.numeral_size_critical}` 44.
- Critical KPI: `{banner.critical.border_width}`-style 4px left border, 3px glow ring, 8px outer shadow, plus a continuous `{motion.critical_pulse_ms}` 1500ms pulse as the persistent severity signal.
- Warning KPI: 2px left border, 2px glow, no continuous pulse.
- Healthy KPI: 3px left border, calm — no glow, no pulse.
- Sub-line shows delta vs previous period when available.
- Click drills into the underlying route (Healthy → /sensors, Warning → /alerts, Critical → /incidents).
- Live update: `{motion.live_pulse_ms}` 1200ms outline glow on the affected KPI only (distinct from the critical 1500ms continuous pulse — see State Patterns → Live update).
- Under `prefers-reduced-motion: reduce`: continuous critical pulse is disabled; the 1200ms per-update glow collapses to a single instant frame (State Patterns → Prefer reduced motion).
- Card radius `{radius.card}` 10.
- Citation: PRD F-7 (executive dashboard KPIs), NFR-8 (60-second comprehension SLA).

### `StatusPill`

- Renders severity label and icon together (never colour alone — DESIGN.md accessibility).
- Available tones: `{color.severity.healthy.fill}`, `{color.severity.warning.fill}`, `{color.severity.critical.fill}`, plus neutral for non-status badges (e.g. state machine column on Kanban).
- Severity icons render inside a circular `{color.severity.*.fill}`-tinted chip on a `{color.severity.*.bg}` background; this is the same colour vocabulary used by `KPIStat`, `MapMarker`, `SeverityBanner`, and `SeverityShowcase` so users learn one set of associations.
- Citation: PRD F-7 (live readings status), PRD F-10 (Kanban card severity), BRD §8.4 (alert lifecycle).

### `LiveReadingRow`

- Monospace value column with unit. Severity dot + text label column. Age column with relative time, full timestamp on hover.
- Severity dot uses `{color.severity.*.fill}`; the same fill backs the row's left border.
- Action menu appears on row focus or hover.
- Critical row: 4px left border + 1px critical glow + 16px critical shadow + continuous `{motion.critical_pulse_ms}` 1500ms pulse as the persistent severity signal.
- Warning row: 2px left border + 1px warning glow, no continuous pulse.
- Healthy row: 3px left border, calm — no glow, no pulse.
- Live update: `{motion.live_pulse_ms}` 1200ms outline glow on the affected row only (distinct from the critical 1500ms continuous pulse — see State Patterns → Live update).
- Under `prefers-reduced-motion: reduce`: continuous critical pulse is disabled; the 1200ms per-update glow collapses to a single instant frame (State Patterns → Prefer reduced motion).
- Citation: PRD F-7 (live readings table), PRD F-9 (alert list), architecture §3.5 (`reading:new` event).

### `MapMarker`

- Leaflet marker; click opens a popup with device label, latest reading, and a link to `/sensors/:id`.
- Marker dot uses `{color.severity.*.fill}`; legend is the same as `LegendStrip`.
- Critical and warning pins carry a continuous `{motion.pin_pulse_ms}` 2000ms halo pulse backed by `{color.severity.*.glow}`. Healthy pins are calm — no halo, no pulse.
- Popup tail arrow is coloured by the active severity (critical border + glow on the popup frame) so the pop-up carries the same vocabulary as the pin.
- Under `prefers-reduced-motion: reduce`: pin halo pulse is disabled; the pin colour and shape are preserved (State Patterns → Prefer reduced motion).
- Citation: PRD F-7 (water quality map), PRD F-8 (sensor detail navigation).

### `SeverityBanner` (Critical)

- Persistent red strip: 4px top border + 4px bottom border (`{banner.critical.border_width}`) in `{color.severity.critical.fill}`, 24px outer glow in `{color.severity.critical.glow}`.
- Sticky to the top of the page, immediately below the `TopBar`. Fade-in animation on mount.
- The leading bolt uses `{color.severity.critical.fill}` on a white tile.
- Shows icon, "UNSAFE submitted for {device} by {actor}", and an Acknowledge CTA.
- Dismisses on acknowledge action OR after `{banner.critical.dismiss}` 24h.
- Admin sessions only (BRD §8.7).
- Under `prefers-reduced-motion: reduce`: banner fade-in is disabled; the strip renders instantly with colour and text preserved (State Patterns → Prefer reduced motion).

### `LiveChart`

- Recharts combined chart per sensor; toggle chips for metric series.
- Reference lines drawn in `{color.severity.warning.text}` and `{color.severity.critical.text}`.
- Window presets: 1h / 6h / 24h / 7d.

### `KanbanColumn` / `KanbanCard`

- Four severity-mixed columns per Incident Kanban: `Open · Critical`, `Open · Warning`, `Acknowledged`, `Resolved`. The 7-state incident machine (architecture §5.1) governs transitions; these columns are a derived triage view (Foundation / IA note above).
- Cards show id, severity, age, assignee. Card severity drives the left-stripe and the column placement; the underlying state is surfaced through the card body (e.g. an `INSPECTING` card in the `Acknowledged` column shows its state via the timeline or the action buttons it exposes).
- Drag is disabled (v1): cards are status pills + a row link. State changes go through explicit buttons on the card (Acknowledge, Assign, Submit result, Resolve).
- Technician view filters cards to assigned.
- Citation: PRD F-10 (Kanban), architecture §5.1 (state machine).

### `TimelineEvent`

- Used on incident detail. Dot coloured by event severity; actor + timestamp + note.
- Severity-changing events are bold; non-state events are regular weight.

### `FormField`

- Label above input, helper text below, error inline in `{color.severity.critical.text}`.
- Required indicator is text ("(required)") — no asterisks-only patterns.
- Citation: PRD F-5 (login), PRD F-12 (school onboarding), PRD F-13 (threshold editor); admin simulator, notifications, users, thresholds all use `FormField`.

### `DataTable`

- Sticky header, 12px row padding (`{density.row_padding}`).
- Severity dot inline; sort defaults to most-recent for time-series tables.
- Citation: PRD F-9 (alert list), PRD F-11 (audit log), BRD §8.8 (CSV export source).

### `NotificationBell`

- Dropdown list of recent notifications, severity dot + timestamp.
- Unread count badge in `{color.primary}`. The badge colour for high-criticality counts is open (see Open Questions).

### `LegendStrip`

- Permanent dashboard strip showing Healthy / Warning / Critical pills; identical to map marker legend.

### `SeverityShowcase`

- Permanent dashboard strip below the live readings table on `/dashboard`. Three side-by-side cards — Healthy, Warning, Critical — each showing its colour, icon, label, and a one-line description of the expected response.
- Cards mirror the saturated severity vocabulary used by `KPIStat`, `StatusPill`, `MapMarker`, `LiveReadingRow`, and `SeverityBanner`: the same `{color.severity.*.fill}`, `{color.severity.*.bg}`, and `{color.severity.*.glow}` tokens, the same severity-icon mapping, and the same critical 4px border / 3px glow treatment on the Critical card.
- This is the at-a-glance severity vocabulary users learn when the icons and colour associations are still new; the strip is the running reference.
- Citation: PRD F-7 (live readings table), NFR-8 (60-second comprehension SLA).

### `WalkthroughOverlay`

- First-login coach-marks; auto-dismisses after one cycle. Skippable. Skipped state persisted in user prefs.

### `ScenarioTile`

- Admin simulator only (`/admin/simulator`). One tile per scenario (Healthy / Warning / Critical / Offline).
- Clicking a tile pre-fills the simulator form; the Run button is filled with the matching severity colour from `{color.severity.*.fill}`.
- Disabled state: if the simulator secret is missing, the tile is replaced by a single page-level "Simulator disabled. Set SIMULATOR_SECRET." message.
- Citation: PRD F-6 (admin simulator), architecture §6 (simulator contract).

## State Patterns

> Walked against every IA surface and against the demo flow described in BRD §13.

### Loading

- Skeleton blocks match the final layout dimensions (no spinners in content area).
- TanStack Query `isLoading` renders the skeleton; socket connect status is independent.

### Empty

- Each surface has a single sentence explaining what would be here and a primary CTA:
  - Dashboard with no incidents: "No incidents in the last 24h. View live readings."
  - Sensors list (spine-only): "No sensors registered. Add a sensor."
  - Alerts list (spine-only): "No alerts. Tune thresholds."
  - Reports (spine-only): "No reports generated. Create a weekly report."
  - Audit (spine-only): "No audit entries in this window. Expand the date range."
  - Kanban with no cards: "No open incidents. View resolved history."

### Cold-load (first render before any data)

- Render shell + skeleton. Banner slot is dormant.

### Live update

- Affected card / KPI / row receives a 1200ms outline glow (`{motion.live_pulse_ms}`). No toast.
- If multiple readings update at once, each pulses in turn (sequential, ≤ 200ms stagger) to avoid flicker.
- Critical elements (KPI, reading row, banner) additionally carry a continuous `{motion.critical_pulse_ms}` 1500ms pulse as a persistent severity signal. The two pulses are distinct: the 1200ms glow is a transient per-update affordance; the 1500ms pulse is the steady-state severity heartbeat. Map-marker halos use `{motion.pin_pulse_ms}` 2000ms.

### Offline

- Memlog: read-only last-known state. Top-of-page banner: "Reconnecting…".
- Any element whose handler would call the API is disabled with a tooltip: "Unavailable while offline. Showing last-known data."
- Socket reconnect attempts every 5s with exponential backoff up to 30s.

### Prefer reduced motion

- Under `prefers-reduced-motion: reduce` (Accessibility Floor): continuous pulses are disabled. This is the steady-state severity pulse on critical `KPIStat`, the row pulse on critical `LiveReadingRow`, the `MapMarker` halo pulse for critical and warning pins, and the `SeverityBanner` fade-in.
- Colour, icon, border, and text are preserved — the severity signal is carried by the saturated surface, the larger numeral, and the layout cues, not the motion.
- The per-update `{motion.live_pulse_ms}` 1200ms outline glow is not a continuous pulse; it is a transient affordance that fires on socket update. It collapses to a single instant frame under reduced motion but is not removed, so users still see which element changed.
- See also: `KPIStat`, `LiveReadingRow`, `MapMarker`, `SeverityBanner` Component Patterns.

### Breach (UNSAFE submitted)

- Operator / Admin: `SeverityBanner` Critical slot activates for Admin; non-Admin sees the same banner if their role permits (BRD §8.7 — Admin-only confirmed in memlog).
- Affected sensor row + KPI pulse. Incident auto-opens on `/incidents/:id` if the user is on the dashboard.

### RBAC denied

- Hidden nav items (memlog). Direct URL hit: full-page empty state with a 403-style message: "You don't have access to this page. Contact an Admin." and a link back to `/dashboard`.
- Server-side enforcement is authoritative (BRD §8.5).

### Incident state changes (architecture §5.1)

- State machine is authoritative: `OPEN → ACKNOWLEDGED → INSPECTING → {SAFE | UNSAFE | MONITORING} → RESOLVED`. `RESOLVED` can be reopened to `OPEN` by an Admin comment of `severity=critical`.
- Kanban column projection (derived, not authoritative): `OPEN` cards project to `Open · Critical` or `Open · Warning`; `ACKNOWLEDGED` / `INSPECTING` project to `Acknowledged`; `SAFE` / `UNSAFE` / `MONITORING` / `RESOLVED` project to `Resolved`.
- Each transition records a `TimelineEvent` and emits a socket event consumed by `LiveReadingRow` and Kanban cards.

### Login-only state (no real auth yet)

- Spine-only surface for the demo. Renders the login shell with a "Sign in (demo)" button that issues a dev-only session for one of the four seeded users (Admin, Operator, Technician, Viewer).

### 401 refresh (PRD F-5)

- API responds with `401` → `TanStack Query` interceptor attempts a single refresh on the refresh-token cookie (PRD F-5).
- Refresh succeeds: original request retries once; the user sees no interruption.
- Refresh fails: user is redirected to `/login`. The current URL is stored as a `next` query parameter so post-login lands them back where they were.
- Socket `401 token_expired` (architecture §3.4): affected tab reconnects with a freshly minted token. The dashboard remains visible throughout.
- Component owner: top-level auth wrapper above `TanStack Query`; documented under PRD F-5 (Authentication).

### Error

- Inline form errors for `FormField`. Network errors show a toast with retry. 5xx surfaces show a recoverable error state with "Retry" and "Reload".

## Interaction Primitives

| Primitive                               | Behaviour                                             |
| --------------------------------------- | ----------------------------------------------------- |
| Click on `KPIStat`                      | Route to underlying filtered view                     |
| Click on `LiveReadingRow`               | Open `/sensors/:id`                                   |
| Click on `MapMarker`                    | Popup with device + latest reading + link             |
| Click `Acknowledge` on `SeverityBanner` | POST `/api/alerts/:id/ack`; banner dismisses (memlog) |
| Click `Acknowledge` on incident card    | State OPEN → ACKNOWLEDGED; `TimelineEvent` added      |
| Click `Assign`                          | Opens `FormField` modal with role-filtered user list  |
| Drag (Kanban)                           | Disabled in v1                                        |
| Tab order                               | Sidebar → topbar → main → footer; modals trap focus   |
| Esc                                     | Close modal / drawer / dropdown                       |
| Cmd/Ctrl-K                              | Reserved v2 (focuses `search` placeholder in v1)      |

- All buttons and links have visible focus rings (DESIGN.md `{accessibility.standard}`).
- Keyboard reachable: every action in the demo flow is reachable without a mouse.

## Accessibility Floor

- Standard: `{accessibility.standard}` — WCAG 2.1 AA.
- Contrast: `{accessibility.contrast_min}` 4.5:1 for body text; severity `text` against `bg` ≥ 4.5:1.
- Severity conveyance: `{accessibility.severity_channel_redundancy}` (colour + text + icon).
- Keyboard: full reach, visible focus rings (`color.primary`, 2px, 2px offset), logical tab order, Esc closes overlays.
- Semantic HTML: `<main>`, `<nav>`, `<aside>`, `<table>` for tabular data, headings in order.
- ARIA: `aria-current="page"` on nav, `aria-live="polite"` on the live readings region, `role="status"` on KPI updates, `aria-label` on icon-only buttons.
- Reduced motion: continuous pulses (critical KPI, critical reading row, map-pin halo, banner fade-in) are disabled under `prefers-reduced-motion: reduce`; transitions collapse to instant. See State Patterns → Prefer reduced motion for the full rule and which transient affordances are preserved.
- No screen-reader certification target for v1.

## Key Flows

> **About flow body text.** The numbered steps in each flow are _author commentary_, not in-product copy. In-product strings are explicitly quoted with quotation marks. Voice discipline applies to in-product strings only.
>
> **Citation shape.** Inline references use F-N for PRD features, BRD § for business requirements, and architecture § for technical decisions. The `sources:` array in frontmatter is the authoritative document list; inline citations are working pointers into those documents.
>
> Numbered steps, named protagonist, climax beat, failure path. Each flow ties to PRD / BRD / architecture by section number.

### F1 — Executive glance → drilldown (PRD F-7)

- Protagonist: Rahim, Operator.
- Steps: 1) Land on `/dashboard` → 2) KPI band shows Healthy/Warning/Critical counts and pulses on update → 3) Map shows severity-coloured markers → 4) Click warning KPI → 5) Drill to `/alerts` filtered to Warning → 6) Click alert → 7) Land on `/incidents/:id`.
- Climax: one click from dashboard to a specific incident detail.
- Failure: socket offline → dashboard renders last-known data with "Reconnecting…" banner (State Patterns → Offline).

### F2 — TDS breach to acknowledge (PRD F-2, F-3; BRD §13 steps 2–5)

- Protagonist: Rahim.
- Steps: 1) TDS breach submitted by device → 2) Rules engine fires `alert.created` → 3) Dashboard pulses warning KPI + critical banner does NOT appear (Warning, not UNSAFE) → 4) Rahim clicks Acknowledge on the live reading row → 5) State OPEN → ACKNOWLEDGED; `TimelineEvent` recorded → 6) Toast-free confirmation; row stops pulsing.
- Climax: row steady-state under Rahim's name.
- Failure: API error → toast with retry; row stays OPEN.

### F3 — UNSAFE banner lifecycle (PRD F-3; architecture §3.5)

- Protagonist: Admin (only).
- Steps: 1) Device submits UNSAFE → 2) Admin session shows persistent red `SeverityBanner` across routes → 3) Banner names device and actor → 4) Admin clicks Acknowledge → 5) Banner dismisses → 6) Incident auto-opens; Admin reviews.
- Climax: banner clears after acknowledge (memlog climax beat).
- Failure: Admin never acknowledges → banner auto-dismisses after `{banner.critical.dismiss}` 24h and re-fires on next UNSAFE submission.

### F4 — Operator assigns a Technician (PRD F-3; architecture §5.1)

- Steps: 1) On `/incidents/:id` → 2) Click Assign → 3) Modal lists Technicians (RBAC-filtered) → 4) Select Technician, add note, submit → 5) State `ACKNOWLEDGED` → `INSPECTING` → 6) Technician receives `NotificationBell` event → 7) Kanban card moves from `Acknowledged` column to its `Acknowledged` slot with the assignee chip now visible (the card's underlying state is `INSPECTING`; the column projection is unchanged).
- Climax: Kanban card shows the assignee chip and the action set switches to Technician actions.
- Failure: no Technicians available → modal shows empty state with "Add a Technician" link to `/admin/users`.

### F5 — Technician resolution (PRD F-3; BRD §7.3)

- Protagonist: Karim, Technician.
- Steps: 1) `/incidents` filtered to assigned → 2) Open incident → 3) Add timeline entry with photo attachment → 4) Submit result (`SAFE` / `UNSAFE` / `MONITORING` — Operator decides on review) → 5) Operator reviews on `/incidents/:id` → 6) Resolve → 7) Banner clears (F3 tie-in). Kanban card moves to `Resolved` column.
- Climax: incident lands in `RESOLVED` state and the Kanban `Resolved` column with a full timeline.
- Failure: attachment upload fails → inline error; transition not blocked (timeline note can stand alone).

### F6 — Admin simulator drives a demo (PRD F-6)

- Protagonist: Sanjit, Admin.
- Steps: 1) Open `/admin/simulator` → 2) Pick device, pick profile (Healthy / Warning / Critical / UNSAFE) → 3) Submit → 4) Telemetry broadcast over MQTT → 5) Dashboard / banner / Kanban react in real time.
- Climax: demo audience sees the same screens they would in production.
- Failure: simulator secret missing → page shows "Simulator disabled. Set SIMULATOR_SECRET.".

### F7 — First-login walkthrough (comprehension beat, memlog)

- Protagonist: any first-time user.
- Steps: 1) On first authenticated load, `WalkthroughOverlay` shows three coach-marks (KPI band → LegendStrip → Critical banner demo) → 2) Auto-cycles once → 3) User can dismiss any time → 4) Pref persisted in user prefs.
- Climax: legend strip understood; severity colours learned.
- Failure: `prefers-reduced-motion` set → walkthrough still shown, transitions are instant.

### F8 — Audit trail (PRD F-11; BRD §7.5)

- Protagonist: Operator / Admin.
- Steps: 1) Navigate to `/audit` (spine-only) → 2) Filter by actor / entity / date → 3) Export CSV → 4) Each row links to the originating incident or alert.
- Climax: a regulator can replay an incident end-to-end.
- Failure: no entries → empty state with widened date filter CTA.

### F9 — Login → role reveal (PRD F-5)

- Steps: 1) `/login` → 2) Submit credentials → 3) Role-aware `Sidebar` renders with hidden items removed → 4) Redirected to `/dashboard` → 5) First-login walkthrough fires if first sign-in.
- Climax: hidden items confirm RBAC visually.
- Failure: wrong role URL hit → RBAC denied state.

## Open Questions

- Login-only state behaviour after a real auth backend lands — demote from spine-only?
- Notification bell badge: primary-only or critical-tinted at threshold? (Carried from DESIGN.md.)
- KPI click target per role — Viewer should not see Reports drilldowns.
- Drag-to-reorder Kanban — confirm v2 deferral in PRD §4.4.
- ~~KPI accent stripe~~ — Resolved on the 2026-08-20 visual refresh: stripes are now 4px critical / 2px warning / 3px healthy, see `KPIStat` and DESIGN.md `kpi.accent_width.*`.
- ~~Dark-mode severity hex lift~~ — Resolved on the 2026-08-20 visual refresh: severity surfaces are now `{color.severity.*.fill}` (saturated) with `{color.severity.*.glow}` (α0.2) for depth, which serve both light and dark via tone inversion rather than separate hex lifts.
- Search field placeholder-only — confirm cross-surface search deferred to v2 (PRD §4.4).
- Bell badge colour — open (Design + Experience).
- No screen-reader certification target — confirm with stakeholders before v1 ships.
- Manual theme toggle — confirm deferral (DESIGN.md open question).
