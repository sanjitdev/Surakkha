# Group 2 Triage — Story 2.5 Admin Tab (API + Simulator control)

**Sources**: blind-hunter (50), edge-case-hunter (42), verification-gap (50), acceptance-auditor (25).
**Pre-existing from Group 1**: G1-02 (api devices body-shape assertion), G1-19 (legacy null handling).

## Patch list (apply)

### Critical (must fix)

- **G2-01 (was: AA-F1, AA-F24, BH-F5/F13/F41, EC-F12)** — Simulator-side POST missing-secret returns 503, but spec line 110 mandates 403 and line 47 mandates `{ disabled: true }` body. Wire contract drift. Currently the api upcasts simulator-503 → 502 → SPA shows "Simulator unreachable" instead of the disabled banner.
  - **Patch**: `packages/simulator/src/control/server.ts:319-327` — change `disabledResponse` HTTP status from 503 to **403** with body `{ disabled: true, reason: "missing" }`. This restores AC2's "same banner regardless of which side is unset" intent.
  - **Caveat**: changes simulator's wire contract from 503 → 403 for missing-secret. The api already maps 403 → `secret_mismatch` kind → 403 SPA. We must update `simulatorClient.ts` to forward the 403 body as `{ disabled: true, reason }` rather than a generic `secret_mismatch` (because the SPA collapses both to the disabled banner).
  - **Test surface**: existing `server.spec.ts:132-146` ("503 disabled when SIMULATOR_SECRET is unset") must flip to expect 403 with the new body. Add a parallel test for short-secret.

- **G2-02 (was: BH-F3, EC-F15, EC-F16)** — `packages/api/src/index.ts:1063-1094` constructs `new PrismaClient()` per-request inside `listDevicesFromPrisma`, leaks connections under burst, swallows all errors. Critical for production.
  - **Patch**: hoist `import { PrismaClient } from "@prisma/client"` to module top; instantiate `const prisma = new PrismaClient()` once at module load; replace `client.device.findMany(...)` in the handler with `prisma.device.findMany(...)`. Replace the bare `catch {}` with `logger.error(err, "listDevices: prisma error")` and return `[]` (preserving current contract) but at least logging the failure.

- **G2-03 (was: AA-F19, BH-F14)** — Api-side `resolveSimulatorConfig` only checks `secret !== undefined && secret !== ""`; does NOT enforce 32-char minimum that the simulator enforces. Asymmetric enforcement violates spec line 26 ("Missing/short on either side").
  - **Patch**: `packages/api/src/admin/simulatorRouter.ts:111-117` — accept the same min-32 rule. Move the `SIMULATOR_SECRET` length check into a shared helper in `simulatorClient.ts` (or a tiny new helper module) so both sides call the same logic. Api returns `{ enabled: false, reason: "missing" }` on the public GET and `{ disabled: true, reason: "missing" }` on the private POST when below 32.

- **G2-04 (was: BH-F1, EC-F2)** — Single-flight queue depth semantics undocumented in code; module-scoped `pendingSwitches`/`pendingDepth` Maps are read+write with no in-line comment that disambiguates "depth 1 = first in-flight, depth 2 = second queued, depth > 2 = 409".
  - **Patch**: `packages/api/src/admin/simulatorRouter.ts:672-690` — extend the comment block above the Maps to explicitly state the invariant ("depth=1 first in-flight, depth=2 second queued, depth≥3 returns 409"). Lower-severity than first read because group-1 already accepted the semantics, but the invariant should be in code.

- **G2-05 (was: BH-F6, AA-F18, EC-F17)** — Production `boot()` calls `c.__test__deviceId()` (a "test seam" by name) to populate the registry. Same with `__test__runTick` referenced in index.ts (actually no, only `__test__deviceId`). Refactor risk.
  - **Patch**: rename `__test__deviceId` → `deviceId` getter on `WsClient` (drop the `__test__` prefix since production reads it). Update `packages/simulator/src/index.ts:312-315` and any other production callers. Keep `__test__` prefix for true test-only seams (`__test__scenario`, `__test__paused`, `__test__runTick`, `__test__setSocket`).

