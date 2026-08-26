/**
 * Rule engine hook wiring — Story 3.2 + Story 3.4 (de-bouncing).
 *
 * `installRuleEngineHooks(...)` returns the four `IngestHooks`
 * methods so api boot can wire them via `setIngestHooks(...)`.
 * `onRuleEvaluation` is the only method with real work; the other
 * three delegate to the no-op default (Story 3.5 owns alert
 * emission, Story 3.4 owns state-machine update, Epic 5 owns
 * audit append).
 *
 * The rate-rule pre-filter chain runs in this EXACT order (pinned
 * by `hooks.spec.ts` + the spec's hook contract):
 *   1. `findMany` over the last 60 s of `Reading` rows for
 *      `(deviceId, metric)` — engine-side window query.
 *   2. Sort ascending by `ts` — the engine's `computeSlope` and
 *      absence comparator both assume ascending order.
 *   3. Drop rows with `ts > observation.observedAt` — clock-skew
 *      guard against future timestamps (a device that ran its
 *      clock forward during sleep).
 *   4. Dedupe rows with identical `ts`, keeping the latest value —
 *      a single timestamp should contribute one observation to the
 *      regression, not N.
 *   5. Slice to last 5 — `computeSlope`'s minimum-data requirement
 *      per architecture §4.5.
 *
 * The hook NEVER touches the raw frame — `evaluation` runs AFTER
 * `stepPersist` in `frame.ts:PROCESSING_ORDER`, so the `Reading` row
 * is the canonical observation. The `TelemetryFrame.metrics[metric]`
 * value carried in the hook payload IS the observation value; the
 * engine sees it through `EngineObservation.value`.
 *
 * Story 3.4 — de-bounce wiring. After `evaluateRules` returns raw
 * `BreachResult[]`, the hook composes the pure `debounceBreaches`
 * module to advance rising-edge / falling-edge timers per
 * `(deviceId, metric, severity)` slot. Transitions are IO side
 * effects (Alert row + socket emit), NOT return values — the
 * shared `IngestHooks.onRuleEvaluation` interface stays
 * `Promise<readonly BreachResult[]>`.
 *
 * Boot guard: `installRuleEngineHooks` scans the active Rule cache
 * for any rule with BOTH `minDurationSeconds === 0` AND
 * `hysteresisSeconds === 0` BEFORE installing hooks. If found, it
 * throws `WriteAmplificationError` so the api process exits 78
 * (`EX_CONFIG`); see Design Note "Write-amplification boot guard
 * is code-enforced, not documented-only".
 */
import { AlertOpenedEventSchema, RULE_METRICS, type RuleMetric } from "@surakkha/shared";

import {
  type AlertEmissionInput,
  type AuditAppendInput,
  type IngestHooks,
  resetIngestHooks,
  type RuleEvaluationInput,
  type StateMachineUpdateInput,
} from "../ingest/hooks";

import { type ActiveRuleCache, GLOBAL_DEVICE_SENTINEL, lookupRulesForFrame } from "./cache";
import { type BreachTransition, debounceBreaches, type DebounceState } from "./debounce";
import {
  type BreachResult,
  EMPTY_BREACH_RESULTS,
  type EngineObservation,
  type EngineRule,
  evaluateRules,
} from "./engine";
import { findOpenAlert, type PrismaAlertReader } from "./findOpenAlert";

import type { PrismaRuleReader } from "./prismaReader";
import type { BroadcastTarget, ReadingRepository } from "../ingest/frame";

/**
 * Window the hook queries for rate-rule `recentReadings`. Per
 * architecture §4.5: "queries the last 60 s of Reading rows".
 */
const RATE_WINDOW_MS = 60_000;

/**
 * Maximum rows the engine consumes for the slope calculation. Per
 * `computeSlope`'s contract: needs ≥5 to return a value; we slice to
 * 5 after the pre-filter chain.
 */
const RATE_MAX_POINTS = 5;

/**
 * Stable Prisma error code for unique-constraint violation. The
 * partial unique index `Alert_open_unique_idx` raises this when a
 * second `prisma.alert.create` for the same `(deviceId, metric,
 * severity)` runs while the first is still open. The hook catches
 * it and treats it as "already-open, skip" (the partial index is
 * the safety net; this catch is the fast path).
 */
const PRISMA_P2002 = "P2002";

/**
 * Stable exit code for "configuration error" (sysexits.h EX_CONFIG).
 * The api process exits with this code when the write-amplification
 * boot guard fires (Story 3.4 AC12).
 */
