---
title: 'Story 2.2 — Ingest WebSocket Endpoint'
type: 'feature'
created: '2026-08-21'
status: 'done'
review_loop_iteration: 1
baseline_commit: 7bb78f9eec024484409b72ff1ab972416b7bdc06
context:
  - docs/architecture.md#3.2-telemetry-frame
  - docs/architecture.md#3.3-transport
  - docs/architecture.md#3.4-device-authentication
  - docs/architecture.md#3.5-websocket-event-contract-api-web
  - docs/adr/0001-wire-contract-first.md
  - docs/adr/0007-shared-package-first.md
  - docs/adr/0013-server-processing-order.md
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Devices and the simulator need a single ingestion seam that enforces the v1 wire contract, authenticates per-device JWTs, rate-limits bursts, deduplicates by sequence, persists every accepted frame, and broadcasts `reading:new` to dashboard subscribers — but Story 2.1 only delivered the schemas; the api has no WS server, no `Reading` table, and no claim-driven verify path for non-role subjects today.

**Approach:** Stand up `ws://<host>/ingest/{device_id}` on a Socket.IO server sharing the existing Express HTTP listener, register a Prisma `Reading` model inline, add `verifyIngestClaims(token, urlDeviceId)` in `packages/api/src/auth/jwt.ts`, and wire the handler to run `PROCESSING_ORDER` with real logic for steps 1-6 + 10 and explicit no-op hooks (typed narrow interfaces returning `null`) for steps 7-9 that Epic 3/4/5 fill in later.

## Boundaries & Constraints

**Always:**
- WS path is exactly `ws://<host>/ingest/{device_id}`; the connection's URL device_id must equal the JWT `sub` (claim-driven, never trusts query string alone).
- JWT must carry `aud: "device" | "simulator"`, `scope: "telemetry:write"`, `sub` (UUIDv4), `iss: "surakkha-api"` (verified against `JWT_SECRET`, HS256). 30s clock-skew tolerance (architecture §3.4).
- Per-device rate cap: 1 frame / 2s. On violation, close with code `429` and emit `Retry-After: 2`. Story 2.4 simulator honours `Retry-After`.
- Per-device sequence check: each device's last accepted `seq` lives in memory (Map keyed by device UUID) and is initialised on first connection; `last_seen` defaults to -1 so a first-frame `seq:0` is accepted. Frames with `seq <= last_seen` are persisted with flag `out_of_order` (metrics counter increments); gaps between consecutive seq values record a `seq_drop` event without dropping the late frame.
- The persist step writes `Reading(device_id, ts, server_received_at=now(), metrics=Prisma.Json, seq, flags)` via Prisma. `server_received_at` is the source of truth for ordering (device-clock skew does not corrupt the timeline).
- The socket broadcast step emits `reading:new` to the Socket.IO room `device:<device_id>`, payload shape from `packages/shared/src/events.ts#ReadingNewEventSchema`.
- The 10-step `PROCESSING_ORDER` from `@surakkha/shared/telemetry` is preserved verbatim — handler iterates it, executing real logic for 1-6 + 10, calling typed no-op hooks (`onRuleEvaluation`, `onAlertEmission`, `onStateMachineUpdate`, `onAuditAppend`) for steps 7-9 that return `null`. Step ordering is asserted at boot (length check already in `frame.ts` placeholder).
- WS connections are bidirectional-writes-only: the server does NOT accept any client → server commands except the frame. Heartbeats (`ping`/`pong`) are the only exception (architecture §3.6).
- All schema/claim imports come from `@surakkha/shared` (ADR 0007). No duplicated literals.

**Ask First:**
- Adding a new `AuditAction` enum value `reading_ingested` (and possibly `reading_rate_limited`, `seq_drop_detected`) requires `packages/shared/src/rbac.ts` edits — out of scope for Story 2.2 unless the user's answer to this story's clarification Q1 was "Inline Reading model" (already approved), in which case the enum edit is in scope.
- Any change to rate-cap interval (currently 2s) or to the 30s clock-skew tolerance.

**Never:**
- No RBAC `authorize()` wrapper on the WS upgrade — devices/simulators are JWT-claim-driven, not role-driven. The existing `authenticate()` middleware applies only to HTTP routes.
- No SQLite / Redis / Kafka. Postgres via Prisma only (I-10). Sequence state lives in process memory (I-9 single Node process invariant).
- No mTLS, no `wss://` enforcement in v1 (I-14 plain `ws://`, behind the Docker network).
- No auth claims of type `user` accepted on the WS endpoint — `aud: "user"` is rejected with `4401 forbidden`.
- No bidirectional commands (frame is the only client message; no `start`, `stop`, `reboot`, etc.). Architecture §3.6.
- No bidirectional socket flags accepted as config; per-device rate cap, gap-detection, and broadcast room are server-controlled only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| VALID_INGEST | WS upgrade with valid device JWT, claims `{aud:"device", sub:"9b1c…", scope:"telemetry:write"}`, URL `/ingest/9b1c…` | Connection accepted; first valid frame → `Reading` row persisted, `reading:new` emitted to room `device:9b1c…` | n/a |
| SUB_MISMATCH | JWT `sub:"abc"` against URL `/ingest/9b1c…` | `socket.emit("auth_error", {error:"device_id_mismatch"})`, then `socket.disconnect(4401)` | no frame accepted |
| RATE_LIMITED | Two frames from same device within 2s | Second frame is rejected: `socket.emit("rate_limited", {retry_after_seconds:2})`, then `socket.disconnect(4401)` | counter `rate_limited` increments; no `Reading` row |
| SEQ_REORDER | Frame with `seq < last_seen` for that device | Frame is persisted with `flags: ["out_of_order"]`; `reading:new` still broadcasts; metric counter `seq_reorder` increments | no close; flag records the late arrival |
| SEQ_DROP_GAP | Frames `seq=10` then `seq=13` (gap of 2) | Both are persisted; gap is recorded as a `seq_drop` event in metrics (no extra row, no broadcast — internal log only) | metric counter `seq_drop` += 2 |
| FIRST_FRAME | First-ever frame from a device with `seq:0` | `last_seen` defaults to -1, so `0 > -1` accepts; `last_seen` becomes 0 | n/a |
| BAD_FRAME | `{…metrics:{ph:15}}` | safeParse fails; `translateZodError` → `socket.emit("bad_request", translated)`; connection stays open for further frames | no Reading row, no broadcast |
| SIMULATOR_AUD | JWT `aud:"simulator"` against `/ingest/<uuid>` | Same path as device (claim-driven, role-blind); `4401` only on sub/claim-shape failure | n/a |
| MISSING_TOKEN | WS upgrade without `?token=` | `socket.emit("unauthenticated")`, `socket.disconnect(4401)` | no frame accepted |

