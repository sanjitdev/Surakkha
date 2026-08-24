/**
 * Socket client — Surakkha web (Story 1.7 + Story 2.9).
 *
 * Story 1.7 AC3:
 *   "Given an open Socket.IO connection receives a `401 token_expired`
 *    event, the socket reconnects with a freshly minted access token,
 *    and the UI does not unmount or flash a loading screen."
 *
 * Story 2.9 extensions:
 *   - `connect` listener pushes `markConnected()` + `resetRetry()` to
 *     the zustand connection-state store.
 *   - `disconnect` listener (transport-level only) bumps `retryAttempt`
 *     then schedules a backoff-reconnect via `scheduleBackoffReconnect`.
 *   - `connect_error` listener splits into two paths:
 *     - `(err.message ?? "").toLowerCase().includes("token")` →
 *       Story 1.7's existing refresh-reconnect path. The store's
 *       `isConnected` is NOT flipped (no banner flash during token
 *       rotation; the existing 1.7 contract holds).
 *     - Everything else → `markDisconnected()` only. NO reschedule
 *       here — the `disconnect` that follows the failed connect fires
 *       its own listener with the schedule. (Socket.IO emits
 *       `connect_error` first, then `disconnect` on transport failure;
 *       rescheduling from both would double-fire.)
 *   - `disconnectSocket()` cancels any pending backoff timer
 *     (`clearTimeout`) AND resets `retryAttempt` to 0 BEFORE the
 *     socket is torn down. A zombie timer would otherwise fire
 *     `socket.connect()` on a torn-down socket (the exact bug Story
 *     2.9 closes).
 *
 * The reconnect flow:
 *   1. Server emits `401 token_expired` (or socket middleware rejects
 *      with `token_expired`).
 *   2. Client calls `refreshSession()` (the apiClient helper). On
 *      success, closes the current socket and opens a new one with
 *      `auth: { token }` set to the fresh access token. On refresh
 *      failure, fires the configured `onSessionLost` callback so the
 *      app shell can navigate to /login.
 *
 * Why we never unmount: the React tree does not depend on the socket
 * connection. The socket is owned by a module-scoped variable; pages
 * subscribe to its events through TanStack Query or zustand, both of
 * which survive reconnects without unmounting.
 */
import { io, type Socket } from "socket.io-client";

import { getAccessToken, refreshSession } from "../api/apiClient";

import { computeBackoffMs } from "./backoffTimer";
import { useConnectionStateStore } from "./connectionStateStore";

/**
 * Pulled out so the listener wiring in `wireAuthHandlers` reads
 * like prose. The store itself is a React-side artifact (zustand);
 * these helpers are the imperative mutation surface Story 2.9 needs.
 */
const markConnected = (): void => {
  useConnectionStateStore.getState().markConnected();
};
const markDisconnected = (): void => {
  useConnectionStateStore.getState().markDisconnected();
};
const incrementRetry = (): void => {
  useConnectionStateStore.getState().incrementRetry();
};
const resetRetry = (): void => {
  useConnectionStateStore.getState().resetRetry();
};

/**
 * Tag the server emits (or socket middleware rejects with) to signal
 * that the access token has expired. String matches the api's
 * Socket.IO handler (Story 2.2 wire contract).
 */
export const SOCKET_TOKEN_EXPIRED = "401 token_expired" as const;

interface SocketHandlers {
  /**
   * Called when refresh fails for a non-network reason (server
   * returned 401). The SPA navigates to /login?next=<current>.
   */
  readonly onSessionLost: () => void;
}

let activeSocket: Socket | null = null;
let activeUrl: string | null = null;

/**
 * Module-scoped single backoff timer slot — owned by `socketClient`.
 * Multiple components calling `connectSocket` for the same `url`
 * share the same timer; only one `setTimeout` is in flight at a
 * time. `disconnectSocket()` clears it before tearing down the
 * socket so a zombie timer cannot fire `socket.connect()` on a
 * closed socket (the bug Story 2.9 explicitly closes).
 */
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

const cancelBackoff = (): void => {
  if (backoffTimer !== null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
};

/**
 * Schedule a single reconnect attempt on the given socket.
 * `retryAttempt` is the POST-INCREMENT value from the store — the
 * caller MUST have called `incrementRetry()` first so this formula
 * sees the right delay (5s / 10s / 20s / 30s cap).
 */
const scheduleBackoffReconnect = (
  socket: Socket,
  retryAttempt: number,
): void => {
  cancelBackoff();
  const delayMs = computeBackoffMs(retryAttempt);
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    socket.connect();
  }, delayMs);
};

/**
 * Apply a freshly-minted token to the socket and reconnect. The
 * socket.io client mutates `socket.auth` as a documented side-effect
 * of reconnect-with-different-credentials; the eslint disable below
 * is the surgical escape hatch for that one property.
 */
const reconnectWithToken = (socket: Socket, fresh: string): void => {
  // eslint-disable-next-line no-param-reassign
  socket.auth = { token: fresh };
  socket.disconnect();
  socket.connect();
};

