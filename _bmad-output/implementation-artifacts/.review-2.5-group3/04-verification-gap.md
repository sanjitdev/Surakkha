**Finding 1 (critical)**: No test for AC5 — unknown scenario 400 `validation_error`
  - AC / behavior: AC5 — "POST with `{ scenario: "Bogus" }` → 400 `{ error: "invalid_scenario" }`; toast renders"
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx` (no `validation_error` describe block)
  - Gap: The `errorMessage()` switch in `SimulatorPage.tsx:50-51` has a `"validation_error" → "Switch failed: invalid input."` branch that is not covered by any test. The typed `SwitchScenarioError` union in `useSimulatorDevices.ts:86` includes `validation_error`, and `useSwitchScenario` maps `HTTP_BAD_REQUEST` to it (line 100). Neither the mapping nor the user-facing toast string is asserted. Spec says this row must surface a toast — currently zero coverage.
  - Suggested test: Add `describe("Story 2.5 — 400 invalid_scenario surfaces as an error toast")` with a fetch mock returning `400 { error: "invalid_scenario" }` after a Switch click; assert `simulator-toast-error` renders with text `"Switch failed: invalid input."`.

**Finding 2 (critical)**: No test for AC8 — secret_mismatch 403 path on Switch
  - AC / behavior: AC8 — secret mismatch → api 403 `{ error: "secret_mismatch" }` → UI shows same disabled-banner-state toast ("Simulator disabled.")
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx` (no 403 test); `packages/web/src/admin/simulator/useSimulatorDevices.ts:99-103, 135-136` maps 403 → `secret_mismatch`; `SimulatorPage.tsx:44-45` toast says "Simulator disabled."
  - Gap: The 403→secret_mismatch mapping is reachable in production but no test verifies either the `kind` mapping or the toast string. The 409 test reuses a similar shape but does not assert the 403 path. AC8 explicitly requires the secret-mismatch toast wording to match the disabled banner state — currently unverified.
  - Suggested test: Add `it("shows 'Simulator disabled.' toast on 403 secret_mismatch")` mocking `POST .../scenario` → 403 `{ error: "secret_mismatch" }`; assert `simulator-toast-error` textContent === "Simulator disabled.".

**Finding 3 (major)**: No test for AC4 — success-toast text and audit-row link is asserted only by URL, not by toast body
  - AC / behavior: AC4 — Switch success → toast "Switched to <scenario>." and an `AuditLog` row written server-side
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:201-238` ("POSTs the new scenario and shows a success toast")
  - Gap: The test asserts `simulator-toast-success` exists but never asserts the toast text equals `"Switched to RisingTDS."`. The `DeviceRow.submit()` builds the message as `Switched to ${body.scenario}.` (`DeviceRow.tsx:56`) — a regression that hardcoded the message would slip through. Additionally, no assertion that `POST` body shape is `Content-Type: application/json` (the api requires it).
  - Suggested test: Extend the happy-path test to assert `screen.getByTestId("simulator-toast-success").textContent === "Switched to RisingTDS."`. Add `expect(posted[0].init.headers["Content-Type"]).toContain("application/json")` (or whatever the apiFetch wrapper sets).

**Finding 4 (major)**: Pause success path ("Resume" label) is not tested
  - AC / behavior: Pause button label transitions `Pause → Resume` after a successful pause mutation (P0 toggle UX)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:283-317` ("POSTs { paused: true } when the Pause button is clicked")
  - Gap: The test only asserts the POST went out; it never asserts the button text changes to `"Resume"` after the success callback. `DeviceRow.tsx:152-156` defers `setPaused(next)` to the mutation's onSuccess; the only test that exercises this deferred state is the failure-revert test, which by construction never flips the label. A regression where the success callback is dropped (button stays "Pause" forever) would pass all current tests.
  - Suggested test: Add `it("changes the Pause button label to 'Resume' after a successful pause")`; assert `getByTestId('simulator-row-pause-${DEVICE_C}').textContent === "Resume"` after the success toast surfaces.

