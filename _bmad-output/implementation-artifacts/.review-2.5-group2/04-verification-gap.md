# Group 2 — Verification Gap (API + Simulator control)

**Finding 1 (critical)**: Two-WsClient integration has no test — `control/server.ts` and `WsClient.setScenario` are tested in isolation but never wired together
- AC / behavior: Spec §Boundaries "scenario switch must apply on the device within 5 s" requires the admin POST to drive a real `WsClient.setScenario` call. Server spec stubs `SimulatorClientLike`; WsClient spec stubs the socket. Neither test exercises the end-to-end bootstrap: `boot()` → `setClientsRegistry(new Map(registryEntries))` → real WsClient → POST → assert scenario change via the REGISTRY.
- File: `packages/simulator/src/control/server.ts:309-351`, `packages/simulator/src/index.ts:298-315`
- Gap: No integration test of the load-bearing path.
- Suggested test: Real WsClient wired to a real control server; POST → assert `client.__test__scenario()` reflects the new name.

**Finding 2 (critical)**: `boot()` async IIFE for control server start has zero test coverage
- AC / behavior: `boot()` must register the registry AND start the control server.
- File: `packages/simulator/src/index.ts:298-358`
- Gap: Neither the EADDRINUSE → `process.exit(1)` branch nor the graceful SIGTERM shutdown path is tested.
- Suggested test: Mock `startControlServer` EADDRINUSE → assert exit(1) and all clients stopped.

**Finding 3 (major)**: `simulatorClient.ts` has NO companion spec file
- File: `packages/api/src/admin/simulatorClient.ts:113-160` — no `.spec.ts` in the diff
- Gap: 503 timeout path, URL guard (`validateSimulatorBaseUrl`), `unknown` mapped to `invalid_simulator_url` all untested.
- Suggested test: `simulatorClient.spec.ts` with fake timers + URL guard tests.

**Finding 4 (major)**: `paused` request through api router has no `paused`-specific audit assertion
- File: `packages/api/src/admin/simulatorRouter.spec.ts` — only `{ scenario: "RisingTDS" }` path tested
- Gap: Audit row's `paused` field never asserted at api level; only simulator-side tested.
- Suggested test: POST `{ paused: true }` → assert audit row emits correct context.

**Finding 5 (major)**: `paused + invalid_scenario` combo branch untested
- File: `packages/api/src/admin/simulatorRouter.ts:204-223`
- Gap: Validation `else` branch on `body.paused === undefined` should surface `validation_error` not `invalid_scenario`. Not pinned.
- Suggested test: POST `{ paused: true, scenario: "Bogus" }` → expect 400 `validation_error`.

**Finding 6 (major)**: Strict-mode unknown body keys untested
- File: `packages/api/src/admin/simulatorRouter.ts:66-78`
- Gap: Zod `.strict()` rejection of unknown keys not exercised.
- Suggested test: POST `{ scenario: "RisingTDS", extra_key: "x" }` → 400 `validation_error`.

**Finding 7 (major)**: `invalid_device_id` 400 branch not tested at router level
- File: `packages/api/src/admin/simulatorRouter.ts:193-200`
- Gap: UUIDv4 regex validation in router not pinned.
- Suggested test: POST `/admin/simulator/not-a-uuid/scenario` → 400 `invalid_device_id`.

**Finding 8 (major)**: Single-flight queue state-leak across tests
- File: `packages/api/src/admin/simulatorRouter.ts:98-99, 411-424`
- Gap: Module-scoped maps may leak between tests; `finally` only clears depth when remaining <= 0.
- Suggested test: Force outbound fetch to hang; assert maps are clean after `close()`.

**Finding 9 (major)**: Operator `read Device` test asserts 200 but never asserts body shape
- File: `packages/api/src/admin/simulatorRouter.spec.ts:154-165, 132-145`
- Gap: Operator 200 path doesn't pin JSON body shape — G1-02 finding deferred to Group 2.
- Suggested test: Assert Operator receives `{ device_id, name: null, scenario: null }` for legacy rows.

