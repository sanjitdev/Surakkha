/**
 * Rule engine hook wiring — Story 3.2.
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

import { type ActiveRuleCache, GLOBAL_DEVICE_SENTINEL, lookupRulesForFrame } from "./cache";
import {
  type BreachResult,
  EMPTY_BREACH_RESULTS,
  type EngineObservation,
  evaluateRules,
} from "./engine";

import type { PrismaRuleReader } from "./prismaReader";
import type { ReadingRepository } from "../ingest/frame";

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
 * The frame's metric order in the wire payload is stable; we pick
 * the FIRST declared metric on the frame that has at least one rule
 * in the cache (global or device-scoped). v1's rule pipeline evaluates
 * ONE metric per frame; this is the routing rule.
 *
 * The spec's frame-to-observation test pins `ph` for a frame carrying
 * `{ph: 8.5, tds_ppm: 0}` against a cache holding a `ph` rule.
 */

export interface InstallRuleEngineHooksDeps {
  readonly cache: ActiveRuleCache;
  readonly prisma: PrismaRuleReader;
  readonly readingRepository: ReadingRepository;
}

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
 * Build the four `IngestHooks` methods. The first parameter is the
 * cache that was hydrated once at api boot (`hydrateActiveRuleCache`).
 * `prisma` is held only for symmetry with the future Story 3.7
 * hot-reload hook — the engine is read-only against `Rule` at eval
 * time. `readingRepository` is the seam the rate/absence rules
 * query through.
 */
export const installRuleEngineHooks = (deps: InstallRuleEngineHooksDeps): IngestHooks => {
  const onRuleEvaluation = async (input: RuleEvaluationInput): Promise<readonly BreachResult[]> => {
    const metric = pickFrameMetric(deps.cache, input.deviceId, input.frame.metrics);
    if (metric === null) {
      return EMPTY_BREACH_RESULTS;
    }
    const observedAt = new Date(input.frame.ts);
    const rules = lookupRulesForFrame(deps.cache, input.deviceId, metric);
    if (rules.length === 0) {
      return EMPTY_BREACH_RESULTS;
    }
    // Single window query per frame (covers rate + absence).
    const recentReadings = await buildRecentReadings(deps.readingRepository, {
      deviceId: input.deviceId,
      metric,
      observedAt,
    });
    // Read the metric value off the inbound frame; the engine does
    // not touch the raw frame — this is the seam that pins the
    // frame→observation projection.
    const metricValue = input.frame.metrics[metric];
    if (typeof metricValue !== "number") {
      return EMPTY_BREACH_RESULTS;
    }
    const observation: EngineObservation = {
      deviceId: input.deviceId,
      metric,
      value: metricValue,
      observedAt,
      recentReadings,
    };
    return evaluateRules(rules, observation);
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
 * Test-only escape hatch. Resets the module-level `currentHooks`
 * in `packages/api/src/ingest/hooks.ts` to the no-op default. The
 * boot path never calls this — only Story 3.2's `hooks.spec.ts`
 * (test h) uses it to prove reset works after `uninstallRuleEngineHooks()`.
 */
export const uninstallRuleEngineHooks = (): void => {
  resetIngestHooks();
};