### Major (should fix)

- **G2-06 (was: VG-F1, EC-F1/F20/F50, BH-F20)** — No integration test that wires a real `WsClient` to the real control server via `setClientsRegistry` and POSTs. The two specs are unit-only.
  - **Patch**: add an integration spec in `packages/simulator/src/__tests__/control-integration.spec.ts` (or extend `server.spec.ts`) that: builds a real `WsClient` (no stubs), calls `setClientsRegistry(new Map([[id, real]]))`, starts a control server, POSTs, asserts `real.__test__scenario()` changed.
  - **Test for `__test__deviceId`**: also add a one-liner test asserting the renamed `deviceId` getter returns the constructor's deviceId.

- **G2-07 (was: VG-F3, AA-F11/A8-F3, EC-F23)** — `packages/api/src/admin/simulatorClient.ts` has zero unit tests. 503 timeout path, `validateSimulatorBaseUrl` URL guard, `unknown` mapping, non-JSON body handling all untested.
  - **Patch**: create `packages/api/src/admin/simulatorClient.spec.ts` with:
    1. `validateSimulatorBaseUrl` rejects `ftp://`, paths beyond `/`, malformed strings; accepts `http://localhost:4001` and `http://h:4001/`.
    2. `postSimulatorScenario` 5 s timeout via `vi.useFakeTimers()` returns `{ kind: "unreachable", cause: "timeout" }`.
    3. Non-200 non-403 returns `unknown` with status+body.
    4. Malformed JSON body returns `unknown` with `body: null`.

- **G2-08 (was: AA-F11 — *separate* finding from F1)** — Api GET `/status` returns `{enabled: false}` while api POST 503 and simulator GET 503 (post-G2-01 fix: simulator POST 403) return `{disabled: true}`. Asymmetric disabled-state shape across endpoints.
  - **Patch decision**: align **both api GET and POST** to use `{disabled: true, reason: "missing"}`. This matches the spec I/O matrix literal (line 47). Update `packages/api/src/admin/simulatorRouter.ts:828-836` (public GET) and `:862-870` (private GET) to emit `{ disabled: true, reason: "missing" }` instead of `{ enabled: false, reason: "missing" }`.
  - **Test surface**: `simulatorRouter.spec.ts` lines 124-128 currently assert `body.enabled === false`. Flip to `body.disabled === true`.

- **G2-09 (was: AA-F8, VG-F5)** — `{ scenario: "Bogus", paused: true }` combo: api validation passes (paused is present, scenario is a string), forwards `{scenario: "Bogus", paused: true}` to simulator, simulator returns 400 invalid_scenario, api maps to 502 `simulator_unreachable`. Spec AC5 promises 400 invalid_scenario for unknown names.
  - **Patch**: `packages/api/src/admin/simulatorRouter.ts:803-811` — change the conditional so that ANY unknown scenario name (regardless of `paused`) returns 400 invalid_scenario. New condition: `if (body.scenario !== undefined && !SCENARIO_SET.has(body.scenario as ScenarioName))`. Drop the `body.paused === undefined` part. Add a test for the combo case.

- **G2-10 (was: AA-F2, BH-F10)** — Audit logger emits `context:` but spec says `payload:`. Cross-cutting concern.
  - **Patch decision**: defer to a follow-up; renaming `context` → `payload` in `AuditLogger` would touch Story 1.5 (auth + RBAC). Add a deferred-work note. The current `context` field is consistent with the existing audit logger contract from Story 1.5; spec text "payload" is a documentation drift.
  - **Defer to deferred-work.md as F-2.5-9**.

