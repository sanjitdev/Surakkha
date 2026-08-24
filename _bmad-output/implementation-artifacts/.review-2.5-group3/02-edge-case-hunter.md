**Finding 1 (critical)**: Disabled-banner query path silently swallows ALL non-200 status responses as `{ enabled: false }`, including 401 (stale/missing token on the public route is impossible, but a misconfigured origin returning 401) and 5xx crashes — operators get a misleading "disabled" banner instead of a real error.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:43-57`
  - Edge case: api returns 401, 500, network error, or any non-200 → the queryFn falls through to the catch-all and synthesizes `{ enabled: false, reason: ... }`. TanStack Query treats this as a successful resolve (no error thrown), so the page renders the disabled banner with no diagnostic surface.
  - Impact: When the api is genuinely broken (500/CORS/network), the admin sees "Simulator disabled. Set SIMULATOR_SECRET." — the same banner they see when the operator forgot to set the secret. Operators can spend hours debugging a misconfigured `SIMULATOR_SECRET` when the real cause is an outage or a 401 from the auth interceptor being attached by mistake.
  - Suggested fix: Only collapse to `{ enabled: false }` on the documented 503 shape. For everything else, throw so TanStack Query surfaces `isError` and the page can render its existing `simulator-page-error` banner; alternatively, branch on the actual status code returned by the public route.

**Finding 2 (critical)**: DeviceRow click handler posts BOTH `scenario` AND `paused` only when the explicit fields are supplied, but the api's body-builder drops `scenario` when `paused !== undefined` (see simulatorRouter.ts:389-391) — clicking "Switch" on a row whose select already shows a paused scenario silently drops the scenario change.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:44-70, 131-140`
  - Edge case: Admin selects scenario X via the dropdown, then clicks Switch — the call body is `{ scenario: "X" }` with `paused` undefined, which the api forwards correctly. But if the user picks scenario X from the select and a *prior* Pause/Resume call had committed `paused: false` server-side, the next Switch post will send `{ scenario: "X" }` — fine. The real hole is the inverse: the row never remembers the server's paused state and never bundles them, so a Switch after a Pause still posts only `scenario`, leaving the device paused under the new scenario.
  - Impact: Devices end up "stuck paused" after a scenario switch that the operator believed resumed simulation. There is no UI surface to know the device is still paused — the badge only shows scenario name.
  - Suggested fix: Track the device's authoritative `paused` state (server-truthful) in the cache (or alongside `scenario` in `SimulatorDevice`) and submit `{ scenario, paused }` together on Switch to keep the two in lockstep; at minimum, surface a "Paused" indicator on the row badge.

**Finding 3 (critical)**: Local `paused` state in DeviceRow is initialized to `false` and is NEVER re-synced from the server, so the toggle button label and color drift from reality on first mount and after every cache invalidation.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:39, 144-167`
  - Edge case: A device was paused by another admin (or by a prior session). When the row first renders, `useState(false)` makes the button say "Pause" and a click toggles to "Resume" but sends `{ paused: true }` (the *opposite* of what's already set on the server). After mutation success the row says "Resume" with the device still paused; after failure the row still says "Pause" with the device already paused.
  - Impact: Double-pause / unpause flicker and inconsistent authoritative state — the simulator flips back and forth across admins, and the UI lies about the current state. This is exactly the kind of multi-admin race the single-flight queue on the api is designed to mask, but the UI hides the failure.
  - Suggested fix: Derive `paused` from the device payload (or a query for an authoritative `paused` field) and make the button label match; do not keep a separate local state that drifts.

**Finding 4 (major)**: Toast `id` uses `Date.now() + Math.random()` which can collide when two toasts are pushed in the same millisecond from sibling rows, and React keys collide silently.
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:62-68`
  - Edge case: A burst of switch+pause clicks across multiple rows (or a single fast double-click) yields two toasts with the same numeric id. React renders duplicate keys → warning, and `setToasts((cur) => cur.filter((t) => t.id !== id))` will remove BOTH entries when the first TTL fires.
  - Impact: One toast disappears prematurely (paired with a real success/error), so a successful "Paused." toast vanishes 4s early and the user loses confirmation. The test-id `simulator-toast-${tone}` is also non-unique across rows, so tests that rely on `getByTestId("simulator-toast-success")` after a burst will match the wrong (or both) elements.
  - Suggested fix: Use `crypto.randomUUID()` (available in modern browsers and jsdom) or a monotonic counter scoped to the page; also key the DOM by the unique id, not the tone, in the testid suffix.

