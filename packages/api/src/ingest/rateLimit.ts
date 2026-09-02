/**
 * Per-device rate limiter — ingest step 3.
 *
 * 1 frame / 2 s, keyed by device UUID. `nowMs` is a parameter (not
 * `Date.now()`) so vitest fake timers can drive the window without
 * freezing real time.
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
