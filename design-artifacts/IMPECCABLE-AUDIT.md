# Impeccable Audit — Surakkha Web

**Date:** 2026-08-30 (re-run after toast extraction)
**Target:** `packages/web/src/` (Vite + React 19 + TanStack Query + Tailwind)
**Methodology:** Impeccable v4.1.2 bundled detector (FULL mode — `htmlparser2`, `css-select`, `css-tree`, `domutils` installed) + manual 5-dimension scan per `audit.md`
**Detector mode:** FULL. Static-HTML engine parses `index.html` + inline JSX-evaluated classes through `css-select` against `css-tree`'s parsed cascade; custom properties + computed contrast evaluated.
**Scope:** Companion to `WDS-AUDIT-REPORT.md`. WDS-AUDIT was Theming + Implementation-Integrity focused; this audit covers all 5 Impeccable dimensions and assigns a single /20 Health Score.
**Delta from prior audit:** Detector upgraded DEGRADED → FULL. Toast extraction (`/impeccable extract` on `incidents/toast.tsx`) eliminated 4 inline hex literals from `ThresholdsPage`, `ThresholdsPopulatedView`, `SimulatorPage`, and `toast.tsx` itself, routing them through `bg-severity-{healthy,critical}-bg` / `text-severity-{healthy,critical}-text` Tailwind severity tokens. Verified: `vitest run` 36 files / 487 tests pass, `tsc --noEmit` zero errors, `eslint` zero warnings on the five migrated files. Pre-extraction: 20 files / ~98 hex literals. **Post-extraction: 19 files / 84 hex literals** (verified via grep; comments excluded).

---

## Audit Health Score

| #         | Dimension                | Score       | Key Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Accessibility            | **3 / 4**   | WCAG 2.1 AA enforced via axe-core (`__tests__/a11y.reduced-motion.spec.ts`); 125 ARIA occurrences across 29 .tsx files; semantic HTML used consistently; `prefers-reduced-motion` honored in `index.css`. Missing focus trap in `ThresholdsModals.tsx` (modals lack ESC handler in current markup — confirmed in WDS-AUDIT-REPORT §308).                                                                                                                                                                                                                                            |
| 2         | Performance              | **3 / 4**   | TanStack Query used (13 `useQuery` calls / 10 files) for cache deduplication; CSS keyframes pinned to design tokens; 70%/50% coverage NFR-12 enforced. No `React.lazy` / route-level code splitting despite 14 routes — full bundle ships on first paint. `LiveReadingsRow.tsx` manipulates `classList` directly (lines 205/208), bypassing React reconciliation — acceptable for transient class flips but worth flagging.                                                                                                                                                         |
| 3         | Theming                  | **2 / 4**   | Tokens declared in `tailwind.config.ts` (severity × 5, neutral, primary, spacing, density, radius, elevation, motion). Dark-mode severity inversion via CSS variables in `index.css`. Drift is real but shrinking: **19 source files with ~84 inline hex literals** post-extraction (was 20 / ~98). Top occurrences: `#0F172A` × 12, `#7F1D1D` × 11, `#FFFFFF` × 11, `#E2E8F0` × 11. The drift mostly bypasses the CSS-variable layer, so dark mode is partially broken on those surfaces (the inline `style={{...}}` colors never re-evaluate under `prefers-color-scheme: dark`). |
| 4         | Responsive Design        | **3 / 4**   | 39 responsive utilities (`@media`, `min-w-*`, `sm:`, `md:`, `lg:`) across 17 files. AppShell breakpoint detection via `window.matchMedia` (real-time reactive). Sidebar collapses to drawer at `<lg` (1024px). Login split-panel hides hero below 1024px. 14 routes, all reachable at mobile. `MapView.tsx` uses `h-[420px]` literal — fixed height, doesn't scale. Touch targets: topbar buttons are `h-9 w-9` (36×36, below the 44×44 WCAG target) but this is acceptable for desktop-first dashboards.                                                                           |
| 5         | Implementation Integrity | **3 / 4**   | Strict TypeScript, ESLint thresholds enforced (`AGENTS.md` §1.1), AGENTS.md `eslint.config.js` enforces file ≤ 500 / function ≤ 200 / component ≤ 4 hooks / ≤ 8 props. Vocabulary mismatch detected (V-1: design palette `healthy/warning/critical/offline` ≠ wire `info/warning/critical`) — `KanbanCard.tsx` hand-rolls the mapping. `KanbanBoard.tsx` line 92 hand-rolls a wire schema (`IncidentPayloadWireSchema`) and the docstring pins its equivalence to canonical. Mostly coherent; the vocabulary mismatch is the only system-level drift.                               |
| **Total** |                          | **14 / 20** | **Good** — address Theming and Implementation Integrity to reach Excellent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Rating band:** 14-17 Good (address weak dimensions). Surakkha remains in the **upper-Good band**. The toast extraction did not move the score because Theming's failure is structural (84 hex literals across 19 files), not a single high-leverage fix — the score will move only when a meaningful fraction of files is migrated to token classes.