**Finding 10 (major)**: `outboundCalls === 2` assertion in queue test is timing-dependent
- File: `packages/api/src/admin/simulatorRouter.spec.ts:320-383`
- Gap: 5ms `setTimeout` is real-time racey; test can pass trivially or fail under CI load.
- Suggested test: Hook `outboundFetch` to deterministically order calls.

**Finding 11 (major)**: Single-flight queue does NOT test the "second request sees the first's failure" branch
- File: `packages/api/src/admin/simulatorRouter.ts:369-405`
- Gap: Try/catch to swallow first-request failure is implicit design; not pinned.
- Suggested test: First outbound rejects; second queued behind it returns 200 with own audit row.

**Finding 12 (major)**: `method_not_allowed` on control server POST endpoint untested
- File: `packages/simulator/src/control/server.ts:272-280, 218-220`
- Gap: GET/PUT/DELETE to scenario endpoint + bare-GET path + unknown-route are unverified.
- Suggested test: GET on /scenario → 400 `method_not_allowed`. PUT, DELETE same. Random path → 404 `not_found`.

**Finding 13 (major)**: `payload_too_large` and `invalid_json` control-server error paths untested
- File: `packages/simulator/src/control/server.ts:144-167, 280-291`
- Gap: 16 KB body cap and JSON parse errors not pinned.
- Suggested test: 17 KB body → 400 `payload_too_large`. Malformed JSON → 400 `invalid_json`.

**Finding 14 (major)**: Control server's `disabled` POST path (POST when secret unset) tested only for /status
- File: `packages/simulator/src/control/server.spec.ts:108-127` vs `server.ts:320-327`
- Gap: POST to /scenario when secret unset not pinned.
- Suggested test: Delete SIMULATOR_SECRET → POST → expect 503 `{ disabled: true, reason: "missing" }`.

**Finding 15 (major)**: `unknown` result body forwarding to SPA not unit-tested at api level
- File: `packages/api/src/admin/simulatorRouter.ts:148-169` `renderSwitchResult`
- Gap: 500 from simulator → 502 with `upstream.body` not exercised. Body unmarshalling (`body === null` on non-JSON) untested.
- Suggested test: outboundFetch returns 500 JSON → assert 502 with `upstream.status === 500`. outboundFetch returns 400 non-JSON → assert `upstream.body === null`.

**Finding 16 (major)**: `paused`-only forward (no `scenario` in body) untested
- File: `packages/api/src/admin/simulatorRouter.ts:358-362`
- Gap: Asymmetric forwarding logic (`if scenario !== undefined && paused === undefined`) not pinned.
- Suggested test: POST `{ paused: true }` → outbound called with `{ paused: true }` (no scenario key).

**Finding 17 (major)**: Audit row assertion uses `toMatchObject` not `toEqual`
- File: `packages/api/src/admin/simulatorRouter.spec.ts:194-204`
- Gap: Audit row's full shape (auditAction, outcome, extra fields) not exactly pinned.
- Suggested test: Use `toEqual` for exact match.

**Finding 18 (minor)**: `__test__deviceId` test seam is untested
- File: `packages/simulator/src/wsClient.ts:201`
- Gap: One-liner test missing.
- Suggested test: `expect(client.__test__deviceId()).toBe(DEVICE_ID)`.

**Finding 19 (minor)**: `setScenario` happy-path only tested for one of seven SCENARIO_NAMES
- File: `packages/simulator/src/__tests__/wsClient.spec.ts:438-468`
- Gap: Loop with `it.each` to pin all 7 scenarios.
- Suggested test: `it.each(SCENARIO_NAMES)` loop.

**Finding 20 (minor)**: `setPaused` no-op same-value short-circuit untested
- File: `packages/simulator/src/wsClient.ts:233-238`
- Gap: `if (this.paused === paused) return;` not pinned.
- Suggested test: Stub logger; assert log emitted once, not twice.

