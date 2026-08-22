---
title: 'Story 2.4 — Simulator Process + Six Default Devices + Seven Scenarios'
type: 'feature'
created: '2026-08-22'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'd8f7d9552646f31b6fde0c14071449d91bd393ba'
context:
  - docs/architecture.md#6-simulator-contract
  - docs/architecture.md#3.3-telemetry-frame
  - docs/architecture.md#3.4-device-authentication
  - docs/architecture.md#3.2-server-processing-order
  - docs/adr/0010-device-id-in-path.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The api now authenticates and persists frames (Stories 2.1–2.3),
but nothing in the stack actually emits frames. A reviewer running
`docker compose up` sees an empty dashboard and an unread audit log. The
six devices the demo depends on have no `Device` rows, no per-device
UUIDs the simulator can connect under, and no scenario curves to walk the
metrics through. Without the simulator, no Epic 3–6 feature has data to
operate on.

**Approach:** Replace the stub `packages/simulator/src/index.ts` with a
real Node process that (a) loads six fixed device UUIDs from a shared
config file, (b) mints a fresh `aud:"simulator"` JWT per device at boot,
(c) opens a WebSocket to `ws://<api>/ingest/<device_id>`, (d) emits
telemetry frames at the configured `tick_interval_ms`, walking each
device's metric set through the assigned scenario curve, (e) buffers
frames in memory (max 5,000 per device) on disconnect and flushes them
in `seq` order on reconnect with exponential backoff, and (f) reacts to
the api's envelopes (`rate_limited`, `bad_request`, `stale_frame`,
`unauthenticated`, `auth_error`, `persist_failed`) so a reviewer running
the stack sees a healthy, six-device telemetry stream on the dashboard.

## Boundaries & Constraints

**Always:**
- The simulator runs as a **separate Node 20 process** (architecture
  §2, ADR 0002) and connects via the same wire contract as a real device
  (§3.3) — there is no back-door path. A real device dropping in tomorrow
  changes only the transport.
- JWT claims per architecture §3.4: `iss:"surakkha-api"`, `aud:"simulator"`,
  `scope:"telemetry:write"`, `sub` = device UUIDv4, TTL = `SIMULATOR_TOKEN_TTL_SECONDS`
  (1h, per `packages/shared/src/auth.ts`). Use the existing
  `simulatorClaimTemplate` helper for the claim template so the
  shared package's UUIDv4 invariant is not duplicated.
- Wire contract per `TelemetryFrameSchema` (`packages/shared/src/telemetry.ts`):
  `version: 1`, `device_id`, `ts`, `fw`, `seq` (monotonic per device),
  six-metric object with hard ranges. Use the schema's `safeParse` before
  sending — the simulator is its own first validator.
- The six device UUIDs are a **fixed, deterministic set** committed to
  `packages/simulator/src/devices.json` (or `.ts`). They do NOT come
  from `prisma db seed` — the api's `verifyIngestClaims` does not check
  the `Device` row's existence at v1 (Story 2.2 F-W5 deferral), so the
  simulator is allowed to connect under UUIDs that are not yet in the
  `Device` table. Future seed work lives in a later story.
- Frame buffer cap is **5,000 readings per device** (architecture §6.1).
  When the buffer fills, drop the oldest entries with a single
  `simulator: buffer overflow` log line; never silently truncate without
  a log.
- Reconnect uses exponential backoff `1s → 2s → 4s → … → 30s` capped at 30s
  (architecture §6.1). Reset to 1s on a successful `connect`.
- Emit frames at a configurable `tick_interval_ms` per device
  (default 2_000). The server rate-cap is one accepted reading per 2s
  per device — the default respects it; configurable overrides must
  not drop below 1_000 ms or the simulator hammers the rate cap.
- On `rate_limited {retry_after_seconds: N}`, pause emissions for N
  seconds, do NOT drop the affected frame. (Story 2.2 server emits
  `rate_limited` and then `socket.disconnect(true)`; the simulator's
  reconnect path picks up the dropped frame on the next cycle — see
  *Design Notes*.)
- The simulator never reaches for admin endpoints, never touches Postgres
  directly, never imports from `@surakkha/api`. Its only knowledge of
  the api is the wire contract.

