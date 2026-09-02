# Critique — `packages/web/src/dashboard`

**Date:** 2026-09-02  
**Surface:** `packages/web/src/dashboard/` (6 components + 3 hooks + 1 shared tokens file + 3 spec files)  
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File                        | LOC       | Heuristic score    | Findings                    |
| --------------------------- | --------- | ------------------ | --------------------------- |
| `Dashboard.tsx`             | 76        | 26/40              | 1 P1 (33-line header), 2 P2 |
| `KpiBand.tsx`               | 62        | 30/40              | 1 P1 (21-line header), 2 P2 |
| `MapRegion.tsx`             | 103       | 28/40              | 1 P1 (25-line header), 3 P2 |
| `MapView.tsx`               | 377       | 30/40              | 1 P1 (43-line header), 6 P2 |
| `LiveReadingsRegion.tsx`    | 129       | 28/40              | 1 P1 (31-line header), 3 P2 |
| `LiveReadingsRow.tsx`       | 269       | 30/40              | 1 P1 (45-line header), 5 P2 |
| `RecentIncidentsRegion.tsx` | 64        | 30/40              | 1 P2 (14-line header), 2 P2 |
| `severityTokens.ts`         | 42        | 28/40              | 1 P1 (22-line header), 2 P2 |
| `useDashboardReadings.ts`   | 146       | 26/40              | 1 P1 (14-line header), 4 P2 |
| `useDashboardSocket.ts`     | 84        | 28/40              | 1 P1 (40-line header), 2 P2 |
| `useDashboardDevices.ts`    | 57        | 28/40              | 1 P1 (19-line header), 3 P2 |
| **Surface total**           | **~1409** | **28/40 weighted** | **8 P1, 36 P2**             |

The dashboard surface is the largest of the eight `/impeccable` critiques so far. The pattern is consistent across the surface: oversized narrative headers (14-45 lines) re-telling the story (Story 2.6, 2.7, 2.8, 2.9), self-critique markers (`Verification-Gap review VG-1`, `VG-4`, `Critique 2026-08-31 valley finding`), and the now-familiar `safeParse + console.error + throw new Error("X wire-shape mismatch")` block duplicated 4 times across 2 hook files.

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