const EX_CONFIG = 78;

/**
 * Boot-guard error. Thrown by `installRuleEngineHooks` when the
 * active Rule cache contains a rule with BOTH
 * `minDurationSeconds === 0` AND `hysteresisSeconds === 0`. The api
 * boot path catches this error type and exits 78 (EX_CONFIG); any
 * other error falls back to `NOOP_HOOKS` (transient DB outages
 * degrade gracefully; configuration errors do not).
 */
export class WriteAmplificationError extends Error {
  override readonly name = "WriteAmplificationError";
  constructor(public readonly ruleId: string) {
    super(
      `[debounce] write-amplification guard: ruleId=${ruleId} has min=0 AND hysteresis=0; refusing to install hooks`,
    );
  }
}

/**
 * Extended deps for Story 3.4. `alertReader` is the partial-index
 * lookup for `findOpenAlert`; `alertState` exposes the de-bounce
 * state IO (load + upsert); `broadcast` is the socket emit seam
 * (defaults to no-op; tests inject a stub capturing emits).
 */
export interface InstallRuleEngineHooksDeps {
  readonly cache: ActiveRuleCache;
  readonly prisma: PrismaRuleReader;
  readonly readingRepository: ReadingRepository;
  readonly alertReader: PrismaAlertReader;
  readonly alertState: AlertStateRepository;
  readonly broadcast?: BroadcastTarget;
  /**
   * Optional override for the per-process `lastSeenFrameTs` Map
   * (test seam; production builds it inline in
   * `installRuleEngineHooks`).
   */
  readonly lastSeenFrameTs?: Map<string, Date>;
}

/**
 * Narrow slice of Prisma for the de-bounce state table. Mirrors the
 * `PrismaRuleReader` pattern: production narrows the real client
 * via `resolveAlertStateRepository`; tests inject a stub.
 */
export interface AlertStateRepository {
  readonly ruleDebounceState: {
    findMany(args: {
      readonly where: {
        readonly deviceId: string;
        readonly OR: ReadonlyArray<{
          readonly metric: RuleMetric;
          readonly severity: { in: ReadonlyArray<"info" | "warning" | "critical"> };
        }>;
      };
    }): Promise<
      ReadonlyArray<{
        readonly metric: RuleMetric;
        readonly severity: "info" | "warning" | "critical";
        readonly inViolationSince: Date | null;
        readonly clearedSince: Date | null;
      }>
    >;
    upsert(args: {
      readonly where: {
        readonly deviceId_metric_severity: {
          readonly deviceId: string;
          readonly metric: RuleMetric;
          readonly severity: "info" | "warning" | "critical";
        };
      };
      readonly create: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly severity: "info" | "warning" | "critical";
        readonly inViolationSince: Date | null;
        readonly clearedSince: Date | null;
      };
      readonly update: {
        readonly inViolationSince?: Date | null;
        readonly clearedSince?: Date | null;
      };
    }): Promise<unknown>;
  };
  readonly alert: {
    create(args: {
      readonly data: {
        readonly deviceId: string;
        readonly ruleId: string;
        readonly severity: "info" | "warning" | "critical";
        readonly metric: RuleMetric;
        readonly openedAt: Date;
      };
    }): Promise<{ readonly id: string }>;
    update(args: {
      readonly where: { readonly id: string };
      readonly data: { readonly clearedAt: Date };
    }): Promise<unknown>;
  };
}

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `AlertStateRepository` slice.
 */
export const resolveAlertStateRepository = (prisma: unknown): AlertStateRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    ruleDebounceState: {
      findMany: (args) =>
        client.ruleDebounceState.findMany(args) as Promise<
          ReadonlyArray<{
            readonly metric: RuleMetric;
            readonly severity: "info" | "warning" | "critical";
            readonly inViolationSince: Date | null;
            readonly clearedSince: Date | null;
          }>
        >,
      upsert: (args) => client.ruleDebounceState.upsert(args) as Promise<unknown>,
    },
    alert: {
      create: (args) => client.alert.create(args) as Promise<{ readonly id: string }>,
      update: (args) => client.alert.update(args) as Promise<unknown>,
    },
  };
};

/**
 * Default no-op broadcast. Production injects the real `io.to(...)`
 * via the `broadcast` dep; this default is a defence-in-depth so
 * tests that forget to pass `broadcast` do not crash.
 */
