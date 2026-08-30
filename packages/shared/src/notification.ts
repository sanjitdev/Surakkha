/**
 * `notification.ts` — Story 4.10.
 *
 * Wire types for the Notification read surface. Mirrors the
 * `incident.ts:15-25` closed-enum pattern (`IncidentStateSchema`)
 * for the notification severity, and the `incident.ts:154-165`
 * pattern (`IncidentPayloadSchema`) for the wire row.
 *
 * Why a dedicated module (vs adding to `incident.ts`):
 *   - `incident.ts` is the Incident lifecycle surface; `notification.ts`
 *     is the notification surface. Cross-cutting imports would
 *     couple the two modules' RBAC + test rigs.
 *   - The notification writer (4.9) lives in
 *     `packages/api/src/notifications/notificationWriter.ts`; the
 *     read surface (4.10) is a sibling module that shares the
 *     `notification` namespace from `@prisma/client` (mirrored here).
 *
 * `recipientRole` is the role the writer pinned when the row was
 * written (Story 4.9's `recipientRole: "Operator"` pin). The bell
 * read endpoint filters by `req.user.role === row.recipientRole` so
 * the SAME writer pin is the load-bearing filter.
 *
 * The `acknowledgedByUserId` is intentionally OMITTED from the wire
 * payload (operator-facing surface; the actor is implementation
 * detail). The DB column persists the audit trail but the wire
 * row doesn't leak it.
 */
import { z } from "zod";

const ISO8601 = z.string().datetime({ offset: true });

/**
 * Closed enumeration of notification severities. Mirrors the
 * Prisma `NotificationSeverity_` enum at `packages/db/prisma/schema.prisma`
 * 1:1 (info / warning / critical). Drift between the two enums
 * is caught by the schema-drift guard at the route layer's
 * `safeParse` site.
 */
