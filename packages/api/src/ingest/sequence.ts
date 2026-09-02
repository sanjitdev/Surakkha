/**
 * Per-device monotonic seq observer — ingest step 4.
 *
 * On first observation the device is initialised with
 * `lastSeen = -1` so a first-frame `seq:0` is accepted.
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
    // Late arrival — `lastSeen` is unchanged so historical ordering stays
    // authoritative. The gap counter is only incremented on the accept
    // that first crossed it.
    return { outcome: "reorder", dropCount: 0, newLastSeen: previous };
  }

  /** Test-only: wipe state between cases. */
  reset(): void {
    this.lastSeen.clear();
  }
}