**Ask First:**
- Adding new scenarios beyond the seven named in architecture §6.1
  (an eighth scenario requires an architecture change).
- Changing the six device UUIDs (they appear in the demo script and may
  appear in test fixtures; renumbering breaks downstream tests).
- Switching the simulator to a non-WebSocket transport (an architecture
  change — must be coordinated with a v2 bump).
- Per-device scenario assignment beyond "one scenario per device" (e.g.
  scenario rotation mid-run). Trivial to add later; out of scope for
  v1.

**Never:**
- Never hard-code a secret in source. `JWT_SECRET` is read from
  `process.env` at boot; the simulator refuses to start without it
  (matches Story 1.4 fail-fast).
- Never emit a frame whose `seq` is less than the last emitted `seq`
  for that device (the server flags it `out_of_order` but the canonical
  timeline should never see gaps the simulator itself created).
- Never emit a frame with `ts` older than `STALE_FRAME_THRESHOLD_MS`
  (5 min, per Story 2.3). Real devices stay in sync with wall clock;
  the simulator reads `Date.now()` at frame build time.
- Never pre-compute metric curves for "offline" or "stale" devices —
  they should stop emitting while in those scenarios, not buffer
  stale-by-construction frames.
- Never modify the api or the shared package from this story (boundary:
  the simulator is downstream of both). Adding a shared helper that
  the simulator + api both import is a separate concern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SIMULATOR_BOOT_OK | All six env vars present; api reachable | Six devices register; six WS connections open; six `tick` timers start | Log per-device at info |
