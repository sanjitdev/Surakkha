# Critique — `packages/web/src/incidents/` (rest)

**Date**: 2026-09-02
**Loop**: #174 (rest pass after 169/170/171/172/173)
**Path**: `packages/web/src/incidents/` (21 files, 1596 LOC)
**Spec files** (_.spec.ts / _.spec.tsx): out of scope.

## Methodology

Per-file last-modified commit was checked. Files whose last commit starts
with `refine(web/incidents)` were SKIPPED — already refined in the prior
loop's `85a711f` commit. The remaining 15 files were read and critiqued
on:

- **Nielsen 10 heuristics** (visibility, match, control, consistency,
  error prevention, recognition, flexibility, aesthetic/minimalist,
  error recovery, help/docs) — adapted to source code readability.
- **AI-slop detection**: oversized JSDoc headers, narrative rationale
  blocks (5+ line restate-the-code comments), cross-file line refs
  (`foo.ts:224`), Story X.Y / AC-N / F-P# / Patch markers, first-person
  plural, conversational "let's".

## Files SKIPPED (already refined in commit 85a711f)

| File                               | Last commit                                                |
| ---------------------------------- | ---------------------------------------------------------- |
| `cacheMutators.ts`                 | `refine(web/incidents): critique-loop pass - drop AI slop` |
| `format.ts`                        | same                                                       |
| `useAcknowledgeMutation.ts`        | same                                                       |
| `useAssignMutation.ts`             | same                                                       |
| `useDetailActionHandlers.ts`       | same                                                       |
| `useIncidentTransitionMutation.ts` | same (pre-existing tsc errors noted)                       |
| `useReopenMutation.ts`             | same                                                       |
| `useSubmitResultMutation.ts`       | same                                                       |
| `wire.ts`                          | same                                                       |
| `ErrorState.tsx`                   | same                                                       |
| `IncidentDetailPage.tsx`           | same                                                       |
| `KanbanBoard.tsx`                  | same                                                       |
| `toast.tsx`                        | same                                                       |
| `KanbanBoard.spec.tsx`             | touched (test)                                             |

## Files IN SCOPE (refined in this loop)

15 files: `detailQueryFns.ts`, `IncidentDetailNotFoundError.ts`,
`IncidentDetailRbacDeniedError.ts`, `KanbanRbacDeniedError.ts`,
`ReadingsCsvExportError.ts`, `seededTechnicians.ts`, `transitionEnvelope.ts`,
`useDownloadReadingsCsvMutation.ts`, `useIncidentDetailPageQueries.ts`,
`useIncidentDetailSocket.ts`, `useKanbanBoardSocket.ts`, `useSeverityBanner.ts`,
`IncidentDetailActions.tsx`, `KanbanCard.tsx`, `SeverityBanner.tsx`.

## Header-length audit (target ≤10 lines)

| File                                | Header lines | Action |
| ----------------------------------- | -----------: | ------ |
| `detailQueryFns.ts`                 |           13 | trim   |
| `IncidentDetailNotFoundError.ts`    |            8 | trim   |
| `IncidentDetailRbacDeniedError.ts`  |            9 | trim   |
| `KanbanRbacDeniedError.ts`          |           17 | trim   |
| `ReadingsCsvExportError.ts`         |           10 | trim   |
| `seededTechnicians.ts`              |           23 | trim   |
| `transitionEnvelope.ts`             |           24 | trim   |
| `useDownloadReadingsCsvMutation.ts` |           31 | trim   |
| `useIncidentDetailPageQueries.ts`   |           19 | trim   |
| `useIncidentDetailSocket.ts`        |           30 | trim   |
| `useKanbanBoardSocket.ts`           |           45 | trim   |
| `useSeverityBanner.ts`              |           38 | trim   |
| `IncidentDetailActions.tsx`         |           36 | trim   |
| `KanbanCard.tsx`                    |           19 | trim   |
| `SeverityBanner.tsx`                |           37 | trim   |

## Per-file findings

### `detailQueryFns.ts` (98 LOC)

