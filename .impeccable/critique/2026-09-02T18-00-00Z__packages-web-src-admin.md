# Critique — `packages/web/src/admin/` (2026-09-02)

Nielsen heuristic scoring + AI-slop detection (manual pass; detector Bash-blocked).

## Surface inventory

10 source files + 2 spec files, ~1,400 LOC across 2 sub-areas:

| Sub-area   | File                          | LOC | Role                                                                |
| ---------- | ----------------------------- | --- | ------------------------------------------------------------------- |
| simulator  | `SimulatorPage.tsx`           | 178 | admin tab page; 3-state dispatch (loading/disabled/error/populated) |
| simulator  | `useSimulatorDevices.ts`      | 228 | TanStack hooks: status + devices query + switch mutation            |
| simulator  | `DeviceRow.tsx`               | 185 | per-device scenario-switch row                                      |
| simulator  | `DisabledBanner.tsx`          | 28  | static "disabled" banner                                            |
| thresholds | `ThresholdsPage.tsx`          | 173 | admin tab page; list + history toggle + modals                      |
| thresholds | `useThresholds.ts`            | 208 | 4 hooks: list / create / update / activate                          |
| thresholds | `ThresholdsPopulatedView.tsx` | 202 | table + modals + toast region (extracted from page)                 |
| thresholds | `ThresholdsModals.tsx`        | 294 | NewRule + EditRule modals                                           |
| specs      | `SimulatorPage.spec.tsx`      | n/a | Story 2.5 matrix                                                    |
| specs      | `ThresholdsPage.spec.tsx`     | n/a | Story 3.7 matrix                                                    |

## Scoring

Nielsen 10 (1 = bad, 4 = good):

| H                              | Score | Note                                                                                 |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------ |
| 1 Visibility of system status  | 4     | Loading / disabled / error / populated all have dedicated banners.                   |
| 2 Match real world             | 3     | "Simulator disabled. Set SIMULATOR_SECRET." calm copy.                               |
| 3 User control + freedom       | 3     | History toggle, New Rule / Edit / Activate / Deactivate buttons.                     |
| 4 Consistency + standards      | 4     | Toast region shared with incidents; severity tokens throughout.                      |
| 5 Error prevention             | 3     | Thresholds Create validates `Number.isNaN`; Edit supersede validates `Number.isNaN`. |
| 6 Recognition > recall         | 3     | Pre-filled edit form, no retyping.                                                   |
| 7 Flexibility + efficiency     | 3     | Bulk edit not present (out of scope per spec).                                       |
| 8 Aesthetic + minimal          | 3     | Clean table + cards; calm warning banner.                                            |
| 9 Help users recognize/recover | 4     | Each mutation has success + error toasts; error banner on outage.                    |
| 10 Help + documentation        | 2     | None in-product.                                                                     |

**Total: 32 / 40** (same as auth/ loop-1). Admin/ is in good shape — multiple critique passes already shipped (the comment "Critique 2026-08-31 progressive-disclosure" in `ThresholdsModals.tsx:219` is a tell that this surface has been iterated).

## AI-slop findings

### P1 (high-impact)

- **P1 #1 — Story-internal jargon in file headers across 7 files.** All 4 admin source files cite internal story IDs (`G3-01`, `G3-06`, `G3-12`, `F-2.5-17`, `F-2.5-17`, etc.) in their JSDoc headers. These are project-internal traceability tags that don't belong in code-facing documentation; the git log is the source of truth for traceability. Affects: `SimulatorPage.tsx:26-28`, `useSimulatorDevices.ts:14-22, 24-31, 60-75, 126-148, 180-184`, `DeviceRow.tsx:1-20`, `ThresholdsPage.tsx:1-24`, `useThresholds.ts:1-19`, `ThresholdsPopulatedView.tsx:1-14`, `ThresholdsModals.tsx:1-13`. Trim to intent only.
- **P1 #2 — `useSimulatorDevices.ts:212-223` mutation-wrapping hack.** The `Object.assign(wrapped, detail)` pattern + `as Error & SwitchScenarioError` cast silences `no-throw-literal` but is genuinely confusing: a plain `throw new Error("...")` would lose the discriminated union shape, but TanStack Query's `useMutation<TData, TError, TVariables>` generic already supports a non-Error `TError`. Switching the second generic to `SwitchScenarioError` (the union directly) lets the consumer's `err.kind` resolve without the wrapper, AND lets TanStack Query's `MutationCache` handle the typed error correctly. This is also why a previous `SimulatorSwitchError` class existed and was replaced.

