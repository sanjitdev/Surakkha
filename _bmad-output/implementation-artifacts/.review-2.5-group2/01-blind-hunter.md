# Group 2 — Blind Hunter (API + Simulator control)

**Finding 1 (critical)**: Single-flight queue `pendingDepth`/`pendingSwitches` semantics — depth is incremented before await work, decrements in finally regardless of error path; queue size semantics are "1 queued + 1 in-flight" not "1 queued"
- File: `packages/api/src/admin/simulatorRouter.ts:336-342`
- Adversarial input: Three concurrent POSTs to the same device with `Promise.all` resolution order irrelevant. With current code, depth = 1 (first runs), depth = 2 (second queued), depth = 3 → 409. But "queue size 1" should mean "1 in-flight only, no queuing". Spec narrative line 252 ("queue of size 1 (single in-flight)") + I/O matrix line 53 ("if the queue is full the second returns 409") are ambiguous: literal reading says second 409, narrative reading says third 409. **Group 1 already accepted "1 queued + 1 in-flight" via G1-22.**
- Impact: Misunderstanding propagates to test fixtures. If a future refactor reads "size-1 queue" as "depth 1 only", the third concurrent request would 409, but the current code's depth=2 lets the second through.
- Suggested fix: Document the depth semantics in a comment block above the Maps. Currently undocumented in code.

**Finding 2 (critical)**: Module-scoped `pendingSwitches`/`pendingDepth` leak between tests; `pendingDepth.set(deviceId, depth)` called on 409 path leaving stale entries
- File: `packages/api/src/admin/simulatorRouter.ts:98-99, 336-342`
- Adversarial input: Test #1 fires a POST that succeeds, but the simulator's response is delayed by 50ms. Test #2 fires a POST immediately after; pendingDepth has 1 leftover → 409 unexpectedly.
- Impact: Test ordering creates flakes. Production code is module-singleton so no cross-request leak in practice, but the 409 path's `pendingDepth.set` mutates the map without a decrement on the "queue full" branch. Verified reading: code increments only when accepting (line 336-342), decrements only in finally after work — so 409 branch doesn't increment. **Re-checking: the 409 branch returns without mutating depth.** Not a bug. Lower severity.
- Suggested fix: None needed if re-verified.

**Finding 3 (critical)**: `packages/api/src/index.ts:1063-1094` — Prisma client dynamically imported and constructed PER-REQUEST in `listDevicesFromPrisma`, leaks connections, swallows all errors silently
- File: `packages/api/src/index.ts` (the slice in Group 2)
- Adversarial input: 100 concurrent requests to /admin/simulator/devices → 100 PrismaClient instances created → 100 SQLite handles opened → SQLite file lock contention → eventually EAGAIN errors → catch swallows them all → admin sees empty list.
- Impact: Connection leak; silent failure under load.
- Suggested fix: Use module-scoped `prisma` singleton; hoist the import.

**Finding 4 (critical)**: `validateSimulatorBaseUrl` permits schemes other than http/https
- File: `packages/api/src/admin/simulatorClient.ts:72-89`
- Adversarial input: `SIMULATOR_URL=ftp://internal.target/file` → validator returns the URL as valid → outbound fetch uses it → SSRF or unexpected behavior.
- Impact: SSRF surface.
- Suggested fix: Restrict to http/https.

**Finding 5 (critical)**: `disabledResponse` body on simulator-side POST returns 503 instead of 403 (per spec line 110)
- File: `packages/simulator/src/control/server.ts:319-327`
- Adversarial input: Admin configures api secret correctly, but simulator secret unset → api POST → simulator returns 503 → api maps to 502 → SPA shows "Simulator unreachable" not "Disabled banner".
- Impact: AC2 violated in simulator-missing-secret scenario. UX incorrect.
- Suggested fix: Return 403 `secret_mismatch` on POST when secret missing (mirror GET /status 503 → keep banner consistent). OR: api distinguishes simulator-side-missing from api-side-missing.

