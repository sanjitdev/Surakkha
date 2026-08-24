**Finding 1 (critical)**: Simulator-side `POST /admin/simulator/:device_id/scenario` returns 503 when `SIMULATOR_SECRET` is unset, but spec mandates 403.
  - AC: AC2 (spec line 127, "SIMULATOR_SECRET unset on either side, when the Admin renders /admin/simulator, then the disabled banner ... renders"). Implicitly tied to spec line 110 task text: "Missing env → /status returns `{ enabled: false }` and **the POST returns 403**."
  - File: `packages/simulator/src/control/server.ts:319-327`
  - Spec says: When `SIMULATOR_SECRET` is unset on the simulator side and the api forwards a POST, the simulator should return HTTP **403** `{ error: "secret_mismatch" }` (per spec line 110).
  - Code does: `resolveSimulatorSecret()` returns `{ ok: false, reason: "missing" }` → `disabledResponse()` returns 503 with `{ disabled: true, reason: "missing" }`. Same disabled envelope for GET and POST — never 403.
  - Gap / risk: The wire contract change makes the api-side `simulatorClient.ts` translate the 503 into `kind: "unknown"` and surface as 502 `simulator_unreachable` (renderer maps `unknown` → 502 per `simulatorRouter.ts:165-168`). An admin who has correctly configured the api secret but not the simulator secret (very plausible during incremental rollout) will see a "Simulator unreachable" toast instead of the "Simulator disabled" banner — defeating AC2's "disabled banner shows the same copy regardless of which side is unset" intent. The api-side 503 path (when api's secret is missing) already produces the banner; only the simulator-side missing path falls through to 502. Spec line 26 ("Missing/short on either side → disabled state") suggests the intent was unified behavior, but the literal wire contract (line 110) was 403 — implementation broke one of the two paths.

**Finding 2 (major)**: Audit logger uses `context` field; spec mandates `payload`.
  - AC: AC4 (spec line 129, "one `AuditLog` row exists with `auditAction: 'simulator_event'`, `actor_user_id` from the JWT, `payload: { device_id: 'A', scenario: 'RisingTDS' }`"). Spec Boundaries line 27: "One `AuditLog` row per action with `auditAction: 'simulator_event'`, `actor_user_id` from the JWT, `payload: { device_id, scenario }`."
  - File: `packages/api/src/admin/simulatorRouter.ts:393-402`
  - Spec says: Audit row must have key `payload: { device_id, scenario }`.
  - Code does: Emits `context: { device_id: deviceId, scenario: body.scenario, paused: body.paused }` (extra `paused` field, but uses `context` not `payload`).
  - Gap / risk: The audit logger interface (`packages/api/src/audit.ts:11-17`) was defined with `context?` (Story 1.5 contract), not `payload`. The implementation is consistent with the existing audit contract but contradicts the spec's literal wording. When v2 promotes this to a Prisma `AuditLog` table, the column will be `payload` per spec but the json will be written under `context`, causing a schema/runtime mismatch. Either rename the audit logger's key to `payload` (cross-cutting change touching auth, RBAC, etc.) or update the spec. Deviation acknowledged but unresolved.

**Finding 3 (major)**: Api GET `/admin/simulator/status` returns `{enabled: false, reason: "missing"}` on disabled state; spec body says `{disabled: true}`.
  - AC: AC2 (spec line 127). Tied to I/O matrix row 47: "Admin renders page, secret unset on api | GET `/admin/simulator` (api returns 503 with `{ disabled: true }`) | Disabled banner renders..."
  - File: `packages/api/src/admin/simulatorRouter.ts:240-248` (public surface) and `:274-281` (authenticated duplicate)
  - Spec says: 503 body should be `{ disabled: true }`.
  - Code does: 503 body is `{ enabled: false, reason: "missing" }`.
  - Gap / risk: Asymmetric shape — `enabled` flag flipped vs `disabled` flag set. The web side's `DisabledBanner.tsx` (line 116 task spec) is documented as checking `enabled === false`, which matches the implementation's branch. So the wire contract is internally coherent with the web code, but contradicts the I/O matrix's literal `{ disabled: true }`. Likely a loopback-1 rename that wasn't propagated to the matrix. Drift only — no functional bug since the consuming web client is in lockstep. Flag for spec body fix.

