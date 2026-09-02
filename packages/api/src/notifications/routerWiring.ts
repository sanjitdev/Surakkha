/**
 * Lazy-resolve the production `NotificationRepository` and wrap
 * `buildNotificationRouter` so the api can boot without
 * `DATABASE_URL` set. A transient DB outage at boot does NOT crash
 * the api — the wrapper rejects on first request and the router's
 * per-handler catch surfaces 500 instead of leaking a stack trace.
 */
import { type Router } from "express";

import { type AuditLogger } from "../audit.js";

import {
  type NotificationRepository,
  resolveNotificationRepository,
} from "./notificationRepository.js";

import { buildNotificationRouter } from "./index.js";

/** Mount the `/api/notifications` (GET) and
 *  `/api/notifications/:id/acknowledge` (PATCH) routes on `app`.
 *  Defers the Prisma client resolution until first request. Takes
 *  `resolvePrismaClient` as an injected dep so this file does not
 *  need to know the actual location of the Prisma singleton. */
export const mountNotificationRouter = (args: {
  readonly app: { readonly use: (handler: Router) => void };
  readonly audit: AuditLogger;
  readonly resolvePrismaClient: () => Promise<unknown>;
}): Router => {
  const { app, audit, resolvePrismaClient } = args;

  let cachedRepo: NotificationRepository | null = null;
  const ensureRepo = async (): Promise<NotificationRepository> => {
    if (cachedRepo === null) {
      const client = await resolvePrismaClient();
      cachedRepo = resolveNotificationRepository(client);
    }
    return cachedRepo;
  };

  const repoWrapper: NotificationRepository = {
    notification: {
      findMany: async (findManyArgs) => {
        const repo = await ensureRepo();
        return repo.notification.findMany(findManyArgs);
      },
      findManyAdmin: async (findManyAdminArgs) => {
        const repo = await ensureRepo();
        return repo.notification.findManyAdmin(findManyAdminArgs);
      },
      findUnique: async (findUniqueArgs) => {
        const repo = await ensureRepo();
        return repo.notification.findUnique(findUniqueArgs);
      },
      updateMany: async (updateManyArgs) => {
        const repo = await ensureRepo();
        return repo.notification.updateMany(updateManyArgs);
      },
    },
  };

  const router = buildNotificationRouter({
    audit,
    now: () => new Date(),
    repo: repoWrapper,
  });
  app.use(router);
  return router;
};