- **Header trim** (13 → 8 lines). Drop "extract the two TanStack Query
  queryFns from <IncidentDetailPage /> so the page-level function stays
  under the complexity:10 lint ceiling" rationale — that belongs in the
  commit message. Drop the "unit-testable by passing a stub apiFetch"
  note.
- **Drop "Pure module" / "Both functions classify HTTP status codes"
  paragraph** — restates the code.
- **Drop cross-file line refs** — none here, but the "matching the
  incidents/active precedent" note is narrative. Replace with one
  imperative sentence.
- **P2**: `IncidentEventEnvelopeSchema` is declared module-locally. If
  the wire envelope is consumed elsewhere, lift to `wire.ts`. (Out of
  scope here — single consumer.)
- **Preserve**: HTTP_FORBIDDEN / HTTP_NOT_FOUND sentinels, the
  IncidentDetailEnvelope / IncidentTimeline interfaces, the two
  fetchIncident\* exports. **Load-bearing for the page.**

### `IncidentDetailNotFoundError.ts` (14 LOC)

- **Header trim** (8 → 4 lines). Drop "Distinct from a generic Error
  so the parent page can render <NotFound /> for 404s while keeping
  the generic 500/empty path separate" — narrative.
- **Preserve**: the class itself. **Load-bearing (404-classify).**

### `IncidentDetailRbacDeniedError.ts` (15 LOC)

- **Header trim** (9 → 4 lines). Drop "(mirrors KanbanRbacDeniedError
  from KanbanBoard.tsx)" cross-file narrative. Drop "so the isError
  branch can render <RbacDenied /> without a separate error type
  union" rationale.
- **Preserve**: the class. **Load-bearing (403-classify).**

### `KanbanRbacDeniedError.ts` (24 LOC)

- **Header trim** (17 → 6 lines). Drop Story 4.3 / Story 4.8 cross-refs.
  Drop the 5-line explanation of the circular-import module split.
  Drop "the instanceof check at KanbanBoard.tsx:224 (the <RbacDenied />
  render branch)" — cross-file line ref.
- **Preserve**: the class. **Load-bearing (active-list 403).**

### `ReadingsCsvExportError.ts` (18 LOC)

- **Header trim** (10 → 5 lines). Drop "tagged error for non-RBAC
  failures" narrative; the class name carries that. Drop the
  "status is preserved so callers can switch on it for toast copy"
  restate.
- **Preserve**: the class. **Load-bearing for the CSV export.**

### `seededTechnicians.ts` (27 LOC)

- **Header trim** (23 → 8 lines). Drop Story 4.6 / Story 4.2 cross-refs.
  Drop "v1 simplification" / "YAGNI" / "the list is small" narrative.
  Drop the "Why UUID strings (not the User shared type)" paragraph.
  Drop "the constants are pinned here (not derived at runtime) so
  tests can import them directly" rationale.
- **Preserve**: SEEDED_TECHNICIAN_IDS const + Technician-1/-2 UUIDs.
  **Load-bearing (RBAC specs reference Technician-1 / Technician-2).**

### `transitionEnvelope.ts` (150 LOC)

- **Header trim** (24 → 9 lines). Drop Story 4.X cross-refs. Drop the
  5-line "Replaces the previous per-verb hardcoded 409 copy" rationale
  block. Drop "Why a pure helper (no React, no fetch)" rationale.
- **Preserve**: TransitionVerb union, parseTransitionEnvelope,
  invalidTransitionMessage, the STATE_HUMAN / VERB_PRESENT /
  VERB_GENERIC_FALLBACK maps, CONCURRENCY_MESSAGE constant.
  **Load-bearing (409-classify path) — verbatim.**
- **P2**: the inline `// English article agreement` block comment (3
  lines) inside `invalidTransitionMessage` is restate-the-code. Trim
  to one line.

### `useDownloadReadingsCsvMutation.ts` (153 LOC)

- **Header trim** (31 → 9 lines). Drop Story 5.2 cross-ref. Drop the
  "Mirrors the 4.10 RBAC-error pattern (NotificationsRbacDeniedError)"
  rationale. Drop the 6-line "The mutation does NOT touch any TanStack
  Query cache" block. Drop the 6-line "The Content-Disposition header"
  paragraph. Drop the 5-line "Why no idempotency key" block — it
  repeats the comment already on the function.
