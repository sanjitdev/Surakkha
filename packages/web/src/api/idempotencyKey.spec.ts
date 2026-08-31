/**
 * `idempotencyKey.spec.ts` — unit tests for the
 * `newIdempotencyKey` helper.
 *
 * Covers:
 *   - returns a string
 *   - matches RFC 4122 v4 UUID format
 *   - two consecutive calls return distinct values
 *
 * Mirrors the api-side `idempotency.spec.ts`'s UUID-v4 regex
 * for parity: the api validates incoming keys against the
 * same regex so the web's outbound format MUST match.
 */
import { describe, expect, it } from "vitest";

import { newIdempotencyKey } from "./idempotencyKey";

// RFC 4122 UUID v4 — version nibble `4`, variant nibble [89ab].
// Kept verbatim from `packages/api/src/middleware/idempotency.ts:53`
// so the two sides stay in lock-step.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("newIdempotencyKey", () => {
  it("returns a string", () => {
    expect(typeof newIdempotencyKey()).toBe("string");
  });

  it("returns a value matching the RFC 4122 v4 UUID format", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(UUID_V4_RE);
  });

  it("returns distinct values on consecutive calls", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
  });

  it("returns distinct values across a 1000-call burst", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      keys.add(newIdempotencyKey());
    }
    // No collisions in 1000 random v4 UUIDs. Probability of a
    // single collision is ~ 5e-13 (birthday paradox on 2^122);
    // a real collision would mean the RNG is broken.
    expect(keys.size).toBe(1000);
  });
});