**Finding 4 (major)**: Api `POST /admin/simulator/:device_id/scenario` returns 503 `{disabled:true,reason:"missing"}` when api-side secret missing — `disabled` shape is correct, but `enabled:false` shape would be more consistent with GET.
  - AC: AC2 (spec line 127). I/O matrix line 47 also references this surface.
  - File: `packages/api/src/admin/simulatorRouter.ts:322-328`
  - Spec says: Disabled state contract — the spec doesn't pin the exact body for POST specifically but uses `{ disabled: true }` for GET.
  - Code does: Returns `{ disabled: true, reason: "missing" }` for POST. The GET returns `{ enabled: false, reason: "missing" }`. Two different shapes for the same disabled state depending on route. SPA code likely normalizes both, but this is asymmetric and risks client-side branching bugs.
  - Gap / risk: Inconsistent disabled-state response shape between GET (uses `enabled: false`) and POST (uses `disabled: true`). Both signal the disabled state but via inverted fields. Either unify both endpoints to `disabled: true` (matching spec I/O matrix literal) or to `enabled: false` (matching the loopback-1 fix).

**Finding 5 (major)**: Api `GET /devices` uses `{ action: "read", resource: "Device" }` instead of spec's `{ action: "read", resource: "Simulator" }`.
  - AC: AC3 (non-Admin denied). Tied to AC1 (Admin renders 6 rows).
  - File: `packages/api/src/admin/simulatorRouter.ts:294-307`
  - Spec says: Task line 107 explicitly states "GET /devices (Admin-only via `authorize({ action: "read", resource: "Simulator" }, audit)` — note: Admin.read.Simulator is N at `packages/shared/src/rbac.ts:113`, so **use a different gate — see Ask-First**)". The implementation chose `Device.read`, which the spec's Code Map narrative (line 290) endorses.
  - Code does: Uses `{ action: "read", resource: "Device" }`. This grants Operator/Technician/Viewer read access to the devices list (per matrix Story 1.5), so the api returns 200 to an Operator (spec test line 327 confirms this is intended).
  - Gap / risk: Test `returns 200 when an Operator reads the devices list` (simulatorRouter.spec.ts:327) documents this deliberate broadening. The spec's task list explicitly defers the "use a different gate" decision via Ask-First. If Ask-First was never resolved, this is a documented-but-pending design decision. **Justified in scope** — the implementation matches the spec's Code Map commentary line 290 ("Admin-only via Device.read ... The matrix grants Admin.read.Device but denies Simulator.read"). Justifiable deviation if the Ask-First question was resolved in favor of Device.read.

**Finding 6 (minor)**: Header name casing inconsistency between api outbound and simulator inbound.
  - AC: I/O contract literal (no AC number, but spec line 28: "X-Simulator-Secret" referenced, and the simulator "compares with `crypto.timingSafeEqual`" per line 26).
  - File: `packages/api/src/admin/simulatorClient.ts:32` uses `"X-Simulator-Secret"`; `packages/simulator/src/control/server.ts:54` uses `"x-simulator-secret"`.
  - Spec says: Header name is `X-Simulator-Secret` (per the api client task line 109: "headers: { 'X-Simulator-Secret': SECRET }").
  - Code does: Sends with title-case `X-Simulator-Secret`; reads with lowercase `x-simulator-secret`. Node's HTTP layer is case-insensitive for headers, so this works.
  - Gap / risk: Cosmetic / no functional impact. Normalize both to one case for clarity.

**Finding 7 (minor)**: Audit row includes extra `paused` field beyond spec's mandatory fields.
  - AC: AC4 (spec line 129, `payload: { device_id: "A", scenario: "RisingTDS" }`).
  - File: `packages/api/src/admin/simulatorRouter.ts:397-400`
  - Spec says: Payload shape is `{ device_id, scenario }`.
  - Code does: Emits `{ device_id, scenario, paused }` (omits `paused` only when undefined). Forward-compatible — extra field is harmless but not in spec.
  - Gap / risk: Spec writers may have intended `payload` to be a fixed schema; the addition of `paused` is benign for v1 but if a v2 schema enforces required/optional keys, this could fail. Nit / minor drift.

