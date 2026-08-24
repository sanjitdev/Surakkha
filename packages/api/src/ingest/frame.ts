/**
 * Ingest handler — Story 2.2.
 *
 * Replaces the Step 0 placeholder with the 10-step driver from
 * `PROCESSING_ORDER` (architecture §3.2, ADR 0013). Real logic for
 * steps 1–6 + 10 (validate, auth check, rate check, seq/drop check,
 * persist, socket broadcast); typed no-op hook calls for steps 6–9
 * (rule evaluation, alert emission, state-machine update, audit
 * append) that Epic 3/4/5 fill in by calling `setIngestHooks`.
 *
 * The 10-step order is **load-bearing** — see ADR 0013. This module
 * iterates `PROCESSING_ORDER` in a single `for` loop; the order of
 * branches in the switch mirrors the literal in
 * `@surakkha/shared`. The `frame.spec.ts` test asserts
 * PROCESSING_ORDER.length === 10 and that any adjacent swap is
 * detectable.
 *
 * Reference:
 *   - docs/architecture.md §3.2
 *   - docs/adr/0013-server-processing-order.md
 *   - Story 2.2 spec (`_bmad-output/implementation-artifacts/2-2-…md`)
 */
import {
  classifyFlags,
  PROCESSING_ORDER,
  type ReadingFlag,
  type ReadingNewEvent,
  STALE_FRAME_THRESHOLD_MS,
  type TelemetryFrame,
  TelemetryFrameSchema,
  translateZodError,
} from "@surakkha/shared";

import { getIngestHooks, type IngestHooks } from "./hooks";
import { type PerDeviceRateLimiter } from "./rateLimit";
import { type PerDeviceSequence } from "./sequence";

/**
 * Minimal shape the persist + broadcast steps need from Prisma.
 * Tests inject a stub that satisfies this surface; production code
 * passes the real `@prisma/client` Reading delegate.
 */
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
  };
}

/**
 * Minimal Socket.IO surface — `io.to(room).emit(event, payload)`.
 * Production passes the real `Server.io`; tests pass a tiny
 * EventEmitter shim (frame.spec.ts pins the contract).
 */
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
}

/**
 * Per-frame decision returned to the WS handler so it can decide
 * whether to keep the connection open after a rate-limit. The
 * handler runs `processFrame` once per inbound frame; the return
 * value documents the seam without forcing the handler to read
 * every step's outcome.
 */
export type ProcessFrameOutcome =
  | { readonly status: "accepted" }
  | { readonly status: "bad_request" }
  | { readonly status: "rate_limited" }
  | { readonly status: "ignored" };

const deviceRoom = (deviceId: string): string => `device:${deviceId}`;

/**
 * Story 2.6 — broadcast room for the operator dashboard.
 *
 * The dashboard needs ONE subscription that fans out to ALL six
 * simulator devices (architecture §3.5: "Both events are emitted to
 * the Socket.IO room `device:<device_id>` for live updates, and to
 * the broadcast room `alerts:open` for new alerts / incidents").
 * Per-device rooms (`device:<uuid>`) require the dashboard to open
 * six sockets — Story 2.6 picked the broadcast-room path (lower
 * complexity, single socket, simple semantics).
 *
 * The room name is `readings:latest` (not `readings:all` as the spec
 * draft originally proposed) because the dashboard reads the LATEST
 * state via REST on cold load and then keeps it fresh via this
 * stream — the room is the "newest readings" channel.
 */
const READINGS_LATEST_ROOM = "readings:latest";

/**
 * Per-step result. Steps that mutate state return a `patch`; the
 * driver applies the patch in a single assignment so ESLint's
 * `no-param-reassign` rule does not fire inside step helpers.
 *
 * Terminal steps (bad_request, rate_limited, ignored) return an
 * `exit` outcome and stop the iteration.
 */
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

/**
 * Each per-step function runs ONE of the 10 PROCESSING_ORDER
 * branches. They are deliberately tiny so the iteration site in
 * `processFrame` reads top-to-bottom as a step list — not a flow-
 * chart — and the ESLint complexity ceiling stays within bounds.
 */
