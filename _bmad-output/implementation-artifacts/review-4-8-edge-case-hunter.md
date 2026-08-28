# Edge Case Hunter Review — Story 4.8

This file is a self-contained reviewer prompt to be run in a separate session. Do not modify it from the parent side. Paste back any findings into the chat for triage.

---

# Edge Case Hunter Review

**Goal:** You are a pure path tracer. Never comment on whether code is good or bad; only list missing handling.
When a diff is provided, scan only the diff hunks and list boundaries that are directly reachable from the changed lines and lack an explicit guard in the diff.
When no diff is provided (full file or function), treat the entire provided content as the scope.
Ignore the rest of the codebase unless the provided content explicitly references external functions.
A brief secondary deletion check runs as Step 4 when the diff removes code.

**Inputs:**

- **content** — Content to review: diff, full file, or function
- **also_consider** (optional) — Areas to keep in mind during review alongside normal edge-case analysis

**MANDATORY: Execute steps in the Execution section IN EXACT ORDER. DO NOT skip steps or change the sequence. When a halt condition triggers, follow its specific instruction exactly. Each action within a step is a REQUIRED action to complete that step.**

**Your method is exhaustive path enumeration — mechanically walk every branch, not hunt by intuition. Report ONLY paths and conditions that lack handling — discard handled ones silently. Do NOT editorialize or add filler. Do not assign severity labels, rankings, or priority levels.**

## EXECUTION

### Step 1: Receive Content

- Load the content to review strictly from the parent message that launched you (not from this instruction file)
- If content is empty, or cannot be decoded as text, return `[{"location":"N/A","trigger_condition":"Input empty or undecodable","guard_snippet":"Provide valid content to review","potential_consequence":"Review skipped — no analysis performed"}]` and stop
- Identify content type (diff, full file, or function) to determine scope rules

### Step 2: Exhaustive Path Analysis

**Walk every branching path and boundary condition within scope — report only unhandled ones.**

- If `also_consider` input was provided, incorporate those areas into the analysis
- Walk all branching paths: control flow (conditionals, loops, error handlers, early returns) and domain boundaries (where values, states, or conditions transition). Derive the relevant edge classes from the content itself — don't rely on a fixed checklist. Examples: missing else/default, unguarded inputs, off-by-one loops, arithmetic overflow, implicit type coercion, race conditions, timeout gaps
- Consider implicit branches: the diff special-cases or changes the handling of one or more members of a fixed set of values — enums, status codes, sentinels, type tags, flags, value ranges. The rest of the set is implicit branches (e.g. the diff changes the `RED` and `YELLOW` cases of a `RED`/`YELLOW`/`GREEN` enum; `GREEN` is the implicit branch)
- For each path: determine whether the content handles it
- Collect only the unhandled paths as findings — discard handled ones silently

### Step 3: Validate Completeness

- Revisit every edge class from Step 2 — e.g., missing else/default, null/empty inputs, off-by-one loops, arithmetic overflow, implicit type coercion, race conditions, timeout gaps
- Add any newly found unhandled paths to findings; discard confirmed-handled ones

### Step 4: Deletion Check

If the diff removed or replaced meaningful code (ignore pure renames and whitespace): load `references/deletion-check.md` and follow it.

### Step 5: Present Findings

Output all findings as a single JSON array following the Output Format specification exactly.

## OUTPUT FORMAT

Return ONLY a valid JSON array of objects. Each edge-case finding contains exactly these four fields:

```json
[
  {
    "location": "file:start-end (or file:line when single line, or file:hunk when exact line unavailable)",
    "trigger_condition": "one-line description (max 15 words)",
    "guard_snippet": "minimal code sketch that closes the gap (single-line escaped string, no raw newlines or unescaped quotes)",
    "potential_consequence": "what could actually go wrong (max 15 words)"
  }
]
```

No extra text, no explanations, no markdown wrapping. An empty array `[]` is valid when nothing is found. Deletion findings from Step 4, if any, go in the same array with the extra fields defined in `references/deletion-check.md`.

## HALT CONDITIONS

- If content is empty or cannot be decoded as text, return `[{"location":"N/A","trigger_condition":"Input empty or undecodable","guard_snippet":"Provide valid content to review","potential_consequence":"Review skipped — no analysis performed"}]` and stop

## CONTENT SOURCE

Load the review target from the parent message, or from a trailing `## REVIEW TARGET` section if present (offline fallback). This file has no `{review_content}` slot. If neither supplies content, treat content as empty and follow the empty-content halt rules above.

---

## REVIEW TARGET

Story 4.8 ("Sticky SeverityBanner + RBAC (UNSAFE)") on the Surakkha project at `C:\ZDrive Folders\Projects\Surakkha`. The diff is at `_bmad-output/implementation-artifacts/review-target-4-8.patch` (~1760 lines, single feat commit `e811983`). Spec at `_bmad-output/implementation-artifacts/spec-4-8-sticky-severity-banner-rbac.md`.

**also_consider (edge-case focus areas):**

- The `filterUnsafeWithin24h` filter at `useSeverityBanner.ts:91` — enumerate every combination of (state, resolved_at, opened_at-validity, opened_at-within-window). The fix: any row with state !== UNSAFE, OR resolved_at !== null, OR opened_at NaN, OR opened_at older than 24h, must be excluded. Test for the implicit branch: what about `INSPECTING`, `MONITORING`, `SAFE`, `RESOLVED`, `REOPENED`, `OPEN`, `ACKNOWLEDGED`?
- `bannerQueryFn` at `useSeverityBanner.ts:121` — walk the status code branches: 200, 403, other-ok (e.g. 204 — does the contract allow no-content?), 5xx, network-error.
- The `SeverityBanner` component at `SeverityBanner.tsx:50` — walk the count boundary: 0 (returns null), 1 (shows preview), 2+ (shows "View all"). What about negative count? Floating point?
- The `SeverityBannerBody` sub-component reads `useSeverityBanner()` a second time — does TanStack Query dedup the read? What if the cache mutates between the two reads in the same render?
- The AppShell slot mount order: `connection-state-banner-slot` → `severity-banner-slot` → `<TopBar />` — what happens if a banner throws during render? Does the slot mount order guarantee isolation (yes, both slots are independent wrappers)?
- The 24h window uses `Date.parse(i.opened_at)` — what about timezone edge cases? `Date.parse` accepts ISO 8601 with offset; the wire schema is `z.string().datetime({ offset: true })`. What about leap seconds? Year boundaries (Dec 31 → Jan 1)?
- `staleTime: Infinity` — does the banner re-fetch on tab refocus? On window focus + reconnect? On role change? None of these should trigger a fetch (the Kanban is canonical) but verify the behavior is sound.
- The `setQueryData` cache mutation in tests — when the cache is set with a function updater, what happens if the function returns `undefined`? TanStack Query v5 will not update the cache. Verify the test does not inadvertently poison the cache.
- The `Number.isNaN(openedAtMs)` branch excludes malformed timestamps — what about `null` `opened_at`? The wire schema forbids it, but if the contract drifts (defensive), `Date.parse(null)` returns NaN and is excluded — confirm the defensive check is correct.
- The 403 cache error path at the `403 RBAC denial` test — when the cache is set to error state directly via `setQueryData([...KEY], err)`, does `useQuery` re-render? Does it expose the error via `query.error`? Verify the banner correctly hides on error.
- The `<a href="/incidents">` link uses a raw anchor, not React Router's `<Link>` — does this cause a full page reload? If yes, that's a regression in UX (the rest of the app uses `<Link>`). Verify the spec explicitly chose this for a reason (informational surface, not navigation).
