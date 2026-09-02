/**
 * Pure de-bounce core. Converts raw `BreachResult[]` (one frame) into
 * `BreachTransition[]` (open / clear events) by advancing rising-edge
 * / falling-edge timers per `(deviceId, metric, severity)` slot. No
 * DB IO — the hook layer composes this module with Prisma.
 *
 * Why pure (mirrors `engine.ts`'s seam):
 *   - Unit tests run without `vi.mock("@prisma/client")`.
 *   - Same input → same output; deterministic.
 *
 * Clock-skew handling: when `frameTs < lastSeenFrameTs`, both
 * `inViolationSince` and `clearedSince` clamp forward to `frameTs`
 * and the function emits a `console.warn`. Auto-recovery on the
 * next in-order frame.
 */

import type { BreachResult, EngineRule } from "./engine";
import type { RuleMetric, RuleSeverity } from "@surakkha/shared";

/** One slot of de-bounce state — the per-(deviceId, metric, severity)
 *  pair of nullable timestamps. `null` means "not currently timing
 *  for that edge". On a rising edge, `clearedSince` resets to `null`
 *  (rising wins over the previous falling). On a falling edge,
 *  `inViolationSince` is preserved (pause-not-reset). */
export interface DebounceSlot {
  readonly inViolationSince: Date | null;
  readonly clearedSince: Date | null;
}

/** The full per-device state passed into `debounceBreaches`. Keyed by
 *  a stable string form of `(metric, severity)`. Missing keys = no
 *  state for that slot yet. */
export type DebounceState = Readonly<Record<string, DebounceSlot>>;

/** The IO side-effect emitted by the hook (NOT the hook's return
 *  value — the shared `IngestHooks.onRuleEvaluation` interface returns
 *  `Promise<readonly BreachResult[]>`). Discriminated by `kind`. */
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

/** Pure-module result. `transitions` is the IO action set the hook
 *  applies; `nextState` is the updated `DebounceState` the hook
 *  persists. */
export interface DebounceResult {
  readonly transitions: readonly BreachTransition[];
  readonly nextState: DebounceState;
}

/** Input shape for `debounceBreaches`. `lastSeenFrameTs` is used only
 *  for clock-skew detection — `null` means "no prior frame for this
 *  device" (post-restart; the clamp is silently skipped). */
export interface DebounceArgs {
  readonly rawBreaches: readonly BreachResult[];
  readonly currentState: DebounceState;
  readonly rules: readonly EngineRule[];
  readonly frameTs: Date;
  readonly deviceId: string;
  readonly lastSeenFrameTs: Date | null;
}

/** Internal: the slot key for `(metric, severity)`. NUL delimiter —
 *  NUL is illegal in every metric + severity literal, so the slot key
 *  is unambiguous. */
const slotKey = (metric: RuleMetric, severity: RuleSeverity): string =>
  `${metric}\u0000${severity}`;

/** Returns true when the field is a valid finite, non-negative integer
 *  (treated as seconds). Reject fractional values — Prisma's `Int`
 *  column silently floors `0.5` on write, which would trip the boot
 *  guard on the next reload. */
const isValidDuration = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v);

/** Convert seconds to milliseconds for arithmetic against `frameTs`. */
const secondsToMs = (seconds: number): number => seconds * 1000;

/** Pure module entry. */
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
  // advance falling-edge even when a rule exists but didn't fire this
  // frame. Slots present in `breachSlots` but NOT in `rulesBySlot`
  // (rule deactivated) leave their state row untouched.
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

/** Clock-skew detection helper. */
const detectClockSkew = (frameTs: Date, lastSeenFrameTs: Date | null): boolean =>
  lastSeenFrameTs !== null && frameTs.getTime() < lastSeenFrameTs.getTime();

/** One-shot clock-skew log. Pinned message format. */
const logClockSkew = (deviceId: string, frameTs: Date, lastSeenFrameTs: Date | null): void => {
  console.warn(
    `[debounce] clock skew device=${deviceId} frameTs=${frameTs.toISOString()} lastSeen=${lastSeenFrameTs?.toISOString() ?? "null"}`,
  );
};

/** Index rules by slot key. If multiple rules hit the same slot
 *  (e.g. range halves on `(ph, critical)`), the FIRST valid rule wins.
 *  Sort the input list deterministically by `(threshold, rule.id)`
 *  before the loop so the winner is stable across hot-reloads. ICU
 *  collation is locale-dependent — use plain string compare for the
 *  id tiebreak so multi-replica deploys agree. */
const indexRulesBySlot = (rules: readonly EngineRule[]): Map<string, EngineRule> => {
  const rulesBySlot = new Map<string, EngineRule>();
  const sortedRules = [...rules].sort((a, b) => {
    if (a.threshold !== b.threshold) return a.threshold - b.threshold;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  for (const rule of sortedRules) {
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

/** Collect the set of slots that fired this frame (raw breaches). */
const collectBreachSlots = (rawBreaches: readonly BreachResult[]): Set<string> => {
  const slots = new Set<string>();
  for (const b of rawBreaches) slots.add(slotKey(b.metric, b.severity));
  return slots;
};

/** The per-slot IO result. `transition` is the IO request (or `null`
 *  for "no transition this frame"); `nextSlot` is the slot's
 *  post-frame state to persist. */
interface AdvanceSlotResult {
  readonly transition: BreachTransition | null;
  readonly nextSlot: DebounceSlot;
}

/** Advance one slot one frame. Pure: input + rules → output. */
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

/** Rising-edge path: a raw breach is present for this slot. */
const advanceSlotRising = (args: {
  readonly rule: EngineRule | undefined;
  readonly inViolationSince: Date | null;
  readonly clearedSince: Date | null;
  readonly frameTs: Date;
  readonly deviceId: string;
}): AdvanceSlotResult => {
  const { rule, frameTs, deviceId } = args;
  // Stale-state-no-rule: rule deactivated, raw breach arrived
  // without a backing rule. State row left untouched.
  if (rule === undefined) {
    return {
      transition: null,
      nextSlot: { inViolationSince: args.inViolationSince, clearedSince: args.clearedSince },
    };
  }
  // Initialize `inViolationSince` on first breach of this rising run
  // (null → frameTs). On subsequent frames it stays at the original
  // timestamp.
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

/** Falling-edge path: no raw breach for this slot. */
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
  // recovery does NOT restart the rising timer (pause-not-reset).
  let { clearedSince } = args;
  if (clearedSince === null) clearedSince = frameTs;

  // Emit `clear` when the falling timer has elapsed AND an open
  // alert exists. On emit, null out `inViolationSince` so the next
  // rising edge starts a fresh timer.
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
