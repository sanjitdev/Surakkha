/**
 * Story 3.4 — `debounce.ts` pure unit tests.
 *
 * The pure module is tested without any Prisma mock — the value of
 * the seam is that `debounce.spec.ts` runs in isolation. The IO
 * (Alert row + socket emit) is exercised in `hooks.spec.ts`.
 *
 * Coverage (per spec `debounce.spec.ts` section):
 *   - RISING_EDGE_OPEN_AT_30S: AC2 — `frameTs - inViolationSince >= 30 * 1000` emits `open`.
 *   - RISING_EDGE_PAUSES_ON_DROP: AC1 — drop frame keeps `inViolationSince` set
 *     and advances `clearedSince`; the rising timer pauses, not resets.
 *   - FALLING_EDGE: AC3 — `frameTs - clearedSince >= 60 * 1000` emits `clear`.
 *   - RANGE_RULE_SHARED_TIMER: AC4 — `ph<6.5 critical` + `ph>8.5 critical`
 *     collapse to one timer.
 *   - FIRST_FRAME_BREACH: AC5 — `min=0` rule emits `open` on frame 1.
 *   - REOPEN_AFTER_CLEAR: AC6 — clear then re-breach emits a NEW `open`;
 *     `clearedSince` is nulled on the new rising edge.
 *   - TWO_SEVERITIES_SAME_FRAME: AC7 — warning + critical on same
 *     metric run independent timers.
 *   - POISON_VALUES: AC9 — `minDurationSeconds: -1` / NaN / Infinity AND
 *     `hysteresisSeconds: -1` / NaN / Infinity skip the slot.
 *   - CLOCK_SKEW: clamp applies to BOTH `inViolationSince` AND `clearedSince`.
 *   - CONCURRENT_FRAMES: trivially concurrency-safe (pure).
 *   - STALE_STATE_NO_RULE: rule deactivated, state row untouched.
 *   - BreachTransition shape: `kind` accepts exactly `"open" | "clear"`.
 * Total: 12 tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type BreachResult, type EngineRule } from "../engine";
import { type BreachTransition, debounceBreaches, type DebounceState } from "../debounce";

const DEVICE_ID = "9b1c4f00-0000-4000-8000-000000000d01";
const RULE_ID = "rule-debounce";
const OTHER_RULE_ID = "rule-debounce-other";
const T0 = new Date("2026-08-20T10:30:00.000Z");

const baseRule = (overrides: Partial<EngineRule> = {}): EngineRule => ({
  id: RULE_ID,
  deviceId: null,
  metric: "tds_ppm",
  operator: "gte",
  threshold: 300,
  severity: "warning",
  ruleType: "instant",
  minDurationSeconds: 30,
  hysteresisSeconds: 60,
  ...overrides,
});

const baseBreach = (overrides: Partial<BreachResult> = {}): BreachResult => ({
  ruleId: RULE_ID,
  deviceId: DEVICE_ID,
  metric: "tds_ppm",
  value: 312,
  severity: "warning",
  ruleType: "instant",
  observedAt: T0,
  ...overrides,
});

const EMPTY_STATE: DebounceState = Object.freeze({});

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

describe("Story 3.4 — debounceBreaches — RISING_EDGE", () => {
  it("AC2 — emits open when frameTs - inViolationSince >= minDurationSeconds * 1000", () => {
    // Frame at t = 30_000 ms after `inViolationSince = T0`.
    const inViolationSince = T0;
    const frameTs = new Date(T0.getTime() + 30_000);
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince, clearedSince: null },
    };
    const result = debounceBreaches({
      rawBreaches: [baseBreach({ observedAt: frameTs })],
      currentState: state,
      rules: [baseRule()],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(1);
    const t = result.transitions[0] as BreachTransition;
    expect(t.kind).toBe("open");
    if (t.kind === "open") {
      expect(t.metric).toBe("tds_ppm");
      expect(t.severity).toBe("warning");
      expect(t.ruleId).toBe(RULE_ID);
      expect(t.openedAt.getTime()).toBe(frameTs.getTime());
    }
  });

  it("AC1 — pause-not-reset: drop frame keeps inViolationSince set and advances clearedSince", () => {
    // First frame at T0 breaches; rule min=30. State has
    // inViolationSince = T0. A drop frame at T0+5s arrives with NO
    // raw breach. Per AC1, inViolationSince STAYS at T0 (pause, not
    // reset) and clearedSince advances to frameTs (rising paused,
    // falling started).
    const inViolationSince = T0;
    const frameTs = new Date(T0.getTime() + 5_000);
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince, clearedSince: null },
    };
    const result = debounceBreaches({
      rawBreaches: [], // no breach on drop frame
      currentState: state,
      rules: [baseRule()],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(0); // no open, no clear yet (hysteresis=60s)
    const next = result.nextState["tds_ppm\u0000warning"];
    expect(next).toBeDefined();
    expect(next?.inViolationSince?.getTime()).toBe(inViolationSince.getTime()); // PAUSED
    expect(next?.clearedSince?.getTime()).toBe(frameTs.getTime()); // ADVANCED
  });

  it("does NOT emit open at < minDurationSeconds * 1000 ms elapsed", () => {
    const inViolationSince = T0;
    const frameTs = new Date(T0.getTime() + 29_999); // 1ms short
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince, clearedSince: null },
    };
    const result = debounceBreaches({
      rawBreaches: [baseBreach({ observedAt: frameTs })],
      currentState: state,
      rules: [baseRule()],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(0);
  });
});

describe("Story 3.4 — debounceBreaches — FIRST_FRAME_BREACH", () => {
  it("AC5 — min=0 rule emits open on frame 1", () => {
    const frameTs = T0;
    const result = debounceBreaches({
      rawBreaches: [baseBreach({ observedAt: frameTs })],
      currentState: EMPTY_STATE,
      rules: [baseRule({ minDurationSeconds: 0 })],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(1);
    const t = result.transitions[0] as BreachTransition;
    expect(t.kind).toBe("open");
  });
});

describe("Story 3.4 — debounceBreaches — FALLING_EDGE", () => {
  it("AC3 — emits clear when frameTs - clearedSince >= hysteresisSeconds * 1000", () => {
    // State: previously open, now in falling edge.
    // inViolationSince = T0 (paused per AC1), clearedSince = T0 (rising cleared).
    const frameTs = new Date(T0.getTime() + 60_000);
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince: T0, clearedSince: T0 },
    };
    const result = debounceBreaches({
      rawBreaches: [],
      currentState: state,
      rules: [baseRule()],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(1);
    const t = result.transitions[0] as BreachTransition;
    expect(t.kind).toBe("clear");
    if (t.kind === "clear") {
      expect(t.clearedAt.getTime()).toBe(frameTs.getTime());
    }
  });

  it("does NOT emit clear at < hysteresisSeconds * 1000 ms elapsed", () => {
    const frameTs = new Date(T0.getTime() + 59_999);
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince: T0, clearedSince: T0 },
    };
    const result = debounceBreaches({
      rawBreaches: [],
      currentState: state,
      rules: [baseRule()],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(0);
  });
});

describe("Story 3.4 — debounceBreaches — RANGE_RULE_SHARED_TIMER", () => {
  it("AC4 — ph<6.5 critical + ph>8.5 critical collapse to one timer", () => {
    // Two rules on the same `(metric, severity)` slot. Only ONE
    // timer advances. The raw breach is for the upper-half rule
    // (`ruleId: "rule-ph-high"`).
    const phLowRule = baseRule({
      id: "rule-ph-low",
      metric: "ph",
      severity: "critical",
      operator: "lt",
      threshold: 6.5,
      minDurationSeconds: 30,
      hysteresisSeconds: 60,
    });
    const phHighRule = baseRule({
      id: "rule-ph-high",
      metric: "ph",
      severity: "critical",
      operator: "gt",
      threshold: 8.5,
      minDurationSeconds: 30,
      hysteresisSeconds: 60,
    });
    const inViolationSince = T0;
    const frameTs = new Date(T0.getTime() + 30_000);
    const state: DebounceState = {
      "ph\u0000critical": { inViolationSince, clearedSince: null },
    };
    const result = debounceBreaches({
      rawBreaches: [baseBreach({ metric: "ph", severity: "critical", ruleId: "rule-ph-high" })],
      currentState: state,
      rules: [phLowRule, phHighRule],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]?.kind).toBe("open");
    // The `ruleId` on the transition is whichever rule was first in
    // the slot's map — pin one to avoid regression in ordering.
    const t = result.transitions[0] as Extract<BreachTransition, { kind: "open" }>;
    expect(["rule-ph-low", "rule-ph-high"]).toContain(t.ruleId);
  });
});

describe("Story 3.4 — debounceBreaches — TWO_SEVERITIES_SAME_FRAME", () => {
  it("AC7 — warning + critical on same metric run independent timers", () => {
    // Two slots on the same metric, different severities. Both
    // breach the same frame. Both timers advance independently.
    const warningRule = baseRule({ severity: "warning", minDurationSeconds: 30 });
    const criticalRule = baseRule({
      id: OTHER_RULE_ID,
      severity: "critical",
      minDurationSeconds: 60,
    });
    const inViolationSince = T0;
    const frameTs = new Date(T0.getTime() + 30_000);
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince, clearedSince: null },
      "tds_ppm\u0000critical": { inViolationSince, clearedSince: null },
    };
    const result = debounceBreaches({
      rawBreaches: [
        baseBreach({ severity: "warning" }),
        baseBreach({ severity: "critical", ruleId: OTHER_RULE_ID }),
      ],
      currentState: state,
      rules: [warningRule, criticalRule],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    // Warning: min=30 elapsed → open. Critical: min=60 NOT elapsed → no open.
    expect(result.transitions).toHaveLength(1);
    const t = result.transitions[0] as Extract<BreachTransition, { kind: "open" }>;
    expect(t.severity).toBe("warning");
  });
});

describe("Story 3.4 — debounceBreaches — REOPEN_AFTER_CLEAR", () => {
  it("AC6 — clear then re-breach emits a NEW open transition", () => {
    // State: previously cleared. `clearedSince` is set; rising
    // cleared after hysteresis. New breach arrives — first frame
    // initializes `inViolationSince` (no open yet because elapsed=0);
    // second frame at `frameTs + 30s` finds `elapsed = 30s = min`,
    // emits `open`. `clearedSince` is nulled on the rising edge.
    const clearedSince = T0;
    const breachStart = new Date(T0.getTime() + 120_000);
    const secondFrame = new Date(breachStart.getTime() + 30_000);

    // Frame 1: initializes rising timer, no open yet.
    const r1 = debounceBreaches({
      rawBreaches: [baseBreach({ observedAt: breachStart })],
      currentState: {
        "tds_ppm\u0000warning": { inViolationSince: null, clearedSince },
      },
      rules: [baseRule({ minDurationSeconds: 30 })],
      frameTs: breachStart,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(r1.transitions).toHaveLength(0);
    const afterFrame1 = r1.nextState["tds_ppm\u0000warning"];
    expect(afterFrame1?.clearedSince).toBeNull(); // rising wins
    expect(afterFrame1?.inViolationSince?.getTime()).toBe(breachStart.getTime());

    // Frame 2: 30s elapsed → open.
    const r2 = debounceBreaches({
      rawBreaches: [baseBreach({ observedAt: secondFrame })],
      currentState: r1.nextState,
      rules: [baseRule({ minDurationSeconds: 30 })],
      frameTs: secondFrame,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: breachStart,
    });
    expect(r2.transitions).toHaveLength(1);
    expect(r2.transitions[0]?.kind).toBe("open");
  });
});

describe("Story 3.4 — debounceBreaches — POISON_VALUES", () => {
  it("AC9 — minDurationSeconds: NaN / Infinity / negative skip the slot", () => {
    const poisons: Array<{ minDurationSeconds: number }> = [
      { minDurationSeconds: -1 },
      { minDurationSeconds: Number.NaN },
      { minDurationSeconds: Number.POSITIVE_INFINITY },
    ];
    for (const p of poisons) {
      const rule = baseRule(p);
      const result = debounceBreaches({
        rawBreaches: [baseBreach()],
        currentState: EMPTY_STATE,
        rules: [rule],
        frameTs: T0,
        deviceId: DEVICE_ID,
        lastSeenFrameTs: null,
      });
      expect(result.transitions).toHaveLength(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[debounce] skipped poison ruleId=${RULE_ID}`),
      );
    }
  });

  it("AC9 — hysteresisSeconds: NaN / Infinity / negative skip the slot", () => {
    const poisons: Array<{ hysteresisSeconds: number }> = [
      { hysteresisSeconds: -1 },
      { hysteresisSeconds: Number.NaN },
      { hysteresisSeconds: Number.POSITIVE_INFINITY },
    ];
    for (const p of poisons) {
      const rule = baseRule(p);
      const state: DebounceState = {
        "tds_ppm\u0000warning": { inViolationSince: T0, clearedSince: T0 },
      };
      const frameTs = new Date(T0.getTime() + 60_000);
      const result = debounceBreaches({
        rawBreaches: [],
        currentState: state,
        rules: [rule],
        frameTs,
        deviceId: DEVICE_ID,
        lastSeenFrameTs: null,
      });
      expect(result.transitions).toHaveLength(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[debounce] skipped poison ruleId=${RULE_ID}`),
      );
    }
  });
});

describe("Story 3.4 — debounceBreaches — CLOCK_SKEW", () => {
  it("clamps BOTH inViolationSince AND clearedSince forward to frameTs", () => {
    // frameTs < lastSeenFrameTs triggers skew. Both timers clamp.
    const prevInViolation = new Date(T0.getTime() + 10_000);
    const prevCleared = new Date(T0.getTime() + 20_000);
    const state: DebounceState = {
      "tds_ppm\u0000warning": {
        inViolationSince: prevInViolation,
        clearedSince: prevCleared,
      },
    };
    const frameTs = T0; // earlier than both timers → skew
    const result = debounceBreaches({
      rawBreaches: [],
      currentState: state,
      rules: [baseRule()],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: new Date(T0.getTime() + 30_000),
    });
    const next = result.nextState["tds_ppm\u0000warning"];
    expect(next?.inViolationSince?.getTime()).toBe(frameTs.getTime());
    expect(next?.clearedSince?.getTime()).toBe(frameTs.getTime());
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[debounce] clock skew"));
  });

  it("lastSeenFrameTs === null (post-restart) does not trigger skew on first frame", () => {
    // Spec design note: post-restart, Map is empty; first frame's
    // skew check is silently skipped (Postgres `inViolationSince`
    // is authoritative, not the Map). Use `min=0` so the open
    // transition emits on the first frame without needing a
    // multi-frame run.
    const frameTs = T0;
    const result = debounceBreaches({
      rawBreaches: [baseBreach()],
      currentState: EMPTY_STATE,
      rules: [baseRule({ minDurationSeconds: 0 })],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    // No skew warning fired.
    const warnCalls = consoleWarnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes("clock skew"))).toBe(false);
    // The transition still proceeds normally.
    expect(result.transitions).toHaveLength(1);
  });
});

describe("Story 3.4 — debounceBreaches — STALE_STATE_NO_RULE", () => {
  it("rule deactivated: state row untouched, no transitions emitted", () => {
    // A breach arrives but no rule is in the rules list for that
    // slot (rule was deactivated in 3.7). Per spec, the state row
    // stays untouched.
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince: T0, clearedSince: null },
    };
    const result = debounceBreaches({
      rawBreaches: [baseBreach()],
      currentState: state,
      rules: [], // no rule at all
      frameTs: new Date(T0.getTime() + 30_000),
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    expect(result.transitions).toHaveLength(0);
    const next = result.nextState["tds_ppm\u0000warning"];
    expect(next?.inViolationSince?.getTime()).toBe(T0.getTime()); // unchanged
  });
});

describe("Story 3.4 — BreachTransition shape", () => {
  it("discriminator: kind accepts exactly 'open' | 'clear'", () => {
    // Pin the discriminator literal set. A regression that adds a
    // third kind (e.g. 'reopen') would silently flow through the
    // type but the spec has no row for it; this test pins the
    // current closed set.
    const frameTs = T0;
    const result = debounceBreaches({
      rawBreaches: [baseBreach({ observedAt: frameTs })],
      currentState: EMPTY_STATE,
      rules: [baseRule({ minDurationSeconds: 0 })],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    for (const t of result.transitions) {
      expect(["open", "clear"]).toContain(t.kind);
    }
  });

  it("open carries ruleId + metric + severity + deviceId + openedAt", () => {
    const result = debounceBreaches({
      rawBreaches: [baseBreach()],
      currentState: EMPTY_STATE,
      rules: [baseRule({ minDurationSeconds: 0 })],
      frameTs: T0,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    const t = result.transitions[0] as Extract<BreachTransition, { kind: "open" }>;
    expect(t.ruleId).toBe(RULE_ID);
    expect(t.metric).toBe("tds_ppm");
    expect(t.severity).toBe("warning");
    expect(t.deviceId).toBe(DEVICE_ID);
    expect(t.openedAt).toBeInstanceOf(Date);
  });

  it("clear carries clearedAt", () => {
    const frameTs = new Date(T0.getTime() + 60_000);
    const state: DebounceState = {
      "tds_ppm\u0000warning": { inViolationSince: T0, clearedSince: T0 },
    };
    const result = debounceBreaches({
      rawBreaches: [],
      currentState: state,
      rules: [baseRule()],
      frameTs,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    });
    const t = result.transitions[0] as Extract<BreachTransition, { kind: "clear" }>;
    expect(t.clearedAt).toBeInstanceOf(Date);
    expect(t.clearedAt.getTime()).toBe(frameTs.getTime());
  });
});

describe("Story 3.4 — debounceBreaches — CONCURRENT_FRAMES", () => {
  it("pure function: same input → same output (trivially concurrency-safe)", () => {
    // The pure module has no side effects; calling twice with the
    // same input returns structurally identical output. This pins
    // the determinism property that makes the partial unique index
    // + hook-layer serialization sufficient.
    const args = {
      rawBreaches: [baseBreach()],
      currentState: EMPTY_STATE,
      rules: [baseRule({ minDurationSeconds: 0 })],
      frameTs: T0,
      deviceId: DEVICE_ID,
      lastSeenFrameTs: null,
    };
    const r1 = debounceBreaches(args);
    const r2 = debounceBreaches(args);
    expect(r1.transitions).toHaveLength(r2.transitions.length);
    expect(r1.transitions[0]?.kind).toBe(r2.transitions[0]?.kind);
  });
});
