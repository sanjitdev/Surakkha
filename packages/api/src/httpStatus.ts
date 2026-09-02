/** Canonical HTTP status codes for the api. */
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

/** Highest status safe to cache in the idempotency replay store; 5xx excluded so retries hit the api again. */
export const HTTP_STATUS_MAX_CACHEABLE = 500;
