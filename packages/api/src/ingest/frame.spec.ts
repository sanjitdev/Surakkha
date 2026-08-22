/**
 * Story 2.2 — processFrame end-to-end.
 *
 * Mirrors the `router.spec.ts` pattern (no supertest; native fetch
 * via `createServer(app)`); here we don't need an HTTP seam — the
 * unit under test is the `processFrame` driver. We inject a
 * vi.fn() for the Prisma delegate and a tiny EventEmitter shim
 * for `io.to(room).emit(...)`. The production code stays free
 * of vi.mock() at the package level.
 *
 * Covers the spec's I/O matrix rows:
 *   - happy path: persist + broadcast
 *   - rate-limit short-circuit (second frame within 2s)
 *   - seq-reorder flagging
 *   - gap detection (seq 10 → 13) → dropCount
 *   - bad-request translation (Zod failure)
 *   - hooks no-op (default IngestHooks is the no-op set)
 *   - PROCESSING_ORDER.length === 10 and order is preserved
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROCESSING_ORDER, type TelemetryFrame } from "@surakkha/shared";

import {
  processFrame,
  type ProcessFrameOutcome,
  type ReadingRepository,
} from "./frame";
import { resetIngestHooks, type IngestHooks } from "./hooks";
import { PerDeviceRateLimiter } from "./rateLimit";
import { PerDeviceSequence } from "./sequence";

const DEVICE_ID = "9b1c4f00-0000-4000-8000-00000000000a";

const buildFrame = (overrides: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
  version: 1,
  device_id: DEVICE_ID,
  ts: 1_700_000_000_000,
  fw: "1.0.3",
  seq: 0,
  metrics: {
    ph: 7.2,
    tds_ppm: 180,
    turbidity_ntu: 0.4,
    temp_c: 27.4,
    chlorine_ppm: 0.6,
    water_level_cm: 85,
  },
  ...overrides,
});

interface TestRig {
  readonly socket: {
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  readonly prisma: ReadingRepository;
  readonly prismaCreate: ReturnType<typeof vi.fn>;
  readonly io: ReturnType<typeof vi.fn>;
  readonly rateLimiter: PerDeviceRateLimiter;
  readonly sequence: PerDeviceSequence;
  now: () => Date;
}

const buildRig = (): TestRig => {
  // The shim must expose `to(room)` returning `{ emit(event, payload) }`.
  const ioEmit = vi.fn((_event: string, _payload: unknown) => undefined);
  const prismaCreate = vi.fn(async () => ({}));
  const prisma: ReadingRepository = {
    reading: { create: prismaCreate },
  };
  return {
    socket: { emit: vi.fn(), disconnect: vi.fn() },
    prisma,
    prismaCreate,
    io: ioEmit,
    rateLimiter: new PerDeviceRateLimiter(),
    sequence: new PerDeviceSequence(),
    now: () => new Date("2026-08-20T10:31:04.000Z"),
  };
};

const callProcessFrame = async (
  rig: TestRig,
  raw: unknown,
  deviceId: string = DEVICE_ID,
  hooks?: IngestHooks,
): Promise<ProcessFrameOutcome> =>
  processFrame({
    deviceId,
    socket: rig.socket,
    raw,
    rateLimiter: rig.rateLimiter,
    sequence: rig.sequence,
    prisma: rig.prisma,
    io: {
      to() {
        return { emit: rig.io };
      },
    },
    now: rig.now,
    hooks,
  });

/**
 * Story 2.2 — the module-level singleton `currentHooks` in
 * `hooks.ts` can leak across tests. Reset it after every test so
 * an earlier `setIngestHooks(...)` does not silently affect later
 * assertions.
 */
afterEach(() => {
  resetIngestHooks();
});

describe("processFrame — PROCESSING_ORDER", () => {
  it("is exactly 10 steps in the contract order", () => {
    expect(PROCESSING_ORDER).toEqual([
      "validate",
      "auth check",
      "rate check",
      "seq/drop check",
      "persist",
      "rule evaluation",
      "alert emission",
      "state-machine update",
      "audit append",
      "socket broadcast",
    ]);
    expect(PROCESSING_ORDER.length).toBe(10);
  });
});

