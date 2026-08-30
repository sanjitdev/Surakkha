/**
 * `alerts/wiring.ts` — distilled 2026-08-30 (was inline in
 * `src/index.ts:326-414`).
 *
 * Lazy-resolved wiring for `/api/alerts/:alert_id/acknowledge` +
 * `GET /api/alerts`. Mirrors the pattern at
 * `notifications/routerWiring.ts` + `incidents/routerWiring.ts`:
 * the router is mounted at boot with a forwarder-shaped deps
 * object that resolves Prisma on first request. A transient DB
 * outage at boot does NOT crash the api.
 *
 * Why a separate file: `src/index.ts` was past the `max-lines:
 * 500` ESLint ceiling (842 lines pre-distillation). The alert
 * wrappers (broadcast target + two forwarder wrappers + cached
 * prisma) were 90 lines on their own.
 *
 * The `BroadcastTarget` adapter (formerly `alertBroadcastTarget`)
 * adapts the full Socket.IO server to the `alert:acknowledged`
 * emit shape the router expects (`to(room).emit(event, payload)`
 * — same shape as 3.4's `alert:opened` emit in
 * `applyTransition.ts:189`).
 */
import { type Express } from "express";
import { type Server as IOServer } from "socket.io";

import { type AuditLogger } from "../audit.js";

import {
  type AlertAcknowledgeRepository,
  buildAlertAcknowledgeRouter,
  resolveAlertAcknowledgeRepository,
} from "./acknowledgeRouter.js";
import {
  type AlertListRepository,
  buildAlertListRouter,
  resolveAlertListRepository,
} from "./listRouter.js";

/**
 * Adapter from the full Socket.IO server to the narrow broadcast
 * shape the acknowledge router expects.
 */
const buildAlertBroadcastTarget = (io: IOServer) => ({
  to: (room: string) => ({
    emit: (event: string, payload: unknown): void => {
      io.to(room).emit(event, payload);
    },
  }),
});

/**
 * Resolve (and cache) the narrow `AlertAcknowledgeRepository`
 * + `AlertListRepository` over the production Prisma client.
 * Returns forwarder wrappers that resolve the underlying Prisma
 * client at request time.
 */
export const mountAlertRouters = (input: {
  readonly app: Express;
  readonly audit: AuditLogger;
  readonly resolvePrismaClient: () => Promise<unknown>;
  readonly io: IOServer;
}): void => {
  const { app, audit, resolvePrismaClient, io } = input;

  let cachedRepos: {
    readonly ack: AlertAcknowledgeRepository;
    readonly list: AlertListRepository;
  } | null = null;

  const ensureRepos = async (): Promise<{
    readonly ack: AlertAcknowledgeRepository;
    readonly list: AlertListRepository;
  }> => {
    if (cachedRepos === null) {
      const client = await resolvePrismaClient();
      cachedRepos = {
        ack: resolveAlertAcknowledgeRepository(client),
        list: resolveAlertListRepository(client),
      };
    }
    return cachedRepos;
  };

  // Forwarder wrapper for the acknowledge router. Each method
  // awaits the resolve-on-first-use chain then forwards to the
  // typed adapter. The cast at the bottom keeps the type narrow
  // so the router doesn't see the full Prisma client.
  const ackWrapper = {
    alert: {
      updateMany: async (args: unknown) => {
        const { ack } = await ensureRepos();
        return ack.alert.updateMany(
          args as Parameters<AlertAcknowledgeRepository["alert"]["updateMany"]>[0],
        );
      },
      findUnique: async (args: unknown) => {
        const { ack } = await ensureRepos();
        return ack.alert.findUnique(
          args as Parameters<AlertAcknowledgeRepository["alert"]["findUnique"]>[0],
        );
      },
    },
  };

  const listWrapper = {
    alert: {
      findMany: async (args: unknown) => {
        const { list } = await ensureRepos();
        return list.alert.findMany(args as Parameters<AlertListRepository["alert"]["findMany"]>[0]);
      },
    },
  };

  app.use(
    buildAlertAcknowledgeRouter({
      audit,
      broadcast: buildAlertBroadcastTarget(io),
      now: () => new Date(),
      // The wrapper conforms to `AlertAcknowledgeRepository` by
      // construction (every required method present with the
      // same signature); the cast at the boundary keeps the type
      // narrow.
      prisma: ackWrapper as unknown as Parameters<typeof buildAlertAcknowledgeRouter>[0]["prisma"],
    }),
  );
  app.use(
    buildAlertListRouter({
      audit,
      prisma: listWrapper as unknown as Parameters<typeof buildAlertListRouter>[0]["prisma"],
    }),
  );
};
