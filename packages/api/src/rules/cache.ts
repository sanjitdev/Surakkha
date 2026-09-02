/**
 * Active-rule cache. In-memory store of every `Rule` row where
 * `isActive = true`, loaded once at api boot via
 * `hydrateActiveRuleCache` and refreshed via `refreshActiveRuleCache`.
 *
 * Per-row rejection: rows whose `ruleType` is anything other than
 * `instant | rate | absence` are SKIPPED with a `console.warn`; the
 * remaining valid rows still load.
 */

import { type EngineRule, requireRuleType } from "./engine";
import { type PrismaRuleReader, type RuleRow } from "./prismaReader";

import type { RuleMetric } from "@surakkha/shared";

/** Index key sentinel for a global rule (`deviceId IS NULL`). */
export const GLOBAL_DEVICE_SENTINEL = "__global__";

/** Separator between the device-id-slot and the metric. `"::"` cannot
 *  appear in a UUIDv4 device id or a `RuleMetric` value. */
const INDEX_SEPARATOR = "::";

const indexKey = (deviceId: string | null, metric: RuleMetric): string =>
  `${deviceId ?? GLOBAL_DEVICE_SENTINEL}${INDEX_SEPARATOR}${metric}`;

export interface ActiveRuleCache {
  readonly byId: Map<string, EngineRule>;
  readonly byDeviceMetric: Map<string, readonly EngineRule[]>;
}

/** Project a Prisma `RuleRow` down to the engine's `EngineRule`. */
const projectRow = (row: RuleRow): EngineRule => ({
  id: row.id,
  deviceId: row.deviceId,
  metric: row.metric,
  operator: row.operator,
  threshold: row.threshold,
  severity: row.severity,
  ruleType: row.ruleType,
  // The de-bounce layer reads `minDurationSeconds` from the
  // projected rule without re-querying Prisma.
  minDurationSeconds: row.minDurationSeconds,
  hysteresisSeconds: row.hysteresisSeconds,
});

/** Hydrate the cache from Prisma. One call at api boot. */
export const hydrateActiveRuleCache = async (
  prisma: PrismaRuleReader,
): Promise<ActiveRuleCache> => {
  const rows = await prisma.rule.findMany({
    where: { isActive: true },
    select: {
      id: true,
      deviceId: true,
      metric: true,
      operator: true,
      threshold: true,
      severity: true,
      ruleType: true,
      minDurationSeconds: true,
      hysteresisSeconds: true,
      isActive: true,
    },
  });
  return buildCacheFromRows(rows);
};

/** Refresh the cache (hot-reload on save). */
export const refreshActiveRuleCache = async (
  _current: ActiveRuleCache,
  prisma: PrismaRuleReader,
): Promise<ActiveRuleCache> => {
  const rows = await prisma.rule.findMany({
    where: { isActive: true },
    select: {
      id: true,
      deviceId: true,
      metric: true,
      operator: true,
      threshold: true,
      severity: true,
      ruleType: true,
      minDurationSeconds: true,
      hysteresisSeconds: true,
      isActive: true,
    },
  });
  return buildCacheFromRows(rows);
};

/** Shared row-walker used by hydrate + refresh. */
const buildCacheFromRows = (rows: readonly RuleRow[]): ActiveRuleCache => {
  const byId = new Map<string, EngineRule>();
  const byDeviceMetric = new Map<string, EngineRule[]>();
  for (const row of rows) {
    // Re-validate at runtime — a future `rule.findMany` projection
    // that widens the column would otherwise bypass the closed-enum gate.
    try {
      requireRuleType(row.ruleType as string);
    } catch (_err) {
      console.warn(`[rules] hydrate: skipped unsupported ruleType=${row.ruleType} id=${row.id}`);
      continue;
    }
    const engineRule: EngineRule = projectRow(row);
    byId.set(row.id, engineRule);
    const key = indexKey(row.deviceId, row.metric);
    const existing = byDeviceMetric.get(key);
    if (existing === undefined) {
      byDeviceMetric.set(key, [engineRule]);
    } else {
      existing.push(engineRule);
    }
  }
  return { byId, byDeviceMetric };
};

/** Canonical lookup entry point. Returns the union of global rules
 *  (`__global__::${metric}`) and per-device rules
 *  (`${deviceId}::${metric}`). */
export const lookupRulesForFrame = (
  cache: ActiveRuleCache,
  deviceId: string,
  metric: RuleMetric,
): readonly EngineRule[] => {
  const globalRules = cache.byDeviceMetric.get(indexKey(null, metric)) ?? [];
  const deviceRules = cache.byDeviceMetric.get(indexKey(deviceId, metric)) ?? [];
  return [...globalRules, ...deviceRules];
};
