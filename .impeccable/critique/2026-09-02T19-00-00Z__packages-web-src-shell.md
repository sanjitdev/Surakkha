# Critique — `packages/web/src/shell`

**Date:** 2026-09-02  
**Surface:** `packages/web/src/shell/` (4 components + 1 data file)  
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File                        | LOC     | Heuristic score    | Findings                                                |
| --------------------------- | ------- | ------------------ | ------------------------------------------------------- |
| `AppShell.tsx`              | 131     | 28/40              | 1 P1 (19-line header + 3 narrative slot comments), 4 P2 |
| `TopBar.tsx`                | 93      | 26/40              | 1 P1 (18-line header), 4 P2                             |
| `Sidebar.tsx`               | 154     | 30/40              | 1 P2 (15-line header), 2 P2                             |
| `ConnectionStateBanner.tsx` | 56      | 28/40              | 1 P1 (31-line header), 3 P2                             |
| `nav.ts`                    | 124     | 32/40              | 1 P2 (17-line header), 2 P2                             |
| **Surface total**           | **558** | **32/40 weighted** | **4 P1, 12 P2**                                         |

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

1. **Narrative headers leaking into source.** All 5 files open with 15–32-line `/** ... */` blocks that re-tell the story ("Story 1.2b, 4.10", "EXPERIENCE.md §Sidebar Component Pattern", "Story 2.8's `VG-1` lesson — the JIT scanner matches complete literals only"). The contract belongs in `EXPERIENCE.md`/`DESIGN.md` (which the header cites) — duplicating it inline is documentation drift waiting to happen. The surface is the _renderer_ of the contract; the contract lives elsewhere.
2. **Slot-comment blocks re-narrate Story 1.2b / Epic 4.** `AppShell.tsx` lines 77–95: two `data-testid="*-slot"` blocks each carry an 8-line comment explaining "the slot mounts ABOVE the severity-banner-slot so the realtime signal gets operator priority" + "DOM-tree position test stays a simple slot-vs-slot comparison". The slot wrapper's purpose is captured by its `data-testid`; the priority rule belongs in the IA doc.
3. **Self-critique narrative in `TopBar.tsx:82-86`:** "Story 4.10 — NotificationBell lives inside its own slot wrapper so the bell is independently swappable (the wrapper is the test seam pinned by `TopBar.spec.tsx`). NOT inside AppShell's slot hierarchy — TopBar is its own layout block." This is a critique marker from a prior review — readers outside that context cannot decode it.
4. **`ConnectionStateBanner.tsx` header re-implements the design doc inline (32 lines).** It re-states the spec ("Reconnecting…", "Showing last-known data."), re-explains the `aria-live="polite"` rationale, and re-justifies why there's no animation. The same justification lives in the DESIGN.md component section the header links to.

### P2 — Apply before merge, won't block on its own

1. **`Sidebar.tsx:13-15`**: "Role-aware item hiding: `filterNav` removes every item the role lacks permission for. The RBAC denied state for direct URL hits is in EXPERIENCE.md §RBAC denied." — purely a navigation pointer; the filter function's own name carries the meaning.
2. **`Sidebar.tsx:118-119`** mid-file comment ("Overlay — clicking it closes the drawer (EXPERIENCE.md §Tab order: Esc closes the drawer)") restates what `onClick={onClose}` already shows.
3. **`nav.ts:8-16`**: 9-line block re-narrating "Items hidden here are not reachable from the sidebar — direct URL hits fall through to the RBAC denied state" — the same point is captured in the `filterNav` JSDoc two functions down.
4. **`nav.ts:32-36`**: "Group + item order matches EXPERIENCE.md §Information Architecture. Items with `spine_only: true` in the inventory still need a nav slot for the demo flow; we mark them with the same `to` path." — `spine_only` is not referenced anywhere in this file or anywhere else in the codebase; the comment is a stale marker.
5. **`nav.ts:50-58`**: 9-line "Story 5.3 — RBAC matrix grants `read × AuditLog` to Admin only (`rbac.ts:115`); the previous `["Operator", "Admin"]` value put the link in the sidebar for Operators who would 403 on click (the matrix/UI drift the spec calls out in 'Why the nav fix belongs in 5.3')." — this is the same self-critique-narrative-leaks-into-source pattern as P1 #3.
6. **`TopBar.tsx:35-37, 50-51, 66-67, 77-85`**: 4 inline comments that re-explain what the JSX already shows ("Hamburger — visible below 1024px (lg breakpoint)" + `lg:hidden`; "Brand mark — 32x32 rounded-8" + the styled div; "Search slot — placeholder-only in v1" + the placeholder-only input; "Right cluster — notification bell + role pill + avatar" + the right-cluster div).
7. **`AppShell.tsx:99-103, 118-120`**: Two inline comments restating the Tailwind classes' effect ("Fixed sidebar at lg; the element exists in the DOM at all sizes so the test-id is queryable, but Tailwind's `lg:block` hides it under 1024px." + `hidden lg:block`).
8. **`AppShell.tsx:35-46`**: `detectBreakpoint` + `CANVAS_PADDING` map carry per-line inline comments ("`lg: px-6 /* 24px */`") that the design doc already documents. The padding values are also a magic-number triple that should live as a named constant or be derived.
9. **`nav.ts:23-24`** inline comment: "/\*_ Roles allowed to see this item. `null` means 'any authenticated role'. _/" — repeats the JSDoc on `filterNavGroup` immediately below.