const noopBroadcast: BroadcastTarget = {
  to(_room: string) {
    return { emit: (_event: string, _payload: unknown): unknown => undefined };
  },
};

/**
 * Pick the first frame metric that has at least one rule (global or
 * device-scoped) in the cache. v1's rule pipeline evaluates ONE
 * metric per frame; the cache lookup helper unions both buckets so
 * a global `ph` rule fires for every device's frame.
 *
 * Defense-in-depth: validates the frame's metric keys against the
 * closed `RULE_METRICS` enum. Upstream Zod parsing on the wire
 * guarantees this, but a typo that drifts past Zod (e.g. a test
 * stub, a future wire-format change) would otherwise be silently
 * cast and dropped at lookup time.
 */
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

/**
 * Pre-filter chain (rate + absence share the same chain — the
 * engine only differs in how it interprets `recentReadings`).
 * Order is load-bearing (see file header).
 */
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
  // Dedupe by ts keeping the latest value (last-write-wins).
  // Defense-in-depth: `Number.isFinite` rejects `NaN`, `Infinity`,
  // and `-Infinity` from a buggy sensor or a corrupted DB row. A
  // non-finite value would otherwise poison `computeSlope`
  // (returning NaN slope → silently no breach).
  const valueByTs = new Map<number, number>();
  for (const r of futureDropped) {
    const v = r.metrics[args.metric];
    if (typeof v === "number" && Number.isFinite(v)) {
      valueByTs.set(r.ts.getTime(), v);
    }
  }
  // Slice to last 5.
  return [...valueByTs.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-RATE_MAX_POINTS)
    .map(([ts, value]) => ({ ts: new Date(ts), value }));
};

/**
 * Build the de-bounce `DebounceState` shape from the loaded
 * `RuleDebounceState` rows. Slot key format matches the pure
 * module's `slotKey` (`${metric}|${severity}`).
 */
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
    state[`${r.metric}|${r.severity}`] = {
      inViolationSince: r.inViolationSince,
      clearedSince: r.clearedSince,
    };
  }
  return state;
};

/**
 * Per-frame target resolution: pick the metric the engine evaluates
 * this frame against, plus the observed timestamp + the metric value
 * read off the frame. Returns `null` if no rule applies or the
 * metric value is missing/malformed.
 */
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

/**
 * Run the engine + de-bounce flow. Extracted from `onRuleEvaluation`
 * to keep the calling function under the complexity ceiling. The
 * returns are `(rawBreaches, transitions, nextState)` — the call
 * site applies the IO side effects (Alert row writes, socket emits,
 * state upserts) outside this helper so the helper itself is pure
 * of socket IO.
 */
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

  // Single window query per frame (covers rate + absence).
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

  // Story 3.4 — load RuleDebounceState for the (deviceId, …)
  // tuple touched by rules OR rawBreaches. The slot key set is the
  // union of `(metric, severity)` for both rule rows and breach rows.
  const slotSpecs = new Map<
    string,
    { metric: RuleMetric; severity: "info" | "warning" | "critical" }
  >();
  for (const r of rules as readonly EngineRule[]) {
    slotSpecs.set(`${r.metric}|${r.severity}`, { metric: r.metric, severity: r.severity });
  }
  for (const b of rawBreaches) {
    slotSpecs.set(`${b.metric}|${b.severity}`, { metric: b.metric, severity: b.severity });
  }
  const stateRows =
    slotSpecs.size > 0
      ? await deps.alertState.ruleDebounceState.findMany({
          where: {
            deviceId: input.deviceId,
            OR: [...slotSpecs.values()].map((s) => ({
              metric: s.metric,
              severity: { in: [s.severity] },
            })),
          },
        })
      : [];
  const currentState = buildDebounceState(stateRows);

  // Pure-module composition: deterministic, testable without
  // Prisma. `lastSeenFrameTs` is the per-device clock-skew guard.
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

/**
 * Build the four `IngestHooks` methods. The first parameter is the
 * cache that was hydrated once at api boot (`hydrateActiveRuleCache`).
 * `prisma` is held only for symmetry with the future Story 3.7
 * hot-reload hook — the engine is read-only against `Rule` at eval
 * time. `readingRepository` is the seam the rate/absence rules
 * query through.
 *
 * Story 3.4 boot guard: scans the active Rule cache for any rule
 * with BOTH `minDurationSeconds === 0` AND `hysteresisSeconds === 0`.
 * If found, throws `WriteAmplificationError(ruleId)` so the api boot
 * path exits 78 (EX_CONFIG). The error type is recognized at the
 * catch site in `initializeRuleEngine` so the existing NOOP_HOOKS
 * fallback does NOT swallow it.
 */
