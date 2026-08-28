# Edge Case Hunter Review — Story 4.7 (Submit Result)

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

## CONTENT SOURCE

Load the review target from the parent message, or from a trailing `## REVIEW TARGET` section if present (offline fallback). This file has no `{review_content}` slot. If neither supplies content, treat content as empty and follow the empty-content halt rules above.

---

## REVIEW TARGET

Story 4.7 ("Submit Result — SAFE / UNSAFE / MONITORING") on the Surakkha project at `C:\ZDrive Folders\Projects\Surakkha`. The diff is at `_bmad-output/implementation-artifacts/review-target-4-7.patch` (2231 lines).

**also_consider:**

Walk the following paths explicitly:

1. The `<SubmitResultForm />` local state (`selectedOutcome: InspectionOutcome | null`) — what if a non-`null` outcome is set, the user clicks Submit, the mutation fires, then on the SAME render a socket event lands and resets the parent row's state (e.g. another Technician submitted)? Walk through:

   - local-state vs server-state divergence
   - re-render path after the socket event
   - whether the form re-mounts (it doesn't, it stays mounted)

2. The mutation's `onSuccess` invalidates the row query. The socket event might land AFTER the row re-fetch (or before). Does the cache end up correct in both orderings?

3. The `classifySubmitResultError` switch is exhaustive over `{ 400, 401, 403, 404, 409 }` + default. What about `422` (semantic validation)? `412` (Precondition Failed)? `429` (rate limit)? `503` (Service Unavailable, distinct from generic 500)?

4. The `setViewerAsTechnician()` test helper mints a JWT with `exp: 9999999999`. What if the helper is called but the apiClient's auto-refresh fails BEFORE the submit-result POST? Edge: test order leakage.

5. The `IncidentDetailActions` returns `null` when no slot is present. What if a Technician viewer logs in after the page loaded (token arrived late, `viewerUserId` was null on first render, then becomes non-null)? The component re-renders because parent re-renders — but does the slot matrix re-evaluate correctly?

6. `actionSlotsFor` adds a role gate `if (viewerRole !== "Technician") return []` for INSPECTING. Edge: what if `viewerRole === null` (logged out) AND `state === "INSPECTING"`? The early `if (viewerRole === null) return []` already covers this. Confirm no double-gating.

7. `IncidentDetailPage.tsx`'s `viewerUserId = readUserIdFromStore()` is read SYNCHRONOUSLY at render time. What if the token store's `accessToken` is `null` after `clearTokens()` (post-401)? The `viewerUserId` resolves to `null`, slot returns `[]`, form disappears — is the form disappearance the right UX or should we keep it mounted with a "session expired" gate?

8. The body's `<dl>` always renders 8 fields regardless of state. Is this correct for INSPECTING (where acknowledged_at is always non-null, resolved_at is always null)? No "—" rendered for unset fields — confirm this is consistent.

9. The TOAST_TTL integration test (`IncidentDetailPage.spec.tsx:2199-2244`) uses `act` + `vi.advanceTimersByTime(4_001)`. What if the mutation's success-onSuccess → invalidate → refetch chain takes >4 seconds in a degenerate case? The toast might be gone before refetch settles — is that user-visible?

10. The `INSPECTION_OUTCOMES` constant is `["SAFE", "UNSAFE", "MONITORING"]` mirrored literally. What if `InspectionOutcomeSchema` grows to add a 4th value? Will the literal still compile (it's a finite tuple, so no exhaustive check)?

Output ONLY a JSON array. Empty array is valid.