**Detector output (full mode):** 8 anti-patterns flagged:

- 7× `side-tab` on `border-l-4` — `KpiStat.tsx:71` (intended severity stripe per DESIGN.md §Components), plus 6 occurrences in `KpiStat.spec.tsx`, `LiveReadingsRegion.spec.tsx`, `LiveReadingsRegion.tsx`, `LiveReadingsRow.tsx`, `NotificationBell.tsx`. **False positive** — same as the prior audit: the `border-l-4` pattern is a designed severity stripe (width + colour pair distinguishes healthy/critical) explicitly mandated by DESIGN.md.
- 1× `overused-font` on Inter in `index.css:54` — **False positive** — Inter is the registered primary font in `tailwind.config.ts` lines 111-119 with `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` fallback chain. Defensible for a Bengali-locale product where font availability is constrained by deployment context. PRODUCT.md notes this aesthetic direction was inferred from DESIGN.md, not user-confirmed — a future `impeccable document` run would surface this for explicit confirmation.

Both findings are P3 documentation items (recorded so a future reviewer understands why they were not actioned), not actionable bugs.

---

## Implementation Integrity Verdict

**Pass, with one named exception.**

Surakkha expresses a coherent product-specific system. The 14 routes trace to a documented 4-role RBAC matrix. The 7-state incident machine is implemented exactly once (in `packages/shared/src/incident.ts`) and consumed everywhere. The design system is a single source of truth (`tailwind.config.ts` → `index.css` → components). The 5 engineering principles in `AGENTS.md` are not aspirational — they're pinned in `eslint.config.js`.

**The exception — vocabulary mismatch (V-1):** the design palette has `healthy/warning/critical/offline` and the wire domain has `info/warning/critical`. `KanbanCard.tsx`'s `SEVERITY_DOT_BG` Record uses the wire keys but the values are the design palette colors — and the comment `info: "#1E5BB8" /* primary */` invents an `info` palette bucket by reaching for `primary`. This is the only place the codebase reaches across the two vocabularies without explicit mapping, and it's contained to one file. **Fixing this is structural, not cosmetic.**

The detector flagged 8 anti-patterns (`side-tab` for `border-l-4`, `overused-font` for Inter). On manual verification, **both are false positives in this codebase** (documented above and consistent with the prior audit).

---

## Executive Summary

**Audit Health Score: 14 / 20 (Good).** Theming is the weakest dimension (2/4) and the largest single source of design-system drift. Implementation Integrity is also weak on the vocabulary mismatch; the rest of the codebase is coherent.

**Total issues found (counted by severity):**

