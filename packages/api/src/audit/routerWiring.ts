/**
 * Mount the `/api/audit/list` (GET) route on `app`. Defers the
 * Prisma client resolution until first request so a transient DB
 * outage at boot does not crash the api.
 *
 * Takes `resolvePrismaClient` as an injected dep so this file
 * does not need to know the actual location of the Prisma
 * singleton.
 */
import { type Router } from "express";

import { type AuditLogger } from "../audit.js";

import { type AuditLogRepository, resolveAuditLogRepository } from "./auditLogRepository.js";
import { buildAuditRouter } from "./router.js";

export const mountAuditRouter = (args: {
  readonly app: { readonly use: (handler: Router) => void };
  readonly audit: AuditLogger;
  readonly resolvePrismaClient: () => Promise<unknown>;
}): Router => {
  const { app, audit, resolvePrismaClient } = args;

  let cachedRepo: AuditLogRepository | null = null;
  const ensureRepo = async (): Promise<AuditLogRepository> => {
    if (cachedRepo === null) {
      const client = await resolvePrismaClient();
      cachedRepo = resolveAuditLogRepository(client);
    }
    return cachedRepo;
  };

  const repoWrapper: AuditLogRepository = {
    auditLog: {
      findManyAuditLog: async (findManyArgs) => {
        const repo = await ensureRepo();
        return repo.auditLog.findManyAuditLog(findManyArgs);
      },
    },
  };

  const router = buildAuditRouter({ audit, repo: repoWrapper });
  app.use(router);
  return router;
};