- **G2-11 (was: AA-F7, EC-F20, BH-F15/F35/F42)** — Audit row `context` always includes `paused: undefined` for scenario-only requests; spec payload shape `{ device_id, scenario }` excludes it.
  - **Patch**: `packages/api/src/admin/simulatorRouter.ts:985-989` — conditionally include `paused` only when defined:
    ```ts
    context: {
      device_id: deviceId,
      ...(body.scenario !== undefined ? { scenario: body.scenario } : {}),
      ...(body.paused !== undefined ? { paused: body.paused } : {}),
    }
    ```

- **G2-12 (was: VG-F4, EC-F4)** — `paused` request through api router has no audit assertion. Spec AC mentions scenario+device only; we'll fix in G2-11.
  - **Patch**: see G2-11 test additions: post `{ paused: true }` and assert the audit row's `context` keys are exactly `device_id, paused` (no `scenario`).

- **G2-13 (was: BH-F17, EC-F15)** — `boot()` IIFE for EADDRINUSE does call `client.stop()` per device but doesn't `await` them before `process.exit(1)`.
  - **Patch**: `packages/simulator/src/index.ts:317-358` — `await Promise.all(clients.map(c => Promise.resolve(c.stop())))` before exit. Or simpler: schedule stops, give 100ms grace, then exit. Since `stop()` is sync in `WsClient`, the current code may be effectively correct — verify. If `stop()` is synchronous (no Promise), the current code is fine. Confirm via Read.

- **G2-14 (was: VG-F12, BH-F27)** — `parseRoute` bare-GET path `/admin/simulator/<uuid>` returns 200 `{device_id}` via the existing fallback — confusing API surface.
  - **Patch**: `packages/simulator/src/control/server.ts:1722-1726` — drop the fallback branch entirely. Bare-GET without `/scenario` should return 404 `not_found`. The comment "kept for completeness" is unjustified — there's no current consumer.
  - Add tests for GET → 400 method_not_allowed on /scenario (VG-F12) and bare path → 404.

- **G2-15 (was: BH-F24)** — Body size asymmetry (api 32 KB / simulator 16 KB) means a 20 KB body passes api validation, fails at simulator's 16 KB cap, returns 400 `payload_too_large` to api which maps to 502 `unknown`. UX is misleading.
  - **Patch decision**: defer. The api's 32 KB limit and simulator's 16 KB cap are documented design choices; the UX discrepancy (502 for "body too large") is acceptable. The fix would be to add a 16 KB cap to the api, but that's a defensive hardening concern, not a Story 2.5 AC.
  - **Defer to deferred-work.md as F-2.5-10**.

- **G2-16 (was: EC-F26)** — `__test__paused` short-circuit `if (this.paused === paused) return` not pinned.
  - **Patch**: add a one-liner test in `wsClient.spec.ts`: call `setPaused(true)` then `setPaused(true)` again; assert logger emits "pause toggled" exactly once.

- **G2-17 (was: EC-F28)** — `startControlServer` test asserts `typeof port === 'number'` which passes for port=0. Should assert `port > 0`.
  - **Patch**: `packages/simulator/src/control/server.spec.ts:1489` — change to `expect(port).toBeGreaterThan(0)` AND add a real fetch to the returned URL with a missing secret → expect 403.

- **G2-18 (was: AA-F6, BH-F19)** — Header case inconsistency: outbound `X-Simulator-Secret` (title), inbound `x-simulator-secret` (lower). Cosmetic.
  - **Patch**: `packages/simulator/src/control/server.ts:54` — change to `const SECRET_HEADER = "X-Simulator-Secret"` (match the outbound header). HTTP is case-insensitive but consistency aids debugging.