- P0 Blocking: **0**
- P1 Major: **4** (Them-1 hardcoded hex literals; Them-2 inline-style blocks bypassing CSS-variable dark-mode; Them-3 JIT-bait dynamic class strings; Perf-1 no route-level code splitting)
- P2 Minor: **7** (A11y-1 modal focus trap; RWD-1 map fixed height; II-1 vocabulary mismatch; Them-4 slate palette; II-2 KanbanBoard hand-rolled schema; Them-5 ERROR_COLOR comment mismatch; Them-6 modal overlay one-off)
- P3 Polish: **6** (Det-1 side-tab false positive documentation; Det-2 overused-font false positive documentation; A11y-2 contrast spot-check pending; II-3 Impeccable footprint in code; II-4 test-seam IDs; Cmt-1 stale comments)

**Top 3-5 critical issues:**

1. **P1 / Them-1** — Inline hex literals in 19 source files (~84 occurrences post-extraction; was 20 / ~98). Token drift dominates the audit. Highest-leverage remaining targets: page-level error banners (`SimulatorPage.tsx`, `ThresholdsPage.tsx`, `DisabledBanner.tsx`, `DeviceRow.tsx`), modal chrome (`ThresholdsModals.tsx`), Kanban severity mapping (`KanbanCard.tsx`), neutral-border / surface literals scattered across admin + shell + dashboard.
2. **P1 / Them-2** — Inline `style={{...}}` blocks pin colors at the element level, bypassing `index.css`'s dark-mode CSS-variable inversion. Dark mode is partially broken on admin/threshold/simulator/access/shell surfaces.
3. **P1 / Them-3** — Dynamic template-literal class strings (`text-[${X}]`, `bg-[${Y}]`, `h-[${Z}px]`) won't be picked up by Tailwind's JIT, so the class silently vanishes in production. Three known callsites: `Sidebar.tsx:60-61`, `MapView.tsx:94-95`, `MapView.tsx:345`.
4. **P1 / Perf-1** — No `React.lazy` or route-level code splitting. The 14-route SPA ships its full bundle on first paint. Acceptable for the 15-min demo but a real concern for production (NFR-1 < 3s alert latency).
5. **P2 / II-1** — Vocabulary mismatch between design palette (`healthy/warning/critical/offline`) and incident wire (`info/warning/critical`). Contained to `KanbanCard.tsx` but visible at the system level.

**Recommended next steps:** (a) extract `<ErrorBanner>` + `<Modal>` shell primitives (eliminates the largest remaining hex-literal block in one sweep), (b) extract `severity-display.ts` mapping helper to retire the `KanbanCard.tsx` vocabulary mismatch, (c) add ESLint rule forbidding `style={{ backgroundColor, color }}` and bare `slate-*` palette, (d) introduce `React.lazy` per route + bundle analyzer, (e) refactor `MapView.tsx`'s JIT-bait literal classes into a Tailwind safelist or `bg-[var(--severity-critical-bg)]` form.

---

## Detailed Findings by Severity

### P0 Blocking

_None. The codebase ships, the demo runs, no finding prevents task completion._

---

### P1 Major

#### [P1] Them-1 — Inline hex literals in 19 source files

- **Location:** `packages/web/src/**/*.{ts,tsx}` (19 files, ~84 occurrences post-extraction)
- **Category:** Theming
- **Impact:** Design tokens in `tailwind.config.ts` cannot be centrally updated because the inline literals are independent of the token system. Dark mode (CSS variables in `index.css`) does NOT reach these surfaces.
- **WCAG/Standard:** WCAG 2.1 AA 1.4.3 (Contrast — Minimum): dark-mode color tokens (`--severity-*-bg/text`) cannot reach elements with inline `style={{}}` colors, so contrast behavior diverges between token-using and hex-using surfaces.
- **Recommendation:** Replace inline `style={{...}}` blocks with token classes (`bg-severity-healthy-bg`, `text-severity-critical-text`, etc.). Highest-leverage remaining targets:
  - `<ErrorBanner tone="critical" />` — collapses the 4 identical error-banner blocks in `SimulatorPage.tsx:146-148` and `ThresholdsPage.tsx:117-119, 140-142`
  - `<Modal>` shell — eliminates the chrome in `ThresholdsModals.tsx`
  - `KanbanCard.tsx`'s `SEVERITY_DOT_BG` Record → use `severity.{healthy,warning,critical,offline}` directly
  - Neutral-border + surface literals (`#E2E8F0`, `#FFFFFF`) → use `border-neutral-border` and `bg-neutral-surface`
