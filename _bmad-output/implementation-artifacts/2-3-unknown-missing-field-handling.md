---
title: 'Story 2.3 — Unknown/Missing Field Handling'
type: 'feature'
created: '2026-08-22'
status: 'done'
context:
  - docs/architecture.md#3.2-telemetry-frame
  - docs/architecture.md#3.6-websocket-event-contract-api-web
  - docs/adr/0001-wire-contract-first.md
  - docs/adr/0007-shared-package-first.md
  - docs/adr/0013-server-processing-order.md
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.2 wired the WS endpoint to validate inbound frames and
stamp `server_received_at`, but the surface around *what counts as a bad
frame* is not yet pinned end-to-end. Today: missing required fields land in
the same `bad_request` envelope as out-of-range values, unknown top-level
keys are silently dropped (a future drift trap), and a frame whose
device-side `ts` is hours in the past is accepted and persisted — which
corrupts the canonical timeline operators triage from. The `flags` column
on `Reading` is `string[]` (no enum), so a typo'd flag is invisible until
ops queries break.

**Approach:** Lock the v1 contract in `@surakkha/shared/telemetry`:

1. `ReadingFlagSchema` — a typed `z.enum([...])` for the v1 flag set
   (`out_of_order`, `clock_skew_detected`, `rate_limited`); unknown flags
   are rejected at the type boundary so the persisted-row + wire-payload
   surface is statically known.
2. `STALE_FRAME_THRESHOLD_MS` (5 minutes — see *Design Notes* for why not
   24h) — frames whose `ts` is older than `now - threshold` are rejected
   with a new `stale_frame` envelope carrying `age_seconds`. The
   connection stays open so the device can recover without re-handshaking.
3. `CLOCK_SKEW_DETECT_MS` (60 seconds, per architecture §3.2) — frames whose
   `|serverReceivedAt − ts|` exceeds the threshold are persisted with the
   `clock_skew_detected` flag stamped on the row and on the
   `reading:new` broadcast. Future skew is accepted (devices clock forward
   during sleep); past skew is accepted only if within the stale-frame
   window.
4. The shared package exports a `classifyFlags(parsed, serverReceivedAt)`
   helper so the rule lives in one place — the api's `frame.ts` calls it
   after `TelemetryFrameSchema.safeParse` succeeds, BEFORE persist, so the
   flag is on the row that hits Postgres, not retroactively.

## Boundaries & Constraints

**Always:**
- A `bad_request` envelope means "the frame was malformed and not
  persisted"; the connection stays open (Story 2.2 baseline).
- A `stale_frame` envelope means "the frame was well-formed but its
  device-side `ts` is older than the stale-frame window"; the connection
  stays open, no row persisted, no broadcast.
- The flag set is closed (`z.enum([...])`); new flags require a v2 bump.
- The stale-frame window and clock-skew threshold are constants exported
  from `@surakkha/shared/telemetry`; the api and simulator import them so
  the simulator's pre-send ts prediction never silently drifts.
- All existing Story 2.1 / 2.2 contract surface remains green:
  `.strict()` on the top-level frame, non-strict on `metrics` (ADR 0001
  forward-compat for unknown metric keys), `translateZodError` envelope
  shape unchanged.

**Ask First:**
- Changing `STALE_FRAME_THRESHOLD_MS` or `CLOCK_SKEW_DETECT_MS` away from
  the values in *Design Notes* below.
- Adding a new v1 flag (the enum is closed; v2 bump is the only path).
- Splitting the `flags` column from a `String[]` into a Postgres `ENUM`
  type (operationally heavier; defer to Epic 7).

**Never:**
- Never reject a future-skewed frame (`ts > serverReceivedAt + 5min`);
  these are real (device clock drift, sleep, manual reboot) and the
  `clock_skew_detected` flag is the operator-triage signal.
- Never persist a frame whose `ts` is older than the stale-frame window —
  a flood of these would corrupt the timeline and silently inflate
  read-counts.
