/**
 * `admin/simulatorWiring.ts` — distilled 2026-08-30 (was inline in
 * `src/index.ts:422-445`).
 *
 * Lazy-resolved list-reader for the admin simulator's
 * `GET /admin/simulator/devices` endpoint. Returns the six
 * default Device rows (`id`, `name`, `scenario`) so the admin tab
 * can render one row per device.
 *
 * Empty / DB-down contract: returns `[]` on any Prisma failure
 * so the admin tab can render an empty state rather than failing
 * the entire page render. Logged so an operator can tell the
 * difference between "no devices seeded yet" and "DB
 * unreachable".
 *
 * Why a separate file: `src/index.ts` was past the `max-lines:
 * 500` ESLint ceiling (842 lines pre-distillation). Extracting
 * the list-reader narrows the `(client as any)` bypass to ONE
 * place (the lazy-resolver boundary) and removes the bypass from
 * `index.ts` entirely.
 */
import { createLogger } from "@surakkha/shared/logger";

const logger = createLogger({ name: "surakkha-api", level: "info" });

export interface SimulatorDeviceRow {
  readonly id: string;
  readonly name: string | null;
  readonly scenario: string | null;
}

/**
 * List the simulator's device rows. Used by
 * `GET /admin/simulator/devices`.
 *
 * Sort order: `id ASC` — stable across refreshes so the admin
 * tab's row order never shuffles.
 */
export const buildSimulatorDevicesListReader =
  (resolvePrismaClient: () => Promise<unknown>): (() => Promise<readonly SimulatorDeviceRow[]>) =>
  async () => {
    try {
      // The single `(client as any)` boundary — `getPrisma()` returns
      // `Promise<unknown>` by design (see `boot/db.ts`); narrow here
      // so the rest of this function sees a structural type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (await resolvePrismaClient()) as any;
      const rows = await client.device.findMany({
        select: { id: true, name: true, scenario: true },
        orderBy: { id: "asc" },
      });
      return rows as readonly SimulatorDeviceRow[];
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
