/**
 * Frame envelope driver over `PROCESSING_ORDER`.
 * Iterates the 10 ordered steps once per inbound WS frame; each step
 * is a pure helper. Ordering is pinned by the spec test.
 */
import {
  classifyFlags,
  PROCESSING_ORDER,
  type ReadingFlag,
  type ReadingNewEvent,
  type RuleMetric,
  STALE_FRAME_THRESHOLD_MS,
  type TelemetryFrame,
  TelemetryFrameSchema,
  translateZodError,
} from "@surakkha/shared";

import { getIngestHooks, type IngestHooks } from "./hooks";
import { type PerDeviceRateLimiter } from "./rateLimit";
import { type PerDeviceSequence } from "./sequence";

/** Prisma surface used by the persist + broadcast steps. */
export interface ReadingRepository {
  readonly reading: {
    create(args: {
      readonly data: {
        readonly deviceId: string;
        readonly ts: Date;
        readonly serverReceivedAt: Date;
        readonly metrics: TelemetryFrame["metrics"];
        readonly seq: number;
        readonly flags: readonly ReadingFlag[];
      };
    }): Promise<unknown>;
    findMany(args: {
      readonly where: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly ts: { readonly gte: Date };
      };
      readonly orderBy: { readonly ts: "asc" };
      readonly take: number;
    }): Promise<
      ReadonlyArray<{
        readonly ts: Date;
        readonly metrics: TelemetryFrame["metrics"];
      }>
    >;
  };
}

/** Minimal Socket.IO surface — `io.to(room).emit(event, payload)`. */
export interface BroadcastTarget {
  to(room: string): {
    emit(event: string, payload: unknown): unknown;
  };
}

export interface ProcessFrameDeps {
  readonly deviceId: string;
  readonly socket: {
    emit(event: string, payload: unknown): unknown;
    disconnect(close?: boolean): unknown;
  };
  readonly raw: unknown;
  readonly rateLimiter: PerDeviceRateLimiter;
  readonly sequence: PerDeviceSequence;
  readonly prisma: ReadingRepository;
  readonly io: BroadcastTarget;
  readonly hooks?: IngestHooks;
  readonly now?: () => Date;
  /** Optional read-side handle to the `Rule` table for the rules engine. */
  readonly ruleRepository?: {
    readonly rule: {
      findMany(args: { readonly where: { readonly isActive: true } }): Promise<readonly unknown[]>;
    };
  };
}

/** Per-frame decision returned to the WS handler. */
export type ProcessFrameOutcome =
  | { readonly status: "accepted" }
  | { readonly status: "bad_request" }
  | { readonly status: "rate_limited" }
  | { readonly status: "ignored" };

const deviceRoom = (deviceId: string): string => `device:${deviceId}`;

// Dashboard subscribes once; the same payload is fanned out to every
// device so a single socket carries the full feed.
const READINGS_LATEST_ROOM = "readings:latest";

/** Per-step result: `next` continues with an optional state patch;
 *  `exit` terminates the iteration with the outcome. */
type StepResult =
  | { readonly kind: "next"; readonly patch?: FrameStatePatch }
  | { readonly kind: "exit"; readonly outcome: ProcessFrameOutcome };

interface FrameStatePatch {
  parsed?: TelemetryFrame;
  flags?: readonly ReadingFlag[];
  dropCount?: number;
  serverReceivedAt?: Date;
}

interface FrameState {
  parsed: TelemetryFrame | null;
  flags: readonly ReadingFlag[];
  dropCount: number;
  serverReceivedAt: Date;
}

const applyPatch = (state: FrameState, patch: FrameStatePatch | undefined): FrameState => {
  if (patch === undefined) return state;
  return {
    parsed: patch.parsed !== undefined ? patch.parsed : state.parsed,
    flags: patch.flags !== undefined ? patch.flags : state.flags,
    dropCount: patch.dropCount !== undefined ? patch.dropCount : state.dropCount,
    serverReceivedAt:
      patch.serverReceivedAt !== undefined ? patch.serverReceivedAt : state.serverReceivedAt,
  };
};

