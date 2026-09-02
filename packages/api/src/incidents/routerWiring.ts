/**
 * Lazy-resolve the production `IncidentStateRepository` and wrap
 * `buildIncidentsRouter` so the api can boot without
 * `DATABASE_URL` set. A transient DB outage at boot does NOT crash
 * the api — the wrapper rejects on first request.
 */
import express, { type Router } from "express";

import { type AuditLogger } from "../audit.js";
import { idempotency, IdempotencyStore } from "../middleware/idempotency.js";

import { type ActiveIncidentsDeps, buildActiveIncidentsRouter } from "./activeRouter.js";
import {
  type IncidentStateRepository,
  resolveIncidentStateRepository,
} from "./incidentStateRepository.js";
import {
  buildIncidentsRouter,
  type IncidentBroadcast,
  type IncidentsRouterDeps,
} from "./router.js";

import type { Server as IOServer } from "socket.io";

/** Adapter from the Socket.IO `Server` to the narrow
 *  `IncidentBroadcast` shape the router expects. */
export const buildIncidentBroadcastTarget = (io: IOServer): IncidentBroadcast => ({
  to: (room: string) => ({
    emit: (event: "incident:state_changed" | "incident:opened", payload: unknown): void => {
      io.to(room).emit(event, payload);
    },
  }),
});

/** Resolve (and cache) the narrow `IncidentStateRepository` over
 *  the production Prisma client. Returns the cached instance on
 *  subsequent calls — the boot order is "router mounts before
 *  migrations run" so the singleton must be deferred to first
 *  request. */
const buildIncidentRepoResolver = (
  resolvePrismaClient: () => Promise<unknown>,
): {
  readonly wrapper: IncidentStateRepository;
} => {
  let cached: IncidentStateRepository | null = null;
  const ensure = async (): Promise<IncidentStateRepository> => {
    if (cached === null) {
      const client = await resolvePrismaClient();
      cached = resolveIncidentStateRepository(client);
    }
    return cached;
  };

  const wrapper: IncidentStateRepository = {
    incident: {
      findUnique: async (args) => {
        const repo = await ensure();
        return repo.incident.findUnique(args);
      },
      findMany: async (args) => {
        const repo = await ensure();
        return repo.incident.findMany(args);
      },
      updateMany: async (args) => {
        const repo = await ensure();
        return repo.incident.updateMany(args);
      },
    },
    incidentEvent: {
      create: async (args) => {
        const repo = await ensure();
        return repo.incidentEvent.create(args);
      },
      findMany: async (args) => {
        const repo = await ensure();
        return repo.incidentEvent.findMany(args);
      },
    },
    notification: {
      create: async (args) => {
        const repo = await ensure();
        return repo.notification.create(args);
      },
    },
    $transaction: async <T>(cb: (tx: IncidentStateRepository) => Promise<T>): Promise<T> =>
      cb(await ensure()),
  };
  return { wrapper };
};

/** Build the production `/api/incidents` router deps + Express
 *  Router. A process-wide `IdempotencyStore` is created here so
 *  all 5 transition routes share one cache. `resolveActorUserId`
 *  lazy-upserts a `User` row on first JWT sight so audit writes
 *  do not fail with FK violations for unrecognized `sub` claims. */
export const buildIncidentsRouterMount = (input: {
  readonly audit: AuditLogger;
  readonly io: IOServer;
  readonly resolvePrismaClient: () => Promise<unknown>;
  readonly resolveActorUserId: (jwtSub: string | null) => Promise<string | null>;
}): Router => {
  const { wrapper } = buildIncidentRepoResolver(input.resolvePrismaClient);
  const idempotencyStore = new IdempotencyStore();
  const transitionDeps: IncidentsRouterDeps = {
    audit: input.audit,
    repo: wrapper,
    broadcast: buildIncidentBroadcastTarget(input.io),
    resolveActorUserId: input.resolveActorUserId,
    idempotency: idempotency(idempotencyStore),
  };
  const activeDeps: ActiveIncidentsDeps = {
    audit: input.audit,
    repo: { incident: wrapper.incident },
  };
  // Both routers carry absolute paths; mount via `app.use` once on
  // an adapter Router so the consumer doesn't track two routers.
  const adapter = express.Router();
  adapter.use(buildActiveIncidentsRouter(activeDeps));
  adapter.use(buildIncidentsRouter(transitionDeps));
  return adapter;
};
