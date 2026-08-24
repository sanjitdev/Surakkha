/**
 * Per-device Socket.IO client — Story 2.4.
 *
 * One `WsClient` per device. Opens a Socket.IO connection to
 * `${API_URL}/ingest/<device_id>` with `auth: { token }` (the api's
 * `buildIngestServer` reads the device_id from the URL path segment
 * and the token from `handshake.auth.token`; see
 * `packages/api/src/ingest/server.ts`). Emits frames at `tick_interval_ms`,
 * reacts to the api's envelopes, buffers up to `BUFFER_CAP` frames on
 * disconnect, and reconnects with exponential backoff `1s → 30s`.
 *
 * Wire contract is read from `@surakkha/shared` only — the simulator
 * never imports from `@surakkha/api`.
 */
import { type TelemetryFrame, TelemetryFrameSchema } from "@surakkha/shared/telemetry";
import { type Logger } from "pino";
import { io, type Socket } from "socket.io-client";

import { runScenario, SCENARIO_NAMES, type ScenarioName } from "./scenarios.js";

/** Frame buffer cap per device (architecture §6.1, I-2). */
export const BUFFER_CAP = 5_000;

/** Default tick interval, ms. Mirrored in `devices.json` and `.env.example`. */
export const DEFAULT_TICK_INTERVAL_MS = 2_000;
/** Minimum tick interval — anything faster hits the rate cap (architecture §3.2). */
export const MIN_TICK_INTERVAL_MS = 1_000;
/** Backoff schedule (architecture §6.1, I-2). */
export const BACKOFF_INITIAL_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

/** Frame "emit" envelope name (server reads via `socket.on("frame", …)`). */
export const FRAME_EVENT = "frame" as const;
/** Envelope names the api emits — see `packages/api/src/ingest/server.ts`
 *  + `packages/api/src/ingest/frame.ts`. */
export const ENVELOPE_RATE_LIMITED = "rate_limited" as const;
export const ENVELOPE_BAD_REQUEST = "bad_request" as const;
export const ENVELOPE_STALE_FRAME = "stale_frame" as const;
export const ENVELOPE_UNAUTHENTICATED = "unauthenticated" as const;
export const ENVELOPE_AUTH_ERROR = "auth_error" as const;
export const ENVELOPE_PERSIST_FAILED = "persist_failed" as const;
export const ENVELOPE_INTERNAL_ERROR = "internal_error" as const;

export interface RateLimitedEnvelope {
  readonly retry_after_seconds: number;
}
export interface BadRequestEnvelope {
  readonly error: "bad_request";
  readonly missing_fields: readonly string[];
}
export interface StaleFrameEnvelope {
  readonly error: "stale_frame";
  readonly age_seconds: number;
}
export interface AuthErrorEnvelope {
  readonly error: "device_id_mismatch" | "forbidden_scope";
}
export interface PersistFailedEnvelope {
  readonly error: "persist_failed";
}

export interface WsClientOptions {
  readonly deviceId: string;
  readonly scenario: ScenarioName;
  readonly apiUrl: string;
  readonly token: string;
  readonly tickIntervalMs: number;
  readonly logger: Logger;
  /** Injected for tests; production uses `io(...)`. */
  readonly connect?: (
    url: string,
    opts: {
      readonly auth: { readonly token: string };
      readonly transports: readonly ["websocket"];
      readonly path: string;
      readonly reconnection: false;
    },
  ) => Socket;
  /** Injected for tests; production uses `setTimeout`. */
  readonly setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  readonly clearTimer?: (handle: NodeJS.Timeout) => void;
  /** Override `Date.now()` for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Lightweight Socket surface the WsClient actually uses. We don't
 * import the full `Socket` type so tests can stub with a plain object
 * without depending on `socket.io-client`'s giant generic.
 */
export interface MinimalSocket {
  readonly id: string;
  readonly connected: boolean;
  readonly disconnected: boolean;
  readonly auth: Record<string, unknown>;
  readonly io: {
    readonly opts: { readonly transports?: readonly string[] };
  };
  on(event: string, listener: (arg: unknown) => void): void;
  on(event: "connect", listener: () => void): void;
  on(event: "disconnect", listener: (reason: string) => void): void;
  on(event: "connect_error", listener: (err: Error) => void): void;
  emit(event: string, payload?: unknown): void;
  disconnect(close?: boolean): void;
}

/**
 * Per-device simulator state. Public surface is `start()` + `stop()`
 * + `setScenario()`; tests construct one directly and exercise the
 * internals via the private helpers exposed through `__test__`.
 */
export class WsClient {
  private readonly opts: WsClientOptions;
  private readonly logger: Logger;
  private socket: MinimalSocket | null = null;
  private buffer: TelemetryFrame[] = [];
  private seq = 0;
  private tickHandle: NodeJS.Timeout | null = null;
  private pausedUntilMs = 0;
  private reconnectAttempts = 0;
  private reconnectHandle: NodeJS.Timeout | null = null;
  private overflowLoggedThisRun = false;
  private stopped = false;
  /**
   * Story 2.5 — current scenario. Initialised from `opts.scenario`
   * at construction and mutated by the admin control server via
   * `setScenario()`. Decoupled from `opts` so the public
   * `WsClientOptions` shape stays immutable (constructor parameters
   * can never be re-bound by a runtime call).
   */
  private currentScenario: ScenarioName;
  /**
   * Story 2.5 — pause flag toggled by the control server's
   * `start` / `pause` verb. When `true` the tick loop skips frame
   * generation but keeps the WS socket alive so the device stays
   * "connected" from the api's perspective.
   */
  private paused = false;