**Finding 21 (minor)**: `parseRoute` query-string stripping untested
- File: `packages/simulator/src/control/server.ts:204-205`
- Gap: `/admin/simulator/{id}/scenario?leak=1` behavior not pinned.
- Suggested test: POST with query string → still 200.

**Finding 22 (minor)**: `disabledResponse` body shape pinned on api side only for /status
- File: `packages/api/src/admin/simulatorRouter.ts:240-249`
- Gap: Reason field forwarding + URL-misconfig variant not pinned.
- Suggested test: Multiple `SIMULATOR_URL` misconfig scenarios.

**Finding 23 (minor)**: `validateSimulatorBaseUrl` bad-URL paths untested
- File: `packages/api/src/admin/simulatorClient.ts:72-89`
- Gap: ftp://, http://host/sub, etc., never exercised.
- Suggested test: Each bad URL → 502 with `invalid_simulator_url`.

**Finding 24 (minor)**: SIGTERM graceful shutdown path untested
- File: `packages/simulator/src/index.ts:361-384`
- Gap: SIGTERM handler that closes control server has no test.
- Suggested test: Fire SIGTERM → assert close counter incremented.

**Finding 25 (minor)**: Audit row NOT written on disabled path (spec silent)
- File: `packages/api/src/admin/simulatorRouter.ts:322-328`
- Gap: 503 test stub discards all events.
- Suggested test: Capture events; assert zero `simulator_event` rows.

**Finding 26 (minor)**: `paused: false` round-trip short-circuit not separately pinned
- File: `packages/simulator/src/wsClient.ts:233-238`
- Gap: Same as Finding 20.

**Finding 27 (minor)**: `validateScenarioRequest` `{ paused: true }` body passing path untested
- File: `packages/api/src/admin/simulatorRouter.ts:66-78, 204-223`
- Gap: `paused`-only body schema acceptance not pinned.
- Suggested test: POST `{ paused: true }` Admin → 200.

**Finding 28 (minor)**: `startControlServer` doesn't validate it actually accepts traffic
- File: `packages/simulator/src/control/server.spec.ts:263-271`
- Gap: `typeof port === 'number'` is too permissive; no request sent.
- Suggested test: GET to returned port → expect 403 (secret header missing).

**Finding 29 (nit)**: `__test__paused` short-circuit case never tested (consolidated with Finding 20)

**Finding 30 (nit)**: Empty secret header array case (duplicate headers) untested
- File: `packages/simulator/src/control/server.ts:133-138`
- Gap: First-wins behavior not pinned.
- Suggested test: Two headers → first wins.

**Finding 31 (nit)**: Type narrowing assumption — `body.scenario as ScenarioName` cast defense not pinned
- File: `packages/api/src/admin/simulatorRouter.ts:358-362`
- Gap: Conditional cast is implicit.
- Suggested test: Pin the condition's narrowness.

**Finding 32 (nit)**: Process env save/restore in tests; vitest workers fragility
- File: `packages/api/src/admin/simulatorRouter.spec.ts:100-109`
- Gap: Not actionable; document.
- Suggested test: Vitest config `singleThread` if needed.

**Finding 33 (nit)**: `invalid_scenario` test does not assert simulator was NOT called
- File: `packages/api/src/admin/simulatorRouter.spec.ts:231-248`
- Gap: 400 path may silently forward.
- Suggested test: Use `outboundCalls` counter; assert `=== 0`.

**Finding 34 (nit)**: Audit row `context` shape keys (paused presence) not pinned
- File: `packages/api/src/admin/simulatorRouter.ts:398-401`
- Gap: Schema may silently include/exclude `paused`.
- Suggested test: Assert exactly two keys.

**Finding 35 (nit)**: Cookie parser interaction with admin router — informational
- File: `packages/api/src/index.ts:75, 84-85`
- Gap: None.

