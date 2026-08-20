---
status: final
created: 2026-08-20
updated: 2026-08-20
owner: Sanjit
project: Surakkha
purpose: Visual identity for the Surakkha water-safety monitoring platform
form_factor: responsive-web
reference_width: 1280px
min_width: 360px
ui_system: shadcn/ui + Tailwind CSS
stack:
  - Vite
  - React 18
  - TypeScript
  - TanStack Query
  - Socket.IO client
  - Tailwind CSS
  - shadcn/ui
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
  - login-only (post-auth empty) state
tokens:
  color:
    severity:
      healthy:
        value: "#1F9D55"
        text: "#0F6B3A"
        fill: "#16A34A"
        bg: "#E8F6EE"
        glow: "#1F9D5533"
      warning:
        value: "#D97706"
        text: "#92400E"
        fill: "#F59E0B"
        bg: "#FFF3DA"
        glow: "#F59E0B33"
      critical:
        value: "#DC2626"
        text: "#7F1D1D"
        fill: "#EF4444"
        bg: "#FEE2E2"
        glow: "#EF444433"
      offline:
        value: "#64748B"
        text: "#475569"
        bg: "#F1F5F9"
    neutral:
      surface: "#FFFFFF"
      page: "#F5F7F9"
      sidebar: "#0F172A"
      sidebar_text: "#CBD5E1"
      sidebar_text_active: "#FFFFFF"
      border: "#E2E8F0"
      body: "#0F172A"
      secondary: "#475569"
    primary: "#1E5BB8"
    primary_hover: "#1E40AF"
    primary_gradient: "linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)"
  type:
    primary: "Inter (variable)"
    fallback: "system-ui"
    bn_fallback_registered: "Noto Sans Bengali"
    size_base: 14
    line_height_base: 22
  spacing: [4, 8, 12, 16, 24, 32, 48, 64]
  radius:
    card: 10
    input: 8
    pill: 999
  density:
    mode: comfortable
    card_padding: 20
    row_padding: 12
  layout:
    sidebar_width: 240
    sidebar_collapse_below: 1024
    breakpoint_reference: 1280
  motion:
    live_pulse_ms: 1200
    target: "affected card outline glow"
    critical_pulse_ms: 1500
    target_critical: "KPI / LiveReadingRow / MetricCard critical glow"
    pin_pulse_ms: 2000
    target_pin: "map marker halo and critical banner bolt"
    banner_fade_in_ms: 200
  elevation:
    card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)"
    topbar: "0 1px 2px rgba(15, 23, 42, 0.04)"
    banner_critical: "0 0 24px {color.severity.critical.glow}"
  banner:
    critical:
      scope: Admin sessions
      trigger: "UNSAFE result submitted"
      position: "top of page, persistent across routes, sticky under topbar"
      dismiss: "on acknowledge or after 24h"
      border_width: 4
      border_position: "top and bottom"
  kpi:
    numeral_size: 40
    numeral_size_critical: 44
    stripe:
      healthy_width: 3
      warning_width: 2
      critical_width: 4
    glow:
      critical_inner_px: 3
      critical_outer_px: 8
      warning_px: 2
  accessibility:
    standard: "WCAG 2.1 AA"
    contrast_min: 4.5
    severity_channel_redundancy: "color + text + icon"
    reduced_motion: "honoured — critical pulse, map pin pulse, banner fade-in disabled; colour and icon preserved"
  voice:
    register: "calm, factual, brief"
    forbidden: ["exclamation marks", "marketing copy"]
---

# Surakkha — DESIGN.md

> **Spines win on conflict with any mock, wireframe, or import. This file owns *how the product looks*. Behavioural decisions live in EXPERIENCE.md.**

## Brand & Style

- Visual direction: **operational serious** with a **critical-first hierarchy**. Critical saturates and pulses; warning glows; healthy is calm. The product still reads as an instrument panel, not a consumer app.
- Tone on screen: instrument panel with visible urgency. Severity is the only saturated palette and it earns its energy.
- Logo lockup: wordmark "Surakkha" in Inter 16px / 600 next to a 32×32 rounded-8 square filled with `color.primary_gradient` containing a white "S" mark (see `.working/key-dashboard.html`).
- Aesthetic anchors: dark sidebar, white canvas, single primary accent, layered card shadow, severity drives motion.
- Iconography: 16px line icons in `color.neutral.secondary`; severity icons (24px) use the matching `severity.{healthy|warning|critical}.fill` and always pair with a text label.
- Login: split-screen — left hero panel uses `color.primary_gradient` with a calm water-ripple illustration; right is a white form surface with a role selector.

## Colors

