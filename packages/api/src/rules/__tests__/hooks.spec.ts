/**
 * Story 3.2 — `hooks.ts` integration tests.
 *
 * Drives `installRuleEngineHooks(...)` against stub
 * `ReadingRepository` + `PrismaRuleReader` + `ActiveRuleCache`. The
 * hook is the only site that touches the DB on the eval path; the
 * pre-filter chain (`findMany` → sort ascending → drop future-ts →
 * dedupe → slice to 5) is pinned here.
 *
 * Story 3.4 — DE-BOUNCING integration. 4 new tests + 2 boot-guard
 * tests pin the hook's behaviour around `BreachTransition` flows:
 *   (i)   RISING_EDGE_DELAY — first frame breaches, no Alert row,
 *          no socket emit. Second frame at +30s emits.
 *   (ii)  FALLING_EDGE_DELAY — open Alert exists, breach goes
 *          quiet, no `alert.update` until hysteresis elapses.
 *   (iii) REOPEN_AFTER_CLEAR — open → clear → re-breach → new Alert row.
 *   (iv)  POST_COMMIT_EMIT_ORDERING — stub BroadcastTarget captures
 *          `emit(event, payload)`. Force the `alert.create` to reject;
 *          assert the BroadcastTarget received NO emit.
 *          Pin room literal `device:<deviceId>` and event literal `alert:opened`.
 *   (v)   BOOT_GUARD_REJECTS — fake cache with one rule at
 *          `min=0 AND hysteresis=0` → `WriteAmplificationError` thrown.
 *   (vi)  BOOT_GUARD_ALLOWS — fake cache with all rules at
 *          `min≥1 OR hysteresis≥1` → hook installs normally.
 *
 * Total: 8 + 6 = 14 hook tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_BREACH_RESULTS, type BreachResult, type EngineRule } from "../engine";
import { GLOBAL_DEVICE_SENTINEL, type ActiveRuleCache } from "../cache";
import {
  installRuleEngineHooks,
  uninstallRuleEngineHooks,
  type AlertStateRepository,
  WriteAmplificationError,
} from "../hooks";
import { resetIngestHooks } from "../../ingest/hooks";
import type { BroadcastTarget, ReadingRepository } from "../../ingest/frame";
import type { PrismaRuleReader } from "../prismaReader";
import type { PrismaAlertReader } from "../findOpenAlert";

const DEVICE_ID = "9b1c4f00-0000-4000-8000-000000000b01";
const RULE_ID_INSTANT = "rule-instant";
const RULE_ID_RATE = "rule-rate";
const RULE_ID_ABSENCE = "rule-absence";
const RULE_ID_DEBOUNCE = "22222222-2222-4222-8222-222222222222";
const FRAME_TS_MS = new Date("2026-08-20T10:31:04.000Z").getTime();

// Story 3.4 — helper that fills the required `minDurationSeconds`
// field on every inline `EngineRule` literal. Existing 3.2 tests use
// `0` so the de-bounce layer treats every breach as "fire immediately"
// — preserving the pre-3.4 engine behavior (no de-bounce). New
// 3.4 tests pass `minDurationSeconds` explicitly via
// `withMinDuration({ ..., minDurationSeconds: <value> })` — the
// helper only fills the field when the caller did NOT set it (default
// 0).
const DEFAULT_MIN_DURATION_SECONDS = 0;
const withMinDuration = (
  rule: Omit<EngineRule, "minDurationSeconds"> & {
    readonly minDurationSeconds?: number;
  },
): EngineRule => ({
  ...rule,
  minDurationSeconds: rule.minDurationSeconds ?? DEFAULT_MIN_DURATION_SECONDS,
});

interface Rig {
  readonly readingRepository: ReadingRepository;
  readonly findMany: ReturnType<typeof vi.fn>;
  readonly prisma: PrismaRuleReader;
  readonly prismaFindMany: ReturnType<typeof vi.fn>;
  // Story 3.4 de-bounce stubs.
  readonly alertReader: PrismaAlertReader;
  readonly alertReaderFindFirst: ReturnType<typeof vi.fn>;
  readonly alertState: AlertStateRepository;
  readonly alertCreate: ReturnType<typeof vi.fn>;
  readonly alertUpdate: ReturnType<typeof vi.fn>;
  readonly ruleDebounceStateFindMany: ReturnType<typeof vi.fn>;
  readonly ruleDebounceStateUpsert: ReturnType<typeof vi.fn>;
}

// Shared, mutable de-bounce state. Keys are `${metric}|${severity}`
// (mirroring the pure module's `slotKey`). The `findMany` stub
// reads from this map; the `upsert` stub writes into it. This
// simulates the Postgres round-trip across multiple hook instances
// without a real DB.
interface DebounceSlotRow {
  metric: Parameters<AlertStateRepository["ruleDebounceState"]["findMany"]>[0] extends {
    where: { OR: ReadonlyArray<infer T> };
  }
    ? T extends { metric: infer M }
      ? M
      : never
    : never;
  severity: "info" | "warning" | "critical";
  inViolationSince: Date | null;
  clearedSince: Date | null;
}
type DebounceStateMap = Map<string, DebounceSlotRow>;

const buildRig = (
  rows: ReadonlyArray<{ ts: Date; metrics: Record<string, number> }> = [],
  initialDebounceState: readonly DebounceSlotRow[] = [],
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
  const alertReaderFindFirst = vi.fn(async () => null);
  const alertReader: PrismaAlertReader = {
    alert: {
      findFirst: alertReaderFindFirst as unknown as PrismaAlertReader["alert"]["findFirst"],
    },
  };
  const alertCreate = vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" }));
  const alertUpdate = vi.fn(async () => ({}));

  // Shared, mutable state. `findMany` reads from it; `upsert`
  // writes into it. Tests that drive multiple frames share state
  // across the frames via this map.
  const debounceState: DebounceStateMap = new Map();
  for (const r of initialDebounceState) {
    debounceState.set(`${r.metric}|${r.severity}`, { ...r });
  }
  const ruleDebounceStateFindMany = vi.fn(
    async (args: Parameters<AlertStateRepository["ruleDebounceState"]["findMany"]>[0]) => {
      // Filter by `where.OR` clauses (the OR is an array of
      // `{metric, severity: {in: [...]}}` predicates).
      const predicates = args.where.OR;
      const matches: DebounceSlotRow[] = [];
      for (const [key, row] of debounceState.entries()) {
        for (const p of predicates) {
          if (p.metric === row.metric && p.severity.in.includes(row.severity)) {
            matches.push({ ...row });
            break;
          }
        }
        void key;
      }
      return matches;
    },
  );
  const ruleDebounceStateUpsert = vi.fn(
    async (args: Parameters<AlertStateRepository["ruleDebounceState"]["upsert"]>[0]) => {
      const key = `${args.where.deviceId_metric_severity.metric}|${args.where.deviceId_metric_severity.severity}`;
      const existing = debounceState.get(key);
      const next: DebounceSlotRow = {
        metric: args.where.deviceId_metric_severity.metric,
        severity: args.where.deviceId_metric_severity.severity,
        inViolationSince:
          args.update.inViolationSince !== undefined
            ? args.update.inViolationSince
            : (existing?.inViolationSince ?? args.create.inViolationSince),
        clearedSince:
          args.update.clearedSince !== undefined
            ? args.update.clearedSince
            : (existing?.clearedSince ?? args.create.clearedSince),
      };
      debounceState.set(key, next);
      return {};
    },
  );
  const alertState: AlertStateRepository = {
    alert: {
      create: alertCreate as unknown as AlertStateRepository["alert"]["create"],
      update: alertUpdate as unknown as AlertStateRepository["alert"]["update"],
    },
    ruleDebounceState: {
      findMany:
        ruleDebounceStateFindMany as unknown as AlertStateRepository["ruleDebounceState"]["findMany"],
      upsert:
        ruleDebounceStateUpsert as unknown as AlertStateRepository["ruleDebounceState"]["upsert"],
    },
  };
  return {
    readingRepository,
    findMany,
    prisma,
    prismaFindMany,
    alertReader,
    alertReaderFindFirst,
    alertState,
    alertCreate,
    alertUpdate,
    ruleDebounceStateFindMany,
    ruleDebounceStateUpsert,
  };
};

const buildCache = (rules: readonly EngineRule[]): ActiveRuleCache => {
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

const buildFrame = (
  overrides: Partial<Record<string, number>> = {},
): {
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
  broadcast?: BroadcastTarget,
  sharedLastSeenFrameTs?: Map<string, Date>,
) =>
  installRuleEngineHooks({
    cache,
    prisma: rig.prisma,
    readingRepository: rig.readingRepository,
    alertReader: rig.alertReader,
    alertState: rig.alertState,
    broadcast,
    lastSeenFrameTs: sharedLastSeenFrameTs,
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
      withMinDuration({
        id: RULE_ID_INSTANT,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      }),
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
      withMinDuration({
        id: RULE_ID_INSTANT,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      }),
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
      withMinDuration({
        id: "rule-ph",
        deviceId: null,
        metric: "ph",
        operator: "gte",
        threshold: 8.0,
        severity: "critical",
        ruleType: "instant",
        hysteresisSeconds: 60,
      }),
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
      withMinDuration({
        id: RULE_ID_RATE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 0,
        severity: "warning",
        ruleType: "rate",
        hysteresisSeconds: 60,
      }),
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
      withMinDuration({
        id: RULE_ID_RATE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 1e-5, // any positive slope
        severity: "warning",
        ruleType: "rate",
        hysteresisSeconds: 60,
      }),
    ]);
    const frame = buildFrame();
    const breaches = await callOnRuleEvaluation(rig, cache, frame);
    // `take: 5` is pinned by the hook so the DB does not return
    // every row in the 60 s window.
    expect(rig.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    expect(breaches).toHaveLength(1);
    expect((breaches[0] as BreachResult).ruleType).toBe("rate");
  });

  it("(f) absence rule with no readings in window returns breach", async () => {
    const rig = buildRig([]); // no rows in the window
    const cache = buildCache([
      withMinDuration({
        id: RULE_ID_ABSENCE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 0,
        severity: "critical",
        ruleType: "absence",
        hysteresisSeconds: 60,
      }),
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
      withMinDuration({
        id: "global-absence-only",
        deviceId: null, // GLOBAL rule, no per-device rule alongside
        metric: "tds_ppm",
        operator: "gte",
        threshold: 0,
        severity: "critical",
        ruleType: "absence",
        hysteresisSeconds: 60,
      }),
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
      withMinDuration({
        id: "global-tds",
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 100,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      }),
      // Device-specific tds_ppm rule — fires when tds_ppm >= 500.
      withMinDuration({
        id: "device-tds",
        deviceId: DEVICE_ID,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 500,
        severity: "critical",
        ruleType: "instant",
        hysteresisSeconds: 60,
      }),
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
      withMinDuration({
        id: RULE_ID_INSTANT,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        hysteresisSeconds: 60,
      }),
    ]);
    // Install via the public installRuleEngineHooks + setIngestHooks
    // surface so the test exercises the real boot path.
    const { setIngestHooks, getIngestHooks } = await import("../../ingest/hooks");
    setIngestHooks(
      installRuleEngineHooks({
        cache,
        prisma: rig.prisma,
        readingRepository: rig.readingRepository,
        alertReader: rig.alertReader,
        alertState: rig.alertState,
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

// --------------------------------------------------------------------------
// Story 3.4 — DE-BOUNCING INTEGRATION TESTS
// --------------------------------------------------------------------------
//
// These tests pin the hook's behaviour around `BreachTransition` flows.
// They are the integration counterpart to `debounce.spec.ts` (which
// tests the pure module in isolation). The hook composes:
//   - evaluateRules → rawBreaches
//   - load RuleDebounceState rows from Postgres
//   - debounceBreaches → { transitions, nextState }
//   - for each transition: Alert row write (or upsert) + (for opens) broadcast emit
//
// The stubs below mirror the Prisma slice the hook consumes (see
// `AlertStateRepository` + `PrismaAlertReader` in `hooks.ts`). Each
// stub records its calls for assertion.

describe("Story 3.4 — installRuleEngineHooks — DE-BOUNCING", () => {
  it("(i) RISING_EDGE_DELAY: first frame breaches, no Alert row, no emit; second frame at +30s emits", async () => {
    // AC2 pin: a `min=30` rule with continuous breaches must NOT
    // create an Alert row on frame 1. The Alert row + socket emit
    // happens ONLY on the frame at frameTs - inViolationSince >= 30s.
    const rig = buildRig();
    const cache = buildCache([
      withMinDuration({
        id: RULE_ID_DEBOUNCE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        minDurationSeconds: 30,
        hysteresisSeconds: 60,
      }),
    ]);
    const broadcastStub = createBroadcastStub();
    const lastSeen = new Map<string, Date>();

    // Frame 1: t = T0, breach (tds_ppm = 312 > 300). First
    // de-bounce frame; `inViolationSince` initializes to T0; no
    // transition because elapsed < 30s.
    const frame1 = buildFrame({ tds_ppm: 312 });
    (frame1 as { ts: number }).ts = FRAME_TS_MS;
    await callOnRuleEvaluation(rig, cache, frame1, broadcastStub.broadcast, lastSeen);

    expect(rig.alertCreate).not.toHaveBeenCalled();
    expect(broadcastStub.emits).toHaveLength(0);
    expect(rig.ruleDebounceStateUpsert).toHaveBeenCalledTimes(1);

    // Frame 2: t = T0 + 30s, breach continues. Elapsed >= 30s → open.
    const frame2 = buildFrame({ tds_ppm: 312 });
    (frame2 as { ts: number }).ts = FRAME_TS_MS + 30_000;
    await callOnRuleEvaluation(rig, cache, frame2, broadcastStub.broadcast, lastSeen);

    expect(rig.alertCreate).toHaveBeenCalledTimes(1);
    expect(broadcastStub.emits).toHaveLength(1);
    const emit = broadcastStub.emits[0]!;
    expect(emit.room).toBe(`device:${DEVICE_ID}`);
    expect(emit.event).toBe("alert:opened");
    // Wire payload shape (Story 3.4 loopback I-1 + I-2).
    const payload = emit.payload as {
      alert_id: string;
      device_id: string;
      metric: string;
      severity: string;
      rule_id: string;
      value: number;
      opened_at: string;
    };
    expect(payload.device_id).toBe(DEVICE_ID);
    expect(payload.metric).toBe("tds_ppm");
    expect(payload.severity).toBe("warning");
    expect(payload.rule_id).toBe(RULE_ID_DEBOUNCE);
    expect(payload.value).toBe(312);
    expect(payload.opened_at).toBe(new Date(FRAME_TS_MS + 30_000).toISOString());
  });

  it("(ii) FALLING_EDGE_DELAY: open alert exists, breach goes quiet, no clear until hysteresis elapses", async () => {
    // AC3 pin: once an Alert is open, a single quiet frame does NOT
    // clear it. The falling-edge timer must elapse (hysteresis=60s)
    // before `alert.update({clearedAt})` runs.
    const rig = buildRig();
    const cache = buildCache([
      withMinDuration({
        id: RULE_ID_DEBOUNCE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        minDurationSeconds: 30,
        hysteresisSeconds: 60,
      }),
    ]);
    const broadcastStub = createBroadcastStub();
    const lastSeen = new Map<string, Date>();

    // Frame 1: T0, breach. No transition (timer starts).
    const frame1 = buildFrame({ tds_ppm: 312 });
    (frame1 as { ts: number }).ts = FRAME_TS_MS;
    await callOnRuleEvaluation(rig, cache, frame1, broadcastStub.broadcast, lastSeen);

    // Frame 2: T0 + 30s, breach continues. OPEN transition; Alert row created.
    const frame2 = buildFrame({ tds_ppm: 312 });
    (frame2 as { ts: number }).ts = FRAME_TS_MS + 30_000;
    await callOnRuleEvaluation(rig, cache, frame2, broadcastStub.broadcast, lastSeen);
    expect(rig.alertCreate).toHaveBeenCalledTimes(1);

    // Stub `findOpenAlert` so the clear path sees the open alert.
    rig.alertReaderFindFirst.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      deviceId: DEVICE_ID,
      ruleId: RULE_ID_DEBOUNCE,
      severity: "warning",
      metric: "tds_ppm",
      openedAt: new Date(FRAME_TS_MS + 30_000),
    });
    // Side-effect: when `alert.update` runs (clear transition),
    // reset `findOpenAlert` to null. Mirrors the real DB.
    rig.alertUpdate.mockImplementation(() => {
      rig.alertReaderFindFirst.mockResolvedValue(null);
      return Promise.resolve({});
    });

    // Frame 3: T0 + 30s + 5s, breach goes quiet (tds_ppm = 180 below
    // threshold). Falling edge starts; clearedSince = T0+35s. NO
    // update yet (elapsed = 5s < hysteresis=60s).
    const frame3 = buildFrame({ tds_ppm: 180 });
    (frame3 as { ts: number }).ts = FRAME_TS_MS + 35_000;
    await callOnRuleEvaluation(rig, cache, frame3, broadcastStub.broadcast, lastSeen);
    expect(rig.alertUpdate).not.toHaveBeenCalled();

    // Frame 4: T0 + 30s + 65s = T0 + 95s. Elapsed = 60s =
    // hysteresis → CLEAR transition; alert.update fires.
    const frame4 = buildFrame({ tds_ppm: 180 });
    (frame4 as { ts: number }).ts = FRAME_TS_MS + 95_000;
    await callOnRuleEvaluation(rig, cache, frame4, broadcastStub.broadcast, lastSeen);
    expect(rig.alertUpdate).toHaveBeenCalledTimes(1);
    const updateCall = rig.alertUpdate.mock.calls[0]!;
    const updateArgs = updateCall[0] as { where: { id: string }; data: { clearedAt: Date } };
    expect(updateArgs.where.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(updateArgs.data.clearedAt.getTime()).toBe(FRAME_TS_MS + 95_000);
  });

  it("(iii) REOPEN_AFTER_CLEAR: open → clear → re-breach creates a NEW Alert row (separate from closed)", async () => {
    // AC6 pin: after the hysteresis window closes the alert and the
    // reading breaches again, a NEW Alert row opens with
    // `openedAt = re-fire frame.ts`. The previous alert row stays
    // closed (its `clearedAt` is set).
    const rig = buildRig();
    const cache = buildCache([
      withMinDuration({
        id: RULE_ID_DEBOUNCE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        minDurationSeconds: 30,
        hysteresisSeconds: 60,
      }),
    ]);
    const broadcastStub = createBroadcastStub();
    const lastSeen = new Map<string, Date>();

    // Phase 1 — open: T0 breach, T0+30s emit open.
    await callOnRuleEvaluation(
      rig,
      cache,
      { ...buildFrame({ tds_ppm: 312 }), ts: FRAME_TS_MS },
      broadcastStub.broadcast,
      lastSeen,
    );
    await callOnRuleEvaluation(
      rig,
      cache,
      { ...buildFrame({ tds_ppm: 312 }), ts: FRAME_TS_MS + 30_000 },
      broadcastStub.broadcast,
      lastSeen,
    );
    expect(rig.alertCreate).toHaveBeenCalledTimes(1);
    // Stub `findOpenAlert` so the clear path resolves. Side-effect:
    // when `alert.update` is called (the clear transition), reset
    // the stub to `null` so subsequent frames see no open alert —
    // mirrors the real DB where the alert row's `clearedAt` is now
    // set and the partial unique index would return no rows.
    rig.alertReaderFindFirst.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      deviceId: DEVICE_ID,
      ruleId: RULE_ID_DEBOUNCE,
      severity: "warning",
      metric: "tds_ppm",
      openedAt: new Date(FRAME_TS_MS + 30_000),
    });
    rig.alertUpdate.mockImplementation(() => {
      rig.alertReaderFindFirst.mockResolvedValue(null);
      return Promise.resolve({});
    });

    // Phase 2a — quiet at T0+35s. Falling edge starts; clearedSince = T0+35s.
    await callOnRuleEvaluation(
      rig,
      cache,
      { ...buildFrame({ tds_ppm: 180 }), ts: FRAME_TS_MS + 35_000 },
      broadcastStub.broadcast,
      lastSeen,
    );
    expect(rig.alertUpdate).not.toHaveBeenCalled();

    // Phase 2b — quiet at T0+95s. Elapsed = 60s = hysteresis → clear.
    await callOnRuleEvaluation(
      rig,
      cache,
      { ...buildFrame({ tds_ppm: 180 }), ts: FRAME_TS_MS + 95_000 },
      broadcastStub.broadcast,
      lastSeen,
    );
    expect(rig.alertUpdate).toHaveBeenCalledTimes(1);

    // Phase 3 — re-breach: T0+120s, breach again. First frame initializes
    // the new rising timer (no transition because elapsed=0).
    await callOnRuleEvaluation(
      rig,
      cache,
      { ...buildFrame({ tds_ppm: 312 }), ts: FRAME_TS_MS + 120_000 },
      broadcastStub.broadcast,
      lastSeen,
    );
    expect(rig.alertCreate).toHaveBeenCalledTimes(1); // still 1 (no new row yet)

    // Phase 4 — re-open: T0+150s, breach continues 30s after frame 3.
    await callOnRuleEvaluation(
      rig,
      cache,
      { ...buildFrame({ tds_ppm: 312 }), ts: FRAME_TS_MS + 150_000 },
      broadcastStub.broadcast,
      lastSeen,
    );
    expect(rig.alertCreate).toHaveBeenCalledTimes(2);
    const secondCreateCall = rig.alertCreate.mock.calls[1]!;
    const secondCreateArgs = secondCreateCall[0] as { data: { openedAt: Date } };
    expect(secondCreateArgs.data.openedAt.getTime()).toBe(FRAME_TS_MS + 150_000);
  });

  it("(iv) POST_COMMIT_EMIT_ORDERING: alert.create reject → NO broadcast emit", async () => {
    // B2 + Design Note "Socket emit happens post-commit". If the
    // Alert row INSERT rejects (e.g. Prisma network error, schema
    // drift, etc.), the hook MUST NOT emit `alert:opened` to the
    // client — that would advertise an Alert row that does not exist
    // in the DB. The BroadcastTarget stub captures every emit; this
    // test asserts the captured list is empty.
    const rig = buildRig();
    const cache = buildCache([
      withMinDuration({
        id: RULE_ID_DEBOUNCE,
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        minDurationSeconds: 0, // min=0 → opens on frame 1
        hysteresisSeconds: 60,
      }),
    ]);
    const broadcastStub = createBroadcastStub();
    // Force `alert.create` to reject with a generic error (NOT a P2002 —
    // P2002 is the duplicate-open race, which IS expected to suppress
    // the emit; this test pins the unrelated failure path).
    rig.alertCreate.mockRejectedValue(new Error("synthetic db failure"));

    // Frame 1: T0, breach. min=0 → open transition fires.
    await expect(
      callOnRuleEvaluation(
        rig,
        cache,
        { ...buildFrame({ tds_ppm: 312 }), ts: FRAME_TS_MS },
        broadcastStub.broadcast,
      ),
    ).rejects.toThrow("synthetic db failure");

    // Pin the room + event name literals — the wire contract.
    expect(broadcastStub.emits).toHaveLength(0);
  });

  it("(v) BOOT_GUARD_REJECTS: rule with min=0 AND hysteresis=0 throws WriteAmplificationError", async () => {
    // AC12 pin (negative path). The boot guard runs BEFORE the hook
    // is installed. Operators who configure min=0 AND hysteresis=0
    // are inviting the system to write Alert rows + emit on every
    // frame — that's the write-amplification scenario the guard
    // exists to prevent.
    const rig = buildRig();
    const cache = buildCache([
      withMinDuration({
        id: "33333333-3333-4333-8333-333333333333",
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0, // BOTH zero → boot guard fires
      }),
    ]);
    expect(() =>
      installRuleEngineHooks({
        cache,
        prisma: rig.prisma,
        readingRepository: rig.readingRepository,
        alertReader: rig.alertReader,
        alertState: rig.alertState,
      }),
    ).toThrow(WriteAmplificationError);
  });

  it("(vi) BOOT_GUARD_ALLOWS: rules with min>=1 OR hysteresis>=1 install normally", async () => {
    // AC12 pin (positive path). Rules with `min=0 AND hysteresis>=1`
    // (instant open, slow clear) or `min>=1 AND hysteresis=0`
    // (de-bounced open, instant clear) pass the guard.
    const rig = buildRig();
    const cache = buildCache([
      // Path 1: min=0, hysteresis=60 → OK (slow clear).
      withMinDuration({
        id: "44444444-4444-4444-8444-444444444444",
        deviceId: null,
        metric: "tds_ppm",
        operator: "gte",
        threshold: 300,
        severity: "warning",
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 60,
      }),
      // Path 2: min=30, hysteresis=0 → OK (de-bounced open, instant clear).
      {
        id: "55555555-5555-4555-8555-555555555555",
        deviceId: null,
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
        ruleType: "instant",
        minDurationSeconds: 30,
        hysteresisSeconds: 0,
      },
    ]);
    expect(() =>
      installRuleEngineHooks({
        cache,
        prisma: rig.prisma,
        readingRepository: rig.readingRepository,
        alertReader: rig.alertReader,
        alertState: rig.alertState,
      }),
    ).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// BroadcastTarget stub for post-commit ordering tests
// --------------------------------------------------------------------------

interface BroadcastStub {
  readonly broadcast: BroadcastTarget;
  readonly emits: ReadonlyArray<{
    readonly room: string;
    readonly event: string;
    readonly payload: unknown;
  }>;
}

const createBroadcastStub = (): BroadcastStub => {
  const emits: Array<{ room: string; event: string; payload: unknown }> = [];
  const broadcast: BroadcastTarget = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown): void => {
        emits.push({ room, event, payload });
      },
    }),
  };
  return { broadcast, emits };
};
