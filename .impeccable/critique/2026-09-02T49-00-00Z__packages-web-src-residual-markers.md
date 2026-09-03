# Critique — residual marker pass (4 files)

**Date**: 2026-09-02
**Loop**: residual-marker re-critique
**Path**: `packages/web/src/incidents/KanbanBoard.tsx`, `packages/web/src/incidents/IncidentDetailPage.tsx`, `packages/web/src/auth/LoginShell.tsx`, `packages/web/src/index.css`
**Total LOC**: 1090
**Spec files** (_.spec.ts / _.spec.tsx): out of scope.

## Prior-loop coverage (per `git log -1`)

| File                     | Last commit                                         | Claimed converged? | Residual markers in fresh scan                                                                                                    |
| ------------------------ | --------------------------------------------------- | :----------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| `KanbanBoard.tsx`        | `85a711f refine(web/incidents): critique-loop pass` |        yes         | `Story 4.4`, `Story 4.12` (×3), `AC9`, `Story 6.11`, cross-file `useSeverityBanner (Story 4.8)`, `useKanbanBoardSocket.ts header` |
| `IncidentDetailPage.tsx` | `85a711f refine(web/incidents): critique-loop pass` |        yes         | `Story 6.11` inline comment in dispatch                                                                                           |
| `LoginShell.tsx`         | `267051e refine(web/auth): critique-loop pass`      |        yes         | `LoginShell — Story 1.3 split-screen login form` in header                                                                        |
| `index.css`              | `e3d7b8b chore(impeccable): web audit fixes`        | not in prior loop  | Heavy `Story 1.2a AC1` / `AC2` / `AC3` markers, role-aware back-link narrative, `DESIGN.md §Coverage & Provenance` etc.           |

Three of four files were previously "converged" but a fresh scan shows they still
carry residual slop, mostly hidden inside method bodies — not in the file headers
the prior pass trimmed. This pass hunts the markers wherever they hide.

## Methodology

Per-file re-read end-to-end. Critiqued on:

- **Nielsen 10 heuristics** adapted to source code readability
  (visibility of intent, match-to-domain, user control, consistency,
  error prevention, recognition vs recall, flexibility, minimalism,
  error recovery, help/docs).
- **AI-slop detection**: Story X.Y / AC-N / Step-N / FR-N markers in headers
  AND inline comments AND method bodies; cross-file refs like
  `useSeverityBanner (Story 4.8)`; narrative rationale blocks (5+ lines
  that restate the code); first-person plural ("we use", "let's");
  oversized JSDoc (>10 lines on .tsx, >15 on index.css).

Findings scored P1 (must-fix) and P2 (style trim).

## Per-file findings

### `KanbanBoard.tsx` (295 LOC) — was "converged"

Header (lines 1–7, 7 lines) is acceptable. **Markers hide inside the body.**

- **P1** Drop `Story 4.4 — clicking a card navigates to the read-only
detail page at /incidents/:id. The detail page handles…` (lines
  122–125). The `navigate = useNavigate()` line below it is the contract;
  the comment is a 4-line narrative.
- **P1** Drop `Story 4.12 — the role + userId drive the render-time Tech
filter and the empty-state branch…` (lines 127–130). Narrative restates
  the two hook calls below it.
- **P1** Drop the 12-line narrative block on lines 147–159 about
  render-time vs query-time filtering. The `useMemo` immediately below
  carries the contract. **Cross-file ref `useSeverityBanner (Story 4.8)`
  is the worst offence** — it leaks a sibling spec id into the Kanban
  comment.
- **P1** Drop the 5-line rationale `Project incidents into columns...`
  - `AC:` Gherkin quote (lines 167–177). The `useMemo` above is the
    contract. Gherkin in code comments is a slop marker.
- **P1** Drop `Story 6.11 — thread the role so the back-link picks the
role-aware destination.` (lines 184–185). Inline comment that restates
  what the line `<RbacDenied viewerRole={role} />` does.
- **P1** Drop the 11-line narrative `Story 4.12 — Tech-specific empty
state. UX-DR-14 mandates…` (lines 217–228). Restates the `isTechEmpty`
  ternary below.
- **P1** Drop the 4-line `Story 4.12 — Tech-empty-state branch`
  (lines 201–207). Same.
- **P1** Drop the `// The React key is the incident id…` rationale
  (lines 276–279). Three-line "why key" comment is a tell — JSX
  semantics are well-known.
- **P1** Drop the trailing header `applyStateChangeToCache and
IncidentStateChangedEvent are imported directly from…` (lines 292–295).
  Pure provenance noise.

**Preserve**: 4 columns `OPEN_CRITICAL`/`OPEN_WARNING`/`ACKNOWLEDGED`/
`RESOLVED`; render-time Tech filter on `assignee_user_id === currentUserId`;
4 verbs gated by RBAC; `navigate(`/incidents/${id}`)`; per-column empty
state; `groupByColumn` pure helper.

**Nielsen heuristics**:

- H3 (user control): ✓ filters by role at render, not cache.
- H6 (recognition over recall): ✓ column headlines are stable.
- H8 (aesthetic/minimalist): FAIL — 60+ lines of narrative out of 295.

### `IncidentDetailPage.tsx` (388 LOC) — was "converged"

Header (lines 1–9, 9 lines) is acceptable. One residual marker in a
method body.

- **P1** Drop `Story 6.11 — thread the role so the back-link picks the
role-aware destination.` (lines 198–199). One comment in dispatch
  duplicates what the `<RbacDenied viewerRole={viewerRole} />` line
  below it shows.
- **P2** Drop the orphan trailing line `// rather than the classifier's
generic "Try again" copy.` (line 106). It hangs off the preceding
  comment about RBAC failures; the preceding copy is also narrative
  and should be trimmed.