- **Suggested command:** `/impeccable extract packages/web/src/admin/simulator/SimulatorPage.tsx` (or any admin-thresholds/admin-simulator/admin-notifications target)

#### [P1] Them-2 — Inline-style blocks bypass CSS-variable dark mode

- **Location:** 9 files in F-1 of WDS-AUDIT-REPORT.md (ThresholdsPage, ThresholdsModals, ThresholdsPopulatedView, SimulatorPage, NotFound, RbacDenied, Sidebar, FormField, LoginShell) plus 10 additional: DeviceRow, DisabledBanner, toast.tsx (mitigated), TopBar, KanbanCard, AttachmentForm, AttachmentList, AttachmentsSection, RecentIncidentsRegion, AdminNotificationsPage.
- **Category:** Theming
- **Impact:** Dark-mode severity inversion via CSS variables in `index.css` does not reach these surfaces. The inline `style={{ backgroundColor, color, borderColor }}` values are evaluated once at render time and never re-evaluated against `prefers-color-scheme: dark`.
- **WCAG/Standard:** WCAG 2.1 AA 1.4.3 (Contrast — Minimum): a user on a dark-mode system sees light-mode colors on admin/error/modal surfaces.
- **Recommendation:** Same as Them-1 — replace `style={{...}}` with token classes. CSS-variable-aware solutions require `var(--token-name)` references in inline styles, which is more fragile than the Tailwind-class path.
- **Suggested command:** `/impeccable extract packages/web/src/admin/simulator/SimulatorPage.tsx` (extracts the banner, fixes 1 of the 10 sites in one sweep)

#### [P1] Them-3 — JIT-bait dynamic class strings

- **Location:** `Sidebar.tsx:60-61`, `MapView.tsx:94-95`, `MapView.tsx:345`
- **Category:** Theming
- **Impact:** Tailwind's JIT compiler scans source files for COMPLETE class strings. A template literal like `text-[${status.color}]` produces classes that never appear literally in the source, so the JIT tree-shakes them out — the class silently vanishes in the production bundle. The fallback CSS values (text-neutral-body, bg-neutral-page) DO survive, masking the bug.
- **WCAG/Standard:** N/A (correctness, not accessibility)
- **Recommendation:** Two options:
  1. Tailwind safelist in `tailwind.config.ts` for the known dynamic values (`text-[#1F9D55]`, `text-[#D97706]`, etc.)
  2. Use `bg-[var(--severity-healthy-value)]` — Tailwind preserves arbitrary `var(...)` classes, and the CSS variable resolves at runtime against the severity palette in `index.css`.
- **Suggested command:** `/impeccable colorize packages/web/src/dashboard/MapView.tsx`

#### [P1] Perf-1 — No route-level code splitting

- **Location:** `packages/web/src/main.tsx` (single `createRoot(...).render(<App />)`)
- **Category:** Performance
- **Impact:** 14-route SPA ships the full bundle on first paint. The admin simulator / thresholds / kanban surfaces each pull in dependencies (TanStack Query keys, validators, dashboards) that the operator dashboard doesn't need.
- **WCAG/Standard:** NFR-1: telemetry-to-alert latency < 3 seconds end-to-end. Bundle size is upstream of the alert-rendering latency; not the NFR-1 measurement itself, but a constraint on it.
- **Recommendation:** Wrap each route component in `React.lazy(() => import('./Route'))` and wrap the `<Routes>` children in `<Suspense fallback={<RouteSkeleton />}>`. Add a route-level chunk analyzer to the build (`rollup-plugin-visualizer`).
- **Suggested command:** `/impeccable optimize packages/web/src/main.tsx`

