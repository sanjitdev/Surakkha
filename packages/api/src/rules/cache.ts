/**
 * Active-rule cache. In-memory store of every `Rule` row where
 * `isActive = true`, loaded once at api boot via
 * `hydrateActiveRuleCache` and refreshed via `refreshActiveRuleCache`.
 * Two parallel indexes:
 *   - `byId`: `Map<ruleId, EngineRule>` for direct lookups.
 *   - `byDeviceMetric`: `Map<"${deviceId ?? "__global__"}::${metric}",
 *     readonly EngineRule[]>` for the per-frame lookup the hook uses.
 *
 * Per-row rejection policy: if a row's `ruleType` is anything other
 * than `instant | rate | absence`, the row is SKIPPED with a
 * `console.warn` call and the remaining valid rows still load.
 */

import { type EngineRule, requireRuleType } from "./engine";
import { type PrismaRuleReader, type RuleRow } from "./prismaReader";

import type { RuleMetric } from "@surakkha/shared";

/** Index key sentinel for a rule whose `deviceId IS NULL` (a global
 *  rule). */
export const GLOBAL_DEVICE_SENTINEL = "__global__";

/** Separator between the device-id-slot and the metric in the
 *  `byDeviceMetric` index. `"::"` (two colons) is the chosen
 *  separator because it cannot appear in a UUIDv4 device id or a
 *  `RuleMetric` value. */
const INDEX_SEPARATOR = "::";

const indexKey = (deviceId: string | null, metric: RuleMetric): string =>
  `${deviceId ?? GLOBAL_DEVICE_SENTINEL}${INDEX_SEPARATOR}${metric}`;

export interface ActiveRuleCache {
  readonly byId: Map<string, EngineRule>;
  readonly byDeviceMetric: Map<string, readonly EngineRule[]>;
}

/** Project a Prisma `RuleRow` down to the engine's `EngineRule`. The
 *  projection is shared between hydration and refresh so the shape
 *  is the same on every load path. */
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

/** Hydrate the cache from Prisma. ONE call at api boot. Per-row
 *  rejection on unsupported `ruleType` — a batch with one bad row
 *  still loads the other valid rows. */
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

/** Refresh the cache (hot-reload on save). Same per-row rejection
 *  policy as hydrate. */
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
    // Re-validate at runtime even though `row.ruleType` is typed as
    // `RuleRuleType` — a future `rule.findMany` projection that
    // widens the column would otherwise bypass the closed-enum
    // gate. `requireRuleType` is a throwing function (not an
    // assertion signature) so the call works without TS2775's
    // "every name in the call target must be explicitly typed"
    // constraint.
    try {
      requireRuleType(row.ruleType as string);
    } catch (_err) {
      // Per-row rejection — valid rows in the same batch still load.
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

/** The single canonical lookup entry point the hook uses. Returns
 *  the UNION of:
 *    - `__global__::${metric}` — global rules (deviceId IS NULL)
 *    - `${deviceId}::${metric}` — per-device rules
 *  Order within each bucket is the order Prisma returned (stable
 *  for the cache's lifetime). */
export const lookupRulesForFrame = (
  cache: ActiveRuleCache,
  deviceId: string,
  metric: RuleMetric,
): readonly EngineRule[] => {
  const globalRules = cache.byDeviceMetric.get(indexKey(null, metric)) ?? [];
  const deviceRules = cache.byDeviceMetric.get(indexKey(deviceId, metric)) ?? [];
  return [...globalRules, ...deviceRules];
};
