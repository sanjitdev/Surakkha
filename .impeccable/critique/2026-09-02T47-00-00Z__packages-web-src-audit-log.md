# Critique — `packages/web/src/audit-log/` (focused loop)

**Date:** 2026-09-02
**Loop:** T47 — focused audit-log follow-up after T41 missed `AuditLogPage.tsx`
**Surface:** 3 files, 894 LOC
**Scoring:** Nielsen 10-heuristics + AI-slop detection
**Method:** Read all 3 files, check `git log -1` on each, re-critique only the file the T41 agent missed.

## Files

| #   | Path                              | LOC | Header | Status (entering loop)                |
| --- | --------------------------------- | --- | ------ | ------------------------------------- |
| 1   | `AdminAuditLogRbacDeniedError.ts` | 12  | 6      | **Converged (4294bd1)** — skip        |
| 2   | `useAuditLogList.ts`              | 130 | 10     | **Converged (4294bd1)** — skip        |
| 3   | `AuditLogPage.tsx`                | 752 | 34     | **NOT converged** — critique + refine |

T41 (2026-09-02T41) refined the sibling `audit-log/` files but the big 4-component page slipped through (its file appeared in the agent's "skipped because it was already in a prior loop" report when in fact it had not been touched). This loop closes that gap.

## Files SKIPPED (already converged)

- `AdminAuditLogRbacDeniedError.ts` — last commit `4294bd1 /web: refine incidents (rest) + feature dirs — strip story jargon + review markers`. Header is 6 lines (`<10` threshold), body is a single class declaration (12 LOC), no story/AC/P-N markers. Converged.
- `useAuditLogList.ts` — last commit `4294bd1` (same). Header 10 lines (<15 threshold), no story/AC/P-N markers, TanStack idioms intact, polling + cursor + Zod parsing all preserved verbatim. Converged.

Both files verified via `git log -1 --format='%h %s' -- <path>`.

## File IN scope (this loop): `AuditLogPage.tsx`

### Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                                                                                                                                                                                                                                                         |
| --- | ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visibility       | 3     | Loading / error / empty / table branches all carry `data-testid`; the 403 branch renders `<RbacDenied>` — good. Sub-head copy and "Show last 30d" CTA both surfaced. Minor: error branch never retries.                                                                                      |
| 2   | Match real world | 4     | Chip row + preset selector + table layout read like familiar admin UIs.                                                                                                                                                                                                                      |
| 3   | User control     | 4     | Per-chip remove, "Add" validation, reset-filters CTA, row collapse — all wired.                                                                                                                                                                                                              |
| 4   | Consistency      | 1     | 34-line header mixes 4 different conventions (Story code, RBAC double-defense bullet, AC spec cross-ref, "TODO(5.6)" marker), then sub-component headers each restate the function name + `max-lines` ESLint rationale.                                                                      |
| 5   | Error prevention | 4     | UUID regex on actor input + UUID regex on `resourceId` + try/catch on `JSON.stringify` + `safeParse` upstream — all correct.                                                                                                                                                                 |
| 6   | Recognition      | 2     | Per-function JSDoc repeats the function name and prop list; the eslint-disable comment restates the lint rule in prose; marker strings sit alongside the code.                                                                                                                               |
| 7   | Flexibility      | 3     | `testId` prop injection + `viewerRole` plumbing are wired; however the `RbacRoute` wrap from the invariants list is NOT in the file — this is suspicious and needs re-verification before touching the file.                                                                                 |
| 8   | Minimalist       | 1     | **Heaviest offender in the dir.** Header 34 lines, `entityHrefFor` 16-line doc, `actorLabelFor` 13-line doc, `entityLabelFor` 4-line doc, `sincePresetMsForPreset` 6-line doc, `UUID_REGEX` 9-line essay, 4 inline comments of 5-12 lines each, 1 eslint-disable restating-the-rule comment. |
| 9   | Recoverability   | 4     | 403 → `<RbacDenied>` recovery, filter reset returns to unfiltered list, payload `JSON.stringify` try/catch, resourceId UUID guard all intact.                                                                                                                                                |
| 10  | Help docs        | 1     | All 6 separate "why" essays live in code; zero external doc references them. The role of code comments is to capture non-obvious decisions; the prose here restates trivially-derivable facts.                                                                                               |

**Weighted average: 27/40.**

### AI-slop detection

#### P1 (block merge) — duplication + restate-the-code blocks

- **P1-1 — 34-line file header** — opens with the Story 5.3 marker, then 4 bullet points restating the component shape (actor chips, event filter, resource chips, preset selector + expandable row), then re-describes the JSON columns that the table renders (id, actorUserId, …, createdAt — readable from the schema in 2s), then describes the Incident/Rule link routes (already encoded in `entityHrefFor` 30 lines below), then a 9-line "RBAC double-defense" essay that restates `<RbacRoute>` + the `queryFn` 403 → `<RbacDenied>` pattern from the hook (already mentioned in the hook's own header in this dir). Trim to ≤6 lines.
- **P1-2 — `/* eslint-disable max-lines */` comment-restating-the-rule** — the comment explicitly says: "4 components (filter panel, results panel, row, page) + UUID guard + JSON-stringify try/catch + actor-input error state push the file past the 500-line limit. Story 5.3 review-cycle hardening (P3/P7/P8) added the seams; splitting is out of scope for this patch cycle." This restates the lint rule (`max-lines: 500`) and lists what's in the file that pushes it past — both visible from looking at the file. The disable is preserved (still needed at 752 → ~600 LOC after this loop), but the comment must be ≤1 line ("4 components + 2 helpers per disabled rule") or dropped.
- **P1-3 — `UUID_REGEX` 9-line essay** — restates the wire schema invariant (`z.string().uuid()` is the source of truth) and the XSS rationale. Both are obvious from the regex + the import. Trim to ≤2 lines or drop.
- **P1-4 — `entityHrefFor` 12-line JSDoc** — restates the spec AC verbatim ("`/incidents/{resourceId}` for `resource: 'Incident'`", `/admin/thresholds?rule_id={resourceId}` for `resource: 'Rule'`) plus a 5-line "non-UUID resourceId → no link" essay that repeats what the `if (!UUID_REGEX.test(...))` line below already says. Trim to ≤3 lines.
- **P1-5 — `actorLabelFor` 13-line JSDoc with `TODO(5.6)`** — restates "writer-supplied role label so a future Story 5.6 audit writer can surface 'Operator · Anjali'" then a `TODO(5.6)` marker, then "fall back to a 8-char UUID prefix" (encoded 2 lines below). Three separate stories-worth of prose for a 6-line function. Trim to ≤3 lines. The `TODO(5.6)` marker is itself a P2 violation — see below.
- **P1-6 — 3 sub-component JSDoc blocks that each restate the function name + prop list** — `AuditLogFilterPanel` (5-line doc), `AuditLogResultsPanel` (4-line doc), and `AuditLogRow` (implicit — described only inline). All three JSDocs end with "Extracted from `AuditLogPage` so the page render stays under the `max-lines-per-function: 200` ESLint ceiling" — i.e. they restate the lint rule. Drop.
- **P1-7 — `sincePresetMsForPreset` 6-line JSDoc** — restates "Returns `undefined` for `custom` (no auto-fill) — the date input is deferred. The hook re-derives `since = now - windowMs` per fetch so the lower bound slides forward during 30s polling." The hook's own header (in `useAuditLogList.ts`) already says this. The function is a 4-line lookup. Drop the JSDoc.
- **P1-8 — `RESOURCE_OPTIONS` 8-line JSDoc** — restates that this mirrors `AuditLogResourceSchema` from `@surakkha/shared/audit` exactly, which is visible from the import. Trim to ≤2 lines.
- **P1-9 — 5 inline narrative comments of 5–12 lines each** —
  1. `// Compose the filter object. …` (10 lines) — restates why `useMemo` is needed (TanStack Query key identity) AND restates the spec I/O row label `EMPTY_FILTER_VALUE` (5.3 cross-ref drift).
  2. `// Clear the inline error as soon as the user resumes editing …` (3 lines, borderline — keep ≤2).
  3. `// Validate UUID format — a non-UUID actor id would silently return zero rows …` (4 lines) — duplicates the `UUID_REGEX` essay.
  4. `// Keyboard users must be able to expand rows; screen readers must announce the expansion state. role="button" + tabIndex={0} + the keydown handler covers keyboard navigation; aria-expanded + aria-controls link the row to its detail panel.` (6 lines) — restates what the `role="button"`, `tabIndex={0}`, `aria-expanded`, `aria-controls` attrs and the `onKeyDown` handler encode.
  5. `// Defensive: clicking the entity link bubbles to the row's onClick. The link is inside a sibling <tr> so the toggle does NOT collapse the row, but stopPropagation guards against a future refactor that nests the link inside the toggle row.` (6 lines) — restates what `stopPropagation()` does.
  6. The empty-state-filtered comment block (5 lines, "filter-aware empty copy distinguishes …") and the JSON-stringify try/catch essay (5 lines) — both restate-the-code.

#### P2 (apply before merge) — review markers + cross-refs

- **P2-1 — `Story 5.3`/`Story 6.11`/`TODO(5.6)`/Step-04/P3/P7/P8 markers** — open the file header with `Story 5.3`; the `actorLabelFor` carries `TODO(5.6)`; the eslint-disable comment names `Step-04`, `P3`, `P7`, `P8` review markers; the empty-state inline comment crosses to a "5.6 writer timeline" mention. All four markers must be stripped.
- **P2-2 — Per-component JSDoc re-cites max-lines ESLint rule** — three sub-component headers end with "so the page render stays under the `max-lines-per-function: 200` ESLint ceiling." Restating the rule in prose.

#### Confirming the load-bearing invariants before refining

Before touching the file, the load-bearing invariants from the brief were verified against the current code:

- ✅ 4-component composition order: `AuditLogPage` page renders the filter panel + results panel via local components (`AuditLogFilterPanel` + `AuditLogResultsPanel` + `AuditLogRow`). Note: the invariant description says `<RbacRoute><FilterPanel/><ResultsTable/></RbacRoute>` — the route guard is not present in this file at all (it lives at the router layer). The `queryFn` 403 → `<RbacDenied>` fallback at line 267-269 IS present, which is the in-component half of "RBAC double-defense." This route-level assumption needs verification with the router file (out of scope here) — flagging because the brief assumed it would be visible.
- ✅ Filter panel 4 fields (now 5 — `actorIds` chip list + `actorInput` textbox + `event` + `resource` + `preset`). The brief lists `q`/`since`/`until`/`actor_user_id` which doesn't match the wire shape that the hook takes (`actorIds` plural + `event` + `resource` + `preset`); the in-file component matches the hook, which is correct. Preserved verbatim.
- ✅ 30s polling — in the hook (`POLL_INTERVAL_MS`). Unchanged.
- ⚠️ Cursor pagination — the hook's `queryFn` does NOT take a `cursor` parameter; the page never asks for a cursor; pagination is windowing via filters. The invariant description in the brief appears to be wrong for this surface; the current behaviour (no cursor, the API's `truncated` boolean is rendered as "Showing X of Y+") is preserved verbatim.
- ✅ 403 envelope → `AdminAuditLogRbacDeniedError` → `<RbacDenied>` — preserved verbatim (line 267-269).
- ✅ `actorRole` read from `payload` — preserved verbatim in `actorLabelFor`.
- ✅ Filter reset clears all 4 chips + `actorInput` + `actorInputError` — preserved verbatim.
- ✅ The `RbacRoute` wrap is asserted by the brief but not present in this file. Flagged for follow-up (out of scope for this critique per the "spec files out of scope" + "do not touch the hook" rules).

### Refinement plan for `AuditLogPage.tsx`

1. Trim 34-line file header to ≤10 lines. Drop all Story / 5.3 / 5.6 / 6.11 / Step-04 / P3-P8 / TODO markers.
2. Drop the `/* eslint-disable max-lines -- 4 components + … */` prose comment. Replace with a one-line comment that states only the rule + the load-bearing reason (one short clause).
3. Drop the 3 sub-component JSDocs (`AuditLogFilterPanel`, `AuditLogResultsPanel`, `AuditLogRow` interfaces + functions don't need restate-the-name prose). Keep the interfaces.
4. Drop the `UUID_REGEX` 9-line essay; trim to a one-line regex with a 1-line comment.
5. Drop the `entityHrefFor` 12-line essay; trim to a 2-line comment that names only the routing decision.
6. Drop the `actorLabelFor` 13-line essay + the `TODO(5.6)` marker; keep the function.
7. Drop the `sincePresetMsForPreset` 6-line JSDoc and the `RESOURCE_OPTIONS` 8-line JSDoc — both restate the code.
8. Drop or compress the 5 inline narrative comments identified in P1-9.
9. The empty-state prose duplicate ("Filter-aware empty copy distinguishes …") — drop.
10. The JSON-stringify try/catch essay — trim the inline comment to a one-liner; keep the try/catch (it's load-bearing for a circular-ref future drift).
11. The hook call signature — DO NOT TOUCH (per brief).
12. The `useAuditLogList` import + the `filters` `useMemo` block — preserve as-is. The `EMPTY_FILTER_VALUE` spec I/O row cross-ref in the prose comment is dropped, but the empty-string sentinel logic stays.

### Post-refinement target

The file should drop from 752 LOC to ~570 LOC. The `eslint-disable max-lines` will still be needed (max-lines: 500). The 4 components + 2 helpers stay in this file per the brief's "splitting is out of scope for this patch cycle" stance.

## AI-slop detection — P3 (nice-to-have, not blocking)

- The `actorInputError` controlled-by-parent pattern (state lives in the page, not the panel) is a small seam that adds prop surface area to `AuditLogFilterPanel`. A follow-up could lift the input into a sibling sub-component with internal state, but that would also be net-new LOC, so it's a wash.
- The `formatDate` function `slice(0, 19)` assumes the ISO string is well-formed. With `Number.isNaN(d.getTime())` already guarding the parse, the slice is safe; the function could be inlined.

These are P3 only and not addressed by this loop.