**Finding 5 (major)**: Toast TTL `setTimeout` is captured into `setToasts` state but never cleared on unmount, leaking timers and racing state updates.
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:62-68`
  - Edge case: Admin navigates away from `/admin/simulator` (or the SimulatorPage unmounts due to a route change) while a 4-second TTL timer is still pending. The timer fires `setToasts((cur) => cur.filter(...))` against an unmounted component — React 18 will warn and drop the update, but more importantly, every navigation away during a burst leaks a timer that holds a closure on `cur`.
  - Impact: Timer leak per toast (memory creep), React "setState on unmounted component" warnings, and in StrictMode a double-fire can wipe toasts that another instance is about to display.
  - Suggested fix: Track timer handles in a `useRef` and `clearTimeout` them in a `useEffect` cleanup; or use a single ticking effect that removes toasts whose `id` is older than `TOAST_TTL_MS`.

**Finding 6 (major)**: DeviceRow submit handler does not validate `body.scenario ∈ SCENARIO_NAMES` before POSTing — the `<select>` only renders the seven closed-enum names today, but if `SCENARIO_NAMES` is ever expanded without a deploy, the row will happily POST an unsupported name and surface a confusing "validation_error" toast instead of a developer-visible signal.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:36-38, 134`
  - Edge case: A future scenario added to `packages/simulator/src/scenarios.ts` but not yet mirrored in `packages/shared/src/simulator.ts` (the file is duplicated intentionally — see its own comment). The SPA select still has seven options; the api's `SCENARIO_SET` check uses the shared list; an old SPA build sends an old name → api returns 400.
  - Impact: Cross-deploy drift between api and web silently breaks Switch; users see "Switch failed: invalid input." with no diagnostic.
  - Suggested fix: Validate `selected` against `SCENARIO_NAMES` in the submit handler (use `ScenarioNameSchema.safeParse`) before POSTing; also test the rejection path.

**Finding 7 (major)**: Disabled-banner test mock returns 503 with `{ enabled: false, reason: "missing" }` but the production api now returns `{ disabled: true, reason: "missing" }` per simulatorRouter.ts:265-268 — the SPA's fallback shape `{ enabled: false, reason }` won't match the real response body, so the disabled path is only correctly tested by the *test* mock, not the production wire.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:45-57`
  - Edge case: Production GET `/admin/simulator/status` returns `{ disabled: true, reason: "missing" }` on 503 (simulatorRouter.ts:265). The SPA's `useSimulatorStatus` checks `res.status === 200` and otherwise synthesizes a fresh `{ enabled: false, ... }` — so the actual response body is parsed and *discarded*. The two surfaces are not aligned by wire (one says `disabled`, the other `enabled`), making it impossible for the SPA to ever observe `enabled: false` from a real 503 (it always synthesizes its own object).
  - Impact: The wire contract is split — `enabled: true` for the OK branch, `{ disabled: true }` for the not-OK branch — so any future code that branches on `statusQuery.data?.disabled` vs `statusQuery.data?.enabled === false` will be subtly broken. The contract comment in api says "unify", the SPA ignores it.
  - Suggested fix: Read `body.enabled === true` as the success check; treat absence of `enabled: true` (or presence of `disabled: true`) as disabled. Don't synthesize a fresh object — surface the api's body shape verbatim.

**Finding 8 (major)**: Status query runs with `{ skipAuth: true }` but a 401 still flows through `apiFetch` normally; `apiFetch`'s 401 branch is gated by `skipAuth`, so 401s on this public route are returned as-is — fine. But the test never exercises the case where the api returns 401 (e.g., when mistakenly mounted behind `authenticate` in some other env), and the SPA renders `{ enabled: false }` as if disabled, silently.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:44, 51-55`
  - Edge case: Production wiring places `buildAdminSimulatorPublicRouter` BEFORE `authenticate`, but a deploy that re-orders mount points, or a future route extraction, would surface 401 here. The status query's "any non-200 is disabled" rule silently hides that misconfiguration.
  - Impact: A configuration regression where the public route is accidentally authenticated goes undetected — operators see the disabled banner instead of "auth broken".
  - Suggested fix: For 401 specifically, log a warning or surface a degraded-but-distinct UI (e.g., "Service unavailable — retry"); don't lump 401/403/5xx/network into the disabled bucket.

**Finding 9 (major)**: `useSwitchScenario.onSuccess` invalidates the devices query, but the mutation error path is followed by a `setTimeout` cleanup that depends on `setToasts` surviving — if the user navigates away during the in-flight mutation, the success/error callback fires on an unmounted DeviceRow's `mutation` instance and either throws or fires after unmount, leaking state.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:105-154` and `DeviceRow.tsx:44-70`
  - Edge case: Admin clicks Switch on row A, then navigates to `/dashboard` before the POST resolves. The mutation continues; onSuccess or onError fires against the unmounted row, calling `onSuccess`/`onError` which in turn call `pushToast` on an unmounted parent. TanStack Query will warn "performing a React state update on an unmounted component".
  - Impact: React warnings in production console; in StrictMode dev, double-firing can produce double toasts; the `useSwitchScenario` instance has a stable `qc.invalidateQueries` which is fine, but the row's `submit` callback's `setPaused(next)` on success runs on an unmounted row.
  - Suggested fix: Guard the local `setPaused` and `pushToast` calls with a mounted ref; or rely on TanStack Query's `useMutation` onSuccess being a no-op on unmount via its own abort.

