/**
 * `actorUserIdResolver.ts` — Story 4.2 (Patch #18 from code review 2026-08-27).
 *
 * Defense-in-depth lazy-upsert for `User` rows on first JWT sight.
 *
 * The seeded users (1 Admin + 2 Operators + 2 Technicians + 1
 * Viewer) cover the documented demo-role set, but a real
 * deployment may mint tokens for users that have not yet been
 * seeded (e.g. SSO provisioning). The `User` row is the typed
 * FK target for `Incident.assigneeUserId` + `IncidentEvent
 * .actorUserId`, so every actor that touches an incident
 * needs a corresponding `User` row.
 *
 * This helper is the **defense-in-depth** backstop: when an
 * unrecognized `sub` claim appears, we upsert a `User` row so
 * the FK does not reject the audit write. We cache the
 * resolution in-memory keyed on `sub` for `CACHE_TTL_MS` so a
 * burst of requests from the same actor hits the cache instead
 * of round-tripping to Postgres.
 *
 * Returns `null` when the JWT has no `sub` claim (anonymous
 * requests, which should have been blocked by `authenticate`
 * before reaching here — kept as a typed safety net).
 *
 * Spec: spec-4-2-incident-state-machine.md §"Lazy User upsert on
 * first JWT sight".
 *
 * Extracted from `index.ts` so the entry file stays under the
 * lint `max-lines: 500` ceiling.
 */
import { createLogger } from "@surakkha/shared/logger";

interface ActorUserIdCacheEntry {
  readonly userId: string;
  readonly cachedAt: number;
}

const ACTOR_CACHE_TTL_MS = 60_000;

const logger = createLogger({ name: "surakkha-api", level: "info" });

export const buildActorUserIdResolver = (
  resolvePrismaClient: () => Promise<unknown>,
): {
  readonly resolveActorUserId: (jwtSub: string | null) => Promise<string | null>;
} => {
  const actorCache = new Map<string, ActorUserIdCacheEntry>();
  const resolveActorUserId = async (jwtSub: string | null): Promise<string | null> => {
    if (jwtSub === null || jwtSub === "") return null;
    const cached = actorCache.get(jwtSub);
    const now = Date.now();
    if (cached !== undefined && now - cached.cachedAt < ACTOR_CACHE_TTL_MS) {
      return cached.userId;
    }
    try {
      const client = await resolvePrismaClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      // Lazy-upsert: the `id` is the JWT `sub` (UUID). When the
      // row is new, `displayName` defaults to "Unknown" — the
      // operator can rename via the future admin user-management
      // surface (deferred). `role` defaults to "Viewer" (least
      // privilege); the JWT's role claim is the authoritative
      // source until the user is promoted.
      const row = await c.user.upsert({
        where: { id: jwtSub },
        update: {},
        create: {
          id: jwtSub,
          role: "Viewer",
          displayName: "Unknown",
        },
        select: { id: true },
      });
      actorCache.set(jwtSub, { userId: row.id, cachedAt: now });
      return row.id;
    } catch (err) {
      logger.warn({ err, jwtSub }, "resolveActorUserId: upsert failed; returning sub as-is");
      // Fall back to the JWT `sub` so the audit trail still
      // captures the actor identifier even if the DB write
      // failed. Better to log an unknown actor than to drop the
      // request.
      actorCache.set(jwtSub, { userId: jwtSub, cachedAt: now });
      return jwtSub;
    }
  };
  return { resolveActorUserId };
};