- Never extend the flag set at runtime; the schema is the contract.
- Never add `stale_frame` to the persisted `flags` column (it never gets
  persisted — it's a reject envelope, not a flag).
- Never accept the `flags` payload from the device. The server stamps
  flags; the wire contract does not let firmware set them.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Notes |
|----------|-------|-----------------|-------|
| VALID_FRAME | full v1 frame, fresh ts | persist + broadcast + `flags:[]` | Story 2.2 baseline |
| MISSING_REQUIRED_FIELD | `{…metrics:{…}}` (no `device_id`) | `bad_request` + `missing_fields:["device_id"]`, no persist, connection stays open | `translateZodError` carries forward |
| MISSING_METRIC | `{…metrics:{ph,tds_ppm,temp_c,chlorine,water_level} (no turbidity)` | `bad_request` + `missing_fields:["metrics.turbidity_ntu"]` | Zod fail-fast |
| OUT_OF_RANGE | `{metrics:{ph:15,…}}` | `bad_request` + `missing_fields:["metrics.ph"]` | Zod fail-fast |
| NA_NUMBER | `{metrics:{ph:NaN,…}}` | `bad_request` + `missing_fields:["metrics.ph"]` | Zod fail-fast |
| WRONG_VERSION | `{version:2,…}` | `bad_request` + `missing_fields:["version"]` | Zod literal mismatch |
| NON_UUID_DEVICE_ID | `{device_id:"not-a-uuid"}` | `bad_request` + `missing_fields:["device_id"]` | Zod fail-fast |
| UNKNOWN_TOP_LEVEL | `{…extra_a:"x",extra_b:"y"}` | `bad_request` + `missing_fields:["extra_a","extra_b"]` | `.strict()` (ADR 0001) |
| UNKNOWN_METRIC_KEY | `{metrics:{…six metrics, mystery_metric:42}}` | accept, persist, broadcast; `mystery_metric` silently dropped (forward-compat) | non-strict `TelemetryMetricsSchema` (ADR 0001) |
| STALE_FRAME | `ts < serverReceivedAt − 5min` | `stale_frame` envelope + `{age_seconds:<n>}` + `disconnect(false)` (keep open); no persist, no broadcast | NEW |
| CLOCK_SKEW_DETECTED | `|serverReceivedAt − ts| > 60s` (within stale window) | persist + broadcast + `flags:["clock_skew_detected"]` on the row and on the `reading:new` payload | NEW |
| FUTURE_SKEW_OK | `ts > serverReceivedAt + 60s` (within +5min tolerance) | persist + broadcast + `flags:["clock_skew_detected"]` | NEW — future skew is acceptable |
| DUPLICATE_FLAG_REJECTED | payload that would cause a duplicate (n/a in v1 — server is sole flagger) | n/a | server-only flagging |
| UNKNOWN_FLAG_AT_PERSIST | schema drift causes `"foo"` to land in flags column | persisted row's flags column parses via `ReadingFlagSchema`; mismatch is a build-time error | typed enum prevents at the seam |

</frozen-after-approval>

## Code Map

- `packages/shared/src/telemetry.ts` — **edit**: add `ReadingFlagSchema`
  (`z.enum(["out_of_order", "clock_skew_detected", "rate_limited"])`),
  constants `STALE_FRAME_THRESHOLD_MS = 5 * 60 * 1000`,
  `CLOCK_SKEW_DETECT_MS = 60 * 1000`, helper `classifyFlags(parsed,
  serverReceivedAt): ReadingFlag[]`, type `TelemetryStaleFrame` envelope.
- `packages/shared/src/events.ts` — **edit**: replace
  `flags: z.array(z.string()).default([])` with
  `flags: z.array(ReadingFlagSchema).default([])` (additive schema
  tightening; existing `[ "out_of_order" ]` payloads still validate).
- `packages/shared/src/__tests__/telemetry.spec.ts` — **edit**: add flag
  enum pin, `classifyFlags` table (fresh / small-skew / stale / future),
  threshold-constant pins.
- `packages/api/src/ingest/frame.ts` — **edit**: import the constants +
  `classifyFlags` + `TelemetryStaleFrame` type; insert a new "stale
  check" sub-step inside `stepValidate` (after the Zod parse, before the
  existing patch) that emits `stale_frame` + returns `{ kind: "exit",
  outcome: { status: "ignored" } }`; thread `flags` from the classifier
  into `state.flags` so `stepPersist` and `stepSocketBroadcast` see them.
