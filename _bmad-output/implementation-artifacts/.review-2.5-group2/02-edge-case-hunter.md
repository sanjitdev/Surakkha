# Group 2 — Edge-case Hunter (API + Simulator control)

**Finding 1 (critical)**: Single-flight queue races on the `depth > 2` branch
- File: `packages/api/src/admin/simulatorRouter.ts:336-342`
- Edge case: Read `pendingDepth.get(deviceId) ?? 0`, then conditionally set, then `pendingSwitches.set` — all without a guard. Two concurrent requests that BOTH miss the `pendingSwitches` map (because the previous first request had already cleared it in `finally`) can both pass the depth check and both register their own promise as "first", each racing for the simulator. The same logic happens if the prior request's `finally` ran between the `get` and the conditional `set`.
- Impact: Two parallel switches both contact the simulator (the single-flight invariant is broken); one of them becomes the "loser" and reports success/failure to the wrong client.
- Suggested fix: Use a tiny async mutex (await a sentinel promise before mutating) or wrap the increment+`pendingSwitches.set` in a single synchronous step.

**Finding 2 (critical)**: Queue depth 2 invariant is wrong; "1 queued + 1 in-flight" not "1 queued"
- File: `packages/api/src/admin/simulatorRouter.ts:336-342`
- Edge case: The implementation treats `depth >= 2` as "queue full", but `pendingDepth` is incremented BEFORE `await work`, while a request is in-flight. So when depth === 2, we actually have "1 in-flight + 1 queued", not "1 queued with no in-flight". The contract described in the spec is "size-1 queue + 1 in-flight" which means the cutoff should be `depth >= 3` (1 in-flight + 1 queued) or the semantics need to be re-derived.
- Impact: Only one switch can ever be queued behind one in-flight; the third concurrent request gets 409 instead of being held in the queue. If the intent was "1 queued only", we return 409 too aggressively when the spec calls for queue + in-flight.
- Suggested fix: Inspect spec carefully — given G1-22 accepted "queue + 1 in-flight" semantics, the check should likely be `depth > 2` not `depth > 2`. Or document the spec's actual queue capacity.

**Finding 3 (critical)**: Module-scoped mutable state (`pendingSwitches`, `pendingDepth`) leaks across tests / router instances
- File: `packages/api/src/admin/simulatorRouter.ts:98-99`
- Edge case: The two `Map`s are module-scoped. When `vitest` parallelizes test files that import `simulatorRouter`, OR when the api hot-reloads in development, multiple router instances share the same queues. A second test that fires a POST before the previous test's pending promise settles will see "depth > 0" from a prior test and incorrectly 409.
- Impact: Tests flake (409 returned when the spec says 200); in dev with HMR, the queue can carry over real user state across reloads.
- Suggested fix: Move the registry inside `buildAdminSimulatorRouter` as closure-scoped state, or expose a `reset()` and call it in `beforeEach`. Module scope only makes sense for a singleton process.

**Finding 4 (critical)**: `pendingDepth.set(deviceId, depth)` called on 409 path leaves stale entry
- File: `packages/api/src/admin/simulatorRouter.ts:336-342`
- Edge case: When the depth gate fires (409), the code line `pendingDepth.set(deviceId, depth + 1)` (or increment) mutates the map before returning 409, but there is no finally cleanup. Subsequent legitimate requests will see a stale depth and 409 even though no work is in-flight.
- Impact: DoS-by-self. One burst of concurrent requests poisons the depth counter for a device indefinitely (until next in-flight resets it).
- Suggested fix: Compute `depth`, check against cap, then increment — wrap in a try/finally that decrements if the cap was hit before throw.

**Finding 5 (critical)**: `packages/api/src/index.ts:1063-1094` — Prisma client dynamically imported and constructed PER-REQUEST
- File: `packages/api/src/index.ts:1063-1094`
- Edge case: `listDevicesFromPrisma` uses `await import("@prisma/client")` and `new PrismaClient()` inside the request handler. A new PrismaClient is created on every HTTP request, each opening a SQLite connection (and bypassing the singleton cached at process bootstrap).
- Impact: Connection leak: every request opens a new SQLite handle, never closes it; SQLite file lock contention under burst; eventually "too many connections" on SQLite.
- Suggested fix: Use the module-scoped singleton `prisma` (line ~1078) and hoist the import to a normal `import` at module top. Delete the dynamic-import pattern entirely.

