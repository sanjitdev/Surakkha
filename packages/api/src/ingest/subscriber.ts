/**
 * Subscriber connection handling.
 *
 * The web dashboard's `<Dashboard />` needs a Socket.IO subscription,
 * but it carries a session access token, NOT a device JWT — the
 * device-claim check in `buildIngestServer` would reject it.
 *
 * Solution: when a connection arrives at `/ingest/dashboard` (the
 * sentinel segment), treat it as a SUBSCRIBER. Verify the session
 * token via `verifyAccessToken`, join the `readings:latest` broadcast
 * room, return without registering a `frame` listener. Subscribers
 * are read-only by construction — they cannot inject telemetry.
 */
import { verifyAccessToken } from "../auth/jwt";

/** Sentinel URL segment advertised by the web client when it connects. */
export const SUBSCRIBER_PATH_SEGMENT = "dashboard";

/** Broadcast room subscribers join. Keep in lockstep with the emit
 *  side in `frame.ts`. */
export const SUBSCRIBER_ROOM = "readings:latest";

/** Minimal socket surface needed by `handleSubscriberConnection`. We
 *  type it explicitly so callers cannot accidentally pass the full
 *  Socket.IO `Socket` (which would couple this module to that
 *  library at import time). */
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
 * Subscriber join semantics:
 *   - No token or invalid session JWT → emit `unauthenticated`,
 *     disconnect, do NOT join the room.
 *   - Valid session JWT → join `readings:latest` and return. The
 *     caller is responsible for NOT registering a `frame` listener
 *     (subscribers are read-only).
 *
 * Returns `true` if the socket joined the room, `false` if it was
 * rejected. The return value is consumed by tests; production code
 * ignores it.
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