1. **All 11 source files open with a 14–45-line narrative header.** Every header re-tells the Story 2.6/2.7/2.8/2.9 contract — DOM order, AC1/AC2/AC3/AC5/AC7 references, references to DESIGN.md sections, references to api-side files (`packages/api/src/ingest/frame.ts:359`, `SUBSCRIBER_PATH_SEGMENT`). The contract is documented in the epic + DESIGN.md; the surface is the renderer. Same anti-pattern as the previous surfaces — readers outside the dev context cannot decode the AC numbers, and the comment block is a copy of the design doc.
2. **Self-critique narrative in `MapView.tsx:74-80`:** "Coarser-unit thresholds for offline-pupup copy. Below 60 minutes we render `Nm ago`; from 1 hour to 24h we render `Nh ago`; beyond 24h we render `Nd ago`. Critique 2026-08-31 valley finding: a 10-day offline device was reading '1m ago' because `Math.max(1, …)` clamped the minute count without changing units — trust-eroding. The thresholds below are pinned so a future drift (e.g. switching back to minute-only) breaks the spec assertion rather than the operator's trust." This is a critique marker from a prior review — readers outside that context cannot decode it. The constant names (`HOUR_THRESHOLD_MS`, `DAY_THRESHOLD_MS`) carry the meaning; the rationale lives in the critique artifact.
3. **Tailwind-JIT explanation duplicated 4 times across `MapView.tsx:64-67`, `MapView.tsx:111-118`, `MapView.tsx:370-371`, `LiveReadingsRow.tsx:95-100`.** Four separate blocks re-explain the same JIT-scanner-cannot-expand-template-literals caveat. One canonical reference belongs in `tailwind.config.ts` or DESIGN.md; the source code carries the literal class strings as required.
4. **`LiveReadingsRow.tsx:27-39` "Pulse-replay contract" re-implements a CSS detail in the source header.** "The browser does NOT replay the animation when the same class is re-applied to a node that already owns it. To replay on every `server_received_at` advancement we hold a `ref<HTMLDivElement>` and toggle the class via `classList.remove → classList.add` in a `useEffect` keyed off `server_received_at`. That fires the keyframe once per render where `server_received_at` advanced." This belongs in `index.css` documentation or a CSS-knowledge-base comment, not the row component's source.
5. **Severity-metric precision table re-implements spec inline (`LiveReadingsRow.tsx:144-153`).** The `METRIC_PRECISION` table carries 6 entries with detailed WHO/BSTI references. The wire surface already encodes metric precision; this constant should live with the shared metric schema (or be derived from it), not duplicated in a component.
6. **`useDashboardSocket.ts:31-40` "Why a hook" rationale block.** The 10-line explanation of why the dashboard owns the socket lifecycle ("Pages like `/incidents` open their own socket with different listeners") and the `connectSocket` idempotency guarantee belongs in the socket client's docs.
7. **4 near-identical `safeParse + console.error + throw new Error("X wire-shape mismatch")` blocks in `useDashboardReadings.ts × 2 + useDashboardDevices.ts × 1`** (and one in `useDashboardReadings.ts`'s recent-incidents path). Each block is 4-7 lines. Consolidate to a shared `assertWireShape<T>(parsed, label): T` helper.
8. **`severityTokens.ts:18-21` "Story 2.7's `MapView.tsx:76` originally owned this lookup; the Story 2.8 review extracted it here so both consumers stay in lockstep."** This is the same self-critique-leaks-into-source pattern as the previous surfaces. The history belongs in git (or the critique artifact), not the source.

### P2 — Apply before merge, won't block on its own

1. **`Dashboard.tsx:47-50`**: 4-line inline comment ("AC2: invalidate `['readings', 'latest']` on every `reading:new`. Default URL is `/api` so production + `vite dev` share the same path-resolution rules…") restates what `useDashboardSocket()` already documents.
2. **`Dashboard.tsx:60-63`**: 4-line inline comment ("AC3 + AC7: derive counts from whatever the query currently holds. On error the data is `undefined`, so `readings` defaults to `[]`…") restates what `readings ?? []` + `summarizeReadings([])` already shows.
3. **`KpiBand.tsx:8-13`**: 6-line header comment on `placeholderSeverity` ("the placeholder returns `healthy | warning | critical`; `offline` is resolved by absence") — the type signature carries the meaning.
4. **`KpiBand.tsx:38`**: `sub: value === 0 ? "—" : SUB_TEXT[severity]` hard-codes the `"—"` glyph inline rather than as a named constant alongside `JUST_NOW_THRESHOLD_MS` / `MISSING_AGE_GLYPH` in `LiveReadingsRow.tsx`.
5. **`MapRegion.tsx:44-54`**: 11-line inline comment explaining the isError / isEmpty merge ("We present these through one route because the operator's experience is identical (the api didn't tell us about any devices)…") — the 2-branch `if (isError || isEmpty)` carries the meaning.
6. **`MapRegion.tsx:84-87`**: "X devices on the map" header is rendered twice (once in populated, once missing) with inconsistent positioning — the empty-state header omits the count chip but the populated header includes it.
7. **`MapView.tsx:88-97`**: "Severity → Tailwind `fill` token lookup…" comment block with the `Story 2.8 extracts the lookup into severityTokens.ts` migration narrative — the import line above already shows the canonical home.
8. **`MapView.tsx:265-270`**: 6-line useEffect comment ("Initial map mount. Runs once per MapView lifecycle (StrictMode double-mount handled by the `if (mapRef.current === null)` guard)…") restates what the early-return guard shows.
9. **`MapView.tsx:314-320`**: 7-line useEffect comment ("Markers / severity lifecycle. Recomputes the marker set on every `renderTick` change…") restates what the `useEffect` body shows.
10. **`MapView.tsx:296-299`**: CartoDB tile attribution comment ("Open OSM tiles via the public CDN is fine for v1; production may swap to a self-hosted tileserver") is a deployment note, not source code commentary.
11. **`MapView.tsx:283-285`**: "Disable every animation-driven gesture…" inline comment restates the 3-line `fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false` payload.
12. **`LiveReadingsRegion.tsx:45-53`**: "Severity rank…" comment with "today's data path returns only healthy or critical — but the rank table includes it so a future Epic 3 binding does not have to extend this file. (See Verification-Gap review VG-4.)" — the Verification-Gap review reference is the same self-critique-leaks-into-source pattern.
13. **`LiveReadingsRegion.tsx:75-78`**: 4-line useMemo comment ("Sort is a per-render `useMemo` keyed off the readings reference. The parent `Dashboard` already memoizes the readings array via TanStack Query…") restates what the dep array shows.
14. **`LiveReadingsRow.tsx:106-108`**: "Map severity → severity label…" header comment with "warning is reserved (Epic 3 rule engine) but rendered here so the contract is forward-compatible" — the type signature carries the meaning.
15. **`LiveReadingsRow.tsx:116-131`**: 16-line "Format the metric cell" header that re-explains the Ask-First resolution and Story 2.8's I/O matrix default. The function name `formatMetricCell` carries the meaning.
16. **`LiveReadingsRow.tsx:171-173`**: 3-line inline comment ("Severity is the row's severity bucket. The `placeholderSeverity` helper returns the three-bucket enum (no `offline`)…") restates what the call site shows.
17. **`LiveReadingsRow.tsx:208-219`**: 8-line return JSX comment ("Aria-live only fires for critical rows so screen-reader users hear about an escalation but do not get a noise stream…") restates what `aria-live={rowAriaLive}` shows. The "outer surface is a flex container…" comment (8 lines) restates the Tailwind class.
18. **`RecentIncidentsRegion.tsx:7-9`**: "Read-only preview badge was retired after Story 4.4 shipped…" — retirement narrative belongs in git, not source.
19. **`RecentIncidentsRegion.tsx:11-13`**: "Per AC4 the empty-state copy is exactly 'No incidents in the last 24 hours.' and is never animated…Per AC6 the region renders no action buttons…" — both AC references restate the JSX.
20. **`severityTokens.ts:32-35`**: "Severity → glyph lookup (mirrors `MapView.tsx:93`)" — the `// mirrors MapView.tsx:93` line-number reference is fragile (the line number shifts on every refactor).
21. \*\*`useDashboardReadings.ts:62-65` + 86-89`: "Latest readings query — initial REST cold-load" / "Recent incidents query (read-only preview)" — restate the hook names.
22. **`useDashboardReadings.ts:110-120`**: 11-line `summarizeReadings` header comment that re-explains "offline is derived from absence — a device that has never emitted…lands in offline". The function name + the `offline: 0, // offline is derived from absence, not the reading payload` line already show this.
23. **`useDashboardSocket.ts:50-58`**: 9-line `useDashboardSocket` JSDoc ("Mount the dashboard's realtime subscription. Returns nothing — the side-effect is the sole purpose of this hook. `url` defaults to the api origin…") restates the function name + signature.
24. **`useDashboardSocket.ts:71-73`**: "AC2: invalidate the cache key the four regions share. TanStack Query coalesces multiple invalidations within a tick…" — the `invalidateQueries` call shows what it does.
25. **`useDashboardDevices.ts:13-18`**: 6-line inline comment ("Does NOT refetch on `reading:new` — the readings cache update cascades through `useDashboardReadings`, and the map re-evaluates marker severities…") restates what the absent `invalidateQueries` call shows.
26. **`MapRegion.tsx` `isEmpty` + `isError` collapse without a Toast for the error path.** The map silently degrades to "No devices" on a 5xx, while the Live Readings table continues to render data via the readings cache. The operator sees no signal that the device roster is missing — a toast would close this gap. (Out of scope for header-comment critique; flagged as a behavioural improvement opportunity.)
27. **`MapView.tsx:135-141`** `formatOfflineAgeLabel` returns `null` on a malformed timestamp, and the caller falls back to the bare "Offline" line. The caller `buildPopupHtml:160-165` correctly handles `null` but the path through the function is the only way to land on the fallback — a 4-branch `if/else if/else` would be clearer. (Minor: the current shape is correct, but the "bare Offline" branch only fires when `last_reading_at` is non-null AND unparseable, which is rare. Documenting the case rather than restructuring is the right move.)

### Non-findings (verified, not raised)

- `MapView.tsx` correctly handles the StrictMode double-mount via the `if (mapRef.current === null)` guard and the cleanup function's `map.remove()` + `markersRef.current.clear()`.
- `LiveReadingsRow.tsx` pulse-replay logic correctly uses `void node.offsetWidth` to force a reflow before re-adding the class — verified via the inline comment at lines 196-199.
- `useDashboardSocket.ts` correctly disposes the listener on unmount via `socket.off("reading:new", handleReading)`.
- `severityTokens.ts` correctly lives in `dashboard/` rather than `shared/` — the `bg-severity-*` Tailwind classes are dashboard-only and there's no current second consumer.
- `summarizeReadings`'s `offline: 0` is correct given the absence-only derivation documented inline — Story 2.x will revisit.
- `MapView.tsx:362` correctly drops markers whose device vanished from the roster via the `seenIds` set.
- `useDashboardReadings.ts` and `useDashboardDevices.ts` correctly define Zod schemas locally rather than importing from `@surakkha/shared` — the wire types exist there but the Zod schemas are dashboard-only validation glue.

## Plan

### 1. Header trim pass (all 11 files)

Each `/** ... */` opening block compresses to ≤ 6 lines stating what the file renders + which DESIGN.md section it implements. AC numbers and story codes stay only in the design doc + the critique artifact.

### 2. Extract `assertWireShape<T>` helper

Consolidate 4 `safeParse + console.error + throw new Error("X wire-shape mismatch")` blocks into one helper in a new `packages/web/src/dashboard/assertWireShape.ts` (or co-located in `useDashboardReadings.ts`). Pattern:

```ts
const assertWireShape = <T>(parsed: SafeParseReturnType<unknown, T>, label: string): T => {
  if (!parsed.success) {
    console.error(`${label} wire-shape mismatch`, parsed.error);
    throw new Error(`${label} wire-shape mismatch`);
  }
  return parsed.data;
};
```

### 3. Drop Tailwind-JIT-caveat comment duplications

Keep ONE canonical reference in `severityTokens.ts` (which is the most-likely-to-be-misused file). Drop the 3 other copies in `MapView.tsx`. The constant names (`PIN_SIZE_PX`, `CRITICAL_BORDER_CLASS`) carry the runtime meaning; the JIT caveat is a docs concern.

### 4. Drop Story-2.8-migration-narrative comments

The 3 instances of "Story 2.7's `MapView.tsx:76` originally owned this lookup; the Story 2.8 review extracted it here…" / "Story 2.8 AC4" / "Story 2.6 AC2" / "Story 4.4 shipped" are all git history, not source-code commentary.

### 5. Move offline-age threshold rationale to `formatOfflineAgeLabel` JSDoc

Keep the function, drop the 7-line block above the constant declarations. The constants themselves (`MINUTES_PER_HOUR`, `DAY_THRESHOLD_MS`) are self-documenting; the rationale lives in the critique artifact.

## Out of scope

- `MapRegion.tsx` `isError` toast (P2 #26) — a behavioural change, requires design alignment; leave for a separate PR.
- `MapView.tsx:135-141` `formatOfflineAgeLabel` branching — current shape is correct.
- The CartoDB-tile-attribution deployment note (P2 #10) is small enough that it can stay if it's the only comment in the tile-layer block, but I prefer removing it; the attribute string itself is the public attribution.
- The pulse-replay contract (P1 #4) is the kind of detail that DOES belong somewhere in the source tree — but as an inline comment on the `classList.remove → classList.add` sequence (where a reader will look for it), not in the file header.
- `METRIC_PRECISION` table (P1 #5) could move to `@surakkha/shared` but that's a cross-package surface change — keep local for now.

## Verification

```bash
cd packages/web && npx tsc -b
cd packages/web && npx eslint src/dashboard
cd packages/web && npx vitest run src/dashboard
```

Existing specs: `Dashboard.spec.tsx`, `MapRegion.spec.tsx`, `LiveReadingsRegion.spec.tsx`. All must stay green.