**Finding 6 (critical)**: `listDevicesFromPrisma` swallows ALL errors (silent empty-list)
- File: `packages/api/src/index.ts:140-145` (current diff line range)
- Edge case: Catch block at top of `listDevicesFromPrisma` swallows all errors and returns `[]`. Admin tab renders "no devices" with no log, no telemetry, no metric.
- Impact: Silent failure: if the SQLite file is missing or Prisma is mis-migrated, the admin tab shows nothing and ops has no signal.
- Suggested fix: Log via the api's structured logger; emit a metric counter; or return a 503 so the SPA can render an error toast.

**Finding 7 (critical)**: `validateSimulatorBaseUrl` permits `localhost`-with-non-http scheme by accident
- File: `packages/api/src/admin/simulatorClient.ts:72-89`
- Edge case: The validator rejects schemes other than `http:`/`https:`, but allows arbitrary hostnames that aren't localhost (e.g. `http://example.com`). In dev with `SIMULATOR_URL` set to a remote endpoint this is fine, but in test environments a typo of `SIMULATOR_URL=http://example.com:4001` would target an external host.
- Impact: Dev URL misconfiguration silently targets a remote host. SSRF defense-in-depth is incomplete.
- Suggested fix: Whitelist `localhost`, `127.0.0.1`, `::1`, and explicit dev hosts; reject all other hostnames as SSRF risk.

**Finding 8 (major)**: `outboundCalls === 2` test is racy and non-deterministic
- File: `packages/api/src/admin/simulatorRouter.spec.ts:320-383`
- Edge case: Test uses `await new Promise(setTimeout, 5)` for back-to-back starts. CI contention makes this flaky.
- Impact: Flaky CI; behavior depends on event-loop scheduling.
- Suggested fix: Replace with a deterministic hook — capture `startTime` on each `outboundFetch` call and assert order.

**Finding 9 (major)**: `boot()` doesn't await async control-server start before exposing WsClients
- File: `packages/simulator/src/index.ts:298-358`
- Edge case: `boot()` registers all WsClients into `clientsRegistry` synchronously, then kicks off `startControlServer` in an async IIFE. Between the sync Map.set and the IIFE's `await listen(...)`, a request could arrive at the (not-yet-listening) control server.
- Impact: First admin POST right after simulator boot races with server listen — possible ECONNREFUSED.
- Suggested fix: Await the server listen BEFORE registering WsClients (or block registration until the port is bound).

**Finding 10 (major)**: Control server returns 200 on GET `/admin/simulator/{id}` with no action
- File: `packages/simulator/src/control/server.ts:218-220`
- Edge case: Bare-GET path returns `200 {device_id}` with no scenario/action, which can be mistaken for "current scenario". Spec does not define this endpoint; admin's GET is supposed to come from `/admin/simulator/devices` (list), not per-device GET.
- Impact: Confusing API surface — operator might curl the bare path and get `{device_id}` thinking it's the scenario.
- Suggested fix: Return 404 from the bare GET path (parseRoute currently treats this as a valid route).

**Finding 11 (major)**: `request.on("data")` chunks can split JSON mid-token → `invalid_json` is brittle
- File: `packages/simulator/src/control/server.ts:144-167`
- Edge case: When JSON arrives in two TCP chunks split inside a string literal, `JSON.parse` fails on the first chunk. The implementation throws and returns `400 invalid_json`, which is correct, but if chunks are limited at 16 KB they WILL split for a 17 KB body — so `invalid_json` would be returned for `payload_too_large` cases.
- Impact: Misclassified error: client receives `invalid_json` when the actual cause was body too large.
- Suggested fix: Accumulate ALL chunks until the limit, THEN parse; report `payload_too_large` if the accumulator exceeds the limit before parse.

**Finding 12 (major)**: HTTP header read via `req.headers["x-simulator-secret"]` is case-insensitive in Node, but the secret comparison is strict
- File: `packages/simulator/src/control/server.ts:133-138`
- Edge case: A client sending `X-SIMULATOR-SECRET: foo` will hit the lowercase-indexed lookup fine (Node lowercases headers), but the test only sends `x-simulator-secret`. Defense-in-depth: if a client sends `X-Simulator-Secret`, the server sees it, but the test only pins the lowercase path.
- Impact: Low; not a real bug. Pin the path with a test that sends mixed-case.
- Suggested fix: Add a test with mixed-case header.