describe("processFrame — happy path", () => {
  it("persists a Reading row and broadcasts reading:new to device:<id>", async () => {
    const rig = buildRig();
    const outcome = await callProcessFrame(rig, buildFrame({ seq: 0 }));
    expect(outcome).toEqual({ status: "accepted" });

    expect(rig.prismaCreate).toHaveBeenCalledTimes(1);
    const call = rig.prismaCreate.mock.calls[0]![0] as {
      data: {
        deviceId: string;
        ts: Date;
        serverReceivedAt: Date;
        metrics: unknown;
        seq: number;
        flags: string[];
      };
    };
    expect(call.data.deviceId).toBe(DEVICE_ID);
    expect(call.data.seq).toBe(0);
    expect(call.data.flags).toEqual([]);
    expect(call.data.metrics).toMatchObject({ ph: 7.2 });

    // F-P11(c): pin the serverReceivedAt value so a regression that
    // re-stamps the timestamp inside stepValidate fails this test.
    expect(call.data.serverReceivedAt).toEqual(rig.now());

    expect(rig.io).toHaveBeenCalledWith(
      "reading:new",
      expect.objectContaining({
        device_id: DEVICE_ID,
        metrics: expect.objectContaining({ ph: 7.2 }),
        // F-D2: flags surface on the broadcast payload so consumers
        // can see late-frame reorder visibility without a REST fetch.
        flags: [],
      }),
    );
  });
});

describe("processFrame — rate limit", () => {
  it("short-circuits the second frame within 2s and emits rate_limited", async () => {
    const rig = buildRig();
    const first = await callProcessFrame(rig, buildFrame({ seq: 0 }));
    expect(first.status).toBe("accepted");

    const second = await callProcessFrame(rig, buildFrame({ seq: 1 }));
    expect(second.status).toBe("rate_limited");
    expect(rig.socket.emit).toHaveBeenCalledWith("rate_limited", {
      retry_after_seconds: 2,
    });
    expect(rig.socket.disconnect).toHaveBeenCalledWith(true);
    // No second row.
    expect(rig.prismaCreate).toHaveBeenCalledTimes(1);
  });
});

describe("processFrame — sequence reorder", () => {
  it("persists a late frame with flags:['out_of_order'] and still broadcasts", async () => {
    const rig = buildRig();
    let nowMs = 1_000_000_000_000;
    rig.now = () => new Date(nowMs);
    await callProcessFrame(rig, buildFrame({ seq: 5 }));
    // Advance 3s so the rate limiter window has elapsed.
    nowMs += 3_000;
    const late = await callProcessFrame(rig, buildFrame({ seq: 3 }));
    expect(late.status).toBe("accepted");

    const {flags} = (rig.prismaCreate.mock.calls[1]![0] as {
      data: { flags: string[] };
    }).data;
    expect(flags).toEqual(["out_of_order"]);
    // The broadcast still fires, now carrying the flag (F-D2).
    expect(rig.io).toHaveBeenCalledWith(
      "reading:new",
      expect.objectContaining({
        device_id: DEVICE_ID,
        flags: ["out_of_order"],
      }),
    );
  });

  it("records a gap drop_count when seq jumps (10 → 13)", async () => {
    const rig = buildRig();
    let nowMs = 1_000_000_000_000;
    rig.now = () => new Date(nowMs);
    await callProcessFrame(rig, buildFrame({ seq: 10 }));
    // Advance 3s so the rate limiter window has elapsed.
    nowMs += 3_000;
    const jumped = await callProcessFrame(rig, buildFrame({ seq: 13 }));
    expect(jumped.status).toBe("accepted");
    const {flags} = (rig.prismaCreate.mock.calls[1]![0] as {
      data: { flags: string[] };
    }).data;
    // Gap is logged via the audit hook, NOT as a flag on the row.
    expect(flags).toEqual([]);
  });

  // F-P11(a): pin that the seq_drop_detected audit hook fires
  // (not just that flags:[] persists). The existing gap test
  // covers the row; this covers the audit-pipeline contract.
  it("emits seq_drop_detected audit hook when a gap is observed", async () => {
    const rig = buildRig();
    let nowMs = 1_000_000_000_000;
    rig.now = () => new Date(nowMs);
    const hooks = {
      onRuleEvaluation: vi.fn(async () => undefined),
      onAlertEmission: vi.fn(async () => undefined),
      onStateMachineUpdate: vi.fn(async () => undefined),
      onAuditAppend: vi.fn(async () => undefined),
    };
    await callProcessFrame(rig, buildFrame({ seq: 10 }), DEVICE_ID, hooks);
    nowMs += 3_000;
    await callProcessFrame(rig, buildFrame({ seq: 13 }), DEVICE_ID, hooks);

    // The first frame (seq:10) also produces a seq_drop_detected
    // because the device's lastSeen defaults to -1 (gap of 10
    // frames [0..9]). Filter for the second frame's specific
    // drop_count so the test pins the contract: a gap crossing
    // an EXISTING last_seen fires the audit hook.
    const gapCalls = hooks.onAuditAppend.mock.calls.filter(
      (call) =>
        (call[0] as { auditAction: string; context?: { drop_count?: number } })
          .auditAction === "seq_drop_detected" &&
        (call[0] as { context: { drop_count: number } }).context.drop_count === 2,
    );
    expect(gapCalls).toHaveLength(1);
    expect(gapCalls[0]?.[0]).toEqual({
      auditAction: "seq_drop_detected",
      deviceId: DEVICE_ID,
      context: { drop_count: 2, last_seq: 13 },
    });
  });

  // F-P7: a late frame (reorder) emits seq_reorder_detected on the
  // audit hook so an operator triaging the audit log can distinguish
  // a lost-frame gap from a late retransmit.
  it("emits seq_reorder_detected audit hook on a late frame", async () => {
    const rig = buildRig();
    let nowMs = 1_000_000_000_000;
    rig.now = () => new Date(nowMs);
    const hooks = {
      onRuleEvaluation: vi.fn(async () => undefined),
      onAlertEmission: vi.fn(async () => undefined),
      onStateMachineUpdate: vi.fn(async () => undefined),
      onAuditAppend: vi.fn(async () => undefined),
    };
    await callProcessFrame(rig, buildFrame({ seq: 5 }), DEVICE_ID, hooks);
    nowMs += 3_000;
    await callProcessFrame(rig, buildFrame({ seq: 3 }), DEVICE_ID, hooks);

    const reorderCalls = hooks.onAuditAppend.mock.calls.filter(
      (call) => (call[0] as { auditAction: string }).auditAction === "seq_reorder_detected",
    );
    expect(reorderCalls).toHaveLength(1);
    expect(reorderCalls[0]?.[0]).toEqual({
      auditAction: "seq_reorder_detected",
      deviceId: DEVICE_ID,
      context: { seq: 3, last_seen: 5 },
    });
  });
});