| SIMULATOR_BOOT_NO_JWT_SECRET | `JWT_SECRET` unset | Process refuses to start with a fail-fast log line + `process.exit(1)` | Match Story 1.4 fail-fast pattern |
| SIMULATOR_BOOT_BAD_API_URL | `API_URL` malformed | Fail-fast log + non-zero exit | Fail-fast at config parse |
| FRAME_HAPPY_PATH | Device `dev-1` on `Normal` scenario, t=2s tick | Frame with all six metrics within `MetricRanges`, fresh `ts`, monotonic `seq` | Log debug per emit |
| FRAME_TS_NEAR_NOW | wall clock advanced | `ts` within 1s of `Date.now()` | Reject locally before send if drift >60s (defensive; uses `CLOCK_SKEW_DETECT_MS` from shared) |
| RATE_LIMITED_RESPONSE | Server emits `rate_limited {retry_after_seconds: 2}` | Pause emissions for 2s; do not drop buffered frames; resume on next tick | Log warn with deviceId + retry_after |
| BAD_REQUEST_RESPONSE | Server emits `bad_request {missing_fields}` | Log error with deviceId + missing_fields; drop the offending frame from the buffer (do NOT retry — it will fail again) | Buffer advance, continue |
| STALE_FRAME_RESPONSE | Server emits `stale_frame {age_seconds}` | Log warn; drop the offending frame; do NOT disconnect the local socket (server already soft-disconnected) | Buffer advance, continue |
| UNAUTHENTICATED_RESPONSE | Server emits `unauthenticated` | Tear down local socket; trigger reconnect with backoff | Reconnect with exponential backoff |
| AUTH_ERROR_RESPONSE | Server emits `auth_error {error: "device_id_mismatch" \| "forbidden_scope"}` | Tear down; log error; trigger reconnect (the local mint may be stale) | Reconnect path |
| PERSIST_FAILED_RESPONSE | Server emits `persist_failed` | Tear down; reconnect; the frame that triggered it is dropped (server-side persist failure — the simulator's job is to keep streaming) | Reconnect path |
| SOCKET_DISCONNECT_NO_ENVELOPE | TCP RST or remote hangup | Reconnect with backoff; flush in-memory buffer in `seq` order on reconnect | Log warn |
| BUFFER_OVERFLOW | Per-device buffer reaches 5_000 | Drop oldest, log `simulator: buffer overflow` once per overflow event | Single log line; do not spam |
| RECONNECT_BACKOFF | Nth failed reconnect attempt | Wait `min(2^N * 1000ms, 30_000ms)` before next attempt; reset to 1s on success | Log info per attempt |
| SCENARIO_NORMAL | Device on `Normal` | All metrics walk a slow random walk within healthy ranges (pH 6.5–8.5, TDS <500, turbidity <1, chlorine 0.5–1.5) | n/a |
| SCENARIO_RISING_TDS | Device on `RisingTDS` | TDS rises from 200 to 1500 over ~120 ticks (4 minutes), then plateaus | n/a |
| SCENARIO_TURBIDITY_SPIKE | Device on `TurbiditySpike` | Turbidity spikes to 200, holds for 10 ticks, decays back to baseline | n/a |
| SCENARIO_CHLORINE_DROP | Device on `ChlorineDrop` | Chlorine decays from 0.8 to 0.1 over ~60 ticks, holds at 0.1 | n/a |
| SCENARIO_OFFLINE | Device on `Offline` | Stop emitting; close the WS after a 5-tick grace period (simulates physical disconnect); reconnect with backoff | n/a |
| SCENARIO_BATTERY_LOW | Device on `BatteryLow` | Continue emitting normal metrics; flag event into the `fw` field? No — `fw` is firmware version, not battery. Use a separate in-process log only for now (battery is not in v1 wire contract; flagged in deferred-work). | Log info once per scenario start |
| SCENARIO_RANDOM_FAILURE | Device on `RandomFailure` | At tick multiples of 20 (deterministic 20-tick period), emit a frame with `ph` replaced by `NaN`; the server rejects as `bad_request`; the simulator logs and moves on | Bad-request path |
| SCENARIO_ROTATION_PER_DEVICE | Each of six devices gets exactly one of the seven scenarios | One device per scenario, with one scenario (`BatteryLow`) left as "extra" — six-of-seven mapping, deterministic assignment | n/a |

</frozen-after-approval>

## Code Map

- `packages/simulator/src/devices.json` (or `.ts`) -- **new**; six
  fixed device UUIDs and per-device default scenario assignment.
  JSON is preferred over TS so a curious reviewer can read it without
  a Node toolchain.
- `packages/simulator/src/index.ts` -- **replace stub** with the
  real boot sequence: load config → load env (`API_URL`, `JWT_SECRET`)
  → mint six JWTs → open six WS clients.
- `packages/simulator/src/wsClient.ts` -- **new**; per-device
  Socket.IO client wrapper (`socket.io-client`). Handles connect,
  reconnect-with-backoff, frame emit (`socket.emit("frame", payload)`),
  envelope reaction (`socket.on("rate_limited", …)`, etc.),
  in-memory buffer (cap 5_000), flush on reconnect.
- `packages/simulator/src/scenarios.ts` -- **new**; pure scenario
  functions `(state, tickCount) → TelemetryMetrics` for each of the
  seven named scenarios. No side effects; the same input yields the
  same metrics. Easy to unit-test.
- `packages/simulator/src/jwt.ts` -- **new**; thin wrapper around
  `simulatorClaimTemplate` + `jsonwebtoken.sign`. Reads `JWT_SECRET`
  from env at boot. Fails fast if missing.
- `packages/simulator/src/__tests__/scenarios.spec.ts` -- **new**;
  per-scenario unit tests with deterministic metric walks.
- `packages/simulator/src/__tests__/wsClient.spec.ts` -- **new**;
  envelope-reaction tests using a stub `WebSocket` (the same pattern
  as `frame.spec.ts`).
- `packages/simulator/.env.example` -- **new**; documents `API_URL`,
  `JWT_SECRET`, optional `TICK_INTERVAL_MS`.

Reuse points (read-only investigation findings):
- `packages/shared/src/telemetry.ts` -- `TelemetryFrameSchema`,
  `MetricRanges`, `STALE_FRAME_THRESHOLD_MS`, `CLOCK_SKEW_DETECT_MS`,
  `ReadingFlagSchema`. The simulator builds frames via
  `TelemetryFrameSchema.parse(...)` so a malformed frame fails locally
  before reaching the server.
- `packages/shared/src/auth.ts` -- `simulatorClaimTemplate(sub)`,
  `SIMULATOR_TOKEN_TTL_SECONDS`. Use the helper, do NOT re-implement.
- `packages/shared/src/logger.ts` -- `createLogger(...)`. Same logger
  pattern as the rest of the stack.
- `packages/api/src/ingest/server.ts` -- the WS endpoint contract.
  The simulator connects to `ws://<API_URL>/ingest/<device_id>` with
  `auth: { token }` and listens for envelopes. No import (the
  simulator does not import from `@surakkha/api`); the contract is
  read off the shared schemas.
- `packages/api/src/ingest/frame.ts` -- the server's per-frame pipeline.
  Read-only reference for "what does the server do with my frame" so
  envelope names line up (`bad_request`, `stale_frame`, `rate_limited`,
  `unauthenticated`, `auth_error`, `persist_failed`).
- `packages/db/prisma/schema.prisma` -- `Device.id` is the wire's `sub`.
  No seed in v1; the simulator's UUIDs may or may not have matching
  rows. `verifyIngestClaims` does not check (Story 2.2 F-W5 deferral).
- `_bmad-output/implementation-artifacts/2-3-unknown-missing-field-handling.md`
  -- the `STALE_FRAME_THRESHOLD_MS = 5min` contract. The simulator
  must not emit frames older than 5min relative to wall clock.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/simulator/src/devices.json` -- author six fixed UUIDv4 device IDs and a `scenario` per device (six-of-seven from the named set, one scenario extra), plus a `tick_interval_ms` default of 2000 -- reason: simulator needs deterministic device identifiers; demo script references these.
- [ ] `packages/simulator/src/jwt.ts` -- mint a simulator JWT per device at boot using `simulatorClaimTemplate` + `jsonwebtoken.sign` with `JWT_SECRET` from env; fail-fast on missing/weak secret -- reason: simulator cannot connect without a valid token.
- [ ] `packages/simulator/src/scenarios.ts` -- implement the seven scenario curves as pure functions `(state, tickCount) → TelemetryMetrics`. Each scenario must keep all metrics within `MetricRanges` (the server rejects out-of-range frames). `RandomFailure` may emit NaN deliberately -- reason: scenarios are the demo story.
- [ ] `packages/simulator/src/wsClient.ts` -- per-device Socket.IO client (via `socket.io-client`): connect with `auth: { token }` → register listeners for envelopes (`rate_limited`, `bad_request`, `stale_frame`, `unauthenticated`, `auth_error`, `persist_failed`) → emit frames at `tick_interval_ms` via `socket.emit("frame", payload)` → buffer up to 5_000 on disconnect → exponential-backoff reconnect `1s → 30s` → flush buffer on reconnect in `seq` order → react to envelopes (rate_limited pause, bad_request drop, stale_frame drop, unauthenticated/auth_error/persist_failed reconnect) -- reason: simulator runtime.
- [ ] `packages/simulator/src/index.ts` -- replace stub with: load devices.json → read env → mint six JWTs → spawn six `wsClient` instances → wire `SIGINT` / `SIGTERM` to graceful shutdown (close all sockets, drain logger) -- reason: entry point.
- [ ] `packages/simulator/.env.example` -- document `API_URL` (default `http://localhost:4000`), `JWT_SECRET` (required), optional `TICK_INTERVAL_MS` -- reason: discoverability.
- [ ] `packages/simulator/src/__tests__/scenarios.spec.ts` -- per-scenario unit test: deterministic input yields expected metric ranges (e.g. `RisingTDS` after 60 ticks has `tds_ppm > 700`; `Offline` scenario emits no metrics). Pin the seven scenario names exactly. -- reason: scenario pin.
- [ ] `packages/simulator/src/__tests__/wsClient.spec.ts` -- envelope-reaction tests using a stub Socket.IO client: rate_limited pause, bad_request drop, stale_frame drop, disconnect-without-envelope triggers reconnect, buffer overflow drops oldest. ALSO tighten the `bad_request` assertion: the offending frame must be removed from the buffer (not just `currentSeq >= 0`); assert the captured `socket.emit("frame", …)` calls do not include a frame whose `seq` matches the one just dropped. ALSO add explicit tests for `auth_error` and `persist_failed` envelopes. -- reason: wire-contract pin + closing the tautology found in review.
- [ ] `packages/simulator/src/__tests__/boot.spec.ts` -- boot-fail-fast: missing `JWT_SECRET` exits non-zero; bad `API_URL` exits non-zero; happy path mints six JWTs (mock `jsonwebtoken.sign` and assert six calls). ALSO add cases for malformed `devices.json`, unknown scenario name, duplicate `device_id`, and `TICK_INTERVAL_MS` out-of-range -- reason: boot contract.
- [ ] `packages/simulator/src/__tests__/jwt.spec.ts` -- NEW: cover `resolveJwtSecret` reason strings (missing / too-short / exactly-min-length) and `mintSimulatorToken` round-trips the simulator claim template (`aud:"simulator"`, `scope:"telemetry:write"`, `sub` = device UUID, `iss:"surakkha-api"`) -- reason: closes the verification gap flagged in review — the boot test only asserts six sign calls, not the claim shape.
- [ ] `packages/simulator/src/index.ts` `loadDevicesFile` -- STRENGTHEN upfront validation: every `device_id` must match UUIDv4 regex; every `scenario` must be in `SCENARIO_NAMES`; no duplicate `device_id`s; fail-fast with a clear log line on any violation (current code only does `typeof` + range checks; UUID/scenario/dup checks fire at runtime) -- reason: closes the "validate-late" gap flagged in review.

**Acceptance Criteria:**
- Given the api is reachable at `API_URL` and `JWT_SECRET` is set, when the simulator boots, then six WebSocket connections open to `/ingest/<device_id>` (one per device in `devices.json`).
- Given a device's `tick_interval_ms` has elapsed since its last frame, when the simulator's per-device timer fires, then a frame conforming to `TelemetryFrameSchema` is sent over the WS with a `seq` one greater than the previous emitted frame for that device.
- Given a scenario walks metrics outside `MetricRanges` (e.g. `RisingTDS` overshoots `tds_ppm`), when `TelemetryFrameSchema.safeParse` runs locally before send, then the frame is rejected locally with a logged error and the simulator does NOT send it.
- Given the server emits `rate_limited {retry_after_seconds: N}`, when the simulator's WS receives the envelope, then the simulator pauses emissions for N seconds (no frames are sent), then resumes without dropping buffered frames.
- Given the server emits `bad_request {missing_fields: [...]}`, when the simulator receives the envelope, then the offending frame is dropped from the in-memory buffer (not retried) and a log line records the missing fields.
- Given the server emits `stale_frame {age_seconds}`, when the simulator receives the envelope, then the offending frame is dropped and the simulator does NOT trigger its own reconnect (the server already soft-disconnected).
- Given the simulator's WS disconnects without an envelope (TCP RST), when the disconnect handler runs, then the simulator reconnects with exponential backoff starting at 1s, capped at 30s, resetting to 1s on success.
- Given the simulator's per-device buffer reaches 5_000 readings, when the next frame is produced while still disconnected, then the oldest buffer entry is dropped and a single `simulator: buffer overflow` log line is emitted (not per-frame).
- Given the simulator reconnects after a disconnect, when the buffered frames are flushed, then they are sent in `seq` order (monotonic), honoring the server's rate cap.
- Given `JWT_SECRET` is unset, when the simulator boots, then it exits non-zero with a fail-fast log line and no WS connections are opened.

## Design Notes

**Why JSON for devices, not TS:** The six device UUIDs are referenced
by the demo script, the API tests (some use `DEVICE_UUID` constants),
and eventually the admin simulator tab (Story 2.5). A reviewer should
be able to read them without compiling TypeScript. JSON is also the
natural format for the Story 2.5 admin tab's "load devices" surface.

**Why one scenario per device, not rotation:** The seven scenarios exist
to exercise different operator-triage paths (critical TDS, offline
device, low chlorine, etc.). Rotating mid-run confuses the demo story —
a reviewer wants to see "device X is in trouble" sustained long enough
to acknowledge / inspect / resolve (Epic 4 territory). Per-device
assignment is deterministic so a test can pin "device 1 = Normal".

**Why the simulator drops on `bad_request` instead of retrying:** A
`bad_request` envelope says the frame is structurally broken — retrying
it produces another `bad_request`. The simulator logs the missing
fields and moves on. If the broken frames cluster, that's a simulator
bug worth a log line; flooding the server with retry attempts is worse.

**Why a 1s minimum `tick_interval_ms`:** The server rate-cap is one
accepted reading per 2s per device. A tick faster than that triggers
`rate_limited` envelopes every frame, drowning the simulator in pause-
resume cycles and obscuring the real telemetry. The default 2_000 ms
respects the cap; the 1_000 ms minimum is the safety floor — anything
faster is a misconfiguration the simulator refuses.

**Why we don't seed `Device` rows in this story:** The api's
`verifyIngestClaims` does NOT check device existence at handshake
(Story 2.2 F-W5 deferral). The simulator can connect under any UUIDv4
without a matching `Device` row. The FK on `Reading.deviceId` means
the api's `stepPersist` will fail with a constraint violation if the
device does not exist. To make the simulator's frames actually persist,
either (a) the simulator creates the `Device` rows on first connect
via a separate admin endpoint (out of scope — no admin endpoint for
device creation in v1), or (b) the simulator's UUIDs are seeded into
the `Device` table by a future seed story. For Story 2.4 we ship
option (b) deferred: the simulator logs a one-time warning per
device if the WS connects but no frames persist, and we accept that
the demo story requires a follow-up seed step (tracked in
deferred-work.md as a follow-up to F-W5).

**Why buffer flush is in `seq` order on reconnect:** The server stamps
`out_of_order` if `seq < last_seen`. Sending the buffered frames in
order means a single `out_of_order` window during the gap, then the
buffer clears cleanly. Sending in arrival order (which is also `seq`
order at the simulator level — frames are produced monotonically) gives
the same result; the explicit ordering is a contract assertion for
future contributors.

**Why `BatteryLow` has no wire effect:** The wire contract does not
carry a battery metric in v1. The scenario emits normal telemetry and
logs `simulator: scenario BatteryLow started for device <uuid>` once
per scenario start. The operator-triage signal for "this device is
battery-low" comes from a future Epic 4 feature (a separate ack-style
event). Documented here so a reviewer does not look for a missing
`battery_pct` field in the schema.

