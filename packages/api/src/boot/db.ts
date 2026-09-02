/**
 * Lazy-resolve the shared Prisma client. Singleton is cached on
 * first request — HTTP-only tests don't require DATABASE_URL.
 */
import { createLogger } from "@surakkha/shared/logger";

const logger = createLogger({ name: "surakkha-api", level: "info" });

let cachedClient: unknown = null;

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

/** Test-only reset hook. Imported directly from `boot/db.ts`,
 *  not re-exported from `index.ts`. */
export const __resetPrismaForTests = (): void => {
  cachedClient = null;
};
