/**
 * Shared wire-level schemas — UUID validation + path-param shapes.
 * `idPathSchema` replaces inline `z.object({ id: z.string().uuid() })`
 * blocks across api routers; add a sibling schema here when a future
 * router needs a different path-param key.
 */
import { z } from "zod";

/** RFC 4122 UUIDv4 — version nibble `4`, variant nibble `[89ab]`.
 *  Case-insensitive: `crypto.randomUUID()` emits lowercase; some
 *  downstream systems emit uppercase. */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Predicate form for route-param parsing before Zod. */
export const isUuidV4 = (value: unknown): value is string =>
  typeof value === "string" && UUID_V4_REGEX.test(value);

/** Body-field UUID — `alert_id`, `assignee_user_id`, etc. Pairs with
 *  `idPathSchema` for path params. */
export const UuidSchema = z.string().uuid();

/** Path-param shape for the `{ id: <uuid> }` segment every detail
 *  router consumes. */
export const idPathSchema = z.object({ id: z.string().uuid() });
export type IdPathParams = z.infer<typeof idPathSchema>;