- **P2** Trim the `// CSV export lives on the page...` 4-line block
  (lines 84–86). The variable name plus call site carry the
  contract; the rest is rationale.

**Preserve**: 4 wired callbacks through `useDetailActionHandlers`; the
`useIncidentTransitionMutation`-derived per-verb hooks (ack / assign /
submit / reopen); the page-local toast queue; `useIncidentDetailSocket`
subscription; the dispatch tree (loading / error / forbidden / not-found
/ body); `RbacDenied viewerRole={viewerRole}`; `RbacRoute` wrap is
upstream of this file but `viewerRole` is threaded to it.

**Nielsen heuristics**:

- H1 (visibility): ✓ data-testid surface covers loading / 404 / 403 / 500 / success.
- H5 (error prevention): ✓ RBAC denied vs not-found vs generic-error are
  three distinct surfaces so the user doesn't conflate permanent denial
  with transient failure.
- H9 (error recovery): ✓ retry invalidates the row query.

### `LoginShell.tsx` (190 LOC) — was "converged"

- **P1** Drop `Story 1.3 split-screen login form` from the file header
  (line 2). The two-sentence layout note below it is fine.
- **P1** Drop the 5-line JSDoc on `FieldError` (lines 34–40). The
  discriminated-union signature is the contract; the comment
  ("dual-shape keeps the email error inside the `FormField`…") is a
  description of the type system to someone who already knows it.
- **P2** Trim the 8-line hero `aside` comments `{/* Hero panel… */}` /
  `{/* Form panel… */}` — the JSX structure shows what the panels are.
  Single-word comments like `/* Hero panel */` are tolerable; the
  current multi-line versions are not.

**Preserve**: split-screen layout (hero `lg:flex` + form `flex-1`);
`onSubmit` prop signature returns `Promise<void>`; `FormField` /
`FormTextInput` usage; inline `<p data-testid="login-submit-error"
role="alert">` for 401; breakpoint detection via `matchMedia`; submit
button disables during `submitting`; the `Idempotency-Key` is **NOT**
included (login is `skipAuth: true` upstream); `LoginResponse` zod
schema validation lives in `login.ts`, not here.

**Nielsen heuristics**:

- H4 (consistency): ✓ uses `FormField` to stay aligned with other forms.
- H5 (error prevention): ✓ inline email-format check before POST.
- H9 (error recovery): ✓ per-field errors + role=alert for screen readers.

### `index.css` (217 LOC) — never refined

This file is 60% prose comments. The CSS rules are the contract; the
prose is mostly Story/AC/DESIGN.md citations.

- **P1** Drop the 21-line header (lines 1–21). Every line cites
  `Story 1.2a ACs live next to each block` or `DESIGN.md §…`. The CSS
  is the source of truth; the prose is provenance noise.
- **P1** Drop `Story 1.2a AC2 is satisfied…` (lines 100–102). The single
  bad offender — restates what the `.status-pill` class does.
- **P1** Drop `Story 1.2a AC3` from the MetricCard comment (line 128).
- **P1** Trim the 6-line WCAG touch-target block (lines 78–83) to a
  one-liner (the rule already enforces the contract).
- **P1** Trim the 6-line StatusPill comment (lines 94–102) once the
  AC2 marker is dropped. Two short sentences stay; the DESIGN.md
  citations go.
- **P2** Trim the 4-line `Live update pulse` / `Critical pulse` /
  `Pin pulse` comments to one-liners. Disable-under-reduced-motion is
  repeated 4×; once in the `@media` block is enough.
- **P2** Drop the 3-line `Honour prefers-reduced-motion across every
pulse (DESIGN.md §…)` block (lines 205–206) — the `@media` rule
  below is the contract.

**Preserve (load-bearing invariants)**:

- 6 severity colours `#e8f6ee` / `#fff3da` / `#fee2e2` / `#f1f5f9` /
  matching text hexes, plus the `[data-theme="dark"]`-equivalent
  `@media (prefers-color-scheme: dark)` overrides — DO NOT change a
  single hex value.
- 4 role colour tokens aren't literal hex tokens but role borders live
  via `border-primary`, `border-severity-critical-value` etc. Tailwind
  config — don't touch.
- `@media (prefers-reduced-motion: reduce) { … animation: none; … }`
  applied to all three `.animate-*-pulse` classes.
- `:focus-visible` rule (delegated to Tailwind reset, but the explicit
  `.rbac-denied-back:focus-visible` block at lines 142–146 must stay).

**Nielsen heuristics**:

- H1 (visibility): ✓ severity tokens + dark-mode lift + reduced-motion
  respect.
- H8 (aesthetic/minimalist): FAIL — 100+ lines of prose out of 217.

## Summary

Total refinements:

- 11 P1 drops across 4 files
- 5 P2 trims across 3 files
- 0 load-bearing changes

Files previously marked "converged": **3** (KanbanBoard, IncidentDetailPage,
LoginShell) — all three had residual markers hiding in method bodies or
shorter headers. The pattern is consistent: the prior pass trimmed file
headers but did a surface scan of body comments.

## Files NOT modified in scope

- `useIncidentTransitionMutation.ts`, `useThresholds.ts`,
  `ThresholdsPage.tsx` — pre-existing tsc errors per commits `b4111cd`
  / `85a711f`. Out of scope per the task brief.

## Verification commands

```bash
npx --prefix packages/web tsc -b packages/web 2>&1 | tail -10
npx --prefix packages/web eslint packages/web/src/incidents/KanbanBoard.tsx packages/web/src/incidents/IncidentDetailPage.tsx packages/web/src/auth/LoginShell.tsx
cd packages/web && npx vitest run src/incidents src/auth 2>&1 | tail -10
node scripts/lint-prose.mjs
```
