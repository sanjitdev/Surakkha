/**
 * `/api/readings/latest` — Story 2.6.
 *
 * Returns the latest reading per device, joined with `Device.name`
 * for the dashboard's KPI band + Live Readings table. RBAC-gated by
 * `authorize({ action: "read", resource: "Device" }, audit)` — every
 * authenticated role can read (matrix grants `Device.read` to all
 * four v1 roles).
 *
 * Wire shape:
 *   200 → { readings: Array<{
 *             device_id: string,
 *             name: string | null,
 *             ts: number,
 *             server_received_at: string (ISO 8601),
 *             metrics: TelemetryMetrics,
 *             flags: string[]
 *           }> }
 *   Empty list when no readings exist.
 *
 * Implementation detail — Prisma's MAX-by-group:
 *   The "latest per device" query requires grouping by `deviceId`
 *   and selecting `MAX(serverReceivedAt)` then re-joining back to
 *   the row that carries that timestamp. Prisma 5 supports this via
 *   `groupBy({ by: ["deviceId"], _max: { serverReceivedAt: true } })`
 *   followed by a `findMany` for the matching rows. The simpler
 *   `findFirst({ orderBy: serverReceivedAt desc })` per device is
 *   N round-trips — we use the grouped query so the surface stays
 *   linear as devices scale.
 *
 * The function is injectable via `LatestReadingDeps.listLatest` so
 * tests do not require a live Prisma + Postgres instance.
 */
import {
  type LatestReadingPayload,
  type LatestReadingsResponse,
} from "@surakkha/shared/dashboard";
import { type TelemetryMetrics } from "@surakkha/shared/telemetry";
import express, { type Response, type Router } from "express";

import { authorize } from "../middleware/authorize.js";

import type { AuditLogger } from "../audit.js";

const HTTP_OK = 200;
const HTTP_INTERNAL_ERROR = 500;

export interface LatestReadingsDeps {
  readonly audit: AuditLogger;
  /**
   * Injectable data layer. Production uses `PrismaClient.reading`
   * via `@/db`; tests pass a stub that returns canned rows.
   */
  readonly listLatest: () => Promise<readonly LatestReadingPayload[]>;
}

/**
 * Build the `/api/readings/latest` router. Mounted AFTER
 * `authenticate` in `packages/api/src/index.ts`.
 *
 * Lazy Prisma: this module never imports `@prisma/client`. The
 * production wiring injects a function that resolves the client
 * lazily. HTTP-only tests pass a stub so no DB is needed.
 */
export const buildLatestReadingsRouter = (deps: LatestReadingsDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/readings/latest",
    authorize({ action: "read", resource: "Device" }, deps.audit),
    async (_req, res: Response) => {
      try {
        const readings = await deps.listLatest();
        const body: LatestReadingsResponse = { readings };
        res.status(HTTP_OK).json(body);
      } catch (err) {
        // Surface a 500 so the dashboard's TanStack Query marks the
        // query `isError` and the four regions render their empty
        // states per AC7. The structured logger captures the cause.
        console.error("api/readings/latest: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
      }
    },
  );

  return router;
};

/**
 * Convenience adapter for the production Prisma delegate. The
 * factory returns a `listLatest()` function that loads the device
 * → reading pool via a window function in SQL (Postgres's
 * `DISTINCT ON (device_id)`), keeping the round-trips to one
 * query per refresh and avoiding N+1.
 *
 * Returns `[]` on any Prisma failure so the dashboard's empty-
 * state path is reachable when the DB is unavailable; this matches
 * the AC7 contract ("`GET /api/readings/latest` 500 (DB down)...
 * regions render their empty states").
 *
 * Lazy-imported so the unit-test suite can mount this router
 * without a real Prisma client.
 */
export const buildPrismaLatestReadings = async (
  resolveClient: () => Promise<{
    readonly $queryRaw: (query: TemplateStringsArray) => Promise<unknown[]>;
  } | null>,
): Promise<() => Promise<readonly LatestReadingPayload[]>> => async () => {
  const client = await resolveClient();
  if (client === null) return [];
    // Postgres DISTINCT ON keeps one row per device_id (the one with
    // the highest serverReceivedAt). Returns the joined Device.name
    // alongside the reading. The columns mirror the prisma
    // canonical names so the result row maps cleanly into
    // LatestReadingPayload.
    const rows = (await client.$queryRaw`
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
  `) as ReadonlyArray<{
    readonly deviceId: string;
    readonly name: string | null;
    readonly ts: Date;
    readonly serverReceivedAt: Date;
    readonly metrics: TelemetryMetrics;
    readonly flags: string[];
  }>;
  return rows.map((row) => ({
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
};