**Finding 36 (nit)**: `listDevicesFromPrisma` silent-swallow on Prisma error not pinned
- File: `packages/api/src/index.ts:107-146`
- Gap: No test exercises this branch.
- Suggested test: Mock Prisma to throw → assert empty array (current contract).

**Finding 37 (nit)**: `setClientsRegistry` race with concurrent `boot()` not pinned
- File: `packages/simulator/src/control/server.ts:78-87`
- Gap: Brittle invariant; document.

**Finding 38 (nit)**: `.env.example` cross-package secret agreement not pinned
- File: `packages/simulator/.env.example`
- Gap: No integration test asserts api↔simulator agreement.
- Suggested test: Real boot of both with mismatched secrets.

**Finding 39 (nit)**: Body-size asymmetry api 32 KB vs simulator 16 KB
- File: `packages/api/src/index.ts:74`, `packages/simulator/src/control/server.ts:60`
- Gap: 20 KB body → simulator returns `payload_too_large` → api 502.
- Suggested test: Post 20 KB body.

**Finding 40 (nit)**: `validateScenarioRequest` does not strip whitespace (spec silent)
- File: `packages/api/src/admin/simulatorRouter.ts:204-223`
- Gap: Informational.

**Finding 41 (nit)**: HTTP method OPTIONS for CORS preflight not handled — informational
- File: `packages/simulator/src/control/server.ts:277-280`
- Gap: Not actionable.

**Finding 42 (nit)**: Asymmetric error codes for `paused + invalid_scenario` combo
- File: `packages/api/src/admin/simulatorRouter.ts:204-223` vs `packages/simulator/src/control/server.ts:251-253`
- Gap: Api returns `validation_error`; simulator returns `invalid_scenario`. Defense-in-depth path untested.
- Suggested test: Direct simulator POST → expect simulator's `invalid_scenario`.

**Finding 43 (nit)**: `readSecretFromHeader` array branch (consolidated with Finding 30)

**Finding 44 (nit)**: `index.ts:boot()` SIGTERM race window — narrow, not worth testing
- File: `packages/simulator/src/index.ts:329-358, 371-378`
- Gap: Sub-millisecond race.
- Suggested test: Defer.

**Finding 45 (nit)**: `startControlServer` port 0 vs `SIMULATOR_CONTROL_PORT` parsing
- File: `packages/simulator/src/control/server.spec.ts:263-271`
- Gap: `typeof === 'number'` passes for 0.
- Suggested test: `expect(port).toBeGreaterThan(0)`.

**Finding 46 (critical)**: Shared `SCENARIO_NAMES` ↔ simulator `SCENARIO_NAMES` drift has no cross-package test
- File: `packages/shared/src/simulator.ts`, `packages/simulator/src/scenarios.ts:35-44`
- Gap: G1-04 deferred to Group 2; flagged again at api surface.
- Suggested test: Cross-package assert.

**Finding 47 (major)**: Concurrent request for DIFFERENT devices doesn't pin per-device isolation
- File: `packages/api/src/admin/simulatorRouter.ts:98-99, 336-405`
- Gap: Queue test only exercises device A.
- Suggested test: Two concurrent POSTs to different devices → both 200.

**Finding 48 (major)**: `disabledResponse` body shape pinned on simulator side only for /status
- File: `packages/simulator/src/control/server.spec.ts:113-127`
- Gap: POST 503 disabled path not pinned.
- Suggested test: Same as Finding 14.

**Finding 49 (major)**: Api disabled POST → simulator disabled response shape pinned only on api side
- File: `packages/api/src/admin/simulatorRouter.spec.ts`
- Gap: Banner copy consistency not verified end-to-end.
- Suggested test: Real boot integration.

**Finding 50 (major)**: `__test__deviceId` getter required for `boot()`-based integration — covered by Finding 1
- File: `packages/simulator/src/wsClient.ts:201`, `packages/simulator/src/index.ts:298-315`
- Gap: Load-bearing AC untested end-to-end.
- Suggested test: As Finding 1.