- Severity is the only saturated palette. Everything else is neutral or primary.
- `value` is used for borders, KPI stripes, banner top/bottom rules, and map marker fill.
- `fill` is the vivid hue for filled markers, KPI icon backgrounds, banner bolt, and the "Unsafe" pill foreground.
- `text` is the readable label colour against the matching `bg` (≥ 4.5:1).
- `bg` is the soft surface for pills, KPI fills, banner backgrounds, and Kanban card strips.
- `glow` is the rgba-with-alpha-0.2 colour used in box-shadow glows (KPI, LiveReadingRow, banner, map pin halo, fresh-card pulse).
- Contrast targets: body text 4.5:1 against its surface; severity `text` against `bg` ≥ 4.5:1.

| Token | Value | Use |
|---|---|---|
| `color.severity.healthy.value` | `#1F9D55` | Healthy borders, KPI stripe |
| `color.severity.healthy.text` | `#0F6B3A` | Healthy text on `bg` |
| `color.severity.healthy.fill` | `#16A34A` | Vivid — map marker, KPI icon, sparkline stroke |
| `color.severity.healthy.bg` | `#E8F6EE` | Pills, KPI stripe, banner soft fill |
| `color.severity.healthy.glow` | `#1F9D5533` | Reserved; healthy is calm — no glow by default |
| `color.severity.warning.value` | `#D97706` | Warning borders, map marker, sparkline threshold |
| `color.severity.warning.text` | `#92400E` | Warning text on `bg` |
| `color.severity.warning.fill` | `#F59E0B` | Vivid — filled warning marker, KPI icon |
| `color.severity.warning.bg` | `#FFF3DA` | Warning pills, KPI stripe, soft fill |
| `color.severity.warning.glow` | `#F59E0B33` | Warning KPI / LiveReadingRow box-shadow glow |
| `color.severity.critical.value` | `#DC2626` | Critical borders, banner accent, KPI stripe, sparkline threshold |
| `color.severity.critical.text` | `#7F1D1D` | Critical text on `bg`, banner body copy |
| `color.severity.critical.fill` | `#EF4444` | Vivid — filled critical marker, banner bolt, KPI icon |
| `color.severity.critical.bg` | `#FEE2E2` | Critical banner background, soft fill |
| `color.severity.critical.glow` | `#EF444433` | Critical KPI / row / banner / fresh-card glow |
| `color.severity.offline.value` | `#64748B` | Offline state dots, KPI icon |
| `color.severity.offline.bg` | `#F1F5F9` | Offline pill background |
| `color.neutral.surface` | `#FFFFFF` | Cards, topbar, login form, modals |
| `color.neutral.page` | `#F5F7F9` | App page background, search field, input fields |
| `color.neutral.sidebar` | `#0F172A` | Left navigation background |
| `color.neutral.sidebar_text` | `#CBD5E1` | Nav item text, nav group labels |
| `color.neutral.sidebar_text_active` | `#FFFFFF` | Active nav item text + hover text |
| `color.neutral.border` | `#E2E8F0` | All 1px borders, dividers, table rules |
| `color.neutral.body` | `#0F172A` | Body text, headings |
| `color.neutral.secondary` | `#475569` | Captions, helper text, breadcrumb sub-labels |
| `color.primary` | `#1E5BB8` | Links, primary CTA, focus ring, active nav icon |
| `color.primary_hover` | `#1E40AF` | Primary CTA hover |
| `color.primary_gradient` | `linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)` | Login hero panel, brand mark, active nav indicator |

- Dark mode (system-default, no manual toggle in v1) inverts neutrals and preserves severity hue. The severity `bg` is replaced with a tone-inverted dark surface (e.g. `#1F1010` for critical, `#1A1306` for warning, `#0E1A12` for healthy); the severity `text` is lifted to a near-white at ≥ 4.5:1 against the dark `bg`; the severity `value` and `fill` are kept or marginally brightened to maintain glow parity. The dark sidebar stays dark in both themes.

## Typography

| Token | Value |
|---|---|
| `type.primary` | Inter (variable) |
| `type.fallback` | system-ui, -apple-system, Segoe UI, Roboto, sans-serif |
| `type.bn_fallback_registered` | Noto Sans Bengali (registered now for v2 drop-in) |
| `type.size_base` | 14px |
| `type.line_height_base` | 22px |

- Scale (semantic, used via Tailwind classes): `text-xs` 12/18, `text-sm` 13/20, `text-base` 14/22, `text-md` 15/24, `text-lg` 18/28, `text-xl` 20/28, `text-2xl` 24/32, `text-3xl` 28/32, `text-4xl` 36/40.
- Weights: 400 body, 500 nav active, 600 headings + KPI labels + banner CTA, 700 KPI numerals + page titles.
- Numerals: tabular where comparable (KPI numbers, table cells); proportional elsewhere.
- Mock: `.working/key-dashboard.html` lines 17, 28, 36 (font-family and numeral classes).

## Layout & Spacing