### P2 (medium-impact)

- **P2 #1 — `useThresholds.ts` has 5 near-identical `safeParse + console.error + throw new Error("X wire-shape mismatch")` blocks** (lines 102-106, 127-131, 163-168, 170-175, 196-200). Extract a helper `assertWireShape<T>(parsed: SafeParseReturnType, label: string): T` that throws on failure. ~25 LOC collapse.
- **P2 #2 — `ThresholdsPage.tsx:67-127` has 4 near-identical `mutation.mutate(vars, { onSuccess, onError })` blocks** each wiring `pushToast("success", msg)` + `pushToast("error", prefix + err.message)`. Extract a `useMutationToasts(mutation, successMsg, errorPrefix)` helper or a single `wireMutationToast(mutation, pushToast, successMsg, errorPrefix)` helper. ~30 LOC collapse.
- **P2 #3 — `ThresholdsModals.tsx:213-231` 19-line `EditRuleModal` JSDoc block** explaining the `<details>` progressive-disclosure + critique-history narrative. Trim to one sentence.
- **P2 #4 — `useSimulatorDevices.ts:78,109` inline query key arrays** (`["admin", "simulator", "status"]` and `["admin", "simulator", "devices"]`) — threshold side has `THRESHOLDS_RULES_KEY as const` extracted. Symmetry: extract `SIMULATOR_STATUS_KEY` + `SIMULATOR_DEVICES_KEY` constants.
- **P2 #5 — `SimulatorPage.tsx:69-79` `useEffect` for invalidating status on 401/403 from devices query** has 11 lines of JSDoc explaining the G3-03/G3-04 rationale + 3 lines of comment about api-status codes. The function body is 7 lines; the comments are 14. Trim.

### P3 (low / out-of-scope)

- `ThresholdsModals.tsx:14-15` `import { type RuleRow } from "@surakkha/shared"` + `useThresholds.ts:34` `export type { RuleRow } from "@surakkha/shared"` — both modules re-export `RuleRow`. The page imports `RuleRow` from `useThresholds` (one of two possible sources). Out of scope (reflexive re-export — would force spec-file edits to pick a canonical source).
- `DeviceRow.tsx:36-50` `useState` initializer uses `device.scenario ?? "Normal"` — the `"Normal"` fallback duplicates a `SCENARIO_NAMES[0]` lookup. Out of scope (cosmetic; SCENARIO_NAMES is the canonical list).
- `ThresholdsModals.tsx:28-37` `emptyNewRuleForm` is exported but only used inside the same file. Could be `const`. Out of scope (named export aids testability).

## Refinement plan

1. **Trim 7 file headers** — remove story-internal IDs (G3-xx, F-2.5-xx); keep intent + 1-line "where does this fit" only.
2. **Fix `useSwitchScenario` error typing** — change `useMutation` second generic from `SwitchScenarioError` to `SwitchScenarioError` directly (it already is) AND remove the `Object.assign(wrapped, detail)` hack. Throw the union literal with a typed-as-throw comment.
3. **Extract `assertWireShape<T>` helper** in `useThresholds.ts` for the 5 safeParse + log + throw blocks.
4. **Extract `wireMutationToast` helper** in `ThresholdsPage.tsx` (or a new `mutationToasts.ts`) for the 4 toast-wiring blocks.
5. **Extract `SIMULATOR_STATUS_KEY` / `SIMULATOR_DEVICES_KEY` constants** for symmetry with `THRESHOLDS_RULES_KEY`.
6. **Trim mid-file JSDoc** in `SimulatorPage.tsx:69-79` useEffect + `ThresholdsModals.tsx:213-231` EditRuleModal.

## Estimated delta

- 7 source files: ~1,260 LOC → ~1,100 LOC (-160)
- New helper: `useThresholds.ts` `assertWireShape` (10 lines)
- New helper: `ThresholdsPage.tsx` `wireMutationToast` (10 lines)
- 2 new constants in `useSimulatorDevices.ts` (4 lines)
- **Net: -136 LOC** with no behavior change; same test surface green.

## Convergence

This is a single-loop pass. Loop-2 unlikely to surface new P1/P2 — the surface is already iterated and the findings are localized.