const stepValidate = (
  state: FrameState,
  deps: { readonly raw: unknown; readonly socket: ProcessFrameDeps["socket"]; readonly now: () => Date },
): StepResult => {
  const result = TelemetryFrameSchema.safeParse(deps.raw);
  if (!result.success) {
    deps.socket.emit("bad_request", translateZodError(result.error));
    return { kind: "exit", outcome: { status: "bad_request" } };
  }

  // Story 2.3 — stale-frame check. The frame is well-formed; reject
  // only if the device-side `ts` is older than the stale-frame window.
  // The connection is soft-disconnected (`disconnect(false)`) so a
  // backlog of fresh frames behind this one is still accepted. We do
  // NOT classify this as `ignored` from the caller's perspective —
  // there is no persist, no broadcast; the device gets the
  // `stale_frame` envelope + `age_seconds` and can decide whether to
  // reset its clock.
  const skewMs = state.serverReceivedAt.getTime() - result.data.ts;
  if (skewMs > STALE_FRAME_THRESHOLD_MS) {
    const ageSeconds = Math.floor(skewMs / 1_000);
    deps.socket.emit("stale_frame", { age_seconds: ageSeconds });
    deps.socket.disconnect(false);
    return { kind: "exit", outcome: { status: "ignored" } };
  }

  // Story 2.3 — clock-skew flag stamping. Future skew AND past skew
  // (within the stale window) both stamp `clock_skew_detected`. The
  // helper is the single source of truth shared with the simulator.
  const flags = classifyFlags(result.data, state.serverReceivedAt);

  // F-P6: `serverReceivedAt` was already seeded by `processFrame`
  // before this step ran (single source of truth — the moment the
  // driver took ownership of the inbound frame). `stepValidate`
  // only contributes the parsed payload + flag set, not a re-stamped
  // clock.
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
    // F-P7: surface late frames on the audit pipeline too. The
    // flag travels on the persisted row and on the broadcast payload
    // (see F-D2); the audit hook is the operator-triage surface.
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
    // F-P5: surface the underlying error to the api logger so an
    // operator can distinguish DB-down, FK-violation, and
    // unique-key-violation. The device still gets the
    // `persist_failed` envelope + disconnect.
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

const stepAlertEmission = async (
  deps: { readonly deviceId: string; readonly hooks: IngestHooks },
): Promise<StepResult> => {
  await deps.hooks.onAlertEmission({
    deviceId: deps.deviceId,
    ruleId: "",
    severity: "info",
  });
  return { kind: "next" };
};

const stepStateMachineUpdate = async (
  deps: { readonly deviceId: string; readonly hooks: IngestHooks },
): Promise<StepResult> => {
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
  // Story 2.6 — broadcast the same payload to `readings:latest` so a
  // single dashboard socket subscribes once and fans out to all six
  // devices (vs opening six per-device sockets). The per-device emit
  // above stays so any existing per-device watcher (e.g. an Operator
  // /incidents/:id drilldown) still receives the device-scoped stream.
  deps.io.to(READINGS_LATEST_ROOM).emit("reading:new", payload);
  return { kind: "next" };
};

/**
 * Single-entry-point for one inbound frame. Iterates
 * PROCESSING_ORDER; each step is delegated to a tiny pure function
 * so the iteration site reads as a step list. Reordering any
 * adjacent pair is a contract violation — `frame.spec.ts` asserts
 * the order against the literal in `PROCESSING_ORDER`.
 */
export const processFrame = async (
  deps: ProcessFrameDeps,
): Promise<ProcessFrameOutcome> => {
  const { deviceId, socket, raw, rateLimiter, sequence, prisma, io, now = () => new Date() } = deps;
  const hooks = deps.hooks ?? getIngestHooks();

  let state: FrameState = {
    parsed: null,
    flags: [],
    dropCount: 0,
    // F-P6: the server-anchored "moment the frame arrived at the
    // api" timestamp. `stepValidate` does NOT re-stamp this —
    // the driver's `now()` call is the canonical source so the
    // ordering guarantee ("serverReceivedAt is the source of truth
    // for ordering" — architecture §3.2) has exactly one read.
    serverReceivedAt: now(),
  };

  for (const step of PROCESSING_ORDER) {
    const result = await dispatchStep(step, state, { deviceId, socket, raw, rateLimiter, sequence, prisma, io, now, hooks });
    if (result.kind === "exit") return result.outcome;
    state = applyPatch(state, result.patch);
  }

  return { status: "accepted" };
};

/* eslint-disable complexity -- 10 cases is the literal
 * length of PROCESSING_ORDER; collapsing them (e.g. with a
 * Record<step, handler> map) would re-order adjacent pairs and
 * break the contract pin in `frame.spec.ts`.
 */
/**
 * Dispatch one step to its handler. Extracted from `processFrame`
 * so the driver's complexity stays under the lint ceiling (10) and
 * a future contributor adding an 11th step touches one function.
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
      return stepRateCheck(state, { deviceId: deps.deviceId, socket: deps.socket, rateLimiter: deps.rateLimiter, hooks: deps.hooks });
    case "seq/drop check":
      return stepSeqDropCheck(state, { deviceId: deps.deviceId, sequence: deps.sequence, hooks: deps.hooks });
    case "persist":
      return stepPersist(state, { deviceId: deps.deviceId, prisma: deps.prisma, socket: deps.socket });
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