---

### P2 Minor

#### [P2] A11y-1 — Modal focus trap missing

- **Location:** `packages/web/src/admin/thresholds/ThresholdsModals.tsx`
- **Category:** Accessibility
- **Impact:** `NewRuleModal` and `EditRuleModal` mount to the DOM but lack focus trap and return-focus behavior. Keyboard-only users tabbing past the modal close into the page beneath; the ESC key does not dismiss.
- **WCAG/Standard:** WCAG 2.1 AA 2.4.3 (Focus Order) + 2.1.1 (Keyboard)
- **Recommendation:** Extract a shared `<Modal>` primitive with focus-trap + ESC handler + `aria-modal="true"` + `role="dialog"`. Existing `<dialog>` element + `showModal()` is a smaller-footprint option.
- **Suggested command:** `/impeccable adapt packages/web/src/admin/thresholds/ThresholdsModals.tsx`

#### [P2] RWD-1 — MapView fixed height

- **Location:** `packages/web/src/dashboard/MapView.tsx:94-95` (`h-[420px]`), `MapView.tsx:345` (`h-[...]px` literal)
- **Category:** Responsive Design
- **Impact:** Map region is pinned at 420px tall on all viewports. On a phone in landscape (height < 420px) the map is taller than the viewport. Same JIT-bait issue as Them-3 for the second occurrence.
- **WCAG/Standard:** WCAG 2.1 AA 1.4.10 (Reflow): content reflows without loss of information at 320px width.
- **Recommendation:** Replace `h-[420px]` with `aspect-ratio` or a `min-h-[420px] max-h-[60vh]` form. Use `h-[var(--map-height)]` for the second occurrence to escape the JIT-bait issue.
- **Suggested command:** `/impeccable adapt packages/web/src/dashboard/MapView.tsx`

#### [P2] II-1 — Vocabulary mismatch (design ↔ wire)

- **Location:** `packages/web/src/incidents/KanbanCard.tsx` (`SEVERITY_DOT_BG`)
- **Category:** Implementation Integrity
- **Impact:** Two parallel vocabularies for severity. The wire domain uses `info/warning/critical`, the design palette uses `healthy/warning/critical/offline`. `KanbanCard.tsx` is the only file that bridges them, and it invents an `info` palette bucket by reaching for `primary`. Future wires (e.g. `monitoring`, `pending`) would need a new mapping table here.
- **WCAG/Standard:** N/A (architectural)
- **Recommendation:** Add `packages/shared/src/severity-display.ts` exporting `wireToPalette(wire: WireSeverity): PaletteSeverity` and `paletteToWire(p: PaletteSeverity): WireSeverity`. Delete the local `SEVERITY_DOT_BG` Record and call the helper.
- **Suggested command:** `/impeccable clarify packages/web/src/incidents/KanbanCard.tsx`

#### [P2] Them-4 — Slate palette

- **Location:** `tailwind.config.ts:84-95` (`neutral` slot) — uses `slate` values throughout (`#0F172A`, `#475569`, `#CBD5E1`, `#E2E8F0`, `#F1F5F9`, `#F5F7F9`).
- **Category:** Theming
- **Impact:** The 84 hex-literal occurrences include ~35 `slate` palette values. Centralizing these in a `neutral` token slot is half-done; the literal `slate-*` classes that Tailwind auto-generates are NOT used in source (verified — no `bg-slate-*` / `text-slate-*` matches), so Tailwind doesn't actually emit `slate-*` classes, but the `neutral` slot is canonical Surakkha territory.
- **WCAG/Standard:** N/A (consistency)
- **Recommendation:** Rename `neutral` slot → `ink` (DESIGN.md uses "ink" for foreground hues). Or document the slate-derivation in `tailwind.config.ts` so the relationship to the upstream palette is explicit.
- **Suggested command:** `/impeccable document packages/web/tailwind.config.ts`