**Finding 8 (major)**: Api `POST /admin/simulator/:device_id/scenario` for invalid scenario returns 400 `{ error: "invalid_scenario" }` only when `scenario === undefined || paused === undefined`. A `{scenario: "Bogus", paused: true}` combo returns `validation_error` instead.
  - AC: AC5 (spec line 130, "Given an Admin POSTs an unknown scenario name, when the api processes it, then it returns 400 `{ error: 'invalid_scenario' }` and no AuditLog row is written"). Tied to loopback-1 P4 fix (mentioned line 144).
  - File: `packages/api/src/admin/simulatorRouter.ts:216-223`
  - Spec says: Any unknown scenario name should yield `invalid_scenario`.
  - Code does: Returns `invalid_scenario` only when `body.scenario !== undefined && body.paused === undefined && !SCENARIO_SET.has(body.scenario)`. The branch covers the canonical case `{ scenario: "Bogus" }` but a payload `{ scenario: "Bogus", paused: true }` falls through to the Zod schema success path (scenario is a string, paused is a boolean — both pass), then passes to `validateScenarioRequest`'s return — but never hit the `invalid_scenario` branch because `body.paused !== undefined`. The handler then forwards `{scenario: "Bogus", paused: true}` to the simulator which returns its own 400 `invalid_scenario`, and the api maps this into `unknown` → 502 `simulator_unreachable`. So the admin sees 502, not 400.
  - Gap / risk: AC5 is met for the common case `{ scenario: "Bogus" }` (tested at simulatorRouter.spec.ts:404-421) but violated for the combo case. The router's P4 fix comment (line 211-215) acknowledges this branch narrowing but the resulting 502 contradicts AC5's promise that unknown scenarios always return 400 to the SPA. Likely an acceptable UX call (admin combined scenario+paused — the second field is intentionally dropped by `outbound` builder at simulatorRouter.ts:359-362) but the wire response code shifts to 502.

**Finding 9 (major)**: AC4 partial — simulator `setScenario` mutates `currentScenario` rather than `opts.scenario`.
  - AC: AC4 (spec line 129, "5 s ... new scenario active"). Spec Code Map line 90: "Tasks & Acceptance row: `setScenario(name: ScenarioName)` setter that updates `this.opts.scenario`. No constructor change."
  - File: `packages/simulator/src/wsClient.ts:131-142, 214-225`
  - Spec says: Setter updates `this.opts.scenario`.
  - Code does: Setter mutates `this.currentScenario` (a decoupled field), not `this.opts.scenario`.
  - Gap / risk: This is **explicitly acknowledged in the Spec Change Log** under "Loopback 1 — setScenario target field" (line 137-141): the spec text said update `opts.scenario` but the implementation mutates `currentScenario` to keep `WsClientOptions` immutable. Logged deviation, KEEP. **In scope and justified.** No audit issue.

**Finding 10 (nit)**: Api `validateSimulatorBaseUrl` rejects URL with any non-root path but accepts `pathname === ""` in addition to `"/"`. The edge case is unreachable in normal use but the dual check is redundant.
  - AC: Not a named AC; relates to wire contract of outbound POST URL construction (spec line 109).
  - File: `packages/api/src/admin/simulatorClient.ts:82-84`
  - Spec says: No spec text on validation rules for `SIMULATOR_URL`.
  - Code does: `if (parsed.pathname !== "/" && parsed.pathname !== "") return null;`
  - Gap / risk: `new URL()` always returns a string pathname (defaults to `"/"` if absent), so the `""` branch is dead code. Cosmetic.

**Finding 11 (major)**: AC8 violates the spec on api side — secret_mismatch causes api to return 403 to admin, but the spec's I/O matrix line 47 references only the disabled case via GET. AC8 spec line 133 says "api returns 403 `{ error: 'secret_mismatch' }` and the UI shows the same disabled banner state as missing-secret" — fully implemented.
  - AC: AC8 (spec line 133).
  - File: `packages/api/src/admin/simulatorRouter.ts:744-757` (renderSwitchResult), `packages/api/src/admin/simulatorClient.ts:132-136` (translation).
  - Spec says: api returns 403 `{ error: "secret_mismatch" }`, UI shows same disabled banner state.
  - Code does: Returns 403 `{ error: "secret_mismatch" }`. UI behavior is out of Group 2 scope (web side), but the api emits the right code. Found **G1-22-precedent**: the spec is internally consistent here.
  - Gap / risk: Implementation correct.

