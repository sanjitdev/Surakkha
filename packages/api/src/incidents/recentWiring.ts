/**
 * `incidents/recentWiring.ts` — distilled 2026-08-30 (was inline in
 * `src/index.ts:237-283`).
 *
 * Lazy-resolved list-reader for `/api/incidents/recent`. Returns up
 * to `limit` incidents from the last 24 hours, ordered by
 * `opened_at DESC`.
 *
 * Severity normalization: the schema column is a free `string`
 * in Prisma's generated type, but the wire contract pins it to
 * `"info" | "warning" | "critical"` (see
 * `@surakkha/shared/incident.IncidentSeveritySchema`). If a future
 * Prisma drift returns an unknown severity, the dashboard's "all
 * critical" badge would silently under-report. The list-reader
 * validates rows against `IncidentSeveritySchema` and coerces
 * unknown values to `"warning"` (the lowest non-info severity) so
 * the badge count is monotonic with the row count.
 *
 * Empty / DB-down contract: returns `[]` on any Prisma failure.
 * The dashboard's "No incidents in the last 24 hours." copy
 * renders cleanly before Epic 3 starts firing rules.
 */
import { type RecentIncidentSummary } from "@surakkha/shared/dashboard";
import { IncidentSeveritySchema } from "@surakkha/shared/incident";
import { createLogger } from "@surakkha/shared/logger";

const logger = createLogger({ name: "surakkha-api", level: "info" });

const RECENT_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

const normalizeSeverity = (raw: string): RecentIncidentSummary["severity"] => {
  const parsed = IncidentSeveritySchema.safeParse(raw);
  return parsed.success ? parsed.data : "warning";
};

/**
 * List the most-recent incidents from the last 24 hours, ordered
 * by `opened_at DESC`, bounded by `limit`. The 24h window is the
 * spec's "incidents in the last 24 hours" empty-state copy
 * anchor (Story 2.6 AC4) — the filter keeps the preview surface
 * small even as the historical Incident table grows.
 */
export const buildRecentIncidentsListReader =
  (
    resolvePrismaClient: () => Promise<unknown>,
  ): ((limit: number) => Promise<readonly RecentIncidentSummary[]>) =>
  async (limit) => {
    try {
      // The single `(client as any)` boundary — `getPrisma()` returns
      // `Promise<unknown>` by design (see `boot/db.ts`); narrow here
      // so the rest of this function sees a structural type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (await resolvePrismaClient()) as any;
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
        severity: normalizeSeverity(row.severity),
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