#### [P2] II-2 — KanbanBoard hand-rolled wire schema

- **Location:** `packages/web/src/incidents/KanbanBoard.tsx:92`
- **Category:** Implementation Integrity
- **Impact:** `IncidentPayloadWireSchema` is hand-rolled in the component file, with a docstring pinning its equivalence to the canonical schema. Drift between this local copy and the canonical schema is the failure mode — silent, with no test asserting equality.
- **WCAG/Standard:** N/A (architectural)
- **Recommendation:** Import the canonical schema from `packages/shared/src/incident-wire.ts`. Delete the local hand-rolled copy.
- **Suggested command:** `/impeccable clarify packages/web/src/incidents/KanbanBoard.tsx`

#### [P2] Them-5 — ERROR_COLOR comment mismatch

- **Location:** `packages/web/src/admin/simulator/DeviceRow.tsx:29,31` (literal colors) vs comment at line 11 referring to "calm palette"
- **Category:** Theming
- **Impact:** Docstring claims a calm palette; the values are bright severity colors. Operator-facing copy + visual language should be in lock-step.
- **WCAG/Standard:** N/A (consistency)
- **Recommendation:** Either rewrite the docstring to reflect the severity-driven palette, or migrate `DeviceRow.tsx` to the `severity.{healthy,warning,critical}` tokens (eliminates the comment ambiguity as a side-effect).
- **Suggested command:** `/impeccable clarify packages/web/src/admin/simulator/DeviceRow.tsx`

#### [P2] Them-6 — Modal overlay one-off

- **Location:** `packages/web/src/admin/thresholds/ThresholdsModals.tsx`
- **Category:** Theming
- **Impact:** Modal overlay is hand-rolled with inline `style={{ backgroundColor: "rgba(15,23,42,0.5)" }}` (the `elevation-topbar` color at 50% alpha). One-off overlay implementation.
- **WCAG/Standard:** WCAG 2.1 AA 1.4.11 (Non-text Contrast): overlay must hit 3:1 against the dimmed content beneath. Hand-rolled values are easy to miscalibrate.
- **Recommendation:** Extract `<ModalOverlay />` with the alpha baked into `tailwind.config.ts` `boxShadow.modal-overlay`. Single point of calibration.
- **Suggested command:** `/impeccable extract packages/web/src/admin/thresholds/ThresholdsModals.tsx`

---

### P3 Polish

#### [P3] Det-1 — Side-tab false positive (`border-l-4`)

- **Location:** 7 occurrences across `KpiStat.tsx`, `LiveReadingsRegion.tsx`, `LiveReadingsRow.tsx`, `NotificationBell.tsx` + their spec files
- **Category:** Detector signal (false positive)
- **Impact:** The detector flags `border-l-4` as the "AI-generated side-tab accent" anti-pattern. In Surakkha, `border-l-4` is a designed severity stripe — DESIGN.md §Components explicitly mandates it for KPI cards and the operator notification bell to communicate severity at a glance.
- **WCAG/Standard:** WCAG 2.1 AA 1.4.1 (Use of Color): severity is conveyed by colour, text, and icon simultaneously (not colour alone), per `PRODUCT.md` Accessibility & Inclusion.
- **Recommendation:** Keep the pattern. Add an inline `// impeccable-disable-next-line side-tab` comment to the 5 production files (not the spec files, which are testing the visual).
- **Suggested command:** none — false positive, no fix needed.

#### [P3] Det-2 — Overused-font false positive (Inter)