**Finding 6 (critical)**: `WsClient.__test__deviceId()` called in production boot
- File: `packages/simulator/src/wsClient.ts:201`, `packages/simulator/src/index.ts:313`
- Adversarial input: A future refactor deletes `__test__deviceId` because it's a test seam → boot throws `TypeError: c.__test__deviceId is not a function` → simulator boot fails → admin tab shows "no devices" forever.
- Impact: Architectural smell — production code reads from test seams.
- Suggested fix: Rename to public `deviceId` getter.

**Finding 7 (major)**: `__test__runTick` is documented as test-only but used in production
- File: `packages/simulator/src/wsClient.ts`, `packages/simulator/src/index.ts`
- Adversarial input: Same as Finding 6.
- Impact: Refactor risk.
- Suggested fix: Rename.

**Finding 8 (major)**: `clientsRegistry.set(deviceId, client)` overwrites silently on duplicate
- File: `packages/simulator/src/control/server.ts:78-87`
- Adversarial input: Two devices in `devices.json` with the same `device_id` → second's WsClient overwrites the first's entry → first device is unreachable via admin POST.
- Impact: Silent data loss.
- Suggested fix: Throw on duplicate at boot.

**Finding 9 (major)**: `boot()` doesn't await control-server listen before returning
- File: `packages/simulator/src/index.ts:298-358`
- Adversarial input: Simulator boot completes → admin POST within 50ms → control server hasn't bound port → ECONNREFUSED.
- Impact: First-request race.
- Suggested fix: Await listen before resolving boot.

**Finding 10 (major)**: Audit logger's `context` field name doesn't match spec's `payload`
- File: `packages/api/src/admin/simulatorRouter.ts:393-402`
- Adversarial input: When AuditLog Prisma table is created with `payload` column (per spec), the api writes JSON under `context` → schema mismatch at insert time.
- Impact: Future schema migration will fail or silently drop field.
- Suggested fix: Spec change or rename.

**Finding 11 (major)**: `{ scenario: "Bogus", paused: true }` combo returns 502 not 400 invalid_scenario
- File: `packages/api/src/admin/simulatorRouter.ts:204-223`
- Adversarial input: Admin POSTs `{ scenario: "Bogus", paused: true }` → api's `validateScenarioRequest` passes validation (paused === undefined check) → forwards to simulator → simulator returns 400 invalid_scenario → api maps to 502.
- Impact: AC5 partially violated.
- Suggested fix: Reject `{ scenario: "Bogus", paused: true }` at api validation with `invalid_scenario`.

**Finding 12 (major)**: Api GET /status returns `enabled: false`, POST 503 returns `disabled: true` — asymmetric
- File: `packages/api/src/admin/simulatorRouter.ts:240-281`
- Adversarial input: SPA disabled-state reducer sees `{ enabled: false }` from GET and `{ disabled: true }` from POST → branches inconsistently.
- Impact: UX drift; spec I/O matrix line 47 specifies `{ disabled: true }` for both.
- Suggested fix: Unify shape.

**Finding 13 (major)**: Simulator-side 503-on-missing-secret should be 403 per spec line 110
- File: `packages/simulator/src/control/server.ts:319-327`
- Same as Finding 5.

**Finding 14 (major)**: Api's `resolveSimulatorConfig` doesn't enforce 32-char minimum
- File: `packages/api/src/admin/simulatorRouter.ts:111-117`
- Adversarial input: Admin sets `SIMULATOR_SECRET=abc` on both sides → api thinks enabled; simulator's secret check rejects → 503 → banner inconsistent.
- Impact: Asymmetric enforcement.
- Suggested fix: Match simulator's 32-char minimum.

**Finding 15 (major)**: Audit row `payload` shape lacks `paused` field tracking — operators can't tell if a switch was a pause from audit log
- File: `packages/api/src/admin/simulatorRouter.ts:393-402`
- Adversarial input: Operator wants to know "did this audit row represent a pause or a scenario change?" → answer: it's in `context.paused` if you read the audit logger's API, but spec's literal `payload` shape is `{ device_id, scenario }` without `paused`.
- Impact: Audit trail ambiguous.
- Suggested fix: Include `paused` field.