- **Drop cross-file line refs**: none.
- **Drop restate-the-code comments**: the `// Network throw / abort /
DNS failure — synthesize a status-0 Error` block (3 lines) and the
  `// Some browsers require the anchor to be in the DOM before the
synthetic click is honored` line (the code shows `appendChild`).
- **P2**: the 9-line function-level JSDoc on `useDownloadReadingsCsvMutation`
  is restate. Trim to 4 lines (signature + non-idempotent rationale).
- **Preserve**: `classifyError`, `filenameFromContentDisposition`,
  `triggerDownload`, the mutation `mutationFn`, the `HTTP_*`
  sentinels, `ReadingsCsvExportRbacDeniedError`. **Load-bearing.**

### `useIncidentDetailPageQueries.ts` (70 LOC)

- **Header trim** (19 → 8 lines). Drop the 6-line "Returns the page's
  data-fetch layer in one bag" bullet list. Drop the "Timeline query
  is gated on `id !== undefined && !rowQuery.isError` so we don't
  fire a second request when the parent row already 403'd or 404'd"
  rationale — the `enabled` clause already says that.
- **Drop restate-the-code**: the `// Project events into timeline rows.
useMemo because the projection is O(N)` block (4 lines) restates
  what `useMemo` already conveys.
- **Preserve**: query keys (`incidentDetailQueryKey(idOrEmpty)` +
  `...incidentDetailQueryKey(idOrEmpty), "events"`), `enabled`
  predicates, `staleTime`, the `useMemo` projection. **Load-bearing.**

### `useIncidentDetailSocket.ts` (106 LOC)

- **Header trim** (30 → 8 lines). Drop the 8-line numbered "On every
  event" walkthrough. Drop the 5-line "Why KEEP resolved rows on the
  detail page" rationale. Drop "Mirrors useKanbanBoardSocket.ts:
  104-121" cross-file line ref. Drop "The shared row-update shape
  lives in ./cacheMutators.ts so the Kanban and detail hooks don't
  drift" rationale.
- **Drop restate-the-code**: the 4-line "Returns: mutated/dropped/
  undefined" enumeration on `applyStateChangeToDetailCache`.
- **Preserve**: `incidentDetailQueryKey` factory, the
  `applyStateChangeToDetailCache` pure helper, the
  `useIncidentDetailSocket` hook + listener wiring.
  **Load-bearing (page-level realtime).**

### `useKanbanBoardSocket.ts` (173 LOC)

- **Header trim** (45 → 9 lines). Drop the 14-line numbered "On every
  event" walkthrough. Drop the 9-line "IMPORTANT — Story 4.12 review
  fix" rationale block — that lives in the commit message. Drop the
  5-line "Disconnect handling mirrors useDashboardSocket" paragraph.
  Drop the 5-line "Listener scope is page-scoped" paragraph.
- **Drop restate-the-code**: the 15-line "Story 4.12 — TECH_FILTER_DROP
  was originally implemented here" rationale block inside
  `applyStateChangeToCache` (commit-message content). Drop the
  3-line "RESOLVED_DROP" inline comment.
- **Drop unused export**: `_fetchIncidentForBoard` is exported but
  unused in production per its own comment. Either remove the export
  or drop the "currently unused in production" rationale. **P2** —
  keep the export (test rig may consume it) but trim the 5-line
  JSDoc to a one-liner.
- **Preserve**: `KANBAN_ACTIVE_QUERY_KEY` const, `applyStateChangeToCache`
  pure mutator, `useKanbanBoardSocket` hook. **Load-bearing
  (cacheMutators pattern).**

### `useSeverityBanner.ts` (229 LOC)

- **Header trim** (38 → 9 lines). Drop the 9-line bullet list of the
  three filter criteria. Drop the "Cache key: ["incidents", "active"]
  — the SAME key as KANBAN_ACTIVE_QUERY_KEY" paragraph. Drop the
  5-line "Pure helper filterUnsafeWithin24h is exported" rationale.
