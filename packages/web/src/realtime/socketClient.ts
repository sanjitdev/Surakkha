/**
 * Socket client — Surakkha web (Story 1.7).
 *
 * Story 1.7 AC3:
 *   "Given an open Socket.IO connection receives a `401 token_expired`
 *    event, the socket reconnects with a freshly minted access token,
 *    and the UI does not unmount or flash a loading screen."
 *
 * The actual Socket.IO server-side wiring lands in Story 2.2 (ingest
 * WebSocket). Story 1.7 ships the client-side handler so the refresh
 * surface is in place when the server starts emitting the event. The
 * connection itself is opened lazily by the surface that owns the
 * realtime stream (Dashboard, Incidents Kanban); this module exposes:
 *
 *   - `connectSocket({ url, authToken })` — opens a socket with the
 *     current token in the auth payload; on `401 token_expired`, calls
 *     `refreshSession()` and reconnects with the new token.
 *   - `disconnectSocket()` — closes the active socket (used by tests
 *     and on logout).
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
  socket.on("connect_error", (err: Error) => {
    // Server's auth middleware rejected the token. Treat as expired
    // and refresh. If refresh itself fails we fall through to
    // onSessionLost.
    if (err.message.toLowerCase().includes("token")) {
      void (async () => {
        const fresh = await refreshSession().catch(() => null);
        if (fresh === null) {
          handlers.onSessionLost();
          return;
        }
        reconnectWithToken(socket, fresh);
      })();
    }
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
  const socket: Socket = io(args.url, {
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