**Finding 13 (major)**: `outboundFetch` may be called twice on the same request if Express re-enters
- File: `packages/api/src/admin/simulatorRouter.ts:346-380`
- Edge case: Express's request handler can fire twice in dev with HMR. The first call's promise settles, the second call's promise is a NEW outbound fetch — they don't share `pendingSwitches` because it's a NEW Map entry by name conflict.
- Impact: Simulator called twice for the same logical admin request; audit row written twice. Singleton state breaks HMR-safe guarantee.
- Suggested fix: Module-scope state mitigates this in prod but is hostile to test isolation (see Finding 3). Hoist to a per-request closure with a request-id guard, or dedupe at Express layer.

**Finding 14 (major)**: `validateScenarioRequest` strict-mode rejects unknown keys silently?
- File: `packages/api/src/admin/simulatorRouter.ts:66-78`
- Edge case: Zod `.strict()` returns a Zod error listing the offending key, but the test only checks that the first issue mentions `extra_key`. If Zod's error format changes (it has, between versions), the test passes only when the offending key is mentioned.
- Impact: Test silently weakens when Zod updates.
- Suggested fix: Pin the issue path explicitly: `expect(issues[0].path).toEqual(["extra_key"])`.

**Finding 15 (major)**: `control/server.ts` EADDRINUSE on the async listen path exits the process without closing WsClients
- File: `packages/simulator/src/control/server.ts:419-430`, `packages/simulator/src/index.ts:317-358`
- Edge case: The IIFE has `console.error(...)` on EADDRINUSE but no `process.exit(1)` — but `index.ts` does exit. The order is: control server logs error → IIFE continues → index.ts IIFE catches in top-level catch → exits → WsClients still in `clientsRegistry` AND their WebSocket connections are still open.
- Impact: On simulator restart with port still bound, exited process has zombie WebSocket connections in the api's `pendingSwitches` map (orphaned). Subsequent admin POSTs targeting this device 404 / 502 forever.
- Suggested fix: In `index.ts`'s catch, await `clients.map(c => c.stop())` BEFORE process.exit.

**Finding 16 (major)**: `WsClient.setScenario` reads `paused` from current state but writes the new state without verifying `pausePending`
- File: `packages/simulator/src/wsClient.ts:233-260`
- Edge case: A switch arriving while `paused: true` and `tickInterval` is paused — does `setScenario` actually wait for a tick to render a frame? Spec says scenario switch must apply within 5 s; if the device is paused, ticks don't run and the 5 s SLA is violated.
- Impact: Admin pauses a device, switches scenario, sees nothing happen in the timeline.
- Suggested fix: When `paused === true`, calling `setScenario` should immediately unpause (or document that "scenario switches on a paused device require an unpause to render").

**Finding 17 (major)**: `WsClient.__test__runTick` is public (underscore-prefixed) but called in production code paths in `boot()`
- File: `packages/simulator/src/wsClient.ts`, `packages/simulator/src/index.ts:298-315`
- Edge case: A future cleanup that renames / deprecates `__test__runTick` would break `boot()`. The "test seam" name suggests test-only, but production uses it.
- Impact: Refactor risk.
- Suggested fix: Rename to `runOneTick` (drop the `__test__` prefix) since it's used in production `boot()`.

**Finding 18 (major)**: `device_id` regex is per-package, duplicated between api and simulator
- File: `packages/api/src/admin/simulatorRouter.ts:193-200`, `packages/simulator/src/control/server.ts:230-238` (approximate)
- Edge case: Two regexes, two test suites. Drift is possible: if one tightens to UUIDv4-only, the other might still accept v1.
- Impact: Asymmetric rejection — invalid_device_id on api side, unknown_device on simulator side for the same input.
- Suggested fix: Move the regex to `@surakkha/shared/simulator` as `DEVICE_ID_PATTERN`.

**Finding 19 (major)**: Audit row written on 502/400 in the api side, but spec says "no write on validation_error"
- File: `packages/api/src/admin/simulatorRouter.ts:204-275`
- Edge case: `validateScenarioRequest` returns 400 — but the audit row check is downstream of the return. Verify no audit row is written on the 400 path.
- Impact: Test gap, not necessarily a bug.
- Suggested fix: Add a `findMany` count assertion in the 400 test (no `simulator_event` rows).

