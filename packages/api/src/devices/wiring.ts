/**
 * Lazy-resolved list-reader for `/api/devices`. Returns the device
 * roster joined to `MAX(Reading.serverReceivedAt)` so the dashboard's
 * map view can place one marker per device.
 *
 * Empty / DB-down contract: returns `[]` on any Prisma failure so
 * the map's "No devices" empty-state path is reachable when the DB
 * is unavailable.
 */
import { createLogger } from "@surakkha/shared/logger";

const logger = createLogger({ name: "surakkha-api", level: "info" });

export interface DeviceRosterRow {
  readonly id: string;
  readonly name: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly last_reading_at: string | null;
}

/**
 * List the device roster joined to `MAX(Reading.serverReceivedAt)`
 * per device. Devices with no reading yet surface
 * `last_reading_at: null` (the map renders them in the `offline`
 * severity token).
 *
 * Sort order: `id ASC` — stable across refreshes so the map marker
 * order never shuffles.
 */
export const buildDevicesRosterListReader =
  (resolvePrismaClient: () => Promise<unknown>): (() => Promise<readonly DeviceRosterRow[]>) =>
  async () => {
    try {
      // The single `(client as any)` boundary — `getPrisma()` returns
      // `Promise<unknown>` by design; narrow here so the rest of this
      // function sees a structural type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (await resolvePrismaClient()) as any;
      const rows = (await client.$queryRaw`
      SELECT d."id",
             d."name",
             d."lat",
             d."lng",
             MAX(r."serverReceivedAt") AS "lastReadingAt"
        FROM "Device" d
        LEFT JOIN "Reading" r ON r."deviceId" = d."id"
       GROUP BY d."id", d."name", d."lat", d."lng"
       ORDER BY d."id" ASC
    `) as ReadonlyArray<{
        readonly id: string;
        readonly name: string | null;
        readonly lat: number | null;
        readonly lng: number | null;
        readonly lastReadingAt: Date | string | null;
      }>;
      return rows.map((row) => ({
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