### Non-findings (verified, not raised)

- The dual-slot pattern in `AppShell.tsx` (`connection-state-banner-slot` above `severity-banner-slot`) is correct per the IA — kept.
- The `matchMedia` resize listener correctly disposes; the Esc-key listener correctly early-returns when `drawerOpen === false`.
- `filterNav`/`findNavItemForPath`/`isPathAllowedForRole` form a coherent role-gating trio with single-responsibility per function.
- `nav.ts` uses `as const`-free readonly arrays correctly — no mutations, no accidental widening.

## Plan

### 1. Header trim pass (all 5 files)

Each `/** ... */` opening block compresses to ≤ 6 lines stating what the file renders + which IA/Design section it implements. Story codes and self-critique markers (`G3-*`, `VG-1`, `Story 5.3 — RBAC matrix grants…`, `the previous ["Operator", "Admin"] value put the link in the sidebar for Operators who would 403`) move to the critique artifact (this file) or stay only in the linked design doc.

### 2. Inline comment removal (P2 #1–9)

- Drop comments that re-narrate the JSX they sit next to.
- Keep comments that explain a non-obvious _decision_ (e.g. "Slot mounts ABOVE the severity-banner-slot" → keep as 1 line; "the slot mounts ABOVE the severity-banner-slot so the realtime signal gets operator priority when both are visible (Epic 4 future)" → trim to the first sentence).
- Replace `nav.ts:32-36` ("`spine_only` …") with a one-liner since `spine_only` is unreferenced anywhere in the codebase.

### 3. Constant naming (P2 #8)

`CANVAS_PADDING` already names the value. Add `CANVAS_PADDING_PX: Record<Breakpoint, number> = { lg: 24, md: 16, sm: 12 }` so the comment-as-annotation pattern (`px-6 /* 24px */`) is replaced by a named lookup.

## Out of scope

- The `Sidebar` `NavRow` `isActive` double-callback pattern (`({ isActive }) => …` once for the className, again for the children) is intentional — React Router's `<NavLink>` requires both callbacks to read the active state from the router context. Removing it would break the active styling.
- `breakpoint !== "lg"` drawer mount: the conditional mount + transform-hide pattern (rather than always-mounted + transform-hide) is correct because `lg:block` on the fixed sidebar means the drawer is only needed below lg. The "in the DOM but hidden" claim in the current comment was always slightly misleading.
- `detectBreakpoint` 3-branch early return is fine; the `lg` initial-render default (line 55) is documented to match the spec AC ("Story 1.2b AC only applies after mount").

## Verification

```bash
cd packages/web && npx eslint src/shell
cd packages/web && npx vitest run src/shell
cd packages/web && npx tsc -b
```

All 3 spec files (`AppShell.spec.tsx`, `TopBar.spec.tsx`, `ConnectionStateBanner.spec.tsx`, `shell.spec.tsx`) must stay green; the 5 source files must lint clean.
