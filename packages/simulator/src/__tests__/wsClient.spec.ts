/**
 * Story 2.4 — `WsClient` envelope / buffer / reconnect tests.
 *
 * We stub the `socket.io-client` Socket surface with a plain object
 * that mimics the `MinimalSocket` shape used by `WsClient`. The
 * `connect` factory in `WsClientOptions` is overridden so `start()`
 * never opens a real socket; we inject a pre-built stub via the
 * `__test__setSocket` seam instead and register listeners directly.
 *
 * Covers (loopback-1 acceptance):
 *   - rate_limited pause
 *   - bad_request drop — the offending frame is REMOVED from the
 *     buffer, not just `currentSeq >= 0`
 *   - stale_frame drop — same tightened assertion
 *   - disconnect-without-envelope → reconnect path
 *   - buffer overflow → drop oldest, single log line
 *   - auth_error → reconnect-scheduled
 *   - persist_failed → reconnect-scheduled + buffer advance
 *   - unauthenticated → reconnect-scheduled
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pino, { type Logger } from "pino";

import { type TelemetryFrame } from "@surakkha/shared/telemetry";

import {
  BACKOFF_INITIAL_MS,
  BACKOFF_MAX_MS,
  BUFFER_CAP,
  ENVELOPE_AUTH_ERROR,
  ENVELOPE_BAD_REQUEST,
  ENVELOPE_INTERNAL_ERROR,
  ENVELOPE_PERSIST_FAILED,
  ENVELOPE_RATE_LIMITED,
  ENVELOPE_STALE_FRAME,
  ENVELOPE_UNAUTHENTICATED,
  FRAME_EVENT,
  MIN_TICK_INTERVAL_MS,
  WsClient,
  type MinimalSocket,
  type WsClientOptions,
} from "../wsClient.js";

const DEVICE_ID = "9b1c4f00-0000-4000-8000-000000000001";

const silentLogger = (): Logger =>
  pino({ level: "silent" });

interface StubSocket extends MinimalSocket {
  readonly emit: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly on: ReturnType<typeof vi.fn>;
  // listener registry for envelopes so tests can fire them.
  readonly _listeners: Map<string, Array<(arg: unknown) => void>>;
}

const buildStubSocket = (overrides: Partial<StubSocket> = {}): StubSocket => {
  const listeners = new Map<string, Array<(arg: unknown) => void>>();
  const on = vi.fn((event: string, listener: (arg: unknown) => void) => {
    const arr = listeners.get(event) ?? [];
    arr.push(listener);
    listeners.set(event, arr);
  });
  const emit = vi.fn();
  const disconnect = vi.fn();
  const base: StubSocket = {
    id: "stub-socket",
    connected: true,
    disconnected: false,
    auth: { token: "stub" },
    io: { opts: { transports: ["websocket"] } },
    on,
    emit,
    disconnect,
    _listeners: listeners,
    ...overrides,
  };
  return base;
};

const fireEnvelope = (socket: StubSocket, event: string, payload?: unknown): void => {
  const arr = socket._listeners.get(event) ?? [];
  for (const fn of arr) {
    fn(payload);
  }
};

const buildClient = (overrides: Partial<WsClientOptions> = {}): WsClient => {
  const setTimer = vi.fn(
    ((fn: () => void, ms: number) =>
      setTimeout(fn, ms)) as unknown as (fn: () => void, ms: number) => NodeJS.Timeout,
  );
  const clearTimer = vi.fn(((handle: NodeJS.Timeout) => {
    clearTimeout(handle);
  }) as unknown as (handle: NodeJS.Timeout) => void);
  const opts: WsClientOptions = {
    deviceId: DEVICE_ID,
    scenario: "Normal",
    apiUrl: "http://localhost:4000",
    token: "stub.jwt.token",
    tickIntervalMs: MIN_TICK_INTERVAL_MS,
    logger: silentLogger(),
    setTimer,
    clearTimer,
    ...overrides,
  };
  return new WsClient(opts);
};

describe("WsClient — bad_request drops the offending frame", () => {
  it("removes the most recently emitted frame from the buffer (no retry)", () => {
    // The envelope arrives for a frame the server rejected. In
    // production this happens for a buffered frame BEFORE the next
    // flush (the server processed an earlier flush and replied
    // asynchronously). Simulate that: buffer grows, then the envelope
    // arrives while the buffer still holds the offending entry.
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    // Send two frames successfully (socket is connected → no buffering).
    client.__test__runTick();
    client.__test__runTick();
    // Disconnect: next two frames buffer.
    socket.connected = false;
    client.__test__runTick();
    client.__test__runTick();
    expect(client.__test__bufferLength()).toBe(2);
    expect(client.__test__seq()).toBe(4);

    // Server replies bad_request for one of the buffered frames —
    // the buffer drops that one entry.
    fireEnvelope(socket, ENVELOPE_BAD_REQUEST, {
      error: "bad_request",
      missing_fields: ["metrics.ph"],
    });
    expect(client.__test__bufferLength()).toBe(1);
  });

  it("does NOT retry a frame that the server rejected with bad_request", () => {
    // After the envelope, the dropped frame is gone. Reconnect +
    // flush must NOT re-emit it.
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    client.__test__runTick();
    socket.connected = false;
    client.__test__runTick();
    client.__test__runTick();
    expect(client.__test__bufferLength()).toBe(2);

    fireEnvelope(socket, ENVELOPE_BAD_REQUEST, {
      error: "bad_request",
      missing_fields: ["metrics.ph"],
    });
    expect(client.__test__bufferLength()).toBe(1);

    // Reconnect → flush.
    socket.connected = true;
    const emitCallsBefore = socket.emit.mock.calls.length;
    client.__test__deliverConnect();
    const emitCallsAfter = socket.emit.mock.calls.length;
    // Only ONE frame flushed (the one not dropped). The dropped frame
    // must NOT be re-sent.
    expect(emitCallsAfter - emitCallsBefore).toBe(1);
  });
});

describe("WsClient — stale_frame drops the offending frame", () => {
  it("removes the offending frame from the buffer (no retry)", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    client.__test__runTick();
    client.__test__runTick();
    socket.connected = false;
    client.__test__runTick();
    client.__test__runTick();
    client.__test__runTick();
    expect(client.__test__bufferLength()).toBe(3);

    fireEnvelope(socket, ENVELOPE_STALE_FRAME, { age_seconds: 360 });
    expect(client.__test__bufferLength()).toBe(2);
  });

  it("does NOT trigger a manual reconnect on stale_frame (server already soft-disconnected)", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    const beforeAttempts = client.__test__reconnectAttempts();
    fireEnvelope(socket, ENVELOPE_STALE_FRAME, { age_seconds: 360 });
    expect(client.__test__reconnectAttempts()).toBe(beforeAttempts);
  });
});

describe("WsClient — rate_limited pauses emissions", () => {
  it("sets pausedUntilMs and skips ticks within the pause window", () => {
    let now = 1_000_000_000_000;
    const client = buildClient({ now: () => now });
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    client.__test__runTick();
    const before = socket.emit.mock.calls.length;

    fireEnvelope(socket, ENVELOPE_RATE_LIMITED, { retry_after_seconds: 2 });

    // Within the pause window: emit should not be called again.
    now += 1_000;
    client.__test__runTick();
    now += 500;
    client.__test__runTick();
    expect(socket.emit.mock.calls.length).toBe(before);

    // After the pause window: emissions resume.
    now += 1_000; // total +2.5s past the original tick
    client.__test__runTick();
    expect(socket.emit.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("WsClient — disconnect without envelope schedules reconnect", () => {
  it("schedules a reconnect with backoff starting at 1s", () => {
    const setTimer = vi.fn(
      ((fn: () => void, ms: number) =>
        setTimeout(fn, ms)) as unknown as (fn: () => void, ms: number) => NodeJS.Timeout,
    );
    const clearTimer = vi.fn(((handle: NodeJS.Timeout) => {
      clearTimeout(handle);
    }) as unknown as (handle: NodeJS.Timeout) => void);
    const client = buildClient({ setTimer, clearTimer });
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    client.__test__deliverDisconnect();
    expect(client.__test__reconnectAttempts()).toBe(1);

    // The reconnect timer was scheduled. Capture the delay and assert
    // it matches the initial backoff.
    const lastCall = setTimer.mock.calls[setTimer.mock.calls.length - 1];
    expect(lastCall?.[1]).toBe(BACKOFF_INITIAL_MS);
  });

  it("doubles the backoff on each failed attempt, capped at 30s", () => {
    const setTimer = vi.fn(
      ((fn: () => void, ms: number) =>
        setTimeout(fn, ms)) as unknown as (fn: () => void, ms: number) => NodeJS.Timeout,
    );
    const clearTimer = vi.fn(((handle: NodeJS.Timeout) => {
      clearTimeout(handle);
    }) as unknown as (handle: NodeJS.Timeout) => void);
    const client = buildClient({ setTimer, clearTimer });
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    const delays: number[] = [];
    setTimer.mockImplementation(((fn: () => void, ms: number) => {
      delays.push(ms);
      return setTimeout(fn, ms);
    }) as unknown as (fn: () => void, ms: number) => NodeJS.Timeout);

    client.__test__deliverDisconnect(); // attempt 1
    client.__test__deliverDisconnect(); // attempt 2 (same socket, attempts kept)
    client.__test__deliverDisconnect(); // attempt 3
    client.__test__deliverDisconnect(); // attempt 4
    client.__test__deliverDisconnect(); // attempt 5
    // After 5 attempts the cap should kick in.
    const firstFive = delays.slice(0, 5);
    expect(firstFive[0]).toBe(BACKOFF_INITIAL_MS);
    // Doubling schedule: 1000, 2000, 4000, 8000, 16000.
    expect(firstFive[1]).toBe(BACKOFF_INITIAL_MS * 2);
    expect(firstFive[2]).toBe(BACKOFF_INITIAL_MS * 4);
    expect(firstFive[3]).toBe(BACKOFF_INITIAL_MS * 8);
    expect(firstFive[4]).toBe(BACKOFF_INITIAL_MS * 16);
    // Cap: attempt 6 → still 30000ms.
    client.__test__deliverDisconnect();
    expect(delays[5]).toBe(BACKOFF_MAX_MS);
  });

  it("resets reconnectAttempts to 0 on successful connect", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    client.__test__deliverDisconnect();
    expect(client.__test__reconnectAttempts()).toBeGreaterThan(0);

    client.__test__deliverConnect();
    expect(client.__test__reconnectAttempts()).toBe(0);
  });
});

describe("WsClient — buffer overflow drops oldest", () => {
  it("drops oldest when buffer reaches BUFFER_CAP and logs once", () => {
    // Capture log calls by overriding `logger.warn` directly on the
    // created instance — `pino`'s internal `this` binding means
    // `Object.assign(logger, { warn: vi.fn() })` does not work because
    // the captured function would no longer be reachable from the
    // internal log path. Instead we build a thin wrapper.
    const warns: unknown[][] = [];
    const baseLogger = silentLogger();
    const logger = {
      ...baseLogger,
      child: () => logger,
      warn: (...args: unknown[]) => {
        warns.push(args);
      },
    } as unknown as Logger;
    const client = buildClient({ logger });
    const socket = buildStubSocket({ connected: false });
    client.__test__setSocket(socket);

    // Fill the buffer. The WsClient emits one frame per `__test__runTick`,
    // so calling it BUFFER_CAP + 5 times yields 5 dropped entries.
    for (let i = 0; i < BUFFER_CAP + 5; i += 1) {
      client.__test__runTick();
    }
    // Buffer holds at most BUFFER_CAP frames (oldest dropped).
    expect(client.__test__bufferLength()).toBe(BUFFER_CAP);
    // The first frame in the buffer should be seq 6 (frames 1..5 dropped).
    const remaining = (client as unknown as { buffer: TelemetryFrame[] }).buffer;
    expect(remaining[0]?.seq).toBe(6);
    // A single "simulator: buffer overflow" log line was emitted.
    const overflowCalls = warns.filter(
      (call) => call.includes("simulator: buffer overflow"),
    );
    expect(overflowCalls).toHaveLength(1);
  });
});

describe("WsClient — auth_error triggers reconnect", () => {
  it("schedules a reconnect attempt on auth_error envelope", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    const before = client.__test__reconnectAttempts();
    fireEnvelope(socket, ENVELOPE_AUTH_ERROR, { error: "device_id_mismatch" });
    expect(client.__test__reconnectAttempts()).toBe(before + 1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it("treats forbidden_scope the same way", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    const before = client.__test__reconnectAttempts();
    fireEnvelope(socket, ENVELOPE_AUTH_ERROR, { error: "forbidden_scope" });
    expect(client.__test__reconnectAttempts()).toBe(before + 1);
  });
});

describe("WsClient — persist_failed drops offending frame + reconnects", () => {
  it("advances the buffer and schedules a reconnect attempt", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: false });
    client.__test__setSocket(socket);

    // Buffer two frames while disconnected (server cannot reply).
    client.__test__runTick();
    client.__test__runTick();
    expect(client.__test__bufferLength()).toBe(2);

    // persist_failed arrives while the socket is still disconnected —
    // the buffer is non-empty, so the offending frame (seq=1) is
    // dropped and a reconnect is scheduled.
    const before = client.__test__reconnectAttempts();
    fireEnvelope(socket, ENVELOPE_PERSIST_FAILED, { error: "persist_failed" });

    // Buffer advanced (seq=1 dropped).
    expect(client.__test__bufferLength()).toBe(1);
    expect(client.__test__reconnectAttempts()).toBe(before + 1);
  });
});

describe("WsClient — unauthenticated triggers reconnect", () => {
  it("schedules a reconnect attempt on unauthenticated envelope", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    const before = client.__test__reconnectAttempts();
    fireEnvelope(socket, ENVELOPE_UNAUTHENTICATED);
    expect(client.__test__reconnectAttempts()).toBe(before + 1);
  });
});

describe("WsClient — internal_error triggers reconnect", () => {
  it("schedules a reconnect attempt on internal_error envelope", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    const before = client.__test__reconnectAttempts();
    fireEnvelope(socket, ENVELOPE_INTERNAL_ERROR);
    expect(client.__test__reconnectAttempts()).toBe(before + 1);
  });
});

describe("WsClient — frame emit payload shape", () => {
  it("emits frames with FRAME_EVENT and a parsed TelemetryFrame", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);

    client.__test__runTick();
    const frameEmits = socket.emit.mock.calls.filter(
      (call) => call[0] === FRAME_EVENT,
    );
    expect(frameEmits).toHaveLength(1);
    const frame = frameEmits[0]?.[1] as TelemetryFrame;
    expect(frame.version).toBe(1);
    expect(frame.device_id).toBe(DEVICE_ID);
    expect(frame.seq).toBe(1);
    expect(typeof frame.ts).toBe("number");
    expect(frame.fw).toBe("simulator-2.4.0");
    expect(typeof frame.metrics.ph).toBe("number");
  });
});

describe("WsClient — graceful shutdown", () => {
  it("stop() disconnects the socket and is idempotent", () => {
    const client = buildClient();
    const socket = buildStubSocket({ connected: true });
    client.__test__setSocket(socket);
    client.stop();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    // Second stop is a no-op (no throw).
    expect(() => client.stop()).not.toThrow();
  });
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});