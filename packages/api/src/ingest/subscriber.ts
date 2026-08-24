/**
 * Subscriber connection handling — Story 2.6.
 *
 * The api's Socket.IO server is mounted under `path: "/ingest/"` for
 * the device-side WS endpoint (Story 2.2). The web dashboard's
 * `<Dashboard />` (Story 2.6) also needs a Socket.IO subscription,
 * but it carries a session access token, NOT a device JWT — the
 * device-claim check in `buildIngestServer` would reject it.
 *
 * Solution: when a connection arrives at `/ingest/dashboard` (the
 * sentinel segment), treat it as a SUBSCRIBER. Verify the session
 * token via `verifyAccessToken`, join the `readings:latest`
 * broadcast room, and return without registering a `frame`
 * listener. Subscribers are read-only by construction — they cannot
 * inject telemetry.
 *
 * Why a sentinel segment and not a separate namespace:
 *   - The api only mounts one Socket.IO server.
 *   - Two namespaces would force the web client to multiplex
 *     sockets (one for `/ingest/<uuid>`-style auth, one for
 *     dashboard) and double the auth handshake.
 *
 * Why this file exists separately from `index.ts`: we unit-test the
 * decision logic (`isSubscriberConnection`) and the room-join call
 * in isolation, without booting a full Socket.IO server. The
 * frame-level integration test (boot `IoServer`, run `processFrame`,
 * assert subscriber receives `reading:new`) lives in
 * `subscriber.spec.ts` next to this file.
 */
import { verifyAccessToken } from "../auth/jwt";

/**
 * Sentinel URL segment advertised by the web client when it connects.
 * Mirrored on the server side as a Socket.IO namespace, so the
 * decision is also made by which namespace the connection lands on.
 * Kept here for tests + documentation; `packages/web/src/dashboard/
 * useDashboardSocket.ts` hardcodes it.
 */
export const SUBSCRIBER_PATH_SEGMENT = "dashboard";

/**
 * Broadcast room subscribers join. Mirrored on the api's emit side
 * (`packages/api/src/ingest/frame.ts`) — keep the strings in sync.
 */
export const SUBSCRIBER_ROOM = "readings:latest";

/**
 * Minimal socket surface needed by `handleSubscriberConnection`.
 * We type it explicitly so callers cannot accidentally pass the
 * full Socket.IO `Socket` (which would couple this module to that
 * library at import time).
 */
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
export const handleSubscriberConnection = (
  rawSocket: SubscriberSocket,
): boolean => {
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
