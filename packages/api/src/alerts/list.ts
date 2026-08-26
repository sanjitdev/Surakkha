/**
 * Pure list helpers — Story 3.5.
 *
 * Two surfaces:
 *
 *   1. `buildAlertSummary(row, linkedAlerts)` maps a Prisma `Alert`
 *      row + a `linkedAlerts[]` array (already-resolved predecessor
 *      history) to the wire `AlertSummary` shape. Snake-case keys
 *      (matches the dashboard's existing convention at
 *      `packages/api/src/incidents/recentRouter.ts:160`).
 *
 *   2. Cursor encode/decode for `(openedAt DESC, id DESC)` pagination.
 *      Wire format: base64url-encoded JSON `{ t: <ms>, i: <uuid> }`.
 *      The `id` tie-break handles same-millisecond inserts from
 *      multiple devices (per AC9 pin in
 *      `spec-3-5-alert-lifecycle.md`).
 *
 * Cursor format rationale (number ms, not ISO string): keeps the wire
 * payload compact and lossless against Postgres's `DateTime` resolution
 * (TIMESTAMP(3) — millisecond precision). The base64url alphabet
 * (`A-Z a-z 0-9 - _`) is URL-safe and matches the
 * `prisma.alert.findMany({ where: { ... < (cursor.t, cursor.i) } })`
 * row-comparison expected by Postgres.
 *
 * The decoder validates the JSON shape via Zod; base64-decode failure,
 * JSON-parse failure, and shape-mismatch failures all surface as 400
 * upstream (the router's `safeParse` handles the conversion).
 */
import { z } from "zod";

import type { AlertLinked, AlertSummary } from "@surakkha/shared";

/**
 * Minimum shape `buildAlertSummary` reads off a Prisma `Alert` row.
 * Mirrors the `select` projection the list router passes to Prisma.
 */
export interface AlertRowShape {
  readonly id: string;
  readonly deviceId: string;
  readonly ruleId: string;
  readonly severity: "info" | "warning" | "critical";
  readonly metric:
    | "ph"
    | "tds_ppm"
    | "turbidity_ntu"
    | "chlorine_ppm"
    | "temp_c"
    | "water_level_cm";
  readonly openedAt: Date;
  readonly clearedAt: Date | null;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedByUserId: string | null;
}

const toIso = (d: Date | null): string | null =>
  d === null || d === undefined ? null : d.toISOString();

/**
 * Map one Prisma `Alert` row + its predecessor list to the wire
 * `AlertSummary` shape. The `linkedAlerts` array is REQUIRED — the
 * router always populates it (closed page rows get `[]`, open page
 * rows get the batched predecessor history).
 */
export const buildAlertSummary = (
  row: AlertRowShape,
  linkedAlerts: readonly AlertLinked[],
): AlertSummary => ({
  id: row.id,
  device_id: row.deviceId,
  rule_id: row.ruleId,
  severity: row.severity,
  metric: row.metric,
  opened_at: row.openedAt.toISOString(),
  cleared_at: toIso(row.clearedAt),
  acknowledged_at: toIso(row.acknowledgedAt),
  acknowledged_by_user_id: row.acknowledgedByUserId,
  linked_alerts: linkedAlerts,
});

/**
 * Cursor payload — the decoded form of the opaque wire cursor.
 * `t` is the `openedAt` in milliseconds (Postgres TIMESTAMP(3)
 * precision); `i` is the row `id` (UUIDv4).
 */
export interface AlertCursor {
  readonly t: number;
  readonly i: string;
}

const CursorPayloadSchema = z.object({
  t: z.number().int().nonnegative(),
  i: z.string().uuid(),
});

/**
 * Encode a `(openedAt, id)` tuple as the wire cursor (base64url-encoded
 * JSON). Returns an empty string on empty input — the router should
 * never pass null values, but the defensive check keeps the helper
 * total.
 */
export const encodeCursor = (cursor: AlertCursor): string => {
  const json = JSON.stringify({ t: cursor.t, i: cursor.i });
  // `Buffer` is global in Node; the wire target is `fetch` /
  // `Response.json()` (Node 20+), so the `btoa` polyfill is unnecessary.
  return Buffer.from(json, "utf-8").toString("base64url");
};

/**
 * Decode the wire cursor back to a `(openedAt, id)` tuple. Throws
 * `ZodError` on any failure path (base64-decode, JSON parse, shape
 * mismatch) — the router catches and surfaces as 400.
 */
export const decodeCursor = (opaque: string): AlertCursor => {
  const json = Buffer.from(opaque, "base64url").toString("utf-8");
  const parsed: unknown = JSON.parse(json);
  return CursorPayloadSchema.parse(parsed);
};

/**
 * Build the next-page cursor from a page's last row. Returns `null`
 * when `rows.length < limit` (the page is the last page; no next
 * cursor). Returns the encoded cursor otherwise.
 *
 * The `id` tie-break is encoded into the cursor so a same-ms insert
 * (multiple devices firing at once) does not produce an ambiguous
 * "rows with same `t`" pagination state.
 */
export const buildNextCursor = (rows: readonly AlertRowShape[], limit: number): string | null => {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  if (last === undefined) return null;
  return encodeCursor({ t: last.openedAt.getTime(), i: last.id });
};