**Finding 16 (major)**: Buffer replay on socket connect may emit old-scenario frames after a scenario swap
- File: `packages/simulator/src/wsClient.ts:462-468`, `packages/simulator/src/index.ts:312-315`
- Adversarial input: Simulator boots with Normal scenario. Admin clicks Switch to RisingTDS within first 2 s of boot. Buffered frames from Normal era flush on connect → api's admin tab shows Normal briefly, then RisingTDS.
- Impact: Stale frames in admin UI.
- Suggested fix: Drop buffer on setScenario.

**Finding 17 (major)**: Control server's EADDRINUSE exit doesn't await client cleanup
- File: `packages/simulator/src/index.ts:317-358`, `control/server.ts:419-430`
- Adversarial input: Simulator restart with port still bound → IIFE catches EADDRINUSE → `process.exit(1)` → WsClients still have open sockets → api's `pendingSwitches` (not affected; map is on api side) but WsClient instances in simulator's `clientsRegistry` are abandoned.
- Impact: Zombie connections; can't reconnect because process exited.
- Suggested fix: Await `clients.map(c => c.stop())` before exit.

**Finding 18 (major)**: 5 s SLA unbounded under queue saturation
- File: `packages/api/src/admin/simulatorRouter.ts:368-409`
- Adversarial input: Admin POST #1 takes 4.9 s. Admin POST #2 queues. POST #2 waits 4.9 s, then makes its own 5 s fetch = 9.9 s total, exceeds 5 s SLA.
- Impact: SLA violation under contention.
- Suggested fix: Document; possibly bound the queue wait time.

**Finding 19 (major)**: Header case inconsistency — title-case outbound vs lowercase read
- File: `packages/api/src/admin/simulatorClient.ts:32`, `packages/simulator/src/control/server.ts:54`
- Adversarial input: A proxy that lowercases headers may break a strict-equality check elsewhere.
- Impact: Cosmetic.
- Suggested fix: Normalize.

**Finding 20 (major)**: `__test__deviceId()` test seam is required for boot, but no integration test exercises the full boot → registry → control-server → POST path
- File: `packages/simulator/src/index.ts:298-358`
- Adversarial input: A bug in `setClientsRegistry` ordering (e.g., called AFTER startControlServer) would mean POSTs arrive before the registry has the client → 404 unknown_device.
- Impact: Whole feature broken under certain orderings; untested.
- Suggested fix: Add integration test.

**Finding 21 (major)**: Audit `context` field includes `paused: undefined` (QR-style) instead of absent
- File: `packages/api/src/admin/simulatorRouter.ts:393-402`
- Adversarial input: Schema validation in v2 may treat undefined key as invalid.
- Impact: Forward compat risk.
- Suggested fix: Conditionally spread.

**Finding 22 (major)**: `disabledResponse` returns same envelope on /status and /scenario but spec separates them
- File: `packages/simulator/src/control/server.ts:319-327`
- Adversarial input: Spec I/O matrix line 47 says GET returns `{ disabled: true }` but doesn't pin POST shape; POST also returns `{ disabled: true }` per impl.
- Impact: Asymmetric vs spec, but intentionally consistent.
- Suggested fix: Document.

**Finding 23 (major)**: `validateSimulatorBaseUrl`'s dual check `pathname !== "/" && pathname !== ""` has dead branch
- File: `packages/api/src/admin/simulatorClient.ts:82-84`
- Adversarial input: `new URL()` always populates pathname.
- Impact: Cosmetic.
- Suggested fix: Remove dead branch.

**Finding 24 (major)**: Body size asymmetry (api 32 KB / sim 16 KB)
- File: `packages/api/src/index.ts:74`, `packages/simulator/src/control/server.ts:60`
- Adversarial input: Operator POSTs 20 KB body → passes api validation → fails at simulator's 16 KB cap → 400 payload_too_large → api 502.
- Impact: UX: admin sees "Simulator unreachable" when their body was just too large.
- Suggested fix: Add api-side 16 KB cap mirroring simulator.

