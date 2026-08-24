/**
 * `backoffTimer` — Story 2.9.
 *
 * Pure formula for the realtime reconnect backoff schedule. Lives in
 * its own file so the formula is testable without booting the socket;
 * the `setTimeout` call itself stays in `socketClient.ts` so this
 * module remains side-effect free.
 *
 * Schedule (per the spec's I/O matrix):
 *   attempt 1 →  5_000 ms
 *   attempt 2 → 10_000 ms
 *   attempt 3 → 20_000 ms
 *   attempts ≥4 → 30_000 ms (capped)
 *
 * Closed form: `5_000 * 2^(attempt - 1)` capped at `30_000`.
 *
 * Walk-through:
 *   attempt 1 → 5_000 * 2^0 =  5_000 ms
 *   attempt 2 → 5_000 * 2^1 = 10_000 ms
 *   attempt 3 → 5_000 * 2^2 = 20_000 ms
 *   attempt 4 → 5_000 * 2^3 = 40_000 ms → clamped to 30_000 ms
 *   attempt N → 5_000 * 2^(N-1) → clamped to 30_000 ms
 *
 * The `Math.max(0, Math.floor(attempt))` clamp is defensive: the
 * store counter is integer-only by construction, but `Math.floor`
 * shields against a corrupted store sending `NaN` / `-1.5` /
 * `Infinity`. Without the floor, `2 ** 1.5` → `~2.83` and the
 * formula produces `~14_142ms` — a silent regression that's hard
 * to spot. Without the max, `2 ** -1` → `0.5` → `2_500ms`.
 */
export const BACKOFF_INITIAL_MS = 5_000;
export const BACKOFF_CAP_MS = 30_000;

/**
 * Pure backoff formula. `attempt` is the post-increment retry
 * counter from the store. Returns milliseconds to wait before the
 * next `socket.connect()`.
 *
 * `attempt` is clamped to `Math.max(0, Math.floor(attempt))` before
 * the formula so a corrupted store cannot produce sub-second or
 * `NaN` delays.
 */
export const computeBackoffMs = (attempt: number): number => {
  const safe = Math.max(0, Math.floor(attempt));
  const exp = Math.max(0, safe - 1);
  const base = BACKOFF_INITIAL_MS * 2 ** exp;
  return Math.min(base, BACKOFF_CAP_MS);
};