  constructor(options: WsClientOptions) {
    this.opts = options;
    this.currentScenario = options.scenario;
    this.logger = options.logger.child({ deviceId: options.deviceId });
  }

  /** Open the connection + start the per-tick timer. */
  public start = (): void => {
    if (this.stopped) {
      return;
    }
    this.logger.info(
      { scenario: this.currentScenario, tickIntervalMs: this.opts.tickIntervalMs },
      "simulator: scenario started",
    );
    this.openSocket();
    this.scheduleNextTick(0);
  };

  /**
    Graceful shutdown: clear timers, disconnect socket, leave the
    buffer intact (caller drains if needed). Idempotent.
   */
  public stop = (): void => {
    this.stopped = true;
    this.clearTick();
    this.clearReconnect();
    if (this.socket !== null) {
      try {
        this.socket.disconnect(true);
      } catch (err) {
        this.logger.warn({ err }, "simulator: socket disconnect threw");
      }
      this.socket = null;
    }
  };

  /**
    Test seam: read the in-memory frame buffer. Used by
    `wsClient.spec.ts` to assert "offending frame was dropped".
   */
  public __test__bufferLength = (): number => this.buffer.length;

  /** Test seam: read the monotonically-increasing seq counter. */
  public __test__seq = (): number => this.seq;

  /** Test seam: read the backoff state for assertions. */
  public __test__reconnectAttempts = (): number => this.reconnectAttempts;

  /** Test seam: read the active scenario name. */
  public __test__scenario = (): ScenarioName => this.currentScenario;

  /** Test seam: read the pause flag. */
  public __test__paused = (): boolean => this.paused;

  /**
   * Read the device_id. Used by `index.ts:boot()` to register the
   * client into the control server's lookup map — production code,
   * not a test seam. The device_id is immutable after construction
   * so this is a one-way getter.
   */
  public deviceId = (): string => this.opts.deviceId;

  /**
   * Story 2.5 — runtime scenario swap. Called by the control server
   * when an Admin clicks "Switch to <Scenario>" in the admin tab.
   * Mutates `currentScenario` so the next `tickOnce()` picks up the
   * new curve; no constructor re-run, no reconnect.
   *
   * We do NOT reset `this.seq` — the simulator's per-device `seq` is
   * monotonic across scenario changes (architecture §3.2 wire contract
   * field rule). If the admin wanted a fresh seq they would restart
   * the simulator process.
   */
  public setScenario = (name: ScenarioName): void => {
    // Defense-in-depth: the api validates `scenario ∈ SCENARIO_NAMES`
    // before forwarding; this guard catches any internal caller that
    // bypasses the api's check (e.g. a future direct-control seam).
    // Throwing here makes the violation loud at the call site instead
    // of a cryptic `runScenario` exhaustive-check throw inside `tickOnce`.
    if (!(SCENARIO_NAMES as readonly string[]).includes(name)) {
      throw new Error(`simulator: setScenario rejects unknown name ${name}`);
    }
    this.currentScenario = name;
    this.logger.info({ scenario: name }, "simulator: scenario swapped");
  };

  /**
   * Story 2.5 — pause the tick loop without closing the WS socket.
   * When `true`, `tickOnce()` re-schedules without generating a frame
   * so the device appears "online but idle" to the api. The api
   * does not see a disconnect envelope; the absence of new frames
   * is the signal.
   */
  public setPaused = (paused: boolean): void => {
    if (this.paused === paused) return;
    this.paused = paused;
    this.logger.info({ paused }, "simulator: pause toggled");
  };

