/**
 * Shared test-rig clock fixture. The api's test rigs need a
 * deterministic "now" so fixture frames are fresh relative to the
 * rig clock (otherwise the stale-frame check rejects a frame
 * before the test body even runs).
 *
 * Lives under `src/__tests__/` (not the top-level `__tests__/`)
 * because `tsconfig.json` pins `rootDir: "./src"` and the spec
 * files at the top level are excluded from tsc.
 */
export const RIG_CLOCK_MS = 1_787_221_864_000;
/** One full tick past the rig clock — useful for sequencing two
 *  frames in a single test (e.g. rate-limit window). */
export const RIG_CLOCK_TICK_MS = RIG_CLOCK_MS + 1_000;
/** Wall-clock-relative ts, fresh relative to whatever `Date.now()`
 *  returns at the moment of the call. Safe for tests that rely on
 *  `processFrame`'s default `now = () => new Date()`. */
export const freshTsMs = (): number => Date.now() - 1_000;
