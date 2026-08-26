/**
 * Active-rule cache — Story 3.2.
 *
 * In-memory store of every `Rule` row where `isActive = true`,
 * loaded once at api boot via `hydrateActiveRuleCache` and
 * optionally refreshed (Story 3.7) via `refreshActiveRuleCache`.
 * Two parallel indexes:
 *
 *   - `byId`: `Map<ruleId, EngineRule>` for direct lookups (Story 3.5).
 *   - `byDeviceMetric`: `Map<"${deviceId ?? "__global__"}::${metric}",
 *     readonly EngineRule[]>` for the per-frame lookup the hook uses.
 *
 * The index key format (exact strings: `"__global__"`, separator `"::"`)
 * is pinned by `cache.spec.ts` so a refactor that drifts the
 * separator or the global-sentinel silently breaks all hook lookups.
 *
 * Per-row rejection policy: if a row's `ruleType` is anything other
 * than `instant | rate | absence`, the row is SKIPPED with a
 * `console.warn` call and the remaining valid rows still load
 * (per-row rejection, not all-or-nothing).
 */

import { type EngineRule, requireRuleType } from "./engine";
import { type PrismaRuleReader, type RuleRow } from "./prismaReader";

import type { RuleMetric } from "@surakkha/shared";

/**
 * Index key sentinel for a rule whose `deviceId IS NULL` (a global
 * rule). Kept as a single named constant so `cache.spec.ts` can pin
 * the literal and a future rename is one place.
 */
export const GLOBAL_DEVICE_SENTINEL = "__global__";

/**
 * Separator between the device-id-slot and the metric in the
 * `byDeviceMetric` index. `"::"` (two colons) is the chosen separator
 * because it cannot appear in a UUIDv4 device id or a `RuleMetric`
 * value, so the parse is unambiguous.
 */
const INDEX_SEPARATOR = "::";

const indexKey = (deviceId: string | null, metric: RuleMetric): string =>
  `${deviceId ?? GLOBAL_DEVICE_SENTINEL}${INDEX_SEPARATOR}${metric}`;

export interface ActiveRuleCache {
  readonly byId: Map<string, EngineRule>;
  readonly byDeviceMetric: Map<string, readonly EngineRule[]>;
}

/**
 * Project a Prisma `RuleRow` down to the engine's `EngineRule`. The
 * projection is shared between hydration and refresh so the shape is
 * the same on every load path.
 */
const projectRow = (row: RuleRow): EngineRule => ({
  id: row.id,
  deviceId: row.deviceId,
  metric: row.metric,
  operator: row.operator,
  threshold: row.threshold,
  severity: row.severity,
  ruleType: row.ruleType,
  // Story 3.4 — `minDurationSeconds` is required by `EngineRule`.
  // The cache is the canonical source of de-bounce configuration;
  // the de-bounce layer (`./debounce.ts`) reads this field from the
  // projected rule without re-querying Prisma. `hysteresisSeconds`
  // was already projected (Story 3.2 dual-semantics pin).
  minDurationSeconds: row.minDurationSeconds,
  hysteresisSeconds: row.hysteresisSeconds,
});

/**
 * Hydrate the cache from Prisma. ONE call at api boot. Per-row
 * rejection on unsupported `ruleType`:
 *
 *   - Log a `console.warn('[rules] hydrate: skipped unsupported
 *     ruleType=… id=…')` so an operator can tell the difference
 *     between "no rules seeded yet" and "we found N rules but one
 *     had an unknown type".
 *   - Exclude the offending row from BOTH `byId` and `byDeviceMetric`.
 *
 * Per-row rejection is the rule, not all-or-nothing — a batch with
 * one bad row still loads the other valid rows. The cache must
 * always be returned in a usable shape so callers don't need to
 * null-check the indexes.
 */
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

/**
 * Refresh the cache (Story 3.7 will call this on save). Same
 * per-row rejection policy as hydrate — a reload that races with
 * a v2 row insert still produces a usable cache.
 */
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

/**
 * Shared row-walker used by hydrate + refresh. Exposed (file-local)
 * so a future test can pin the exact rejection + index population
 * semantics without going through the Prisma mock.
 */
const buildCacheFromRows = (rows: readonly RuleRow[]): ActiveRuleCache => {
  const byId = new Map<string, EngineRule>();
  const byDeviceMetric = new Map<string, EngineRule[]>();
  for (const row of rows) {
    // Re-validate at runtime even though `row.ruleType` is typed
    // as `RuleRuleType` — a future `rule.findMany` projection that
    // widens the column would otherwise bypass the closed-enum
    // gate (defence-in-depth). `requireRuleType` is a regular
    // throwing function (not an assertion signature) so the call
    // works without TS2775's "every name in the call target must
    // be explicitly typed" constraint on the row iterator.
    try {
      requireRuleType(row.ruleType as string);
    } catch (_err) {
      // The warning carries both `ruleType` and `id` per the cache
      // AC + the spec's per-row rejection contract. We do NOT throw
      // — valid rows in the same batch still load.
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

/**
 * The single canonical lookup entry point the hook uses. Returns
 * the UNION of:
 *   - `__global__::${metric}` — global rules (deviceId IS NULL)
 *   - `${deviceId}::${metric}` — per-device rules
 *
 * The order within each bucket is the order Prisma returned (stable
 * for the cache's lifetime; the engine treats the array as opaque
 * `readonly EngineRule[]`). Returning a `readonly` view means
 * callers cannot mutate the cache by accident.
 */
export const lookupRulesForFrame = (
  cache: ActiveRuleCache,
  deviceId: string,
  metric: RuleMetric,
): readonly EngineRule[] => {
  const globalRules = cache.byDeviceMetric.get(indexKey(null, metric)) ?? [];
  const deviceRules = cache.byDeviceMetric.get(indexKey(deviceId, metric)) ?? [];
  return [...globalRules, ...deviceRules];
};
