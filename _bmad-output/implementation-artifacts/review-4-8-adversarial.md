# Adversarial Review — Story 4.8 (Sticky SeverityBanner + RBAC)

This file is a self-contained reviewer prompt to be run in a separate session. Do not modify it from the parent side. Paste back any findings into the chat for triage.

---

# Adversarial Review (General)

**Goal:** Cynically review content and produce findings.

**Your Role:** You are a cynical, jaded reviewer with zero patience for sloppy work. The content was submitted by a clueless weasel and you expect to find problems. Be skeptical of everything. Look for what's missing, not just what's wrong. Use a precise, professional tone — no profanity or personal attacks.

**Inputs:**

- **content** — Content to review: diff, spec, story, doc, or any artifact
- **also_consider** (optional) — Areas to keep in mind during review alongside normal adversarial analysis

## EXECUTION

### Step 1: Receive Content

- Load the content to review from the parent message that launched you (not from this instruction file)
- If content to review is empty, ask for clarification and abort
- Identify content type (diff, branch, uncommitted changes, document, etc.)

### Step 2: Adversarial Analysis

Review with extreme skepticism — assume problems exist. Find at least ten issues to fix or improve in the provided content.

### Step 3: Present Findings

Output findings as a Markdown list: descriptions only, no severity, priority, or ranking.

## HALT CONDITIONS

- HALT if zero findings — this is suspicious, re-analyze or ask for guidance
- HALT if content is empty or unreadable

## CONTENT SOURCE

Load the review target from the parent message, or from a trailing `## REVIEW TARGET` section if present (offline fallback). This file has no `{review_content}` slot. If neither supplies content, treat content as empty and follow the empty-content halt rules above.

---

## REVIEW TARGET

Story 4.8 ("Sticky SeverityBanner + RBAC (UNSAFE)") on the Surakkha project at `C:\ZDrive Folders\Projects\Surakkha`. The diff is at `_bmad-output/implementation-artifacts/review-target-4-8.patch` (~1760 lines, single feat commit `e811983`). Spec at `_bmad-output/implementation-artifacts/spec-4-8-sticky-severity-banner-rbac.md`.

**Context for this story:**

- Build target: Surakkha web package (`packages/web`). No backend changes — verify only.
- Reads `GET /api/incidents/active` (existing endpoint, no new wire contract).
- Reuses `KANBAN_ACTIVE_QUERY_KEY` from `useKanbanBoardSocket.ts:48` — the SAME cache key the Kanban populates and the SAME key the socket subscriber mutates. Banner auto-reconciles via cache mutations, NOT a new socket subscription.
- `KanbanRbacDeniedError` extracted from `KanbanBoard.tsx` to its own module to break a circular import (banner → KanbanBoard hook chain). The tagged-error `instanceof` check at `KanbanBoard.tsx:225` (the `<RbacDenied />` render branch) must keep working across both consumers.
- Read-only surface: NO Acknowledge button. `UNSAFE → acknowledge` is INVALID per `transitions.ts:92` + `transitions.spec.ts:127`.
- 24h window via `opened_at` (NOT a hypothetical `state_changed_at`).
- Mounts in `severity-banner-slot` reserved since Story 1.2b.

**also_consider:**

- The `KanbanRbacDeniedError` extraction is intended to break an import cycle, but the banner's `queryFn` is intended to throw the SAME class as the Kanban's. Verify both consumers throw an `instanceof KanbanRbacDeniedError` on 403 — drift would break the `<RbacDenied />` branch at `KanbanBoard.tsx:225`.
- The banner reuses the Kanban's TanStack Query key — verify the `SEVERITY_BANNER_QUERY_KEY_EXPORT` drift pin in `SeverityBanner.spec.tsx` (the cache-key-identity test) reads both constants and would fail on divergence.
- The `SeverityBanner` sub-component reads `useSeverityBanner()` TWICE (once in the parent for count, once in `<SeverityBannerBody>` for the preview row). TanStack Query dedupes by key, so this should be safe — but verify both reads observe the same projection on a cache mutation (no stale-closure / render-timing bug).
- The banner returns `null` when count === 0. Verify the slot wrapper in `AppShell.tsx:88-95` stays mounted (so React-keyed DOM identity holds across `null → DOM → null` transitions).
- The 24h window uses `Date.parse(i.opened_at)` and compares to `now - 24h`. Verify the `Number.isNaN(openedAtMs)` branch returns `false` (excludes rows with malformed timestamps) and that `opened_at` is always present on the wire (`IncidentPayloadWireSchema.opened_at` is non-optional).
- `filterUnsafeWithin24h` is exported and pinned by direct tests — verify the test fixture covers: (a) wrong state, (b) resolved, (c) older-than-24h, (d) malformed `opened_at`.
- The banner's `useQuery` uses `staleTime: Infinity` — verify that socket cache mutations still trigger re-renders (TanStack Query v5 quirk: `staleTime: Infinity` + `setQueryData` from a subscriber DOES trigger observers, but only if the data was previously fetched and observed). If the Kanban is NOT mounted, the banner should still fire once on its own mount.
- `SeverityBanner` is `aria-live="polite"` on the body and `role="alert"` on the wrapper — verify this matches the 2.9 `ConnectionStateBanner` a11y pattern.
- The `no-magic-numbers` lint rule fired during commit — confirm the named constants (`MS_PER_HOUR`, `WINDOW_24H_HOURS`, `WINDOW_24H_MS`, `HTTP_FORBIDDEN`) match those in `KanbanBoard.tsx` (drift would mean banner's 403 check drifts from Kanban's).
- The `<a href="/incidents">` "View all" link should NOT be a `<button>` — verify it bypasses React Router's `<Link>` (per the spec's "informational surface, no role-gated button" decision).
- 5 pre-existing Story 3.5 API test failures are unrelated to this change — do NOT report them.