**Finding 20 (major)**: `setPaused` doesn't track `paused` in audit context for resume
- File: `packages/api/src/admin/simulatorRouter.ts:398-401`
- Edge case: Spec AC pins payload shape `{ device_id, scenario }` only. Pause/resume audit row has only `device_id, scenario` — but paused is not in the context. The simulator's server.ts:238-256 context includes `paused`. The api's audit row shape DOES NOT include `paused`.
- Impact: Operator cannot tell from the audit log whether the device was paused.
- Suggested fix: Add `paused` to the audit context when present.

**Finding 21 (major)**: `boot()` registers `setClientsRegistry` once, but `startControlServer` IIFE may overwrite it
- File: `packages/simulator/src/index.ts:298-358`
- Edge case: IIFE reassigns `closeControlServer` and may have race with the registry, but the registry is module-scoped.
- Impact: Minor; tests fix this by injecting registry before IIFE.
- Suggested fix: Make the registry assignment idempotent (`if (registry === null) registry = ...`).

**Finding 22 (minor)**: `outbound.fetch.timeout = 5000` race with `controller.abort()` already-fired
- File: `packages/api/src/admin/simulatorClient.ts:113-160`
- Edge case: If `controller.abort()` is called externally before the timer fires, the timer still runs and calls abort again. AbortController tolerates double-abort; not a bug.
- Impact: None.
- Suggested fix: Use `clearTimeout` in a finally.

**Finding 23 (minor)**: Audit row write is fire-and-forget; crashes are swallowed
- File: `packages/api/src/admin/simulatorRouter.ts:420-440`
- Edge case: `audit.emit({...})` is called but its return is not awaited / caught. A DB error during audit emit doesn't surface to the user.
- Impact: Silent corruption of audit log.
- Suggested fix: Await the emit; on rejection, log it; do not affect the user response.

**Finding 24 (minor)**: Test does not assert that `__test__paused` is reflected in the audit row
- File: `packages/api/src/admin/simulatorRouter.spec.ts`
- Edge case: The audit row's payload includes only `{device_id, scenario}` per spec, but `paused` is not asserted.
- Impact: Test doesn't pin this aspect of the contract.
- Suggested fix: Add an assertion that audit row context does NOT contain `paused` for the scenario path.

**Finding 25 (minor)**: `client/__test__deviceId` used in test setup but unstable across refactors
- File: `packages/simulator/src/wsClient.ts:201`
- Edge case: Test seam name `__test__*` suggests test-only.
- Impact: Refactor risk (same as Finding 17).
- Suggested fix: Rename to a stable production name.

**Finding 26 (minor)**: Module-scoped `pendingSwitches` survives express middleware reload
- File: `packages/api/src/admin/simulatorRouter.ts:98-99`
- Edge case: In dev with HMR, the module reloads but the Map persists in module scope. Two router instances share the same Map.
- Impact: Dev-only oddity.
- Suggested fix: Closure-scoped per `buildAdminSimulatorRouter()` invocation.

**Finding 27 (minor)**: `listDevices` order is non-deterministic; admin tab sorts by `device_id`
- File: `packages/api/src/index.ts` (the slice)
- Edge case: `findMany()` without `orderBy` returns insertion order or DB-dependent order. Admin tab needs stable sort.
- Impact: Visual jitter on reload (devices appear in different order each refresh).
- Suggested fix: Add `orderBy: { id: 'asc' }`.

**Finding 28 (minor)**: `clientsRegistry.set(deviceId, client)` overwrites without warning if duplicate
- File: `packages/simulator/src/control/server.ts:78-87`
- Edge case: Two clients with the same `device_id` overwrite each other in the registry. Last writer wins.
- Impact: Loss of connection for one device silently.
- Suggested fix: Throw on duplicate device_id at boot (devices.json is the SoT; duplicates should be a config error).

**Finding 29 (minor)**: Empty `state` body when both `scenario` and `paused` undefined
- File: `packages/api/src/admin/simulatorRouter.ts:204-223`
- Edge case: Validation rejects when both are missing — but if the request is `{}` the test does NOT pin the exact error code.
- Impact: If Zod's "required_key" message changes, the test still passes.
- Suggested fix: Pin `expect(error).toBe("missing_action")` not just the issues.

**Finding 30 (minor)**: `WsClient.__test__runTick` mutates `lastFrame` but no consumer is checked
- File: `packages/simulator/src/wsClient.ts`
- Edge case: `__test__runTick()` writes a frame, but tests don't always assert on it (some only assert scenario).
- Impact: Test gap; not a bug.
- Suggested fix: Tests that swap scenario should verify the next-tick frame.

