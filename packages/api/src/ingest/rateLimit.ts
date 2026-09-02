/**
 * Per-device rate limiter — ingest step 3 (rate check).
 *
 * 1 frame / 2s, per device UUID. State lives in process memory
 * because v1 runs as a single Node process (I-9). The Map key is
 * the device's UUID (the JWT `sub`); `tryAccept(deviceId, nowMs)`
 * returns `{ok:true}` and records the timestamp, or
 * `{ok:false, retryAfterSeconds:2}` if the previous acceptance was
 * within the window.
 *
 * The accept timestamp is recorded even when `tryAccept` returns
 * true — the next call compares its `nowMs` argument against this
 * stored value, NOT against the call's own timestamp. This means
 * the throttle window is anchored to the LAST accepted frame, not
 * to the LAST rejected frame (which would be a fairness bug — a
 * rejected burst would not reset the window).
 *
 * `nowMs` is a parameter (not `Date.now()`) so tests with vitest's
 * fake timers can drive the window without freezing real time.
 */
const RATE_LIMIT_WINDOW_MS = 2_000;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 2 as const;

export type RateLimitDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterSeconds: number };

export class PerDeviceRateLimiter {
  private readonly lastAcceptedAtMs = new Map<string, number>();

  tryAccept(deviceId: string, nowMs: number): RateLimitDecision {
    const previous = this.lastAcceptedAtMs.get(deviceId);
    if (previous !== undefined && nowMs - previous < RATE_LIMIT_WINDOW_MS) {
      return { ok: false, retryAfterSeconds: RATE_LIMIT_RETRY_AFTER_SECONDS };
    }
    this.lastAcceptedAtMs.set(deviceId, nowMs);
    return { ok: true };
  }

  /** Test-only: wipe state between cases. */
  reset(): void {
    this.lastAcceptedAtMs.clear();
  }
}
