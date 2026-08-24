**Finding 1 (major)**: Api-side missing-env POST surfaces as a "Simulator unreachable" toast, not the disabled banner
  - AC: AC2 — "Given `SIMULATOR_SECRET` is unset on either side, when the Admin renders `/admin/simulator`, then the disabled banner 'Simulator disabled. Set SIMULATOR_SECRET.' renders; no controls are clickable." (spec line 127) and AC8 — "the UI shows the same disabled banner state as missing-secret" (spec line 133).
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:133-147` and `packages/web/src/admin/simulator/SimulatorPage.tsx:42-55`
  - Spec says: When `SIMULATOR_SECRET` is unset on the api side AND an Admin clicks Switch, the disabled banner — not a transient toast — should be the operator-facing signal (AC2 narrative: "the operator-facing signal is 'simulator is disabled', not 'something went wrong'").
  - Code does: After Group 2's wire-contract change, the api's POST `/admin/simulator/:device_id/scenario` returns `503 { disabled: true, reason: "missing" }` when its own `SIMULATOR_SECRET` is unset (`packages/api/src/admin/simulatorRouter.ts:348-354`). The SPA's `useSwitchScenario` maps `HTTP_SERVICE_UNAVAILABLE (503)` to `{ kind: "simulator_unreachable" }` and `errorMessage` returns the toast "Simulator unreachable." The disabled banner is only rendered on the `/status` query path, never re-evaluated when a POST returns the `{ disabled: true }` body.
  - Gap / risk: The Admin can render the disabled banner on initial load (because `/status` short-circuits), but if `/status` raced ahead (200 enabled=true cached) and the secret was rotated out, a subsequent Switch click surfaces a misleading "Simulator unreachable" toast instead of the calm "Simulator disabled." banner. The statusQuery should be invalidated / re-fetched on a 503-from-POST or, ideally, the mutation should treat a 503 with `{ disabled: true }` body as a transition into the disabled banner state.

**Finding 2 (major)**: AC8 secret_mismatch Switch click surfaces only a transient toast; the spec mandates the disabled banner
  - AC: AC8 — "Given the secret mismatch case … when an Admin clicks Switch, then the api returns 403 `{ error: 'secret_mismatch' }` and the UI shows the same disabled banner state as missing-secret." (spec line 133).
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:134-136` and `packages/web/src/admin/simulator/SimulatorPage.tsx:42-55, 119-162`
  - Spec says: On a secret-mismatch Switch click, the UI should show the same disabled-banner state — i.e. the calm, persistent banner — not a transient toast. The I/O matrix line 52 also says "Toast 'Simulator disabled.'" but the AC's "same disabled banner state as missing-secret" language refers to the AC2 banner (`DisabledBanner` with the pinned copy "Simulator disabled. Set SIMULATOR_SECRET.").
  - Code does: 403 from the api is mapped to `{ kind: "secret_mismatch" }`, the toast says "Simulator disabled." (no "Set SIMULATOR_SECRET." actionable suffix), and the rows remain rendered (controls are still clickable, only this one is `isPending`-locked). The disabled-banner branch (`statusQuery.data?.enabled === false`) is never entered from a mutation failure.
  - Gap / risk: After the toast disappears (4 s TTL), the Admin sees a normal-looking page with clickable controls; nothing keeps them from clicking again, repeating the loop. The spec narrative ("same banner state as missing-secret") implies a persistent banner until status flips back, not a toast. Either (a) invalidate `/status` after a `secret_mismatch` mutation and let the banner branch render, or (b) reconcile the spec I/O matrix vs. AC8 — but the implementation as-is does not satisfy AC8's text.