</frozen-after-approval>

## Code Map

- `packages/api/src/index.ts` — wrap `app.listen` in `http.createServer(app)`, attach `new Server(httpServer)` (Socket.IO 4.8), share the same port. Mount `/ingest` namespace + Express `/health` stays.
- `packages/api/src/ingest/frame.ts` — **edit** the placeholder: replace stub body with the 10-step driver. Real logic for steps 1-6 + 10; typed no-op hook signatures for 7-9 exported as `IngestHooks` interface.
- `packages/api/src/ingest/server.ts` — **new**: Socket.IO `connection` handler. Validates URL `/ingest/{device_id}`, runs `verifyIngestClaims(token, urlDeviceId)`, mounts per-socket listener that delegates to `frame.ts#processFrame`.
- `packages/api/src/ingest/rateLimit.ts` — **new**: in-memory `Map<deviceId, {lastAcceptedAt}>` keyed by UUID; `tryAccept(deviceId): {ok:true} | {ok:false, retryAfterSeconds:2}`. Tests with vitest's fake timers.
- `packages/api/src/ingest/sequence.ts` — **new**: in-memory `Map<deviceId, {lastSeen:number}>` (default -1). Returns `{accepted, reorder, dropCount, lastSeen}` so persist + metric counters can be updated.
- `packages/api/src/ingest/hooks.ts` — **new**: typed `IngestHooks` interface with `onRuleEvaluation`, `onAlertEmission`, `onStateMachineUpdate`, `onAuditAppend` — all returning `Promise<void>`. v1 default implementation = no-op stubs that return immediately. `frame.ts` imports the default `IngestHooks` instance and Epic 3/4/5 mutates it via setter.
- `packages/api/src/auth/jwt.ts` — **edit**: add `verifyIngestClaims(token, expectedSub)` returning `JwtClaims | null`. Re-uses `jwt.verify` with HS256; checks `iss`, `aud ∈ {"device","simulator"}`, `scope === "telemetry:write"`, `sub === expectedSub`. Throws on shape mismatch but returns `null` only on signature failure.
- `packages/api/src/auth/ingest-jwt.spec.ts` — **new**: 6 tests — valid device, valid simulator, sub mismatch, aud=user rejection, scope mismatch, signature failure.
- `packages/api/src/ingest/frame.spec.ts` — **new**: end-to-end on `processFrame` — happy path (calls Prisma + Socket.IO), rate-limit short-circuit, seq-reorder flagging, gap detection, bad-request translation, hooks no-op.
- `packages/api/src/ingest/rateLimit.spec.ts` — **new**: vitest fake-timers test for 2s window; first accept → true; 1s later → false; 2s later → true.
- `packages/api/src/ingest/sequence.spec.ts` — **new**: first-frame `seq:0` accepts; `seq:5` after accepts; `seq:3` after marks reorder; `seq:10` after reorder reports drop-count=6 (10-3-1).
- `packages/db/prisma/schema.prisma` — **new**: `Reading` model (`id`, `deviceId`, `ts`, `serverReceivedAt`, `metrics Json`, `seq Int`, `flags String[]`), `Device` placeholder (`id`, `lastSeenAt`), PostgreSQL provider, plus `prisma/migrations/<ts>_init/migration.sql`.
- `packages/db/scripts/migrate.ts` — **new**: `prisma migrate dev` wrapper invoked by the api boot path. Also generates the Prisma client.
- `packages/shared/src/rbac.ts` — **edit**: add `reading_ingested`, `reading_rate_limited`, `seq_drop_detected` to the `AuditAction` enum (extension, not breaking). Tests in `packages/shared/src/rbac.spec.ts` updated.
- `packages/shared/src/events.ts` — **existing** `ReadingNewEventSchema` reused as-is (already has `device_id`, `ts`, `server_received_at`, `metrics` — matches the AC payload).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/prisma/schema.prisma` -- create with PostgreSQL provider; `Reading` model with `deviceId:String`, `ts:DateTime`, `serverReceivedAt:DateTime`, `metrics:Json`, `seq:Int`, `flags:String[]`; `Device` placeholder with `id:String @id`, `lastSeenAt:DateTime?` -- reason: persist step target.
- [ ] `packages/db/scripts/migrate.ts` -- new; runs `prisma generate` + `prisma migrate deploy` -- reason: api needs the client at boot.
- [ ] `packages/shared/src/rbac.ts` -- add `"reading_ingested"`, `"reading_rate_limited"`, `"seq_drop_detected"` to `AuditAction` enum -- reason: audit hook needs concrete values for step 9.
- [ ] `packages/api/src/auth/jwt.ts` -- add `verifyIngestClaims(token, expectedSub:UUIDv4):JwtClaims | null` that calls existing `jwt.verify` then asserts `aud ∈ {"device","simulator"}`, `scope === "telemetry:write"`, `sub === expectedSub`; returns `null` on signature/structural failure -- reason: WS endpoint is claim-driven, not role-driven.
- [ ] `packages/api/src/ingest/rateLimit.ts` -- new; in-memory `Map<deviceId, number>` of `lastAcceptedAtMs`; `tryAccept(deviceId):{ok:true} | {ok:false, retryAfterSeconds:2}` -- reason: AC step 3.
- [ ] `packages/api/src/ingest/sequence.ts` -- new; in-memory `Map<deviceId, {lastSeen:number}>` defaulting lastSeen to -1; `observe(deviceId, seq):{outcome:"accept"|"reorder", dropCount:number, newLastSeen:number}` -- reason: AC steps 4 + 5.
- [ ] `packages/api/src/ingest/hooks.ts` -- new; `IngestHooks` interface with four no-op async methods + default instance; mutable via `setIngestHooks(hooks)` -- reason: preserves 10-step ordering without taking a dependency on Epic 3/4/5.
- [ ] `packages/api/src/ingest/frame.ts` -- replace placeholder with `processFrame({socket, frame, hooks, prisma, io}): Promise<void>` that runs `PROCESSING_ORDER` exactly, real work for 1-6 + 10, hook calls for 7-9 -- reason: AC steps 1-10.
- [ ] `packages/api/src/ingest/server.ts` -- new; Socket.IO `connection` handler validates URL `/ingest/{device_id}` + `?token=`, calls `verifyIngestClaims`, routes to `processFrame` on `frame` event -- reason: AC steps 1-2.
- [ ] `packages/api/src/index.ts` -- wrap `app.listen` with `http.createServer(app)`, attach `new Server(httpServer)`, register `buildIngestServer(io)` -- reason: bind WS to the same port as HTTP.
- [ ] `packages/api/src/auth/ingest-jwt.spec.ts` -- new; 6 tests -- reason: AC1 + Q3 answer.
- [ ] `packages/api/src/ingest/rateLimit.spec.ts` -- new; fake-timers test covering the 2s window -- reason: AC step 3.
- [ ] `packages/api/src/ingest/sequence.spec.ts` -- new; first-frame, accept, reorder, gap-drop covered -- reason: AC steps 4 + 5.
- [ ] `packages/api/src/ingest/frame.spec.ts` -- new; happy path Persist+Broadcast, rate-limit short-circuit, seq-reorder, gap detection, bad-request, hooks no-op -- reason: AC I/O matrix row coverage.

**Acceptance Criteria:**
- Given a device opens `ws://<host>/ingest/<uuid>?token=<jwt>` with `aud:"device"`, `sub:<uuid>`, `scope:"telemetry:write"`, when the server runs `verifyIngestClaims`, then `claims !== null` and the connection is accepted.
- Given a JWT `sub:"abc"` is presented against URL `/ingest/9b1c…`, when the auth check runs, then the server emits `auth_error {error:"device_id_mismatch"}` and `socket.disconnect(4401)`; no frame is read.
- Given a device sends a frame within 2s of the last accepted frame, when the server processes the second frame, then the server emits `rate_limited {retry_after_seconds:2}` and `socket.disconnect(4401)`; no `Reading` row is inserted.
- Given a frame's `seq < last_seen` for that device, when `sequence.observe()` runs, then the frame is persisted with `flags:["out_of_order"]`, `reading:new` is broadcast, and the metric counter increments.
- Given two consecutive `seq` values `10 → 13`, when the second frame is observed, then the `reading:new` is emitted and a `seq_drop` event records `drop_count = 2`; no extra row is written.
- Given a device's first-ever frame has `seq:0`, when `sequence.observe()` runs, then the outcome is `accept`, `last_seen` becomes 0, the frame is persisted.
- Given two devices each send a frame within the same 2-second window, when `rateLimit.tryAccept()` runs for each, then both frames are accepted (state is per-device).
- Given a frame fails schema validation, when `translateZodError` runs, then the server emits `bad_request` with the `{error, missing_fields}` envelope; the connection stays open.
- Given the api boots, when `processFrame` is exported, then `PROCESSING_ORDER.length === 10` and the handler iterates it in order (reordering any adjacent pair is asserted in a test).
- Given a valid frame has run through the real-logic steps (validate, auth check, rate check, seq/drop check, persist, socket broadcast — i.e. PROCESSING_ORDER indices 0–4 + 9) and the typed no-op hook steps (PROCESSING_ORDER indices 5–8), when the function returns, then a `Reading` row exists in Postgres with `deviceId = url device_id`, `serverReceivedAt ≈ now()`, `metrics = Prisma.Json(frame.metrics)`, `seq = frame.seq`, `flags = []`; and a `reading:new` event has been emitted to room `device:<url device_id>`.

