/**
 * Story 2.2 — PerDeviceRateLimiter.
 *
 * Vitest fake-timers drive the 2s window deterministically:
 *   - First accept returns ok:true.
 *   - 1s later, a second try returns ok:false with retryAfter=2.
 *   - 2s later (3s total elapsed from the first accept), the
 *     window has elapsed and the next try returns ok:true.
 *
 * Two-device isolation: each device's Map entry is independent;
 * a burst on device A must not affect device B's window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PerDeviceRateLimiter } from "./rateLimit";

const DEVICE_A = "9b1c4f00-0000-4000-8000-00000000000a";
const DEVICE_B = "9b1c4f00-0000-4000-8000-00000000000b";

describe("PerDeviceRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts the first frame and rejects a frame 1s later in the same 2s window", () => {
    const limiter = new PerDeviceRateLimiter();
    expect(limiter.tryAccept(DEVICE_A, 0)).toEqual({ ok: true });
    vi.setSystemTime(1_000);
    expect(limiter.tryAccept(DEVICE_A, 1_000)).toEqual({
      ok: false,
      retryAfterSeconds: 2,
    });
  });

  it("accepts again 2s after the last acceptance", () => {
    const limiter = new PerDeviceRateLimiter();
    expect(limiter.tryAccept(DEVICE_A, 0)).toEqual({ ok: true });
    vi.setSystemTime(1_000);
    expect(limiter.tryAccept(DEVICE_A, 1_000).ok).toBe(false);
    vi.setSystemTime(2_000);
    // 2s after the LAST ACCEPT (which was at t=0) → exactly on the
    // boundary. Spec says "1 frame / 2s"; we accept at the boundary
    // (window is `[lastAccept, lastAccept+2000)`). With `setSystemTime`
    // we evaluate at 2_000ms, where `nowMs - previous` is `2000 - 0 =
    // 2000`. The condition is `< 2000`, so 2000 is allowed.
    expect(limiter.tryAccept(DEVICE_A, 2_000).ok).toBe(true);
  });

  it("tracks per-device state independently", () => {
    const limiter = new PerDeviceRateLimiter();
    expect(limiter.tryAccept(DEVICE_A, 0).ok).toBe(true);
    vi.setSystemTime(1_000);
    // Device A is rate-limited.
    expect(limiter.tryAccept(DEVICE_A, 1_000).ok).toBe(false);
    // Device B is fresh — first frame must pass.
    expect(limiter.tryAccept(DEVICE_B, 1_000)).toEqual({ ok: true });
  });
});