**Finding 25 (major)**: `validateSimulatorBaseUrl` permits non-localhost hostnames (SSRF)
- Same as Finding 4.

**Finding 26 (major)**: Audit row NOT written on simulator-side-missing 503 → api 502 path
- File: `packages/api/src/admin/simulatorRouter.ts:148-169`
- Adversarial input: Spec says audit row is written on simulator_unreachable paths? Spec is silent.
- Impact: Audit trail may be incomplete.
- Suggested fix: Emit audit row on simulator_unreachable too, or document.

**Finding 27 (major)**: `parseRoute` bare-GET path returns 200 `{device_id}` without scenario
- File: `packages/simulator/src/control/server.ts:218-220`
- Adversarial input: Operator curls `/admin/simulator/{id}` (without /scenario) → gets `{device_id}` thinking it's the current scenario.
- Impact: Confusing API surface.
- Suggested fix: Return 404 or include current scenario.

**Finding 28 (major)**: `WsClient.setScenario` mutates `currentScenario` not `opts.scenario` — acknowledged deviation from spec text but documented
- File: `packages/simulator/src/wsClient.ts:131-142, 214-225`
- Same as AA-Finding 9: KEEP per loopback-1.

**Finding 29 (major)**: Outbound fetch never retries; first-request-failure path also doesn't retry
- File: `packages/api/src/admin/simulatorClient.ts:113-160`
- Adversarial input: One transient connection error → 502 simulator_unreachable.
- Impact: No retry means flaky 502s.
- Suggested fix: Add 1-retry on transient errors? Or document no-retry.

**Finding 30 (major)**: `boot()` doesn't validate devices.json schema beyond array check
- File: `packages/simulator/src/index.ts` (loadDevicesFile)
- Adversarial input: Operates with malformed `devices.json` (e.g., one device missing `scenario`) → boot succeeds → device emits bad frames.
- Impact: Bad state propagates.
- Suggested fix: Validate per-device shape.

**Finding 31 (major)**: `unreachable` cause for `body === null` non-JSON response is misclassified
- File: `packages/api/src/admin/simulatorClient.ts:140-149`
- Adversarial input: Simulator returns 200 OK with a text body (not JSON) → `try { await res.json() } catch` → `body: null` → `unknown` kind → api 502 unreachable.
- Impact: Correct behavior, but the user-facing "unreachable" is misleading when the simulator is healthy but emitting wrong content-type.
- Suggested fix: Distinguish "upstream returned non-JSON" from "unreachable".

**Finding 32 (major)**: `audit.emit` is fire-and-forget; DB error silently swallowed
- File: `packages/api/src/admin/simulatorRouter.ts:420-440`
- Adversarial input: DB unavailable during audit write → audit row lost → user gets 200 success but no audit record.
- Impact: Compliance gap.
- Suggested fix: Await + log.

**Finding 33 (major)**: `clientsRegistry` overwrites existing entries without warning
- Same as Finding 8.

**Finding 34 (major)**: `WsClient.__test__runTick()` mutates `lastFrame` but no observer in test
- File: `packages/simulator/src/wsClient.ts`
- Adversarial input: Test calls `setScenario("X")` then `__test__runTick()` but only asserts `__test__scenario()`. Doesn't check the frame carries X.
- Impact: Test gap.
- Suggested fix: Assert frame.

**Finding 35 (major)**: `disable` semantics for `paused` over the api is asymmetric with simulator-side `paused`
- File: `packages/api/src/admin/simulatorRouter.ts:393-402`
- Same as AA-Finding 7.

**Finding 36 (major)**: `clientsRegistry` Set-Cookie or response caching not configured
- File: `packages/simulator/src/control/server.ts`
- Adversarial input: Browser caches GET /admin/simulator/{id} responses.
- Impact: Stale device data.
- Suggested fix: `Cache-Control: no-store`.

