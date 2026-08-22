/**
 * Shared test-rig clock fixture — Story 2.3 review patch P-4.
 *
 * Story 2.3 added the stale-frame check (`ts < serverReceivedAt − 5min`)
 * to `stepValidate`. The api's test rigs need a deterministic "now" so
 * fixture frames are fresh relative to the rig clock (otherwise a stale
 * frame is rejected before the test body even runs).
 *
 * Two surfaces use this fixture:
 *
 * 1. `frame.spec.ts` — the production code's `now()` is injected via
 *    `rig.now`, and `rig.now()` returns `RIG_CLOCK_MS` by default. The
 *    frame's `ts: RIG_CLOCK_MS` is fresh relative to `rig.now()`.
 *    Subsequent frames advance `nowMs = RIG_CLOCK_TICK_MS`.
 *
 * 2. `server.spec.ts` — the production code's `now()` defaults to real
 *    wall clock (no injection point on `buildIngestServer`). Use
 *    `freshTsMs()` for the frame's `ts` so the frame is fresh relative
 *    to wall clock at test run-time; `RIG_CLOCK_TICK_MS` would drift
 *    past the 5-minute stale window as wall clock advances.
 *
 * Lives under `src/__tests__/` (not the top-level `__tests__/`) because
 * `tsconfig.json` pins `rootDir: "./src"` and the spec files at the
 * top level are excluded from tsc entirely — putting a non-spec fixture
 * outside `src/` would fail `tsc --noEmit`.
 */
export const RIG_CLOCK_MS = 1_787_221_864_000;
/** `RIG_CLOCK_MS + 1000` — one full tick past the rig clock, useful for
 *  sequencing two frames in a single test (e.g. rate-limit window). */
export const RIG_CLOCK_TICK_MS = RIG_CLOCK_MS + 1_000;
/** Wall-clock-relative ts, fresh relative to whatever `Date.now()`
 *  returns at the moment of the call. Safe for tests that do NOT inject
 *  a clock and rely on `processFrame`'s default `now = () => new Date()`. */
export const freshTsMs = (): number => Date.now() - 1_000;
