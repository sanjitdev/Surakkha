/**
 * `/api/incidents/recent` — dashboard preview. Returns the
 * most-recent incidents from the last 24h, ordered by
 * `opened_at DESC`, bounded by `limit` (default 10, max 50).
 */
import {
  type RecentIncidentsResponse,
  type RecentIncidentSummary,
} from "@surakkha/shared/dashboard";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_ERROR, HTTP_OK } from "../httpStatus.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import { normalizeRecentIncidentSeverity } from "./recentWiring.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const RECENT_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

export interface RecentIncidentsDeps {
  readonly audit: AuditLogger;
  /**
   * Injectable data layer. Production uses `PrismaClient.incident`;
   * tests pass a stub that returns canned rows (or an empty array).
   */
  readonly listRecent: (limit: number) => Promise<readonly RecentIncidentSummary[]>;
}

/**
 * Build the `/api/incidents/recent` router. Mounted AFTER
 * `authenticate` in `packages/api/src/index.ts`.
 */
export const buildRecentIncidentsRouter = (deps: RecentIncidentsDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/incidents/recent",
    authorize({ action: "read", resource: "Incident" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const parsed = limitQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: ERROR_CODES.VALIDATION_ERROR.value,
          issues: parsed.error.issues,
        });
        return;
      }
      const limit = parsed.data.limit ?? DEFAULT_LIMIT;
      try {
        const incidents = await deps.listRecent(limit);
        const body: RecentIncidentsResponse = { incidents };
        res.status(HTTP_OK).json(body);
      } catch (err) {
        // Dashboard regions render empty states on any read
        // failure; surface 500 so TanStack Query marks the query
        // `isError`.
        console.error("api/incidents/recent: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
      }
    },
  );

  return router;
};

/** Convenience adapter for the production Prisma delegate. Lazy-
 *  imported so the unit-test suite mounts the router without a
 *  real client. The 24h window keeps the preview surface small
 *  even as the historical Incident table grows. */
export const buildPrismaRecentIncidents =
  async (
    resolveClient: () => Promise<{
      readonly incident: {
        findMany: (args: {
          readonly where: { readonly openedAt: { readonly gte: Date } };
          readonly orderBy: { readonly openedAt: "desc" };
          readonly take: number;
          readonly select: {
            readonly id: true;
            readonly deviceId: true;
            readonly severity: true;
            readonly metric: true;
            readonly value: true;
            readonly openedAt: true;
          };
        }) => Promise<
          ReadonlyArray<{
            readonly id: string;
            readonly deviceId: string;
            readonly severity: string;
            readonly metric: string;
            readonly value: number;
            readonly openedAt: Date;
          }>
        >;
      };
    } | null>,
  ): Promise<(limit: number) => Promise<readonly RecentIncidentSummary[]>> =>
  async (limit) => {
    const client = await resolveClient();
    if (client === null) return [];
    const since = new Date(Date.now() - RECENT_WINDOW_HOURS * HOUR_MS);
    const rows = await client.incident.findMany({
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
    return rows.map((row) => ({
      id: row.id,
      device_id: row.deviceId,
      // Map unknown severities to "warning" so a typo'd severity
      // in the DB still surfaces; dropping the row is a worse
      // signal.
      severity: normalizeRecentIncidentSeverity(row.severity),
      metric: row.metric,
      value: row.value,
      opened_at:
        row.openedAt instanceof Date
          ? row.openedAt.toISOString()
          : new Date(row.openedAt).toISOString(),
    }));
  };