describe("processFrame — bad request", () => {
  it("translates a Zod failure into a bad_request envelope and stays open", async () => {
    const rig = buildRig();
    const bad = { ...buildFrame(), metrics: { ...buildFrame().metrics, ph: 15 } };
    const outcome = await callProcessFrame(rig, bad);
    expect(outcome).toEqual({ status: "bad_request" });
    // F-P11(e): tighten the missing_fields assertion so a regression
    // that flattens dotted paths to bare field names is caught.
    // The wire contract from F2 (Story 2.1 amendment) is
    // `metrics.ph` — firmware keys on the dotted-path shape.
    expect(rig.socket.emit).toHaveBeenCalledWith(
      "bad_request",
      expect.objectContaining({
        error: "bad_request",
        missing_fields: expect.arrayContaining(["metrics.ph"]),
      }),
    );
    // No row, no disconnect.
    expect(rig.prismaCreate).not.toHaveBeenCalled();
    expect(rig.socket.disconnect).not.toHaveBeenCalled();
  });
});

describe("processFrame — hooks no-op", () => {
  it("runs the default no-op hooks without throwing", async () => {
    const rig = buildRig();
    // The default `getIngestHooks()` is the no-op set; we don't
    // override it here.
    const outcome = await callProcessFrame(rig, buildFrame({ seq: 0 }));
    expect(outcome.status).toBe("accepted");
    expect(rig.prismaCreate).toHaveBeenCalledTimes(1);
  });
});

/**
 * Story 2.2 — code review F-P11(b).
 *
 * `stepPersist` catches every Prisma throw and emits `persist_failed`
 * before disconnecting. Pin that the envelope + disconnect fire so
 * a regression that swallows the error (and lets the driver fall
 * through to subsequent steps) is caught here rather than at the
 * integration layer.
 */