  /**
    Test seam: inject a pre-built socket. Production never calls this
    — `start()` opens its own. Tests substitute a stub that captures
    `emit("frame", …)` so the assertions do not need a real network.
   */
  public __test__setSocket = (socket: MinimalSocket): void => {
    this.socket = socket;
    this.attachListeners(socket);
  };

  /**
    Test seam: trigger the next tick synchronously. Production uses
    `setTimeout`; tests call this directly so the loop is deterministic.
   */
  public __test__runTick = (): void => {
    this.tickOnce();
  };

  /** Test seam: deliver a fake envelope to the per-socket listener. */
  public __test__deliverEnvelope = (
    event: string,
    payload: unknown,
  ): void => {
    if (this.socket !== null) {
      this.handleEnvelope(event, payload);
    }
  };

  /** Test seam: simulate a TCP-level disconnect (no envelope). */
  public __test__deliverDisconnect = (): void => {
    this.onSocketDisconnect();
  };

  /** Test seam: simulate a successful connect. */
  public __test__deliverConnect = (): void => {
    this.onSocketConnect();
  };

  // ---------------------------------------------------------------------------
  // Private: socket lifecycle
  // ---------------------------------------------------------------------------

  private openSocket = (): void => {
    const url = `${this.opts.apiUrl.replace(/\/$/, "")}/ingest/${this.opts.deviceId}`;
    const connect = this.opts.connect ?? defaultConnect;
    const fresh = connect(url, {
      auth: { token: this.opts.token },
      transports: ["websocket"],
      path: "/ingest/",
      reconnection: false,
    });
    this.socket = fresh as unknown as MinimalSocket;
    this.attachListeners(this.socket);
  };

  private attachListeners = (socket: MinimalSocket): void => {
    socket.on("connect", () => this.onSocketConnect());
    socket.on("disconnect", () => this.onSocketDisconnect());
    socket.on("connect_error", (err: Error) => this.onSocketConnectError(err));
    socket.on(ENVELOPE_RATE_LIMITED, (raw) =>
      this.handleEnvelope(ENVELOPE_RATE_LIMITED, raw),
    );
    socket.on(ENVELOPE_BAD_REQUEST, (raw) =>
      this.handleEnvelope(ENVELOPE_BAD_REQUEST, raw),
    );
    socket.on(ENVELOPE_STALE_FRAME, (raw) =>
      this.handleEnvelope(ENVELOPE_STALE_FRAME, raw),
    );
    socket.on(ENVELOPE_UNAUTHENTICATED, () =>
      this.handleEnvelope(ENVELOPE_UNAUTHENTICATED, undefined),
    );
    socket.on(ENVELOPE_AUTH_ERROR, (raw) =>
      this.handleEnvelope(ENVELOPE_AUTH_ERROR, raw),
    );
    socket.on(ENVELOPE_PERSIST_FAILED, (raw) =>
      this.handleEnvelope(ENVELOPE_PERSIST_FAILED, raw),
    );
    socket.on(ENVELOPE_INTERNAL_ERROR, () =>
      this.handleEnvelope(ENVELOPE_INTERNAL_ERROR, undefined),
    );
  };

  private onSocketConnect = (): void => {
    this.reconnectAttempts = 0;
    this.logger.info("simulator: connected");
    this.flushBuffer();
  };

  private onSocketDisconnect = (): void => {
    if (this.stopped) {
      return;
    }
    this.logger.warn("simulator: disconnected");
    this.scheduleReconnect();
  };

  private onSocketConnectError = (err: Error): void => {
    if (this.stopped) {
      return;
    }
    this.logger.warn({ err: err.message }, "simulator: connect_error");
    this.scheduleReconnect();
  };

