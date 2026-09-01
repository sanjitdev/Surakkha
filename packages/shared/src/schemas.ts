/**
 * Shared wire-level schemas — UUID validation + path-param shapes.
 *
 * Single source of truth for the UUIDv4 regex and the `id` path-param
 * shape that every router consumes. Replaces three hand-rolled
 * `/^[0-9a-f]{8}-…-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-…$/i` literals that
 * lived in `api/middleware/idempotency.ts`, `api/admin/simulatorRouter.ts`,
 * and `api/ingest/server.ts` (impeccable audit, 2026-09-01 P0.1).
 *
 * The regex mirrors what `assertUuidV4` in `auth.ts:105-112` does
 * locally — moved here so the auth module imports from one place too.
 *
 * `idPathSchema` replaces 9 inline `z.object({ id: z.string().uuid() })`
 * blocks across the api routers (audit P0.2). The wire contract uses
 * `id` consistently for path params on /incidents/:id, /alerts/:id,
 * /attachments/:id, /devices/:id, /notifications/:id, /thresholds/:id;
 * if a future router needs a different key, add it next to this one.
 *
 * `UuidSchema` is the body-field form for cases like
 * `{ alert_id: "<uuid>" }` or `{ assignee_user_id: "<uuid>" }` (audit
 * P1.1).
 */
import { z } from "zod";

/**
 * RFC 4122 UUIDv4 — version nibble `4`, variant nibble `[89ab]`.
 * Case-insensitive to match what `crypto.randomUUID()` produces
 * (lowercase) AND what some downstream systems emit (uppercase).
 */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Predicate form — handy for route-param parsing before Zod. */
export const isUuidV4 = (value: unknown): value is string =>
  typeof value === "string" && UUID_V4_REGEX.test(value);

/**
 * Body-field UUID. Use for `alert_id`, `assignee_user_id`, and any
 * UUID field on a JSON body. Pairs with `idPathSchema` for path params.
 */
export const UuidSchema = z.string().uuid();

/**
 * Path-param shape for the `{ id: <uuid> }` segment every detail router
 * uses. The single canonical form — replacing 9 hand-rolled copies in
 * the api routers.
 *
 * Wire shape: `{ id: string }` where `id` is a UUIDv4. Routers consume
 * via `req.params.id` after `idPathSchema.parse(req.params)`.
 */
export const idPathSchema = z.object({ id: z.string().uuid() });
export type IdPathParams = z.infer<typeof idPathSchema>;