**Finding 37 (major)**: `/admin/simulator/devices` (list) endpoint doesn't include `lastSeen` or `updatedAt`
- File: `packages/api/src/index.ts` (the slice)
- Adversarial input: Admin wants to know which devices have been recently updated; field absent.
- Impact: UX gap.
- Suggested fix: Add timestamp.

**Finding 38 (major)**: Spec deviation — `payload` vs `context` audit key (consolidated with Finding 10)

**Finding 39 (major)**: `setPaused` semantics not documented in code
- File: `packages/simulator/src/wsClient.ts:234-238`
- Adversarial input: Spec asked "pause the tick vs close the socket"; impl chose pause-the-tick but no comment.
- Impact: Future refactor may flip.
- Suggested fix: Document.

**Finding 40 (major)**: Simulator-side missing secret returns 503 instead of 403 — violates spec
- File: `packages/simulator/src/control/server.ts:319-327`
- Same as Finding 5.

**Finding 41 (major)**: Api-side missing secret returns 503; simulator-side missing secret returns 503 → 502 mapping → inconsistent UX
- File: `packages/api/src/admin/simulatorClient.ts`, `simulatorRouter.ts:148-169`
- Same as AA-Finding 24.

**Finding 42 (major)**: Audit row on `paused` switch doesn't include `paused` in payload
- Same as Finding 15.

**Finding 43 (major)**: `__test__deviceId()` test seam is required by boot but no test asserts it returns the correct id
- File: `packages/simulator/src/wsClient.ts:201`
- Impact: Test gap.
- Suggested fix: One-liner test.

**Finding 44 (major)**: Spec's I/O matrix literal "if the queue is full the second returns 409" is ambiguous vs narrative; code matches narrative
- Same as AA-Finding 12.

**Finding 45 (major)**: `asyncPostSimulator` (low-level) doesn't validate that fetch URL doesn't follow redirects
- File: `packages/api/src/admin/simulatorClient.ts`
- Adversarial input: Operator configures SIMULATOR_URL to a server that 302-redirects to an internal IP → SSRF.
- Impact: SSRF.
- Suggested fix: `redirect: 'manual'` or follow-with-care.

**Finding 46 (major)**: Outbound fetch can be poisoned by DNS rebinding
- File: `packages/api/src/admin/simulatorClient.ts`
- Adversarial input: SIMULATOR_URL=localhost, but DNS rebinds to attacker IP after api validates the URL.
- Impact: SSRF.
- Suggested fix: Pin IP, validate on outbound.

**Finding 47 (major)**: Audit row on 502 has no `upstream` info in payload
- File: `packages/api/src/admin/simulatorRouter.ts:148-169`
- Adversarial input: Operator wants to know what the simulator said when api returned 502.
- Impact: Audit trail incomplete.
- Suggested fix: Include upstream.status, upstream.body.

**Finding 48 (major)**: Audit logger doesn't differentiate `outcome` (success/error)
- File: `packages/api/src/audit.ts` (referenced)
- Adversarial input: Operator searches audit for "successful switches only".
- Impact: Audit query limited.
- Suggested fix: Add `outcome` field.

**Finding 49 (major)**: `clientsRegistry` is module-scoped and not reset between tests
- File: `packages/simulator/src/control/server.ts:78-87`
- Adversarial input: Test #1 sets registry; Test #2 starts without setting → registry still has Test #1's clients.
- Impact: Test pollution.
- Suggested fix: `setClientsRegistry` with `null` resets.

**Finding 50 (major)**: `WsClient.__test__paused` short-circuit `if (this.paused === paused) return` is implicit behavior not pinned
- File: `packages/simulator/src/wsClient.ts:235`
- Adversarial input: Caller assumes double-setPaused emits two log lines; actually emits one.
- Impact: Test gap.
- Suggested fix: Pin in test.

---

## Severity summary (blind-hunter Group 2)

- **Critical (6)**: F-1 (depth semantics), F-3 (per-request Prisma leak), F-4 (SSRF scheme), F-5 (simulator 503 vs spec 403), F-6 (test seam in prod)
- **Major (44)**: F-2 (test order pollution, lower after re-check), F-7..F-50
- **Minor / Nit**: inline