const stepValidate = (
  state: FrameState,
  deps: {
    readonly raw: unknown;
    readonly socket: ProcessFrameDeps["socket"];
    readonly now: () => Date;
  },
): StepResult => {
  const result = TelemetryFrameSchema.safeParse(deps.raw);
  if (!result.success) {
    deps.socket.emit("bad_request", translateZodError(result.error));
    return { kind: "exit", outcome: { status: "bad_request" } };
  }

  // Stale-frame window: well-formed but `ts` is older than the threshold.
  const skewMs = state.serverReceivedAt.getTime() - result.data.ts;
  if (skewMs > STALE_FRAME_THRESHOLD_MS) {
    const ageSeconds = Math.floor(skewMs / 1_000);
    deps.socket.emit("stale_frame", { age_seconds: ageSeconds });
    deps.socket.disconnect(false);
    return { kind: "exit", outcome: { status: "ignored" } };
  }

  const flags = classifyFlags(result.data, state.serverReceivedAt);

  return {
    kind: "next",
    patch: { parsed: result.data, flags },
  };
};

const stepAuthCheck = (): StepResult => ({ kind: "next" });

const stepRateCheck = async (
  state: FrameState,
  deps: {
    readonly deviceId: string;
    readonly socket: ProcessFrameDeps["socket"];
    readonly rateLimiter: PerDeviceRateLimiter;
    readonly hooks: IngestHooks;
  },
): Promise<StepResult> => {
  const decision = deps.rateLimiter.tryAccept(deps.deviceId, state.serverReceivedAt.getTime());
  if (!decision.ok) {
    deps.socket.emit("rate_limited", { retry_after_seconds: decision.retryAfterSeconds });
    await deps.hooks.onAuditAppend({
      auditAction: "reading_rate_limited",
      deviceId: deps.deviceId,
      context: { retry_after_seconds: decision.retryAfterSeconds },
    });
    deps.socket.disconnect(true);
    return { kind: "exit", outcome: { status: "rate_limited" } };
  }
  return { kind: "next" };
};

const stepSeqDropCheck = async (
  state: FrameState,
  deps: {
    readonly deviceId: string;
    readonly sequence: PerDeviceSequence;
    readonly hooks: IngestHooks;
  },
): Promise<StepResult> => {
  if (state.parsed === null) {
    return { kind: "exit", outcome: { status: "ignored" } };
  }
  const obs = deps.sequence.observe(deps.deviceId, state.parsed.seq);
  const patch: FrameStatePatch = { dropCount: obs.dropCount };
  if (obs.outcome === "reorder") {
    patch.flags = ["out_of_order"];
    await deps.hooks.onAuditAppend({
      auditAction: "seq_reorder_detected",
      deviceId: deps.deviceId,
      context: { seq: state.parsed.seq, last_seen: obs.newLastSeen },
    });
  }
  if (obs.dropCount > 0) {
    await deps.hooks.onAuditAppend({
      auditAction: "seq_drop_detected",
      deviceId: deps.deviceId,
      context: { drop_count: obs.dropCount, last_seq: obs.newLastSeen },
    });
  }
  return { kind: "next", patch };
};

const stepPersist = async (
  state: FrameState,
  deps: {
    readonly deviceId: string;
    readonly prisma: ReadingRepository;
    readonly socket: ProcessFrameDeps["socket"];
  },
): Promise<StepResult> => {
  if (state.parsed === null) {
    return { kind: "exit", outcome: { status: "ignored" } };
  }
  try {
    await deps.prisma.reading.create({
      data: {
        deviceId: deps.deviceId,
        ts: new Date(state.parsed.ts),
        serverReceivedAt: state.serverReceivedAt,
        metrics: state.parsed.metrics,
        seq: state.parsed.seq,
        flags: state.flags,
      },
    });
  } catch (err) {
    console.error("ingest: persist failed", { deviceId: deps.deviceId, err });
    deps.socket.emit("persist_failed", { error: "persist_failed" });
    deps.socket.disconnect(true);
    return { kind: "exit", outcome: { status: "ignored" } };
  }
  return { kind: "next" };
};

const stepRuleEvaluation = async (
  state: FrameState,
  deps: { readonly deviceId: string; readonly hooks: IngestHooks },
): Promise<StepResult> => {
  if (state.parsed === null) {
    return { kind: "exit", outcome: { status: "ignored" } };
  }
  await deps.hooks.onRuleEvaluation({
    deviceId: deps.deviceId,
    frame: state.parsed,
    flags: state.flags,
  });
  return { kind: "next" };
};

const stepAlertEmission = async (deps: {
  readonly deviceId: string;
  readonly hooks: IngestHooks;
}): Promise<StepResult> => {
  await deps.hooks.onAlertEmission({
    deviceId: deps.deviceId,
    ruleId: "",
    severity: "info",
  });
  return { kind: "next" };
};