**Finding 10 (major)**: Each DeviceRow calls `useSwitchScenario()` independently, creating one mutation instance per row — fine for isolation, but the spec's "second Switch is queued (depth=2)" + "third hits 409" semantics are api-side, and the SPA submits each row's mutation independently. There's no client-side guard preventing the user from rapid-firing Switch twice on the same row within the network RTT.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:131-167`
  - Edge case: While the first Switch is in flight (button `disabled={isPending}`), the user can re-enable by clicking before React commits the disabled state (a double-tap faster than React's render cycle). Two POSTs land in the same tick, the second hits 409 (or both succeed if the network round-trips faster than expected), producing a confusing "Another switch is in progress." toast for what was intended as a retry.
  - Impact: Operators see spurious 409 toasts and may believe the simulator is broken. The button disable is `disabled={isPending}` but only takes effect on the next render — a 50ms double-tap can fire two POSTs.
  - Suggested fix: Add a ref-based "already fired" guard in `submit`, or debounce clicks; alternatively, render the button disabled from the click handler itself, not just from `isPending`.

**Finding 11 (major)**: `useSimulatorDevices` throws on `!res.ok` but the response body shape (e.g., `{ error: "rbac_denied" }`) is discarded — when the api returns 403 because RBAC denied the request mid-session (token role downgrade), the SPA renders "Failed to load devices. Reload the page." instead of routing to `<RbacDenied />` like the rest of the apiClient interceptor does.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:59-69`
  - Edge case: Admin signs in, the role on their token downgrades (or they sign in to a second tab and the role changes), then they visit `/admin/simulator`. The page calls `/admin/simulator/devices`, gets 403, throws, renders the error banner — yet `<RbacRoute>` already let them in based on the OLD role.
  - Impact: Operators see a generic error message instead of the calm RBAC denied surface; they don't know to log out and back in.
  - Suggested fix: Catch the error, branch on `err.message.includes(" 403 ")` (or carry status in a typed error), and render `<RbacDenied />` instead of the generic error banner.

**Finding 12 (major)**: The mutation `onSuccess` invalidates the `devices` key but does NOT invalidate the `status` key; if the operator rotates `SIMULATOR_SECRET` mid-session, the status remains cached for 5 seconds and the page keeps rendering the disabled banner even though the api now reports enabled.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:150-153` and `queryClient.ts:18-22`
  - Edge case: Operator A pauses the simulator; the api (and simulator) are then reconfigured with a fresh secret. The web SPA, still on `/admin/simulator`, has `staleTime: 5_000` cached status. No mutation fires to invalidate it. The page sits on "Simulator disabled" for up to 5 seconds (or until window focus, which is disabled).
  - Impact: Stale disabled state for up to 5s after the api is back. With `refetchOnWindowFocus: false` there's no natural trigger; the operator has to reload.
  - Suggested fix: Add `refetchInterval` to the status query, or invalidate it explicitly after any mutation; or drop `refetchOnWindowFocus: false` for the status key.

**Finding 13 (major)**: Status query runs `apiFetch` with `{ skipAuth: true }` but `apiFetch` still computes `withJsonContentType` because there's no body — fine. However, the `useSimulatorStatus` queryFn catches ALL non-200 as "disabled", including 404 (route not found) and 5xx — the same Finding 1 root cause, surfaced as a separate symptom.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:40-57`
  - Edge case: In environments where `/admin/simulator/status` is not mounted (e.g., a stale build of the api, or a misconfigured reverse proxy that 404s), the SPA still renders the disabled banner instead of a useful error.
  - Impact: Indistinguishable from the genuine "secret missing" state.
  - Suggested fix: Distinguish 404 (route not mounted) from 503 (genuine disabled).

**Finding 14 (major)**: `DeviceRow`'s `onSuccess` toast message reads `Switched to ${body.scenario}.` but `body.scenario` is the raw user-selected string, not the server-confirmed scenario. If the api normalizes/rejects the name and returns 400, the row falls into the error path — fine — but for a successful 200, the toast says "Switched to Normal." even if the server's authoritative scenario for that device ended up being something else.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:55-57`
  - Edge case: Operator clicks Switch with "Normal" pre-selected; the toast says "Switched to Normal." regardless of what the api actually applied. The mutation's `onSuccess` invalidates the devices query but does not read the canonical scenario from the refreshed data before showing the toast.
  - Impact: Toast can disagree with the server truth (e.g., "Switched to RisingTDS." while the row badge still says "Offline" because the invalidation is racing).
  - Suggested fix: After invalidation, read the new `scenario` from the cache for that device and use it in the toast message; or wait for `refetch` to complete before showing the success toast.

**Finding 15 (major)**: `useSimulatorDevices` returns `{ readonly devices: readonly SimulatorDevice[] }` but the queryFn parses the JSON without validating the shape — `await res.json()` returns `any` and is cast. If the api renames `devices` to `items` or wraps it in `{ data: ... }`, the SPA silently renders 0 devices with no error.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:59-69`
  - Edge case: A future api deploy changes the wire (or the proxy strips a level) — devices list arrives as `[]` because `.devices` is undefined. The page renders "0 devices" instead of erroring.
  - Impact: Operators see a misleading empty state; the underlying data layer doesn't validate the contract.
  - Suggested fix: Add a Zod schema (matching `packages/shared/src/simulator.ts`'s approach) for the wire shape; throw on `safeParse` failure.

**Finding 16 (major)**: The test `renders <RbacDenied /> for ${role} without calling the api` only asserts `fetchSpy` was not called after `waitFor(getByTestId("rbac-denied"))`. But TanStack Query may have already kicked off `useSimulatorStatus` because the hooks are inside the route tree (and the `useQuery` mounts before the `RbacRoute` returns). Looking more closely: the page mounts inside `<RbacRoute>` so the hooks only run when allowed — fine. But the test relies on `RbacRoute` short-circuiting before children mount; that contract is load-bearing and not asserted elsewhere.
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:181-199`
  - Edge case: If `<RbacRoute>` is refactored to render its children inside a memoized wrapper (still hiding the denied UI), the children still mount and the queries still fire — the test would silently pass for the wrong reason.
  - Impact: False test confidence on a load-bearing wiring detail.
  - Suggested fix: Add an explicit test asserting `<RbacRoute>` does NOT call `useQuery` for non-Admin roles (e.g., spy on `apiFetch` and assert the URL never fires).

**Finding 17 (minor)**: `queryClient.ts` sets `retry: 1` on queries but the spec says the admin tab is sensitive to network blips — `retry: 1` with the default exponential backoff can stretch a single 5xx past the user's click patience, while `retry: 0` (used in tests) means the prod vs test retry behavior diverges.
  - File: `packages/web/src/queryClient.ts:19-21`
  - Edge case: User clicks Switch; the api 502s once; the query retries; the user sees the toast appear later than the click, or the page bounces between states.
  - Impact: UX timing drift between dev/test (no retry) and prod (one retry); the mutation hook is also at `retry: 0` so it won't retry a real switch failure.
  - Suggested fix: Make the test `QueryClient` use `retry: 1` (matching prod) by reusing the prod `queryClient`, or factor the options into a shared constant.

**Finding 18 (minor)**: `DeviceRow` uses inline-style hex colors throughout instead of the documented design tokens (`color.neutral.surface`, `color.primary`) — the spec calls for substrate tokens but every file in this group hardcodes `#1E5BB8`, `#E2E8F0`, `#0F6B3A`, etc.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:24-27, 117-204`; `SimulatorPage.tsx:33-40, 87-92, 104-110, 153-158`; `DisabledBanner.tsx:9-11, 38-45`
  - Edge case: Tailwind classes like `text-neutral-body`, `bg-neutral-page`, `rounded-card` are used alongside hex literals. If the design substrate ever changes a primary color (e.g., brand refresh), these files silently desync from the tokens used elsewhere (e.g., `AppShell.tsx`).
  - Impact: Visual drift; the inline styles override Tailwind tokens and won't pick up dark-mode / theme-token migrations.
  - Suggested fix: Replace hex literals with the documented Tailwind tokens or a shared `colors.ts` module; at minimum, factor them into named constants colocated with the design substrate.

**Finding 19 (minor)**: `DeviceRow` initial state seeds `selected = device.scenario ?? "Normal"` — when a new device is added to the list and its `scenario` is `null`, the row starts with "Normal" preselected. If the operator clicks Switch without changing the dropdown, they POST `{ scenario: "Normal" }` to a device that may already be in Normal — successful 200, but a useless audit row.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:36-38`
  - Edge case: Admin lands on the page; all six devices already show their canonical scenario in the badge; the dropdowns default to the same scenario; one click on Switch creates six audit events for nothing.
  - Impact: Audit-log noise; the mutation succeeds but applies no real change.
  - Suggested fix: Disable the Switch button when `selected === device.scenario` and no `paused` change is queued; or short-circuit the submit when the value is unchanged.

**Finding 20 (minor)**: `DeviceRow`'s `submit` function does not handle the case where `body.scenario` is an empty string (a legitimate `<select>` value of `""` if the option list ever includes a placeholder). Today it can't happen, but the function silently POSTs an empty string if a future refactor introduces a "Select..." placeholder option.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:44-70`
  - Edge case: Future select placeholder added → user clicks Switch without picking → POST `{ scenario: "" }` → api returns 400 `invalid_scenario`.
  - Impact: Confusing error toast for what is a UX bug.
  - Suggested fix: Validate `body.scenario !== ""` before submit; or remove the placeholder option.

**Finding 21 (minor)**: `DisabledBanner` exposes `DISABLED_BANNER_COPY` as a public export but it is never imported elsewhere. The export pollutes the module surface for no consumer.
  - File: `packages/web/src/admin/simulator/DisabledBanner.tsx:13-14`
  - Edge case: A future test imports it as a constant and asserts on it; if the copy is changed for i18n, the test silently passes (or fails) without review.
  - Impact: Low — dead export; mild API surface bloat.
  - Suggested fix: Remove the export or use it for the snapshot test.

**Finding 22 (minor)**: `useSwitchScenario` does NOT pass `signal` to its `apiFetch` call, so when the DeviceRow unmounts mid-flight, the in-flight POST continues to completion and the api still applies the scenario switch even though the UI no longer cares.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:117-123`
  - Edge case: Admin clicks Switch on device A; navigates to /dashboard before the POST resolves; the POST lands at the api, which writes an audit row and applies the scenario. The admin is now navigating with a scenario they no longer want.
  - Impact: Unintended state changes from cancelled UI sessions. The TanStack Query mutation keeps running even though `useMutation` has no native abort signal wired up.
  - Suggested fix: Pass an `AbortController.signal` through the mutation; abort on unmount; or document that switch is fire-and-forget.

**Finding 23 (minor)**: `queryClient` is constructed at module load time, which means it's evaluated on import — fine in the browser, but the singleton is also re-imported by tests, and tests construct their own `QueryClient` (SimulatorPage.spec.tsx:73-77) for isolation. That's good, but `queryClient` is never reset between test files, and the prod default (`retry: 1`) is NOT honored by the tests (`retry: false`).
  - File: `packages/web/src/queryClient.ts:14-27`; `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:73-77`
  - Edge case: Future tests that import `useSimulatorDevices` directly (not via `SimulatorPage`) will hit the prod `QueryClient` and may auto-retry, producing flakes.
  - Impact: Test/prod divergence; potential flakes.
  - Suggested fix: Export the default options as a factory (`createDefaultOptions()`) and have both the prod `QueryClient` and test builders reuse it.

**Finding 24 (minor)**: `.env.example` documents `VITE_API_BASE_URL=http://localhost:3000` but the runtime code uses `API_ORIGIN = "/api"` (main.tsx:122) — the env var is not consumed anywhere. Either the example is aspirational or the code is dead.
  - File: `packages/web/.env.example:10-11`; `packages/web/src/main.tsx:121-122`
  - Edge case: Developer copies `.env.example` to `.env`, sets a different base URL, restarts Vite, sees no change (the api client ignores the env var and proxies through `/api`).
  - Impact: Confusing developer experience; the `.env.example` is documentation that lies.
  - Suggested fix: Either consume `import.meta.env.VITE_API_BASE_URL` in `API_ORIGIN`, or remove the line from `.env.example`.

**Finding 25 (minor)**: The test `renders <RbacDenied /> for ${role} without calling the api` iterates over `["Viewer", "Operator", "Technician"]` but doesn't include the explicit null/unauthenticated case. The `RbacRoute` is supposed to deny for `role === null`, but it's untested.
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:95, 182-199`
  - Edge case: Unauthenticated admin tab visit (somehow reaching the route without auth, e.g., direct URL after token expiry). The behavior on `role: null` is unverified.
  - Impact: Silent regression risk for the unauthenticated path.
  - Suggested fix: Add `null` to the iterated roles and assert either `<RbacDenied />` or a redirect.

**Finding 26 (minor)**: `SimulatorPage` toast region renders BOTH the toast list and the device grid inside the same `flex-col` container; the toasts appear BELOW the grid (intentional?) but `aria-live="polite"` on the toast region can be drowned out by the devices grid announcing its own dynamic changes.
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:142-161`
  - Edge case: Screen reader user performs a switch; the toast appears below the fold of the device list; the live region's announcement is at the END of the DOM after 6 `<article>` elements — focus order announces the new scenario names first, then the toast.
  - Impact: Accessibility regression — the success/error signal is announced last, after six card titles, which is the wrong priority for a status update.
  - Suggested fix: Move the toast region ABOVE the device grid (or use `aria-live="assertive"` for errors).

**Finding 27 (minor)**: `SimulatorPage` renders 0-device count using `devices.length === 1 ? "" : "s"` — fine for English. But there's no i18n boundary; if/when localization lands, this string is hardcoded.
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:125-128`
  - Edge case: Localization pass replaces "device" / "devices" with translated forms; this string is missed.
  - Impact: Inconsistency in localized UI.
  - Suggested fix: Use a count-pluralization helper or move into a shared i18n file now.

**Finding 28 (minor)**: `useSimulatorStatus` queryFn returns a synthesized `{ enabled: false, reason: body.reason ?? "missing" }` for ANY non-200, including a `body.reason` like `"network"` or `"timeout"` — but the page renders the same `DisabledBanner` regardless of reason. The banner copy is pinned; the reason is never surfaced.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:51-55`; `DisabledBanner.tsx:13-14`
  - Edge case: Reason could be "down" / "unreachable" / "config_error" — the operator sees the same "Set SIMULATOR_SECRET" message even when the secret IS set but the simulator process is down.
  - Impact: Misleading copy.
  - Suggested fix: Branch the banner copy on `reason` (e.g., reason === "missing" → "Set SIMULATOR_SECRET", else → "Simulator offline.").

**Finding 29 (minor)**: The two test fetches match URLs via `endsWith("/admin/simulator/status")` but the prod api mount is `/admin/simulator/status` — fine. However, the test mock for the *404 catch-all* returns `new Response("{}", { status: 404 })` which is a parseable JSON object — fine, but `useSimulatorStatus` only treats 200 as success; everything else is consumed as disabled. The tests rely on the actual return-shape of the prod api, but the tests don't validate that the SPA doesn't break when the 503 body is empty.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:51-55`; `SimulatorPage.spec.tsx:162-178`
  - Edge case: api returns 503 with empty body (e.g., a proxy strips it). `res.json().catch(() => ({}))` returns `{}`, no `reason`, falls back to `"missing"` — and the SPA renders "Set SIMULATOR_SECRET" even though the real reason was a 503 from a different layer.
  - Impact: Misleading copy; untested branch.
  - Suggested fix: Add a test case for empty 503 body and assert the banner still renders; consider branching the copy on `reason`.

**Finding 30 (minor)**: `DeviceRow` `submit` calls `mutation.mutate({ deviceId: device.device_id, ...body })` with `body.scenario` and `body.paused` both possibly undefined (e.g., a future "Refresh" button posting nothing). The api's `.refine` rejects with 400; the SPA maps 400 to `validation_error`. Today the row can't submit empty bodies, but the `submit` signature allows it.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:44-70`; `packages/api/src/admin/simulatorRouter.ts:66-78`
  - Edge case: A future change adds a "Refresh" button that calls `submit({})` → api rejects → SPA toast "Switch failed: invalid input." which is the wrong message.
  - Impact: Misleading error message.
  - Suggested fix: Add a guard in `submit`: if neither `scenario` nor `paused` is provided, throw a developer error or no-op.

**Finding 31 (minor)**: `main.tsx` wraps the whole router in `<QueryClientProvider>` but `LoginRoute`'s `useEffect` configures the api client AFTER mount — there's a brief window where `apiFetch` would throw "apiClient: configureApiClient() must run before use". `useSimulatorStatus` is fired on the `/login` page (because the route is wrapped in `<QueryClientProvider>`) but the `RbacRoute` and `<AppShell>` aren't rendered until auth, so the status query doesn't fire on `/login`. But after login + redirect, the status query fires inside SimulatorPage's `useSimulatorStatus`, which is fine because `configureApiClient` already ran.
  - File: `packages/web/src/main.tsx:137-150, 172-326`
  - Edge case: A future page that calls `apiFetch` directly during initial mount (e.g., a global "current role" prefetch) will hit "apiClient not configured" until the LoginRoute's `useEffect` runs.
  - Impact: Latent failure for any direct-`apiFetch` caller.
  - Suggested fix: Move `configureApiClient` out of `LoginRoute`'s effect into a top-level `useEffect` that runs unconditionally.

**Finding 32 (minor)**: `useSimulatorDevices` has no `enabled` flag — the query fires unconditionally on mount. On the disabled-banner path, the devices query is still in flight when the page renders the banner; it 401s/403s in the background, throwing and (because of the disabled-banner check) the error is never seen. But the request still happened, wasting a round trip.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:59-69`; `SimulatorPage.tsx:71-92`
  - Edge case: Slow api response: the status query returns "disabled" first, the page renders the banner, but the devices query is still pending in the background. When it eventually 403s, TanStack Query retries (`retry: 1`) — two extra round trips, then the page still shows the banner.
  - Impact: Wasted api calls; with `retry: 1` and `staleTime: 5_000`, subsequent navigations to the page trigger another round trip until cache is fresh.
  - Suggested fix: Pass `enabled: statusQuery.data?.enabled !== false` to `useSimulatorDevices`.

**Finding 33 (minor)**: `DeviceRow` calls `useSwitchScenario()` once per row, but the mutation result type is `{ readonly applied: true }` and the body is never inspected; the response is typed but unused. The status code 200 is the only success path — but the api could legitimately return 200 with `{ applied: false }` (an "ack" without applying). Today it doesn't, but the type allows it.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:107-126`
  - Edge case: A future "dry-run" mode on the api returns `{ applied: false, reason: "lock_held" }` — the SPA shows "Switched to X." toast even though nothing was applied.
  - Impact: Toast lying about success.
  - Suggested fix: Validate `applied === true` in the response before considering the mutation successful; reject otherwise.

**Finding 34 (minor)**: The test install fetch mocks don't account for query-string ordering or trailing slashes; both `/admin/simulator/devices` and `/admin/simulator/{id}/scenario` are matched by `endsWith`/`includes` patterns that would also match `/admin/simulator/{id}/scenarioanything` (e.g., a hypothetical `/scenarioHistory` endpoint).
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:138-147, 213-219, 252-258, 294-300, 335-341, 376-382`
  - Edge case: A future endpoint `/admin/simulator/{id}/scenarioHistory` would be matched by `url.includes("/admin/simulator/") && url.endsWith("/scenario")` — no, it wouldn't, because `/scenarioHistory` doesn't end with `/scenario`. The `endsWith("/scenario")` is correct. But `endsWith("/admin/simulator/devices")` would falsely match `/admin/simulator/devices-extra`.
  - Impact: Latent fragility.
  - Suggested fix: Use stricter regex or path-segment matching.

**Finding 35 (minor)**: `DeviceRow` `submit` `overrides.onError` is declared and forwarded but never called by the Pause button — only the Switch button uses `overrides` for success. There's no current call site that uses `overrides.onError`, so the field is dead.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:46-49, 65-67`
  - Edge case: Future caller writes `overrides.onError` and expects it to fire — it does (line 65-67), but the contract is not exercised by any test, so a typo or signature drift wouldn't be caught.
  - Impact: Low.
  - Suggested fix: Either remove the unused `onError` from overrides, or add a test that exercises it.

**Finding 36 (minor)**: The toast's `borderColor` and `color` are both set to the same dark color, but for the success variant, the border is `#0F6B3A` (dark green) on a `#E8F6EE` (light green) background — visually fine. For the error variant, the border is `#7F1D1D` (dark red) on `#FEE2E2` (light red) — fine. But the SUCCESS toast color is `#0F6B3A` (green) for both `color` AND `borderColor`, leaving NO visual distinction between foreground and border on the error toast either.
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:33-40, 152-159`
  - Edge case: Low-contrast viewing (projector, sunlight) makes it hard to see the toast boundaries.
  - Impact: Visual readability.
  - Suggested fix: Use a slightly darker border color for visual separation.

**Finding 37 (nit)**: `useSimulatorStatus` is called inside `SimulatorPage` which is rendered inside `<AppShell>` inside `<RbacRoute>` — the query is set up after the role gate, so an unauthenticated direct URL hit does NOT fire the query (RbacRoute returns `<RbacDenied />`). But the `<QueryClientProvider>` is at the ROOT of the router (main.tsx:174), which is correct.
  - File: `packages/web/src/main.tsx:172-326`
  - Edge case: A future refactor moves `<QueryClientProvider>` inside the authenticated routes only — the disabled banner would then crash because no provider exists. The QueryClientProvider placement is load-bearing and untested.
  - Impact: Latent.
  - Suggested fix: Add a test asserting `<LoginRoute>` doesn't fail without `QueryClientProvider` (or move the provider above the router entirely).

**Finding 38 (nit)**: `DeviceRow` has no `key` reconciliation concern because the parent uses `key={d.device_id}` — fine. But the `<select>` is `controlled` (`value={selected}`) with no `defaultValue`; on a device-list refetch (e.g., after a successful switch), the row stays mounted with the same `device` reference (TanStack Query updates the cache in-place), but if a device's `device_id` changes (e.g., a renamed device), the row unmounts and the `selected` state resets to the new device's scenario. That's correct behavior — but the `paused` state also resets to `false`, even if the new device was already paused on the server.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:35-39`
  - Edge case: Device X is paused; the list refetches; the device row's local `paused` state is `false`; the button says "Pause" but the device is already paused.
  - Impact: Same as Finding 3 — UI lies.
  - Suggested fix: Derive `paused` from server state (no local copy).

**Finding 39 (nit)**: `errorMessage` `switch` on `SwitchScenarioError` covers all five `kind` values exhaustively but TypeScript's `switch` is not typed as `never` at the end — if a future kind is added, this function silently falls through to `undefined`, which renders an empty toast.
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:42-55`
  - Edge case: New error kind added to `SwitchScenarioError` → toast text becomes `undefined` → renders blank toast.
  - Impact: Silent regression.
  - Suggested fix: Add a `default:` case that throws or returns a fallback; or assert `never` in the switch.

**Finding 40 (nit)**: The test `installFetch` overwrites `globalThis.fetch` for the duration of the test but the `useEffect` in `LoginRoute` calls `configureApiClient` on mount — `SimulatorPage` doesn't call it directly, but the `<AppShell>` test wrapper relies on it. The `afterEach` calls `_resetApiClientConfig()` which clears the config AND the inflight refresh lock — fine. But `apiFetch` is called via TanStack Query, which uses the imported `apiFetch`, which reads `globalThis.fetch` via the host — wait, no, `apiFetch` uses the platform `fetch` directly (`fetch(url, ...)`), not `globalThis.fetch`. The test mock matches because `apiFetch` calls `fetch(...)` which resolves to `globalThis.fetch` in jsdom. If jsdom's `fetch` is replaced by the test mock, both `apiFetch` and any direct `fetch()` calls are mocked. Good.
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:112-118`
  - Edge case: If a future test imports a module that caches `fetch` at module-load time (e.g., `const F = fetch`), the mock would not apply to that captured reference.
  - Impact: Latent test fragility.
  - Suggested fix: Document the mock pattern; add a lint rule against caching `fetch`.

**Finding 41 (nit)**: `DeviceRow`'s `<select>` has no `aria-label` or associated `<label>` `for=` attribute — the visible label "Switch to scenario" is a `<span>` not a `<label for=...>`. Screen readers may not announce the field correctly.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:107-128`
  - Edge case: Screen reader user opens the select; the accessible name is the contained text of the option, not "Switch to scenario".
  - Impact: Mild a11y regression.
  - Suggested fix: Add `htmlFor`/`id` pair, or wrap the `<select>` inside the `<label>` element (already wrapped — actually the `<select>` IS inside the `<label>` because the structure is `<label><span>...</span><select/></label>`). Re-reading the code: yes, the `<select>` is inside the `<label>`, so the a11y is fine. False alarm — but the visible label could be more descriptive (e.g., "Scenario to switch to").
  - Suggested fix: None needed; documenting that the label-wrapping is correct.

**Finding 42 (nit)**: `useSwitchScenario` mutation type `SwitchScenarioError` has `case "unknown": status: number` but `SimulatorSwitchError.detail.kind === "unknown"` is not narrowed in the mutation's `onError` callback — the `err` is typed as the discriminated union directly, not the `SimulatorSwitchError` instance, because `useMutation` types its `onError` as `TError` (= `SwitchScenarioError`).
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:90-97, 105-153`
  - Edge case: TanStack Query's mutation `onError` receives the thrown error as-is; `SimulatorSwitchError extends Error` is thrown, so `err.detail` is reachable on the instance — but the typed `err` in `submit`'s `onError: (err: SwitchScenarioError) => void` is the discriminated union, NOT the `SimulatorSwitchError`. `DeviceRow`'s `onError(err)` calls `pushToast("error", errorMessage(err))`, where `errorMessage` expects the discriminated union — fine, because `err.kind` is on both. But if any future code wants `err.status` for the unknown branch, it needs `err.kind === "unknown" ? err.status : undefined`, and the discriminated union guarantees this.
  - Impact: None today, but the throw/unwrap pattern is slightly awkward — the error is wrapped in `SimulatorSwitchError` but the consumers see the unwrapped shape.
  - Suggested fix: Either expose `detail` directly via the union (drop `SimulatorSwitchError`), or update the mutation type to `Error` and unwrap in `onError`.

**Finding 43 (nit)**: The test mocks use `JSON.stringify({ applied: true })` for success, but the SPA's `mutationFn` does `await res.json() as { applied: true }` — the cast skips runtime validation. If the api returns `{ success: true }` instead (typo), the SPA still says "Switched." because the `if (res.ok)` branch succeeds.
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:125-127`
  - Edge case: Wire drift.
  - Impact: Silent lying success.
  - Suggested fix: Runtime-validate with a schema: `AppliedResponseSchema.safeParse(body)`.

**Finding 44 (nit)**: `DeviceRow`'s `<article>` uses `className="rounded-card border p-4"` — `border` is a Tailwind utility that defaults to 1px; with `style={{ borderColor: "#E2E8F0" }}`, the inline border color overrides any Tailwind border-color utility but `border` (width) is still set. This is fine, but the inline `borderColor` does not compose with hover/focus variants — future "highlight on success" treatments would need a Tailwind class instead.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:73-80`
  - Impact: Visual extensibility.
  - Suggested fix: Move to Tailwind tokens (`border-neutral-border`).

**Finding 45 (nit)**: `SimulatorPage.spec.tsx` has 6 tests but no test for the `devices = []` empty state (e.g., a freshly-deployed api with no devices). The `simulator-device-count` testid is asserted to contain "6", but `0 devices` (or `1 device`) is not tested.
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:135-179`
  - Edge case: Empty device list.
  - Impact: Latent bug surface.
  - Suggested fix: Add a test for `devices: []` and `devices: [{ ... }]` (singular).

**Finding 46 (nit)**: The `BANNER_BG`, `BANNER_BORDER`, `BANNER_TEXT` constants in `DisabledBanner.tsx` are prefixed `BANNER_` but in `SimulatorPage.tsx` the equivalent constants are `TOAST_BG` / `TOAST_TEXT` — naming inconsistency.
  - File: `packages/web/src/admin/simulator/DisabledBanner.tsx:9-11`; `packages/web/src/admin/simulator/SimulatorPage.tsx:33-40`
  - Impact: Cosmetic.
  - Suggested fix: Unify to `color.role.surface` / `color.role.text` tokens.

**Finding 47 (nit)**: `DeviceRow`'s `isPending ? "Switching…" : "Switch"` text is hardcoded; the Pause button's label is conditional on `paused`. A future "Loading" spinner style would require touching both call sites.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:138-140, 165-167`
  - Impact: Cosmetic / extensibility.
  - Suggested fix: Extract a `<Button variant="primary" | "secondary" loading />` component.

**Finding 48 (nit)**: The test file imports `vi` from "vitest" but never uses `vi.fn()` directly except in `installFetch` callers — `vi` is imported but unused. `vi.fn()` IS used in the RBAC test (line 184). OK.
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx:17-26`
  - Impact: Cosmetic.
  - Suggested fix: N/A — `vi` is used.

**Finding 49 (nit)**: `DeviceRow` declares `submit` with named parameters `(body, overrides?)` but uses `overrides?.onSuccess?.()` and `overrides?.onError?.(err)` — the `overrides.onError` branch is unreachable in practice (no caller passes it), but the type and call-site are present.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:44-70, 152-156`
  - Impact: Dead code.
  - Suggested fix: Remove `onError` from overrides or document why it's there.

**Finding 50 (nit)**: `useSimulatorDevices` does not set `gcTime` (formerly `cacheTime`); with `staleTime: 5_000` and default `gcTime: 5 * 60_000`, the cached data lingers for 5 minutes after the last subscriber unmounts. When the admin navigates away and back within 5 minutes, the cache shows the OLD device list for up to 5 seconds (staleTime) before refetching.
  - File: `packages/web/src/queryClient.ts:18-22`
  - Edge case: Admin switches device A, navigates away, comes back within 5s — sees the pre-switch state for up to 5s.
  - Impact: Stale UI for 5s post-navigation.
  - Suggested fix: Either invalidate `["admin", "simulator", "devices"]` on navigation, or lower `staleTime` for this specific query, or rely on the mutation's invalidation to keep it fresh.