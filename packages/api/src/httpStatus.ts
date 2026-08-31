/**
 * Canonical HTTP status codes — single source of truth for the api.
 *
 * The 2026-08-31 api polish pass surfaced that 12 routers each re-declared
 * their own `const HTTP_OK = 200` block (~55 declarations in total). The
 * literals are drift-safe today (TypeScript catches typos in `res.status`),
 * but the duplication is a low-grade AI-slop signature: each new router
 * has been copy-pasting the same five-line block from the prior one.
 *
 * This module is the canonical home. Importing routers get exactly one
 * place to update if the contract changes (e.g., if we ever need to
 * document "every 500 returns X-Trace-Id" or similar).
 *
 * Scope: api-internal only. The web package never sees these.
 */
export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_NO_CONTENT = 204;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_INTERNAL_ERROR = 500;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * The highest status code that's safe to cache in the Idempotency-Key
 * replay store. 5xx is excluded because we don't want to memoize a
 * server error — a retry should hit the api again.
 *
 * Lives here rather than in `middleware/idempotency.ts` so the constant
 * is discoverable alongside the rest of the status vocabulary.
 */
export const HTTP_STATUS_MAX_CACHEABLE = 500;
