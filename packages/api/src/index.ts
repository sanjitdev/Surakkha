/**
 * Surakkha api — entry point.
 *
 * Boots an Express app on `PORT` (default 3000) and exposes:
 *   GET  /health         — Docker Compose healthcheck (unchanged from Step 0)
 *   POST /auth/login     — Story 1.4 (issues access token + refresh cookie)
 *   POST /auth/refresh   — Story 1.4 (mints a new access token from cookie)
 *   GET  /devices        — Story 1.5 (RBAC-protected demo endpoint)
 *   WS   /ingest/<uuid>  — Story 2.2 (Socket.IO claim-driven ingestion)
 *
 * Story 1.4 AC: JWT_SECRET fail-fast — the process exits with code 1
 * if the env var is missing, empty, or shorter than 32 characters
 * (`@surakkha/shared/auth` exports `JWT_SECRET_MIN_LENGTH`). The check
 * runs BEFORE Express is constructed so no sockets are bound.
 *
 * Story 1.5 wiring:
 *   1. `authenticate()` runs on every request.
 *   2. Routes mounted under `/auth` mark their handlers PUBLIC so the
 *      login + refresh endpoints remain anonymous.
 *   3. Protected routes are wrapped with `authorize({ action, resource })`
 *      which writes a `rbac_denied` audit row on every denial.
 *
 * Story 2.2 wiring:
 *   1. `app.listen` is wrapped in `http.createServer(app)` so the
 *      same TCP port serves HTTP and Socket.IO.
 *   2. `new Server(httpServer)` is constructed; `path: "/ingest/"`
 *      scopes Socket.IO to the ingest namespace; the `/health`
 *      endpoint stays on Express.
 *   3. `buildIngestServer` registers the per-connection handler that
 *      validates the URL + `?token=`, calls `verifyIngestClaims`,
 *      and routes inbound `frame` events through `processFrame`.
 *   4. Prisma is loaded lazily so unit tests that exercise HTTP-only
 *      flows (auth router) do not require DATABASE_URL.
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";

import { createLogger } from "@surakkha/shared/logger";
import cookieParser from "cookie-parser";
import express, { type Express, type Request, type Response } from "express";
import { Server as IoServer } from "socket.io";


import {
  buildAdminSimulatorPublicRouter,
  buildAdminSimulatorRouter,
} from "./admin/simulatorRouter.js";
import { type AuditLogger } from "./audit";
import { assertJwtSecret } from "./auth/jwt";
import { buildAuthRouter } from "./auth/router";
import { buildIngestServer, INGEST_PATH_PREFIX } from "./ingest/server";
import { authenticate, authorize } from "./middleware/authorize";

const DEFAULT_API_PORT = 3000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const PORT = Number(process.env["PORT"] ?? DEFAULT_API_PORT);

// Fail-fast — must precede Express construction (Story 1.4 AC + FR-25).
assertJwtSecret();

const logger = createLogger({ name: "surakkha-api", level: "info" });

/**
 * v1 audit emitter — writes a structured log line that the audit-log
 * pipeline (Story 5.6) consumes. v2 will write to the database.
 */
const audit: AuditLogger = {
  emit(event) {
    logger.info({ audit: event }, `audit:${event.auditAction}`);
  },
};

const app: Express = express();
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
// The auth router must mount BEFORE `authenticate` so the
// `markPublic()` wrapper on `/login` and `/refresh` sets
// `req.public = true` ahead of the bearer-token check.
app.use("/auth", buildAuthRouter({ audit }));
// Story 2.5 — `/admin/simulator/status` is public (so the disabled
// banner renders for any visitor). Mount its public surface BEFORE
// `authenticate`; the authenticated routes (`/devices`,
// `/:device_id/scenario`) mount AFTER `authenticate` below.
app.use(buildAdminSimulatorPublicRouter());
app.use(authenticate);

/**
 * Demo protected endpoint — Story 1.5. The real `/devices` surface
 * (Epic 2) will land its own router with the same authorize gate.
 * This stub exists so curl can prove the wiring without spinning up
 * the full ingestion stack.
 */
app.get(
  "/devices",
  authorize({ action: "read", resource: "Device" }, audit),
  (_req: Request, res: Response) => {
    res.status(HTTP_OK).json({ devices: [] });
  },
);

/**
 * Story 2.5 — mount the admin simulator router. The router reads
 * the six Device rows via a shared lazy Prisma singleton (same
 * pattern the ingest handler uses — avoids a hard dependency on
 * DATABASE_URL for HTTP-only tests).
 */
const listDevicesFromPrisma = async (): Promise<
  ReadonlyArray<{
    readonly id: string;
    readonly name: string | null;
    readonly scenario: string | null;
  }>
> => {
  try {
    const client = await resolvePrismaClient();
    const rows = await client.device.findMany({
      select: { id: true, name: true, scenario: true },
      orderBy: { id: "asc" },
    });
    return rows;
  } catch (err) {
    // Without a DB we return an empty list. The admin tab can render
    // an empty state rather than failing the entire page render.
    // Log so an operator can tell the difference between "no devices
    // seeded yet" and "DB unreachable" — a per-request `new
    // PrismaClient()` would have leaked handles under burst load.
    logger.warn(
      { err },
      "listDevices: prisma error, returning empty list",
    );
    return [];
  }
};

