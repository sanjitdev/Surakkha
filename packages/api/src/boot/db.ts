/**
 * `boot/db.ts` — distilled 2026-08-30 (was inline in `src/index.ts:553-589`).
 *
 * The shared Prisma singleton for the api process. Lazy-resolved so
 * HTTP-only tests do not require `DATABASE_URL` to be set, and so
 * a transient DB outage at boot does not crash the api process —
 * the singleton is resolved on first request, not on module import.
 *
 * Why lazy: a per-request `new PrismaClient()` would leak SQLite
 * handles under burst load (each handle holds a file descriptor
 * + a connection-pool slot). The HTTP-only test suite never hits
 * the Prisma path (routers are mounted with stub deps), so the
 * singleton is resolved on first request, not at module import.
 *
 * Why `Promise<unknown>` return type: every downstream consumer
 * narrows via a dedicated repository factory
 * (`resolveAlertAcknowledgeRepository`, `resolvePrismaRuleReader`,
 * `resolveIncidentStateRepository`, etc.) that takes
 * `prisma: unknown` and applies its own narrow cast internally.
 * The 4 list-reader wirings (readings, devices, incidents/recent,
 * admin/simulator) are the only direct consumers of `getPrisma()`
 * — they each contain their own `(client as unknown)` boundary.
 * Keeping the public return type `unknown` makes the type a
 * NO-OP for existing call sites: every wiring module already
 * typed its resolver as `() => Promise<unknown>`.
 */
import { createLogger } from "@surakkha/shared/logger";

const logger = createLogger({ name: "surakkha-api", level: "info" });

let cachedClient: unknown = null;

/**
 * Resolve (and cache) the shared Prisma client. Returns the cached
 * instance on subsequent calls.
 */
export const getPrisma = async (): Promise<unknown> => {
  if (cachedClient !== null) return cachedClient;
  try {
    const mod = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => unknown;
    };
    cachedClient = new mod.PrismaClient();
    return cachedClient;
  } catch (err) {
    logger.warn({ err }, "getPrisma: prisma resolution failed");
    throw err;
  }
};

/**
 * Test-only reset hook. Used by spec files that need to clear the
 * cached singleton between scenarios. NOT exported from `index.ts`;
 * consumers import directly from `boot/db.ts`.
 */
export const __resetPrismaForTests = (): void => {
  cachedClient = null;
};
