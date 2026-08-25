/**
 * Story 3.2 — `cache.ts` unit tests.
 *
 * Tests the active-rule cache hydration against a stub
 * `PrismaRuleReader`. The Prisma-side row projection and the
 * `byDeviceMetric` index key format (exact strings: `"__global__"`,
 * separator `"::"`) are pinned so a refactor that drifts the
 * separator or the global-sentinel silently breaks all hook
 * lookups.
 *
 * Coverage (per spec `cache.spec.ts` section):
 *   (a) Empty DB → empty cache.
 *   (b) Mixed active/inactive → only active rows present.
 *   (c) Global + per-device → both `byDeviceMetric` keys.
 *   (d) Row with `ruleType: "unsupported"` → excluded + console.warn.
 * Total: 4 cache tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GLOBAL_DEVICE_SENTINEL, hydrateActiveRuleCache, lookupRulesForFrame } from "../cache";
import type { PrismaRuleReader, RuleRow } from "../prismaReader";

const DEVICE_ID = "9b1c4f00-0000-4000-8000-000000000a01";

const makeRow = (overrides: Partial<RuleRow> = {}): RuleRow => ({
  id: "rule-1",
  deviceId: null,
  metric: "tds_ppm",
  operator: "gte",
  threshold: 300,
  severity: "warning",
  ruleType: "instant",
  hysteresisSeconds: 60,
  isActive: true,
  ...overrides,
});

const buildStubPrisma = (rows: ReadonlyArray<RuleRow>): {
  prisma: PrismaRuleReader;
  findMany: ReturnType<typeof vi.fn>;
} => {
  const findMany = vi.fn(async () => rows);
  const prisma: PrismaRuleReader = {
    rule: { findMany: findMany as unknown as PrismaRuleReader["rule"]["findMany"] },
  };
  return { prisma, findMany };
};

describe("Story 3.2 — hydrateActiveRuleCache", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("(a) returns an empty cache when no rows are returned", async () => {
    const { prisma } = buildStubPrisma([]);
    const cache = await hydrateActiveRuleCache(prisma);
    expect(cache.byId.size).toBe(0);
    expect(cache.byDeviceMetric.size).toBe(0);
  });

  it("(b) pins the where.isActive filter AND only loads rows returned by findMany", async () => {
    // The spec calls this "Mixed active/inactive → only active rows
    // present". The cache itself is read-only against the row
    // array it receives — the active-filter is the caller's
    // responsibility, expressed as the `where: { isActive: true }`
    // filter on `findMany`. Pin both halves of the contract:
    //   (1) the call site filters isActive: true so an inactive
    //       row never enters the cache.
    //   (2) the rows the cache DOES receive are loaded into the
    //       indexes as-is.
    const rows: RuleRow[] = [makeRow({ id: "active", isActive: true })];
    const { prisma, findMany } = buildStubPrisma(rows);
    const cache = await hydrateActiveRuleCache(prisma);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    expect(cache.byId.has("active")).toBe(true);
  });

  it("(c) indexes global + per-device rules under exact key strings", async () => {
    const rows: RuleRow[] = [
      makeRow({ id: "global-tds", deviceId: null, metric: "tds_ppm" }),
      makeRow({ id: "device-tds", deviceId: DEVICE_ID, metric: "tds_ppm" }),
    ];
    const { prisma } = buildStubPrisma(rows);
    const cache = await hydrateActiveRuleCache(prisma);

    // Exact strings pinned by the spec + the spec's cache-section
    // `(c)`: `"__global__"` is the global sentinel; `"::"` is the
    // separator. Drift in either breaks every hook lookup.
    expect(cache.byDeviceMetric.has(`${GLOBAL_DEVICE_SENTINEL}::tds_ppm`)).toBe(true);
    expect(cache.byDeviceMetric.has(`${DEVICE_ID}::tds_ppm`)).toBe(true);
    expect(GLOBAL_DEVICE_SENTINEL).toBe("__global__");

    // lookupRulesForFrame returns the UNION of global + device.
    const hits = lookupRulesForFrame(cache, DEVICE_ID, "tds_ppm");
    const ids = hits.map((r) => r.id);
    expect(ids).toContain("global-tds");
    expect(ids).toContain("device-tds");
    expect(hits).toHaveLength(2);
  });

  it("(d) skips rows with unsupported ruleType and emits console.warn", async () => {
    // Cast `ruleType: "unsupported"` past the static type — the
    // runtime contract is what we're pinning.
    const rows: RuleRow[] = [
      makeRow({ id: "bad-1", ruleType: "unsupported" as unknown as RuleRow["ruleType"] }),
      makeRow({ id: "good-1", ruleType: "instant" }),
    ];
    const { prisma } = buildStubPrisma(rows);
    const cache = await hydrateActiveRuleCache(prisma);

    // Bad row excluded from BOTH indexes; valid row loaded.
    expect(cache.byId.has("bad-1")).toBe(false);
    expect(cache.byDeviceMetric.has(`${GLOBAL_DEVICE_SENTINEL}::tds_ppm`)).toBe(true);
    // The valid row's array contains only the valid row.
    const arr = cache.byDeviceMetric.get(`${GLOBAL_DEVICE_SENTINEL}::tds_ppm`) ?? [];
    expect(arr.find((r) => r.id === "bad-1")).toBeUndefined();
    expect(arr.find((r) => r.id === "good-1")).toBeDefined();

    // console.warn emitted with the offending `ruleType` AND `id`.
    const warnCalls = consoleWarnSpy.mock.calls.map((c) => String(c[0]));
    const matched = warnCalls.find(
      (msg) => msg.includes("unsupported") && msg.includes("bad-1"),
    );
    expect(matched).toBeDefined();
  });
});
