/**
 * Surakkha api — entry point.
 *
 * Boots an Express app on `PORT` (default 3000) and exposes:
 *   GET  /health         — Docker Compose healthcheck (unchanged from Step 0)
 *   POST /auth/login     — Story 1.4 (issues access token + refresh cookie)
 *   POST /auth/refresh   — Story 1.4 (mints a new access token from cookie)
 *   GET  /api/readings/latest   — Story 2.6 (dashboard cold-load)
 *   GET  /api/devices    — Story 2.7 (map roster)
 *   GET  /api/incidents/recent  — Story 2.6 (dashboard incidents preview)
 *   WS   /ingest/<uuid>  — Story 2.2 (Socket.IO claim-driven ingestion)
 *
 * Story 1.4 AC: JWT_SECRET fail-fast — the process exits with code 1
 * if the env var is missing, empty, or shorter than 32 characters
 * (`@surakkha/shared/auth` exports `JWT_SECRET_MIN_LENGTH`). The check
 * runs BEFORE Express is constructed so no sockets are bound.
 *
 * Distilled 2026-08-30: this file was 842 lines. Boot concerns
 * (Prisma resolution, rule engine hydration, Socket.IO wiring,
 * exit codes) live under `src/boot/`. The 4 list-readers live in
 * dedicated `*wiring.ts` modules under their feature directories.
 * The mount order (auth → public simulator → healthcheck →
 * authenticate → routers → catch-all 404) is preserved verbatim
 * because the catch-all 404 ordering is pinned by
 * `__tests__/catchall-404-order.spec.ts`.
 *
 * Source-walk pins (do NOT refactor without updating the test):
 *   - `/health` MUST register BEFORE the authenticate middleware
 *     and WITHOUT `markPublic`. Pinned by `health.public.spec.ts`.
 *   - The catch-all 404 handler MUST be the LAST Express mount
 *     and its body MUST contain the 404 status constant + the
 *     error literal. Pinned by `catchall-404-order.spec.ts`.
 *   - `boot()` MUST read SKIP_MIGRATIONS from process.env as
 *     exactly `=== "true"`, gate the dynamic import of the db
 *     migration script, log `"api: skipping migrations"`, and
 *     exit with EX_CONFIG on a WriteAmplificationError. Pinned
 *     by `boot.skipMigrations.spec.ts` + `boot-exit-code.spec.ts`.
 *   - The `initializeRuleEngine(...)` call MUST live in `boot()`
 *     (so the cache is populated before the first WS connection).
 *     The function itself now lives in `boot/ruleEngine.ts`,
 *     pinned by `boot-fallback.spec.ts`.
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
import { WriteAmplificationError } from "./rules/hooks.js";

const DEFAULT_API_PORT = 3000;
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

// Health endpoint — must mount BEFORE `authenticate` so the Docker
// Compose `depends_on: condition: service_healthy` healthcheck (a
// bare `fetch('http://localhost:3000/health')` with no Authorization
// header) returns 200, not 401. Without this ordering the simulator
// service is blocked from starting (its `depends_on: api: service_healthy`
// never resolves).
app.get("/health", (_req: Request, res: Response) => {
  res.status(HTTP_OK).json({ status: "ok", service: "surakkha-api" });
});

app.use(authenticate);

/**
 * Story 2.2 — bind Socket.IO to the same HTTP server. `path` keeps
 * the WS endpoint out of Express's URL space; the ingest handler
 * parses the URL on its own so the URL device_id can be compared
 * with the JWT `sub` claim.
 *
 * Constructed AFTER `app` + `app.use(authenticate)` so the
 * `mountAlertRouters` + `buildIncidentsRouterMount` calls below can
 * capture `io` directly. The TCP listener is bound inside `boot()`
 * (after `initializeRuleEngine` populates the rule cache); this
 * block wires the Socket.IO server to the HTTP server.
 *
 * Story 2.6 — declare the `/dashboard` namespace so the web's
 * `io(baseUrl + "/dashboard", ...)` handshake is accepted by the
 * server. Without this Socket.IO replies with "Invalid namespace"
 * and disconnects.
 */
const httpServer: HttpServer = createHttpServer(app);
const { io, ingestHandlerPromise } = createSocketIOServer(httpServer);
wireDashboardNamespace(io, logger);
wireIngestSocket(io, ingestHandlerPromise, logger);

// Story 2.6 — `/api/readings/latest` (replaces the Story 1.5 stub at
// `/devices`). RBAC-gated by `read Device` so every authenticated role
// can hit it. The list-reader is lazy-resolved via `getPrisma()` so a
// transient DB outage at boot does not crash the api.
app.use(
  buildLatestReadingsRouter({
    audit,
    listLatest: buildLatestReadingsListReader(getPrisma),
  }),
);

// Story 2.7 — `GET /api/devices`. The list-reader is lazy-resolved.
app.use(buildDevicesRouter({ audit, listDevices: buildDevicesRosterListReader(getPrisma) }));