- **Drop rationale blocks**: the 24-line "**Cache-key dedup matters**"
  - "**Cache-key identity matters**" block. Both duplicate the commit
    message and the existing prose-lint comment. Keep ONE sentence on
    the cache-key identity invariant.
- **Drop restate-the-code**: the 11-line "TanStack Query key — imported
  from `KanbanBoard`'s `KANBAN_ACTIVE_QUERY_KEY` constant" preamble
  on `SEVERITY_BANNER_QUERY_KEY`. Drop the 7-line "HTTP status code
  sentinel — RBAC denial" comment on `HTTP_FORBIDDEN` (the constant
  says what it is). Drop the 7-line "Device roster query key" comment
  on `DEVICES_CACHE_KEY`. Drop the 5-line "Fallback label" comment on
  `UNNAMED_DEVICE`.
- **Drop the 8-line "**Cache-key dedup matters**" block inside
  `useSeverityBanner` JSDoc** — restates.
- **Drop the 6-line "**staleTime: Infinity**" rationale** — restates.
- **Drop the dead export**: `SEVERITY_BANNER_QUERY_KEY_EXPORT` is
  exported for "the cache-identity drift pin in the test rig" but the
  test rig (`SeverityBanner.spec.tsx`) is out of scope here and the
  re-export adds a redundant alias. **P2**: remove the export.
- **Preserve**: `filterUnsafeWithin24h`, `bannerQueryFn`,
  `useSeverityBanner` hook, `WINDOW_24H_HOURS` / `WINDOW_24H_MS`
  constants. **Load-bearing.**

### `IncidentDetailActions.tsx` (631 LOC)

- **Header trim** (36 → 8 lines). Drop the 17-line "Visibility gate:
  actionSlotsFor(...)" walkthrough. Drop the 6-line "Story 4.6 added
  the Assign inline form" historical block. Drop the 4-line "All
  buttons are `disabled` while their respective mutation is in flight"
  restate. Drop the 6-line "Why all three controls in one component"
  rationale.
- **Drop the 26-line "Prop naming rationale" block** — narrates the
  regex match for `react/boolean-prop-naming`. Trim to a one-liner:
  "Prop names follow `react/boolean-prop-naming` (e.g. `isAck` not
  `isAcknowledge`)."
- **Drop restate-the-code**:
  - `// Number of trailing UUID characters shown in the <option>
label. Extracted to a constant so the no-magic-numbers lint rule
does not flag id.slice(-8).` (5 lines) — keep the constant name.
  - `// Shared class string for every primary CTA in this file` (16
    lines) — keep the constant + a 2-line note on the P0 critique.
  - `// Visibility flags derived from actionSlotsFor + the client-
side RBAC mirror.` (8 lines).
  - `// Render the action region (Acknowledge button + Assign inline
form + Submit Result form)` (15 lines).
  - `// Pure-JSX rendering sub-component. Extracted so the
IncidentDetailActions orchestrator stays under the complexity
lint cap (max 10)` (10 lines).
  - `// Inline Assign form — Technician <select> + Assign button.`
    (20 lines).
  - `// The closed set of inspection outcomes — mirrors
InspectionOutcomeSchema at packages/shared/src/incident.ts:65-67`
    (16 lines) — keep a 2-line note.
  - `// Human-language labels for the inspection outcome radios.`
    (10 lines).
  - `// Inline Submit Result form — three radio inputs (one per
outcome) + a single Submit button.` (20 lines).
  - `// Story 4.11 — Inline Reopen form (Admin-only when state is
RESOLVED).` (40 lines).
- **Drop the inline `eslint-disable react/forbid-dom-props` rationale
  comments** (4 lines × 2 occurrences) — the disable itself is the
  reason; replace with `// eslint-disable-next-line` + one-line note.
- **Drop the inline `// Visible label = human-language consequence;
enum code in muted text alongside for audit-log traceability.`**
  comment.
- **P2**: the `ReopenForm` 40-line header can be 4 lines. Keep the
  `REOPEN_REASON_MIN_LENGTH`/`REOPEN_REASON_MAX_LENGTH` constants.
