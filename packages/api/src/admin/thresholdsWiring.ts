/**
 * Lazy-resolved wiring for the `/admin/thresholds` admin tab.
 * Mirrors the pattern at `notifications/routerWiring.ts` +
 * `incidents/routerWiring.ts`: the router is mounted at boot
 * with a forwarder-shaped deps object that resolves Prisma on
 * first request. A transient DB outage at boot does NOT crash
 * the api.
 */
import { type Express } from "express";

import { type AuditLogger } from "../audit.js";

import {
  buildThresholdsRouter,
  resolveThresholdsRepository,
  type ThresholdsRepository,
} from "./thresholdsRouter.js";

export const mountThresholdsRouter = (input: {
  readonly app: Express;
  readonly audit: AuditLogger;
  readonly resolvePrismaClient: () => Promise<unknown>;
}): void => {
  const { app, audit, resolvePrismaClient } = input;

  let cachedRepo: ThresholdsRepository | null = null;

  const ensureRepo = async (): Promise<ThresholdsRepository> => {
    if (cachedRepo === null) {
      const client = await resolvePrismaClient();
      cachedRepo = resolveThresholdsRepository(client);
    }
    return cachedRepo;
  };

  // Forwarder-shaped ThresholdsRepository. Every method awaits
  // the first-use Prisma resolution then forwards to the typed
  // adapter. The router's per-handler try/catch surfaces a DB-down
  // response as 500.
  const repoWrapper: ThresholdsRepository = {
    rule: {
      findMany: async (args) => {
        const repo = await ensureRepo();
        return repo.rule.findMany(args);
      },
      findUnique: async (args) => {
        const repo = await ensureRepo();
        return repo.rule.findUnique(args);
      },
      create: async (args) => {
        const repo = await ensureRepo();
        return repo.rule.create(args);
      },
      update: async (args) => {
        const repo = await ensureRepo();
        return repo.rule.update(args);
      },
    },
    $transaction: async <T>(cb: (tx: ThresholdsRepository) => Promise<T>): Promise<T> =>
      cb(await ensureRepo()),
  };

  app.use("/admin/thresholds", buildThresholdsRouter({ audit, repo: repoWrapper }));
};
