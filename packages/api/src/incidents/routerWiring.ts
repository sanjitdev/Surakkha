/**
 * `routerWiring.ts` — Story 4.2.
 *
 * Wires the `/api/incidents` transition router to the production
 * Prisma client + the Socket.IO broadcast target. The wiring
 * lives in a separate file so `src/index.ts` stays under the
 * lint `max-lines: 500` ceiling (the wiring is 50+ lines on its
 * own once the lazy Prisma client + forwarder wrappers are
 * included).
 *
 * Why lazy (`ensureIncidentRepo` + cached handle):
 *   - `resolvePrismaClient()` blocks until migrations are applied
 *     (Story 2.2). The router must mount BEFORE that promise
 *     resolves; request-time resolution keeps the boot order
 *     independent.
 *   - The wrapper `incidentRepoWrapper` exposes the narrow slice
 *     `IncidentStateRepository` shape; each method is a forwarder
 *     that resolves the underlying Prisma client at request time.
 *
 * The `BroadcastTarget` adapter mirrors the shape used by 3.4's
 * `alert:opened` emit in `applyTransition.ts:189` — same `to(room)
 * .emit(event, payload)` chain.
 */

import { type AuditLogger } from "../audit.js";

import {
  type IncidentStateRepository,
  resolveIncidentStateRepository,
} from "./incidentStateRepository.js";
import {
  buildIncidentsRouter,
  type IncidentBroadcast,
  type IncidentsRouterDeps,
} from "./router.js";

import type { Router } from "express";
import type { Server as IOServer } from "socket.io";

/**
 * Adapter from the Socket.IO `Server` to the narrow
 * `IncidentBroadcast` shape the router expects.
 */
export const buildIncidentBroadcastTarget = (io: IOServer): IncidentBroadcast => ({
  to: (room: string) => ({
    emit: (event: "incident:state_changed" | "incident:opened", payload: unknown): void => {
      io.to(room).emit(event, payload);
    },
  }),
});

/**
 * Resolve (and cache) the narrow `IncidentStateRepository` over
 * the production Prisma client. Returns the cached instance on
 * subsequent calls — the boot order is "router mounts before
 * migrations run" so the singleton must be deferred to first
 * request.
 */
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

/**
 * Build the production `/api/incidents` router deps + Express
 * Router. Returns the Express Router so `src/index.ts` mounts it
 * via `app.use(router)`.
 */
export const buildIncidentsRouterMount = (input: {
  readonly audit: AuditLogger;
  readonly io: IOServer;
  readonly resolvePrismaClient: () => Promise<unknown>;
}): Router => {
  const deps: IncidentsRouterDeps = {
    audit: input.audit,
    repo: buildIncidentRepoResolver(input.resolvePrismaClient).wrapper,
    broadcast: buildIncidentBroadcastTarget(input.io),
  };
  return buildIncidentsRouter(deps);
};