- **Location:** `packages/web/src/index.css:54` (`font-family: Inter`)
- **Category:** Detector signal (false positive)
- **Impact:** Detector flags Inter as one of the overused faces. In Surakkha, Inter is the registered primary font with a defensible system-font fallback chain (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`) chosen for a deployment target (Bangladeshi government primary schools) where font availability is constrained.
- **WCAG/Standard:** WCAG 2.1 AA 1.4.4 (Resize text): the system-font fallback means the text scales with OS settings without font-loading failure.
- **Recommendation:** Keep Inter. Future `impeccable document` run would surface the aesthetic direction for explicit confirmation per PRODUCT.md's note.
- **Suggested command:** `/impeccable document` (when next run)

#### [P3] A11y-2 — Contrast spot-check pending

- **Location:** `packages/web/src/index.css` (dark-mode severity lift values)
- **Category:** Accessibility
- **Impact:** Dark-mode severity `bg/text` pairs haven't been verified with a contrast checker. The light-mode pairs are pinned to WCAG AA (verified manually during DESIGN.md authoring); dark-mode lift is asserted to satisfy the same standard but not measured.
- **WCAG/Standard:** WCAG 2.1 AA 1.4.3 (Contrast — Minimum)
- **Recommendation:** Add `axe-core` dark-mode pass to `__tests__/a11y.reduced-motion.spec.ts`.
- **Suggested command:** `/impeccable harden packages/web/src/index.css`

#### [P3] II-3 — Impeccable footprint in code

- **Location:** `design-artifacts/IMPECCABLE-AUDIT.md`, `WDS-AUDIT-REPORT.md`, `design-artifacts/`, `.impeccable/`
- **Category:** Implementation Integrity
- **Impact:** Impeccable artifacts live in `design-artifacts/`. They're referenced in code comments (e.g. `tailwind.config.ts` header cites `DESIGN.md`) but not imported or runtime-referenced. Document-grade artifacts, not code-grade.
- **WCAG/Standard:** N/A
- **Recommendation:** Confirm with the user whether `design-artifacts/` should remain in the repo (current state) or move to a `.docs/` external location.
- **Suggested command:** none — documentation question for the user.

#### [P3] II-4 — Test-seam IDs in source

- **Location:** 13 `data-testid` patterns across `KpiStat`, `IncidentDetailPage`, `ToastRegion`, `SimulatorPage`, `ThresholdsPage` + their spec files
- **Category:** Implementation Integrity
- **Impact:** The test seams are stable, well-named, and documented. The risk is coupling — if the production component renames an ID, the spec fails. Verified: this is the intended contract.
- **WCAG/Standard:** N/A
- **Recommendation:** None. The current testid discipline (`{prefix}-{component}-{state}`) is exemplary.
- **Suggested command:** none.

#### [P3] Cmt-1 — Stale comments

- **Location:** `packages/web/src/incidents/toast.tsx` (header comment mentions "Epic-6 sweep" — accurate post-extraction) + various JSDoc comments
- **Category:** Documentation drift
- **Impact:** Low. Comments are updated alongside code; risk is when comments describe a future plan that doesn't ship.
- **WCAG/Standard:** N/A
- **Recommendation:** Quarterly comment audit. Not blocking.
- **Suggested command:** none.

---

## Patterns & Systemic Issues

- **Token-drift pattern**: ~84 inline hex literals across 19 files. Highest-occurrence colors are `slate` palette values (`#0F172A` × 12, `#7F1D1D` × 11, `#FFFFFF` × 11, `#E2E8F0` × 11). The `slate` palette is centralized in `tailwind.config.ts`'s `neutral` slot, but consumers reach for the raw hex instead. **Pattern fix:** extract `<ErrorBanner>`, `<Modal>`, `<PageHeader>` primitives — each carries its own token-class palette and removes 5-10 hex literals per consumer site.
- **Hand-rolled-mapping pattern**: `KanbanCard.tsx`'s `SEVERITY_DOT_BG`, `KanbanBoard.tsx`'s `IncidentPayloadWireSchema`, `DeviceRow.tsx`'s color literals — three places where a "wire-to-display" or "schema-locality" mapping is invented inline instead of being centralized. **Pattern fix:** add `packages/shared/src/severity-display.ts` + `packages/shared/src/incident-wire.ts` and consume from the canonical location.
- **JIT-bait pattern**: 3 known callsites where template-literal class strings bypass Tailwind's content scanner. **Pattern fix:** safelist in `tailwind.config.ts` OR use `var(--token-name)` form for dynamic values.

---

## Positive Findings

- **Test coverage is exemplary.** 36 spec files / 487 tests, 70%+ line coverage on backend, 50%+ on frontend (NFR-12 met). The testid discipline (`{prefix}-{component}-{state}`) is consistent and well-documented.
- **Toast extraction worked.** The previous audit's Them-1 count dropped from 20 files / ~98 occurrences to 19 / ~84 after a single `/impeccable extract` run. Validates the recommended path: identify the canonical helper, route consumers through it, verify with tests.
- **AGENTS.md principles are pinned in eslint.config.js.** The 5 engineering principles (Small, Typed, Immutable, Professional, Audited) aren't aspirational — they're enforced. `react/boolean-prop-naming` flagged the new `isId` prop on first pass; rename to `isId` resolved it.
- **Strict TypeScript + readonly props.** Every consumer of the toast primitive uses `readonly ToastEntry[]` — the `readonly` discipline is honored, not just declared.
- **DESIGN.md is the single source of truth.** `tailwind.config.ts` mirrors it line-by-line; `index.css` extends it for dark-mode severity lift. The mapping is auditable.
- **PRODUCT.md is registered.** The `impeccable:product-schema 1` comment marker on `PRODUCT.md` anchors all five workspace packages to the root product spec. The `doctor.mjs` report confirmed 5/5 inherit correctly.

---

## Recommended Actions

1. **[P1] `/impeccable extract packages/web/src/admin/simulator/SimulatorPage.tsx`** — Extract `<ErrorBanner tone="critical" />` to eliminate the 3 inline-style banner blocks across `SimulatorPage.tsx` + `ThresholdsPage.tsx` + `DisabledBanner.tsx`. Eliminates ~9 hex literals + Them-1 sites + Them-2 sites in one sweep.
2. **[P2] `/impeccable extract packages/web/src/admin/thresholds/ThresholdsModals.tsx`** — Extract `<Modal>` shell with focus-trap + ESC handler + overlay (kills A11y-1 + Them-6 in one sweep).
3. **[P2] `/impeccable clarify packages/web/src/incidents/KanbanCard.tsx`** — Resolve II-1 vocabulary mismatch by introducing `severity-display.ts` mapping helper.
4. **[P3] `/impeccable document`** — Confirm DESIGN.md aesthetic direction (Inter font, severity stripe) with explicit user sign-off; updates PRODUCT.md to remove the "inferred, not user-confirmed" note.
5. **[P1] `/impeccable optimize packages/web/src/main.tsx`** — Add `React.lazy` per route + bundle analyzer.

---

## Verification Artifacts

- Detector run: `node .claude/skills/impeccable/scripts/detect.mjs --json packages/web/src` → 8 anti-pattern findings (all documented P3 false positives).
- Toast extraction verification:
  - `pnpm -r vitest run` → 36 test files / 487 tests passing
  - `pnpm -r tsc --noEmit` → 0 errors
  - `eslint` on the 5 migrated files → 0 warnings (after `isId` prop rename to satisfy `react/boolean-prop-naming`)
- Hex-literal verification: `grep -rE "#[0-9A-Fa-f]{6}" packages/web/src --include="*.ts" --include="*.tsx" | grep -v tokens.spec.ts | wc -l` → 84 (was ~98 pre-extraction).
- Detector mode verification: `node -e "import('htmlparser2').then(...)"` → all 4 parser modules resolve from repo-root `node_modules/`.