**Finding 3 (major)**: AC1 control set — "Start" button missing (Paused/Resume only)
  - AC: AC1 — "six device rows render with current scenario badges and the full per-device Start / Pause / Switch control set" (spec line 126); also Intent line 20 and Code Map line 114 ("Switch button, Start/Pause toggle").
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:141-167`
  - Spec says: Three distinct controls per device — Start (bring a stopped device online), Pause (suspend the tick loop), Switch (change scenario).
  - Code does: Only two controls — Switch and a Pause/Resume toggle. There is no Start button. On initial render `paused === false`, so the row renders the "Pause" button; there is no way to distinguish a device that has been stopped vs. one that has been resumed. The "Start" semantic from the spec's Ask-First (line 32: "Pause the tick loop vs. close the socket") was never separately implemented.
  - Gap / risk: Operators who have stopped a device have no UI to bring it back other than clicking Pause/Resume twice. The spec's "Start" semantic may have collapsed to `paused: false` by Group 2 design — but if so, the AC1 narrative still enumerates "Start / Pause" and the row's `paused` local state starts as `false` regardless of the server's authoritative state, so the button label is incorrect for a freshly-loaded device that was actually paused server-side. Either the spec or the AC text needs a renegotiation note, or the row needs to initialize `paused` from the device's server-side state (currently the spec doesn't expose that — but AC1's enumeration of "Start" is unmet).

**Finding 4 (major)**: Missing test coverage for spec-mandated 400 invalid_scenario on Switch
  - AC: AC5 — "Given an Admin POSTs an unknown scenario name, when the api processes it, then it returns 400 `{ error: 'invalid_scenario' }` and no `AuditLog` row is written." (spec line 130) AND Verification section line 228 ("Web page … Switch failure (no optimistic update)") AND Code Map line 118 ("Failure shows toast and does not update UI optimistically").
  - File: `packages/web/src/admin/simulator/SimulatorPage.spec.tsx` (entire file — only 502 and 409 fail-paths are covered)
  - Spec says: The verification matrix for the web side includes a 400 invalid_scenario branch — the Admin should see a toast and the row should not update optimistically.
  - Code does: The spec covers only `502 simulator_unreachable` and `409 switch_in_progress` for the mutation. The `400 validation_error` toast is implemented (`SimulatorPage.tsx:50` returns "Switch failed: invalid input.") but no test exercises that path.
  - Gap / risk: Regressions in the 400→toast mapping (or, more importantly, in the "do not optimistically update on failure" invariant when a 400 lands while the row's `<select>` had been changed to a bogus name) will not be caught.

**Finding 5 (minor)**: Toast on Switch failure does not include the actionable "Set SIMULATOR_SECRET." suffix
  - AC: AC2 narrative — "Disabled banner copy: 'Simulator disabled. Set SIMULATOR_SECRET.'" (spec line 20, line 127); AC8 — "the UI shows the same disabled banner state as missing-secret" (line 133).
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:44-45`
  - Spec says: The disabled-banner copy is the pinned "Simulator disabled. Set SIMULATOR_SECRET." and AC8 promises the same banner copy on secret-mismatch.
  - Code does: For a Switch-click secret_mismatch, the toast is the shorter "Simulator disabled." — missing the "Set SIMULATOR_SECRET." actionable tail. This is the same constant `DISABLED_BANNER_COPY` (`DisabledBanner.tsx:13-14`) minus the actionable suffix.
  - Gap / risk: If Finding 2 is addressed by promoting the toast into a banner, the copy divergence disappears (banner uses the full string). If the toast remains, AC8's "same banner state" is at minimum a copy deviation.