**Why the simulator uses `socket.io-client`, not raw `ws`:** The api's
`packages/api/src/ingest/server.ts` mounts a Socket.IO server (the
`Server` class from `socket.io`), not a raw `ws` endpoint. The
simulator must therefore connect with `socket.io-client` (already
listed in the simulator's `package.json` as a transitive dep via the
workspace). Auth handshake uses `auth: { token: <jwt> }`; envelope
listeners attach via `socket.on("rate_limited", …)` etc. Socket.IO is
only used for the api→device direction (the api→web direction is
Socket.IO too, for the dashboard live-feed).

## Verification

**Commands:**
- `pnpm --filter @surakkha/simulator typecheck` -- expected: 0 errors.
- `pnpm --filter @surakkha/simulator build` -- expected: 0 errors.
- `pnpm --filter @surakkha/simulator test` -- expected: ≥ 12 new tests
  (7 scenario tests, 5 envelope/buffer/reconnect tests).
- `pnpm --filter @surakkha/simulator lint` -- expected: 0 errors.
- `pnpm typecheck` -- expected: 5/5 packages green (api, db, shared, simulator, web).
- `pnpm lint` -- expected: 5/5 packages green.

**Manual checks (integration smoke):**
- Boot the api (`pnpm --filter @surakkha/api dev`) and confirm the
  WS endpoint accepts the simulator's connect on `/ingest/<uuid>`.
