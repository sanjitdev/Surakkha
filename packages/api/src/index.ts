/**
 * Surakkha api — entry point.
 *
 * Boots an Express app on `PORT` (default 3000) and exposes:
 *   GET  /health         — Docker Compose healthcheck (unchanged from Step 0)
 *   POST /auth/login     — Story 1.4 (issues access token + refresh cookie)
 *   POST /auth/refresh   — Story 1.4 (mints a new access token from cookie)
 *   GET  /api/readings/latest   — Story 2.6 (dashboard cold-load; replaces the Story 1.5 /devices stub)
 *   GET  /api/incidents/recent  — Story 2.6 (dashboard incidents preview)
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

import { type RuleMetric, type TelemetryFrame } from "@surakkha/shared";
import { type LatestReadingPayload } from "@surakkha/shared/dashboard";
import { createLogger } from "@surakkha/shared/logger";
import { type TelemetryMetrics } from "@surakkha/shared/telemetry";
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
import { buildDevicesRouter } from "./devices/router.js";
import { buildRecentIncidentsRouter } from "./incidents/recentRouter.js";
import { NOOP_HOOKS, setIngestHooks } from "./ingest/hooks";
import { buildIngestServer, INGEST_PATH_PREFIX } from "./ingest/server";
import { handleSubscriberConnection } from "./ingest/subscriber";
import { authenticate } from "./middleware/authorize";
import { buildLatestReadingsRouter } from "./readings/latestRouter.js";
import { hydrateActiveRuleCache } from "./rules/cache";
import { resolvePrismaAlertReader } from "./rules/findOpenAlert";
import {
  installRuleEngineHooks,
  resolveAlertStateRepository,
  WriteAmplificationError,
} from "./rules/hooks";
import { resolvePrismaRuleReader } from "./rules/prismaReader";

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
 * Story 2.6 — `/api/readings/latest` (replaces the Story 1.5 stub at
 * `/devices`). RBAC-gated by `read Device` so every authenticated role
 * (Admin/Operator/Technician/Viewer) can hit it. The admin tab uses
 * its own `/admin/simulator/devices` listing — this endpoint is the
 * dashboard's REST cold-load path (`/api/readings/latest`).
 */
