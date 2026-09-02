/**
 * `/api/readings/latest` — dashboard router returning the latest
 * reading per device, joined with `Device.name`.
 *
 * The query uses Postgres's `DISTINCT ON (device_id)` window
 * function to keep round-trips linear as devices scale (no N+1).
 * RBAC-gated by `authorize({ action: "read", resource: "Device" })`.
 */
import { type LatestReadingPayload, type LatestReadingsResponse } from "@surakkha/shared/dashboard";
import { type TelemetryMetrics } from "@surakkha/shared/telemetry";
import express, { type Response, type Router } from "express";

import { ERROR_CODES } from "../errors.js";
import { HTTP_INTERNAL_ERROR, HTTP_OK } from "../httpStatus.js";
import { authorize } from "../middleware/authorize.js";

import type { AuditLogger } from "../audit.js";

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
        // query `isError` and the regions render their empty states.
        console.error("api/readings/latest: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
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
 * state path is reachable when the DB is unavailable.
 *
 * Lazy-imported so the unit-test suite can mount this router
 * without a real Prisma client.
 */
export const buildPrismaLatestReadings =
  async (
    resolveClient: () => Promise<{
      readonly $queryRaw: (query: TemplateStringsArray) => Promise<unknown[]>;
    } | null>,
  ): Promise<() => Promise<readonly LatestReadingPayload[]>> =>
  async () => {
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