- Grid: 240px left sidebar + fluid canvas on ≥ 1024px; below 1024px the sidebar collapses behind a hamburger in the topbar.
- Canvas horizontal padding: 24px (≥ 1024px), 16px (768–1023px), 12px (< 768px).
- Vertical rhythm: page head 16px top, section gap 24px, card-internal padding `density.card_padding` 20px, row padding `density.row_padding` 12px.
- Spacing scale (`spacing`): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- Dashboard order (PRD F-7): KPI band → map → live readings table → recent incidents feed → severity legend.
- Incident detail order: header (id, severity pill, state) → KPI strip → summary → timeline + comments → readings around incident.
- Login: split 1fr 1fr at ≥ 1024px; below 1024px the hero panel is hidden and the form takes the full width with 32px padding.
- Mock: `.working/key-dashboard.html` lines 32–33 (shell, sidebar grid).

## Elevation & Depth

- `elevation.card` is a layered shadow applied to every card: `0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)`. KPI cards, Kanban cards, scenario tiles, and metric cards all carry it.
- `elevation.topbar` is the smaller `0 1px 2px rgba(15, 23, 42, 0.04)` for the sticky topbar.
- `elevation.banner_critical` is `0 0 24px {color.severity.critical.glow}` for the sticky red banner.
- Live update cue (not elevation): `motion.live_pulse_ms` 1200ms outline glow on the affected card or KPI; no elevation change.
- Critical pulse (separate, distinct cue): `motion.critical_pulse_ms` 1500ms — applied to KPI `k-critical`, `LiveReadingRow.r-critical`, `MetricCard.crit`. Combines an inner critical glow (3px) and an outer critical glow (8px) with the layered card shadow.
- Map marker halo pulse: `motion.pin_pulse_ms` 2000ms — applied to the critical map pin and (when `animated`) the warning pin.
- Banner fade-in: `motion.banner_fade_in_ms` 200ms — `translateY(-100%)` → `translateY(0)`.

## Shapes

| Element | Radius |
|---|---|
| Card | `radius.card` 10px |
| Input, button, brand mark, KPI icon (large) | `radius.input` 8px |
| Pill (status, role, theme) | `radius.pill` 999px |
| KPI stripe on cards / KPIs | critical 4px, warning 2px, healthy 3px — square left bar |
| Severity stripe on Kanban / incident cards | critical 4px, warning 2px, healthy 3px |
| Banner | square edges; top + bottom 4px solid `color.severity.critical.value` |

## Components

> Behavioural spec lives in EXPERIENCE.md → Component Patterns. This section is visual only.

| Component | Visual |
|---|---|
| `TopBar` | 56px tall, sticky, `color.neutral.surface` background, search left, role pill + user right; `elevation.topbar` shadow. |
| `Sidebar` | 240px, `color.neutral.sidebar` background, 20px top/bottom padding, 1px `color.neutral.border`-equivalent (`#1E293B`) under the brand block, nav groups separated by uppercase 11px labels, `aria-current="page"` row tinted `#1E293B` with active text in `color.neutral.sidebar_text_active` and the nav icon tinted to `#38BDF8`. |
| `KPIStat` | `color.neutral.surface` card, 1px `color.neutral.border`, `radius.card` 10px, 20px padding, `elevation.card` shadow, severity stripe on the left (4px critical / 2px warning / 3px healthy), label / 40px numeral (44px for critical) / sub. Critical card carries the layered shadow + inner + outer critical glow and the `motion.critical_pulse_ms` pulse. |
| `StatusPill` | 999px radius, severity `bg` + `value` text and border, leading severity icon (24px), label e.g. "Healthy / Warning / Critical / Unsafe". |
| `LiveReadingRow` | 1px `color.neutral.border`, 12px vertical padding, monospace metric, severity dot + label column, age column, actions on hover. Critical row has a 4px critical left border + 1px + 4px16px critical glow and pulses at `motion.critical_pulse_ms`. Warning has a 2px warning left border + 1px warning glow. Healthy has a 3px calm left border. |
| `MapMarker` | Leaflet `divIcon`, 14px circle, severity `fill` colour, 2px white border, severity icon (16px). Critical pin pulses with `motion.pin_pulse_ms` halo; warning pin pulses when `.animated`; healthy is calm. |
| `SeverityBanner` | Sticky under the topbar, `color.severity.critical.bg` strip, 4px top + 4px bottom `color.severity.critical.value` border, severity icon in a 36px circular `color.severity.critical.fill` badge that pulses, banner body copy in `color.severity.critical.text`, primary CTA `color.severity.critical.fill` with `elevation.banner_critical` glow; persists across routes; `motion.banner_fade_in_ms` slide-in. |
| `SeverityShowcase` | Permanent dashboard strip below live readings. Three side-by-side cards (`Healthy`, `Warning`, `Critical`) — `radius.card` 10, `elevation.card` shadow, severity left stripe (4px critical / 2px warning / 3px healthy), severity icon in tinted square, label uppercase, one-line description of the expected response. |
| `LiveChart` | Recharts combined chart, primary-blue series, threshold reference lines dashed in `color.severity.{warning|critical}.value`, breach window shaded `color.severity.critical.fill` at 5% opacity, last point has a pulsing critical halo. |
| `KanbanColumn` | 4 columns (Open · Critical, Open · Warning, Acknowledged, Resolved), severity-coloured header chip and count, vertical card stack 10px gap. |
| `KanbanCard` | 10px radius, severity left-stripe (4 critical / 2 warning / 3 healthy), id + severity + age + assignee. Critical "fresh" card uses the full-colour treatment (filled critical strip header, critical glow, 1.2° tilt, pulse) and carries a `New` badge. |
| `TimelineEvent` | Vertical thread, 2px connector line, severity-coloured 14px node dot, node glow scales with severity (critical = 4px glow), actor + timestamp + note. |
| `FormField` | Label above, 8px radius input, 40px height, helper text below in `color.neutral.secondary`, focus ring `color.primary` 2px offset. |
| `DataTable` | `color.neutral.surface` background, sticky header with uppercase 11px labels in `color.neutral.secondary`, 12px row padding, severity dots / pills inline, 12px monospace for ids and metric values. |
| `NotificationBell` | Topbar dropdown, count badge in `color.primary`, list items with severity dot + timestamp. |
| `LegendStrip` | Permanent dashboard strip: three `StatusPill`s with "Healthy / Warning / Critical" labels. |
| `WalkthroughOverlay` | First-login coach-mark; auto-dismisses after one cycle. |
| `ScenarioTile` | Admin simulator: `elevation.card`, 4px severity left stripe (4px critical with critical glow for `sc-crit`, 2px warning, 3px healthy, 2px offline), severity icon in tinted square, Run button filled with the matching severity colour. |