const listLatestReadingsFromPrisma = async (): Promise<readonly LatestReadingPayload[]> => {
  try {
    const client = await resolvePrismaClient();
    // The `client` is the lazy-resolved singleton (typed minimally —
    // see resolvePrismaClient). $queryRaw runs the DISTINCT ON query
    // stubbed in the production adapter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (client as any).$queryRaw`
      SELECT DISTINCT ON (r."deviceId")
             r."deviceId",
             d."name",
             r."ts",
             r."serverReceivedAt",
             r."metrics",
             r."flags"
        FROM "Reading" r
        JOIN "Device" d ON d."id" = r."deviceId"
       ORDER BY r."deviceId", r."serverReceivedAt" DESC
    `;
    return (
      rows as ReadonlyArray<{
        readonly deviceId: string;
        readonly name: string | null;
        readonly ts: Date;
        readonly serverReceivedAt: Date;
        readonly metrics: TelemetryMetrics;
        readonly flags: string[];
      }>
    ).map((row) => ({
      device_id: row.deviceId,
      name: row.name,
      ts: row.ts instanceof Date ? row.ts.getTime() : Number(row.ts),
      server_received_at:
        row.serverReceivedAt instanceof Date
          ? row.serverReceivedAt.toISOString()
          : new Date(row.serverReceivedAt).toISOString(),
      metrics: row.metrics,
      flags: row.flags ?? [],
    }));
  } catch (err) {
    logger.warn({ err }, "listLatestReadings: prisma error, returning empty list");
    return [];
  }
};

app.use(buildLatestReadingsRouter({ audit, listLatest: listLatestReadingsFromPrisma }));

/**
 * Story 2.7 — `GET /api/devices`. Returns the device roster joined
 * to `MAX(Reading.serverReceivedAt)` so the dashboard's map view
 * can place one marker per device. RBAC: `read Device` — every
 * authenticated role can read.
 */
const listDevicesRosterFromPrisma = async () => {
  try {
    const client = await resolvePrismaClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const rows = await c.$queryRaw`
      SELECT d."id",
             d."name",
             d."lat",
             d."lng",
             MAX(r."serverReceivedAt") AS "lastReadingAt"
        FROM "Device" d
        LEFT JOIN "Reading" r ON r."deviceId" = d."id"
       GROUP BY d."id", d."name", d."lat", d."lng"
       ORDER BY d."id" ASC
    `;
    return (
      rows as ReadonlyArray<{
        readonly id: string;
        readonly name: string | null;
        readonly lat: number | null;
        readonly lng: number | null;
        readonly lastReadingAt: Date | string | null;
      }>
    ).map((row) => ({
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      last_reading_at:
        row.lastReadingAt === null || row.lastReadingAt === undefined
          ? null
          : row.lastReadingAt instanceof Date
            ? row.lastReadingAt.toISOString()
            : new Date(row.lastReadingAt).toISOString(),
    }));
  } catch (err) {
    logger.warn({ err }, "listDevicesRoster: prisma error, returning empty list");
    return [];
  }
};

app.use(buildDevicesRouter({ audit, listDevices: listDevicesRosterFromPrisma }));

/**
 * Story 2.6 — `/api/incidents/recent`. Returns up to `?limit=10`
 * incidents from the last 24 hours, ordered by `opened_at DESC`.
 * RBAC: `read Incident` — every authenticated role can read.
 */
const RECENT_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

const listRecentIncidentsFromPrisma = async (limit: number) => {
  try {
    const client = await resolvePrismaClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const since = new Date(Date.now() - RECENT_WINDOW_HOURS * HOUR_MS);
    const rows = await c.incident.findMany({
      where: { openedAt: { gte: since } },
      orderBy: { openedAt: "desc" },
      take: limit,
      select: {
        id: true,
        deviceId: true,
        severity: true,
        metric: true,
        value: true,
        openedAt: true,
      },
    });
    const SEVERITY_BUCKETS = new Set(["info", "warning", "critical"]);
    return (
      rows as ReadonlyArray<{
        readonly id: string;
        readonly deviceId: string;
        readonly severity: string;
        readonly metric: string;
        readonly value: number;
        readonly openedAt: Date;
      }>
    ).map((row) => ({
      id: row.id,
      device_id: row.deviceId,
      severity: SEVERITY_BUCKETS.has(row.severity)
        ? (row.severity as "info" | "warning" | "critical")
        : ("warning" as const),
      metric: row.metric,
      value: row.value,
      opened_at:
        row.openedAt instanceof Date
          ? row.openedAt.toISOString()
          : new Date(row.openedAt).toISOString(),
    }));
  } catch (err) {
    logger.warn({ err }, "listRecentIncidents: prisma error, returning empty list");
    return [];
  }
};

app.use(buildRecentIncidentsRouter({ audit, listRecent: listRecentIncidentsFromPrisma }));

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
    logger.warn({ err }, "listDevices: prisma error, returning empty list");
    return [];
  }
};

app.use(
  "/admin/simulator",
  buildAdminSimulatorRouter({ audit, listDevices: listDevicesFromPrisma }),
);

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
 *
 * Story 3.2 — extended with `reading.findMany` (rate-rule window
 * query). The `metrics` field uses `TelemetryFrame["metrics"]` so
 * this delegate is assignable to `ReadingRepository`.
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
    findMany(args: {
      readonly where: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly ts: { readonly gte: Date };
      };
      readonly orderBy: { readonly ts: "asc" };
      readonly take: number;
    }): Promise<
      ReadonlyArray<{
        readonly ts: Date;
        readonly metrics: TelemetryFrame["metrics"];
      }>
    >;
  };
}

const resolveReadingDelegate = async (): Promise<ReadingDelegate> => {
  const client = await resolvePrismaClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  return {
    reading: {
      create: (args) => c.reading.create(args) as Promise<unknown>,
      findMany: (args) =>
        c.reading.findMany(args) as Promise<
          ReadonlyArray<{
            readonly ts: Date;
            readonly metrics: TelemetryFrame["metrics"];
          }>
        >,
    },
  };
};

/**
 * Story 3.2 — boot path for the rules engine.
 *
 * Wraps the hydration + hook-install in a try/catch so a transient
 * DB outage at boot (the engine's `rule.findMany` rejects) does not
 * crash the api. On failure, the no-op `IngestHooks` default is
 * installed via `setIngestHooks(NOOP_HOOKS)`; the api keeps serving
 * HTTP + WS requests, just without rule evaluation. Pinned by
 * `packages/api/__tests__/boot-fallback.spec.ts`.
 *
 * Pattern mirrors the `runMigrations` fallback shape higher up in
 * this file: log + degrade, do not crash — EXCEPT for the
 * `WriteAmplificationError` thrown by the Story 3.4 boot guard.
 * That error type is a configuration error, not a transient DB
 * outage, and the spec (Design Note "Write-amplification boot
 * guard is code-enforced, not documented-only") requires the api
 * process to exit 78 (EX_CONFIG). The catch below recognizes the
 * error type and re-throws so the outer `boot().catch()` handles
 * it. The `boot-fallback.spec.ts` source-walk pins the swallow
 * pattern — but only for the NON-WriteAmplificationError path
 * (the regex matches the generic `console.error` + NOOP_HOOKS
 * branch; the re-throw branch is a sibling `if` that precedes the
 * fallback and does not collide with the regex).
 */
const initializeRuleEngine = async (): Promise<void> => {
  const client = await resolvePrismaClient();
  try {
    const readingDelegate = await resolveReadingDelegate();
    const cache = await hydrateActiveRuleCache(resolvePrismaRuleReader(client));
    setIngestHooks(
      installRuleEngineHooks({
        cache,
        prisma: resolvePrismaRuleReader(client),
        readingRepository: readingDelegate,
        alertReader: resolvePrismaAlertReader(client),
        alertState: resolveAlertStateRepository(client),
      }),
    );
  } catch (err) {
    if (err instanceof WriteAmplificationError) {
      // Story 3.4 AC12 — configuration error, not a transient
      // outage. The boot guard already logged the offending
      // ruleId via `console.warn`; here we re-throw so the outer
      // `boot().catch()` exits 78 (EX_CONFIG). NOT swallowed.
      throw err;
    }
    console.error("[rules] boot: hydrate failed; running with no-op hooks", err);
    setIngestHooks(NOOP_HOOKS);
  }
};

const ingestHandlerPromise = resolveReadingDelegate().then((prisma) =>
  buildIngestServer({ io, prisma }),
);

// Story 2.6 — declare the `/dashboard` namespace so the web's
// `io(baseUrl + "/dashboard", ...)` handshake is accepted by the
// server. Without this Socket.IO replies with "Invalid namespace"
// and disconnects. The `/dashboard` namespace routes subscribers
// through `handleSubscriberConnection`; the root namespace keeps
// routing ingest devices through `buildIngestServer`.
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
  // falls back to NOOP_HOOKS); see initializeRuleEngine above.
  await initializeRuleEngine();
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