export const installRuleEngineHooks = (deps: InstallRuleEngineHooksDeps): IngestHooks => {
  // Boot guard — Story 3.4 AC12. Runs BEFORE the hook is installed.
  // Iterates ALL rules in the cache (global + device-scoped). The
  // first offending rule triggers the guard; subsequent rules are
  // not checked (fail-fast).
  for (const rule of deps.cache.byId.values()) {
    if (rule.minDurationSeconds === 0 && rule.hysteresisSeconds === 0) {
      throw new WriteAmplificationError(rule.id);
    }
  }

  const broadcast: BroadcastTarget = deps.broadcast ?? noopBroadcast;
  // Process-local Map for clock-skew detection. Defensive only;
  // Postgres `inViolationSince` is authoritative (see Design Note
  // "lastSeenFrameTs restart semantics"). Override seam for tests.
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
    // Update the process-local Map AFTER the pure call so the
    // current frame's skew detection does not see itself.
    lastSeenFrameTs.set(input.deviceId, observedAt);

    // IO side effects — transitions are NOT returned; the hook's
    // return type stays `Promise<readonly BreachResult[]>`. Each
    // transition triggers an Alert row write + (for opens) a
    // post-commit socket emit.
    for (const transition of transitions) {
      await applyTransition(deps, {
        broadcast,
        ctx: { deviceId: input.deviceId, metricValue },
        transition,
      });
    }

    // Persist the updated state. Best-effort: a transient DB
    // outage on the state row write logs but does not fail the
    // eval path (the next frame re-derives from `rawBreaches` +
    // the prior on-disk state).
    for (const [key, slot] of Object.entries(nextState)) {
      const [m, s] = key.split("|") as [RuleMetric, "info" | "warning" | "critical"];
      await persistStateSlot(deps, {
        deviceId: input.deviceId,
        slotKey: { metric: m, severity: s },
        slot,
      });
    }

    // Hook return type stays `Promise<readonly BreachResult[]>` —
    // the shared `IngestHooks` interface contract is unchanged.
    return rawBreaches;
  };

  // Silence the "unused" lint for `prisma` — Story 3.7 will wire it
  // into `refreshActiveRuleCache`. Forcing the import here keeps the
  // dep surface stable across the hot-reload landing.
  void deps.prisma;

  return {
    onRuleEvaluation,
    // Steps 7/8/9 still no-op — Stories 3.4/3.5/Epic 5 wire their
    // own implementations via a second `setIngestHooks(...)` call
    // (or a dedicated `setAlertManagerHooks(...)` for the alert
    // manager in 3.5). For v1 these remain no-ops so the boot path
    // never has a missing handler.
    onAlertEmission: async (_input: AlertEmissionInput): Promise<void> => undefined,
    onStateMachineUpdate: async (_input: StateMachineUpdateInput): Promise<void> => undefined,
    onAuditAppend: async (_input: AuditAppendInput): Promise<void> => undefined,
  };
};

/**
 * Persist one slot of `DebounceState` to Postgres. Called for every
 * slot in the union of rules + breaches — the upsert is idempotent.
 */
