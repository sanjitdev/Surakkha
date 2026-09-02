/**
 * Rule-engine hook wiring. `installRuleEngineHooks(...)` returns the
 * four `IngestHooks` methods so api boot can wire them via
 * `setIngestHooks(...)`. `onRuleEvaluation` is the only method with
 * real work; the other three delegate to the no-op default.
 *
 * The rate-rule pre-filter chain runs in this EXACT order (pinned by
 * `hooks.spec.ts`):
 *   1. `findMany` over the last 60s of `Reading` rows for
 *      `(deviceId, metric)` — engine-side window query.
 *   2. Sort ascending by `ts`.
 *   3. Drop rows with `ts > observation.observedAt` (clock-skew).
 *   4. Dedupe by `ts` (last-write-wins).
 *   5. Slice to last 5.
 *
 * Boot guard: `installRuleEngineHooks` scans the active Rule cache
 * for any rule with BOTH `minDurationSeconds === 0` AND
 * `hysteresisSeconds === 0` BEFORE installing hooks. If found, it
 * throws `WriteAmplificationError` so the api process exits 78
 * (`EX_CONFIG`).
 */
import { RULE_METRICS, type RuleMetric } from "@surakkha/shared";

import {
  type AlertEmissionInput,
  type AuditAppendInput,
  type IngestHooks,
  resetIngestHooks,
  type RuleEvaluationInput,
  type StateMachineUpdateInput,
} from "../ingest/hooks";

import { type AlertStateRepository } from "./alertStateRepository";
import { applyTransition, persistStateSlot } from "./applyTransition";
import { type ActiveRuleCache, GLOBAL_DEVICE_SENTINEL, lookupRulesForFrame } from "./cache";
import { type BreachTransition, debounceBreaches, type DebounceState } from "./debounce";
import {
  type BreachResult,
  EMPTY_BREACH_RESULTS,
  type EngineObservation,
  type EngineRule,
  evaluateRules,
} from "./engine";
import { type PrismaAlertReader } from "./findOpenAlert";

import type { PrismaRuleReader } from "./prismaReader";
import type { BroadcastTarget, ReadingRepository } from "../ingest/frame";

/** Window the hook queries for rate-rule `recentReadings`. */
const RATE_WINDOW_MS = 60_000;

/** Maximum rows the engine consumes for the slope calculation. */
const RATE_MAX_POINTS = 5;

/** Stable exit code for "configuration error" (sysexits.h EX_CONFIG).
 *  The api process exits with this code when the write-amplification
 *  boot guard fires. */
const EX_CONFIG = 78;

/** Boot-guard error. Thrown by `installRuleEngineHooks` when the
 *  active Rule cache contains ONE OR MORE rules with BOTH
 *  `minDurationSeconds === 0` AND `hysteresisSeconds === 0`. The api
 *  boot path catches this error type and exits 78 (EX_CONFIG); any
 *  other error falls back to `NOOP_HOOKS` (transient DB outages
 *  degrade gracefully; configuration errors do not).
 *  `ruleIds` enumerates EVERY offender so operators see all in one
 *  boot failure rather than fixing one at a time. */
export class WriteAmplificationError extends Error {
  override readonly name = "WriteAmplificationError";
  constructor(public readonly ruleIds: readonly string[]) {
    super(
      `[debounce] write-amplification guard: ${ruleIds.length} offender(s) with min=0 AND hysteresis=0: ruleIds=[${ruleIds.join(", ")}]; refusing to install hooks`,
    );
  }
}

export interface InstallRuleEngineHooksDeps {
  readonly cache: ActiveRuleCache;
  readonly prisma: PrismaRuleReader;
  readonly readingRepository: ReadingRepository;
  readonly alertReader: PrismaAlertReader;
  readonly alertState: AlertStateRepository;
  readonly broadcast?: BroadcastTarget;
  /** Optional override for the per-process `lastSeenFrameTs` Map
   *  (test seam; production builds it inline in
   *  `installRuleEngineHooks`). */
  readonly lastSeenFrameTs?: Map<string, Date>;
}