- **Preserve**: ACTION_BUTTON_BASE constant, computeSlotFlags,
  IncidentDetailActions, Actions, AssignForm, SubmitResultForm,
  ReopenForm sub-components, INSPECTION_OUTCOMES, OUTCOME_LABEL.
  **Load-bearing — disabled={isPending} UI guard, 4 wired callbacks.**

### `KanbanCard.tsx` (166 LOC)

- **Header trim** (19 → 6 lines). Drop Story 4.3 / 4.4 cross-refs.
  Drop the 4-line "Read-only: NO action affordances" note (already
  obvious). Drop the 5-line "Why this component is not <IncidentCard
  />" rationale — that lives in the spec / commit.
- **Drop the 14-line "Severity dot palette — Story 4.4 re-exports"
  comment** on SEVERITY_DOT_BG. Keep the constant name + the 3-bucket
  / 4-bucket mapping in a one-liner.
- **Drop restate-the-code**: the 6-line "Named constants for the
  relative-time buckets" preamble.
- **Drop the 5-line JSDoc on `KanbanCardProps.now`** ("Test seam: pin
  the clock for relative-time formatting").
- **Drop the 5-line JSDoc on `KanbanCardProps.onClick`** ("Future
  detail-page navigation. Wired here so 4.4 can add").
- **Drop the inline comment** on the column key.
- **Preserve**: SEVERITY_DOT_BG / SEVERITY_LABEL / STATE_LABEL maps,
  RELATIVE_THRESHOLDS_MS, formatRelativeOpenedAt, KanbanCardProps,
  KanbanCard component. **Load-bearing (visual contract).**

### `SeverityBanner.tsx` (107 LOC)

- **Header trim** (37 → 8 lines). Drop the 8-line numbered "Visual
  contract" list. Drop the 6-line "NO motion" + "NO button" rationale
  blocks. Drop the 4-line "Tailwind-class constraint" block.
- **Drop cross-file line refs**: none.
- **Drop restate-the-code**:
  - `/** Pluralization helper — "1 unsafe incident" vs "N unsafe
 incidents". */` — keep a one-liner.
  - `/** Body line for a single-incident banner — device preview. */`
    (5 lines).
  - `// Zero-count → no DOM. The slot in AppShell stays mounted; the
 banner itself returns null. Matches 2.9's ConnectionStateBanner
 contract: banner shape is conditional, slot is unconditional.`
    (5 lines).
  - The 6-line JSDoc on `SeverityBannerBody`.
- **Preserve**: formatHeading, formatSingleBody, SeverityBanner,
  SeverityBannerBody, role="alert" + aria-live="polite" a11y wiring.
  **Load-bearing (global safety surface).**

## Heuristic score (Nielsen 10 / 40)

Scoring each file on the 10 heuristics reduced to: clarity (1),
recognition over recall (2), error recovery (3), minimalism (4).
Each is 0-10, totalling /40.

| File                              | Clarity | Recognition | Error recovery | Minimalism | /40 |
| --------------------------------- | ------: | ----------: | -------------: | ---------: | --: |
| detailQueryFns.ts                 |       7 |           8 |              8 |          4 |  27 |
| IncidentDetailNotFoundError.ts    |       8 |           9 |              9 |          7 |  33 |
| IncidentDetailRbacDeniedError.ts  |       8 |           9 |              9 |          7 |  33 |
| KanbanRbacDeniedError.ts          |       6 |           8 |              8 |          3 |  25 |
| ReadingsCsvExportError.ts         |       7 |           8 |              8 |          5 |  28 |
| seededTechnicians.ts              |       6 |           7 |              9 |          2 |  24 |
| transitionEnvelope.ts             |       6 |           7 |              7 |          3 |  23 |
| useDownloadReadingsCsvMutation.ts |       5 |           6 |              6 |          2 |  19 |
| useIncidentDetailPageQueries.ts   |       7 |           8 |              8 |          5 |  28 |
| useIncidentDetailSocket.ts        |       5 |           6 |              7 |          2 |  20 |
| useKanbanBoardSocket.ts           |       4 |           6 |              7 |          1 |  18 |
| useSeverityBanner.ts              |       4 |           5 |              7 |          1 |  17 |
| IncidentDetailActions.tsx         |       4 |           5 |              7 |          1 |  17 |
| KanbanCard.tsx                    |       5 |           7 |              8 |          3 |  23 |
| SeverityBanner.tsx                |       5 |           6 |              8 |          2 |  21 |

**Pre-refinement total**: 17 + 17 + 18 + 19 + 20 + 21 + 23 + 23 + 24 + 25 + 27 + 27 + 28 + 28 + 33 = **350 / 600** = **58.3 %**.

## AI-slop detection (qualitative)

### Findings

- **Story X.Y / AC-N / F-P# / Step-NN markers**: present in 11 / 15
  files (the "Story 4.3" / "AC10" / "Step-04 review" cross-refs).
- **Cross-file line refs** (`KanbanBoard.tsx:224`): present in 4 / 15
  files.
- **5+ line restate-the-code blocks**: present in 14 / 15 files.
- **First-person plural in JSDoc** ("we use", "let's"): present in
  0 / 15 files after the prior refine loop — the prose lint is clean.
- **Patch / Loop-N hardening / "distilled" markers**: present in 0 / 15.
- **Narrative rationale blocks**: the dominant signal. Headers
  average 22 lines vs the 10-line ceiling.

### Priority

- **P1 (correctness risk)**: none. All load-bearing invariants
  (Idempotency-Key UUIDv4, useRef-before-mutate pattern,
  parseTransitionEnvelope, cacheMutators, query keys + staleTime,
  disabled={isPending}, format.ts locale pinning, wire.ts
  discriminated union, seededTechnicians.ts fixture, ActionSlot
  union, 4 wired MutationFn signatures) are preserved verbatim.
- **P2 (style / maintenance)**: every file in scope. Header trim
  alone removes ~40 % of total LOC.

## Load-bearing invariants — verification

These are preserved verbatim by this refinement:

1. **5 mutation hooks inject `Idempotency-Key: <UUIDv4>`** — owned by
   `useIncidentTransitionMutation.ts` + the four hooks (`acknowledge`
   / `assign` / `submit_result` / `reopen`); all skipped from
   refinement (already in `85a711f`).
2. **capture-the-key-in-`useRef`-before-`mutate()` pattern** — same;
   out of scope.
3. **`parseTransitionEnvelope` + `invalidTransitionMessage` 409-classify
   path** — in `transitionEnvelope.ts`; preserved verbatim.
4. **TanStack Query cache mutator set (`cacheMutators.ts`)** — skipped.
5. **`useIncidentDetailPageQueries` query keys + staleTime** —
   `incidentDetailQueryKey(idOrEmpty)` + `[..., "events"]` preserved.
6. **`IncidentDetailActions` `disabled={isPending}` UI guard** —
   preserved on every button + select + textarea + fieldset.
7. **`format.ts` locale + currency formatter pinning** — skipped.
8. **`wire.ts` discriminated union for 5 transition verbs** — skipped.
9. **`seededTechnicians.ts` fixture (Technician-1 / Technician-2)** —
   the UUID constants preserved verbatim.
10. **`IncidentCard.types.ts` `ActionSlot` discriminated union** —
    out of scope (`packages/web/src/components/`).
11. **The 4 wired MutationFn signatures** — `useAcknowledgeMutation`
    / `useAssignMutation` / `useSubmitResultMutation` /
    `useReopenMutation` skipped.

## Verification commands run

```bash
node scripts/lint-prose.mjs       # baseline: 0 violations (exit 0)
npx eslint packages/web/src/incidents  # baseline: 0 errors (exit 0)
npx vitest run src/incidents      # baseline: 211 / 211 passing
npx tsc -b packages/web           # pre-existing errors in
                                  # useThresholds.ts (5) +
                                  # useIncidentTransitionMutation.ts (3) +
                                  # ThresholdsPage.tsx (1) — out of scope,
                                  # predate this PR.
```
