/**
 * Socket.IO client. Opens a connection with the current access token
 * in `auth.token`; on 401 / `401 token_expired`, calls
 * `refreshSession()` and reconnects with the fresh token. On
 * transport failure, schedules a backoff reconnect via
 * `scheduleBackoffReconnect`. `disconnectSocket` cancels any pending
 * timer AND resets the retry counter before tearing down so a zombie
 * `setTimeout` can't fire `socket.connect()` on a closed socket.
 *
 * The `path: "/ingest/"` + namespace `/dashboard` distinguishes
 * web subscribers (session-token auth) from ingest devices
 * (UUID + device-JWT auth) on the server side.
 */
import { io, type Socket } from "socket.io-client";

import { getAccessToken, refreshSession } from "../api/apiClient";

import { computeBackoffMs } from "./backoffTimer";
import { useConnectionStateStore } from "./connectionStateStore";

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

/** Tag the server emits (or socket middleware rejects with) to signal
 *  an expired access token. Wire contract with the api. */
export const SOCKET_TOKEN_EXPIRED = "401 token_expired" as const;

interface SocketHandlers {
  /** Fires when refresh returns null (server 401'd the refresh);
   *  the SPA navigates to /login. */
  readonly onSessionLost: () => void;
}

let activeSocket: Socket | null = null;
let activeUrl: string | null = null;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

const cancelBackoff = (): void => {
  if (backoffTimer !== null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
};

const scheduleBackoffReconnect = (socket: Socket, retryAttempt: number): void => {
  cancelBackoff();
  const delayMs = computeBackoffMs(retryAttempt);
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    socket.connect();
  }, delayMs);
};

const reconnectWithToken = (socket: Socket, fresh: string): void => {
  // eslint-disable-next-line no-param-reassign -- socket.io documented side-effect.
  socket.auth = { token: fresh };
  socket.disconnect();
  socket.connect();
};

const wireAuthHandlers = (socket: Socket, handlers: SocketHandlers): void => {
  socket.on("connect", () => {
    cancelBackoff();
    markConnected();
    resetRetry();
  });

  socket.on("disconnect", () => {
    incrementRetry();
    markDisconnected();
    scheduleBackoffReconnect(socket, useConnectionStateStore.getState().retryAttempt);
  });

  socket.on("connect_error", (err: Error) => {
    // Token-rejection path: refresh + reconnect WITHOUT flipping
    // `isConnected` (the banner doesn't flash during token rotation).
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
    // Network / 5xx path: mark disconnected. The following
    // `disconnect` listener owns the reschedule — Socket.IO emits
    // `connect_error` first, then `disconnect` on transport failure,
    // so rescheduling from both would double-fire.
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

export const connectSocket = (args: { url: string }, handlers: SocketHandlers): Socket => {
  if (activeSocket !== null && activeUrl === args.url) {
    return activeSocket;
  }
  const token = getAccessToken();
  const socket: Socket = io(args.url, {
    path: "/ingest/",
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
  });
  activeSocket = socket;
  activeUrl = args.url;
  wireAuthHandlers(socket, handlers);
  return socket;
};

export const disconnectSocket = (): void => {
  cancelBackoff();
  resetRetry();
  if (activeSocket !== null) {
    activeSocket.disconnect();
    activeSocket = null;
    activeUrl = null;
  }
};

export const _resetSocket = (): void => {
  disconnectSocket();
};

export const _hasPendingBackoffTimer = (): boolean => backoffTimer !== null;