// Re-exported here for back-compat with existing import sites.
export type { AlertStateRepository } from "./alertStateRepository";
export { resolveAlertStateRepository } from "./alertStateRepository";

/** Default no-op broadcast. Production injects the real `io.to(...)`
 *  via the `broadcast` dep; this default is a defence-in-depth so
 *  tests that forget to pass `broadcast` do not crash. */
const noopBroadcast: BroadcastTarget = {
  to(_room: string) {
    return { emit: (_event: string, _payload: unknown): unknown => undefined };
  },
};

/** Pick the first frame metric that has at least one rule (global or
 *  device-scoped) in the cache. Defense-in-depth: validates the
 *  frame's metric keys against the closed `RULE_METRICS` enum
 *  (upstream Zod guarantees this, but a typo that drifts past Zod
 *  would otherwise be silently cast and dropped at lookup time). */
const pickFrameMetric = (
  cache: ActiveRuleCache,
  deviceId: string,
  frameMetrics: Readonly<Record<string, number>>,
): RuleMetric | null => {
  const validKeys = new Set<string>(RULE_METRICS);
  const keys = Object.keys(frameMetrics);
  for (const k of keys) {
    if (!validKeys.has(k)) continue;
    const typedKey = k as RuleMetric;
    const globalCount =
      cache.byDeviceMetric.get(`${GLOBAL_DEVICE_SENTINEL}::${typedKey}`)?.length ?? 0;
    const deviceCount = cache.byDeviceMetric.get(`${deviceId}::${typedKey}`)?.length ?? 0;
    if (globalCount + deviceCount > 0) return typedKey;
  }
  return null;
};

/** Pre-filter chain (rate + absence share the same chain — the engine
 *  only differs in how it interprets `recentReadings`). Order is
 *  load-bearing (see file header). */
const buildRecentReadings = async (
  readingRepository: ReadingRepository,
  args: {
    readonly deviceId: string;
    readonly metric: RuleMetric;
    readonly observedAt: Date;
  },
): Promise<ReadonlyArray<{ readonly ts: Date; readonly value: number }>> => {
  const since = new Date(args.observedAt.getTime() - RATE_WINDOW_MS);
  const rows = await readingRepository.reading.findMany({
    where: { deviceId: args.deviceId, metric: args.metric, ts: { gte: since } },
    orderBy: { ts: "asc" },
    take: RATE_MAX_POINTS,
  });
  // Sort ascending (defence-in-depth against DB-side ORDER BY drift).
  const sorted = [...rows].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  // Drop future-ts (clock-skew guard).
  const futureDropped = sorted.filter((r) => r.ts.getTime() <= args.observedAt.getTime());
  // Dedupe by ts keeping the latest value. `Number.isFinite` rejects
  // NaN / Infinity from a buggy sensor — a non-finite value would
  // poison `computeSlope`.
  const valueByTs = new Map<number, number>();
  for (const r of futureDropped) {
    const v = r.metrics[args.metric];
    if (typeof v === "number" && Number.isFinite(v)) {
      valueByTs.set(r.ts.getTime(), v);
    }
  }
  return [...valueByTs.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-RATE_MAX_POINTS)
    .map(([ts, value]) => ({ ts: new Date(ts), value }));
};

/** Build the de-bounce `DebounceState` shape from the loaded
 *  `RuleDebounceState` rows. Slot key format matches the pure module's
 *  `slotKey` (`${metric}|${severity}`). */
const buildDebounceState = (
  rows: ReadonlyArray<{
    readonly metric: RuleMetric;
    readonly severity: "info" | "warning" | "critical";
    readonly inViolationSince: Date | null;
    readonly clearedSince: Date | null;
  }>,
): DebounceState => {
  const state: Record<string, { inViolationSince: Date | null; clearedSince: Date | null }> = {};
  for (const r of rows) {
    // NUL delimiter matches the pure module's `slotKey`.
    state[`${r.metric}\u0000${r.severity}`] = {
      inViolationSince: r.inViolationSince,
      clearedSince: r.clearedSince,
    };
  }
  return state;
};

/** Per-frame target resolution: pick the metric the engine evaluates
 *  this frame against, plus the observed timestamp + the metric value
 *  read off the frame. Returns `null` if no rule applies or the
 *  metric value is missing/malformed. */