describe("processFrame — persist failure", () => {
  it("emits persist_failed and disconnects when prisma.reading.create rejects", async () => {
    const rig = buildRig();
    const cause = new Error("connection terminated");
    rig.prismaCreate.mockRejectedValueOnce(cause);

    // Suppress the api logger line that stepPersist now writes via
    // console.error — we want the test output clean but still
    // exercise the production logging path.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const outcome = await callProcessFrame(rig, buildFrame({ seq: 0 }));
      expect(outcome).toEqual({ status: "ignored" });
      expect(rig.socket.emit).toHaveBeenCalledWith("persist_failed", {
        error: "persist_failed",
      });
      expect(rig.socket.disconnect).toHaveBeenCalledWith(true);
      // The underlying Prisma error reached the api logger so an
      // operator can distinguish DB-down, FK-violation, and
      // unique-key-violation in production logs.
      expect(consoleSpy).toHaveBeenCalledWith(
        "ingest: persist failed",
        expect.objectContaining({ deviceId: DEVICE_ID, err: cause }),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

/**
 * Story 2.2 — review patches: hook payload assertions.
 *
 * The frame driver calls hooks at every typed step. We pin the
 * payload shape so an epistemic drift in any future step refactor
 * fails the test (cheaper than a Story 3 wire-shape surprise).
 */
describe("processFrame — hook payloads", () => {
  const buildHookSpies = (): IngestHooks & {
    readonly onRuleEvaluation: ReturnType<typeof vi.fn>;
    readonly onAlertEmission: ReturnType<typeof vi.fn>;
    readonly onStateMachineUpdate: ReturnType<typeof vi.fn>;
    readonly onAuditAppend: ReturnType<typeof vi.fn>;
  } => ({
    onRuleEvaluation: vi.fn(async () => undefined),
    onAlertEmission: vi.fn(async () => undefined),
    onStateMachineUpdate: vi.fn(async () => undefined),
    onAuditAppend: vi.fn(async () => undefined),
  });

  it("emits rule evaluation, alert, state-machine, and audit-append hooks on the happy path", async () => {
    const rig = buildRig();
    const hooks = buildHookSpies();
    const frame = buildFrame({ seq: 0 });
    const outcome = await callProcessFrame(rig, frame, DEVICE_ID, hooks);
    expect(outcome).toEqual({ status: "accepted" });

    expect(hooks.onRuleEvaluation).toHaveBeenCalledTimes(1);
    expect(hooks.onRuleEvaluation).toHaveBeenCalledWith({
      deviceId: DEVICE_ID,
      frame,
      flags: [],
    });

    // F-P11(d): pin the placeholder payload literals for the two
    // v1 no-op hook steps. The `stepAlertEmission` and
    // `stepStateMachineUpdate` helpers hard-code `ruleId: ""`,
    // `severity: "info"`, `state: "OBSERVING"`, `previousState: null`
    // because the Epic 3/4 implementations are not yet wired.
    // Pinning them here means a refactor that drifts the contract
    // is caught by this test rather than by Epic 3 first-integration.
    expect(hooks.onAlertEmission).toHaveBeenCalledTimes(1);
    expect(hooks.onAlertEmission).toHaveBeenCalledWith({
      deviceId: DEVICE_ID,
      ruleId: "",
      severity: "info",
    });
    expect(hooks.onStateMachineUpdate).toHaveBeenCalledTimes(1);
    expect(hooks.onStateMachineUpdate).toHaveBeenCalledWith({
      deviceId: DEVICE_ID,
      state: "OBSERVING",
      previousState: null,
    });
    expect(hooks.onAuditAppend).toHaveBeenCalledTimes(1);
    expect(hooks.onAuditAppend).toHaveBeenCalledWith({
      auditAction: "reading_ingested",
      deviceId: DEVICE_ID,
      context: { seq: 0, flags: [] },
    });
  });

  it("emits onAuditAppend with reading_rate_limited + retry_after_seconds on rate limit", async () => {
    const rig = buildRig();
    const hooks = buildHookSpies();
    const first = await callProcessFrame(rig, buildFrame({ seq: 0 }), DEVICE_ID, hooks);
    expect(first.status).toBe("accepted");

    const second = await callProcessFrame(rig, buildFrame({ seq: 1 }), DEVICE_ID, hooks);
    expect(second.status).toBe("rate_limited");

    const rateLimitedCalls = hooks.onAuditAppend.mock.calls.filter(
      (call) => (call[0] as { auditAction: string }).auditAction === "reading_rate_limited",
    );
    expect(rateLimitedCalls).toHaveLength(1);
    expect(rateLimitedCalls[0]?.[0]).toEqual({
      auditAction: "reading_rate_limited",
      deviceId: DEVICE_ID,
      context: { retry_after_seconds: 2 },
    });
  });
});