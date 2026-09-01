/**
 * `routerWiring.ts` — Story 5.3.
 *
 * Lazily-resolves the production `AuditLogRepository` and wraps
 * the `buildAuditRouter` so the api can boot without
 * `DATABASE_URL` set (mirrors `notifications/routerWiring.ts`
 * from Story 4.10 / 5.1). A transient DB outage at boot does NOT
 * crash the api — the wrapper rejects on first request and the
 * router's per-handler catch surfaces 500 instead of leaking a
 * stack trace.
 *
 * Lives outside `index.ts` because Story 4.10's mount block
 * pushed that file past the `max-lines: 500` ESLint rule (it
 * was 842 lines before extraction). The audit mount follows the
 * same pattern to keep `index.ts` under the limit without
 * dropping the router registration (a spec AC: `/api/audit/list`
 * must mount in the api process — not just exist as a dead
 * file).
 */
import { type Router } from "express";

import { type AuditLogger } from "../audit.js";

import { type AuditLogRepository, resolveAuditLogRepository } from "./auditLogRepository.js";
import { buildAuditRouter } from "./router.js";

/**
 * Mount the `/api/audit/list` (GET) route on `app`. Defers the
 * Prisma client resolution until first request.
 *
 * Pattern mirrors `mountNotificationRouter` at
 * `packages/api/src/notifications/routerWiring.ts:40-84` — takes
 * `resolvePrismaClient` as an injected dep so this file does not
 * need to know the actual location of the Prisma singleton.
 */
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