interface EvaluationTarget {
  readonly metric: RuleMetric;
  readonly observedAt: Date;
  readonly metricValue: number;
}
const resolveEvaluationTarget = (
  cache: ActiveRuleCache,
  input: RuleEvaluationInput,
): EvaluationTarget | null => {
  const metric = pickFrameMetric(cache, input.deviceId, input.frame.metrics);
  if (metric === null) return null;
  const observedAt = new Date(input.frame.ts);
  const metricValue = input.frame.metrics[metric];
  if (typeof metricValue !== "number") return null;
  return { metric, observedAt, metricValue };
};

/** Run the engine + de-bounce flow. Extracted from `onRuleEvaluation`
 *  to keep the calling function under the complexity ceiling. The
 *  returns are `(rawBreaches, transitions, nextState)` — the call
 *  site applies the IO side effects (Alert row writes, socket emits,
 *  state upserts) outside this helper so the helper itself is pure
 *  of socket IO. */
interface DebounceRunResult {
  readonly rawBreaches: readonly BreachResult[];
  readonly transitions: readonly BreachTransition[];
  readonly nextState: DebounceState;
}
const runDebounce = async (args: {
  readonly deps: InstallRuleEngineHooksDeps;
  readonly input: RuleEvaluationInput;
  readonly metric: RuleMetric;
  readonly metricValue: number;
  readonly observedAt: Date;
  readonly rules: readonly EngineRule[];
  readonly lastSeenFrameTs: Map<string, Date>;
}): Promise<DebounceRunResult> => {
  const { deps, input, metric, metricValue, observedAt, rules, lastSeenFrameTs } = args;

  const recentReadings = await buildRecentReadings(deps.readingRepository, {
    deviceId: input.deviceId,
    metric,
    observedAt,
  });
  const observation: EngineObservation = {
    deviceId: input.deviceId,
    metric,
    value: metricValue,
    observedAt,
    recentReadings,
  };
  const rawBreaches = evaluateRules(rules, observation);

  // Load RuleDebounceState for the (deviceId, …) tuple touched by
  // rules OR rawBreaches. The slot key set is the union of
  // `(metric, severity)` for both rule rows and breach rows.
  const slotSpecs = new Map<
    string,
    { metric: RuleMetric; severity: "info" | "warning" | "critical" }
  >();
  for (const r of rules as readonly EngineRule[]) {
    slotSpecs.set(`${r.metric}\u0000${r.severity}`, { metric: r.metric, severity: r.severity });
  }
  for (const b of rawBreaches) {
    slotSpecs.set(`${b.metric}\u0000${b.severity}`, { metric: b.metric, severity: b.severity });
  }
  const stateRows =
    slotSpecs.size > 0
      ? await deps.alertState.ruleDebounceState.findMany({
          where: {
            deviceId: input.deviceId,
            OR: [...slotSpecs.values()].map((s) => ({
              metric: s.metric,
              severity: s.severity,
            })),
          },
        })
      : [];
  const currentState = buildDebounceState(stateRows);

  const lastTs = lastSeenFrameTs.get(input.deviceId) ?? null;
  const { transitions, nextState } = debounceBreaches({
    rawBreaches,
    currentState,
    rules,
    frameTs: observedAt,
    deviceId: input.deviceId,
    lastSeenFrameTs: lastTs,
  });

  return { rawBreaches, transitions, nextState };
};

/** Build the four `IngestHooks` methods. The first parameter is the
 *  cache that was hydrated once at api boot (`hydrateActiveRuleCache`).
 *  `prisma` is held only for symmetry with the future hot-reload
 *  hook; the engine is read-only against `Rule` at eval time. */
