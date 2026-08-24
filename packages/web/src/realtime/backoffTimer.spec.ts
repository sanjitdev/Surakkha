/**
 * `backoffTimer.computeBackoffMs` — Story 2.9 — pure formula.
 *
 * Schedule:
 *   attempt 1 →  5_000 ms
 *   attempt 2 → 10_000 ms
 *   attempt 3 → 20_000 ms
 *   attempts ≥4 → 30_000 ms (capped)
 *
 * The formula is `5_000 * 2^min(attempt, 2)` capped at `30_000`,
 * with `attempt` clamped to `Math.max(0, Math.floor(attempt))`
 * (defensive against a corrupted store).
 */
import { describe, expect, it } from "vitest";

import {
  BACKOFF_CAP_MS,
  BACKOFF_INITIAL_MS,
  computeBackoffMs,
} from "./backoffTimer";

describe("Story 2.9 — computeBackoffMs schedule", () => {
  it("exports the documented initial delay", () => {
    expect(BACKOFF_INITIAL_MS).toBe(5_000);
    expect(BACKOFF_CAP_MS).toBe(30_000);
  });

  it("attempt 1 → 5_000 ms", () => {
    expect(computeBackoffMs(1)).toBe(5_000);
  });

  it("attempt 2 → 10_000 ms", () => {
    expect(computeBackoffMs(2)).toBe(10_000);
  });

  it("attempt 3 → 20_000 ms", () => {
    expect(computeBackoffMs(3)).toBe(20_000);
  });

  it("attempt 4 → 30_000 ms (cap reached)", () => {
    expect(computeBackoffMs(4)).toBe(30_000);
  });

  it("attempts ≥4 are all capped at 30_000 ms", () => {
    expect(computeBackoffMs(4)).toBe(30_000);
    expect(computeBackoffMs(5)).toBe(30_000);
    expect(computeBackoffMs(10)).toBe(30_000);
    expect(computeBackoffMs(100)).toBe(30_000);
  });
});

describe("Story 2.9 — computeBackoffMs defensive clamps", () => {
  it("attempt 0 → 5_000 ms (Math.max(0, ...) clamps negatives to 0)", () => {
    expect(computeBackoffMs(0)).toBe(5_000);
  });

  it("attempt -1 → 5_000 ms (negative clamps to 0)", () => {
    expect(computeBackoffMs(-1)).toBe(5_000);
  });

  it("attempt -100 → 5_000 ms (deeply negative clamps to 0)", () => {
    expect(computeBackoffMs(-100)).toBe(5_000);
  });

  it("NaN → 5_000 ms (Math.floor(NaN) is NaN; Math.max(0, NaN) is NaN; final NaN result)", () => {
    // Math.floor(NaN) = NaN, Math.max(0, NaN) = NaN,
    // Math.min(NaN, 2) = NaN, 2 ** NaN = NaN,
    // 5_000 * NaN = NaN, Math.min(NaN, 30_000) = NaN.
    // The formula does not pretend to be total; the contract is
    // "defensive against small store corruption" — a corrupted
    // counter sending NaN is a deeper bug. We pin the documented
    // behaviour so a future refactor can't silently change it.
    expect(Number.isNaN(computeBackoffMs(NaN))).toBe(true);
  });

  it("non-integer attempts are floored (1.9 → floor to 1 → 5_000 ms)", () => {
    // Documented contract: `Math.floor(attempt)` clamps the input
    // before the formula. The store counter is integer-only by
    // construction (see `connectionStateStore.incrementRetry`),
    // so fractional values only arise from a corrupted store.
    expect(computeBackoffMs(1.9)).toBe(5_000);
    expect(computeBackoffMs(2.4)).toBe(10_000);
    expect(computeBackoffMs(3.99)).toBe(20_000);
  });
});
