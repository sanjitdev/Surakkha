/**
 * Idempotency-Key middleware. Caches (status, body) per
 * `(user_id, method, path, key)` for `IDEMPOTENCY_TTL_MS`. Missing
 * header → pass-through; malformed key → 400; 5xx NOT cached.
 */
import { isUuidV4 } from "@surakkha/shared";

import { ERROR_CODES } from "../errors.js";
import { HTTP_BAD_REQUEST, HTTP_STATUS_MAX_CACHEABLE } from "../httpStatus.js";

import { type AuthorizedRequest } from "./authorize";

import type { NextFunction, Request, RequestHandler, Response } from "express";

const IDEMPOTENCY_TTL_MS = 300_000; // 5 minutes

interface CachedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly expiresAtMs: number;
}

/** Process-local cache of `(user_id, method, path, key) → (status,
 *  body, expiresAt)`. Backed by `Map` for O(1) lookup + TTL
 *  eviction on access. */
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

/** Default process-wide singleton. The `IncidentsRouterDeps` bag
 *  passes the same instance to every transition route via the
 *  factory below. */
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

    if (!isUuidV4(header)) {
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

    // Wrap `res.json` to capture the outbound body for any
    // 2xx/4xx response. 5xx is excluded so transient failures
    // don't poison the cache (client retries on 5xx with the
    // same key must NOT replay a 500).
    const originalJson = res.json.bind(res);
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