- **G2-19 (was: VG-F1, VG-F11, VG-F14, EC-F2, EC-F14, VH-F1 — several)** — Verification gaps: many error paths and edge cases have no tests (payload_too_large, invalid_json, disabled POST on simulator, paused-only POST, paused+invalid combo, etc.).
  - **Patch**: extend `server.spec.ts` and `simulatorRouter.spec.ts` with the tests called out in the consolidation. The critical ones for AC coverage:
    1. simulator POST 403 disabled when secret missing (mirrors /status 503 — but with G2-01 becomes 403).
    2. simulator POST 403 disabled when secret < 32 chars.
    3. api POST 503 (or 403 — see G2-03) when api secret missing.
    4. api POST 400 invalid_scenario for `{ scenario: "Bogus", paused: true }` (after G2-09).
    5. api POST 400 validation_error for `{ extra_key: "x" }`.
    6. api POST 400 invalid_device_id for non-UUID path.
    7. api POST 502 with upstream body for unknown simulator response.
    8. simulator POST 400 payload_too_large for 17 KB body.
    9. simulator POST 400 invalid_json for malformed JSON.
    10. simulator 400 method_not_allowed for GET on /scenario.
    11. simulator 404 not_found for random path /admin/wibble.
    12. simulator 404 not_found for bare /admin/simulator/{uuid} (after G2-14).

- **G2-20 (was: EC-F8, EC-F47)** — `outboundCalls === 2` assertion in queue test is timing-dependent.
  - **Patch**: replace `await new Promise(setTimeout, 5)` with a `Deferred`-style hook that the test resolves in deterministic order. Keep the test logic but make the ordering robust.

### Minor / nit (fix if time permits)

- **G2-21 (was: AA-F10, EC-F10)** — `validateSimulatorBaseUrl` dead branch `pathname !== ""` (URL parser always returns `/`).
  - **Patch**: drop the `""` branch; keep only `pathname !== "/"`.

- **G2-22 (was: EC-F31)** — Header case (consolidated with G2-18).

- **G2-23 (was: EC-F39)** — Test files: `simulatorRouter.spec.ts:231-248` `invalid_scenario` test doesn't assert simulator was NOT called.
  - **Patch**: use the existing `outboundCalls` counter from the queue test; assert `=== 0` after the 400 path.

- **G2-24 (was: EC-F35, EC-F27)** — `validateSimulatorBaseUrl` doesn't reject empty hostnames. Cosmetic.
  - **Patch**: add `if (parsed.hostname === "") return null;` after `new URL(raw)`.

- **G2-25 (was: AA-F15)** — Outbound fetch lacks `User-Agent`.
  - **Patch decision**: defer. Operator diagnostics, not an AC.
  - **Defer to deferred-work.md as F-2.5-11**.

- **G2-26 (was: EC-F22)** — `listDevicesFromPrisma` silent-swallow on Prisma error not pinned.
  - **Patch**: add a single test that mocks Prisma construction to throw → assert 200 with empty array AND that the logger captures the error (after G2-02).

## Dismissed

- **G2-D1 (was: BH-F2, EC-F3 — *after re-verification*)** — Re-read `simulatorRouter.ts:336-342` and the 409 branch (`if depth > 2: pendingDepth.set; return 409`) doesn't await work and the finally block doesn't decrement. **The 409 branch mutates depth with no decrement.** This is a real bug: a burst of 5 concurrent requests → depth = 1, 2, 3 (rejected with 409), 4 (rejected), 5 (rejected). The 3rd request sets `pendingDepth = 3` and returns 409. After the 1st's finally runs, it tries to decrement to 2 (not <=0, so doesn't delete). Depth = 2 sticks. The 2nd request then starts work, awaits 1st's promise, but by now depth=2 means even if a third request came it'd be rejected. After both 1st and 2nd finish, depth should be 0. **Verified bug.** Move to G2-04 patch list: when returning 409, do NOT mutate the depth map.

- **G2-D2 (was: AA-F11)** — G2-01 + G2-08 together resolve the simulator-side missing → banner issue. AA-F11 is folded into G2-01.

- **G2-D3 (was: AA-F14, AA-F17)** — 5 s SLA unbounded under queue saturation; per-device concurrency. Documented in spec narrative; not a regression. Track as known limitation; not blocking.

- **G2-D4 (was: AA-F25)** — Boot-window buffer replay race: frames emitted before socket connects get buffered; a scenario swap that arrives before connect flushes old-scenario frames on connect. Marked "likely benign for v1" by AA. Defer.