**Finding 12 (major)**: AC7 single-flight queue allows depth = 2 (one queued), rejects on third — matches the loopback-1 spec narrative "P5 — second is queued, third returns 409." But spec I/O matrix line 53 says "second is queued ... 409 if the queue is full," which could be read as second = 409, not third.
  - AC: AC7 (spec line 132, "second is queued ... if the queue is full the second returns 409 `{ error: 'switch_in_progress' }`").
  - File: `packages/api/src/admin/simulatorRouter.ts:336-342`
  - Spec says: Spec narrative (Code Map line 252: "queue of size 1 (single in-flight)") plus the test description "queues the second POST (P5) and only returns 409 for the third" suggests: second waits, third 409.
  - Code does: depth > 2 returns 409, so first runs (depth=1), second queued (depth=2, awaits first), third rejected (depth=3 > 2 → 409). This matches the test expectations.
  - Gap / risk: The I/O matrix line 53 literal "if the queue is full the second returns 409" is technically violated if you read "second" as the second-arriving request. The implementation lets the second through. The narrative (line 252) and tests align, but the table row is ambiguous. **Intent matches the code; literal text ambiguous.**

**Finding 13 (critical)**: Simulator `/status` GET when secret missing returns 503 with `{disabled: true, reason: "missing"}` body; spec Code Map line 110 says "/status returns `{ enabled: false }`".
  - AC: AC2 (spec line 127).
  - File: `packages/simulator/src/control/server.ts:319-327`
  - Spec says: `/status` should return `{ enabled: false }` when secret is missing.
  - Code does: Returns 503 with `{ disabled: true, reason: "missing" }`. The 503 status is correct (matches AC2 intent); the body field is `disabled: true` not `enabled: false`.
  - Gap / risk: Same asymmetric-shape issue as Finding 3 (api GET uses `enabled: false`, this uses `disabled: true`). Web client likely normalizes both, but the contract surface is inconsistent across endpoints: `enabled: false` on api GET vs `disabled: true` on api POST and simulator GET.

**Finding 14 (major)**: AC4 (5s SLA) — api outbound timeout is 5_000 ms (`SIMULATOR_CLIENT_TIMEOUT_MS` in simulatorClient.ts:30), but the spec's SLA is "scenario switch applied within 5 s" (line 29, Boundaries). The timeout is for the outbound POST, not for end-to-end observation. Round-trip api↔simulator within 5 s is satisfied, but total api-handler time (auth + Zod + queue + outbound fetch) is not bounded. If the queue is saturated, a queued POST could wait indefinitely beyond 5 s.
  - AC: AC4 (spec line 29: "Scenario switch must apply on the device within 5 s of the api's POST returning 200").
  - File: `packages/api/src/admin/simulatorRouter.ts:368-409`, `packages/api/src/admin/simulatorClient.ts:113-114`
  - Spec says: 5 s SLA from "api POST returns 200" to "simulator emits new frames".
  - Code does: The 5 s AbortController is on the outbound fetch only. The queue `firstPromise` is awaited indefinitely (no timeout on the awaited promise). With 2 concurrent POSTs, the second could wait >5 s for the first's fetch to complete.
  - Gap / risk: A second concurrent request starts its own 5 s timer only AFTER waiting for the first's promise. In the worst case (first request has just started a 5 s fetch), the second waits 5 s, then waits another 5 s for its own fetch — exceeds the SLA from a user-perception standpoint. The api never returns 200 within 5 s in this case. Likely acceptable (admin UI buttons disable while pending) but the SLA is not technically enforceable.

**Finding 15 (minor)**: Api `postSimulatorScenario` lacks `User-Agent` header — outbound fetch identification not set; spec doesn't require one.
  - AC: Not a named AC.
  - File: `packages/api/src/admin/simulatorClient.ts:117-130`
  - Spec says: No requirement for User-Agent.
  - Code does: Sends only `X-Simulator-Secret` and `Content-Type`.
  - Gap / risk: Operational/debugging gap — server logs can't easily attribute inbound requests. Cosmetic.

**Finding 16 (minor)**: WsClient `setPaused` is idempotent at the new-value level (`if (this.paused === paused) return`), but re-emits "pause toggled" log only on change. Spec doesn't constrain.
  - AC: AC1 (spec line 126 — "Start / Pause / Switch control set"). Pause primitive semantics deferred to Ask-First (spec line 32).
  - File: `packages/simulator/src/wsClient.ts:234-238`
  - Spec says: Pause semantic "pause the tick loop vs. close the socket — must be confirmed before coding" was listed as Ask-First.
  - Code does: Implements "pause the tick loop while keeping WS open" — keeps the socket connected. This is a reasonable interpretation; Awaited Ask-First resolution not visible in spec change log.
  - Gap / risk: If Ask-First resolved in favor of close-socket semantics, this is wrong. If resolved in favor of pause-the-tick (the implementation), this is right. Loopback-1 (line 142, "Loopback 1 — setScenario target field") doesn't address Pause semantics. Justified by absence of conflicting decision, but undocumented.

