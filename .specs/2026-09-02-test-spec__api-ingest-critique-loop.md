# Test spec — `packages/api/src/ingest` critique loop

**Date:** 2026-09-02
**Surface:** `packages/api/src/ingest/` (refinement of headers + cross-file refs + story jargon + F-P# markers)
**Companion critique:** `.impeccable/critique/2026-09-02T24-00-00Z__packages-api-src-ingest.md` (22/40, 3 P1 + 33 P2)

This spec pins the load-bearing invariants of the ingest seam that survived the refactor pass. The header-trim + F-P# / cross-file-reference removal work does not change behaviour; this spec verifies the contracts that depend on the surface (10-step driver ordering, stale-frame window, rate limit window, sequence drop/reorder, broadcast room, subscriber join semantics) still hold.

## Behavioural pins (Given/When/Then)

### 10-step driver (frame.ts)

- **B-FRAME-1**: Given `PROCESSING_ORDER` in `@surakkha/shared/telemetry.ts`, when `processFrame` iterates over it, then the per-step branch in `dispatchStep` matches the literal order 1:1 (`validate → auth check → rate check → seq/drop check → persist → rule evaluation → alert emission → state-machine update → audit append → socket broadcast`).
- **B-FRAME-2**: Given a well-formed frame with `ts = serverReceivedAt - 1ms`, when `stepValidate` runs, then `state.parsed` is set, `flags = []`, and the iteration continues.
- **B-FRAME-3**: Given a frame with `ts < serverReceivedAt - STALE_FRAME_THRESHOLD_MS`, when `stepValidate` runs, then `socket.emit("stale_frame", { age_seconds })` fires and `socket.disconnect(false)` is called (soft-disconnect — backlog of fresh frames still accepted).
- **B-FRAME-4**: Given a frame with `|serverReceivedAt - ts| > CLOCK_SKEW_DETECT_MS` (60s) but within the stale window, when `stepValidate` runs, then `flags = ["clock_skew_detected"]` is stamped.
- **B-FRAME-5**: Given a malformed frame (e.g. `ts: -1` or unknown TOP-LEVEL key), when `stepValidate` runs, then `socket.emit("bad_request", translateZodError(...))` fires and the outcome is `{ status: "bad_request" }`.
- **B-FRAME-6**: Given a frame arriving within the rate-limit window (1 frame / 2s), when `stepRateCheck` runs, then `socket.emit("rate_limited", { retry_after_seconds: 2 })` fires and `socket.disconnect(true)` is called.
- **B-FRAME-7**: Given `seq > lastSeen`, when `stepSeqDropCheck` runs, then `state.dropCount = seq - lastSeen - 1` (the frames between previous and current are counted as drops) and the frame proceeds.
- **B-FRAME-8**: Given `seq <= lastSeen`, when `stepSeqDropCheck` runs, then `state.flags = ["out_of_order"]` is appended and an audit `seq_reorder_detected` hook fires.
- **B-FRAME-9**: Given `seq > lastSeen` with `seq - lastSeen - 1 > 0` (dropCount > 0), when `stepSeqDropCheck` runs, then an audit `seq_drop_detected` hook fires with `{ drop_count, last_seq }`.
- **B-FRAME-10**: Given `prisma.reading.create` throws, when `stepPersist` runs, then `console.error("ingest: persist failed", ...)` fires, `socket.emit("persist_failed", { error: "persist_failed" })` is emitted, `socket.disconnect(true)` is called, and the outcome is `{ status: "ignored" }`.
- **B-FRAME-11**: Given a successfully-persisted frame, when `stepSocketBroadcast` runs, then TWO emits happen:
  1. `io.to(device:<deviceId>).emit("reading:new", payload)` (per-device)
  2. `io.to(readings:latest).emit("reading:new", payload)` (dashboard broadcast)
- **B-FRAME-12**: Given the 10-step driver completes without any `exit`, when `processFrame` returns, then the outcome is `{ status: "accepted" }`.

### Rate limit (rateLimit.ts)

- **B-RL-1**: Given `RATE_LIMIT_WINDOW_MS = 2_000`, the rate limit is 1 frame / 2s per device.
- **B-RL-2**: Given `nowMs - lastAcceptedAtMs >= 2_000`, when `tryAccept(deviceId, nowMs)` is called, then it returns `{ ok: true }` and records `lastAcceptedAtMs[deviceId] = nowMs`.
- **B-RL-3**: Given `nowMs - lastAcceptedAtMs < 2_000`, when `tryAccept(deviceId, nowMs)` is called, then it returns `{ ok: false, retryAfterSeconds: 2 }` and does NOT update `lastAcceptedAtMs` (the window anchors to the LAST accepted frame, not the rejected one).
- **B-RL-4**: Given two devices with different UUIDs, when `tryAccept(deviceA, nowMs)` is called and then `tryAccept(deviceB, nowMs)`, then both return `{ ok: true }` (per-device isolation).

### Sequence (sequence.ts)

- **B-SEQ-1**: Given a first frame with `seq: 0` (no prior observation), when `observe(deviceId, 0)` is called, then it returns `{ outcome: "accept", dropCount: 0, newLastSeen: 0 }` (FIRST_FRAME case via `INITIAL_LAST_SEEN = -1`).
- **B-SEQ-2**: Given `lastSeen = 5`, when `observe(deviceId, 6)` is called, then it returns `{ outcome: "accept", dropCount: 0, newLastSeen: 6 }` (consecutive frame, no gap).
- **B-SEQ-3**: Given `lastSeen = 5`, when `observe(deviceId, 10)` is called, then it returns `{ outcome: "accept", dropCount: 4, newLastSeen: 10 }` (4 frames between previous and current were missed).
- **B-SEQ-4**: Given `lastSeen = 10`, when `observe(deviceId, 8)` is called, then it returns `{ outcome: "reorder", dropCount: 0, newLastSeen: 10 }` (late arrival; lastSeen unchanged; dropCount is the literal type `0`).
- **B-SEQ-5**: Given `lastSeen = 10`, when `observe(deviceId, 10)` is called (duplicate), then it returns `{ outcome: "reorder", dropCount: 0, newLastSeen: 10 }` (seq === lastSeen is the reorder case).

### Server / subscriber (server.ts + subscriber.ts)

- **B-SRV-1**: Given a connection with empty URL device_id and empty token, when `buildIngestServer` runs, then `socket.emit("unauthenticated")` fires and `socket.disconnect(true)` is called.
- **B-SRV-2**: Given a connection with valid `device_id` but `verifyIngestClaims` returns `{ kind: "sig_fail" }`, when `buildIngestServer` runs, then `socket.emit("unauthenticated")` fires (signature failures route to unauthenticated, NOT auth_error — operators can't act on signature failures).
- **B-SRV-3**: Given a connection with valid `device_id` but `verifyIngestClaims` returns `{ kind: "scope_fail" }`, when `buildIngestServer` runs, then `socket.emit("auth_error", { error: "forbidden_scope" })` fires (scope failures are actionable — wrong scope is fixable by the operator).
- **B-SRV-4**: Given a connection with valid `device_id` but `verifyIngestClaims` returns `{ kind: "sub_fail" }` (token's `sub` doesn't match the URL `device_id`), when `buildIngestServer` runs, then `socket.emit("auth_error", { error: "device_id_mismatch" })` fires.
- **B-SRV-5**: Given a valid connection, when `socket.on("frame", raw)` fires, then `processFrame` is called with `deviceId = urlDeviceId`, the wrapped `socket.emit` + `socket.disconnect` shims, and `getIngestHooks()`.
- **B-SRV-6**: Given `processFrame` throws, when the `.catch` handler runs, then `socket.emit("internal_error", { error: "internal_error" })` fires, `socket.disconnect(true)` is called, and `console.error("ingest: processFrame threw", err)` logs the error.
- **B-SRV-7**: Given a connection to `/ingest/dashboard` with valid session token, when `handleSubscriberConnection` runs, then `socket.join(SUBSCRIBER_ROOM)` is called and the return is `true`.
- **B-SRV-8**: Given a connection to `/ingest/dashboard` with no `auth.token`, when `handleSubscriberConnection` runs, then `socket.emit("unauthenticated")` fires, `socket.disconnect(true)` is called, the return is `false`, and the room is NOT joined.
- **B-SRV-9**: Given a connection to `/ingest/dashboard` with invalid session JWT, when `handleSubscriberConnection` runs, then `socket.emit("unauthenticated")` fires, the return is `false`.
- **B-SRV-10**: Given the `SUBSCRIBER_ROOM = "readings:latest"` constant in subscriber.ts and the `READINGS_LATEST_ROOM = "readings:latest"` constant in frame.ts, both strings are identical (load-bearing lockstep — the subscriber must join the same room the broadcaster emits to).

### Hooks (hooks.ts)

- **B-HOOK-1**: Given the no-op default, when `getIngestHooks()` is called, then it returns `{ onRuleEvaluation, onAlertEmission, onStateMachineUpdate, onAuditAppend }` all stubbed to no-op async.
- **B-HOOK-2**: Given `NOOP_HOOKS.onRuleEvaluation(input)`, it returns `Promise<readonly BreachResult[]>` resolving to `EMPTY_BREACH_RESULTS` (frozen empty tuple).
- **B-HOOK-3**: Given `setIngestHooks(realHooks)`, when `getIngestHooks()` is called, then it returns `realHooks`.
- **B-HOOK-4**: Given `resetIngestHooks()`, when `getIngestHooks()` is called, then it returns the no-op default.

## Static / lint pins (Property/Required value)

- **S-1**: All 5 modified source files in `packages/api/src/ingest/` have NO `/** ... */` block opening longer than 7 lines.
- **S-2**: No file in `packages/api/src/ingest/` contains the string `F-P` (fix-history markers removed).
- **S-3**: No file in `packages/api/src/ingest/` contains a line reference of the form `\w+\.ts:\d+` (cross-file line refs removed).
- **S-4**: No file in `packages/api/src/ingest/` contains `Story 2.2`, `Story 2.3`, `Story 2.6`, `Story 3.2`, `Story 3.5`, or `Story 3.7` codes (story-jargon in source removed; the spec is the canonical record).
- **S-5**: No file in `packages/api/src/ingest/` contains `ADR 0013`, `AR-12`, `I-3`, `I-4`, `I-9` (architecture-doc codes removed from source).
- **S-6**: The `eslint-disable complexity` comment in `frame.ts` is preserved exactly (load-bearing for the 10-case `dispatchStep` switch; the lint config's `complexity: 10` cap is the contract pin).
- **S-7**: `frame.ts`'s `default: never` exhaustive check at the end of `dispatchStep`'s switch is preserved (the `never` type-pinning catches new `PROCESSING_ORDER` entries that aren't wired to a handler).
- **S-8**: `pnpm tsc -b` runs green on `packages/api`.
- **S-9**: `pnpm eslint src/ingest` runs green (no complexity violations, no param-reassign violations).

## Behaviour / Must-NOT (negative pins)

- **N-1**: When `processFrame` is called with a malformed frame, it MUST NOT persist the frame or broadcast to any room (the `bad_request` exit is terminal).
- **N-2**: When `processFrame` is called with a stale frame, it MUST NOT persist the frame or broadcast; it MUST emit `stale_frame` with `age_seconds` and soft-disconnect (the device can decide whether to reset its clock).
- **N-3**: When `processFrame` is called with a frame that hits the rate limit, it MUST emit `rate_limited` with `retry_after_seconds` and hard-disconnect (`disconnect(true)`) so the device backs off.
- **N-4**: When `PerDeviceRateLimiter.tryAccept` returns `{ ok: false }`, it MUST NOT update `lastAcceptedAtMs[deviceId]` — anchoring the window to the LAST accepted frame is the load-bearing fairness invariant.
- **N-5**: When `PerDeviceSequence.observe` returns `{ outcome: "reorder" }`, it MUST NOT update `lastSeen[deviceId]` — the historical ordering is authoritative.
- **N-6**: When `buildIngestServer` runs with `verifyIngestClaims` returning `{ kind: "sig_fail" }` or `{ kind: "aud_fail" }`, it MUST emit `unauthenticated` (NOT `auth_error`) — operators cannot act on signature / audience failures; those are "we didn't issue this" and require device-side re-issuance.
- **N-7**: When `handleSubscriberConnection` runs with an invalid session token, it MUST emit `unauthenticated` and MUST NOT join the `readings:latest` room.
- **N-8**: When `processFrame` throws an unhandled error inside `stepValidate`/`stepRateCheck`/etc., the `.catch` in `server.ts` MUST emit `internal_error`, hard-disconnect, and `console.error` the throw — NO unhandled promise rejections may escape to Node's `unhandledRejection` handler.
- **N-9**: When `stepPersist` is given a successfully-persisted frame, the subsequent `stepSocketBroadcast` MUST emit to BOTH `device:<deviceId>` and `readings:latest` rooms — the per-device emit is preserved for any per-device watcher (e.g. an Operator /incidents/:id drilldown) and the broadcast emit covers the dashboard.
- **N-10**: When `stepSeqDropCheck` detects a drop (`dropCount > 0`), the audit hook MUST fire with `{ drop_count, last_seq }` (camelCase `drop_count`, snake_case `last_seq` — the audit-row contract pins this exact shape).

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/ingest
cd packages/api && npx vitest run src/ingest
```

Existing specs (must stay green):

- `frame.spec.ts` (PROCESSING_ORDER ordering + per-step contracts — load-bearing)
- `server.spec.ts` (Socket.IO boot + frame delivery + 4-way failure-mode differentiation)
- `subscriber.spec.ts` (subscriber decision logic + room join)
- `subscriberSocket.spec.ts` (full socket boot + room join + no-frame-listener)
- `rateLimit.spec.ts` (1 frame / 2s throttle + retry_after)
- `sequence.spec.ts` (accept / reorder / drop / FIRST_FRAME)

The contract surfaces verified here are load-bearing for downstream consumers:

- `processFrame` → simulator scenarios + `/api/ingest/{device_id}` socket endpoint
- `PerDeviceRateLimiter` + `PerDeviceSequence` → ingested-frame pipeline ordering
- `READINGS_LATEST_ROOM` (`frame.ts`) + `SUBSCRIBER_ROOM` (`subscriber.ts`) → web dashboard single-socket subscription
- `IngestHooks` → Epic 3 rules engine + Epic 4 alert emission + Epic 5 audit pipeline
- `verifyIngestClaims` failure-mode differentiation → device / simulator error envelopes
