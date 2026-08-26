/**
 * debounce.ts — Story 3.4 (architecture §5.1, FR-14/AR-7).
 *
 * Pure module that converts raw `BreachResult[]` (one frame, possibly
 * empty) into a set of `BreachTransition[]` (open / clear events)
 * by advancing rising-edge / falling-edge timers per
 * `(deviceId, metric, severity)` slot. The de-bounce state lives in
 * `RuleDebounceState` (Postgres per ADR-3 §"Negative"); this module
 * does NOT touch the DB — it is a pure function that the hook
 * composes with Prisma IO.
 *
 * Why pure (mirrors 3.2's engine seam):
 *   - Unit tests run without `vi.mock("@prisma/client")`.
 *   - The same input always produces the same output; deterministic.
 *   - The hook is integration-only; the pure core has 11+ tests
 *     covering all I/O Matrix rows.
 *
 * De-bounce key is `(deviceId, metric, severity)` per FR-14.
 * Range-rule halves (`ph<6.5 critical` + `ph>8.5 critical`) collapse
 * to ONE timer because they share the key. Two severities on the
 * same metric run independent timers (warning + critical).
 *
 * Clock-skew handling: when `frameTs < lastSeenFrameTs` (a frame
 * arriving out of order), both `inViolationSince` and `clearedSince`
 * clamp forward to `frameTs` and the function emits a `console.warn`.
 * Auto-recovery on the next in-order frame. See spec Design Note
 * "Clock-skew clamp applies to BOTH fields, symmetrically".
 */

import type { BreachResult, EngineRule } from "./engine";
import type { RuleMetric, RuleSeverity } from "@surakkha/shared";

/**
 * One slot of de-bounce state — the per-(deviceId, metric, severity)
 * pair of nullable timestamps. `null` means "not currently timing
 * for that edge". A fresh device has no row; a long-quiet device
 * has `inViolationSince: null, clearedSince: lastSeen.ts`.
 *
 * `inViolationSince` is set on the rising edge (raw breach present);
 * `clearedSince` is set on the falling edge (no raw breach). On a
 * rising edge, `clearedSince` is reset to `null` (rising wins over
 * the previous falling). On a falling edge, `inViolationSince` is
 * preserved (the rising timer pauses rather than resets — per AC1).
 */
export interface DebounceSlot {
  readonly inViolationSince: Date | null;
  readonly clearedSince: Date | null;
}

/**
 * The full per-device state passed into `debounceBreaches`. Keyed by
 * a stable string form of `(metric, severity)`. Missing keys = no
 * state for that slot yet.
 */
export type DebounceState = Readonly<Record<string, DebounceSlot>>;

/**
 * The IO side-effect emitted by the hook (not the hook's return
 * value — the shared `IngestHooks.onRuleEvaluation` interface returns
 * `Promise<readonly BreachResult[]>`). Discriminated by `kind`.
 *
 * `open` carries the canonical wire fields the hook needs to write
 * the `Alert` row + emit the `alert:opened` socket event.
 * `clear` carries only the `alertId` + `clearedAt` because the
 * falling edge only updates the existing `Alert.clearedAt`.
 */
export type BreachTransition =
  | {
      readonly kind: "open";
      readonly alertId: string;
      readonly ruleId: string;
      readonly deviceId: string;
      readonly metric: RuleMetric;
      readonly severity: RuleSeverity;
      readonly openedAt: Date;
    }
  | {
      readonly kind: "clear";
      readonly alertId: string;
      readonly deviceId: string;
      readonly metric: RuleMetric;
      readonly severity: RuleSeverity;
      readonly clearedAt: Date;
    };

/**
 * Pure-module result. `transitions` is the IO action set the hook
 * applies (Alert row writes + socket emits). `nextState` is the
 * updated `DebounceState` the hook persists.
 */
export interface DebounceResult {
  readonly transitions: readonly BreachTransition[];
  readonly nextState: DebounceState;
}

/**
 * Input shape for `debounceBreaches`. `lastSeenFrameTs` is used only
 * for clock-skew detection — `null` means "no prior frame for this
 * device" (post-restart; the clamp is silently skipped, see Design
 * Note "lastSeenFrameTs restart semantics").
 */
export interface DebounceArgs {
  readonly rawBreaches: readonly BreachResult[];
  readonly currentState: DebounceState;
  readonly rules: readonly EngineRule[];
  readonly frameTs: Date;
  readonly deviceId: string;
  readonly lastSeenFrameTs: Date | null;
}

/**
 * Internal: the slot key derived from `(metric, severity)`. Pipe-
 * separated so the lookup is unambiguous and matches the partial
 * unique index column order.
 */