export const installRuleEngineHooks = (deps: InstallRuleEngineHooksDeps): IngestHooks => {
  // Boot guard — scans the active Rule cache and collects EVERY
  // offender with `min=0 AND hysteresis=0`, then throws a single
  // error enumerating them all. Operators with many bad configs see
  // every offending ruleId in one boot failure.
  const offenders: string[] = [];
  for (const rule of deps.cache.byId.values()) {
    if (rule.minDurationSeconds === 0 && rule.hysteresisSeconds === 0) {
      console.warn(
        `[debounce] write-amplification guard: ruleId=${rule.id} has min=0 AND hysteresis=0`,
      );
      offenders.push(rule.id);
    }
  }
  if (offenders.length > 0) {
    throw new WriteAmplificationError(offenders);
  }

  const broadcast: BroadcastTarget = deps.broadcast ?? noopBroadcast;
  // Process-local Map for clock-skew detection. Postgres
  // `inViolationSince` is authoritative; this map is a best-effort
  // optimization for early skew detection.
  const lastSeenFrameTs: Map<string, Date> = deps.lastSeenFrameTs ?? new Map<string, Date>();

  const onRuleEvaluation = async (input: RuleEvaluationInput): Promise<readonly BreachResult[]> => {
    const resolved = resolveEvaluationTarget(deps.cache, input);
    if (resolved === null) return EMPTY_BREACH_RESULTS;
    const { metric, observedAt, metricValue } = resolved;

    const rules = lookupRulesForFrame(deps.cache, input.deviceId, metric);
    if (rules.length === 0) return EMPTY_BREACH_RESULTS;

    const { rawBreaches, transitions, nextState } = await runDebounce({
      deps,
      input,
      metric,
      metricValue,
      observedAt,
      rules,
      lastSeenFrameTs,
    });
    // Update the clock-skew guard AT THE END of the IO path, not
    // before, so a failed `applyTransition` / `persistStateSlot`
    // does NOT skew the next frame's clock-skew detection. The
    // try/finally keeps the original ordering invariant (the pure
    // call must not see the current frame's ts) while ensuring IO
    // failure does not leak into the next frame.
    let ioSucceeded = false;
    try {
      // IO side effects — transitions are NOT returned; the hook's
      // return type stays `Promise<readonly BreachResult[]>`. Each
      // transition triggers an Alert row write + state upsert
      // wrapped in a single `$transaction`. The socket emit (open
      // only) happens AFTER the transaction commits.
      const transitionSlots = new Set<string>();
      for (const transition of transitions) {
        const key = `${transition.metric}\u0000${transition.severity}`;
        const slot = nextState[key];
        if (slot === undefined) continue; // pure module should always provide it
        transitionSlots.add(key);
        await applyTransition(deps, {
          broadcast,
          ctx: { deviceId: input.deviceId, metricValue },
          transition,
          slot,
        });
      }

      // Persist the updated state for the slots that did NOT
      // transition. Best-effort: a transient DB outage on the state
      // row write logs but does not fail the eval path.
      for (const [key, slot] of Object.entries(nextState)) {
        if (transitionSlots.has(key)) continue; // already upserted inside the transaction
        const [m, s] = key.split("\u0000") as [RuleMetric, "info" | "warning" | "critical"];
        await persistStateSlot(deps, {
          deviceId: input.deviceId,
          slotKey: { metric: m, severity: s },
          slot,
        });
      }
      ioSucceeded = true;
    } finally {
      // Only update the clock-skew guard if IO completed. On IO
      // failure we leave the prior timestamp in place so the next
      // frame re-evaluates against the same `lastTs`.
      if (ioSucceeded) {
        lastSeenFrameTs.set(input.deviceId, observedAt);
      }
    }

    return rawBreaches;
  };

  // Silence the "unused" lint for `prisma` — the hot-reload path
  // will wire it in.
  void deps.prisma;

  return {
    onRuleEvaluation,
    onAlertEmission: async (_input: AlertEmissionInput): Promise<void> => undefined,
    onStateMachineUpdate: async (_input: StateMachineUpdateInput): Promise<void> => undefined,
    onAuditAppend: async (_input: AuditAppendInput): Promise<void> => undefined,
  };
};

/** Test-only escape hatch. Resets the module-level `currentHooks`
 *  to the no-op default. The boot path never calls this. */
export const uninstallRuleEngineHooks = (): void => {
  resetIngestHooks();
};

// Re-export for callers that want the EX_CONFIG exit code.
export { EX_CONFIG };
