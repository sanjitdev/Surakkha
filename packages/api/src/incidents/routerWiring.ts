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
 *
 * Idempotency (Story 4.x — critique P1 #2): the transition router
 * reads `Idempotency-Key: <UUIDv4>` from each request and replays
 * the cached response on duplicate keys within `IDEMPOTENCY_TTL_MS`
 * (5 minutes). The `IdempotencyStore` singleton is created here so
 * every transition route in this process shares one cache. See
 * `../middleware/idempotency.ts`.
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

/**
 * Build the production `/api/incidents` router deps + Express
 * Router. Returns the Express Router so `src/index.ts` mounts it
 * via `app.use(router)`.
 *
 * Patch (code review 2026-08-27 #18): thread
 * `resolveActorUserId` from `index.ts` so the transition handler
 * can lazy-upsert a `User` row on first JWT sight (defense-in-
 * depth against FK violations on audit writes for users that
 * have not yet been seeded).
 *
 * Story 4.3 — the mount also wires the `/api/incidents/active`
 * read router (the Kanban feed) into the same router group. Both
 * routers share the same lazy Prisma wrapper via the
 * `IncidentStateRepository` slice, so a single `ensure()` call
 * resolves the client on first request; the active router only
 * needs the `incident.findMany` method and is mounted
 * independently to keep its dependency surface narrow (no
 * `incidentEvent` / `notification` access).
 *
 * Idempotency (Story 4.x — critique P1 #2): a process-wide
 * `IdempotencyStore` is created here so all 5 transition routes
 * share one cache. `idempotency(store)` wraps `res.json` to
 * capture the outbound body for replay on duplicate keys.
 */
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
  // Both routers carry absolute paths (`/api/incidents/active` and
  // `/api/incidents/:id/...`), so they must be mounted via `app.use`
  // individually — wrapping them in a parent `Router` would
  // double-prefix the path. We return a small adapter Router that
  // delegates to both; the consumer calls `app.use(router)` once
  // (mirrors the original single-router contract).
  //
  // Why an adapter Router (not a sibling `buildActiveMount`): the
  // index.ts wiring site already calls `app.use(buildIncidentsRouterMount(...))`.
  // Splitting the mounts would force index.ts to track two separate
  // routers + their relative ordering (active before transition is
  // irrelevant — the paths don't collide — but it's a footgun).
  const adapter = express.Router();
  adapter.use(buildActiveIncidentsRouter(activeDeps));
  adapter.use(buildIncidentsRouter(transitionDeps));
  return adapter;
};