**Finding 5 (major)**: Devices query error path (`simulator-page-error` testid) is not tested
  - AC / behavior: When `/admin/simulator/devices` returns 5xx while `/status` returns 200, the page should render the "Failed to load devices. Reload the page." banner (`SimulatorPage.tsx:99-115`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx` (no such describe block)
  - Gap: `SimulatorPage.tsx:99-115` has a dedicated error branch with testid `simulator-page-error`, but no test exercises `/devices → 500` while `/status → 200`. The hook `useSimulatorDevices` throws on `!res.ok` (line 65) and the page handles it via `devicesQuery.isError` — neither path is verified. A regression where the catch branch swallows the error silently (e.g. always returning `{ devices: [] }`) would render the page with zero rows and pass every existing test.
  - Suggested test: Mock `/status → 200 { enabled: true }` and `/devices → 500`; assert `simulator-page-error` is in the document and `simulator-page` is not.

**Finding 6 (major)**: Loading state is never asserted
  - AC / behavior: TanStack Query initial fetch shows `simulator-page-loading` with "Loading…" copy before the disabled/enabled branch resolves
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:71-78`; `SimulatorPage.spec.tsx` — no test calls `screen.getByTestId("simulator-page-loading")`
  - Gap: All existing tests `await waitFor(...)` past the loading state, so the loading UI is unverified. The state machine has three branches (loading / disabled / enabled / error) but only two are tested. A regression where `useQuery.isLoading` is misread as `data === undefined` could collapse loading into the disabled branch silently.
  - Suggested test: Mount the component with `installFetch` that *never resolves* (e.g. `new Promise(() => {})`) for `/status`; assert `simulator-page-loading` is in the document and `simulator-page-disabled` is not.

**Finding 7 (major)**: TanStack Query cache invalidation after Switch success is not asserted
  - AC / behavior: After a successful Switch, `useSimulatorDevices` should re-fetch so the row's scenario badge reflects the new scenario from the api (`useSimulatorDevices.ts:150-152`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:201-238`
  - Gap: The happy-path test asserts only that the POST fired and a success toast appeared — it does not verify the `invalidateQueries({ queryKey: ["admin","simulator","devices"] })` call. If the `onSuccess` callback is accidentally removed, the badge would never refresh and no test would fail.
  - Suggested test: In the success-path test, count `GET /admin/simulator/devices` calls; after the Switch resolves, assert the call count increased (proving invalidation re-fetched the list).

**Finding 8 (major)**: `useSimulatorStatus` "treat any non-200 as disabled" fallback is not tested
  - AC / behavior: When `/status` returns 500, 401, 404, or has a network blip, the hook should resolve to `{ enabled: false, reason: "missing" }` rather than throwing (`useSimulatorDevices.ts:45-56`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx` — only the 503 happy path for `/status` is tested
  - Gap: The comment explicitly states "Treat any non-200 as 'disabled' so a 5xx / network blip doesn't crash the page." No test verifies this behavior for 500, 404, or malformed JSON body. A regression where the fallback path is removed (e.g. only matches 503) would make a transient `/status` 500 show the page-level error banner instead of the calm disabled banner.
  - Suggested test: Add tests for `/status → 500` and `/status → 200 with non-JSON body`; both should render `simulator-page-disabled`, not `simulator-page-error`.

**Finding 9 (major)**: `useSimulatorStatus` `skipAuth: true` behavior is not asserted
  - AC / behavior: Status endpoint is anonymous so the disabled banner renders for unauthenticated users (`useSimulatorDevices.ts:38-44`)
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:44`; test does not inspect `init.credentials` or headers
  - Gap: No assertion that the `/status` call has no Authorization header (or whatever `skipAuth` implies in `apiClient.ts:191`). A regression where `skipAuth` is dropped or renamed would mean the disabled banner stops rendering for logged-out visitors — exactly the v1 use-case the spec calls out (AC2's framing). The apiClient path is the production behavior; the test mocks `globalThis.fetch` but never inspects the request shape.
  - Suggested test: In the 503-status test, capture the `init` object passed to fetch; assert it does not include an `Authorization` header (or whatever the `skipAuth` contract is in `apiClient.ts:191`).

**Finding 10 (major)**: Toast auto-dismiss (4-second TTL) is not tested
  - AC / behavior: `SimulatorPage.pushToast` removes the entry after `TOAST_TTL_MS = 4_000` (`SimulatorPage.tsx:65-67`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:31`
  - Gap: No test waits for the toast to disappear. A regression where the `setTimeout` is dropped would mean toasts accumulate forever and pass all current assertions.
  - Suggested test: Use `vi.useFakeTimers()`; trigger a Switch success; advance time by 4_001 ms; assert `simulator-toast-success` is no longer in the document.

**Finding 11 (major)**: Multiple toasts stacking is not tested
  - AC / behavior: Clicking Switch on two devices in quick succession should produce two stacked toasts (one per row)
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:60-68` (toast state is an array)
  - Gap: The toast region (`simulator-toast-region`) is only ever asserted with a single toast entry. The `pushToast` function is called from `DeviceRow`'s `onSuccess`/`onError` callback; cross-row behavior is unverified.
  - Suggested test: Click Switch on DEVICE_A and DEVICE_B with a successful 200 response for both; assert two `simulator-toast-success` elements are in the document.

**Finding 12 (major)**: Pause button `disabled` state during in-flight mutation is not asserted
  - AC / behavior: `DeviceRow.tsx:135, 142-143` — the Switch and Pause buttons are `disabled={isPending}` while the mutation is in flight
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:135-143`
  - Gap: No test asserts `pauseButton.disabled === true` (or `switchButton.disabled === true`) while the mutation is pending. The `useMutation` `isPending` wiring is the heart of the optimistic-update story; a regression that drops `disabled={isPending}` would allow double-click races that the 409 test only catches at the API layer.
  - Suggested test: Use a fetch mock that returns a never-resolving Promise; click Switch; assert `simulator-row-switch-${DEVICE_A}.disabled === true` and `simulator-row-pause-${DEVICE_A}.disabled === true`.

**Finding 13 (major)**: 409 toast text is not asserted
  - AC / behavior: 409 `switch_in_progress` → toast "Another switch is in progress." (`SimulatorPage.tsx:48-49`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:364-394`
  - Gap: The test only checks `simulator-toast-error` is present. The user-facing string `"Another switch is in progress."` is never asserted.
  - Suggested test: Extend the 409 test to assert `screen.getByTestId("simulator-toast-error").textContent === "Another switch is in progress."`.

**Finding 14 (major)**: 502 toast text is not asserted
  - AC / behavior: 502 `simulator_unreachable` → toast "Simulator unreachable." (`SimulatorPage.tsx:46-47`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:241-280`
  - Gap: Same as Finding 13 — the test asserts only that the error toast surfaces, not its text. A regression that misroutes the toast tone would pass.
  - Suggested test: Extend the 502 test to assert `simulator-toast-error.textContent === "Simulator unreachable."`.

**Finding 15 (major)**: `useSimulatorDevices` and `useSwitchScenario` hooks have zero direct unit tests
  - AC / behavior: The hook layer owns the typed-error mapping (400/403/409/502/503 → kind), the cache invalidation, the request body shape, and the URL encoding
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts`
  - Gap: All hook coverage comes through `SimulatorPage.spec.tsx`, which means changes to the hook's error mapping or URL construction are tested only as side-effects of the page render. Direct hook tests would isolate: (a) the body has `Content-Type: application/json`, (b) `encodeURIComponent` is applied to deviceId, (c) the 5-error-kind union is exhausted by status codes, (d) `invalidateQueries` is called on success.
  - Suggested test: Add `useSimulatorDevices.spec.ts` with `renderHook` from `@testing-library/react`; test each error-kind mapping by mocking `apiFetch` to return the relevant status; assert the thrown `SwitchScenarioError.detail.kind` matches.

**Finding 16 (major)**: `DisabledBanner` has no dedicated unit test asserting pinned copy or `role="status"`
  - AC / behavior: AC2 — banner copy is pinned: `"Simulator disabled. Set SIMULATOR_SECRET."`. Spec calls out the calm `role="status"` aria-live behavior.
  - File: `packages/web/src/admin/simulator/DisabledBanner.tsx:13-29`; no `DisabledBanner.spec.tsx`
  - Gap: The export `DISABLED_BANNER_COPY` is the contract — it's exported specifically so a test can pin it — but no test pins it. The `role="status" aria-live="polite"` attributes are not asserted anywhere. A regression where the copy is shortened to "Simulator disabled." (dropping the actionable hint) would slip through.
  - Suggested test: Add `DisabledBanner.spec.tsx` asserting `DISABLED_BANNER_COPY === "Simulator disabled. Set SIMULATOR_SECRET."` and the rendered banner has `role="status"` + `aria-live="polite"`.

**Finding 17 (major)**: `DeviceRow` `<select>` is not asserted to render exactly 7 `SCENARIO_NAMES` options
  - AC / behavior: `DeviceRow.tsx:122-126` renders one `<option>` per `SCENARIO_NAMES` from `@surakkha/shared/simulator`
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:121-127`
  - Gap: No test asserts the option count, the option values, or that the `<select>` defaults to the device's current scenario. A regression where the import is broken (returning an empty array) would render a select with zero options and the Switch button would POST `scenario: ""`, but every existing test passes `selected` from a default in DEVICE_LIST.
  - Suggested test: Assert `simulator-row-select-${DEVICE_A}` has exactly 7 child `<option>` elements with values `["Normal","RisingTDS","TurbiditySpike","ChlorineDrop","Offline","RandomFailure","SensorDrift"]` (or whatever the current closed enum is).

**Finding 18 (major)**: Switch happy-path test asserts the wrong URL fragment (DEVICE_B) but the body uses DEVICE_B's pre-selected "RisingTDS" without a user-driven change
  - AC / behavior: AC4 — user changes `<select>` from current scenario to a new scenario, clicks Switch, and the POST body reflects the user choice (not the row's `useState` default that happens to match)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:223-237`
  - Gap: The test clicks the Switch button but never fires a `change` event on the `<select>` to pick a different scenario. The body asserts `scenario: "RisingTDS"` because DEVICE_B's `device.scenario` is "RisingTDS" AND `useState(device.scenario ?? "Normal")` defaults to it AND the spec validates against the same enum. The local `selected` state could be broken in a way that always sends the initial value; the test wouldn't catch it.
  - Suggested test: Click the `<select>` to change DEVICE_A from "Normal" to "ChlorineDrop" via `user.selectOptions`, then click Switch; assert body is `{ scenario: "ChlorineDrop" }`.

**Finding 19 (major)**: Mocked fetch returns canned data even when apiFetch wrapper would have transformed it
  - AC / behavior: `apiFetch` auto-attaches Bearer + refresh; `useSimulatorStatus` passes `{ skipAuth: true }` which must bypass that
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:114-118` (globalThis.fetch override)
  - Gap: The tests install a `globalThis.fetch` mock, but `apiClient.ts:191` likely wraps fetch with bearer headers, retry, and offline detection. By stubbing `globalThis.fetch` directly, the test bypasses the wrapper entirely. A regression where `useSimulatorStatus` accidentally drops `skipAuth: true` would not be caught — the mocked fetch always returns whatever the test says regardless of the wrapper.
  - Suggested test: Either (a) mock at the `apiFetch` module boundary via `vi.mock("../../api/apiClient")` so the wrapper is exercised, or (b) explicitly assert in at least one test that `init.headers` includes / excludes the Authorization header per the `skipAuth` contract.

**Finding 20 (major)**: `queryClient.ts` has no unit test that asserts singleton / config
  - AC / behavior: The `queryClient` is configured with `staleTime: 5_000`, `retry: 1`, `refetchOnWindowFocus: false`, `mutations.retry: 0` (`queryClient.ts:16-26`)
  - File: `packages/web/src/queryClient.ts`; no `queryClient.spec.ts`
  - Gap: A regression that flips `retry: 1 → retry: 0` (or `staleTime: 5_000 → 0`) would change production UX (auto-retry on transient failures, sticky cache) with zero test signal. The spec mandates `retry: 1` explicitly.
  - Suggested test: Add `queryClient.spec.ts` asserting `queryClient.getDefaultOptions().queries?.retry === 1`, `staleTime === 5_000`, `refetchOnWindowFocus === false`, `mutations.retry === 0`. Also assert that the import returns the same instance across two imports (singleton invariant).

**Finding 21 (major)**: `main.tsx` wraps the entire route tree in `<QueryClientProvider>` — no test that other routes still work
  - AC / behavior: Cross-cutting bootstrap — every authenticated route should have access to the same `queryClient` (`main.tsx:172-175`)
  - File: `packages/web/src/main.tsx:172-175, 324-325`
  - Gap: The diff inserts `<QueryClientProvider>` and `</QueryClientProvider>` around `<BrowserRouter>`. No integration test mounts the full `main.tsx` (or a comparable harness) and asserts that, e.g., the dashboard route still renders inside the provider. A regression where the closing `</QueryClientProvider>` is misplaced (e.g. wrapping only the login route) would only show up as "useQuery must be used inside QueryClientProvider" runtime errors on dashboard pages — and no test would catch it.
  - Suggested test: Add an integration test that mounts `main.tsx` (or a stripped harness) and renders `/dashboard`; assert no `QueryClient` provider error is logged.

**Finding 22 (minor)**: Disabled banner test asserts 503 only — never tests `enabled: false` returned with a 200 status
  - AC / behavior: The hook maps any non-200 to disabled (`useSimulatorDevices.ts:50-56`), but the page also short-circuits on `data.enabled === false` (`SimulatorPage.tsx:85`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:162-178`
  - Gap: The disabled path is only tested via the 503 fallback. The primary path (200 with `{ enabled: false, reason: "missing" }`) is never asserted, despite the comment on `SimulatorPage.tsx:80-84` saying it's the operator-facing signal. Both should be tested.
  - Suggested test: Add `it("renders disabled banner when /status returns 200 { enabled: false }")` mocking `/status → 200 { enabled: false, reason: "missing" }`; assert `simulator-disabled-banner` is in the document.

**Finding 23 (minor)**: SPEC link for Start button vs Pause is unresolved but no test fails
  - AC / behavior: AC says "Start / Pause / Switch scenario" (`2-5-admin-simulator-tab.md:126`); the Ask-First on Pause semantics was deferred, and the spec resolves the Start button to the *switch* control while Pause becomes the toggle
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:141-167`
  - Gap: There is no "Start" button in the row at all — only "Pause"/"Resume". A reviewer reading the AC literally would expect a Start button. No test asserts the row contains / does not contain a Start button, so a future change that adds a third button or removes Pause wouldn't trip a test.
  - Suggested test: Assert `screen.queryByRole('button', { name: /start/i })` is null and `getByRole('button', { name: /pause|resume/i })` is present. (Low priority but the AC matrix should drive coverage.)

**Finding 24 (minor)**: `setSelected` reverts to `useState(device.scenario ?? "Normal")` only on mount — no test for `key` re-mount behavior when the device list changes
  - AC / behavior: When `invalidateQueries` refetches the device list, the `<DeviceRow key={d.device_id} />` preserves the local `<select>` state across refetches (`SimulatorPage.tsx:132-138`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:132`; `DeviceRow.tsx:36-38`
  - Gap: No test verifies that after a successful Switch, the local `<select>` state does NOT reset to the stale scenario. A regression where the row drops `key={d.device_id}` and React reconciles by index would silently break the optimistic UX.
  - Suggested test: After a successful Switch, assert the `<select>` value matches the new scenario (not the old one). Currently the spec explicitly avoids optimistic updates, but the test should still prove the controlled component doesn't lose state on re-render.

**Finding 25 (minor)**: `pushToast` uses `Date.now() + Math.random()` as key — flaky under burst
  - AC / behavior: Two toasts in the same ms would collide; React would drop one silently
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:62-68`
  - Gap: No test exercises simultaneous toasts (Finding 11 partially covers, but not the same-tick collision). The id generation is fragile and unverified.
  - Suggested test: Click Switch on two devices with the fetch mock resolving synchronously; assert both toasts appear in `simulator-toast-region`. (Or use a monotonic counter instead of Math.random in the impl.)

**Finding 26 (minor)**: SPEC line 50 — `Api 5xx → toast "Switch failed"` — implementation differs ("Switch failed: invalid input.")
  - AC / behavior: Spec I/O matrix says "Api 5xx → toast 'Switch failed'" (`2-5-admin-simulator-tab.md:49`); the implementation maps `validation_error` to `"Switch failed: invalid input."` (`SimulatorPage.tsx:51`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:50-51`
  - Gap: The user-facing copy diverges from the spec. No test pins the spec-canonical copy. A reviewer reading only the implementation would think the spec is wrong.
  - Suggested test: Either (a) add a test that asserts the toast says "Switch failed." per spec, or (b) update the spec's I/O matrix to reflect the per-kind differentiation (preferred, since per-kind is better UX). Flag as a spec/implementation drift.

**Finding 27 (minor)**: `<DeviceRow>` renders inside `<AppShell>` with no assertion that it lands in the right outlet
  - AC / behavior: Story 1.4 wiring expects admin routes to render inside `AppShell`'s `<Outlet />`
  - File: `packages/web/src/main.tsx:262-273`; `SimulatorPage.spec.tsx:80-93`
  - Gap: The test wraps `<SimulatorPage />` in `<AppShell>` directly (`SimulatorPage.spec.tsx:78-93`), but `AppShell`'s `<Outlet />` is only populated by `<Routes>`. The harness duplicates the route wiring instead of mounting `<main.tsx>` — so it doesn't catch a regression where the route tree is misconfigured (e.g. AdminShell wraps the wrong outlet).
  - Suggested test: Add an integration test that uses `createMemoryRouter` + `RouterProvider` with the actual route definitions from `main.tsx` (or extracts them to a shared module).

**Finding 28 (minor)**: `useSimulatorStatus` fallback `body.reason ?? "missing"` swallows malformed body silently
  - AC / behavior: When `/status` returns 503 with non-JSON body, the hook still resolves to `{ enabled: false, reason: "missing" }` (`useSimulatorDevices.ts:51-55`)
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:51-55`
  - Gap: No test exercises the `res.json().catch(...)` path. A regression where the catch is removed would crash on malformed bodies — and no test would fail because every test returns valid JSON.
  - Suggested test: Mock `/status → 503` with body `"not-json"`; assert the page renders `simulator-page-disabled` (not a runtime crash).

**Finding 29 (minor)**: No test for `useSimulatorStatus` JSON shape `enabled: true` (only `{ enabled: true }` happy path)
  - AC / behavior: The status hook should pass through `{ enabled: true }` to `SimulatorPage` which then enables the rows
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:45-47`; `SimulatorPage.tsx:85`
  - Gap: The "rows render" test only indirectly verifies this. A regression where the hook returns `{ enabled: false }` on the happy path would not be caught.
  - Suggested test: Already covered indirectly by `renders six DeviceRow instances` test, but a direct assertion `expect(statusQuery.data).toEqual({ enabled: true })` would isolate the hook.

**Finding 30 (nit)**: `setViewport(1280)` is set in `beforeEach` but unused (only `width >= 1024` checks done)
  - AC / behavior: N/A (test harness quality)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:120-127`
  - Gap: Test infra always sets viewport to 1280; no test actually exercises a different viewport for the device grid (`md:grid-cols-2` breakpoint). Low priority — the simulator grid breakpoint is an implementation detail.
  - Suggested test: Optional — add a viewport-mutation test if the layout is part of the contract.

**Finding 31 (nit)**: Tests do not assert that `queryClient` is the singleton from `queryClient.ts` (the test builds its own)
  - AC / behavior: The spec mandates "exactly one QueryClient per app" (`queryClient.ts:7-9`)
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:73-76`
  - Gap: Each test calls `buildQueryClient()` to create a fresh instance with `retry: false`. This masks any global-config regression in `queryClient.ts` (Finding 20) and means the tests don't exercise the production singleton. If `main.tsx` accidentally creates a second client, the tests would still pass because they bypass `main.tsx`.
  - Suggested test: At least one happy-path test should mount `main.tsx`'s rendered output (or import `queryClient` directly) instead of building a fresh `QueryClient`. Combined with Finding 21.

**Finding 32 (nit)**: `.env.example` is a docs file — no test pins the absence of `SIMULATOR_SECRET` on the web side
  - AC / behavior: `.env.example` documents that `SIMULATOR_SECRET` MUST NOT be set in the web package (Spec Boundaries & Constraints, line 36)
  - File: `packages/web/.env.example:1-11`
  - Gap: A regression where someone adds `SIMULATOR_SECRET=...` to the web `.env.example` (or accidentally imports it into a build) would pass all current tests. The spec explicitly forbids the web app from needing the secret.
  - Suggested test: Add a static assertion test (e.g. `webEnvExample.spec.ts`) that reads `packages/web/.env.example` and asserts it does not contain `SIMULATOR_SECRET`. Low priority — this is policy drift detection.