**Finding 17 (major)**: AC4 — single-flight queue is keyed on `deviceId`, so two concurrent admin clicks for the SAME device produce the queueing behavior, but two concurrent clicks across DIFFERENT devices (A and B) are not bounded. The spec says "single-flight per device" (line 252), which is what's implemented. But the spec's AC7 wording "two Switch requests for the same device" — verified.
  - AC: AC7 (spec line 132). Implementation matches spec.
  - File: `packages/api/src/admin/simulatorRouter.ts:336-342`
  - Gap / risk: None relative to spec. Cross-device concurrency unbounded by design.

**Finding 18 (critical)**: AC4 — the `__test__deviceId` accessor is invoked externally by `index.ts:boot()` at line 313 (`c.__test__deviceId()`) to populate the control server's registry. The accessor name carries the `__test__` prefix (signaling test seam) but is now used in production boot.
  - AC: AC4 (general AC; no specific test-seam restriction in spec).
  - File: `packages/simulator/src/wsClient.ts:201`, `packages/simulator/src/index.ts:313`
  - Spec says: Code Map line 90 implies `setScenario` is the public mutator surface; the device_id accessor isn't called out. No prohibition on `__test__` seams in production.
  - Code does: Production boot reads `__test__deviceId()` to populate the clientsRegistry Map keyed by device_id. There's no public equivalent — the WsClient class has no `deviceId` getter outside the test-seam namespace.
  - Gap / risk: Architectural smell — production code calling test seams crosses the seam boundary. If the seam were ever fuzz-tested or removed in a refactor, boot would break silently. Should rename to a non-`__test__` accessor (e.g., public `deviceId` getter) since it's now a stable production dep. The "test seam" framing is no longer accurate.

**Finding 19 (major)**: AC2 — api's `resolveSimulatorConfig` only checks `process.env["SIMULATOR_SECRET"]` is set and non-empty; does NOT enforce the 32-char minimum that the spec's hardening pattern (matches JWT_SECRET) requires.
  - AC: AC2 (spec line 127). Implicitly tied to "Minimum token / secret length" — the simulator's `resolveSimulatorSecret` enforces 32 chars (server.ts:115).
  - File: `packages/api/src/admin/simulatorRouter.ts:111-117`
  - Spec says: Spec Boundaries line 26 says "Missing/short on either side → disabled state". This implies both sides must enforce the 32-char minimum.
  - Code does: Api's `resolveSimulatorConfig` returns `null` only when `SIMULATOR_SECRET` is undefined or empty; accepts a 1-character secret. Simulator's `resolveSimulatorSecret` enforces 32 chars minimum. Asymmetric enforcement.
  - Gap / risk: An admin who sets `SIMULATOR_SECRET=abc` on both sides (length-3 secret) will: api thinks it's enabled; simulator thinks it's disabled (returns 503). The mismatch surfaces as a "disabled banner" on the SPA but for the wrong reason — and any 1-31 char secret on the api side trivially satisfies the api. Symmetry broken. Should match the simulator's 32-char minimum.

**Finding 20 (major)**: AC2 + AC8 — the secret-mismatch toast on the spec says "Simulator disabled. — same banner state as missing-secret" (spec line 52, I/O matrix). The implementation returns 403 `{ error: "secret_mismatch" }` and pushes it onto the SPA. Whether the SPA collapses this to a disabled banner is a web concern — but the api side distinguishes secret_mismatch (403) from disabled (503) which the spec says should be collapsed to one banner state. This is correctly orthogonal at the API boundary; the collapsing is the SPA's job (out of scope). Confirmed correct.
  - AC: AC2, AC8. Combined observation.
  - File: `packages/api/src/admin/simulatorRouter.ts:148-169`
  - Gap / risk: None at the api boundary. Verified.

