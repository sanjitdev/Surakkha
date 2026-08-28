# Verification Gap Review — Story 4.8

This file is a self-contained reviewer prompt to be run in a separate session. Do not modify it from the parent side. Paste back any findings into the chat for triage.

---

# Verification Gap Review

**Goal:** Find changed behavior that could break without reliable verification catching it. Ask one question — "if the behavior this change is supposed to produce broke where it's actually used, would verification fail?" Do not hunt for correctness bugs, but report genuine problems you notice while tracing verification.

The main verification gap shapes are:

1. **Regression gap:** the changed code regresses where it's used, and no test covering that use would fail.
2. **Missing-adoption gap:** a place that should now use the new behavior doesn't; it handles the same case its own way, or not at all, and no test would flag the omission.
3. **Broken-verification gap:** a test appears to cover the changed behavior, but would not actually protect it because it is skipped, flaky, not run in the normal verification path, or too weak to observe the regression.

## Evidence Rules

- Read a test before claiming what it covers, runs, asserts, or misses.
- Before claiming no test exists, search the whole repo by the symbol under test and by import references; expected file locations are not enough.
- Never assert what you did not verify. If a finding cannot be grounded, drop it.
- In a finding, say what you actually checked — "none of the tests I read cover this" — and show how far you looked. Say a test doesn't exist anywhere only when the symbol/import-reference search actually shows that.
- Do not assign severity, confidence, priority, or ranking.

## Review Sequence

### Step 1: Screen for behavioral change

If the change is non-behavioral, stop here and output the clean result (see Output Format). Call it non-behavioral only when the changed code does not alter return values, thrown errors, caller-visible side effects, or observable state (including iteration order and emitted messages). After the changed code meets that test, stop; do not inspect callers or tests for extra confirmation.

Common non-behavioral examples: formatting, comments, whitespace; pure renames; trivial getters/setters and pass-throughs; type-only or compiler-enforced changes with no runtime effect; etc.

### Step 2: Find the behavior that changed

Identify what behavior changed compared to the previous version: output, side effect, branch, error path, schema/event shape, config default, validation/authorization rule, external contract, etc. If the change affects more than one behavior, handle each separately.

Treat broad-impact changes as behavioral even when no single changed line looks important: dependency, toolchain, build/config, data-file, etc.

### Step 3: Trace where that behavior is used

Trace the changed behavior to the places that observe it. Start with direct callers and registered entry points (routes, commands, DI), contract consumers (schemas, events, APIs, database readers), and reverse-dependency info if already available.

Follow a path only while the changed behavior is reachable and unverified. Stop when a test at that boundary would fail, the consumer does not observe the changed behavior, or the next hop is guesswork (dynamic dispatch, reflection, outside-repo consumers, etc.). Prefer the nearest observable boundary, often one to three hops away, especially across contract, integration, or service edges. If there are more than five similar consumers, group obvious repeats and check representative paths; expand only when a consumer observes the behavior differently.

### Step 4: Qualify the consumer, then check its test

For each consumer, name the smallest realistic regression this consumer would observe: invert the branch, drop the default, omit the field, return the old error code, skip the integration call, etc. This is the Demonstration. If no such regression exists, drop the path; untested downstream code is not a finding.

A `Missing-adoption gap` qualifies not by the adoption failure alone but by a supersession signal: the change gives clear evidence the new behavior is meant to replace the local one — PR intent, naming or docs, a replaced sibling site, deleted duplicate logic, or a test defining the new rule — and the local site shares the same observable contract. Without a supersession signal and a shared observable contract, it is a refactor suggestion, not a verification-gap finding. Once both hold, check whether any test for that site would flag the non-adoption; missing coverage of the non-adoption is the gap itself, not a disqualifier.

Find and read the relevant test. Ask whether the Demonstration would make an assertion fail.