- `packages/api/src/ingest/frame.spec.ts` — **edit**: add
  `STALE_FRAME` and `CLOCK_SKEW_DETECTED` describe blocks; pin the
  envelope payload, the disconnect(false) (keep open) behavior, and the
  flag array on the persisted row + `reading:new` broadcast.
- `docs/architecture.md` — **edit**: §3.2 stale-frame window paragraph
  (was implied via Epic 2 context but not specified) and the flag-set
  enum row updated to match the schema exactly.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/telemetry.ts` -- add `ReadingFlagSchema` (z.enum), `STALE_FRAME_THRESHOLD_MS`, `CLOCK_SKEW_DETECT_MS`, `classifyFlags(parsed, serverReceivedAt): ReadingFlag[]` -- reason: server-only flag stamping is a single-source contract.
- [ ] `packages/shared/src/events.ts` -- replace `flags: z.array(z.string())` with `flags: z.array(ReadingFlagSchema)` (additive; `.default([])` preserved) -- reason: payload type contract tightens to match persisted column.
- [ ] `packages/shared/src/__tests__/telemetry.spec.ts` -- add tests for flag enum pin, classifyFlags fresh / small-skew / stale / future cases, threshold constants -- reason: contract pin.
- [ ] `packages/api/src/ingest/frame.ts` -- wire `classifyFlags` into the post-validate sub-step so `state.flags` is set before persist + broadcast -- reason: flag on the row + on the wire.
- [ ] `packages/api/src/ingest/frame.ts` -- emit `stale_frame` envelope + `{age_seconds}` + soft-disconnect when `ts < serverReceivedAt − STALE_FRAME_THRESHOLD_MS` -- reason: stale-frame rejection without dropping the connection.
- [ ] `packages/api/src/ingest/frame.spec.ts` -- add STALE_FRAME and CLOCK_SKEW_DETECTED test cases; pin envelope payload + disconnect + flag-on-row + flag-on-broadcast -- reason: I/O matrix coverage.
- [ ] `docs/architecture.md` -- §3.2 stale-frame window paragraph + flag-set enum row alignment -- reason: architecture matches the now-pinned contract.
- [ ] `docs/adr/0013-server-processing-order.md` -- step 1 narrative amendment: the "validate" sub-step now also runs the stale-frame check; step count is unchanged -- reason: ADR matches the code.

**Acceptance Criteria:**
- Given a frame with `metrics.ph` missing, when `TelemetryFrameSchema.safeParse` runs, then `translateZodError` returns `{error:"bad_request", missing_fields:["metrics.ph"]}`, the api emits `bad_request`, no row is persisted, and the connection stays open.
- Given a frame with an unknown TOP-LEVEL key `extra_a`, when `safeParse` runs, then the api emits `bad_request` with `missing_fields:["extra_a"]` and no row is persisted.
- Given a frame with an unknown METRIC key `mystery_metric:42` plus the six required metrics, when `safeParse` runs, then the frame validates, persists, and broadcasts with `flags:[]` (the unknown metric is silently dropped per ADR 0001).
- Given a frame with `ts < serverReceivedAt − 5min`, when `processFrame` runs, then the api emits `stale_frame` with `{age_seconds:<n>}`, calls `socket.disconnect(false)` (keep open), and does NOT persist or broadcast.
- Given a frame with `ts = serverReceivedAt − 90s` (60s threshold), when `processFrame` runs, then the row is persisted with `flags:["clock_skew_detected"]` and `reading:new` is broadcast with `flags:["clock_skew_detected"]`.
- Given a frame with `ts = serverReceivedAt + 90s` (future skew within tolerance), when `processFrame` runs, then the row is persisted with `flags:["clock_skew_detected"]`.
- Given `ReadingFlagSchema.parse("out_of_order")`, then the parse succeeds. Given `ReadingFlagSchema.safeParse("not_a_flag")`, then `success` is false (closed enum).
- Given `TelemetryFrameSchema.safeParse` succeeds and `serverReceivedAt` is within the clock-skew window, then `state.flags` is `[]` after `classifyFlags` returns.

## Design Notes

**Why 5 minutes for `STALE_FRAME_THRESHOLD_MS` (not 24h).** Epic 2 context
mentions "24 hours in the past" but architecture §3.2 does not pin a value.
A real device boots, samples every 2s, and may be offline for hours — but
those frames are *lost*, not late. A late frame after >5min is almost
always: (a) a back-fill replay we never asked for, (b) a clock-skew bug
on the device, or (c) a malicious actor padding history. None of these
should hit the canonical timeline. The simulator (Story 2.4) emits every
2s and never needs the longer window — its `Retry-After` handling is the
real recovery path. 5min is the smallest window that distinguishes
"buffered-and-flushing" (normal reconnect) from "stale-or-attack".
The Epic 2 context's 24h language is a forward-looking "if we ever want
a back-fill seam, that is the seam" note, not a Story 2.3 AC. If a later
story wants explicit back-fill, it is its own feature with its own
auth + replay ordering.

**Why 60s for `CLOCK_SKEW_DETECT_MS`.** Architecture §3.2 row already
specifies `|server_received_at − ts| > 60s`. A real device with NTP
discipline drifts <1s; an undisciplined RTC drifts ~1min over a month.
60s is the smallest threshold that catches the "device forgot to call
NTP sync on boot" case without flagging normal operation. The flag is
free to set (a single column write + a single broadcast field); the
operator gets a row in the audit pipeline + a visual on the Live Readings
table (Story 2.8).

**Why a closed enum for flags.** Three flags in v1 (`out_of_order`,
`clock_skew_detected`, `rate_limited`). A `string[]` column lets typos
silently land and ops queries (`SELECT WHERE 'clock_skew_detected' = ANY
(flags)`) silently miss them. The closed enum pins the wire, the
persisted column, and the Zod parse to the same surface. Adding a flag
is a v2 contract bump (architecture §NFR-14 + ADR 0001).

**Why `classifyFlags` lives in shared.** Two reasons: (1) the simulator
(Story 2.4) wants the same constants to pre-validate before sending
(rather than wait for a server reject), and (2) the api is the only
caller today but a future Epic 3 rule evaluator will want to inspect
the same flag set; keeping the source in `shared` means the rule-engine
file can `import { classifyFlags, ReadingFlag }` instead of duplicating
the constants.

**Why `socket.disconnect(false)` on stale-frame.** The spec change-log
entry F-W6 from Story 2.2 already documented that Socket.IO's
`disconnect(close)` is a boolean (not a status code). For stale-frame
we want the *transport* to stay alive (the device may have one valid
frame queued behind the stale one) but the device should know we are
not going to accept this one. The semantic is "ignore + keep the
connection"; a `false` arg on Socket.IO v4 means "close without
reconnect" but does NOT terminate the socket — it just sets a flag. We
keep `disconnect(false)` so the ioredis test surface matches; if Story
2.4 wants the device to re-handshake on stale, it can do so explicitly.

**Why no `stale_frame` flag column.** The flag set is closed and the
flag would never be set on a persisted row (the row never gets persisted).
Adding it would either bloat the enum or risk a future contributor
mistakenly stamping it on a successful row.

## Suggested Review Order

**Wire contract (shared)**

- `ReadingFlagSchema` — closed `z.enum` covering the three v1 flags.
  [`telemetry.ts`](../../packages/shared/src/telemetry.ts)
- `classifyFlags(parsed, serverReceivedAt)` — returns `ReadingFlag[]`
  (always `[]` when `|serverReceivedAt − ts| ≤ CLOCK_SKEW_DETECT_MS`).
  [`telemetry.ts`](../../packages/shared/src/telemetry.ts)
- `STALE_FRAME_THRESHOLD_MS` and `CLOCK_SKEW_DETECT_MS` constants —
  single source of truth shared with the simulator.
  [`telemetry.ts`](../../packages/shared/src/telemetry.ts)
- `TelemetryBadRequest` envelope (Story 2.1) carries forward unchanged.
  [`telemetry.ts`](../../packages/shared/src/telemetry.ts)
- `translateZodError` — unchanged shape; still the source of the
  `bad_request` envelope. [`telemetry.ts`](../../packages/shared/src/telemetry.ts)
- `ReadingNewEventSchema.flags` — tightened to `ReadingFlagSchema[]`.
  [`events.ts`](../../packages/shared/src/events.ts)

**Runtime (api)**

- `stepValidate` — extended with the stale-frame check after the Zod
  parse; emits `stale_frame` + soft-disconnect when past the threshold.
  [`frame.ts`](../../packages/api/src/ingest/frame.ts)
- `state.flags` — seeded via `classifyFlags` before `stepPersist` so
  the persisted row and the `reading:new` broadcast both carry the
  flag. [`frame.ts`](../../packages/api/src/ingest/frame.ts)
- `Reading.flags` column type — Postgres `text[]` (unchanged); the
  application-side guard is `ReadingFlagSchema.parse(flag)` at the
  boundary. [`schema.prisma`](../../packages/db/prisma/schema.prisma)

**Tests**

- `TelemetryFrameSchema` flag enum + unknown-flag rejection.
  [`telemetry.spec.ts`](../../packages/shared/src/__tests__/telemetry.spec.ts)
- `classifyFlags` table — fresh / small-skew / stale / future.
  [`telemetry.spec.ts`](../../packages/shared/src/__tests__/telemetry.spec.ts)
- `STALE_FRAME` envelope + soft-disconnect + no persist/broadcast.
  [`frame.spec.ts`](../../packages/api/src/ingest/frame.spec.ts)
- `CLOCK_SKEW_DETECTED` flag on the persisted row and on the broadcast.
  [`frame.spec.ts`](../../packages/api/src/ingest/frame.spec.ts)

## Verification

**Commands:**
- `pnpm --filter @surakkha/shared build` -- expected: 0 errors (ReadingFlagSchema + classifyFlags).
- `pnpm --filter @surakkha/shared test` -- expected: existing 64 + ~8 new (flag enum, classifyFlags table, constants pin).
- `pnpm --filter @surakkha/api test` -- expected: existing 90 + ~6 new (stale-frame envelope, clock-skew flag row+broadcast).
- `pnpm typecheck` -- expected: 5/5 packages green.
- `pnpm lint` -- expected: 5/5 packages green.

**Manual checks:**
- Open `packages/shared/src/telemetry.ts` — flag enum, classifyFlags, and constants are exported and the doc comment matches the spec.
- Open `packages/api/src/ingest/frame.ts` — `state.flags` is set via `classifyFlags` BEFORE the persist step runs.
- Search `flags:` across the api — every assignment uses `ReadingFlagSchema` (or a derived `ReadingFlag[]`), never `string`.

## Spec Change Log

- finding: spec mentions "stale_frame" envelope but Epic 2 context said "24 hours" while architecture is silent on a value
  amended: 5-minute window is the Story 2.3 default; documented in *Design Notes* "Why 5 minutes for `STALE_FRAME_THRESHOLD_MS`". If a later story needs explicit back-fill, it is a separate feature.
  known_bad_avoided: silently accepting multi-hour-old frames that corrupt the canonical timeline
  KEEP: 5-minute constant; classifier helper in shared

## Review Findings

Reviewers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor.
Review-mode: full (spec file present).
Failed layers: none.

### Decision Needed

- [x] [Review][Defer] **Flag-union policy for late + skewed frames** — `stepSeqDropCheck` does `patch.flags = ["out_of_order"]` (direct assignment, `frame.ts:226`); `applyPatch` (`frame.ts:128-129`) treats `patch.flags !== undefined` as overwrite. A late frame whose `ts` is also skewed (`60s < |skew| < 5min`) silently loses the `clock_skew_detected` flag — neither the persisted row, broadcast, `onRuleEvaluation`, nor `onAuditAppend` see it. Spec ACs (lines 154-155) cover skew-without-reorder and reorder-without-skew separately; the union is unspecified. — deferred, operator-triage policy belongs to Epic 3 (rule-eval)
- [x] [Review][Defer] **`rate_limited` flag has no producer in v1** — `ReadingFlagSchema` lists `["out_of_order", "clock_skew_detected", "rate_limited"]` but `stepRateCheck` (`frame.ts:194-204`) emits a `rate_limited` envelope + audit hook + disconnect, never stamping `["rate_limited"]` on the persisted row or `reading:new` broadcast. — deferred, producer belongs to Epic 3 (rule-eval intersection)

### Patch

- [x] [Review][Patch] **`clock_skew_detected` does not reach `onRuleEvaluation` hook end-to-end** — added test in `frame.spec.ts` (clock-skew flag describe block) installing `onRuleEvaluation` spy and asserting `flags: ["clock_skew_detected"]` for a 90s-past-skew frame.
- [x] [Review][Patch] **`clock_skew_detected` does not reach `onAuditAppend` (reading_ingested) hook end-to-end** — added test in `frame.spec.ts` (clock-skew flag describe block) installing `onAuditAppend` spy and asserting the `reading_ingested` call carries `context.flags: ["clock_skew_detected"]`.
- [x] [Review][Patch] **`hooks.ts` flag types still `readonly string[]`** — `RuleEvaluationInput.flags` tightened to `readonly ReadingFlag[]` with `import type { ReadingFlag } from "@surakkha/shared"`.
- [x] [Review][Patch] **Test-rig clock magic constants scattered** — extracted to `packages/api/src/__tests__/rigClock.ts` with `RIG_CLOCK_MS`, `RIG_CLOCK_TICK_MS`, and `freshTsMs()` exports; `frame.spec.ts` and `server.spec.ts` import from there.
- [x] [Review][Patch] **`server.spec.ts:308` uses `Date.now() - 1_000`** — replaced with `freshTsMs()` from the shared rig-clock fixture for a single point of reference.

### Defer

- [x] [Review][Defer] **Simulator import of new constants** — Story 2.4 is `backlog`; the constraint "the api and simulator import them" is forward-looking. The constants are exported and ready. — deferred, awaits Story 2.4
- [x] [Review][Defer] **`flags` union / `rate_limited` producer** — see Decision Needed above; the underlying choice is operator-triage policy that belongs to the rule-eval story (Epic 3). — deferred, awaits human decision above

### Dismissed (count: 9)

- F-4 `disconnect(false)` semantics — spec §"Design Notes" "Why `socket.disconnect(false)` on stale-frame" documents the deliberate trade-off.
- F-5 future-skew >5min accepted with flag — spec constraint "Never reject a future-skewed frame" mandates this.
- F-6/F-7/F-8 boundary tests at 60s, 5min, 300s — all explicitly pinned by `frame.spec.ts:454-462` (5min boundary) and `telemetry.spec.ts:386-405` (60s boundary).
- F-9 NaN/Infinity `ts` — Zod schema `z.number().int().nonnegative()` rejects at parse; never reaches clock-skew math.
- F-10 double-disconnect — control flow: `bad_request` exits before stale-frame check; `disconnect(false)` is called at most once per frame.
- F-16/F-17/F-20/F-23 spec scope framing (title, enum contract, version bump) — not bugs.
- F-19 wasted `classifyFlags` call — reading `frame.ts:152-181` confirms it's called only on the `next` path, never on `exit`.
- F-21 fresh-frame `flags: []` — explicitly asserted at `frame.spec.ts:467-486` (59s skew boundary → `[]`).