  private scheduleReconnect = (): void => {
    if (this.stopped) {
      return;
    }
    // Clear any existing pending reconnect so the latest disconnect
    // event bumps the backoff. Without this, a fast stream of disconnects
    // would leave the first timer pending indefinitely.
    if (this.reconnectHandle !== null) {
      (this.opts.clearTimer ?? defaultClearTimer)(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    const delayMs = Math.min(
      BACKOFF_INITIAL_MS * 2 ** this.reconnectAttempts,
      BACKOFF_MAX_MS,
    );
    this.reconnectAttempts += 1;
    this.logger.info(
      { attempt: this.reconnectAttempts, delayMs },
      "simulator: reconnect scheduled",
    );
    this.reconnectHandle = (this.opts.setTimer ?? defaultSetTimer)(() => {
      this.reconnectHandle = null;
      if (this.stopped) {
        return;
      }
      this.openSocket();
    }, delayMs);
  };

  private clearReconnect = (): void => {
    if (this.reconnectHandle !== null) {
      (this.opts.clearTimer ?? defaultClearTimer)(this.reconnectHandle);
      this.reconnectHandle = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Private: tick loop
  // ---------------------------------------------------------------------------

  private scheduleNextTick = (delayMs: number): void => {
    if (this.stopped) {
      return;
    }
    this.clearTick();
    this.tickHandle = (this.opts.setTimer ?? defaultSetTimer)(() => {
      this.tickHandle = null;
      this.tickOnce();
    }, delayMs);
  };

  private clearTick = (): void => {
    if (this.tickHandle !== null) {
      (this.opts.clearTimer ?? defaultClearTimer)(this.tickHandle);
      this.tickHandle = null;
    }
  };

  private tickOnce = (): void => {
    if (this.stopped) {
      return;
    }
    const nowMs = (this.opts.now ?? defaultNow)();
    if (nowMs < this.pausedUntilMs) {
      // `rate_limited` pause window — re-schedule to wake at `pausedUntilMs`.
      this.scheduleNextTick(this.pausedUntilMs - nowMs);
      return;
    }

    // Story 2.5 — admin-triggered pause. We KEEP the WS socket open
    // (no `disconnect` envelope) and just skip frame generation until
    // the admin resumes. This is distinct from the rate-limit pause
    // above, which has a wake-up timestamp and re-enables automatically.
    if (this.paused) {
      this.scheduleNextTick(this.opts.tickIntervalMs);
      return;
    }

    const tick = runScenario(this.currentScenario, {}, this.seq);
    if (tick.kind === "offline") {
      // Offline scenario emits nothing — back off but stay connected.
      this.scheduleNextTick(this.opts.tickIntervalMs);
      return;
    }

    this.seq += 1;
    const ts = (this.opts.now ?? defaultNow)();
    const candidate = {
      version: 1,
      device_id: this.opts.deviceId,
      ts,
      fw: "simulator-2.4.0",
      seq: this.seq,
      metrics: tick.metrics,
    } as const;
    const parsed = TelemetryFrameSchema.safeParse(candidate);
    if (!parsed.success) {
      // NaN from RandomFailure, or out-of-range from a future scenario.
      // Drop locally; never re-send (server would reject again).
      this.logger.error(
        {
          seq: this.seq,
          issues: parsed.error.issues.map((i) => i.path.join(".")),
        },
        "simulator: frame rejected locally before send",
      );
      this.scheduleNextTick(this.opts.tickIntervalMs);
      return;
    }

    this.dispatch(parsed.data);
    this.scheduleNextTick(this.opts.tickIntervalMs);
  };

  /**
    Send a parsed frame either over the live socket (if connected)
    or into the in-memory buffer (if disconnected, cap-bound).
   */
  private dispatch = (frame: TelemetryFrame): void => {
    if (this.socket !== null && this.socket.connected) {
      this.socket.emit(FRAME_EVENT, frame);
      return;
    }
    this.bufferFrame(frame);
  };

  private bufferFrame = (frame: TelemetryFrame): void => {
    if (this.buffer.length >= BUFFER_CAP) {
      // Drop oldest. Use slice(1) — immutable, satisfies the ESLint rule
      // against in-place mutation.
      this.buffer = this.buffer.slice(1);
      if (!this.overflowLoggedThisRun) {
        this.logger.warn(
          { cap: BUFFER_CAP },
          "simulator: buffer overflow",
        );
        this.overflowLoggedThisRun = true;
      }
    }
    this.buffer = [...this.buffer, frame];
  };

  /**
    Flush buffer on reconnect. Frames are produced monotonically per
    device so `buffer[0]` is always the lowest `seq` — iterate in
    order. The server rate-cap (1 reading / 2s) means we honour it by
    leaving the buffer flush at the per-tick cadence: the per-device
    timer is still ticking; flushing one frame per tick is the same
    rate as live emission.

    The buffer is cleared after a successful flush. The wire contract
    has no explicit ACK envelope; absence of a negative envelope
    (`bad_request` / `stale_frame` / `persist_failed`) is the canonical
    "frame was accepted" signal. Clearing on flush prevents unbounded
    growth across reconnect cycles — without this, frames buffered in
    one disconnect cycle would re-emit on the next cycle and the server
    would reject them as `out_of_order`. If a frame is rejected by the
    server after flush, it arrives as an envelope against an empty
    buffer; the drop is a no-op (the frame is gone).
   */
  private flushBuffer = (): void => {
    if (this.buffer.length === 0) {
      return;
    }
    if (this.socket === null || !this.socket.connected) {
      return;
    }
    const drained = this.buffer;
    this.overflowLoggedThisRun = false;
    this.buffer = [];
    for (const frame of drained) {
      this.socket.emit(FRAME_EVENT, frame);
    }
    this.logger.info({ flushed: drained.length }, "simulator: buffer flushed");
  };

  // ---------------------------------------------------------------------------
  // Private: envelope handlers
  // ---------------------------------------------------------------------------

  private handleEnvelope = (event: string, raw: unknown): void => {
    switch (event) {
      case ENVELOPE_RATE_LIMITED:
        this.handleRateLimited(raw);
        return;
      case ENVELOPE_BAD_REQUEST:
        this.handleBadRequest(raw);
        return;
      case ENVELOPE_STALE_FRAME:
        this.handleStaleFrame(raw);
        return;
      case ENVELOPE_UNAUTHENTICATED:
        this.handleUnauthenticated();
        return;
      case ENVELOPE_AUTH_ERROR:
        this.handleAuthError(raw);
        return;
      case ENVELOPE_PERSIST_FAILED:
        this.handlePersistFailed();
        return;
      case ENVELOPE_INTERNAL_ERROR:
        this.handleInternalError();
        return;
      default:
        this.logger.debug({ event }, "simulator: unknown envelope (ignored)");
    }
  };

  private dropOldestFrame = (): void => {
    if (this.buffer.length > 0) {
      this.buffer = this.buffer.slice(1);
    }
  };

  private tearDownAndReconnect = (): void => {
    if (this.socket !== null) {
      this.socket.disconnect(true);
    }
    this.scheduleReconnect();
  };

  private handleRateLimited = (raw: unknown): void => {
    const payload = raw as RateLimitedEnvelope | undefined;
    const retrySeconds = typeof payload?.retry_after_seconds === "number"
      ? payload.retry_after_seconds
      : 2;
    const nowMs = (this.opts.now ?? defaultNow)();
    this.pausedUntilMs = nowMs + retrySeconds * 1_000;
    this.logger.warn(
      { retry_after_seconds: retrySeconds },
      "simulator: rate_limited — pausing emissions",
    );
  };

  private handleBadRequest = (raw: unknown): void => {
    const payload = raw as BadRequestEnvelope | undefined;
    this.logger.error(
      { missing_fields: payload?.missing_fields ?? [] },
      "simulator: bad_request — dropping offending frame",
    );
    this.dropOldestFrame();
  };

  private handleStaleFrame = (raw: unknown): void => {
    const payload = raw as StaleFrameEnvelope | undefined;
    this.logger.warn(
      { age_seconds: payload?.age_seconds ?? 0 },
      "simulator: stale_frame — dropping offending frame",
    );
    this.dropOldestFrame();
  };

  private handleUnauthenticated = (): void => {
    this.logger.error("simulator: unauthenticated — tearing down");
    this.tearDownAndReconnect();
  };

  private handleAuthError = (raw: unknown): void => {
    const payload = raw as AuthErrorEnvelope | undefined;
    this.logger.error(
      { error: payload?.error ?? "unknown" },
      "simulator: auth_error — tearing down + reconnecting",
    );
    this.tearDownAndReconnect();
  };

  private handlePersistFailed = (): void => {
    this.logger.error(
      "simulator: persist_failed — tearing down + reconnecting",
    );
    this.dropOldestFrame();
    this.tearDownAndReconnect();
  };

  private handleInternalError = (): void => {
    this.logger.error(
      "simulator: internal_error envelope from api — tearing down",
    );
    this.tearDownAndReconnect();
  };
}

const defaultConnect = (
  url: string,
  opts: {
    readonly auth: { readonly token: string };
    readonly transports: readonly ["websocket"];
    readonly path: string;
    readonly reconnection: false;
  },
): MinimalSocket => {
  const socket: Socket = io(url, {
    auth: opts.auth as Record<string, unknown>,
    transports: ["websocket"],
    path: opts.path,
    reconnection: false,
  });
  return socket as unknown as MinimalSocket;
};

const defaultSetTimer = (fn: () => void, ms: number): NodeJS.Timeout =>
  setTimeout(fn, ms);

const defaultClearTimer = (handle: NodeJS.Timeout): void => {
  clearTimeout(handle);
};

const defaultNow = (): number => Date.now();