// Story 5.2 — `GET /api/devices/:deviceId/readings.csv`. Streams the
// last 30 days of readings (or the `?since`/`?until` window) as CSV.
// RBAC: `export Reading` grants Operator + Admin. Mounted AFTER the
// devices roster so the catch-all 404 (registered further below)
// stays the LAST Express mount per RUNBOOK §6a.
app.use(
  buildCsvRouter({
    audit,
    streamForCsv: buildPrismaStreamForCsv(getPrisma),
    deviceExists: buildPrismaDeviceExists(getPrisma),
  }),
);

// Story 2.6 — `/api/incidents/recent`. The list-reader is lazy-resolved
// and normalizes severity via `IncidentSeveritySchema` (drops the
// hand-rolled `SEVERITY_BUCKETS` Set that silently coerced unknown
// severities to `"warning"`).
app.use(
  buildRecentIncidentsRouter({
    audit,
    listRecent: buildRecentIncidentsListReader(getPrisma),
  }),
);

// Story 2.5 — mount the admin simulator router (authenticated surface).
app.use(
  "/admin/simulator",
  buildAdminSimulatorRouter({
    audit,
    listDevices: buildSimulatorDevicesListReader(getPrisma),
  }),
);

// Story 4.2 — `resolveActorUserId(jwt)` lazy-upsert helper. Extracted
// to `auth/actorUserIdResolver.ts` to keep `index.ts` under the lint
// `max-lines: 500` ceiling (Patch #18 from code review 2026-08-27).
const { resolveActorUserId } = buildActorUserIdResolver(getPrisma);

// Story 3.7 — `/admin/thresholds` admin tab. The forwarder wrapper
// resolves Prisma on first request.
mountThresholdsRouter({ app, audit, resolvePrismaClient: getPrisma });

// Story 3.5 — alerts (acknowledge + list). The forwarder wrappers
// resolve Prisma on first request.
mountAlertRouters({ app, audit, resolvePrismaClient: getPrisma, io });

// Story 4.2 — mount the `/api/incidents` transition router (active +
// transition). The mount sits AFTER `io` + `getPrisma` +
// `resolveActorUserId` are declared so the wiring helper can capture
// them directly.
app.use(
  buildIncidentsRouterMount({
    audit,
    io,
    resolvePrismaClient: getPrisma,
    resolveActorUserId,
  }),
);

// Story 4.10 — mount `/api/notifications` (read + acknowledge).
mountNotificationRouter({ app, audit, resolvePrismaClient: getPrisma });

// Story 5.3 — mount `/api/audit/list` (Admin-only audit-lens
// read view). Mounted AFTER notifications + BEFORE attachments
// to keep the catch-all 404 ordering intact (RUNBOOK §6a). The
// `/audit` surface is read-only; no write affordance is exposed
// here. The audit writer swap is Story 5.6.
mountAuditRouter({ app, audit, resolvePrismaClient: getPrisma });

// Story 4.13 — mount `/api/incidents/:id/attachments` (POST + GET)
// and `/api/attachments/:id` (DELETE).
mountAttachmentRouter({ app, audit, resolvePrismaClient: getPrisma });

// Final 404 — registered AFTER every router mount (including the
// incidents adapter above) so the catch-all only fires for paths
// that no router matched. See `__tests__/catchall-404-order.spec.ts`
// for the ordering pin.
app.use((_req: Request, res: Response) => {
  res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
});

/**
 * Story 2.2 — run migrations before binding the API port so the
 * schema is guaranteed to exist before the api accepts frames.
 * `runMigrations()` throws on failure; the catch turns the throw
 * into `process.exit(1)` so Docker Compose restarts the container
 * until Postgres + schema are both healthy. We invoke the script
 * via a dynamic import so a sibling package boundary in the
 * workspace is preserved without bundling.
 *
 * F-W1 escape hatch: setting `SKIP_MIGRATIONS=true` short-circuits
 * the import + run when the api container's runtime image does not
 * carry the db package's `tsx`/`prisma` toolchain (the production
 * runtime stage in `packages/api/Dockerfile` only copies `dist/` +
 * `node_modules` of `@surakkha/api`, not the db package). Production
 * deploys run migrations as a separate CI step before the api
 * container starts, so the escape hatch is the right default for
 * compose-driven dev with a host-side Postgres too.
 */
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
  // Story 3.2 — install the rule engine hooks. Runs inside the
  // boot() chain so the cache is populated before the first WS
  // connection. The function swallows DB errors internally (logs +
  // falls back to NOOP_HOOKS); see `boot/ruleEngine.ts`.
  await initializeRuleEngine();
  httpServer.listen(PORT, () => {
    logger.info({ port: PORT }, "api: listening");
  });
};

boot().catch((cause) => {
  // Patch (spec-3-4 review 2026-08-27, P-L2-1): exit with EX_CONFIG=78
  // when the boot guard rejects a misconfigured rule cache. Other
  // failures (transient DB outage, JWT misconfiguration) keep the
  // historical `process.exit(1)` contract. Pinned by
  // `boot-exit-code.spec.ts`.
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
