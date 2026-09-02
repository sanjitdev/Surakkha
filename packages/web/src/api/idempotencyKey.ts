/**
 * Generates a fresh RFC 4122 v4 UUID per call. The DOM lib provides
 * `crypto.randomUUID()` natively in TS 5.5+ and all evergreen
 * browsers since 2022 — no polyfill is shipped.
 */
export const newIdempotencyKey = (): string => crypto.randomUUID();