**Finding 31 (minor)**: `control/server.ts` — `X-Simulator-Secret` matched via index access; `req.headers` has typed `string | string[]`
- File: `packages/simulator/src/control/server.ts:130-140`
- Edge case: Multi-value header supported via array. But a header value containing only commas would still be one string.
- Impact: None; HTTP headers don't have comma-only values.
- Suggested fix: Already correctly handled.

**Finding 32 (minor)**: SIMULATOR_URL with trailing slash is silently accepted (or not?)
- File: `packages/api/src/admin/simulatorClient.ts:72-89`
- Edge case: `http://localhost:4001/` vs `http://localhost:4001` — do they end up at the same path? The URL builder uses `new URL(path, base)`.
- Impact: Low.
- Suggested fix: Test with both forms.

**Finding 33 (minor)**: `validateSimulatorBaseUrl` rejects relative URLs but doesn't reject empty host
- File: `packages/api/src/admin/simulatorClient.ts:72-89`
- Edge case: An empty-host URL like `http://` would fail URL parsing differently from a well-formed one.
- Impact: Low.
- Suggested fix: Add explicit empty-host check.

**Finding 34 (minor)**: Audit event shape: `actor_user_id` is `null` for service-to-service paths
- File: `packages/api/src/admin/simulatorRouter.ts:380-400`
- Edge case: Audit row's `actor_user_id` — for admin's POST, it's the admin's userId; for a simulator-side internal trigger, it's `null`. Spec doesn't mandate.
- Impact: Low.
- Suggested fix: Document the source of actor for each row.

**Finding 35 (minor)**: Test uses raw `req.body` mocking for one path, real Express body-parser for another
- File: `packages/api/src/admin/simulatorRouter.spec.ts`
- Edge case: Inconsistent test infrastructure — some tests mock `req.body` (bypassing the parser), others let Express parse JSON.
- Impact: Test infrastructure fragility.
- Suggested fix: Use Express + supertest consistently.

**Finding 36 (nit)**: `pendingSwitches.set(deviceId, pendingSwitches.get(deviceId) ?? Promise.resolve())` can be simplified
- File: `packages/api/src/admin/simulatorRouter.ts`
- Edge case: Code review only.
- Impact: Style.
- Suggested fix: Simpler `?? Promise.resolve()` or `.get(deviceId) ?? new Deferred()`.

**Finding 37 (nit)**: `__test__deviceId` underscore prefix is conventional but not enforced
- File: `packages/simulator/src/wsClient.ts`
- Edge case: Style.
- Impact: None.
- Suggested fix: Add JSDoc warning.

**Finding 38 (nit)**: `console.warn` for simulator boot warnings is fine, but ESLint may flag
- File: `packages/simulator/src/index.ts`
- Edge case: `no-console` ESLint rule.
- Impact: Lint warning.
- Suggested fix: Use the project's logger.

**Finding 39 (nit)**: `JSON.stringify(body)` in `outboundFetch` may pass `undefined` values through
- File: `packages/api/src/admin/simulatorClient.ts:113-160`
- Edge case: `{paused: true}` with `scenario: undefined` becomes `{"paused":true}` — fine.
- Impact: None.
- Suggested fix: Strip undefined fields explicitly.

**Finding 40 (nit)**: Missing `Cache-Control: no-store` on admin endpoints
- File: `packages/api/src/admin/simulatorRouter.ts`
- Edge case: Browser caches admin POST responses by default? Browsers cache GETs, not POSTs — no real issue.
- Impact: None.
- Suggested fix: None.

**Finding 41 (nit)**: `name` field in seeded Device rows has no max length validator (DB accepts arbitrary string)
- File: `packages/db/prisma/schema.prisma`
- Edge case: Operator with admin tab editing capability could enter 1 MB string.
- Impact: Low; deferred to Epic 7 (G1-19 deferred).
- Suggested fix: Add `@db.VarChar(64)` constraint.

**Finding 42 (nit)**: `JSON.parse(body)` without `try/catch` would throw uncaught
- File: `packages/api/src/admin/simulatorClient.ts`
- Edge case: Parser error path is already handled.
- Impact: None.
- Suggested fix: Defensive try/catch around the entire call.
