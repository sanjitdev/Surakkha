/**
 * Boot-time Socket.IO wiring: bind Socket.IO to the same HTTP
 * server as Express, scoped to `/ingest/`. Register the
 * `/dashboard` namespace so the web's handshake is accepted.
 * Resolve the ingest handler once (lazy, deferred to first
 * connection) and attach it to the root namespace.
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

/** Attach the `/dashboard` namespace handler. The web SPA
 *  connects here; per-socket events route through
 *  `handleSubscriberConnection`. */
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

/** Attach the ingest handler to the root namespace. The handler is
 *  resolved once and re-used per connection. A rejected promise
 *  disconnects the socket — silent failure would leave every
 *  future connection without a handler. */
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
