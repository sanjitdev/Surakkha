/**
 * `/api/incidents/recent` — Story 2.6.
 *
 * Dashboard-facing incidents preview. Returns the most-recent
 * open incidents, ordered by `opened_at DESC`, bounded by the
 * `limit` query parameter (default 10, capped at 50).
 *
 * RBAC: `authorize({ action: "read", resource: "Incident" }, audit)`
 * — every authenticated role can read (matrix grants `Incident.read`
 * to all four v1 roles; Technician's ownership rule for assigned
 * incidents is enforced in middleware, not in this router).
 *
 * Story 2.6 ships this endpoint with a `limit` parameter:
 *   GET /api/incidents/recent?limit=10
 *
 * The empty state returns `{ incidents: [] }` so the dashboard's
 * "No incidents in the last 24 hours." copy renders cleanly before
 * Epic 3 starts firing rules.
 *
 * Wire shape:
 *   200 → { incidents: Array<{
 *             id: string,
 *             device_id: string,
 *             severity: "info" | "warning" | "critical",
 *             metric: string,
 *             value: number,
 *             opened_at: string (ISO 8601)
 *           }> }
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
        // AC7: dashboard regions render empty states on any
        // read failure; surface 500 so TanStack Query marks the
        // query `isError`.
        console.error("api/incidents/recent: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
      }
    },
  );

  return router;
};

/**
 * Convenience adapter for the production Prisma delegate. Lazy-
 * imported so the unit-test suite mounts the router without a
 * real client. The 24h window is the spec's "incidents in the
 * last 24 hours" empty-state copy anchor (Story 2.6 AC4) — the
 * filter keeps the preview surface small even as the historical
 * Incident table grows.
 */
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
      // The Prisma `severity` column is a free-form string per the
      // schema's design note; the dashboard only renders three
      // buckets. Map anything unknown to "warning" so a typo'd
      // severity in the DB still surfaces — the alternative (drop
      // the row) is a worse signal.
      severity: normalizeSeverity(row.severity),
      metric: row.metric,
      value: row.value,
      opened_at:
        row.openedAt instanceof Date
          ? row.openedAt.toISOString()
          : new Date(row.openedAt).toISOString(),
    }));
  };

const SEVERITY_BUCKETS = new Set(["info", "warning", "critical"] as const);
const normalizeSeverity = (raw: string): "info" | "warning" | "critical" =>
  SEVERITY_BUCKETS.has(raw as "info" | "warning" | "critical")
    ? (raw as "info" | "warning" | "critical")
    : "warning";