app.use(
  "/admin/simulator",
  buildAdminSimulatorRouter({ audit, listDevices: listDevicesFromPrisma }),
);

app.get("/health", (_req: Request, res: Response) => {
  res.status(HTTP_OK).json({ status: "ok", service: "surakkha-api" });
});

// Final 404 — the same shape the Step 0 stub returned, so the Docker
// healthcheck contract is unchanged.
app.use((_req: Request, res: Response) => {
  res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
});

/**
 * Story 2.2 — bind Socket.IO to the same HTTP server. `path` keeps
 * the WS endpoint out of Express's URL space; the ingest handler
 * parses the URL on its own so the URL device_id can be compared
 * with the JWT `sub` claim.
 */
const httpServer: HttpServer = createHttpServer(app);
const io = new IoServer(httpServer, {
  path: INGEST_PATH_PREFIX,
  pingTimeout: 25_000,
  pingInterval: 20_000,
  // F-P10: cap inbound WS message size (a v1 telemetry frame is
  // <1 KB). Default is 1 MB which would let a malicious client
  // OOM the api process with a single oversized payload.
  maxHttpBufferSize: 64_000,
  // F-P10: WS endpoint is not browser-facing in v1 — devices and
  // simulators authenticate via JWT, not cookies. `cors: { origin:
  // false }` rejects cross-origin browser connections; same-origin
  // (api host) still works because Socket.IO treats that as the
  // allowed origin. v2 may revisit if a browser-based admin client
  // needs WS access (it does not today).
  cors: { origin: false },
});

/**
 * Resolve the shared Prisma client. Lazy so the HTTP-only test suite
 * (which never instantiates the WS path) does not need DATABASE_URL
 * set. The dynamic import surfaces the underlying error if the Prisma
 * client has not been generated yet — at which point the api boot
 * path fails fast with a clear message.
 *
 * ONE singleton per process: a per-request `new PrismaClient()` would
 * leak SQLite handles under burst load (each handle holds a file
 * descriptor and a connection-pool slot).
 */
let cachedPrismaRaw: unknown = null;
const resolvePrismaClient = async (): Promise<{
  readonly device: {
    findMany: (args: {
      readonly select: { readonly id: true; readonly name: true; readonly scenario: true };
      readonly orderBy: { readonly id: "asc" };
    }) => Promise<
      Array<{
        readonly id: string;
        readonly name: string | null;
        readonly scenario: string | null;
      }>
    >;
  };
  readonly reading: {
    create: (args: {
      readonly data: {
        readonly deviceId: string;
        readonly ts: Date;
        readonly serverReceivedAt: Date;
        readonly metrics: unknown;
        readonly seq: number;
        readonly flags: readonly string[];
      };
    }) => Promise<unknown>;
  };
}> => {
  if (cachedPrismaRaw !== null) {
    return cachedPrismaRaw as Awaited<ReturnType<typeof resolvePrismaClient>>;
  }
  const mod = (await import("@prisma/client")) as unknown as {
    PrismaClient: new () => unknown;
  };
  const client = new mod.PrismaClient();
  cachedPrismaRaw = client;
  return client as Awaited<ReturnType<typeof resolvePrismaClient>>;
};

/**
 * Resolve the Prisma reading delegate. Lazy so the HTTP-only
 * test suite (which never instantiates the WS path) does not need
 * DATABASE_URL set.
 */
interface ReadingDelegate {
  readonly reading: {
    create(args: {
      readonly data: {
        readonly deviceId: string;
        readonly ts: Date;
        readonly serverReceivedAt: Date;
        readonly metrics: unknown;
        readonly seq: number;
        readonly flags: readonly string[];
      };
    }): Promise<unknown>;
  };
}

const resolveReadingDelegate = async (): Promise<ReadingDelegate> => {
  const client = await resolvePrismaClient();
  return {
    reading: {
      create: (args) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).reading.create(args) as Promise<unknown>,
    },
  };
};

const ingestHandlerPromise = resolveReadingDelegate().then((prisma) =>
  buildIngestServer({ io, prisma }),
);

io.on("connection", (socket) => {
  // F-P4: if `resolveReadingDelegate()` rejects (Prisma init failure)
  // or `buildIngestServer` throws, every connection would otherwise
  // silently never get a handler. Surface the error and disconnect.
  ingestHandlerPromise
    .then((handler) => handler(socket))
    .catch((err: unknown) => {
      logger.error({ err }, "ingest: handler init failed");
      socket.disconnect(true);
    });
});

/**
 * Story 2.2 — run migrations before binding the API port so the
 * schema is guaranteed to exist before the api accepts frames.
 * `runMigrations()` throws on failure; the catch turns the throw
 * into `process.exit(1)` so Docker Compose restarts the container
 * until Postgres + schema are both healthy. We invoke the script
 * via a dynamic import so a sibling package boundary in the
 * workspace is preserved without bundling.
 */
const boot = async (): Promise<void> => {
  const migrateModule = (await import(
    /* webpackIgnore: true */ "@surakkha/db/scripts/migrate"
  )) as { runMigrations: () => Promise<void> | void };
  await Promise.resolve(migrateModule.runMigrations());
  httpServer.listen(PORT, () => {
    logger.info({ port: PORT }, "api: listening");
  });
};

boot().catch((cause) => {
  logger.error({ err: cause }, "api: boot failed");
  // eslint-disable-next-line no-restricted-properties
  process.exit(1);
});

export { app };