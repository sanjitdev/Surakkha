/**
 * Subscriber connection for the dashboard.
 *
 * Carries a session access token (not a device JWT), so the
 * device-claim check in `buildIngestServer` would reject it. When a
 * connection arrives at `/ingest/dashboard`, this handler verifies
 * the session token and joins the broadcast room. Subscribers are
 * read-only — no `frame` listener is registered.
 */
import { verifyAccessToken } from "../auth/jwt";

/** Sentinel URL segment advertised by the dashboard client. */
export const SUBSCRIBER_PATH_SEGMENT = "dashboard";

/** Broadcast room subscribers join — single source of truth, keep in lockstep with the emit side. */
export const SUBSCRIBER_ROOM = "readings:latest";

/** Minimal socket surface used by `handleSubscriberConnection`. */
export interface SubscriberSocket {
  readonly handshake: {
    readonly auth?: Record<string, unknown>;
  };
  readonly emit: (event: string, ...args: unknown[]) => unknown;
  readonly disconnect: (close?: boolean) => unknown;
  /** Join a Socket.IO room — present on real sockets, mocked in tests. */
  readonly join?: (room: string) => unknown;
}

/**
 * Returns `true` if the socket joined the broadcast room, `false` if it
 * was rejected. The caller must NOT register a `frame` listener on
 * returned sockets — subscribers are read-only.
 */
export const handleSubscriberConnection = (rawSocket: SubscriberSocket): boolean => {
  const authToken = rawSocket.handshake.auth?.["token"];
  if (typeof authToken !== "string") {
    rawSocket.emit("unauthenticated");
    rawSocket.disconnect(true);
    return false;
  }
  const claims = verifyAccessToken(authToken);
  if (claims === null) {
    rawSocket.emit("unauthenticated");
    rawSocket.disconnect(true);
    return false;
  }
  if (typeof rawSocket.join === "function") {
    rawSocket.join(SUBSCRIBER_ROOM);
  }
  return true;
};
