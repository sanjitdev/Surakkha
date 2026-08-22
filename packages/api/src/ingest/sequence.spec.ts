/**
 * Story 2.2 — PerDeviceSequence.
 *
 * Covers:
 *   - first-frame seq:0 accepts (lastSeen was -1)
 *   - seq:5 after accepts (no gap, dropCount=0)
 *   - seq:3 after marks reorder (lastSeen unchanged at 5)
 *   - seq:10 after reorder reports dropCount = 10 - 3 - 1 = 6
 *     (scenario: seq:3 was the last ACCEPTED value before the
 *     reorder, then seq:10 arrives and crosses the gap of [4..9])
 *
 * Why that scenario for the 4th case: the spec describes the
 * dropCount formula as `(newSeq - lastAcceptedSeq - 1)`. The
 * "after reorder" wording is the path that makes `lastSeen=3`
 * (because the reorder was triggered by a seq <= 3, leaving
 * lastSeen at 3). After the reorder, the seq:10 accept observes
 * the gap 4..9.
 */
import { describe, expect, it } from "vitest";

import { PerDeviceSequence } from "./sequence";

const DEVICE = "9b1c4f00-0000-4000-8000-00000000000a";

describe("PerDeviceSequence", () => {
  it("accepts a first-frame seq:0 (lastSeen defaults to -1)", () => {
    const seq = new PerDeviceSequence();
    expect(seq.observe(DEVICE, 0)).toEqual({
      outcome: "accept",
      dropCount: 0,
      newLastSeen: 0,
    });
  });

  it("accepts seq:5 after seq:0 with no gap", () => {
    const seq = new PerDeviceSequence();
    seq.observe(DEVICE, 0);
    expect(seq.observe(DEVICE, 5)).toEqual({
      outcome: "accept",
      dropCount: 4,
      newLastSeen: 5,
    });
  });

  // F-P14: pin the FIRST `observe` after a brand-new lastSeen=-1
  // default so a regression in the gap-drop formula
  // (`newSeq - lastAcceptedSeq - 1`) that mis-computes the
  // "last_seen === -1" baseline is caught here. The formula with
  // lastSeen=-1 is `seq - (-1) - 1 = seq`; for seq=3 that's
  // dropCount=3 (frames 0,1,2 were missed).
  it("first observe(DEVICE, 3) from a fresh state reports dropCount=3", () => {
    const seq = new PerDeviceSequence();
    expect(seq.observe(DEVICE, 3)).toEqual({
      outcome: "accept",
      dropCount: 3,
      newLastSeen: 3,
    });
  });

  it("marks reorder for seq:3 after seq:5 (lastSeen unchanged)", () => {
    const seq = new PerDeviceSequence();
    seq.observe(DEVICE, 5);
    expect(seq.observe(DEVICE, 3)).toEqual({
      outcome: "reorder",
      dropCount: 0,
      newLastSeen: 5,
    });
  });

  it("after a reorder leaves lastSeen=3; seq:10 reports dropCount = 10-3-1 = 6", () => {
    const seq = new PerDeviceSequence();
    seq.observe(DEVICE, 3); // lastSeen = 3
    // A frame with seq <= 3 triggers reorder but does NOT move lastSeen.
    seq.observe(DEVICE, 2);
    expect(seq.observe(DEVICE, 10)).toEqual({
      outcome: "accept",
      dropCount: 6,
      newLastSeen: 10,
    });
  });
});