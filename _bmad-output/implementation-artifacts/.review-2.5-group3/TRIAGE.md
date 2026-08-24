# Group 3 Triage — Story 2.5 (Web scope)

**Scope:** `packages/web/src/admin/simulator/*`, `packages/web/src/queryClient.ts`, `packages/web/src/main.tsx`, `packages/web/.env.example`
**Reviewers:** blind-hunter (30), edge-case-hunter (50), acceptance-auditor (15), verification-gap (50)
**Total raw findings:** 145
**De-duplicated findings:** 35 distinct issues
**Date:** 2026-08-24

---

## Triage Categories

| Outcome | Count | Marker |
|---|---|---|
| Patches to apply | 18 | G3-01..G3-18 |
| Dismissals (no defect) | 9 | G3-D1..G3-D9 |
| Deferrals (out of scope) | 5 | F-2.5-17..F-2.5-21 |
| Pre-existing spec drift (logged) | 3 | SPEC-DRIFT-1..3 |

---

## PATCH LIST

### **G3-01** (critical) — `useSimulatorStatus` swallows all non-200 as "disabled" — masks real outages
**Source:** Edge-hunter #3, Verification-gap #1, Blind-hunter #8, Acceptance #8
**Files:** `packages/web/src/admin/simulator/useSimulatorDevices.ts:40-57`
**Spec:** AC2 — banner reserved for missing-secret case. AC6 — 502 unreachable is distinct from disabled.
**Action:** Branch the status query on actual HTTP code:
- `200` → `{ enabled: true }` (happy path)
- `503` → `{ enabled: false, reason: body.reason ?? "missing" }` (the spec's documented disabled state)
- everything else → **throw** so TanStack Query surfaces `isError` and the page renders `simulator-page-error` banner

Currently the hook collapses 401/403/404/5xx into "disabled", which is factually wrong and operator-misleading.

### **G3-02** (critical) — `useSwitchScenario` mutation error type doesn't extend the declared discriminated union
**Source:** Edge-hunter #8
**Files:** `packages/web/src/admin/simulator/useSimulatorDevices.ts:89-97, 105-153`
**Action:** `SimulatorSwitchError extends Error` is thrown, but consumers (DeviceRow's `onError`) read `err.kind` which is undefined because the runtime shape is `{ detail: SwitchScenarioError }`, not the union. The `errorMessage` switch falls through and returns undefined → empty toast.
**Fix:** Drop the `SimulatorSwitchError` class entirely. Throw `detail as unknown as Error` (with `.cause = detail` if needed) so the consumer reads the discriminated union directly. Or rename the mutation's `TError` to `Error & SwitchScenarioError` and unwrap `.detail` in the row's onError.

### **G3-03** (critical) — Disabled-banner query path on api-side 503 surfaces "Simulator unreachable" toast, not the banner
**Source:** Acceptance #1, Verification-gap #1 ripple
**Files:** `packages/web/src/admin/simulator/useSimulatorDevices.ts:133-147` (and `SimulatorPage.tsx:42-55`)
**Spec:** AC2 — "operator-facing signal is 'simulator is disabled', not 'something went wrong'" on api-side missing env.
**Action:** When a Switch POST returns 503 with `{ disabled: true }`, the mutation should invalidate the status query (or treat the response as a transition into the disabled banner state), not surface a transient "Simulator unreachable" toast. Map 503 (with disabled body) to a transition signal; map other 502 to `simulator_unreachable` toast.

### **G3-04** (critical) — 403 secret_mismatch on Switch click surfaces only a transient toast; spec mandates the same disabled-banner state as missing-secret
**Source:** Acceptance #2
**Files:** `packages/web/src/admin/simulator/useSimulatorDevices.ts:99-103, 134-136`, `SimulatorPage.tsx:42-55, 119-162`
**Spec:** AC8 — "the UI shows the same disabled banner state as missing-secret" on secret-mismatch.
**Action:** On `secret_mismatch` from a Switch POST, invalidate `["admin", "simulator", "status"]` so the disabled-banner branch renders (not a transient toast that disappears after 4s with no recovery affordance). Same treatment as G3-03.

### **G3-05** (critical) — `paused` local state in DeviceRow is initialized to `false` and never re-synced from server
**Source:** Edge-hunter #2, #3, Acceptance #3, Verification-gap #3
**Files:** `packages/web/src/admin/simulator/DeviceRow.tsx:39, 144-167`
**Action:** The `useState(false)` initializer causes double-pause / unpause flicker: a device paused by another admin shows "Pause" on first render; clicking flips server to resumed (but UI says "Resume"); if server was actually paused, clicking sends `{ paused: true }` toggling the wrong way. **Defer the full server-state resolution to a follow-up story** (spec doesn't currently expose `paused` in `SimulatorDevice`), but in the meantime, ensure that on a Switch click the row reads the local `paused` state and sends `{ scenario, paused }` together so the device can't end up "stuck paused" after a scenario switch.

### **G3-06** (major) — `useSimulatorDevices` returns the response body parsed but never validates shape — wire drift silently renders 0 devices
**Source:** Verification-gap #15
**Files:** `packages/web/src/admin/simulator/useSimulatorDevices.ts:59-69`
**Action:** Add a Zod schema (`DevicesResponseSchema = z.object({ devices: z.array(SimulatorDeviceSchema) })`) at the wire boundary; throw on `safeParse` failure. This catches the silent-zero-devices regression.

### **G3-07** (major) — No tests for AC5 (400 invalid_scenario), AC8 (403 secret_mismatch), AC1 (Start button) or the loading/disabled-only branches
**Source:** Blind-hunter #1-#6, #13-#14, Acceptance #4
**Files:** `packages/web/src/admin/simulator/SimulatorPage.spec.tsx`
**Action:** Add the following missing tests:
- 400 invalid_scenario → toast "Switch failed: invalid input."
- 403 secret_mismatch → toast "Simulator disabled."
- Pause success path → button label transitions to "Resume"
- Devices 5xx → simulator-page-error banner
- Loading state → simulator-page-loading visible before queries settle
- 409 / 502 toast **text** (not just presence)
- TanStack Query cache invalidation after Switch success (count `GET /devices` calls)
- `useSimulatorStatus` "treat non-200 as disabled" fallback (500, malformed JSON)

### **G3-08** (major) — Toast `id` collision risk: `Date.now() + Math.random()` can collide when toasts burst in same ms
**Source:** Edge-hunter #10, #11, Verification-gap #4
**Files:** `packages/web/src/admin/simulator/SimulatorPage.tsx:62-68`
**Action:** Replace with a monotonic ref-based counter (`useRef(0); id: ++idRef.current`). Deterministic, immune to clock skew.

### **G3-09** (major) — Toast TTL `setTimeout` not cleared on unmount — setState on unmounted component + timer leak
**Source:** Edge-hunter #11, Verification-gap #5
**Files:** `packages/web/src/admin/simulator/SimulatorPage.tsx:62-68`
**Action:** Track timer handles in a `useRef<Set<number>>` and clear them in a `useEffect` cleanup. Or use a single ticking effect that removes toasts whose `id` is older than `TOAST_TTL_MS`.

### **G3-10** (major) — `errorMessage` falls through silently on non-`SimulatorSwitchError` errors (network failures produce empty toast)
**Source:** Edge-hunter #12
**Files:** `packages/web/src/admin/simulator/SimulatorPage.tsx:42-55`, `useSimulatorDevices.ts:130-148`
**Action:** Branch on `err instanceof Error` (and not the discriminated union) — treat as `simulator_unreachable` with the existing toast. Network errors are the most common failure mode for an admin click; empty toast is unacceptable UX.

### **G3-11** (major) — Status query runs for unauthenticated visitors on every page load (F-2.5-15 ripple — wire drift between api's `{ disabled: true }` and web's `{ enabled: false }`)
**Source:** Edge-hunter #4, Verification-gap #7
**Files:** `packages/web/src/admin/simulator/useSimulatorDevices.ts:40-57`
**Spec:** I/O matrix line 47 — api returns 503 with `{ disabled: true, reason: "missing" }`. Web falls back to synthesized `{ enabled: false }` shape.
**Action:** Read `body.enabled === true` as the success check. Treat absence of `enabled: true` (or presence of `disabled: true`) as disabled. Surface the api's body shape verbatim (no synthesized object). Update `SimulatorStatus` TS type to include `disabled: boolean` for documentation.

### **G3-12** (major) — Devices error path renders red banner but lacks a "Retry" button
**Source:** Edge-hunter #13
**Files:** `packages/web/src/admin/simulator/SimulatorPage.tsx:99-115`
**Action:** Add a "Retry" button alongside the red banner that calls `devicesQuery.refetch()`. Hide the banner as soon as the refetch succeeds.

### **G3-13** (major) — `.env.example` documents `VITE_API_BASE_URL` but code never reads it (literal `"/api"` hardcoded in `main.tsx:122`)
**Source:** Edge-hunter #1, Verification-gap #24
**Files:** `packages/web/.env.example:11`, `packages/web/src/main.tsx:122`
**Action:** Either consume `import.meta.env.VITE_API_BASE_URL` in `apiClient.ts` (use `import.meta.env.VITE_API_BASE_URL ?? "/api"`) so vite-dev proxy still works AND docker-compose Story 6.1 can point at `http://api:3000`; or delete the `.env.example` line entirely and document that the SPA uses the same-origin `/api` proxy. Fix the wrong docker-compose claim.

### **G3-14** (major) — `paused` state and Switch submit don't bundle scenario + paused together — device can end up "stuck paused" after a scenario switch
**Source:** Edge-hunter #2
**Files:** `packages/web/src/admin/simulator/DeviceRow.tsx:44-70, 131-140`
**Action:** Track the row's local `paused` and submit `{ scenario, paused }` together on Switch to keep them in lockstep. If `paused === device.scenario` (no real change), short-circuit the submit to avoid audit-log noise.

### **G3-15** (major) — Token refresh failure during `useSimulatorDevices` navigates to /login but TanStack retries — flicker loop
**Source:** Edge-hunter #2
**Files:** `packages/web/src/admin/simulator/useSimulatorDevices.ts:59-69`, `packages/web/src/api/apiClient.ts:222-244`
**Action:** Add a `meta: { skipRetryOnAuth: true }` opt-out in the queryClient default options and apply it to the admin simulator queries, OR have apiFetch return a sentinel `Error` with `cause: 'redirected'` after a navigate, so the queryFn can short-circuit. At minimum, add `retry: false` for queries with `meta.skipRetryOnAuth`.

### **G3-16** (major) — `<select>` doesn't re-sync to `device.scenario` after parent invalidation — stale "switch to" value
**Source:** Edge-hunter #6
**Files:** `packages/web/src/admin/simulator/DeviceRow.tsx:36-37, 110-127`
**Action:** Sync `selected` to `device.scenario` via `useEffect(() => setSelected(device.scenario ?? "Normal"), [device.device_id, device.scenario])`. Without this, admin sees "Scenario badge: RisingTDS, <select>: TurbiditySpike" and clicks Switch, posting TurbiditySpike.

### **G3-17** (minor) — Disabled-banner test mock returns 503 with `{ enabled: false }` but production api returns `{ disabled: true }` (per G3-11 fix above, both shapes are correct, but the test should match production shape)
**Source:** Verification-gap #7
**Files:** `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:162-178`
**Action:** Update the 503-disabled mock to return `{ disabled: true, reason: "missing" }` (matching the api's actual wire contract from G2-01). After G3-11 lands, the hook will pass this through verbatim.

### **G3-18** (minor) — UUID rendered verbatim with no truncation; overflows narrow viewports
**Source:** Edge-hunter #18
**Files:** `packages/web/src/admin/simulator/DeviceRow.tsx:90-96`
**Action:** Add Tailwind `truncate` class to the UUID `<p>`, or `break-all` to wrap intentionally. Update the docstring to reflect the chosen behavior (it currently claims "truncated UUID" but the implementation doesn't truncate).

---

## DISMISSALS (not defects / out of scope for 2.5)

- **G3-D1** — Test infra viewport setup (Blind-hunter #30) — cosmetic, no production impact.
- **G3-D2** — Test `vi` unused imports (Blind-hunter #48) — false alarm, `vi.fn()` IS used.
- **G3-D3** — `BANNER_` vs `TOAST_` constant naming (Verification-gap #46) — cosmetic.
- **G3-D4** — Disabled banner `aria-live` redundant with `role="status"` (Edge-hunter #15) — accessibility nit, not a bug.
- **G3-D5** — `<select>` accessible name is correct (Verification-gap #41) — false alarm, label wrapping is correct.
- **G3-D6** — `DISABLED_BANNER_COPY` exported but unused outside module (Verification-gap #21) — intentional export so the spec can pin it via test.
- **G3-D7** — `queryClient` constructed at module load (Verification-gap #23) — intentional singleton; tests build their own with retry:false for isolation.
- **G3-D8** — `simulatorPage.spec.tsx` `endsWith` path matching (Verification-gap #34) — current matching is exact enough; latent fragility only.
- **G3-D9** — `DeviceRow.submit` `overrides.onError` field unused (Verification-gap #35) — defensive future-proofing, not a defect.

---

## DEFERRALS (out of Story 2.5 scope)

- **F-2.5-17** — `paused` server-truthful state in `SimulatorDevice` (G3-05 partial): The api's `/devices` listing doesn't expose `paused` per device. Group 2 left this as a Group 3 gap. The full resolution (server-truthful pause state) is owned by a future story that extends the device surface; for v1 we ship the local-state UX with a documentation note that "Pause state is client-side after the first click" (acceptance-auditor #12). **Owned by: Epic 3 (telemetry/devices model).**
- **F-2.5-18** — Start button vs Pause/Resume toggle semantic collapse (Acceptance #3): The spec AC1 enumerates "Start / Pause / Switch" controls but Group 2's setPaused-only model folded "Start" into Pause/Resume via `paused: false`. The spec change log should record this consolidation. **Owned by: spec amendment (acceptance-auditor #13).**
- **F-2.5-19** — RBAC downgrade handling mid-session (Verification-gap #11): The page renders generic error when api 403's because token role downgraded; full `<RbacDenied />` re-routing from the page requires tighter coupling between apiClient interceptor and the page. **Defer to RBAC hardening (Epic 7).**
- **F-2.5-20** — StrictMode double-fire masking (Edge-hunter #14): Not a production bug; documented behavior. **Defer.**
- **F-2.5-21** — Status query `refetchInterval` for secret rotation (Edge-hunter #12): Adding a polling interval to status is a UX trade-off that should be reviewed with the operator. **Defer to operator-triage story (Epic 3).**

---

## SPEC DRIFT (logged, not patched in code)

- **SPEC-DRIFT-1** — Wire-contract literal: I/O matrix line 47 says `503 { disabled: true }`; Group 3 acceptance audit caught that the SPA falls back to synthesizing `{ enabled: false }`. **Resolution:** G3-11 (read `disabled: true` verbatim) closes the gap. Document in spec change log.
- **SPEC-DRIFT-2** — AC1 narrative enumerates "Start / Pause" but only Pause/Resume toggle exists. **Resolution:** F-2.5-18 documents the consolidation.
- **SPEC-DRIFT-3** — AC8 says "same disabled banner state as missing-secret" but impl uses toast. **Resolution:** G3-04 transitions to banner via cache invalidation.

---

## SUMMARY

- **18 patches** to apply across 11 files (G3-01..G3-18)
- **9 dismissals** (no action)
- **5 deferrals** (F-2.5-17..F-2.5-21)
- **3 spec drifts** logged for future amendment

The patches break down into 4 critical (G3-01..G3-04: status-query outage masking, error-type contract, banner-vs-toast routing on 503/403), 9 major (G3-05..G3-16: pause/server-truth, wire validation, missing tests, toast mechanics, error fallback, retry button, env-var, paused-bundling, token-refresh, select-sync), 2 minor (G3-17, G3-18: test fixture, UUID truncation).

After patches: verification cycle (test, lint, typecheck), then commit.