**Finding 6 (minor)**: `useSimulatorStatus` only treats the `enabled === false` body as the disabled signal — the spec's literal 503 body shape is `{ disabled: true }` not `{ enabled: false }`
  - AC: AC2 / I/O matrix line 47 — "GET `/admin/simulator` (api returns 503 with `{ disabled: true }`)".
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:42-57`
  - Spec says: When the api has `SIMULATOR_SECRET` unset, the GET response body uses the property name `disabled` (not `enabled: false`). The api code (`packages/api/src/admin/simulatorRouter.ts:265-268, 301-304`) returns `{ disabled: true, reason: "missing" }` — exactly the spec shape.
  - Code does: The hook's `status === 200` happy path expects `{ enabled: true }`; on a non-200 (e.g. 503), it falls back to `{ enabled: false, reason: body.reason ?? "missing" }` — so a 503 with body `{ disabled: true, reason: "missing" }` is correctly coerced into `{ enabled: false, reason: "missing" }`. Functionally correct via the fallback. The TS type `SimulatorStatus` only documents `enabled`, so the api's `disabled: true` body shape is undocumented at the SPA type level.
  - Gap / risk: A future spec amendment changing the body to `disabled` only (without `reason`) on 200 — e.g., `200 { disabled: false }` — would silently fall through to the enabled branch. The fallback works today but the contract between api and web is implicit.

**Finding 7 (minor)**: Status check fires before RBAC check, so unauthenticated users can probe `/admin/simulator/status`
  - AC: AC3 — "Given a non-Admin role (Operator / Technician / Viewer) renders `/admin/simulator`, then Story 1.6's `<RbacDenied />` renders; no `/admin/simulator/*` api call is made." (spec line 128)
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:42-57` and `packages/web/src/admin/simulator/SimulatorPage.tsx:71-92`
  - Spec says: No `/admin/simulator/*` API call beyond the role gate.
  - Code does: `useSimulatorStatus` is invoked unconditionally inside `SimulatorPage` with `skipAuth: true` and an empty body. RbacRoute wraps the page at the route level (`main.tsx:267-269`), so the inner SimulatorPage only mounts when RBAC passes — i.e. the API call IS gated by RBAC. The non-admin test (`SimulatorPage.spec.tsx:181-198`) asserts `fetchSpy).not.toHaveBeenCalled()` which passes. The functional behavior is correct.
  - Gap / risk: The comment on `useSimulatorDevices.ts:34-39` ("Anonymous … because the spec mandates that the disabled banner render for unauthenticated users too") is misleading — the page IS gated by RbacRoute so only authenticated users ever render it, and the api-side `markPublic` route means the unauthenticated probe path exists at the network level but never reaches the SPA in normal use. No functional bug; just a doc-string drift.

**Finding 8 (minor)**: `useSimulatorStatus` swallows non-200 responses as "disabled" — masks network / 500-class outages
  - AC: AC2 narrative — banner on secret unset; I/O matrix line 47 — "503 propagates to `<DisabledBanner />`".
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:48-55`
  - Spec says: 503 from `/status` (specifically the disabled-secret case) propagates to the disabled banner.
  - Code does: ALL non-200 responses (401, 403, 404, 500, network errors that apiFetch rethrows and TanStack catches as isError) are coerced into `{ enabled: false, reason: body.reason ?? "missing" }`. A 401 from a stale JWT or a 500 from the api would render the "Simulator disabled." banner — misleading the operator.
  - Gap / risk: The intentional design ("don't crash the page on a 5xx") is documented in the comment, but the disabled banner should be reserved for the 503-disabled-secret case. Other failures should fall through to the devices-error branch (which renders "Failed to load devices. Reload the page.") or a dedicated /status-error banner. The current behavior conflates "secret is missing" with "the api is broken".

**Finding 9 (minor)**: Api 5xx generalization — toast "Simulator unreachable" loses the spec's specific 502/503 distinction
  - AC: AC6 — "the api returns 502 `{ error: 'simulator_unreachable' }`, the UI shows a toast" (spec line 131).
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:140-143`
  - Spec says: 502 is the unreachable case. 503 (api-side disabled-secret) should be the disabled-banner case (Finding 1).
  - Code does: 502 and 503 are both mapped to `simulator_unreachable` and surface the same toast. This contradicts Finding 1's spec alignment.
  - Gap / risk: See Finding 1. The mapping is the root cause.

**Finding 10 (nit)**: `useSimulatorDevices` document-comment claims optimistic update behavior that the implementation does not perform
  - AC: AC6 narrative — "no `AuditLog` row is written (the action did not apply)" AND Verification line 228 — "failure shows toast and does not update UI optimistically".
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:8-13`
  - Spec says: On failure, the UI does not optimistically update. This is implemented correctly (no `onMutate`, only `onSuccess` invalidation).
  - Code does: The doc-comment says "No optimistic update is applied on the UI side — the toast + invalidation flow is explicit". This is accurate. But the comment on line 10-13 ("the optimistic `applied` state survives until the server's view catches up") references an "optimistic applied state" that does not exist in the code — the row badge keeps the device's authoritative `scenario` field from the GET, never an optimistic value.
  - Gap / risk: Documentation drift; not a functional bug. A reader could search for the optimistic mutation expecting a more complex code path than what exists.

**Finding 11 (nit)**: `queryClient.ts` adds `refetchOnWindowFocus: false` beyond the spec's documented config
  - AC: Spec Code Map line 120 — "Single `QueryClient` instance with `staleTime: 5_000`, `retry: 1`. Re-exported for the admin hooks."
  - File: `packages/web/src/queryClient.ts:17-25`
  - Spec says: `staleTime: 5_000` and `retry: 1` (queries).
  - Code does: Adds `refetchOnWindowFocus: false` (queries) and `retry: 0` (mutations). The mutations `retry: 0` is justified by the spec's "audit row NOT written on failure" + idempotency concerns. The `refetchOnWindowFocus: false` is an extra opinion not in the spec.
  - Gap / risk: Mostly cosmetic. `refetchOnWindowFocus: false` is a defensible default for an admin tab (the operator is already on the tab; a focus event would refetch behind their back). Should be called out as a deliberate spec-extension.

**Finding 12 (nit)**: `paused` local state is not initialized from server-side truth
  - AC: AC1 — "the full per-device Start / Pause / Switch control set" (spec line 126); no explicit init-from-server AC.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx:39`
  - Spec says: Per-device Pause control reflects the simulator's authoritative state.
  - Code does: `useState(false)` — always starts unpaused regardless of the simulator's actual paused state. The devices query response shape (`SimulatorDevice` in `useSimulatorDevices.ts:23-27`) does not include a `paused` field at all.
  - Gap / risk: A device that was paused server-side will show "Pause" (not "Resume") on page load, so the Admin clicks Pause to "stop" it and instead resumes it. The api/simulator surface doesn't currently expose paused state per device — Group 3 inherited the gap from Group 2. If Finding 3 is taken seriously, this needs to be addressed in tandem: expose `paused` on the device list so the row reflects truth.

**Finding 13 (nit)**: spec-deviation reference (Start vs Pause/Resume) is not called out in the spec change log
  - AC: Spec Change Log (line 137) currently logs only Loopback-1 — `setScenario` target field.
  - File: `packages/web/src/admin/simulator/DeviceRow.tsx` (entire file) and the spec at `_bmad-output/implementation-artifacts/2-5-admin-simulator-tab.md:137-141`
  - Spec says: Deviations should be logged so future readers don't flag them as regressions.
  - Code does: The Pause/Resume toggle substitutes for the spec's Start/Pause/Switch enumeration. This is a deliberate consolidation (per Group 2's `setPaused`-only model), but no change-log entry documents it.
  - Gap / risk: A future reviewer will re-flag Finding 3 unless the deviation is logged in the spec's Change Log with a one-line note ("Start semantic folded into Pause/Resume via `paused: false`").

**Finding 14 (minor)**: `disabled` body shape from api (Group 2 change) — web type doesn't declare the field
  - AC: Spec I/O matrix line 47 — "503 with `{ disabled: true }`".
  - File: `packages/web/src/admin/simulator/useSimulatorDevices.ts:29-32`
  - Spec says: When api is missing env, the 503 body is `{ disabled: true, reason: "missing" }`.
  - Code does: `SimulatorStatus` declares `enabled: boolean` and `reason?: string` — does NOT declare `disabled: boolean`. The body shape contract is undocumented at the TS layer, even though the fallback handling accepts it via duck-typing.
  - Gap / risk: F-2.5-15 was deferred by Group 2 ("disabledResponse body shape change ripples to web clients"). The web was updated to handle the shape, but the type system still doesn't reflect it. A future refactor that reads `body.disabled` instead of the implicit `enabled: false` coercion would be invisible to TS.

**Finding 15 (minor)**: StatusQuery loading branch holds the page even if devices arrive first
  - AC: AC1 — "six device rows render with current scenario badges".
  - File: `packages/web/src/admin/simulator/SimulatorPage.tsx:71-78`
  - Spec says: Admin should see six rows as soon as both queries settle.
  - Code does: `if (statusQuery.isLoading || devicesQuery.isLoading)` — the loading state shows "Loading…" until BOTH queries resolve, even if devices query is already populated. In practice both queries fire in parallel, so this is a one-tick discrepancy.
  - Gap / risk: Cosmetic. A flicker of "Loading…" before both queries settle is acceptable.
