/**
 * Rule-engine hook wiring. `installRuleEngineHooks` returns the four
 * `IngestHooks` methods. `onRuleEvaluation` is the only method with
 * real work; the other three delegate to the no-op default.
 *
 * Boot guard: `installRuleEngineHooks` scans the active Rule cache
 * for any rule with BOTH `minDurationSeconds === 0` AND
 * `hysteresisSeconds === 0` BEFORE installing hooks and throws
 * `WriteAmplificationError` so the api process exits 78 (`EX_CONFIG`).
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

/** Number of metric values packed into the Reading `metrics` JSONB
 *  column (pH / TDS / turbidity / temp / DO / ORP / conductivity /
 *  battery). The over-fetch below multiplies by this count so the
 *  per-metric extraction at line 129 has enough rows to pick from
 *  even when the latest frames only contain a subset of metrics. */
const RATE_METRICS_PER_FRAME = 8;

/** Stable exit code for "configuration error" (sysexits.h EX_CONFIG).
 *  The api process exits with this code when the write-amplification
 *  boot guard fires. */
const EX_CONFIG = 78;

/** Boot-guard error. Thrown when the active Rule cache contains a rule
 *  with BOTH `minDurationSeconds === 0` AND `hysteresisSeconds === 0`.
 *  `ruleIds` enumerates EVERY offender so operators see all in one
 *  boot failure. */
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
 *  via the `broadcast` dep. */
const noopBroadcast: BroadcastTarget = {
  to(_room: string) {
    return { emit: (_event: string, _payload: unknown): unknown => undefined };
  },
};

/** Pick the first frame metric with at least one rule (global or
 *  device-scoped). Validates against the closed `RULE_METRICS` enum. */
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

/** Pre-filter chain for rate + absence rules. Order is load-bearing. */
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
    where: { deviceId: args.deviceId, ts: { gte: since } },
    orderBy: { ts: "asc" },
    // FR-2 stores per-frame readings as one row per timestamp with the
    // eight metric values packed into a `metrics` JSONB column. There
    // is no per-metric `metric` column — the per-metric value is
    // extracted at the application layer (line 129, `r.metrics[metric]`),
    // so the DB-side WHERE filters on `(deviceId, ts)` only and lets
    // the loop below pick out the metric it needs.
    take: RATE_MAX_POINTS * RATE_METRICS_PER_FRAME,
  });
  // Sort ascending (defence-in-depth against DB-side ORDER BY drift).
  const sorted = [...rows].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  // Drop future-ts (clock-skew guard).
  const futureDropped = sorted.filter((r) => r.ts.getTime() <= args.observedAt.getTime());
  // Dedupe by ts keeping the latest value; reject NaN/Infinity.
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
 *  `RuleDebounceState` rows. Slot key format: NUL-delimited
 *  `${metric}\u0000${severity}`. */
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
    state[`${r.metric}\u0000${r.severity}`] = {
      inViolationSince: r.inViolationSince,
      clearedSince: r.clearedSince,
    };
  }
  return state;
};

/** Per-frame target resolution: pick the metric, observed timestamp,
 *  and metric value. Returns `null` if no rule applies or the metric
 *  value is missing/malformed. */
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

/** Run the engine + de-bounce flow. Returns `(rawBreaches, transitions,
 *  nextState)`. The call site applies the IO side effects (Alert row
 *  writes, socket emits, state upserts) outside this helper. */
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

  // Slot key set is the union of `(metric, severity)` for both rule
  // rows and breach rows.
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

/** Build the four `IngestHooks` methods. `prisma` is held for the
 *  future hot-reload hook; the engine is read-only against `Rule`
 *  at eval time. */
export const installRuleEngineHooks = (deps: InstallRuleEngineHooksDeps): IngestHooks => {
  // Boot guard — collect every offender with `min=0 AND hysteresis=0`.
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
  // Process-local Map for clock-skew detection.
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
    // Update the clock-skew guard AFTER IO completes — a failed
    // `applyTransition` / `persistStateSlot` must not skew the next
    // frame's clock-skew detection.
    let ioSucceeded = false;
    try {
      // IO side effects. Each transition triggers an Alert row write
      // + state upsert wrapped in a single `$transaction`; the
      // socket emit (open only) fires AFTER the transaction commits.
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

      // Persist updated state for slots that did NOT transition.
      // Best-effort: a transient DB outage logs but does not fail.
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
      // Update only if IO completed.
      if (ioSucceeded) {
        lastSeenFrameTs.set(input.deviceId, observedAt);
      }
    }

    return rawBreaches;
  };

  // Reserved for the future hot-reload path.
  void deps.prisma;

  return {
    onRuleEvaluation,
    onAlertEmission: async (_input: AlertEmissionInput): Promise<void> => undefined,
    onStateMachineUpdate: async (_input: StateMachineUpdateInput): Promise<void> => undefined,
    onAuditAppend: async (_input: AuditAppendInput): Promise<void> => undefined,
  };
};

/** Test-only escape hatch. The boot path never calls this. */
export const uninstallRuleEngineHooks = (): void => {
  resetIngestHooks();
};

export { EX_CONFIG };
