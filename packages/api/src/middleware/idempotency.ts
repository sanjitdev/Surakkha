/**
 * Idempotency-Key middleware — closes api critique P1 #2.
 *
 * Caches the response (status + body) per `(user_id, route, key)` tuple
 * for `IDEMPOTENCY_TTL_MS`. A duplicate POST with the same key within
 * the window replays the cached response byte-for-byte, so a flaky-network
 * double-tap from "Rahim the Operator" cannot run the same state transition
 * twice (which would otherwise produce two `IncidentEvent` rows, two
 * `rbac_allowed` audit emits, and two `incident:state_changed` socket
 * broadcasts).
 *
 * I-9 single-process assumption: state lives in process memory. Same as
 * `PerDeviceRateLimiter` / `PerDeviceSequence` in `packages/api/src/ingest/`.
 * A v2 PR can move the cache to Postgres if multi-process scaling lands.
 *
 * Wire contract:
 *
 *   idempotency(store?)(req, res, next)
 *     - Reads `Idempotency-Key: <UUIDv4>` header.
 *     - Missing header → pass-through (the route is already idempotent
 *       by machinery — the state machine itself rejects `OPEN → ACKNOWLEDGED`
 *       twice on the same incident because the second call sees the post-
 *       transition state).
 *     - Malformed key (non-UUIDv4) → 400 `{ error: "invalid_idempotency_key" }`.
 *     - Cache hit (key seen within TTL) → replay cached status + body.
 *     - Cache miss → wrap `res.json` to capture the outbound body, then
 *       `next()`. After the handler responds we record the (status, body)
 *       tuple for any 2xx/4xx response. 5xx responses are NOT cached so
 *       transient failures don't poison the cache.
 *
 *   IdempotencyStore class
 *     - In-memory Map + TTL eviction. Mirrors `PerDeviceRateLimiter` shape.
 *     - `reset()` is the test-only wipe hook.
 *
 * Web client follow-up (out of scope for this PR):
 *   - Generate keys via `crypto.randomUUID()` on the transition-fetch
 *     callsite in `packages/web/src/components/IncidentCard.tsx` and attach
 *     as `Idempotency-Key`. Until that ships, transition routes see no
 *     `Idempotency-Key` header and pass through unchanged.
 */
import { ERROR_CODES } from "../errors.js";
import { HTTP_BAD_REQUEST, HTTP_STATUS_MAX_CACHEABLE } from "../httpStatus.js";

import { type AuthorizedRequest } from "./authorize";

import type { NextFunction, Request, RequestHandler, Response } from "express";

const IDEMPOTENCY_TTL_MS = 300_000; // 5 minutes

// RFC 4122 UUID v4 — `4` in the version nibble, [89ab] in the variant nibble.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CachedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly expiresAtMs: number;
}

/**
 * Process-local cache of `(user_id, route, key) → (status, body, expiresAt)`.
 * Backed by `Map` for O(1) lookup + TTL eviction on access.
 *
 * State lives in process memory (I-9 single-process assumption).
 */
export class IdempotencyStore {
  private readonly cache = new Map<string, CachedResponse>();

  /**
   * Look up a cached response. Returns `null` if no entry, or if the
   * entry has expired (auto-evicts on access so the cache stays bounded).
   */
  lookup(key: string, nowMs: number): CachedResponse | null {
    const entry = this.cache.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAtMs <= nowMs) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  /** Record a fresh response for the given cache key. */
  // eslint-disable-next-line max-params
  record(key: string, status: number, body: unknown, nowMs: number): void {
    this.cache.set(key, { status, body, expiresAtMs: nowMs + IDEMPOTENCY_TTL_MS });
  }

  /** Test-only: wipe state between cases. Mirrors `PerDeviceRateLimiter.reset`. */
  reset(): void {
    this.cache.clear();
  }
}

/**
 * Default process-wide singleton. Created once at module load; the
 * `IncidentsRouterDeps` bag passes the same instance to every transition
 * route via the factory below.
 */
const defaultStore = new IdempotencyStore();

/**
 * `nowMs` is a parameter (instead of `Date.now()`) so tests can drive
 * the TTL window without freezing real time — same pattern as
 * `PerDeviceRateLimiter.tryAccept(deviceId, nowMs)`.
 */
export const idempotency =
  (store: IdempotencyStore = defaultStore, nowMs: () => number = Date.now): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const headerRaw = req.headers["idempotency-key"];
    const header = typeof headerRaw === "string" ? headerRaw : undefined;
    if (header === undefined || header === "") {
      next();
      return;
    }

    if (!UUID_V4_RE.test(header)) {
      res.status(HTTP_BAD_REQUEST).json({ error: ERROR_CODES.INVALID_IDEMPOTENCY_KEY.value });
      return;
    }

    const areq = req as AuthorizedRequest;
    const userId = areq.user?.id;
    if (userId === undefined) {
      // Should not happen — `authorize()` ran first. Pass through to avoid
      // masking the underlying 401/403 chain.
      next();
      return;
    }

    const cacheKey = `${userId}|${req.method}|${req.path}|${header}`;
    const cached = store.lookup(cacheKey, nowMs());
    if (cached !== null) {
      res.status(cached.status).json(cached.body);
      return;
    }

    // Wrap `res.json` to capture the outbound body before sending. After
    // the handler resolves, we record (status, body) for any 2xx/4xx
    // response — 5xx is excluded so transient failures don't poison the
    // cache (the client should be allowed to retry on 5xx with the same key).
    const originalJson = res.json.bind(res);
    // The cast to `any` is unavoidable — Express's `res.json` overload
    // returns `Response` only in newer typings, and we need a wider
    // body type to cache whatever the handler emitted.
    // `no-param-reassign` is suppressed: mutating `res.json` is the
    // idiomatic Express pattern for response-shape interception.
    // eslint-disable-next-line no-param-reassign, @typescript-eslint/no-explicit-any
    res.json = (body: any): Response => {
      if (res.statusCode >= 200 && res.statusCode < HTTP_STATUS_MAX_CACHEABLE) {
        store.record(cacheKey, res.statusCode, body, nowMs());
      }
      return originalJson(body);
    };

    next();
  };

export { IDEMPOTENCY_TTL_MS };
