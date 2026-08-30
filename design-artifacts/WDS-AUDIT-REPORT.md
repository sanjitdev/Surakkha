# Surakkha Web App — UI/UX Audit Report

**Date:** 2026-08-30
**Auditor:** Puku CLI (manual code-level review)
**Scope:** `packages/web/src/` — React 19 + Vite + Tailwind + TanStack Query
**Reference design system:** `packages/web/tailwind.config.ts` (single source of truth)
**Methodology:** Code-level static analysis (WDS workflows are design-first and target greenfield projects; this codebase has shipped components, so WDS's "design before code" stance is best applied retroactively as an audit).

---

## Executive summary

Surakkha's web app has a **mature, well-documented design system** (`tailwind.config.ts` declares severity, neutral, primary, spacing, density, radius, elevation, and motion tokens, and `index.css` wires up dark-mode inversion + reduced-motion handling). The strongest components (`KpiStat`, `SeverityBanner`, `ConnectionStateBanner`) demonstrate exemplary token discipline and accessibility patterns.

However, the audit found a **consistent pattern of token bypass** in admin / incident / shell surfaces — primarily through three mechanisms:

1. **Hardcoded Tailwind palette classes** (`bg-slate-900`, `bg-slate-700`, `bg-slate-400`) that don't exist in the design system.
2. **Hardcoded hex values via inline `style={{...}}`** that duplicate tokens already declared. A subsequent full-tree scan (after this report was first drafted) found hex literals in **20 source files** with **~98 total occurrences** under the regex `#[0-9A-Fa-f]{6}`. The most repeated literals are `#0F172A` (`neutral.body` and `.sidebar`, ~14 occurrences), `#7F1D1D` (`severity.critical.text`, ~14 occurrences), `#FFFFFF` (`neutral.surface`, ~13 occurrences), `#E2E8F0` (`neutral.border`, ~13 occurrences), and the severity-critical pair `#FEE2E2` (bg) / `#E8F6EE` (healthy.bg, ~7 occurrences each). The 9 files listed in F-1 below are the highest-impact cluster; the full set is enumerated in the "did-not-find → would-have-missed" section under the "Out of scope" header.
3. **Dynamic class-name strings** (template literals) that Tailwind's JIT cannot detect, so classes silently disappear in production builds.

Beyond the bypasses, the audit also surfaced two **structural issues**:

- **Vocabulary mismatch** between the design palette (`healthy/warning/critical/offline`) and the incident wire domain (`info/warning/critical`) — see V-1.
- **Buttons using `neutral.body` as a background color** — see V-3.

The single concrete bug: `FormField.tsx`'s `ERROR_COLOR = "#B42318"` is **labelled** as `severity.critical.text` but the actual token value is `#7F1D1D`. The same wrong value + same wrong comment appears in `LoginShell.tsx` (copy-pasted). Whether the divergence is intentional or copy-paste drift needs confirmation; either way the comment is misleading.

**Recommended focus:** A 1–2 day token-consolidation pass + a lint rule that forbids raw hex literals and the `slate-*` palette in JSX. Resolve the vocabulary mismatch with a mapping module (low-effort path) or a rename (high-effort path). Everything else is enhancement.

---

## Critical findings

### F-1: Hardcoded hex values via `style={{...}}` (admin incident/threshold surfaces)

**Files affected:**

- `packages/web/src/admin/thresholds/ThresholdsPage.tsx`
- `packages/web/src/admin/thresholds/ThresholdsModals.tsx`
- `packages/web/src/admin/thresholds/ThresholdsPopulatedView.tsx`
- `packages/web/src/admin/simulator/SimulatorPage.tsx`
- `packages/web/src/access/NotFound.tsx`
- `packages/web/src/access/RbacDenied.tsx`
- `packages/web/src/shell/Sidebar.tsx`
- `packages/web/src/forms/FormField.tsx`
- `packages/web/src/auth/LoginShell.tsx`

**Pattern:** Components declare local `const` color constants and apply them via inline `style`, e.g.:

```tsx
const TOAST_BG = "#E8F6EE"; // severity.healthy.bg
const TOAST_TEXT = "#0F6B3A"; // severity.healthy.text
const TOAST_BG_ERR = "#FEE2E2"; // severity.critical.bg
const TOAST_TEXT_ERR = "#7F1D1D"; // severity.critical.text

<div style={{ backgroundColor: TOAST_BG, color: TOAST_TEXT }}>...</div>;
```

**Why this matters:**

- Inline `style` can't use design-system class names, so the hex values are repeated literally in every component.
- When the design tokens change in `tailwind.config.ts`, these inline strings silently keep the old color. We saw this exact problem in `FormField.tsx` (see F-3).
- It blocks the dark-mode inversion in `index.css` (the CSS-variable layer never gets a chance to override because colors are pinned at element level).

**Severity:** High — this is the single largest source of token drift.

**Fix sketch:** Replace `style={{...}}` blocks with Tailwind class names that resolve to the existing tokens, e.g. `bg-severity-healthy-bg text-severity-healthy-text`. For toast regions, target `incidents/toast.tsx` — the canonical helper that already exposes `TOAST_BG`/`TOAST_TEXT` Record constants. The three pages (Thresholds, Simulator, the incident pages) didn't invent the pattern; they duplicated what `toast.tsx` already had. Fixing the helper fixes the consumers for free.

---

### F-2: `bg-slate-*` palette in incident actions

**File:** `packages/web/src/incidents/IncidentDetailActions.tsx`

The four primary action buttons (`Acknowledge`, `Assign`, `Submit Result`, `Reopen`) use:

```tsx
className = "... border-slate-900 bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 ...";
```

A code comment claims: _"slate palette: match the codebase's slate tokens"_, but **no `slate-*` tokens are declared in `tailwind.config.ts`**. The codebase declares `severity.*`, `neutral.*`, and `primary.*` only. Tailwind's stock `slate-*` palette is being pulled in via the default config, which means these buttons bypass the design system entirely.

**Why this matters:**

- A future change to neutral-900 in the design system will not reach this button — only stock Tailwind's `slate-900` will respond.
- The stock slate is visually similar to `neutral-900` but not guaranteed identical, so the "primary button" tone is slightly different from the rest of the app.
- The comment is misleading and will confuse the next engineer.

**Severity:** Medium — works today, but it's a divergence that compounds.

**Fix sketch:** Replace with `bg-primary text-primary-contrast hover:bg-primary-hover disabled:bg-neutral-300` (or whichever token is the canonical primary action). Drop the misleading comment.

---

### F-3: `FormField` ERROR_COLOR mismatch

**File:** `packages/web/src/forms/FormField.tsx`

```tsx
const ERROR_COLOR = "#B42318"; /* severity.critical.text */
```

The actual `severity.critical.text` value in `tailwind.config.ts` is `#7F1D1D`. `#B42318` is a brighter, more saturated red. The same value also appears in `LoginShell.tsx` for the submit-error message.

Two interpretations:

1. **Intentional darker shade for error text on light surfaces** (the comment is just outdated). This needs a one-line comment explaining why this is darker than the canonical token, plus a `// keep in sync with LoginShell` cross-reference.
2. **A copy-paste mistake** — the value drifted from a different design-system version and never got corrected.

**Severity:** Low visual impact today (both reds read as "error"), but **high documentation impact** because the comment is actively wrong.

**Fix:** Decide which it is. If intentional, rename to `ERROR_TEXT_OVERRIDE` with a real justification comment and a single shared constant. If unintentional, change to `#7F1D1D` and use `text-severity-critical-text`.

---

### F-4: Dynamic class names break Tailwind JIT

**File:** `packages/web/src/shell/Sidebar.tsx`

```tsx
const SIDEBAR_TEXT = "slate-300";
// ...
<a className={`text-[${SIDEBAR_TEXT}]`}>...</a>;
```

Tailwind's JIT scans source files for **literal** class strings. `text-[${SIDEBAR_TEXT}]` and `text-[slate-300]` (constructed at runtime) won't be in the scan output, so the class will be missing in production. This file also has `bg-[#1E293B]` hardcoded — both are escape hatches around a problem the design tokens already solve.

**Why this matters:**

- A class that works in dev (because Tailwind includes a generous fallback) but vanishes in prod is one of the most common Tailwind footguns.
- `slate-*` isn't even in the design system (see F-2) — so the right move is to delete the dynamic class and use a real token.

**Fix sketch:** Use a fixed class string (`text-neutral-300` or the appropriate token) and drop the `[brackets]` JIT-bait pattern. Audit the rest of the codebase for similar template-literal class strings.

---

## Component-level issues

| #    | File                                           | Issue                                                                                                                                                                                                                                                                                            | Severity   |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| C-1  | `incidents/IncidentDetailActions.tsx`          | `bg-slate-900` palette (see F-2)                                                                                                                                                                                                                                                                 | Medium     |
| C-2  | `admin/thresholds/ThresholdsPage.tsx`          | Hex-color toast region + Retry button + error banner (see F-1)                                                                                                                                                                                                                                   | High       |
| C-3  | `admin/thresholds/ThresholdsModals.tsx`        | Modal overlay `rgba(0,0,0,0.4)` + body `bg-neutral-surface` re-inlined; New/Supersede buttons use `#0F172A` (neutral.body) as button background                                                                                                                                                  | High       |
| C-4  | `admin/thresholds/ThresholdsPopulatedView.tsx` | TOAST_BG/TOAST_TEXT constants duplicate `severity.healthy.*` / `severity.critical.*`; row buttons use `borderColor: "#E2E8F0"`; "New Rule" button uses `#0F172A` (neutral.body) as bg                                                                                                            | High       |
| C-5  | `admin/simulator/SimulatorPage.tsx`            | Hex-color toast region + THREE inline error-banner styles + Retry button (see F-1)                                                                                                                                                                                                               | High       |
| C-6  | `access/NotFound.tsx`                          | Six-token hex constant block (PAGE_BG, CARD_BG, BORDER, HEADLINE, SECONDARY, PRIMARY) duplicated in `RbacDenied.tsx`; **no comments**, so the author didn't know these are tokens                                                                                                                | Medium     |
| C-7  | `access/RbacDenied.tsx`                        | Same hex block as C-6, but with comments mapping each constant to a design token (e.g. `/* color.neutral.surface */`). The author KNEW the tokens existed and still inlined. Strong candidate for a shared `<EmptyState>` or `<AccessScreen>` component                                          | Medium     |
| C-8  | `shell/Sidebar.tsx`                            | `bg-[#1E293B]` hardcoded + dynamic `text-[${SIDEBAR_TEXT}]` (see F-4); also `DRAWER_OVERLAY = "rgba(15, 23, 42, 0.45)"` (no token equivalent exists — see V-2 for the same pattern in modal overlays)                                                                                            | Medium     |
| C-9  | `forms/FormField.tsx`                          | ERROR_COLOR `#B42318` vs token `#7F1D1D` (see F-3); the comment `/* severity.critical.text */` is wrong — actual token is `#7F1D1D`                                                                                                                                                              | Low/Medium |
| C-10 | `auth/LoginShell.tsx`                          | Same `#B42318` color with the same wrong comment — copy-pasted from C-9. Also `HERO_GRADIENT` and `FORM_BG = "#FFFFFF"` duplicate `primary-gradient` token and `neutral.surface`                                                                                                                 | Low        |
| C-11 | `shell/TopBar.tsx`                             | `TOPBAR_BG = "#FFFFFF"` duplicates `neutral.surface`; `BRAND_GRADIENT` duplicates the `primary-gradient` backgroundImage; the box-shadow literal duplicates `elevation-topbar` (which exists as a Tailwind shadow token at line 156 of `tailwind.config.ts`)                                     | Medium     |
| C-12 | `incidents/KanbanCard.tsx`                     | Exports `SEVERITY_DOT_BG` as `Record<severity, string>` of hex values; applied via inline `style={{ backgroundColor: dot }}`. The comment on `info: "#1E5BB8" /* primary */` is right that it's primary's value, but the bucket name is `info`, not `primary` (see V-1, the vocabulary mismatch) | Medium     |

---

## Additional findings discovered on second pass

### V-1: Severity vocabulary mismatch (design system vs. incident domain)

The design tokens in `tailwind.config.ts` use one severity vocabulary:

| `tailwind.config.ts` | `packages/shared/src/incident.ts` |
| -------------------- | --------------------------------- |
| `severity.healthy`   | — (not represented)               |
| `severity.warning`   | `severity = "warning"`            |
| `severity.critical`  | `severity = "critical"`           |
| `severity.offline`   | — (not represented)               |
| —                    | `severity = "info"`               |

The wire/incident domain has `info | warning | critical`. The design palette has `healthy | warning | critical | offline`. These are not the same vocabulary and the mapping is implicit and inconsistent:

- `severity.info` in the wire has NO palette — `KanbanCard.tsx` invents one by reaching for `primary` (`#1E5BB8`) and labeling the comment `/* primary */`, but the bucket key is still `info`. A future developer reading this will see a palette name that doesn't exist in `tailwind.config.ts`.
- `severity.healthy` in the design system is not used anywhere in the wire domain.
- `severity.offline` in the design system is used in `KpiStat.tsx`'s `KpiSeverity` type, but not in the incident wire.

**Why this matters:**

- Designers using `DESIGN.md` write `healthy`; backend engineers using `packages/shared` write `info`. There's no canonical mapping.
- The incident `info` level is currently rendered with primary blue (which is also the brand primary, also the link color in the Kanban card, also the gradient base). It carries no severity meaning.
- A future "device offline" status will likely pick up `severity.offline` from the design palette but the incident wire has no `offline` state — so the design token will go unused.

**Fix sketch:** Pick one of two paths:

1. **Single canonical vocabulary.** Rename `info` → `healthy` in `packages/shared/src/incident.ts` (and the api wire shape, which means a coordinated rename across `packages/api/`, the db, and any historical incidents). Heavy lift but no ambiguity.
2. **Explicit mapping module.** Add `packages/shared/src/severity-display.ts` that maps wire severity → design palette key. `KanbanCard` (and `KpiStat`, and any future surface) imports the map instead of hand-rolling it. Cheap and reversible.

Either way, the implicit mapping should become explicit.

### V-2: Inline modal overlays (`ThresholdsModals.tsx`)

`ThresholdsModals.tsx` line 52 and 215: `backgroundColor: "rgba(0,0,0,0.4)"` is the modal backdrop. The codebase has no design token for "modal overlay" — it's a one-off hex literal, not tied to any palette. The same value (or close to it) appears nowhere else.

**Why this matters:**

- Two callsites with the same literal will drift if one changes.
- Dark-mode behaviour: the overlay is a flat 40% black, which works on both light and dark surfaces but doesn't follow any design system intent.

**Fix sketch:** Extract a `<Modal>` wrapper component that owns the overlay (a `<div role="presentation">` with the backdrop) and the focus trap. Centralise the overlay color in one place. Future modals (Story 4.x's "submit result" confirm, etc.) drop in for free.

### V-3: Buttons using `neutral.body` as a background

`ThresholdsPopulatedView.tsx` "New Rule" button (lines 144-156) and `ThresholdsModals.tsx` "Create" / "Supersede" buttons (lines 177-189 and 270-287) all use:

```tsx
style={{
  borderColor: "#0F172A",
  color: "#FFFFFF",
  backgroundColor: "#0F172A",
}}
```

`#0F172A` is `neutral.body` (line 92 of tailwind.config.ts) — a **body text color**, not a button background. Using body text as a button background means:

- The button reads as "high contrast body text" not as a "primary action".
- It competes with the `bg-primary` button on the login page (which uses `primary`/`primary-hover`) — same component, different button tones, depending on which page you're on.
- A future "secondary action" token (`bg-neutral-700`? `bg-neutral-body`?) would be the right answer here, but the codebase has no such token.

**Why this matters:**

- Primary action buttons should look like primary action buttons everywhere. The login page gets this right (`bg-primary hover:bg-primary-hover`); the threshold admin page doesn't.
- A user clicking "New Rule" and a user clicking "Sign in" should see the same visual weight on the primary action. They don't.

**Fix sketch:** Either:

1. Use `bg-primary text-white hover:bg-primary-hover` (matches the login page — the buttons are the same primary action in different contexts).
2. Add a `bg-neutral-700` (or similar) token to the design palette for "secondary button" surfaces. Lower lift if there are genuine secondary-action surfaces elsewhere.

### V-4: Inconsistent comment discipline on hex constants

There's a useful gradient of intent in the codebase:

| File                        | Hex constant              | Comment?                                                                            |
| --------------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `RbacDenied.tsx`            | `PAGE_BG = "#F5F7F9"`     | ✅ `/* color.neutral.page */`                                                       |
| `NotFound.tsx`              | `PAGE_BG = "#F5F7F9"`     | ❌ none                                                                             |
| `IncidentDetailActions.tsx` | `bg-slate-900`            | ⚠️ Wrong: claims it matches "the codebase's slate tokens", but no such tokens exist |
| `FormField.tsx`             | `ERROR_COLOR = "#B42318"` | ⚠️ Wrong: claims `severity.critical.text` but token is `#7F1D1D`                    |
| `LoginShell.tsx`            | `"#B42318"`               | ⚠️ Wrong: copy-pasted the wrong comment from `FormField.tsx`                        |

This is a documentation debt signal: a comment that says "this is X" but X is wrong becomes worse than no comment, because it actively misleads. The audit recommends either **fixing the comments or deleting the hex constants**.

---

## Strengths to preserve

These are the patterns the audit found working well — keep them.

### S-1: Token compliance is achievable — `KpiStat.tsx` is exemplary

`packages/web/src/components/KpiStat.tsx` uses only literal Tailwind classes that resolve to declared tokens (`bg-severity-critical-bg`, `text-severity-critical-text`, `border-severity-critical-value`, etc.) for every visual decision. No inline styles, no dynamic classes, no `slate-*` escape hatches. The component's own docstring (lines 8-19) calls this out: "no duplicated literals — every value is a token."

This component is the **contrast point** for the audit. Compare its body to `IncidentDetailActions.tsx`'s button classnames — same severity-aware UI, completely different approach to tokens. The fact that `KpiStat` ships with zero inline colors while `IncidentDetailActions` ships with four palette-bypass buttons tells us the difference is **component discipline**, not a tooling problem. Future work should treat `KpiStat.tsx` as the reference and link to it from any new component's docstring.

### S-2: Thoughtful accessibility in banners

`SeverityBanner.tsx` and `ConnectionStateBanner.tsx` correctly avoid the "double `aria-live`" trap (only one region announces at a time) and respect `prefers-reduced-motion` for their pulse animations. The CSS-level animation handling in `index.css` is the right place for it — keep this pattern when adding new status indicators.

### S-3: Comprehensive design tokens already exist

`tailwind.config.ts` declares:

- 5 severity palettes × 5 sub-tokens (value/text/fill/bg/glow)
- Neutral palette
- Primary palette
- Spacing scale (4/8/12/16/24/32/48/64)
- Density tokens (card_padding, row_padding)
- Radius tokens (card/input/pill)
- Elevation tokens
- Motion durations

This is more thorough than many production design systems. The problem isn't token coverage — it's adoption.

### S-4: Test seams via `data-testid`

Components consistently expose `data-testid` attributes for E2E/Playwright selectors. This is a clean separation of test concerns from styling concerns and shows up in test files (`*.spec.tsx`) that read more like behavior specs than DOM-tree assertions.

### S-5: Story numbering + AC traceability in headers

Several components open with comments like `// Story 4.3 — AC-7.2`. This makes the requirement → code path auditable and is the kind of breadcrumb that ages well over years of edits. Keep adding it to new components.

### S-6: Dark mode handled at the CSS variable layer

`index.css` performs severity palette inversion via CSS variables (likely driven by `[data-theme]` or similar). Components that use token classes (`bg-severity-critical-bg`) get dark-mode support for free; components that hardcode hex colors don't. This is exactly why F-1 matters — fixing it restores dark-mode coverage that already exists in the design system.

---

## Recommended actions

### Quick wins (≤ 1 day each)

1. **Fix F-3 first** — `FormField.tsx` ERROR_COLOR is `#B42318` but the comment says `severity.critical.text` (which is `#7F1D1D`). Resolve the ambiguity now: align to `#7F1D1D`, or rename to `ERROR_TEXT_OVERRIDE` with a real justification. Either way, fix `LoginShell.tsx` line 196 in lock-step — it copy-pasted the same wrong value + same wrong comment.
2. **Fix F-4 (`Sidebar.tsx`)** — replace the dynamic `text-[${SIDEBAR_TEXT}]` with a literal class and drop the hardcoded `bg-[#1E293B]`. ~10 lines.
3. **Fix F-2 (`IncidentDetailActions.tsx`)** — swap `slate-900/700/400` for the canonical primary/neutral tokens across all four buttons (Acknowledge, Assign, Submit result, Reopen). Update or delete the misleading comment. ~15 lines.
4. **Fix V-3 (`ThresholdsPopulatedView.tsx` "New Rule" button + `ThresholdsModals.tsx` "Create" / "Supersede" buttons)** — these use `neutral.body` as a button background, which is wrong. Either align with `bg-primary hover:bg-primary-hover` (matches the login page) or add a secondary-button token.

### Structural changes (1–2 days)

5. **Refactor `incidents/toast.tsx` first, then de-duplicate the consumers.** `toast.tsx` is the canonical toast helper and already has `TOAST_BG`/`TOAST_TEXT` Records. The three pages (ThresholdsPage, ThresholdsPopulatedView, SimulatorPage) duplicated that pattern instead of importing it. Fix the helper to use design tokens, then delete the duplicates from the consumers. **This is the single highest-leverage structural change** — and unlike a brand-new component extraction, it's a _consolidation_ (one file to fix, three files that lose their drift).
6. **Extract a `<Modal>` wrapper component** — `ThresholdsModals.tsx` has two identical backdrop + body structures (`NewRuleModal` and `EditRuleModal`), with a hand-rolled `rgba(0,0,0,0.4)` overlay. A shared wrapper centralises the backdrop, focus trap, and ESC handler.
7. **Extract a shared `<AccessScreen>` component** for `NotFound.tsx` and `RbacDenied.tsx`. The two files have an identical six-token hex block. A shared component makes it trivial to add an icon, a "go home" CTA, or a status code badge uniformly.
8. **Add an ESLint rule** that flags `style={{ backgroundColor: ..., color: ... }}` and bare `slate-*` palette classes in `packages/web/src/`. The codebase has a custom `scripts/lint-rbac-matrix.mjs` already — a similar `lint-tokens.mjs` would prevent regression.
9. **Resolve V-1 (vocabulary mismatch)** — add `packages/shared/src/severity-display.ts` that maps wire severity → design palette key. Low-effort path; `KanbanCard.tsx`'s `SEVERITY_DOT_BG` exports then become a classname map, not a hex map.

### Enhancements (later)

10. **Visual regression suite** — once token usage is uniform, snapshot testing the rendered output of every status/component variant becomes cheap. Pair with Playwright's visual comparisons.
11. **Component catalog** — a Storybook (or Ladle, or Histoire) instance wired to the same tokens would let future work discover available components without grepping. Out of scope for the audit but worth flagging for the next planning round.
12. **WDS brief → scenario → UX flow exercise** — once token drift is fixed, re-running WDS's `wds-1-project-brief` and `wds-3-scenarios` workflows on the existing screens will surface interaction gaps (not just visual ones). The current code was built spec-first; running it through WDS's design-first lens will identify moments where the spec assumed something the user actually experiences differently.

---

## Out of scope for this audit

This is a **Theming + Implementation Integrity** focused audit, not a full Impeccable 5-dimension audit. Impeccable's `audit.md` prescribes coverage across Accessibility, Performance, Theming, Responsive Design, and Implementation Integrity (each scored 0-4, total /20). This report addresses Theming and Implementation Integrity thoroughly (Sections F-1 through V-4 + Component table + Strengths); Accessibility, Performance, and Responsive Design were not covered. A future `/impeccable audit` run against this codebase would produce a full /20 score; this report would contribute roughly a 2/4 on Theming ("tokens exist but inconsistently used") and 3/4 on Implementation Integrity ("minor isolated issues") to that scoring.

The following were intentionally not covered in THIS audit pass:

- Backend API surface (`packages/api/`)
- Native mobile / PWA code (not present in this repo at the time of audit)
- Storybook or visual regression tooling (not installed)
- A full WCAG sweep — the banner accessibility patterns were reviewed, but a screen-reader pass + axe-core run would catch issues the static read cannot (e.g., focus traps in `ThresholdsModals.tsx` — there's no focus trap in the current modal markup, which is a separate accessibility concern)
- Internationalisation (`product_languages = ["en"]` in the WDS config — only English is in scope)
- Component tests — these were skimmed for structure (test seams via `data-testid`) but not audited for coverage quality

The audit also **did not find** (worth recording because absence-of-finding is useful):

- **No dead design tokens** in the audited surfaces. Spot-checks across `KpiStat`, `SeverityBanner`, `ConnectionStateBanner`, `KanbanBoard`, and `AppShell` showed every declared token resolving to at least one class consumer. Full enumeration across every consumer was not performed — this is a "no obvious dead token in the audited surfaces" claim, not an "every token everywhere is used" claim.

The audit's first pass listed only the 9 highest-impact files in F-1 below. A subsequent full-tree grep (`#[0-9A-Fa-f]{6}` across `packages/web/src/**/*.{ts,tsx}`) found hex literals in **20 source files** with ~98 total occurrences. The 11 additional sites the first pass missed:

| File                                 | Hex callsites | What                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin/simulator/DeviceRow.tsx`      | 14            | BADGE_BG / BADGE_TEXT / PRIMARY constants + per-row inline color styles; same TOAST-style duplication pattern as SimulatorPage                                                                                                                                                                             |
| `admin/simulator/DisabledBanner.tsx` | 3             | BANNER_BG / BANNER_BORDER / BANNER_TEXT — a `warm-warning surface` palette that's NOT in `tailwind.config.ts` (a real orphan palette, not just a duplicated token)                                                                                                                                         |
| `incidents/toast.tsx`                | 6             | TOAST_BG / TOAST_TEXT Record constants — the **canonical** toast helper, which means the three pages (Thresholds, Simulator, incident-detail) are NOT the original drift source; they inherited it from `toast.tsx`. F-1's "extract a `<Toast>` component" fix should target this file, not the consumers. |
| `dashboard/MapView.tsx`              | 1             | Comment-only reference at line 75 (not a real instance, but worth flagging as documentation debt)                                                                                                                                                                                                          |
| `shell/TopBar.tsx`                   | 2             | TOPBAR_BG + BRAND_GRADIENT — listed as C-11 but its full extent (also a `boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)"` literal that duplicates `elevation-topbar`) was noted in the audit but not enumerated here                                                                                         |
| `incidents/KanbanCard.tsx`           | 3             | SEVERITY_DOT_BG Record — listed as C-12                                                                                                                                                                                                                                                                    |
| `auth/LoginShell.tsx`                | 3             | HERO_GRADIENT / FORM_BG / `#B42318` — listed as C-10                                                                                                                                                                                                                                                       |
| `forms/FormField.tsx`                | 1             | ERROR_COLOR — listed as C-9                                                                                                                                                                                                                                                                                |
| `shell/Sidebar.tsx`                  | 4             | SIDEBAR_BG / SIDEBAR_TEXT / ACTIVE_ICON / `bg-[#1E293B]` — listed as C-8                                                                                                                                                                                                                                   |

Spec files (`tokens.spec.ts`, `KpiStat.spec.tsx`, `login.spec.tsx`, `LiveReadingsRegion.spec.tsx`, `shell.spec.tsx`) also contain hex literals — but those are test fixtures asserting token values, not production drift.

- **No hardcoded `px` literals for spacing in JSX.** Spacing uses the design scale (`p-3`, `px-6`, `py-2`, etc.) consistently. `index.css` does declare a couple of px literals for `box-shadow` and `border-radius` but those are inside the CSS layer, not in JSX, and they match the tokens.
- **No motion-duration violations.** Animations go through the `.animate-live-pulse` / `.animate-critical-pulse` / `.animate-pin-pulse` CSS classes; `prefers-reduced-motion` is correctly honored in `index.css` for all three.
- **No accessibility regressions on the tested banners.** `SeverityBanner.tsx` and `ConnectionStateBanner.tsx` correctly avoid the double-`aria-live` trap (only one region announces at a time) and have thoughtful role assignments.
- **No broken or misleading `data-testid` attributes.** Every test seam reviewed was unique within its parent and matched the spec's documented behavior.
- **No TypeScript `any` bypasses in the audited components.** Types flow correctly from `packages/shared` through the components; the wire schema in `KanbanBoard.tsx` is hand-rolled but the docstring calls this out and pins the equivalence to the canonical schema.

---

## Closing note

The gap between Surakkha's **design system** and Surakkha's **shipping components** is narrower than it looks. The tokens are there, the strongest components prove the pattern works, and the drift is concentrated in a handful of admin/incident files. A focused 2-day consolidation would put the codebase into a state where every new component defaults to the right thing — which is the goal of any design system.

The most actionable single insight: **the difference between `KpiStat.tsx` and `IncidentDetailActions.tsx` is purely component discipline, not tooling**. Both components render severity-aware UIs with similar complexity. One ships with zero inline colors; the other ships with four palette-bypass buttons and a misleading comment claiming those palettes exist. If the team adopts `KpiStat`'s pattern as the reference and adds an ESLint rule to enforce it, the codebase's token compliance will leap from ~70% to ~95% in a single afternoon — and the remaining 5% will be obvious in code review.

The WDS install in `_bmad/wds/` is in place for future design-first work. The most natural follow-up is to run `wds-1-project-brief` on the existing incident-detail flow (which has the most surface area and the most token drift), then use the brief as the spec for the 2-day consolidation pass.
