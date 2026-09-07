/**
 * Lazy-resolve the shared Prisma client. Singleton is cached on
 * first request — HTTP-only tests don't require DATABASE_URL.
 *
 * The client is wrapped in `notificationAdminExtension` so the
 * `notification.findManyAdmin(args)` method exists at runtime.
 * `notifications/notificationRepository.ts:resolveNotificationRepository`
 * does a runtime guard for that method and throws when missing —
 * the throw is deliberate (silent fallback would re-introduce the
 * operator-shaped filters the admin endpoint drops). Applying the
 * extension exactly once at construction is the only way to make
 * that guard pass.
 */
import { createLogger } from "@surakkha/shared/logger";

import { notificationAdminExtension } from "./prismaClientExtension.js";

const logger = createLogger({ name: "surakkha-api", level: "info" });

let cachedClient: unknown = null;

export const getPrisma = async (): Promise<unknown> => {
  if (cachedClient !== null) return cachedClient;
  try {
    const mod = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => unknown;
    };
    // Apply the extension at construction time so EVERY consumer
    // of the cached client sees `notification.findManyAdmin`. A
    // re-apply on a later request would create a new extended
    // client and break the singleton invariant — that's why
    // `cachedClient` caches the extended result, not the base
    // client.
    const base = new mod.PrismaClient();
    cachedClient = notificationAdminExtension(base);
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