**Finding 21 (major)**: AC5 / AC6 — the 400 `invalid_scenario` and 502 `simulator_unreachable` paths correctly write NO `simulator_event` audit row (only `rbac_denied` from middleware). Tests confirm. Confirmed correct.
  - AC: AC5 (line 130), AC6 (line 131).
  - File: `packages/api/src/admin/simulatorRouter.ts:392-403` (audit emit gated on `result.ok`)
  - Gap / risk: None. Verified correct.

**Finding 22 (major)**: AC1 (sim control page surface) — out of Group 2 scope (web side). Partial verification: the api side serves the data (GET /devices returns 6 rows including nullable name/scenario fields) per AC1's "six device rows render with current scenario badges". api side correct; UI side unverified in this group.
  - AC: AC1 (spec line 126).
  - File: `packages/api/src/index.ts:107-146`, `packages/api/src/admin/simulatorRouter.ts:294-307`
  - Gap / risk: None for api side. Confirmed correct: 200 with `{devices: [{device_id, name, scenario}, …]}` matching spec's "six rows from the Prisma Device table" (line 116 task).

**Finding 23 (nit)**: Api spec conformance — the public `/status` surface is mounted on `buildAdminSimulatorPublicRouter` BEFORE `app.use(authenticate)` (spec's intent: "disabled banner must render for any visitor"); also duplicated on the private router as `/status` for standalone tests. Documented in code (line 261-269). Asymmetric mounting pattern — but justified. No spec violation.
  - AC: AC2 supporting — `/status` must be reachable without auth.
  - File: `packages/api/src/admin/simulatorRouter.ts:234-251` (public), `:270-283` (duplicate on private)
  - Gap / risk: None.

**Finding 24 (major)**: AC2 (simulator side missing) — when api has secret but simulator does not, the api's outbound POST receives 503 from the simulator; api's `simulatorClient.ts` catches it as `unknown` → api maps to 502 `simulator_unreachable`. SPA shows "Simulator unreachable" toast, NOT the disabled banner. This contradicts AC2's "banner shows the same copy regardless of which side is unset". The intended UX is consistent-disabled-state, but the implementation distinguishes api-missing (503 → banner) from simulator-missing (503 → upcast to 502 → "unreachable" toast).
  - AC: AC2 (spec line 127).
  - File: `packages/api/src/admin/simulatorClient.ts:140-149` (unknown handling), `packages/api/src/admin/simulatorRouter.ts:164-168` (unknown → 502).
  - Spec says: Disabled state regardless of which side is unset.
  - Code does: Api-side missing → 503 → banner. Simulator-side missing → 503 → upcast to 502 → unreachable toast.
  - Gap / risk: Asymmetric UX. The simulator should return 403 `secret_mismatch` per spec (Finding 1) so the api can correctly bucket it as 403 → "disabled" path. The double-bucketing bug here traces back to Finding 1.

**Finding 25 (major)**: AC4 timing — `setClientsRegistry` is called synchronously after `clients.push(client); client.start()` in `boot()` (index.ts:312-315). `client.start()` opens a Socket.IO connection asynchronously but the control server can apply scenario changes BEFORE the socket is connected. If the first frame is emitted via `tickOnce` before the WS handshake completes, frames go into the buffer (per `dispatch` line 462-468). A scenario swap that arrives before connection persists — `setScenario` updates `currentScenario` but the buffered frames are stamped with the OLD scenario. Spec doesn't pin this exact behavior but AC4 says "new scenario active in ≤5 s" — a 5 s swap during the first connection window could leave 1-2 stale frames in the buffer.
  - AC: AC4 (spec line 129, "within 5 s the simulator emits frames under the new scenario").
  - File: `packages/simulator/src/index.ts:312-315`, `packages/simulator/src/wsClient.ts:462-468`
  - Spec says: New scenario must produce new frames within 5 s.
  - Code does: Frames generated before socket connects are buffered with their original scenario; a scenario swap that triggers `setScenario` immediately after boot may leave 1-2 stale frames in the buffer (emitted on `flushBuffer` upon connect).
  - Gap / risk: Boot-window race. If admin clicks Switch within the first ~2 s of simulator boot, the api returns 200 (ack of POST), but the buffered frames flushed at connect time still carry the OLD scenario. Drain on connect will replay old frames BEFORE new frames arrive. Likely benign for v1 (admin unlikely to click within 2 s of boot) but worth a follow-up: drop the buffer on `setScenario` to guarantee no stale replay after a switch.
