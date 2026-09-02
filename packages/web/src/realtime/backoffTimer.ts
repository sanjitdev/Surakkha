/**
 * Reconnect backoff formula. `attempt` is the post-increment retry
 * counter; `Math.max(0, Math.floor(attempt))` clamps a corrupted
 * store (NaN / negative / non-integer) before the exponential,
 * keeping `computeBackoffMs` pure and side-effect free.
 *
 * Schedule:
 *   attempt 1 →   5_000 ms
 *   attempt 2 →  10_000 ms
 *   attempt 3 →  20_000 ms
 *   attempt ≥4 → 30_000 ms (capped)
 */
export const BACKOFF_INITIAL_MS = 5_000;
export const BACKOFF_CAP_MS = 30_000;

export const computeBackoffMs = (attempt: number): number => {
  const safe = Math.max(0, Math.floor(attempt));
  const exp = Math.max(0, safe - 1);
  const base = BACKOFF_INITIAL_MS * 2 ** exp;
  return Math.min(base, BACKOFF_CAP_MS);
};