- If yes, the behavior is verified. No finding.
- For a regression-style Demonstration: if no test runs the path, the test is skipped/flaky/not run normally, or the test runs the code without checking the changed result, report a `Regression gap` or `Broken-verification gap`.
- For a qualifying Missing-adoption case: if none of the site tests you found assert it adopts the new behavior, report a `Missing-adoption gap`.

A test counts only if it runs normally and an assertion observes the changed output, branch, or contract. These do not count: no execution; success/no-throw/snapshot-only checks; mock/log-call checks; human-only checks; tests that mock away the integration; e2e tests that pass through without checking the changed output; stale assertions or fixtures.

Common patterns:

- **Caller-path gap** — helper test covers the branch, but caller values skip it.
- **Contract drift** — payload/schema/event changes must be verified at the consumer.
- **Migration compatibility** — tests only create new-format rows or fresh schemas.
- **Phantom exception** — handled partial-failure path has no test.
- **Missing-adoption gap** — sibling site should use the new rule/helper and does not.
- **Removed verification** — deleted test or weakened assertion leaves behavior unpinned.

### Step 5: Confirm each finding is real

Before writing a finding, re-open the specific tests or search results the finding relies on. Verify the Demonstration would not make any test you checked fail, or that the absence claim is backed by the symbol/import-reference search. Do not claim more than you verified; drop any finding you cannot ground.

Do not report: compiler/type-checker-enforced cases; behavior already verified by an integration, contract, or e2e test; implementation-detail or mock-only tests; low coverage or a missing test file by itself; legacy untested code the change did not affect.

Report genuine problems you noticed while tracing verification, even if they are not verification gaps. Put them under `Other findings` in the output. This permits reporting what you already reached, not extra hunting.

## OUTPUT FORMAT

Emit each verification-gap finding as one block. No general advice, no severity or confidence.

```markdown
### <one-line title naming the gap>

- **Changed surface:** the exact behavior or contract that changed — `file:line`.
- **Impacted consumer or site:** named concretely with `file:line` (e.g. "the `createInvoice` mutation used by the billing dashboard at `billing/dashboard.ts:88`," not "callers of this function").
- **Existing test evidence:**
  - `Regression gap`: what the relevant test actually asserts, with `file:line`; or, if none, the symbol/import-reference searches run and their result.
  - `Missing-adoption gap`: tests for the impacted site, and whether any assert it adopts the new behavior.
  - `Broken-verification gap`: the apparent test or verification path, and why it does not count.
- **Missing verification:** the precise assertion or check that's absent.
- **Demonstration:**
  - `Regression gap` / `Broken-verification gap`: the concrete regression that would ship undetected, and why the tests you checked would not fail.
  - `Missing-adoption gap`: the case the site mishandles by not adopting the new behavior, and that none of the tests you read assert adoption.
- **Consequence:** the concrete thing that ships wrong — a regression the checked evidence would not catch, or a site that should use the new behavior and doesn't.
- **Suggested test shape:** (optional) the kind of test that would close the gap, fit to the repo's own way of verifying — don't impose a generic test pyramid.
```

If you noticed genuine non-gap problems while tracing verification, append:

```markdown
## Other findings

- <description only; no severity, confidence, priority, or ranking>
```

When you find no verification gaps and no other findings, output exactly this single line, not an empty response:

`No verification gaps found.`

## CONTENT SOURCE

Load the change set from the parent message, or from a trailing `## REVIEW TARGET` section if present (offline fallback). This file has no `{review_content}` slot. If neither supplies a change set, stop with exactly: `No verification gaps found.`

---

## REVIEW TARGET

Story 4.8 ("Sticky SeverityBanner + RBAC (UNSAFE)") on the Surakkha project at `C:\ZDrive Folders\Projects\Surakkha`. The diff is at `_bmad-output/implementation-artifacts/review-target-4-8.patch` (~1760 lines, single feat commit `e811983`). Spec at `_bmad-output/implementation-artifacts/spec-4-8-sticky-severity-banner-rbac.md`.

