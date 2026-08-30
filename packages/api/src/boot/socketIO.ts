/**
 * `boot/socketIO.ts` — distilled 2026-08-30 (was inline in
 * `src/index.ts:524-540` and `755-778`).
 *
 * Boot-time Socket.IO wiring:
 *   1. Bind Socket.IO to the same HTTP server that Express serves,
 *      scoped to `/ingest/` so the WS endpoint stays out of
 *      Express's URL space (the ingest handler parses the URL on
 *      its own to compare the device_id with the JWT `sub` claim).
 *   2. Register the `/dashboard` namespace so the web's
 *      `io(baseUrl + "/dashboard", ...)` handshake is accepted.
 *      Without this, Socket.IO replies "Invalid namespace" and
 *      disconnects.
 *   3. Resolve the ingest handler promise once (lazy — defers
 *      `resolveReadingDelegate()` + `buildIngestServer()` to the
 *      first connection, NOT module import), then attach it to
 *      the root namespace so every new connection receives the
 *      handler without re-creating it.
 *
 * `maxHttpBufferSize` (F-P10): caps inbound WS message size at 64 KB
 * so a malicious client cannot OOM the api process with a single
 * oversized payload. A v1 telemetry frame is <1 KB.
 *
 * `cors: { origin: false }` (F-P10): the WS endpoint is not
 * browser-facing in v1 — devices and simulators authenticate via
 * JWT, not cookies. Cross-origin browser connections are rejected;
 * same-origin (api host) still works because Socket.IO treats that
 * as the allowed origin.
 */
import { type Server as HttpServer } from "node:http";

import { Server as IoServer, type Server as IOServer, type Socket } from "socket.io";

import { buildIngestServer, INGEST_PATH_PREFIX } from "../ingest/server.js";
import { handleSubscriberConnection } from "../ingest/subscriber.js";

import { resolveReadingDelegate } from "./readingDelegate.js";

export interface SocketIOHandle {
  readonly io: IOServer;
  readonly ingestHandlerPromise: Promise<(socket: Socket) => Promise<void>>;
}

/**
 * Build the Socket.IO server bound to the same HTTP server that
 * Express serves. Returns the io handle plus the ingest handler
 * promise so `wireIngestSocket` can attach the handler once it
 * resolves (avoiding per-connection `resolveReadingDelegate()` calls).
 */
export const createSocketIOServer = (httpServer: HttpServer): SocketIOHandle => {
  const io = new IoServer(httpServer, {
    path: INGEST_PATH_PREFIX,
    pingTimeout: 25_000,
    pingInterval: 20_000,
    maxHttpBufferSize: 64_000,
    cors: { origin: false },
  });

  const ingestHandlerPromise = resolveReadingDelegate().then((prisma) =>
    buildIngestServer({ io, prisma }),
  );

  return { io, ingestHandlerPromise };
};

/**
 * Attach the `/dashboard` namespace handler. The web SPA connects
 * to this namespace; the per-socket handler routes every event
 * through `handleSubscriberConnection` (the Story 2.6 dashboard
 * subscriber).
 */
export const wireDashboardNamespace = (
  io: IOServer,
  logger: { error: (args: unknown, msg: string) => void },
): void => {
  const dashboardNamespace = io.of("/dashboard");
  dashboardNamespace.on("connection", (socket) => {
    try {
      handleSubscriberConnection(
        socket as unknown as Parameters<typeof handleSubscriberConnection>[0],
      );
    } catch (err) {
      logger.error({ err }, "ingest: subscriber handler failed");
      socket.disconnect(true);
    }
  });
};

/**
 * Attach the ingest handler to the root namespace. The handler is
 * resolved once (via the `ingestHandlerPromise`) and re-used for
 * every connection. A rejected promise is surfaced and the
 * connection is disconnected — silent failure would leave every
 * future connection without a handler (F-P4).
 */
export const wireIngestSocket = (
  io: IOServer,
  ingestHandlerPromise: SocketIOHandle["ingestHandlerPromise"],
  logger: { error: (args: unknown, msg: string) => void },
): void => {
  io.on("connection", (socket) => {
    ingestHandlerPromise
      .then((handler) => handler(socket))
      .catch((err: unknown) => {
        logger.error({ err }, "ingest: handler init failed");
        socket.disconnect(true);
      });
  });
};
