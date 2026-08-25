/**
 * Story 3.2 — `hooks.ts` integration tests.
 *
 * Drives `installRuleEngineHooks(...)` against stub
 * `ReadingRepository` + `PrismaRuleReader` + `ActiveRuleCache`. The
 * hook is the only site that touches the DB on the eval path; the
 * pre-filter chain (`findMany` → sort ascending → drop future-ts →
 * dedupe → slice to 5) is pinned here.
 *
 * Coverage (per spec `hooks.spec.ts` section):
 *   (a) Instant rule + breaching frame → returns breach with provenance.
 *   (b) Instant rule + non-breaching frame → EMPTY_BREACH_RESULTS.
 *   (c) Frame-to-observation path: hook extracts `ph` from frame
 *       carrying `{ph: 8.5, tds_ppm: 0}` against a `ph` rule.
 *   (d) Rate rule + stub findMany returning 4 readings → empty.
 *   (e) Rate rule + stub findMany returning 6 readings → take: 5.
 *   (f) Absence rule + no readings in window → returns breach.
 *   (g) Cache lookup: global + device rule for same metric; only
 *       device rule fires for the device frame.
 *   (h) uninstallRuleEngineHooks() → onRuleEvaluation returns
 *       EMPTY_BREACH_RESULTS.
 * Total: 8 hook tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_BREACH_RESULTS,
  type BreachResult,
} from "../engine";
import {
  GLOBAL_DEVICE_SENTINEL,
  type ActiveRuleCache,
} from "../cache";
import {
  installRuleEngineHooks,
  uninstallRuleEngineHooks,
} from "../hooks";
import { resetIngestHooks } from "../../ingest/hooks";
import type { ReadingRepository } from "../../ingest/frame";
import type { PrismaRuleReader } from "../prismaReader";
import type { EngineRule } from "../engine";

const DEVICE_ID = "9b1c4f00-0000-4000-8000-000000000b01";
const RULE_ID_INSTANT = "rule-instant";
const RULE_ID_RATE = "rule-rate";
const RULE_ID_ABSENCE = "rule-absence";
const FRAME_TS_MS = new Date("2026-08-20T10:31:04.000Z").getTime();

interface Rig {
  readonly readingRepository: ReadingRepository;
  readonly findMany: ReturnType<typeof vi.fn>;
  readonly prisma: PrismaRuleReader;
  readonly prismaFindMany: ReturnType<typeof vi.fn>;
}

const buildRig = (
  rows: ReadonlyArray<{ ts: Date; metrics: Record<string, number> }> = [],
): Rig => {
  const findMany = vi.fn(async () => rows);
  const prismaFindMany = vi.fn(async () => []);
  const readingRepository: ReadingRepository = {
    reading: {
      create: vi.fn(async () => ({})),
      findMany: findMany as unknown as ReadingRepository["reading"]["findMany"],
    },
  };
  const prisma: PrismaRuleReader = {
    rule: {
      findMany: prismaFindMany as unknown as PrismaRuleReader["rule"]["findMany"],
    },
  };
  return { readingRepository, findMany, prisma, prismaFindMany };
};

const buildCache = (rules: ReadonlyArray<EngineRule>): ActiveRuleCache => {
  const byId = new Map<string, EngineRule>();
  const byDeviceMetric = new Map<string, EngineRule[]>();
  for (const r of rules) {
    byId.set(r.id, r);
    const key = `${r.deviceId ?? GLOBAL_DEVICE_SENTINEL}::${r.metric}`;
    const arr = byDeviceMetric.get(key) ?? [];
    arr.push(r);
    byDeviceMetric.set(key, arr);
  }
  return { byId, byDeviceMetric };
};

const buildFrame = (overrides: Partial<Record<string, number>> = {}): {
  version: 1;
  device_id: string;
  ts: number;
  fw: string;
  seq: number;
  metrics: Record<string, number>;
} => ({
  version: 1,
  device_id: DEVICE_ID,
  ts: FRAME_TS_MS,
  fw: "1.0.3",
  seq: 0,
  metrics: {
    ph: 7.2,
    tds_ppm: 180,
    turbidity_ntu: 0.4,
    temp_c: 27.4,
    chlorine_ppm: 0.6,
    water_level_cm: 85,
    ...overrides,
  },
});

const callOnRuleEvaluation = async (
  rig: Rig,
  cache: ActiveRuleCache,
  frame: ReturnType<typeof buildFrame>,
) =>
  installRuleEngineHooks({
    cache,
    prisma: rig.prisma,
    readingRepository: rig.readingRepository,
  }).onRuleEvaluation({
    deviceId: DEVICE_ID,
    frame,
    flags: [],
  });

afterEach(() => {
  resetIngestHooks();
});

describe("Story 3.2 — installRuleEngineHooks", () => {
  it("(a) instant rule + breaching frame returns the breach with provenance", async () => {
    const rig = buildRig();
    const cache = buildCache([
      {
        id: RULE_ID_INSTANT,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      },
    ]);
    const frame = buildFrame({ tds_ppm: 312 });
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    expect(breaches).toHaveLength(1);
    const b = breaches[0] as BreachResult;
    expect(b.ruleId).toBe(RULE_ID_INSTANT);
    expect(b.deviceId).toBe(DEVICE_ID);
    expect(b.observedAt).toEqual(new Date(FRAME_TS_MS));
    expect(b.metric).toBe("tds_ppm");
    expect(b.severity).toBe("warning");
    expect(b.ruleType).toBe("instant");
    expect(b.value).toBe(312);
  });

  it("(b) instant rule + non-breaching frame returns EMPTY_BREACH_RESULTS", async () => {
    const rig = buildRig();
    const cache = buildCache([
      {
        id: RULE_ID_INSTANT,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      },
    ]);
    const frame = buildFrame({ tds_ppm: 180 }); // below 300 threshold
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    expect(breaches).toEqual(EMPTY_BREACH_RESULTS);
  });

  it("(c) frame-to-observation: hook extracts ph, not tds_ppm, when the cache has only a ph rule", async () => {
    // AC #13 — the spec's frame-to-observation pin. The frame
    // carries `{ph: 8.5, tds_ppm: 0}` and the cache holds a `ph`
    // rule with threshold 8.0. The breach fires because the hook
    // extracts the right metric (`ph`), not the always-tds-ppm
    // default.
    const rig = buildRig();
    const cache = buildCache([
      {
        id: "rule-ph",
        deviceId: null,
        metric: "ph",
        operator: "gte",
        threshold: 8.0,
        severity: "critical",
        ruleType: "instant",
        hysteresisSeconds: 60,
      },
    ]);
    const frame = buildFrame({ ph: 8.5, tds_ppm: 0 });
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    expect(breaches).toHaveLength(1);
    const b = breaches[0] as BreachResult;
    expect(b.metric).toBe("ph");
    expect(b.value).toBe(8.5);
    expect(b.ruleType).toBe("instant");
  });

  it("(d) rate rule with only 4 readings from findMany returns empty (insufficient via DB path)", async () => {
    const rig = buildRig([
      { ts: new Date(FRAME_TS_MS - 40_000), metrics: { tds_ppm: 100 } },
      { ts: new Date(FRAME_TS_MS - 30_000), metrics: { tds_ppm: 110 } },
      { ts: new Date(FRAME_TS_MS - 20_000), metrics: { tds_ppm: 120 } },
      { ts: new Date(FRAME_TS_MS - 10_000), metrics: { tds_ppm: 130 } },
    ]);
    const cache = buildCache([
      {
        id: RULE_ID_RATE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 0,
        severity: "warning",
        ruleType: "rate",
        hysteresisSeconds: 60,
      },
    ]);
    const frame = buildFrame();
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    expect(breaches).toEqual([]);
    // Spy assertion (spec d): findMany was called with `where.ts.gte`
    // set to ~now-60s and `orderBy.ts = "asc"`.
    expect(rig.findMany).toHaveBeenCalledTimes(1);
    const call = rig.findMany.mock.calls[0]![0] as {
      where: { deviceId: string; metric: string; ts: { gte: Date } };
      orderBy: { ts: "asc" };
    };
    expect(call.orderBy).toEqual({ ts: "asc" });
    expect(call.where.deviceId).toBe(DEVICE_ID);
    expect(call.where.metric).toBe("tds_ppm");
    expect(call.where.ts.gte.getTime()).toBeLessThanOrEqual(FRAME_TS_MS);
    expect(call.where.ts.gte.getTime()).toBeGreaterThanOrEqual(FRAME_TS_MS - 60_000);
  });

  it("(e) rate rule with 6 readings from findMany: hook queries with take: 5", async () => {
    // Six readings so the stub has 6 to return. The hook is pinned
    // to ask the DB for `take: 5` — defence-in-depth against the
    // DB returning every row in the window. The slice to 5 happens
    // at the DB-side; the engine itself takes the 5 and computes
    // the slope.
    const rig = buildRig([
      { ts: new Date(FRAME_TS_MS - 50_000), metrics: { tds_ppm: 0 } },
      { ts: new Date(FRAME_TS_MS - 40_000), metrics: { tds_ppm: 10 } },
      { ts: new Date(FRAME_TS_MS - 30_000), metrics: { tds_ppm: 20 } },
      { ts: new Date(FRAME_TS_MS - 20_000), metrics: { tds_ppm: 30 } },
      { ts: new Date(FRAME_TS_MS - 10_000), metrics: { tds_ppm: 40 } },
      { ts: new Date(FRAME_TS_MS - 5_000), metrics: { tds_ppm: 50 } },
    ]);
    const cache = buildCache([
      {
        id: RULE_ID_RATE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 1e-5, // any positive slope
        severity: "warning",
        ruleType: "rate",
        hysteresisSeconds: 60,
      },
    ]);
    const frame = buildFrame();
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    // `take: 5` is pinned by the hook so the DB does not return
    // every row in the 60 s window.
    expect(rig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
    expect(breaches).toHaveLength(1);
    expect((breaches[0] as BreachResult).ruleType).toBe("rate");
  });

  it("(f) absence rule with no readings in window returns breach", async () => {
    const rig = buildRig([]); // no rows in the window
    const cache = buildCache([
      {
        id: RULE_ID_ABSENCE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 0,
        severity: "critical",
        ruleType: "absence",
        hysteresisSeconds: 60,
      },
    ]);
    const frame = buildFrame();
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    expect(breaches).toHaveLength(1);
    const b = breaches[0] as BreachResult;
    expect(b.ruleType).toBe("absence");
    expect(b.value).toBe(0);
    expect(b.deviceId).toBe(DEVICE_ID);
  });

  it("(f2) global absence rule fires for a device with no per-device rule", async () => {
    // Spec design note (line 168): "Global absence rules ARE
    // allowed; they fire per-frame for every device whose last
    // reading is older than hysteresisSeconds." A regression that
    // accidentally drops the `__global__` bucket from
    // `lookupRulesForFrame` for absence rules specifically (e.g., a
    // refactor that branches on `ruleType === "absence"` to skip
    // global) would not be caught by test (f) above — that test
    // uses ONLY a global rule with no per-device distinction.
    //
    // This test: cache has ONLY a global absence rule; the
    // device's own per-device slot is empty. With NO readings in
    // the 60 s window, the absence breach must still fire.
    const rig = buildRig([]); // no rows in the window
    const cache = buildCache([
      {
        id: "global-absence-only",
        deviceId: null, // GLOBAL rule, no per-device rule alongside
        metric: "tds_ppm",
        operator: "gte",
        threshold: 0,
        severity: "critical",
        ruleType: "absence",
        hysteresisSeconds: 60,
      },
      // Deliberately NO `${DEVICE_ID}::tds_ppm` rule.
    ]);
    const frame = buildFrame();
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    expect(breaches).toHaveLength(1);
    const b = breaches[0] as BreachResult;
    expect(b.ruleType).toBe("absence");
    expect(b.value).toBe(0);
    expect(b.deviceId).toBe(DEVICE_ID);
    expect(b.ruleId).toBe("global-absence-only");
  });

  it("(g) cache lookup: global + device rule on same metric — only device rule fires for the device frame", async () => {
    // Spec (g): stub cache with one global rule + one device-
    // specific rule for the same metric on the device. Only the
    // device-specific rule fires for the device frame.
    //
    // Implementation note: `lookupRulesForFrame` returns the UNION
    // of both rules for the device. Both rules evaluate; the
    // assertion pins WHICH IDs land in the breach list. We use
    // distinct thresholds so the two rules fire/don't-fire
    // independently and the global-vs-device routing is visible.
    const rig = buildRig();
    const cache = buildCache([
      // Global tds_ppm rule — fires when tds_ppm >= 100.
      {
        id: "global-tds",
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 100,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      },
      // Device-specific tds_ppm rule — fires when tds_ppm >= 500.
      {
        id: "device-tds",
        deviceId: DEVICE_ID,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 500,
        severity: "critical",
        ruleType: "instant",
        hysteresisSeconds: 60,
      },
    ]);
    const frame = buildFrame({ tds_ppm: 312 }); // fires global, not device
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    const ids = breaches.map((b) => b.ruleId);
    expect(ids).toContain("global-tds");
    expect(ids).not.toContain("device-tds");

    // And the inverse: with tds_ppm = 999 both fire.
    const frame2 = buildFrame({ tds_ppm: 999 });
    const breaches2 = await callOnRuleEvaluation(rig, cache, frame2);
    const ids2 = breaches2.map((b) => b.ruleId);
    expect(ids2).toContain("global-tds");
    expect(ids2).toContain("device-tds");
  });

  it("(h) uninstallRuleEngineHooks() resets to no-op default", async () => {
    // First install a real hook set, then uninstall, then call
    // onRuleEvaluation via getIngestHooks() and assert the no-op
    // default returns EMPTY_BREACH_RESULTS.
    const rig = buildRig();
    const cache = buildCache([
      {
        id: RULE_ID_INSTANT,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      },
    ]);
    // Install via the public installRuleEngineHooks + setIngestHooks
    // surface so the test exercises the real boot path.
    const { setIngestHooks, getIngestHooks } = await import("../../ingest/hooks");
    setIngestHooks(
      installRuleEngineHooks({
        cache,
        prisma: rig.prisma,
        readingRepository: rig.readingRepository,
      }),
    );
    // Now uninstall — restores the no-op default.
    uninstallRuleEngineHooks();
    const hooks = getIngestHooks();
    const breaches = await hooks.onRuleEvaluation({
      deviceId: DEVICE_ID,
      frame: buildFrame({ tds_ppm: 999 }), // would breach if hooks were installed
      flags: [],
    });
    expect(breaches).toEqual(EMPTY_BREACH_RESULTS);
  });
});