const wireAuthHandlers = (
  socket: Socket,
  handlers: SocketHandlers,
): void => {
  // Story 2.9: every `connect` flips the store to connected and
  // zeros the retry counter. The `connect` event is the only path
  // that clears `isConnected`; token rotation is mid-flight and
  // does not pass through here.
  socket.on("connect", () => {
    // Spec §"Reconnect succeeds mid-backoff": on a successful
    // `connect`, the pending backoff timer MUST clear — otherwise
    // a stray `socket.connect()` fires after the socket is already
    // connected, doubling the connect counter and confusing
    // debugging tooling. The cancel is idempotent so a connect
    // with no pending timer is a no-op.
    cancelBackoff();
    markConnected();
    resetRetry();
  });

  // Story 2.9: transport-level `disconnect` (NOT preceded by a
  // token-rejection `connect_error`) bumps the retry counter THEN
  // schedules a backoff reconnect. We increment FIRST so the
  // formula in `scheduleBackoffReconnect` sees the post-increment
  // value (5s for the first attempt, not 0s).
  socket.on("disconnect", () => {
    incrementRetry();
    markDisconnected();
    scheduleBackoffReconnect(socket, useConnectionStateStore.getState().retryAttempt);
  });

  socket.on("connect_error", (err: Error) => {
    // Server's auth middleware rejected the token. Treat as expired
    // and refresh. If refresh itself fails we fall through to
    // onSessionLost. Story 2.9 invariant: this path MUST NOT flip
    // `isConnected` — token rotation is fast (a refresh + reconnect
    // inside the same socket session), so no banner appears and
    // `retryAttempt` is not incremented. The existing 1.7 contract
    // holds verbatim.
    const message = (err.message ?? "").toLowerCase();
    if (message.includes("token")) {
      void (async () => {
        const fresh = await refreshSession().catch(() => null);
        if (fresh === null) {
          handlers.onSessionLost();
          return;
        }
        reconnectWithToken(socket, fresh);
      })();
      return;
    }
    // Network failure path (timeout, 5xx, `err.message === undefined`).
    // Mark the store as disconnected so the banner appears. We do
    // NOT reschedule here — Socket.IO emits `connect_error` first,
    // then `disconnect` on transport failure. Rescheduling from both
    // listeners would double-fire; the originating `disconnect`
    // owns the schedule.
    markDisconnected();
  });

  socket.on(SOCKET_TOKEN_EXPIRED, () => {
    void (async () => {
      const fresh = await refreshSession().catch(() => null);
      if (fresh === null) {
        handlers.onSessionLost();
        return;
      }
      reconnectWithToken(socket, fresh);
    })();
  });
};

/**
 * Open a Socket.IO connection with the current access token in the
 * `auth.token` payload. Subsequent calls with the same `url` return
 * the existing socket (idempotent). Returns the live socket so the
 * caller can attach page-level listeners.
 *
 * The `handlers.onSessionLost` callback fires when refresh returns
 * null (server 401'd the refresh). The caller wires it to navigate
 * to /login.
 */
export const connectSocket = (
  args: { url: string },
  handlers: SocketHandlers,
): Socket => {
  if (activeSocket !== null && activeUrl === args.url) {
    return activeSocket;
  }
  const token = getAccessToken();
  // The api's Socket.IO server is mounted at `path: "/ingest/"` (Story
  // 2.2). The web subscriber connects with the namespace `/dashboard`
  // so the server-side connection handler can distinguish subscribers
  // (session-token authenticated) from ingest devices (UUID +
  // device-JWT authenticated). See `packages/api/src/index.ts`
  // `isSubscriberConnection` for the matching server-side check.
  const socket: Socket = io(args.url, {
    path: "/ingest/",
    transports: ["websocket"],
    auth: { token },
    reconnection: false, // we manage reconnect on token_expired ourselves
  });
  activeSocket = socket;
  activeUrl = args.url;
  wireAuthHandlers(socket, handlers);
  return socket;
};

export const disconnectSocket = (): void => {
  // Story 2.9: cancel any pending backoff timer AND reset
  // `retryAttempt` to 0 BEFORE disconnecting. A zombie timer would
  // otherwise fire `socket.connect()` on a torn-down socket, leaving
  // a dangling connection that the next `connectSocket` cannot
  // reclaim because `activeSocket === null`.
  cancelBackoff();
  resetRetry();
  if (activeSocket !== null) {
    activeSocket.disconnect();
    activeSocket = null;
    activeUrl = null;
  }
};

/**
 * Test helper. Used by the refresh.spec.ts to assert that the socket
 * is wired without opening a real connection.
 */
export const _resetSocket = (): void => {
  disconnectSocket();
};

/**
 * Story 2.9 test helper: read the current backoff-timer slot. The
 * `Dashboard.spec.tsx` test uses this to assert the pending timer
 * is cancelled after `disconnectSocket`.
 */
export const _hasPendingBackoffTimer = (): boolean =>
  backoffTimer !== null;