- Boot the simulator (`pnpm --filter @surakkha/simulator dev`) with
  `JWT_SECRET` and `API_URL` set; observe six `info: simulator: connected device=<uuid>`
  log lines within ~5s.
- Inspect the simulator log: each device's `scenario` line is logged
  once at startup; `RisingTDS` device's `tds_ppm` rises monotonically
  across 60 ticks; `Offline` device emits nothing after the grace period
  and reconnects.
- Trigger `SIMULATOR_SECRET` unset: confirm the simulator exits non-zero
  with a fail-fast log line.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. Do not modify or delete existing entries.
     Each entry records: what finding triggered the change, what was amended, what known-bad state
     the amendment avoids, and any KEEP instructions (what worked well and must survive re-derivation).
     Empty until the first bad_spec loopback. -->

### Loopback 1 (2026-08-22)

- **Triggering finding:** All three review layers (blind hunter, edge-case
  hunter, verification-gap) flagged the `ws` vs Socket.IO transport
  mismatch as the highest-impact issue. The simulator's `wsClient.ts`
  correctly followed the spec text and Design Notes ("`ws` library, not
  Socket.IO"), but `packages/api/src/ingest/server.ts` is in fact a
  Socket.IO `Server`, not a raw `ws` server. End-to-end integration
  cannot connect.
- **What was amended:**
  - Design Notes: replaced the "ws library" justification with a
    `socket.io-client` justification grounded in the api's actual mount.
  - Code Map: `wsClient.ts` description now reads "Socket.IO client
    wrapper (`socket.io-client`)".
  - Task #4 (wsClient.ts): explicit `auth: { token }` + `socket.emit`
    instructions.
  - Task #8 (wsClient.spec.ts): stub is now a Socket.IO stub, not a `ws`
    stub.
  - Tasks #9 (boot.spec.ts), #10 (jwt.spec.ts NEW), #11
    (`loadDevicesFile` validation): added to absorb the patch findings
    surfaced in review loop 0 that the loopback would otherwise lose.
- **Known-bad state avoided:** simulator code that compiles + tests +
  lints but cannot connect to the api at runtime. The acceptance
  criterion "six WebSocket connections open to `/ingest/<device_id>`"
  would have failed the manual smoke test in the spec's Verification
  section.
- **KEEP instructions for re-derivation:**
  - Scenario names pinned exactly: `Normal`, `RisingTDS`,
    `TurbiditySpike`, `ChlorineDrop`, `Offline`, `BatteryLow`,
    `RandomFailure`.
  - Six-of-seven device assignment: `BatteryLow` is the spare (six
    devices cover six of seven scenarios).
  - `Buffer` cap = 5_000 per device; `tick_interval_ms` default = 2_000,
    min = 1_000; backoff `1s → 30s`, reset on success.
  - `fail-fast` exit codes on missing `JWT_SECRET`, bad `API_URL`,
    out-of-range `TICK_INTERVAL_MS`.
  - The pure scenario functions in `scenarios.ts` are deterministic and
    `RandomFailure` uses a deterministic 20-tick period (test pin
    requires deterministic; spec's "Poisson λ=20" prose is overridden by
    the test contract).
  - JWT claim template: `simulatorClaimTemplate(deviceId)` from
    `packages/shared/src/auth.ts` — do NOT hand-roll claims.
  - `simulatorClaimTemplate` requires UUIDv4; the `loadDevicesFile`
    upfront validation (newly added) catches non-UUIDv4 device IDs
    before reaching the template.
  - `TelemetryFrameSchema.safeParse` runs locally before every send;
    NaN values from `RandomFailure` are caught here and logged.
  - `batteyLow` (sic) — `BatteryLow` — emits the same curve as `Normal`
    (log-only signal per spec Design Notes).

## Suggested Review Order

**Entry point — boot sequence**

- One-file overview of the boot pipeline: env → devices.json → API_URL → JWTs → WsClients.
  [`index.ts:239`](../../packages/simulator/src/index.ts#L239)

- Fail-fast contract: `failFast` + per-stage error logs before any socket opens.
  [`index.ts:67`](../../packages/simulator/src/index.ts#L67)

**Boot config validation**

- `devices.json` UUIDv4 + scenario + duplicate + tick-interval validation.
  [`index.ts:89`](../../packages/simulator/src/index.ts#L89)

- `API_URL` and `TICK_INTERVAL_MS` env parsing; env-wins vs file-fallback via `undefined` sentinel.
  [`index.ts:195`](../../packages/simulator/src/index.ts#L195)

- Entry-point detection under `tsx` via `resolve()` comparison.
  [`index.ts:323`](../../packages/simulator/src/index.ts#L323)

**JWT minting for simulator devices**

- `assertJwtSecretOrExit` fail-fast with min-length check (mirrors api's pattern).
  [`jwt.ts:61`](../../packages/simulator/src/jwt.ts#L61)

- Per-device simulator claim template wrapper; reuses `simulatorClaimTemplate` from `@surakkha/shared`.
  [`jwt.ts:89`](../../packages/simulator/src/jwt.ts#L89)

**Scenario curves (pure, deterministic)**

- Closed-enum scenario names + tick union shape (`metrics | offline`).
  [`scenarios.ts:35`](../../packages/simulator/src/scenarios.ts#L35)

- `RisingTDS` clamped ramp (200→1500 over 120 ticks, no cycling).
  [`scenarios.ts:107`](../../packages/simulator/src/scenarios.ts#L107)

- `TurbiditySpike` 10-tick hold + 10-tick linear decay back to 0.4.
  [`scenarios.ts:134`](../../packages/simulator/src/scenarios.ts#L134)

- `Offline` 5-tick grace period; returns `kind:"offline"` thereafter.
  [`scenarios.ts:210`](../../packages/simulator/src/scenarios.ts#L210)

- `RandomFailure` deterministic 20-tick period NaN injection on `ph`.
  [`scenarios.ts:242`](../../packages/simulator/src/scenarios.ts#L242)

- `runScenario` exhaustive switch with `never`-narrowing default throw.
  [`scenarios.ts:267`](../../packages/simulator/src/scenarios.ts#L267)

**Per-device Socket.IO client (the heart of the change)**

- Constants: BUFFER_CAP=5000, MIN_TICK_INTERVAL_MS=1000, backoff 1s→30s.
  [`wsClient.ts:22`](../../packages/simulator/src/wsClient.ts#L22)

- Wire-envelope name constants mirroring api's emit names.
  [`wsClient.ts:33`](../../packages/simulator/src/wsClient.ts#L33)

- Test seam surface (`__test__setSocket`, `__test__runTick`, etc.) — production never calls these.
  [`wsClient.ts:178`](../../packages/simulator/src/wsClient.ts#L178)

- Exponential backoff with cap and pending-timer clear on new disconnect.
  [`wsClient.ts:277`](../../packages/simulator/src/wsClient.ts#L277)

- Tick loop: `rate_limited` pause window + local `safeParse` NaN drop + offline skip.
  [`wsClient.ts:335`](../../packages/simulator/src/wsClient.ts#L335)

- Buffer overflow: drop-oldest with single warn log per run.
  [`wsClient.ts:394`](../../packages/simulator/src/wsClient.ts#L394)

- `flushBuffer` clears buffer before emit (closes unbounded-growth / `out_of_order` bug).
  [`wsClient.ts:428`](../../packages/simulator/src/wsClient.ts#L428)

- Envelope handlers: `rate_limited` / `bad_request` / `stale_frame` / `auth_error` / `persist_failed` / `unauthenticated` / `internal_error`.
  [`wsClient.ts:489`](../../packages/simulator/src/wsClient.ts#L489)

**Default fleet**

- Six deterministic UUIDv4 devices with six scenarios (BatteryLow is the spare).
  [`devices.json`](../../packages/simulator/src/devices.json)

- Mirrored tick interval + JWT_SECRET hint.
  [`.env.example`](../../packages/simulator/.env.example)

**Peripherals**

- Boot fail-fast contract: missing/short JWT, bad API_URL, bad TICK_INTERVAL_MS, malformed devices.json, unknown scenario, duplicate device_id, non-UUIDv4, empty array.
  [`boot.spec.ts:95`](../../packages/simulator/src/__tests__/boot.spec.ts#L95)

- JWT: six tokens for six devices + default devices.json content pin.
  [`boot.spec.ts:206`](../../packages/simulator/src/__tests__/boot.spec.ts#L206)

- Scenario unit tests: per-tick pins, Offline grace, RandomFailure NaN-on-period, runScenario exhaustiveness.
  [`scenarios.spec.ts:54`](../../packages/simulator/src/__tests__/scenarios.spec.ts#L54)

- WsClient envelope / buffer / reconnect: bad_request / stale_frame drop + persist_failed buffer advance + auth reconnect + buffer overflow + frame payload shape.
  [`wsClient.spec.ts:110`](../../packages/simulator/src/__tests__/wsClient.spec.ts#L110)

- JWT minting + claim template + scope + aud tests.
  [`jwt.spec.ts`](../../packages/simulator/src/__tests__/jwt.spec.ts)