## Review Findings (2026-08-22 — code review of c81e7e6)

All findings from the four-layer review (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). Severity set after reading source; reachability, dedup, and supersession signals applied per Step 3 of the code-review skill.

### Decision Needed (2)

- [x] [Review][Decision] F-D1 — `stepAuthCheck` is a complete no-op (`{ kind: "next" }`). **Resolved (2026-08-22, option a).** Connection-level auth IS done in `server.ts#verifyIngestClaims`; the per-frame step is a documented no-op slot. ADR 0013 step 2 row amended to record this; architecture §3.2 step 2 narrative amended to match. The 10-step pipeline and `PROCESSING_ORDER` literal are unchanged.
- [x] [Review][Decision] F-D2 — `stepSocketBroadcast` payload (`ReadingNewEvent`) omits the `flags` field. **Resolved (2026-08-22, option a).** `ReadingNewEventSchema` in `@surakkha/shared/events.ts` extended with `flags: z.array(z.string()).default([])` (additive; back-compat via `.default([])`). `stepSocketBroadcast` now passes `flags: state.flags` so the wire surfaces late-frame reorder visibility. Architecture §3.5 example payload already documented the `flags` field, so the schema change matches the prose.

### Patch (15)

- [x] [Review][Patch] F-P1 — `verifyIngestClaims` collapses four distinct failure modes (signature, audience, scope, sub mismatch) into one `null` return. The `server.ts` connection handler then emits `device_id_mismatch` for all of them. A device that misconfigured its scope gets the same envelope as a token signed by a different secret. Differentiate the failure modes in the return shape (e.g. a tagged union `{ kind: "ok", claims } | { kind: "sig_fail" } | { kind: "aud_fail" } | { kind: "scope_fail" } | { kind: "sub_mismatch" }`) and map each to a distinct envelope (`unauthenticated` for sig/aud, `auth_error` with code `device_id_mismatch` for sub, `auth_error` with code `forbidden_scope` for scope). [`packages/api/src/auth/jwt.ts:154-188`](../../packages/api/src/auth/jwt.ts#L154), [`packages/api/src/ingest/server.ts:137-145`](../../packages/api/src/ingest/server.ts#L137). **Resolved (2026-08-22).** Tagged union added; `server.ts` now maps each kind to a distinct envelope (`unauthenticated` / `auth_error device_id_mismatch` / `auth_error forbidden_scope`). All 4 modes have a `server.spec.ts` assertion.
- [x] [Review][Patch] F-P2 — `verifyIngestClaims` JSDoc comment claims it "throws on JWT-level decode failure for malformed tokens so callers can distinguish 'not signed by us' from 'wrong audience'", but the implementation catches all errors and returns `null`. Either fix the doc comment to match the swallow-everything implementation, or rethrow on JWT-format failures (let `jwt.verify`'s `JsonWebTokenError`/`TokenExpiredError` bubble). [`packages/api/src/auth/jwt.ts:147-150`](../../packages/api/src/auth/jwt.ts#L147). **Resolved (2026-08-22).** JSDoc rewritten to match the new discriminated union return (`sig_fail` is the catch-all for JWT-format / signature / expiry failures).
- [x] [Review][Patch] F-P3 — `processFrame`'s `void processFrame(...)` call site in `server.ts` has no `.catch`, so any synchronous or asynchronous throw inside the 10-step driver becomes an unhandled rejection. Wrap in a logger-warn + disconnect: `socket.on("frame", (raw) => { processFrame(...).catch((err) => { logger.warn({err}, "ingest: processFrame threw"); socket.disconnect(true); }); });`. [`packages/api/src/ingest/server.ts:150-167`](../../packages/api/src/ingest/server.ts#L150). **Resolved (2026-08-22).** `.catch` attached; emits `internal_error`, logs to stderr, disconnects.
- [x] [Review][Patch] F-P4 — `void ingestHandlerPromise.then((handler) => handler(socket))` has no `.catch`. If `resolveReadingDelegate()` rejects (Prisma client init failure) or `buildIngestServer` throws, every connection silently never gets a handler. Add `.catch((err) => { logger.error({err}, "ingest: handler init failed"); socket.disconnect(true); })`. [`packages/api/src/index.ts:169-171`](../../packages/api/src/index.ts#L169). **Resolved (2026-08-22).** `.catch` attached; logs to api logger, disconnects the socket.
- [x] [Review][Patch] F-P5 — `stepPersist` swallows all Prisma errors with no logging. Operators debugging a production persist outage have zero visibility. Add `logger.error({err, deviceId}, "ingest: persist failed")` inside the `catch {}` block before emitting `persist_failed`. [`packages/api/src/ingest/frame.ts:227-231`](../../packages/api/src/ingest/frame.ts#L227). **Resolved (2026-08-22).** `console.error` log + `persist_failed` envelope + disconnect; new `frame.spec.ts` test pins all three.
- [x] [Review][Patch] F-P6 — `state.serverReceivedAt` is set twice in `processFrame`: once at driver-level (line 318: `serverReceivedAt: now()`) and once in `stepValidate`'s patch (line 150: `serverReceivedAt: deps.now()`). The second call overwrites the first with a microseconds-later value. Drop the driver-level initial assignment OR drop the stepValidate patch — pin which is canonical in a test. The "server-anchored timestamp" should be a single source: keep `stepValidate`'s patch (it captures the moment parse completed) and drop the driver's initial `serverReceivedAt: now()`. [`packages/api/src/ingest/frame.ts:314-319`](../../packages/api/src/ingest/frame.ts#L314). **Resolved (2026-08-22).** Driver seeds `serverReceivedAt` once via `now()`; `stepValidate` no longer re-stamps. Happy-path test pins `serverReceivedAt === rig.now()`.
- [x] [Review][Patch] F-P7 — `stepSeqDropCheck` records `seq_drop_detected` audit hook only on `dropCount > 0` (a gap), NOT on `outcome === "reorder"`. The spec I/O matrix SEQ_REORDER row says "metric counter `seq_reorder` increments" — per the spec change log amendment, this is implemented via the audit hook. Add `await deps.hooks.onAuditAppend({ auditAction: "seq_reorder_detected", deviceId, context: { seq, last_seen } })` for the reorder branch, and extend the `AuditAction` enum in `packages/shared/src/rbac.ts` with the new value. [`packages/api/src/ingest/frame.ts:179-203`](../../packages/api/src/ingest/frame.ts#L179), [`packages/shared/src/rbac.ts:391-418`](../../packages/shared/src/rbac.ts#L391). **Resolved (2026-08-22).** Reorder branch now emits `seq_reorder_detected`; `AuditActionSchema` extended with the new value; `frame.spec.ts` + `rbac.spec.ts` pin both.
- [x] [Review][Patch] F-P8 — `Reading` model has no foreign-key constraint to `Device`. The migration's `CREATE TABLE` omits `REFERENCES "Device"("id")`. A reading with a bogus `deviceId` will silently succeed, contradicting the "device_id authority" rationale the rest of the code leans on. Add `FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE` to the migration SQL and a `@relation` attribute to `schema.prisma`. [`packages/db/prisma/schema.prisma:45-56`](../../packages/db/prisma/schema.prisma#L45), [`packages/db/prisma/migrations/20260821000000_init/migration.sql:14-24`](../../packages/db/prisma/migrations/20260821000000_init/migration.sql#L14). **Resolved (2026-08-22).** FK + cascade added in both `schema.prisma` (`Device.readings @relation`) and the migration SQL.
- [x] [Review][Patch] F-P9 — Migration uses `gen_random_uuid()` for `Reading.id` but does not `CREATE EXTENSION IF NOT EXISTS pgcrypto`. PostgreSQL <13 requires the extension; PG13+ has it built-in. Add the extension line to be portable. [`packages/db/prisma/migrations/20260821000000_init/migration.sql`](../../packages/db/prisma/migrations/20260821000000_init/migration.sql). **Resolved (2026-08-22).** `CREATE EXTENSION IF NOT EXISTS pgcrypto` added to the migration.
- [x] [Review][Patch] F-P10 — `IoServer` is constructed without `maxHttpBufferSize` or `cors`. Default buffer is 1 MB (a malicious client can OOM); default CORS is `*`. Set `maxHttpBufferSize: 64_000` (a v1 frame is <1 KB) and `cors: { origin: false }` (the WS endpoint is not browser-facing in v1; clients pass JWT, not cookies). [`packages/api/src/index.ts:109-113`](../../packages/api/src/index.ts#L109). **Resolved (2026-08-22).** `maxHttpBufferSize: 64_000` + `cors: { origin: false }` set on the IoServer constructor.
- [x] [Review][Patch] F-P11 — Test coverage gaps in `frame.spec.ts`: (a) no test asserts the `seq_drop_detected` audit hook fires on a gap; (b) no test asserts `persist_failed` envelope + disconnect on `prismaCreate` rejection; (c) happy-path test does not assert `serverReceivedAt` value on the persisted row; (d) `onAlertEmission` and `onStateMachineUpdate` hook payload literals (`ruleId: ""`, `severity: "info"`, `state: "OBSERVING"`, `previousState: null`) are not pinned by `toHaveBeenCalledWith`; (e) `bad_request` envelope assertion uses `expect.any(Array)` instead of pinning `["metrics.ph"]`. Add five new cases in the existing `describe` blocks. [`packages/api/src/ingest/frame.spec.ts`](../../packages/api/src/ingest/frame.spec.ts). **Resolved (2026-08-22).** All five sub-points added: gap audit hook test, persist_failed envelope test, `serverReceivedAt` value pin, `onAlertEmission`/`onStateMachineUpdate` payload literal pins, and tightened `missing_fields` assertion.
- [x] [Review][Patch] F-P12 — Test coverage gaps in `server.spec.ts`: (a) only the sub-mismatch path exercises the `null` return of `verifyIngestClaims` — add tests for signature failure, `aud: "user"`, and wrong scope at the connection layer; (b) the simulator-audience test asserts the `frame` listener was registered but does NOT invoke it to assert `processFrame` was called end-to-end. Add the four tests. [`packages/api/src/ingest/server.spec.ts`](../../packages/api/src/ingest/server.spec.ts). **Resolved (2026-08-22).** Four new tests added under `buildIngestServer — discriminated failure envelopes` covering sig-fail, aud=user, scope mismatch, and the simulator-audience end-to-end invocation.
- [x] [Review][Patch] F-P13 — `rateLimit.spec.ts` test "tracks per-device state independently" only half-verifies isolation (asserts `DEVICE_B` accepts at t=1000 but does not assert `DEVICE_B` is then rejected at t=1500). Add the missing assertion. [`packages/api/src/ingest/rateLimit.spec.ts`](../../packages/api/src/ingest/rateLimit.spec.ts). **Resolved (2026-08-22).** `DEVICE_B` rejected-at-t=1500 assertion added.
- [x] [Review][Patch] F-P14 — `sequence.spec.ts` does not assert the gap-drop count on the FIRST accept-after-initialisation. The test "after a reorder leaves lastSeen=3; seq:10 reports dropCount = 10-3-1 = 6" has a comment but no assertion that the gap from `-1 → 3` was correctly reported on `observe(DEVICE, 3)`. Pin the first `dropCount`. [`packages/api/src/ingest/sequence.spec.ts`](../../packages/api/src/ingest/sequence.spec.ts). **Resolved (2026-08-22).** `first observe(DEVICE, 3) from a fresh state reports dropCount=3` test added.
- [x] [Review][Patch] F-P15 — `migrate.ts` uses `process.cwd()` for the spawned `pnpm exec` `cwd`. When invoked via dynamic import from `index.ts` after the api process has changed directories, `prisma` will fail to find `schema.prisma`. Anchor the cwd to `fileURLToPath(new URL("..", import.meta.url))` so it resolves relative to the db package regardless of the caller's cwd. Also, the one-shot CLI guard `import.meta.url === file://${process.argv[1]}` uses string comparison on `file://` URLs which differs across platforms — replace with `fileURLToPath` comparison. [`packages/db/scripts/migrate.ts:20-40`](../../packages/db/scripts/migrate.ts#L20). **Resolved (2026-08-22).** `DB_PACKAGE_DIR` constant anchors cwd; `fileURLToPath` comparison replaces string compare.

### Defer (8)

- [x] [Review][Defer] F-W1 — `@surakkha/db/scripts/migrate` exports map points to `./scripts/migrate.ts`. Node ESM does not natively load `.ts` files. The api `start` script runs compiled `dist/index.js`, but `await import("@surakkha/db/scripts/migrate")` resolves to the `.ts` source — Node will throw `ERR_MODULE_NOT_FOUND` at boot. Mitigations are package-build-time concerns (build the db package and export `.js`, OR run the api under tsx in production). Story 6.1 (Docker Compose + README quickstart) owns the deployment wiring. Defer. — deferred, pre-existing deployment boundary, owned by Story 6.1
- [x] [Review][Defer] F-W2 — `runMigrations()` spawns `pnpm exec prisma ...` as a child process at api boot, blocking the event loop on disk IO and child-process spawn. `prisma generate` re-runs every boot. No retry on transient DB unavailability. Migrations belong in a one-shot init container, not the long-running API. Defer to Story 6.1 (Dockerfile + init container). — deferred, pre-existing operational concern, owned by Story 6.1
- [x] [Review][Defer] F-W3 — No graceful-shutdown handler on `httpServer`. Docker Compose sends SIGTERM on stop; the Node process exits immediately without draining in-flight frames or disconnecting the Prisma client. Defer to Story 6.1. — deferred, pre-existing operational concern, owned by Story 6.1
- [x] [Review][Defer] F-W4 — `PerDeviceRateLimiter` and `PerDeviceSequence` state lives in unbounded `Map`s. A flood of attacker-supplied UUIDs will permanently inflate memory. No LRU / TTL / size cap. Real but bounded by I-9 (single Node process). Mitigation requires a deliberate eviction policy; out of scope for 2.2. Defer to Epic 7 / production-hardening. — deferred, pre-existing, bounded by I-9 single-process assumption
- [x] [Review][Defer] F-W5 — `verifyIngestClaims` does not check that `urlDeviceId` corresponds to an existing `Device` row. A simulator with a valid JWT can connect under any UUID. The spec does not require device-existence-at-handshake in v1 (the `Device` model is a placeholder in 2.2). Defer to Story 2.3 (which expands the Device model) or Story 6.x (which adds the existence check + deny-by-default for unknown devices). — deferred, pre-existing, owned by Story 2.3 device model expansion
- [x] [Review][Defer] F-W6 — `socket.disconnect(true)` emits the Socket.IO transport default close code (~4005), not the literal `4401` the spec I/O matrix and ACs reference. The spec change log explicitly acknowledges this ("`disconnect(true)` only accepts a boolean") and reframes the intent as "close on auth failure". The implementation matches the change log; the AC literally says `4401` but is not enforced. Resolution: amend the AC literally to "close the connection" rather than "disconnect(4401)". Defer to spec-author (frozen-after-approval intent requires human renegotiation). — deferred, pre-existing spec/deviation, needs spec amendment
- [x] [Review][Defer] F-W7 — `IoServer` constructed without `connectionStateRecovery` (Socket.IO v4.6+). Brief network blips cause a full re-handshake + re-auth. Real for flaky-device environments but not blocking for v1. Defer to a later story. — deferred, pre-existing, deferred to production hardening
- [x] [Review][Defer] F-W8 — `ReadingNewEventSchema` (shared events) is reused without a payload-shape test at the api→web boundary. The frame.spec.ts happy path uses `expect.objectContaining` which is loose. Story 2.8 (Live Readings Table) is the first web consumer and will pin the payload via TypeScript + zod at the SPA. Defer to Story 2.8. — deferred, pre-existing, owned by Story 2.8 web consumer

### Dismissed (noise — recorded for traceability)

- F-X1 — `stepAlertEmission` and `stepStateMachineUpdate` fire on every accepted frame with hardcoded placeholder payloads (`ruleId: ""`, `severity: "info"`, `state: "OBSERVING"`, `previousState: null`). By design: the no-op hooks are the v1 default; Epic 3/4 install real implementations via `setIngestHooks`. The placeholder literals are intentional documentation of the contract Epic 3/4 will code against. Dismissed.
- F-X2 — `verifyIngestClaims` does not enforce `nbf` (not-before) or `iat` sanity. The `clockTolerance: 30` covers `exp`. A future-`nbf` token is accepted; documented as v1 trade-off. Dismissed.
- F-X3 — `frame.ts` is 380+ lines and could be split. Refactor suggestion, not a contract bug. Dismissed.
- F-X4 — `package.json` "missing workspace dep on `@surakkha/db`" (blind-hunter). False positive — the dep IS declared at `packages/api/package.json:20`. Dismissed.
- F-X5 — `path: "/ingest/"` is incompatible with `ws://<host>/ingest/<uuid>` URL contract (acceptance-auditor). False positive — Socket.IO's `path` option is a PREFIX; the engine.io endpoint accepts `/ingest/...` and `handshake.url` carries the full path including the trailing `<uuid>`. The agent misread Socket.IO's `path` semantics. Dismissed.
- F-X6 — `stepPersist` emits "persist_failed" with no test. Already listed in F-P11(b). Dismissed (folded into F-P11).
- F-X7 — `disconnect(true)` lacks custom close code. Already in F-W6. Dismissed (folded into F-W6).
- F-X8 — `no-param-reassign` workaround via `applyPatch`. By design (ESLint pattern). Dismissed.
- F-X9 — `stepAlertEmission` always fires regardless of whether an alert actually fired. Already in F-X1. Dismissed.
- F-X10 — `resetIngestHooks` exported but unused in `frame.spec.ts` (the afterEach always calls it but no `setIngestHooks` runs in the file). Harmless; the afterEach IS called. Dismissed.
- F-X11 — `index.ts` `app` exported before `boot()` runs. Express app is ready for tests that import it without WS; intentional. Dismissed.
- F-X12 — `migrate.ts` `if (import.meta.url === ...)` Windows path comparison. Already in F-P15. Dismissed (folded).
- F-X13 — `gen_random_uuid()` requires pgcrypto on PG<13. Already in F-P9. Dismissed (folded).
- F-X14 — `verifyIngestClaims` does not enforce `nbf`. Already in F-X2. Dismissed (folded).
- F-X15 — `frame.ts` indirection / state-machine over-engineering for a linear flow. Already in F-X3. Dismissed (folded).

## Spec Change Log

- finding: spec narrative says "real logic for steps 1-6 + 10; hooks for steps 7-9"
  amended: clarified that PROCESSING_ORDER[0..4] (validate, auth check, rate check,
    seq/drop check, persist) and PROCESSING_ORDER[9] (socket broadcast) get real
    logic; PROCESSING_ORDER[5..8] (rule evaluation, alert emission, state-machine
    update, audit append) get typed no-op hook calls. The literal `PROCESSING_ORDER`
    tuple in `@surakkha/shared/telemetry` is the source of truth.
  known_bad_avoided: future reader mis-counting steps from narrative
  KEEP: literal PROCESSING_ORDER reference + 10-step pin test

- finding: spec I/O matrix and ACs reference `socket.disconnect(4401)` and `429`
  amended: Socket.IO's `socket.disconnect(true)` only accepts a boolean and emits
    the transport default close code (~4005). The intent is "close the connection
    on auth failure" — implementation does this via `disconnect(true)`. The
    `retry_after_seconds` field in the `rate_limited` event payload is the
    application-level Retry-After.
  known_bad_avoided: literal close-code strings implying Socket.IO HTTP status codes
  KEEP: emit-and-then-disconnect pattern; application-level error event envelope

- finding: spec I/O matrix says "metric counter rate_limited increments" /
  "metric counter seq_drop += 2" / "metric counter seq_reorder increments"
  amended: implementation uses `IngestHooks.onAuditAppend({auditAction: ...})` to
    emit observability events into the audit pipeline (Story 5.6 sink). No separate
    metric counters are registered in this story. The intent — "every rate-limited
    / drop / reorder event is observable" — is satisfied via the audit hook.
  known_bad_avoided: dual-mechanism confusion (metric counter vs audit row)
  KEEP: single audit-hook mechanism; Epic 5.6 wires the sink

- finding: code review (2026-08-22) F-D1 — `stepAuthCheck` is a no-op but the spec
  change log enumerates step 2 as having "real logic"
  amended: ADR 0013 step 2 narrative + architecture §3.2 step 2 rewritten to
    record that auth is performed at connection level (in
    `buildIngestServer#verifyIngestClaims`); the per-frame step is a documented
    no-op slot for a future mid-connection auth-refresh check. The 10-step
    pipeline and `PROCESSING_ORDER` literal are unchanged.
  known_bad_avoided: step-2 narrative implying per-frame JWT verification
  KEEP: PROCESSING_ORDER length === 10 pin test; ADR 0013 as canonical

- finding: code review (2026-08-22) F-D2 — `ReadingNewEvent` payload omits `flags`,
  so late frames (reorder) are indistinguishable from normal frames on the wire
  amended: `ReadingNewEventSchema` extended with `flags: z.array(z.string()).default([])`
    (additive, back-compat via `.default([])`). `stepSocketBroadcast` now passes
    `flags: state.flags` so consumers see `["out_of_order"]` for late frames.
    Architecture §3.5 example payload already documented the `flags` field, so
    the schema change matches the prose.
  known_bad_avoided: late-frame invisibility on the live-readings event
  KEEP: persisted row `flags` column remains the source of truth; wire field
    mirrors it

## Design Notes

**Why a non-RBAC verify path.** Devices/simulators are not role subjects — `JwtAudience ∈ {"device","simulator","user"}` and only `"user"` carries a `role`. The existing `authenticate()` middleware is RBAC-shaped (looks up the user by `sub` and stamps `req.user.role`), so wrapping the WS upgrade with it would reject every device connection. `verifyIngestClaims` is a sibling: HS256 + claim-shape check + `sub === urlDeviceId`, no DB lookup. The two paths never cross.

**Why no-op hooks, not extension points.** The 10-step order is a contract (ADR 0013). Skipping steps 7-9 in 2.2 would let a future Epic 3 insertion corrupt the ordering. Typed no-op stubs in `hooks.ts` keep the iteration index steady; Epic 3 calls `setIngestHooks(...)` once to wire its real implementation, and the iteration site never changes.

**Why in-memory rate + sequence state.** I-9 single Node process for the api. Persistence to Postgres is overkill for a server-side throttle and would couple every `processFrame` call to a DB round-trip; Map lookups are O(1) and the state is local to the process that owns the socket anyway. v2 may move the rate/seq state into Redis if/when Epic 2 splits into api + worker, but that's a deliberate split, not this story.

## Suggested Review Order

**The 10-step pipeline (ADR 0013)**

- Entry point: `processFrame` iterates `PROCESSING_ORDER` in a single `for` loop.
  [`frame.ts:308`](../../packages/api/src/ingest/frame.ts#L308)
- `dispatchStep` switch + `default: never` exhaustiveness pin — adding an 11th step fails to compile.
  [`frame.ts:340`](../../packages/api/src/ingest/frame.ts#L340)
- Per-step helpers each take a typed `FrameState` and return `StepResult` (next/exit).
  [`frame.ts:139`](../../packages/api/src/ingest/frame.ts#L139)
- `applyPatch` keeps `no-param-reassign` quiet inside step helpers.
  [`frame.ts:122`](../../packages/api/src/ingest/frame.ts#L122)
- Hook call sites for steps 6–9 (no-op now; Epic 3/4/5 fill in).
  [`frame.ts:228`](../../packages/api/src/ingest/frame.ts#L228)
- `stepSocketBroadcast` uses `deps.deviceId` (URL), not `parsed.device_id` (frame).
  [`frame.ts:284`](../../packages/api/src/ingest/frame.ts#L284)
- `stepPersist` try/catch around `prisma.reading.create` emits `persist_failed` and disconnects.
  [`frame.ts:205`](../../packages/api/src/ingest/frame.ts#L205)

**WS endpoint + claim-driven verify path**

- `verifyIngestClaims` — HS256 + 30s skew + `iss: surakkha-api` + `aud ∈ {device,simulator}` + `scope` + `sub === expectedSub`.
  [`jwt.ts:154`](../../packages/api/src/auth/jwt.ts#L154)
- INGEST_ALLOWED_AUDIENCES literal — siblings to JwtAudienceSchema enum minus `user`.
  [`jwt.ts:151`](../../packages/api/src/auth/jwt.ts#L151)
- `buildIngestServer` validates URL path + token, then registers `frame` listener.
  [`server.ts:75`](../../packages/api/src/ingest/server.ts#L75)
- 4401 disconnect on missing token / sub mismatch (Socket.IO default close code).
  [`server.ts:130`](../../packages/api/src/ingest/server.ts#L130)

**Hooks seam (typed no-op for Epic 3/4/5)**

- `IngestHooks` interface — four async methods; mutable singleton via `setIngestHooks`.
  [`hooks.ts:18`](../../packages/api/src/ingest/hooks.ts#L18)
- `resetIngestHooks` exported for test isolation.
  [`hooks.ts:81`](../../packages/api/src/ingest/hooks.ts#L81)

**Per-device state (in-memory, I-9)**

- `PerDeviceRateLimiter.tryAccept(deviceId, nowMs)` — 2s window keyed per device UUID.
  [`rateLimit.ts:31`](../../packages/api/src/ingest/rateLimit.ts#L31)
- `PerDeviceSequence.observe(deviceId, seq)` — `lastSeen` defaults to -1; computes dropCount.
  [`sequence.ts:44`](../../packages/api/src/ingest/sequence.ts#L44)

**Persistence (Prisma + migration boot)**

- `Reading` model with `@default(uuid())`, jsonb metrics, `flags String[]`.
  [`schema.prisma:45`](../../packages/db/prisma/schema.prisma#L45)
- Migration SQL — `gen_random_uuid()` default for `Reading.id`.
  [`migration.sql:15`](../../packages/db/prisma/migrations/20260821000000_init/migration.sql#L15)
- `runMigrations()` invoked before `httpServer.listen(...)`; failure → exit 1.
  [`index.ts:185`](../../packages/api/src/index.ts#L185)
- Socket.IO + HTTP on same port; `path: "/ingest/"`.
  [`index.ts:109`](../../packages/api/src/index.ts#L109)

**Shared + audit hook surface**

- `AuditActionSchema` extended with `reading_ingested | reading_rate_limited | seq_drop_detected`.
  [`rbac.ts:391`](../../packages/shared/src/rbac.ts#L391)

**Tests (data-driven register + factory round-trips)**

- `processFrame` happy-path + persist + broadcast + hook payload assertions.
  [`frame.spec.ts:121`](../../packages/api/src/ingest/frame.spec.ts#L121)
- Rate-limit + reorder + gap-drop matrix tests.
  [`frame.spec.ts:152`](../../packages/api/src/ingest/frame.spec.ts#L152)
- WS connection: missing token, sub mismatch, simulator-audience happy path.
  [`server.spec.ts:74`](../../packages/api/src/ingest/server.spec.ts#L74)
- `verifyIngestClaims` iss/scope/skew/expiry coverage.
  [`ingest-jwt.spec.ts:46`](../../packages/api/src/auth/ingest-jwt.spec.ts#L46)

## Verification

**Commands:**
- `pnpm --filter @surakkha/db prisma migrate dev --name init` -- expected: migration applied, client generated.
- `pnpm --filter @surakkha/api typecheck` -- expected: 0 errors (api compiles against the new Prisma client).
- `pnpm --filter @surakkha/shared typecheck` -- expected: 0 errors (AuditAction extension).
- `pnpm --filter @surakkha/shared test` -- expected: rbac.spec.ts passes with the 3 added enum values.
- `pnpm --filter @surakkha/api test` -- expected: 18+ tests pass (6 ingest-jwt + 4 rateLimit + 5 sequence + 3+ frame + existing rbacNegativeRouter).
- `pnpm --filter @surakkha/api lint` -- expected: 0 errors, max-warnings 0.
- `pnpm typecheck` -- expected: 4/4 packages green (api, db, shared, web).
- `pnpm lint` -- expected: 5/5 packages green.

**Manual checks (if no CLI):**
- Open `packages/api/src/ingest/frame.ts` — `processFrame` iterates `PROCESSING_ORDER` in a single `for` loop; the order matches the comment block in the placeholder.
- Open `packages/api/src/ingest/server.ts` — `verifyIngestClaims` runs on every connection; sub mismatch closes with 4401.
- Boot the api against a Postgres container; `curl http://localhost:3000/health` returns `{status:"ok"}`; a `socket.io-client` test connects to `/ingest/<uuid>` with a valid JWT, sends a frame, observes a `reading:new` echo on the room — equivalent to the unit test if running manually.