- **G2-D5 (was: EC-F30/F43, BH-F31/F45/F46, AA-F31)** — DNS rebinding / SSRF / User-Agent / non-JSON classification. Out of scope for Story 2.5.

- **G2-D6 (was: AA-F23, AA-F22)** — `/status` mounted twice (public + private). Intentional, documented; no fix.

- **G2-D7 (was: BH-F30, BH-F29, BH-F32)** — No retry / no boot-time devices.json validation / fire-and-forget audit. Out of scope.

- **G2-D8 (was: AA-F3, AA-F12)** — Disabled-state response shape literal conflicts (GET uses `enabled: false` per impl, spec literal is `{ disabled: true }`). Resolved by G2-08.

- **G2-D9 (was: AA-F4, AA-F5, AA-F11, AA-F20, AA-F22)** — Multiple AA findings on intentional design choices confirmed correct (RBAC matrix, public/private mounting, AC8 secret_mismatch, AC22, etc.). Documented as no-ops.

- **G2-D10 (was: AA-F21, AA-F18 partial)** — AC5/AC6 audit emission gated correctly on success. Verified; no-op.

- **G2-D11 (was: AA-F9, AA-F16)** — `setScenario` mutates `currentScenario` and `setPaused` semantics are loopback-1 KEEP decisions. Documented in spec change log; no-op.

- **G2-D12 (was: BH-F25)** — Same as EC-F30 (SSRF duplicate); dismissed.

- **G2-D13 (was: BH-F36, BH-F37, BH-F47, BH-F48)** — Cache-Control, lastSeen, upstream in audit, outcome field. Out of Story 2.5 scope.

- **G2-D14 (was: BH-F44)** — Spec I/O matrix literal ambiguity on 409 — matches narrative; resolved by G1-22.

- **G2-D15 (was: EC-F49)** — Api disabled POST → simulator disabled shape: resolved by G2-01.

- **G2-D16 (was: VG-F37, VG-F38, VG-F41, VG-F44, VG-F40, VG-F42, VG-F43, VG-F46)** — Various nits about test ordering, env agreement, OPTIONS preflight, etc. — informational.

- **G2-D17 (was: BH-F8, EC-F28)** — `clientsRegistry.set` overwrite on duplicate device_id. Out of scope (Story 2.4 owns devices.json integrity; if duplicates appear, that's a config error).

## Defer (separate list)

- F-2.5-9 — Audit `context` → `payload` rename (cross-cutting, Story 1.5)
- F-2.5-10 — Body-size cap alignment between api 32 KB and simulator 16 KB
- F-2.5-11 — User-Agent header on outbound simulator fetch
- F-2.5-12 — Boot-window buffer-replay-on-scenario-swap race (5 s SLA preservation under burst-reconnect)
- F-2.5-13 — DNS-rebinding / SSRF hardening for SIMULATOR_URL
- F-2.5-14 — Pre-existing G1-04 cross-package SCENARIO_NAMES drift test

## Pre-existing (from Group 1)

- G1-02 — `simulatorRouter.spec.ts` Operator-read test asserts 200 but not body shape. **Resolved by**: extending Operator-read test (G2-19 fix #3 — though the Operator case isn't strictly about scenario BOGUSness; rather, asserts body shape for `{device_id, name, scenario}` even when null).
- G1-19 — Pre-Story-2.5 Device rows have NULL `name`/`scenario`; api rendering must handle null fallback. **Verified**: api's `listDevices` mapper preserves nulls (`name: r.name, scenario: r.scenario` where both can be null). The web side's rendering is Group 3's concern. No api-side fix needed beyond the existing null-preserving mapper. **Defer to Group 3** for the rendering.

---

## Summary

- **Apply**: 26 patches (G2-01..G2-26)
- **Dismiss**: 17 categories (G2-D1..G2-D17)
- **Defer**: 6 items (F-2.5-9..14)
- **Pre-existing (Group 1)**: 2 (G1-02, G1-19 — G1-19 deferred to Group 3)