export const NotificationSeveritySchema = z.enum(["info", "warning", "critical"]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/**
 * Closed enumeration of notification recipient roles. Mirrors the
 * Prisma `NotificationRecipientRole_` enum 1:1 (Admin / Operator /
 * Technician / Viewer). The writer's `recipientRole` pin MUST be
 * one of these values; the route layer's read filter is
 * `row.recipientRole === req.user.role`.
 */
export const NotificationRecipientRoleSchema = z.enum([
  "Admin",
  "Operator",
  "Technician",
  "Viewer",
]);
export type NotificationRecipientRole = z.infer<typeof NotificationRecipientRoleSchema>;

/**
 * The wire row for a `Notification`. Read by `GET /api/notifications`
 * (Story 4.10) and consumed by the NotificationBell dropdown. Field
 * order matches the Prisma `Notification` model; the read filter
 * (`recipientRole === viewerRole` + `acknowledgedAt: null`) is
 * applied at the data layer so the wire never carries an
 * already-acknowledged row.
 *
 * `acknowledgedByUserId` is intentionally OMITTED — the actor's
 * user id is an implementation detail of the mark-as-read write
 * and is not surfaced to the operator-facing bell. The `acknowledgedAt`
 * timestamp is exposed so a future iteration can render
 * "acknowledged 2 minutes ago" affordances; v1 surfaces only
 * unread rows so the field is always `null` on the wire.
 */
export const NotificationPayloadSchema = z.object({
  id: z.string().uuid(),
  severity: NotificationSeveritySchema,
  incidentId: z.string().uuid().nullable(),
  alertId: z.string().uuid().nullable(),
  recipientRole: NotificationRecipientRoleSchema,
  createdAt: ISO8601,
  acknowledgedAt: ISO8601.nullable(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

/**
 * The list envelope returned by `GET /api/notifications`. Mirrors
 * `IncidentListEnvelope` semantics at `incident.ts:154-165` — a
 * single typed destination with the list nested under `notifications`.
 */
export const NotificationListEnvelopeSchema = z.object({
  notifications: z.array(NotificationPayloadSchema),
});
export type NotificationListEnvelope = z.infer<typeof NotificationListEnvelopeSchema>;

/**
 * Story 5.1 — the admin-facing wire row for a `Notification`.
 * Surfaces `acknowledgedByUserId` (the actor who acknowledged the
 * row) which the operator-facing `NotificationPayloadSchema`
 * intentionally OMITS. The admin surface is the audit lens —
 * the actor IS the audit trail the operator-facing bell cannot
 * see (the operator IS the actor for their own row).
 *
 * Why a SIBLING schema (vs extending the existing one):
 *
 *   - The operator-facing wire omits `acknowledgedByUserId`
 *     because the operator is the actor and shouldn't see "who
 *     else acknowledged this." Sharing the schema with an
 *     optional field would either leak it to the operator (the
 *     shared schema is the runtime check) or require runtime
 *     filtering (defensive — explicitly anti-pattern per the
 *     PR review checklist's "no defensive props" rule).
 *
 *   - A sibling schema keeps each surface's contract honest.
 *     The api-side `notificationRowToPayload` strips
 *     `acknowledgedByUserId` (operator wire); the admin adapter
 *     `adminNotificationRowToPayload` keeps it.
 *
 * The hook on the web side parses the wire response with
 * `AdminNotificationPayloadSchema` so a manually-tampered
 * response that lacks the field fails `safeParse` and surfaces
 * a useful error rather than letting `undefined` propagate.
 */
export const AdminNotificationPayloadSchema = z.object({
  id: z.string().uuid(),
  severity: NotificationSeveritySchema,
  incidentId: z.string().uuid().nullable(),
  alertId: z.string().uuid().nullable(),
  recipientRole: NotificationRecipientRoleSchema,
  createdAt: ISO8601,
  acknowledgedAt: ISO8601.nullable(),
  /**
   * Admin-only — the user id (UUID) who acknowledged the row, or
   * `null` when the row is unacknowledged. `acknowledgedByUserId`
   * is the load-bearing audit detail for Story 5.1; the operator
   * bell skips it.
   */
  acknowledgedByUserId: z.string().uuid().nullable(),
});
export type AdminNotificationPayload = z.infer<typeof AdminNotificationPayloadSchema>;

/**
 * Story 5.1 — the list envelope returned by
 * `GET /api/notifications/admin/list`. Mirrors the operator
 * envelope's `notifications` key with the admin row shape.
 */
export const AdminNotificationListEnvelopeSchema = z.object({
  notifications: z.array(AdminNotificationPayloadSchema),
});
export type AdminNotificationListEnvelope = z.infer<typeof AdminNotificationListEnvelopeSchema>;

/**
 * Story 5.1 — the wire shape of the admin list's filter query
 * params. Both web and api import this type so the URL → query
 * object contract has a single source of truth (loop 1 review
 * finding H1: previously the web and api each defined their own
 * filter type with subtly different field names; drift would have
 * been undetectable).
 *
 * `severity` is the multi-select chip array (1, 2, or 3 entries);
 * the api repeats the param as `?severity=critical&severity=warning`
 * and the router de-duplicates + coerces into a Prisma `in: [...]`
 * shape. `since` / `until` are ISO 8601 datetimes (inclusive /
 * exclusive respectively); the api parses them to `Date` before
 * the Prisma call.
 */
export interface AdminNotificationFilters {
  readonly severity?: readonly NotificationSeverity[];
  readonly since?: string;
  readonly until?: string;
  /**
   * Loop 2 hardening: a fixed-window length (ms) used to re-derive
   * `since` on every fetch. When the web hook sees this field, it
   * ignores the `since` field above and recomputes
   * `since = new Date(Date.now() - sincePresetMs).toISOString()`
   * inside `queryFn`. This makes the lower bound slide forward
   * during 30s polling; otherwise the page's `useMemo` freezes it
   * at first paint and new rows created after the window slid
   * forward are missed.
   */
  readonly sincePresetMs?: number;
}