const slotKey = (metric: RuleMetric, severity: RuleSeverity): string => `${metric}|${severity}`;

/**
 * Returns true when the field is a valid finite, non-negative
 * integer (treated as seconds). Mirrors 3.2's absence-rule
 * defense-in-depth: any poison value (NaN, Infinity, negative) means
 * the rule's de-bounce config is unusable; skip the slot.
 */
const isValidDuration = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Convert seconds to milliseconds for arithmetic against `frameTs`.
 */
const secondsToMs = (seconds: number): number => seconds * 1000;

/**
 * Pure module entry. See file header for contract; see spec for the
 * 11 I/O Matrix rows.
 */
export const debounceBreaches = (args: DebounceArgs): DebounceResult => {
  const { rawBreaches, currentState, rules, frameTs, deviceId, lastSeenFrameTs } = args;
  const transitions: BreachTransition[] = [];
  const nextState: Record<string, DebounceSlot> = { ...currentState };

  const isClockSkew = detectClockSkew(frameTs, lastSeenFrameTs);
  if (isClockSkew) {
    logClockSkew(deviceId, frameTs, lastSeenFrameTs);
  }

  const rulesBySlot = indexRulesBySlot(rules);
  const breachSlots = collectBreachSlots(rawBreaches);

  // Walk the union of slots-with-rules AND slots-with-breaches so we
  // advance falling-edge even when a rule exists but didn't fire
  // this frame. Slots present in `breachSlots` but NOT in
  // `rulesBySlot` (rule deactivated in 3.7) leave their state row
  // untouched — see spec I/O Matrix row STALE_STATE_NO_RULE.
  const allSlots = new Set<string>([...rulesBySlot.keys(), ...breachSlots]);

  for (const key of allSlots) {
    const result = advanceSlot({
      key,
      rule: rulesBySlot.get(key),
      prevSlot: nextState[key],
      isBreach: breachSlots.has(key),
      isClockSkew,
      frameTs,
      deviceId,
    });
    if (result.transition !== null) transitions.push(result.transition);
    nextState[key] = result.nextSlot;
  }

  return { transitions, nextState: nextState as DebounceState };
};

/**
 * Clock-skew detection helper. Extracted from `debounceBreaches` to
 * keep the main function under the complexity ceiling.
 */
const detectClockSkew = (frameTs: Date, lastSeenFrameTs: Date | null): boolean =>
  lastSeenFrameTs !== null && frameTs.getTime() < lastSeenFrameTs.getTime();

/**
 * One-shot clock-skew log. Pinned message format.
 */
const logClockSkew = (deviceId: string, frameTs: Date, lastSeenFrameTs: Date | null): void => {
  console.warn(
    `[debounce] clock skew device=${deviceId} frameTs=${frameTs.toISOString()} lastSeen=${lastSeenFrameTs?.toISOString() ?? "null"}`,
  );
};

/**
 * Index rules by slot key. If multiple rules hit the same slot
 * (e.g. range halves on `(ph, critical)`), the FIRST valid rule wins;
 * subsequent rules for the same slot are ignored — matches the
 * FR-14 "share one timer" semantics.
 */
const indexRulesBySlot = (rules: readonly EngineRule[]): Map<string, EngineRule> => {
  const rulesBySlot = new Map<string, EngineRule>();
  for (const rule of rules) {
    if (!isValidDuration(rule.minDurationSeconds) || !isValidDuration(rule.hysteresisSeconds)) {
      console.warn(
        `[debounce] skipped poison ruleId=${rule.id} minDurationSeconds=${rule.minDurationSeconds} hysteresisSeconds=${rule.hysteresisSeconds}`,
      );
      continue;
    }
    const key = slotKey(rule.metric, rule.severity);
    if (!rulesBySlot.has(key)) rulesBySlot.set(key, rule);
  }
  return rulesBySlot;
};

/**
 * Collect the set of slots that fired this frame (raw breaches).
 */
const collectBreachSlots = (rawBreaches: readonly BreachResult[]): Set<string> => {
  const slots = new Set<string>();
  for (const b of rawBreaches) slots.add(slotKey(b.metric, b.severity));
  return slots;
};

/**
 * The per-slot IO result. `transition` is the IO request (or `null`
 * for "no transition this frame"); `nextSlot` is the slot's
 * post-frame state to persist.
 */
interface AdvanceSlotResult {
  readonly transition: BreachTransition | null;
  readonly nextSlot: DebounceSlot;
}