const stepStateMachineUpdate = async (deps: {
  readonly deviceId: string;
  readonly hooks: IngestHooks;
}): Promise<StepResult> => {
  await deps.hooks.onStateMachineUpdate({
    deviceId: deps.deviceId,
    state: "OBSERVING",
    previousState: null,
  });
  return { kind: "next" };
};

const stepAuditAppend = async (
  state: FrameState,
  deps: { readonly deviceId: string; readonly hooks: IngestHooks },
): Promise<StepResult> => {
  await deps.hooks.onAuditAppend({
    auditAction: "reading_ingested",
    deviceId: deps.deviceId,
    context: { seq: state.parsed?.seq, flags: state.flags },
  });
  return { kind: "next" };
};

const stepSocketBroadcast = (
  state: FrameState,
  deps: { readonly deviceId: string; readonly io: BroadcastTarget },
): StepResult => {
  if (state.parsed === null) {
    return { kind: "exit", outcome: { status: "ignored" } };
  }
  const payload: ReadingNewEvent = {
    device_id: deps.deviceId,
    ts: state.parsed.ts,
    server_received_at: state.serverReceivedAt.toISOString(),
    metrics: state.parsed.metrics,
    flags: state.flags,
  };
  deps.io.to(deviceRoom(deps.deviceId)).emit("reading:new", payload);
  deps.io.to(READINGS_LATEST_ROOM).emit("reading:new", payload);
  return { kind: "next" };
};

/** Iterate `PROCESSING_ORDER` and delegate each step to its pure helper. */
export const processFrame = async (deps: ProcessFrameDeps): Promise<ProcessFrameOutcome> => {
  const { deviceId, socket, raw, rateLimiter, sequence, prisma, io, now = () => new Date() } = deps;
  const hooks = deps.hooks ?? getIngestHooks();

  let state: FrameState = {
    parsed: null,
    flags: [],
    dropCount: 0,
    // Stamped once on entry; downstream steps read from `state`, not `now()`,
    // so the ordering guarantee has a single canonical read.
    serverReceivedAt: now(),
  };

  for (const step of PROCESSING_ORDER) {
    const result = await dispatchStep(step, state, {
      deviceId,
      socket,
      raw,
      rateLimiter,
      sequence,
      prisma,
      io,
      now,
      hooks,
    });
    if (result.kind === "exit") return result.outcome;
    state = applyPatch(state, result.patch);
  }

  return { status: "accepted" };
};

/* eslint-disable complexity -- 10 arms, one per step in PROCESSING_ORDER.
 * A lookup map would reorder adjacent pairs and break the spec pin.
 */
const dispatchStep = async (
  step: (typeof PROCESSING_ORDER)[number],
  state: FrameState,
  deps: {
    readonly deviceId: string;
    readonly socket: ProcessFrameDeps["socket"];
    readonly raw: unknown;
    readonly rateLimiter: PerDeviceRateLimiter;
    readonly sequence: PerDeviceSequence;
    readonly prisma: ReadingRepository;
    readonly io: BroadcastTarget;
    readonly now: () => Date;
    readonly hooks: IngestHooks;
  },
): Promise<StepResult> => {
  switch (step) {
    case "validate":
      return stepValidate(state, { raw: deps.raw, socket: deps.socket, now: deps.now });
    case "auth check":
      return stepAuthCheck();
    case "rate check":
      return stepRateCheck(state, {
        deviceId: deps.deviceId,
        socket: deps.socket,
        rateLimiter: deps.rateLimiter,
        hooks: deps.hooks,
      });
    case "seq/drop check":
      return stepSeqDropCheck(state, {
        deviceId: deps.deviceId,
        sequence: deps.sequence,
        hooks: deps.hooks,
      });
    case "persist":
      return stepPersist(state, {
        deviceId: deps.deviceId,
        prisma: deps.prisma,
        socket: deps.socket,
      });
    case "rule evaluation":
      return stepRuleEvaluation(state, { deviceId: deps.deviceId, hooks: deps.hooks });
    case "alert emission":
      return stepAlertEmission({ deviceId: deps.deviceId, hooks: deps.hooks });
    case "state-machine update":
      return stepStateMachineUpdate({ deviceId: deps.deviceId, hooks: deps.hooks });
    case "audit append":
      return stepAuditAppend(state, { deviceId: deps.deviceId, hooks: deps.hooks });
    case "socket broadcast":
      return stepSocketBroadcast(state, { deviceId: deps.deviceId, io: deps.io });
    default: {
      const _exhaustive: never = step;
      throw new Error(`unknown step: ${step as string}`);
    }
  }
};
