/**
 * Surakkha api — entry point.
 *
 * Boots an Express app on `PORT` (default 3000). Boot concerns
 * (Prisma resolution, rule engine hydration, Socket.IO wiring,
 * exit codes) live under `boot/`; this file composes the
 * middleware stack, mounts the routers in the pinned order, and
 * invokes `boot()` to run migrations + listen.
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";

import { createLogger } from "@surakkha/shared/logger";
import cookieParser from "cookie-parser";
import express, { type Express, type Request, type Response } from "express";

import {
  buildAdminSimulatorPublicRouter,
  buildAdminSimulatorRouter,
} from "./admin/simulatorRouter.js";
import { buildSimulatorDevicesListReader } from "./admin/simulatorWiring.js";
import { mountThresholdsRouter } from "./admin/thresholdsWiring.js";
import { mountAlertRouters } from "./alerts/wiring.js";
import { mountAttachmentRouter } from "./attachments/routerWiring.js";
import { type AuditLogger } from "./audit";
import { createAuditLogWriter } from "./audit/auditLogWriter.js";
import { mountAuditRouter } from "./audit/routerWiring.js";
import { buildActorUserIdResolver } from "./auth/actorUserIdResolver";
import { assertJwtSecret } from "./auth/jwt";
import { buildAuthRouter } from "./auth/router";
import { getPrisma } from "./boot/db.js";
import { EX_CONFIG, EXIT_FAILURE } from "./boot/exits.js";
import { initializeRuleEngine } from "./boot/ruleEngine.js";
import { createSocketIOServer, wireDashboardNamespace, wireIngestSocket } from "./boot/socketIO.js";
import { buildDevicesRouter } from "./devices/router.js";
import { buildDevicesRosterListReader } from "./devices/wiring.js";
import { ERROR_CODES } from "./errors.js";
import { HTTP_NOT_FOUND, HTTP_OK } from "./httpStatus.js";
import { buildRecentIncidentsRouter } from "./incidents/recentRouter.js";
import { buildRecentIncidentsListReader } from "./incidents/recentWiring.js";
import { buildIncidentsRouterMount } from "./incidents/routerWiring.js";
import { authenticate } from "./middleware/authorize";
import { mountNotificationRouter } from "./notifications/routerWiring.js";
import {
  buildCsvRouter,
  buildPrismaDeviceExists,
  buildPrismaStreamForCsv,
} from "./readings/csvRouter.js";
import { buildLatestReadingsRouter } from "./readings/latestRouter.js";
import { buildLatestReadingsListReader } from "./readings/wiring.js";
import { scheduleRetentionCron } from "./retention/cronWiring.js";
import { WriteAmplificationError } from "./rules/hooks.js";

const DEFAULT_API_PORT = 3000;
const PORT = Number(process.env["PORT"] ?? DEFAULT_API_PORT);

// Fail-fast — must precede Express construction.
assertJwtSecret();

const logger = createLogger({ name: "surakkha-api", level: "info" });

/** Lazy-resolves Prisma on first emit so a transient DB outage at boot does not crash the api. */
const audit: AuditLogger = createAuditLogWriter({
  resolvePrismaClient: getPrisma,
  logger,
});

const app: Express = express();
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
// Auth router mounts BEFORE `authenticate` so `markPublic()` sets `req.public` ahead of the bearer-token check.
app.use("/auth", buildAuthRouter({ audit }));
// Public admin-simulator status mounts BEFORE `authenticate`; authenticated routes mount after.
app.use(buildAdminSimulatorPublicRouter());

// Health endpoint — mounts BEFORE `authenticate` so the Docker Compose healthcheck (no Authorization header) returns 200.
app.get("/health", (_req: Request, res: Response) => {
  res.status(HTTP_OK).json({ status: "ok", service: "surakkha-api" });
});

app.use(authenticate);

/** Bind Socket.IO to the HTTP server; declare the `/dashboard` namespace so the web handshake is accepted. */
const httpServer: HttpServer = createHttpServer(app);
const { io, ingestHandlerPromise } = createSocketIOServer(httpServer);
wireDashboardNamespace(io, logger);
wireIngestSocket(io, ingestHandlerPromise, logger);

app.use(
  buildLatestReadingsRouter({
    audit,
    listLatest: buildLatestReadingsListReader(getPrisma),
  }),
);

app.use(buildDevicesRouter({ audit, listDevices: buildDevicesRosterListReader(getPrisma) }));

app.use(
  buildCsvRouter({
    audit,
    streamForCsv: buildPrismaStreamForCsv(getPrisma),
    deviceExists: buildPrismaDeviceExists(getPrisma),
  }),
);

app.use(
  buildRecentIncidentsRouter({
    audit,
    listRecent: buildRecentIncidentsListReader(getPrisma),
  }),
);

app.use(
  "/admin/simulator",
  buildAdminSimulatorRouter({
    audit,
    listDevices: buildSimulatorDevicesListReader(getPrisma),
  }),
);

const { resolveActorUserId } = buildActorUserIdResolver(getPrisma);

mountThresholdsRouter({ app, audit, resolvePrismaClient: getPrisma });

mountAlertRouters({ app, audit, resolvePrismaClient: getPrisma, io });

app.use(
  buildIncidentsRouterMount({
    audit,
    io,
    resolvePrismaClient: getPrisma,
    resolveActorUserId,
  }),
);

mountNotificationRouter({ app, audit, resolvePrismaClient: getPrisma });

mountAuditRouter({ app, audit, resolvePrismaClient: getPrisma });

mountAttachmentRouter({ app, audit, resolvePrismaClient: getPrisma });

scheduleRetentionCron({ resolvePrismaClient: getPrisma, audit, logger });

// Catch-all 404 — registered LAST so it only fires for paths no router matched.
app.use((_req: Request, res: Response) => {
  res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
});

/** `SKIP_MIGRATIONS=true` short-circuits the db package import when the runtime image lacks the toolchain. */
const SKIP_MIGRATIONS = process.env.SKIP_MIGRATIONS === "true";

const boot = async (): Promise<void> => {
  if (SKIP_MIGRATIONS) {
    logger.info(
      "api: skipping migrations (SKIP_MIGRATIONS=true); " +
        "ensure `prisma migrate deploy` ran before this container started",
    );
  } else {
    const migrateModule = (await import(
      /* webpackIgnore: true */ "@surakkha/db/scripts/migrate"
    )) as { runMigrations: () => Promise<void> | void };
    await Promise.resolve(migrateModule.runMigrations());
  }
  await initializeRuleEngine();
  httpServer.listen(PORT, () => {
    logger.info({ port: PORT }, "api: listening");
  });
};

boot().catch((cause) => {
  if (cause instanceof WriteAmplificationError) {
    logger.error(
      { err: cause, ruleIds: cause.ruleIds },
      "api: boot refused (write-amplification guard tripped)",
    );
    // eslint-disable-next-line no-restricted-properties
    process.exit(EX_CONFIG);
    return;
  }
  logger.error({ err: cause }, "api: boot failed");
  // eslint-disable-next-line no-restricted-properties
  process.exit(EXIT_FAILURE);
});

export { app };