/**
 * Advance one slot one frame. Pure: input + rules → output. Mirrors
 * the AC1/AC2/AC3 logic in the spec's I/O Matrix.
 */
const advanceSlot = (args: {
  readonly key: string;
  readonly rule: EngineRule | undefined;
  readonly prevSlot: DebounceSlot | undefined;
  readonly isBreach: boolean;
  readonly isClockSkew: boolean;
  readonly frameTs: Date;
  readonly deviceId: string;
}): AdvanceSlotResult => {
  const { rule, prevSlot, isBreach, isClockSkew, frameTs, deviceId } = args;

  // Clock-skew clamp on both fields.
  const inViolationSince = isClockSkew ? frameTs : (prevSlot?.inViolationSince ?? null);
  const clearedSince = isClockSkew ? frameTs : (prevSlot?.clearedSince ?? null);

  if (isBreach) {
    return advanceSlotRising({
      rule,
      inViolationSince,
      clearedSince,
      frameTs,
      deviceId,
    });
  }
  return advanceSlotFalling({
    rule,
    inViolationSince,
    clearedSince,
    frameTs,
    deviceId,
  });
};

/**
 * Rising-edge path: a raw breach is present for this slot.
 */
const advanceSlotRising = (args: {
  readonly rule: EngineRule | undefined;
  readonly inViolationSince: Date | null;
  readonly clearedSince: Date | null;
  readonly frameTs: Date;
  readonly deviceId: string;
}): AdvanceSlotResult => {
  const { rule, frameTs, deviceId } = args;
  // Stale-state-no-rule: rule deactivated, raw breach arrived
  // without a backing rule. State row left untouched per spec.
  if (rule === undefined) {
    return {
      transition: null,
      nextSlot: { inViolationSince: args.inViolationSince, clearedSince: args.clearedSince },
    };
  }
  // Initialize `inViolationSince` on first breach of this rising run
  // (null → frameTs). On subsequent frames of the same rising run,
  // it stays at the original timestamp.
  let { inViolationSince } = args;
  if (inViolationSince === null) inViolationSince = frameTs;
  // Rising wins over the previous falling — reset `clearedSince`.
  const clearedSince: Date | null = null;
  // Emit `open` when the rising timer has elapsed.
  const elapsedMs = frameTs.getTime() - inViolationSince.getTime();
  const minMs = secondsToMs(rule.minDurationSeconds);
  const transition: BreachTransition | null =
    elapsedMs >= minMs
      ? {
          kind: "open",
          alertId: "pending",
          ruleId: rule.id,
          deviceId,
          metric: rule.metric,
          severity: rule.severity,
          openedAt: frameTs,
        }
      : null;
  return { transition, nextSlot: { inViolationSince, clearedSince } };
};

/**
 * Falling-edge path: no raw breach for this slot.
 */
const advanceSlotFalling = (args: {
  readonly rule: EngineRule | undefined;
  readonly inViolationSince: Date | null;
  readonly clearedSince: Date | null;
  readonly frameTs: Date;
  readonly deviceId: string;
}): AdvanceSlotResult => {
  const { rule, frameTs, deviceId } = args;
  // Stale-state-no-rule: state row stays untouched.
  if (rule === undefined) {
    return {
      transition: null,
      nextSlot: { inViolationSince: args.inViolationSince, clearedSince: args.clearedSince },
    };
  }
  // Initialize `clearedSince` on first frame of this falling run.
  // `inViolationSince` is preserved so a brief blip followed by
  // recovery does NOT restart the rising timer (per AC1
  // pause-not-reset).
  let { clearedSince } = args;
  if (clearedSince === null) clearedSince = frameTs;

  // Emit `clear` when the falling timer has elapsed AND an open
  // alert exists. On emit, null out `inViolationSince` so the next
  // rising edge starts a fresh timer — the alert row is now closed
  // and the slot returns to "no longer in violation" semantics.
  // (AC1's pause-not-reset applies to the drop-frame BETWEEN rising
  // and clear; once the clear emits, `inViolationSince` resets.)
  const hystMs = secondsToMs(rule.hysteresisSeconds);
  const elapsedMs = frameTs.getTime() - clearedSince.getTime();
  const shouldEmitClear = elapsedMs >= hystMs && args.inViolationSince !== null;
  const transition: BreachTransition | null = shouldEmitClear
    ? {
        kind: "clear",
        alertId: "pending",
        deviceId,
        metric: rule.metric,
        severity: rule.severity,
        clearedAt: frameTs,
      }
    : null;
  return {
    transition,
    nextSlot: {
      inViolationSince: shouldEmitClear ? null : args.inViolationSince,
      clearedSince,
    },
  };
};
