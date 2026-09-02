/**
 * Lazy-resolved list-reader for `/api/incidents/recent`. Returns
 * up to `limit` incidents from the last 24h, ordered by
 * `opened_at DESC`. Returns `[]` on any Prisma failure so the
 * dashboard's empty-state copy renders cleanly even before
 * rules start firing.
 */
import { type RecentIncidentSummary } from "@surakkha/shared/dashboard";
import { IncidentSeveritySchema } from "@surakkha/shared/incident";
import { createLogger } from "@surakkha/shared/logger";

const logger = createLogger({ name: "surakkha-api", level: "info" });

const RECENT_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

export const normalizeRecentIncidentSeverity = (raw: string): RecentIncidentSummary["severity"] => {
  const parsed = IncidentSeveritySchema.safeParse(raw);
  return parsed.success ? parsed.data : "warning";
};

/** List the most-recent incidents from the last 24h, ordered by
 *  `opened_at DESC`, bounded by `limit`. The 24h window keeps the
 *  preview surface small even as the historical Incident table
 *  grows. */
export const buildRecentIncidentsListReader =
  (
    resolvePrismaClient: () => Promise<unknown>,
  ): ((limit: number) => Promise<readonly RecentIncidentSummary[]>) =>
  async (limit) => {
    try {
      // The single `(client as any)` boundary — `resolvePrismaClient`
      // returns `Promise<unknown>` by design; narrow here so the
      // rest of this function sees a structural type.
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
        severity: normalizeRecentIncidentSeverity(row.severity),
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
