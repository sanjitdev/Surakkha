/**
 * `readings/wiring.ts` — distilled 2026-08-30 (was inline in
 * `src/index.ts:132-177`).
 *
 * Lazy-resolved list-reader for `/api/readings/latest`. Returns
 * the typed adapter function; the router awaits the first-use
 * Prisma resolution at request time, so a transient DB outage at
 * boot does NOT crash the api — the wrapper rejects on first
 * request and the router's per-handler catch surfaces 500
 * instead of leaking a stack trace.
 *
 * Why a separate file:
 *   - `src/index.ts` was already past the `max-lines: 500`
 *     ESLint ceiling (842 lines pre-distillation). The
 *     list-reader's SQL query is the longest `(client as any)`
 *     bypass in the file; extracting it narrows the bypass to
 *     ONE place (the lazy-resolver boundary) and removes the
 *     bypass from `index.ts` entirely.
 *
 * Wire shape:
 *   `GET /api/readings/latest` returns `LatestReadingsResponse`
 *   with the latest reading per device (Postgres
 *   `DISTINCT ON (device_id)` keeps one row per device sorted by
 *   `serverReceivedAt DESC`).
 *
 * Empty / DB-down contract: returns `[]` on any Prisma failure.
 * Mirrors AC7: dashboard regions render their empty states on a
 * 500 from this endpoint (TanStack Query marks the query
 * `isError`).
 */
import { type LatestReadingPayload } from "@surakkha/shared/dashboard";
import { createLogger } from "@surakkha/shared/logger";
import { type TelemetryMetrics } from "@surakkha/shared/telemetry";

const logger = createLogger({ name: "surakkha-api", level: "info" });

/**
 * List the latest reading per device, joined with `Device.name`
 * so the dashboard's KPI band + Live Readings table can render
 * without a second round-trip.
 *
 * Returns `[]` on any Prisma failure so the empty-state path is
 * reachable when the DB is unavailable.
 */
export const buildLatestReadingsListReader =
  (resolvePrismaClient: () => Promise<unknown>): (() => Promise<readonly LatestReadingPayload[]>) =>
  async () => {
    try {
      // The single `(client as any)` boundary — `getPrisma()` returns
      // `Promise<unknown>` by design (see `boot/db.ts`); narrow here
      // so the rest of this function sees a structural type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (await resolvePrismaClient()) as any;
      // Postgres DISTINCT ON keeps one row per device_id (the one with
      // the highest serverReceivedAt). Returns the joined Device.name
      // alongside the reading. The columns mirror the prisma canonical
      // names so the result row maps cleanly into LatestReadingPayload.
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
    } catch (err) {
      logger.warn({ err }, "listLatestReadings: prisma error, returning empty list");
      return [];
    }
  };
