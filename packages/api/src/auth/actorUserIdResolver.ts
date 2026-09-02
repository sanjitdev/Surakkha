/**
 * `actorUserIdResolver.ts` — defense-in-depth lazy-upsert for `User`
 * rows on first JWT sight. Returns `null` for anonymous requests
 * (blocked upstream by `authenticate`; typed safety net here).
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
      // Fall back to the JWT `sub` so the audit trail still captures
      // the actor identifier even if the DB write failed.
      actorCache.set(jwtSub, { userId: jwtSub, cachedAt: now });
      return jwtSub;
    }
  };
  return { resolveActorUserId };
};