**Context for verification tracing:**

- The banner's `useQuery` reuses `KANBAN_ACTIVE_QUERY_KEY`. The cache-key identity is pinned by the `SEVERITY_BANNER_QUERY_KEY matches KANBAN_ACTIVE_QUERY_KEY` test at `SeverityBanner.spec.tsx:435-441`.
- The banner's `queryFn` throws `KanbanRbacDeniedError` on 403 — this is verified by the `403 RBAC denial` test at `SeverityBanner.spec.tsx:414-434` which sets the cache directly to error state and asserts the banner is hidden.
- The socket-reconcile path is verified by the `SOCKET_RECONCILE_TO_UNSAFE` and `SOCKET_RECONCILE_TO_RESOLVED` tests at `SeverityBanner.spec.tsx:297-355` which mutate the cache via `applyStateChangeToCache` and assert the banner appears/disappears.
- The 24h window is verified by `filterUnsafeWithin24h: includes only UNSAFE + resolved_at null + within 24h` at `SeverityBanner.spec.tsx:182-198`.
- The slot stacking is verified by `AppShell.spec.tsx`'s Story 4.8 describe block (2 tests added in this story).
- The Kanban's 403 instanceof check (`KanbanBoard.tsx:225`) was NOT broken — the `IncidentDetailActions.spec.tsx` and `KanbanBoard.spec.tsx` 403 tests still pass.

**also_consider (verification-tracing focus areas):**

- The `filterUnsafeWithin24h` pure helper has direct test coverage at `SeverityBanner.spec.tsx:182-198`. Verify it covers: wrong state, resolved, expired, malformed `opened_at`. What about the boundary at exactly 24h (inclusive vs exclusive)?
- The `bannerQueryFn` 403 path — is it tested end-to-end (mock fetch returns 403 → cache error → banner hidden)? Or is it only tested by direct cache manipulation? Check the test rig in `SeverityBanner.spec.tsx` (the `envelope`/`fetchStatus` setup at lines 121-164).
- The socket-reconcile tests use `applyStateChangeToCache` from `useKanbanBoardSocket.ts:68`. Verify the helper's `RESOLVED_DROP` branch is exercised in the banner test (when to_state === RESOLVED, the row is removed).
- The `staleTime: Infinity` behavior — is it tested? If a socket mutation occurs, does the banner re-render? The SOCKET_RECONCILE_TO_UNSAFE test exercises this. But what about the case where the Kanban is NOT mounted (no prior `useQuery` registered the `queryFn`)? Does the banner fire its own fetch on mount and then never again?
- The `<a href="/incidents">` link is verified by the HAPPY_PATH_3 test. Verify no test asserts the link uses React Router (the spec deliberately bypasses `<Link>`). If a future test asserts `<Link>`, that would be a regression pin to be aware of.
- The `SeverityBanner` `aria-live="polite"` + `role="alert"` is asserted by the HAPPY_PATH_1 test. Verify the body is the element with `aria-live` (not the wrapper).
- The 15 new tests in `SeverityBanner.spec.tsx` + 2 new tests in `AppShell.spec.tsx` — verify each test name maps to a documented AC in the spec's ACs section. Cross-check the test list against the 12 ACs.
- The `useSeverityBanner` hook is called twice in `SeverityBanner.tsx` (parent + body). Verify TanStack Query dedupes by key — search for any test that would catch a regression where the two reads see different projections.
- The `KanbanRbacDeniedError` extraction — verify the re-export at `KanbanBoard.tsx:299` keeps external callers (tests, sibling modules) working. Search for any import that uses `KanbanBoard.tsx`'s re-export vs the new direct import.
- The `SimulatorPage.spec.tsx` change to filter `/admin/simulator/*` URLs — verify the original `not.toHaveBeenCalled()` assertion is now scoped to ONLY the simulator endpoints, NOT all fetches. The banner legitimately calls `/api/incidents/active` from the AppShell mount.