Mock cross-refs: `.working/key-dashboard.html`, `.working/key-incident-detail.html`, `.working/key-admin-simulator.html`, `.working/key-login.html`, `.working/key-sensor-detail.html`, `.working/key-incident-kanban.html`.

## Do's and Don'ts

Do
- Use severity tokens (`color.severity.*`) for status meaning only.
- Show severity through colour + text label + icon together.
- Apply `elevation.card` to every card and tile; reserve `elevation.banner_critical` for the sticky banner.
- Default to comfortable density (`density.card_padding` 20, `density.row_padding` 12).
- Honour system theme (light / dark).
- Pair every primary CTA with a visible focus ring (`color.primary`, 2px, 2px offset).
- Convey pulse for live updates with the 1.2s outline glow on the affected card; reserve the 1.5s critical pulse for KPI / LiveReadingRow / MetricCard `k-critical` / `r-critical` / `crit` states; reserve the 2s pin pulse for the critical map marker.
- Honour `prefers-reduced-motion: reduce` — disable critical pulse, map pin pulse, and banner fade-in; severity is still conveyed by colour + text + icon.

Don't
- Don't introduce new accent colours beyond `color.primary`.
- Don't use severity colour for decoration, badges for non-status info, or chrome.
- Don't add toasts for routine telemetry — only for explicit user-driven actions.
- Don't use marketing copy, exclamations, or emojis in production strings.
- Don't add a manual light/dark toggle in v1 (system default only).
- Don't convey severity by colour alone.
- Don't reuse `color.severity.*.glow` for non-status decoration — glow is a severity affordance.

## Coverage & Provenance

- Rendered mocks (6): dashboard, incident detail (with Critical banner), admin simulator, login, sensor detail, incident Kanban.
- Spine-only surfaces (8 — wireframed in prose, no mock): alerts list, audit log, admin/users, admin/thresholds, admin/notifications, reports, sensors list, login-only state.
- Resolved open questions (carried forward to EXPERIENCE.md → Open Questions where still relevant):
  - Dark-mode severity lift — resolved: severity `bg` inverts to a dark tone-mapped surface per severity (e.g. `#1F1010` critical, `#1A1306` warning, `#0E1A12` healthy); severity `text` lifts to a near-white at ≥ 4.5:1; severity `value` and `fill` are kept or marginally brightened; severity `glow` continues to work against the new dark `bg`. The same `value` / `fill` / `text` / `bg` / `glow` quintet serves both modes, so the token system itself serves dark mode without a parallel palette.
  - KPI accent stripe — resolved: critical = 4px left border + 3px inner + 8px outer critical glow + 1.5s pulse; warning = 2px left border + 2px warning glow; healthy = 3px left border, no glow, calm.
  - Bell badge colour: `color.primary` vs `severity.critical.value` for critical count — open.
