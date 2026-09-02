/**
 * Per-device sequence observer — ingest step 4 (seq/drop check).
 *
 * Each device's last-accepted `seq` lives in this Map. On first
 * observation the device is initialised with `lastSeen = -1` so a
 * first-frame `seq:0` is accepted (the spec's FIRST_FRAME case).
 *
 * Outcomes:
 *   - `accept`  — `seq > lastSeen`; advance lastSeen. `dropCount` is
 *                 `seq - lastSeen - 1`: how many frames between the
 *                 previous accepted seq and this one were silently
 *                 missed by the server. The frame itself is NOT a
 *                 drop; it is accepted and broadcast.
 *   - `reorder` — `seq <= lastSeen`; late arrival. lastSeen is
 *                 unchanged. `dropCount` is always 0 because any
 *                 earlier gaps were already counted on the accept
 *                 that first crossed the gap.
 *
 * The caller (`frame.ts`) decides whether to flag the row with
 * `out_of_order`. `reorder` only signals the timing relationship;
 * it does NOT encode the flag.
 *
 * State lives in process memory — single Node process (I-9).
 */

const INITIAL_LAST_SEEN = -1;

export type SequenceObservation =
  | {
      readonly outcome: "accept";
      readonly dropCount: number;
      readonly newLastSeen: number;
    }
  | {
      readonly outcome: "reorder";
      readonly dropCount: 0;
      readonly newLastSeen: number;
    };

export class PerDeviceSequence {
  private readonly lastSeen = new Map<string, number>();

  observe(deviceId: string, seq: number): SequenceObservation {
    const previous = this.lastSeen.get(deviceId) ?? INITIAL_LAST_SEEN;
    if (seq > previous) {
      this.lastSeen.set(deviceId, seq);
      return {
        outcome: "accept",
        dropCount: Math.max(0, seq - previous - 1),
        newLastSeen: seq,
      };
    }
    // seq <= previous: late arrival. Don't move lastSeen — the
    // historical ordering is authoritative. The late frame does NOT
    // contribute to seq_drop count; that counter is incremented by
    // the gap recorded on the accepting frame that first crossed it.
    return { outcome: "reorder", dropCount: 0, newLastSeen: previous };
  }

  /** Test-only: wipe state between cases. */
  reset(): void {
    this.lastSeen.clear();
  }
}
