# Edge Case Hunter Review — Story 4.4 (Incident Detail Page, Read-Only)

**Reconstructed review brief.** Story 4.4 shipped at `17b4494` (feat) + `8e8be1d` (review fixes). This brief documents the edge-case findings that produced the `8e8be1d` patch set. The diff is at `_bmad-output/implementation-artifacts/review-target-4-4.patch` (1706 lines).

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

<reference path="references/deletion-check.md">
# Deletion Check

Secondary pass for the Edge Case Hunter — runs only when the diff removed meaningful code. Subordinate to the edge-case pass; findings are usually few or none.

For each chunk of removed or replaced code (ignore pure renames and whitespace), ask: did it carry behavior or a contract that the change neither re-established nor intentionally retired? Add a finding for any resulting regression, orphaned reference, or newly-dead code. Skip anything already covered by your edge-case findings.

Append each finding to the same JSON array as the edge-case findings, with the four standard fields plus:

- `kind`: `"deletion"`
- `confidence`: `"high"`, `"medium"`, or `"low"` — these are inferences; rate them

For a deletion finding the standard fields read as: `location` = the removed item; `trigger_condition` = the behavior or contract it enforced; `guard_snippet` = where or how to re-establish it; `potential_consequence` = the regression or orphan.

Add nothing if nothing qualifies.
</reference>

---

## REVIEW TARGET

Story 4.4 ("Incident Detail Page, Read-Only") on the Surakkha project at `C:\ZDrive Folders\Projects\Surakkha`. The diff is at `_bmad-output/implementation-artifacts/review-target-4-4.patch` (1706 lines).

**also_consider:**

Walk the following paths explicitly:

1. The detail page's two parallel queries (`row` + `events`). What if the row query succeeds but the events query returns 401 (token expires between mounts)? Does the page render the row + a "Failed to load timeline" branch, or does it 500-fallback?
2. `<NotFound />` is rendered on row 404. What if the row 200s but `assignee_user_id` is null (unassigned incident)? Does the assignee field render "Unassigned" or crash on null?
3. `useIncidentDetailSocket` mutates the cached row in place. What if a stale socket event arrives (e.g. for a different incident) and `applyTransitionToCachedRow` overwrites the cached row with the wrong incident's payload? Check the filter predicate.
4. The timeline `<li>` renders `e.payload` via `JSON.stringify(payload, null, 2)`. What if `payload` is `null` or a non-serializable value (e.g. a circular reference)? Does `JSON.stringify` throw?
5. The events endpoint returns ASC sort. What if two events have the same `createdAt` (high-rate clock skew or seed-data collision)? Is the sort stable? Is the test asserting a stable order?
6. The detail page's `useQuery` retry. What if the retry exhausts (default 3 attempts)? Does the page surface the 500 branch correctly, or does it show a stale empty state?
7. The Tech-ownership check on `/events` requires a prior `findUnique` on the parent incident. What if the parent incident is deleted between the findUnique and the events findMany? Race window — does the timeline return 500, or is the result silently empty?
8. `<NotFound />` has overridable `headline`/`message`/`backHref`/`backLabel` props. What if a future caller forgets to pass `backHref`? Does the default `/incidents` survive, or does the link render `href={undefined}`?
9. The detail page's 404 branch fires on row 404. What if the user navigates from a Kanban card to `/incidents/:id` and the row was deleted in flight? Does the page mount-then-404 cleanly, or does it flash the row briefly?
10. The new `cacheMutators.spec.ts` is parameterized over `INCIDENT_STABLE_STATES` (7 states). What about terminal states (`RESOLVED`, `INVALID`)? Are they excluded by design or are they in the test set?

Output ONLY a JSON array. Empty array is valid.
