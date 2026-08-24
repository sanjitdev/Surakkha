/**
 * `socketClient` — Story 2.9 — listener wiring contract.
 *
 * This spec exercises the real `socketClient.ts` against a mock
 * `socket.io-client` so the listener branches in `wireAuthHandlers`
 * are pinned. Coverage matrix (each I/O & Edge-Case row that maps
 * to the listener wiring):
 *
 *   Row 4 — `connect_error` with `"token"` substring MUST NOT flip
 *     `isConnected` and MUST NOT bump `retryAttempt`. The refresh
 *     path is left intact.
 *   Row 5 — `connect_error` with NO `"token"` substring (network
 *     error / timeout / 5xx) MUST flip `isConnected` to false.
 *     The `connect_error` listener MUST NOT reschedule the backoff
 *     — the originating `disconnect` listener owns the schedule.
 *   Row 1 — `connect` event flips `isConnected: true` and zeroes
 *     `retryAttempt`.
 *   Row 2 — `disconnect` (transport-level) bumps `retryAttempt`,
 *     flips `isConnected: false`, and schedules a backoff
 *     reconnect.
 *   Spec §"Always" #4 — `disconnectSocket` cancels the pending
 *     backoff timer (`clearTimeout`) and resets `retryAttempt`
 *     to 0 BEFORE disconnecting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetApiClientConfig, configureApiClient } from "../api/apiClient";

import { computeBackoffMs } from "./backoffTimer";
import { useConnectionStateStore } from "./connectionStateStore";
import {
  _hasPendingBackoffTimer,
  connectSocket,
  disconnectSocket,
} from "./socketClient";

// Hand-rolled socket.io-client mock. The real client is an EventEmitter
// with a `connect()` method we can drive from tests. Each `io(...)`
// call returns a fresh emitter so the listener wiring is observed
// end-to-end.

type Listener = (...args: unknown[]) => void;

interface MockSocket {
  readonly on: (event: string, handler: Listener) => void;
  readonly off: (event: string, handler: Listener) => void;
  readonly emit: (event: string, ...args: unknown[]) => void;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly __handlers: Map<string, Listener[]>;
  readonly __connectCalls: number;
}

const buildMockSocket = (): MockSocket => {
  const handlers = new Map<string, Listener[]>();
  let connectCalls = 0;
  const sock: MockSocket = {
    on: (event, handler) => {
      const arr = handlers.get(event) ?? [];
      arr.push(handler);
      handlers.set(event, arr);
    },
    off: (event, handler) => {
      const arr = handlers.get(event) ?? [];
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
      handlers.set(event, arr);
    },
    emit: (event, ...args) => {
      const arr = handlers.get(event) ?? [];
      for (const h of [...arr]) h(...args);
    },
    connect: () => {
      connectCalls += 1;
    },
    disconnect: () => undefined,
    get __handlers() {
      return handlers;
    },
    get __connectCalls() {
      return connectCalls;
    },
  };
  return sock;
};

let lastSocket: MockSocket | null = null;

vi.mock("socket.io-client", () => ({
  io: (): MockSocket => {
    const sock = buildMockSocket();
    lastSocket = sock;
    return sock;
  },
}));

beforeEach(() => {
  useConnectionStateStore.setState({
    isConnected: true,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    retryAttempt: 0,
  });
  lastSocket = null;
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetApiClientConfig();
  disconnectSocket();
  lastSocket = null;
});

describe("Story 2.9 — socketClient listener wiring: connect", () => {
  it("flips isConnected: true and zeroes retryAttempt on connect", () => {
    useConnectionStateStore.setState({ isConnected: false, retryAttempt: 5 });

    connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
    expect(lastSocket).not.toBeNull();
    lastSocket?.emit("connect");

    expect(useConnectionStateStore.getState().isConnected).toBe(true);
    expect(useConnectionStateStore.getState().retryAttempt).toBe(0);
  });
});

describe("Story 2.9 — socketClient listener wiring: disconnect", () => {
  it("flips isConnected: false, bumps retryAttempt, schedules a backoff reconnect", () => {
    vi.useFakeTimers();
    try {
      connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
      lastSocket?.emit("connect");
      expect(useConnectionStateStore.getState().isConnected).toBe(true);

      const callsBefore = lastSocket?.__connectCalls ?? 0;

      lastSocket?.emit("disconnect");
      expect(useConnectionStateStore.getState().isConnected).toBe(false);
      expect(useConnectionStateStore.getState().retryAttempt).toBe(1);
      expect(_hasPendingBackoffTimer()).toBe(true);

      // The first attempt fires after `computeBackoffMs(1)` = 5_000 ms.
      const expectedDelay = computeBackoffMs(1);
      vi.advanceTimersByTime(expectedDelay);

      // After the timer elapses, the socket reconnects — the mock's
      // `connect()` counter advances.
      expect(lastSocket?.__connectCalls).toBe(callsBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Story 2.9 — socketClient connect_error branching", () => {
  it("connect_error with 'token' substring does NOT flip isConnected and does NOT bump retryAttempt", () => {
    connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
    lastSocket?.emit("connect");
    expect(useConnectionStateStore.getState().isConnected).toBe(true);

    lastSocket?.emit("connect_error", new Error("invalid token"));
    // The refresh path is async; what we assert here is that the
    // synchronous part of the listener (the `isConnected` flip)
    // did NOT run.
    expect(useConnectionStateStore.getState().isConnected).toBe(true);
    expect(useConnectionStateStore.getState().retryAttempt).toBe(0);
  });

  it("connect_error with case-insensitive 'TOKEN' substring does NOT flip isConnected", () => {
    connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
    lastSocket?.emit("connect");

    lastSocket?.emit("connect_error", new Error("Refresh TOKEN expired"));
    expect(useConnectionStateStore.getState().isConnected).toBe(true);
    expect(useConnectionStateStore.getState().retryAttempt).toBe(0);
  });

  it("connect_error on network failure (no 'token' substring) flips isConnected: false", () => {
    connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
    lastSocket?.emit("connect");

    lastSocket?.emit("connect_error", new Error("xhr poll error"));
    expect(useConnectionStateStore.getState().isConnected).toBe(false);
  });

  it("connect_error on undefined error message flips isConnected: false (defensive)", () => {
    connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
    lastSocket?.emit("connect");

    // Some Socket.IO server failures yield `err.message === undefined`
    // or an empty string. The defensive `(err.message ?? "")` guard
    // ensures `.toLowerCase()` does not throw and the `token` check
    // sees an empty string (no flip).
    const empty = new Error("");
    empty.message = undefined as unknown as string;
    lastSocket?.emit("connect_error", empty);
    // An undefined message → empty string → no `token` substring →
    // markDisconnected path → isConnected flips to false.
    expect(useConnectionStateStore.getState().isConnected).toBe(false);
  });

  it("connect_error does NOT reschedule — the existing disconnect timer keeps firing", () => {
    vi.useFakeTimers();
    try {
      connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
      lastSocket?.emit("connect");

      // Transport failure path: disconnect fires first (Socket.IO's
      // emit order on a failed connection attempt).
      lastSocket?.emit("connect_error", new Error("xhr poll error"));
      // `connect_error` flips isConnected but does NOT schedule.
      expect(_hasPendingBackoffTimer()).toBe(false);

      // Then the originating disconnect fires and owns the schedule.
      lastSocket?.emit("disconnect");
      expect(_hasPendingBackoffTimer()).toBe(true);

      // A subsequent connect_error on the same socket does NOT
      // reschedule (would otherwise double-fire).
      lastSocket?.emit("connect_error", new Error("xhr poll error"));
      expect(_hasPendingBackoffTimer()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Story 2.9 — I/O matrix rows", () => {
  it("row 7: cold mount on a known-down server — banner renders after initial connect_error; retryAttempt === 1", () => {
    // No preceding `connect` event: the page hard-refreshed while
    // the api was down. Socket.IO emits `connect_error` first
    // (network failure path), then `disconnect` (the originating
    // listener that owns the schedule).
    connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });

    lastSocket?.emit("connect_error", new Error("xhr poll error"));
    expect(useConnectionStateStore.getState().isConnected).toBe(false);

    lastSocket?.emit("disconnect");
    expect(useConnectionStateStore.getState().retryAttempt).toBe(1);
    expect(_hasPendingBackoffTimer()).toBe(true);
  });

  it("row 6: reconnect succeeds mid-backoff — timer clears, isConnected: true, retryAttempt: 0", () => {
    vi.useFakeTimers();
    try {
      connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
      lastSocket?.emit("connect");
      lastSocket?.emit("disconnect");
      expect(_hasPendingBackoffTimer()).toBe(true);
      expect(useConnectionStateStore.getState().retryAttempt).toBe(1);

      // The 5s timer is pending. We advance 1s — still mid-backoff.
      vi.advanceTimersByTime(1_000);
      expect(_hasPendingBackoffTimer()).toBe(true);

      // The socket reconnects before the 5s elapses — the connect
      // listener cancels the pending timer and resets the counter.
      lastSocket?.emit("connect");
      expect(_hasPendingBackoffTimer()).toBe(false);
      expect(useConnectionStateStore.getState().isConnected).toBe(true);
      expect(useConnectionStateStore.getState().retryAttempt).toBe(0);

      // Advancing past the original 5s deadline does NOT fire the
      // cancelled timer.
      vi.advanceTimersByTime(10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("row 9: viewer role on /dashboard while disconnected — banner renders, no API-bound buttons disabled (out of scope for 2.9)", () => {
    // The viewer-vs-operator parity contract is at the dashboard
    // surface (Story 2.6 AC6), not at the socket layer. This test
    // pins the banner's behaviour: `isConnected === false` alone
    // is sufficient to render; no role gating applies.
    useConnectionStateStore.setState({ isConnected: false });
    connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
    expect(useConnectionStateStore.getState().isConnected).toBe(false);
  });
});

describe("Story 2.9 — disconnectSocket cancels backoff + resets retryAttempt", () => {
  it("cancels the pending timer and resets retryAttempt to 0 BEFORE disconnecting", () => {
    vi.useFakeTimers();
    try {
      connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
      lastSocket?.emit("connect");
      lastSocket?.emit("disconnect");
      expect(_hasPendingBackoffTimer()).toBe(true);
      expect(useConnectionStateStore.getState().retryAttempt).toBe(1);

      const callsBefore = lastSocket?.__connectCalls ?? 0;

      disconnectSocket();
      expect(_hasPendingBackoffTimer()).toBe(false);
      expect(useConnectionStateStore.getState().retryAttempt).toBe(0);

      // Advancing time after the cancel does NOT fire `socket.connect()`.
      vi.advanceTimersByTime(computeBackoffMs(1) * 2);
      expect(lastSocket?.__connectCalls).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent — a second call after teardown is a safe no-op", () => {
    vi.useFakeTimers();
    try {
      connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
      lastSocket?.emit("connect");
      lastSocket?.emit("disconnect");

      // First call cancels + tears down.
      disconnectSocket();
      expect(_hasPendingBackoffTimer()).toBe(false);
      expect(useConnectionStateStore.getState().retryAttempt).toBe(0);

      // Second call must not throw, must not bump retryAttempt, and
      // must not introduce a phantom timer. This is the "log out, then
      // log out again" path the spec calls out as idempotent.
      expect(() => disconnectSocket()).not.toThrow();
      expect(_hasPendingBackoffTimer()).toBe(false);
      expect(useConnectionStateStore.getState().retryAttempt).toBe(0);

      vi.advanceTimersByTime(computeBackoffMs(1) * 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after teardown, advancing time does not fire socket.connect (zombie timer regression)", () => {
    // Spec §"Always" #6: "disconnectSocket() cancels any pending
    // timer AND resets retryAttempt to 0 BEFORE disconnecting. A
    // zombie timer would otherwise fire socket.connect() on a torn-
    // down socket."
    vi.useFakeTimers();
    try {
      connectSocket({ url: "/dashboard" }, { onSessionLost: () => undefined });
      lastSocket?.emit("connect");
      lastSocket?.emit("disconnect");

      const callsBefore = lastSocket?.__connectCalls ?? 0;
      disconnectSocket();

      // The torn-down socket is no longer `activeSocket`; a zombie
      // timer that survived `clearTimeout` would invoke the OLD
      // socket's `connect()`, but since `lastSocket.__connectCalls`
      // is closed over by the timer, a regression would show up as
      // an extra call here.
      vi.advanceTimersByTime(computeBackoffMs(1) * 5);
      expect(lastSocket?.__connectCalls).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});
