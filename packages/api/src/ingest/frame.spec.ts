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

    expect(rig.io).toHaveBeenCalledWith(
      "reading:new",
      expect.objectContaining({
        device_id: DEVICE_ID,
        metrics: expect.objectContaining({ ph: 7.2 }),
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
    // The broadcast still fires.
    expect(rig.io).toHaveBeenCalledWith(
      "reading:new",
      expect.objectContaining({ device_id: DEVICE_ID }),
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
});

describe("processFrame — bad request", () => {
  it("translates a Zod failure into a bad_request envelope and stays open", async () => {
    const rig = buildRig();
    const bad = { ...buildFrame(), metrics: { ...buildFrame().metrics, ph: 15 } };
    const outcome = await callProcessFrame(rig, bad);
    expect(outcome).toEqual({ status: "bad_request" });
    expect(rig.socket.emit).toHaveBeenCalledWith(
      "bad_request",
      expect.objectContaining({
        error: "bad_request",
        missing_fields: expect.any(Array),
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

    expect(hooks.onAlertEmission).toHaveBeenCalledTimes(1);
    expect(hooks.onStateMachineUpdate).toHaveBeenCalledTimes(1);
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