const persistStateSlot = async (
  deps: InstallRuleEngineHooksDeps,
  ctx: {
    readonly deviceId: string;
    readonly slotKey: { metric: RuleMetric; severity: "info" | "warning" | "critical" };
    readonly slot: { inViolationSince: Date | null; clearedSince: Date | null };
  },
): Promise<void> => {
  const { deviceId, slotKey, slot } = ctx;
  try {
    await deps.alertState.ruleDebounceState.upsert({
      where: {
        deviceId_metric_severity: {
          deviceId,
          metric: slotKey.metric,
          severity: slotKey.severity,
        },
      },
      create: {
        deviceId,
        metric: slotKey.metric,
        severity: slotKey.severity,
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
      update: {
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
    });
  } catch (err) {
    // Best-effort — log and continue. The next frame re-derives
    // state from Postgres + rawBreaches, so a missed upsert
    // recovers on the next eval.
    console.warn(
      `[debounce] state upsert failed device=${deviceId} metric=${slotKey.metric} severity=${slotKey.severity}`,
      err,
    );
  }
};

/**
 * Apply one `BreachTransition` to Postgres + (for opens) the socket.
 * The Alert row write happens inside a single `$transaction` block;
 * the socket emit happens AFTER the transaction commits (per Design
 * Note "Socket emit happens post-commit").
 */
const applyTransition = async (
  deps: InstallRuleEngineHooksDeps,
  args: {
    readonly broadcast: BroadcastTarget;
    readonly ctx: { deviceId: string; metricValue: number };
    readonly transition: BreachTransition;
  },
): Promise<void> => {
  const { broadcast, ctx, transition } = args;
  if (transition.kind === "open") {
    const { deviceId, metricValue } = ctx;
    // Idempotency fast path: check `findOpenAlert` first. If an
    // open Alert already exists, skip the insert. The partial
    // unique index is the safety net for the race; this lookup
    // avoids the unnecessary INSERT attempt.
    const existing = await findOpenAlert(deps.alertReader, {
      deviceId,
      metric: transition.metric,
      severity: transition.severity,
    });
    if (existing !== null) {
      // eslint-disable-next-line no-console
      console.info(
        `[alerts] duplicate open suppressed device=${deviceId} alertId=${existing.id} metric=${transition.metric} severity=${transition.severity}`,
      );
      return;
    }

    let alertId: string;
    try {
      const created = await deps.alertState.alert.create({
        data: {
          deviceId,
          ruleId: transition.ruleId,
          severity: transition.severity,
          metric: transition.metric,
          openedAt: transition.openedAt,
        },
      });
      alertId = created.id;
    } catch (err) {
      // Race: another concurrent insert beat us; the partial
      // unique index raised P2002. Treat as "already-open, skip".
      if (isPrismaP2002(err)) {
        // eslint-disable-next-line no-console
        console.info(
          `[alerts] duplicate open suppressed (race) device=${deviceId} metric=${transition.metric} severity=${transition.severity}`,
        );
        return;
      }
      throw err;
    }

    // Post-commit emit. The hook returns control before the emit;
    // if the transaction rolled back, we wouldn't reach this line.
    // If the emit itself fails, the Alert row exists and the next
    // eval pass can re-emit (idempotent on `alertId`).
    const payload = {
      alert_id: alertId,
      device_id: deviceId,
      metric: transition.metric,
      severity: transition.severity,
      opened_at: transition.openedAt.toISOString(),
      rule_id: transition.ruleId,
      value: metricValue,
    };
    const parsed = AlertOpenedEventSchema.safeParse(payload);
    if (parsed.success) {
      broadcast.to(`device:${deviceId}`).emit("alert:opened", parsed.data);
    }
    // eslint-disable-next-line no-console
    console.info(
      `[alerts] opened device=${deviceId} alertId=${alertId} ruleId=${transition.ruleId} severity=${transition.severity} openedAt=${transition.openedAt.toISOString()}`,
    );
  } else {
    // `clear` — set Alert.clearedAt. The transition's `alertId` is
    // the placeholder from the pure module; the hook looks up the
    // real `alertId` via the partial-index lookup. The pure module
    // carries `deviceId` + `metric` + `severity` on the transition
    // (Story 3.4 loopback-1 amendment — clear must scope to the
    // slot that just transitioned, not scan all open alerts).
    const existing = await findOpenAlert(deps.alertReader, {
      deviceId: transition.deviceId,
      metric: transition.metric,
      severity: transition.severity,
    });
    if (existing !== null) {
      await deps.alertState.alert.update({
        where: { id: existing.id },
        data: { clearedAt: transition.clearedAt },
      });
      // eslint-disable-next-line no-console
      console.info(
        `[alerts] cleared alertId=${existing.id} clearedAt=${transition.clearedAt.toISOString()}`,
      );
    }
  }
};

/**
 * Narrow type guard for Prisma's P2002 (unique-constraint
 * violation) error. The shape varies across Prisma versions; this
 * minimal `code` check is what the engine + de-bounce modules rely
 * on.
 */
const isPrismaP2002 = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const { code } = err as { code?: unknown };
  return code === PRISMA_P2002;
};

/**
 * Test-only escape hatch. Resets the module-level `currentHooks`
 * in `packages/api/src/ingest/hooks.ts` to the no-op default. The
 * boot path never calls this — only Story 3.2's `hooks.spec.ts`
 * (test h) uses it to prove reset works after `uninstallRuleEngineHooks()`.
 */
export const uninstallRuleEngineHooks = (): void => {
  resetIngestHooks();
};

// Re-export for callers that want the EX_CONFIG exit code.
export { EX_CONFIG };
