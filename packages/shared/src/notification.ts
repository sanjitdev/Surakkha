/**
 * Notification wire types (Story 4.10 + 5.1).
 *
 * Operator-facing `NotificationPayloadSchema` and admin-facing
 * `AdminNotificationPayloadSchema` are siblings, not variants: the
 * operator-facing schema intentionally omits `acknowledgedByUserId`
 * (the operator IS the actor for their own row).
 *
 * The api-side adapters strip / keep that field per surface; the
 * reader pins the contract via the matching Zod schema at the seam.
 */
import { z } from "zod";

const ISO8601 = z.string().datetime({ offset: true });

/** Closed enumeration of notification severities. */
export const NotificationSeveritySchema = z.enum(["info", "warning", "critical"]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/** Closed enumeration of notification recipient roles. The writer's
 *  `recipientRole` pin must be one of these; the read filter is
 *  `row.recipientRole === req.user.role`. */
export const NotificationRecipientRoleSchema = z.enum([
  "Admin",
  "Operator",
  "Technician",
  "Viewer",
]);
export type NotificationRecipientRole = z.infer<typeof NotificationRecipientRoleSchema>;

/** Wire row for a `Notification`. Read by `GET /api/notifications` and
 *  consumed by the NotificationBell dropdown. `acknowledgedByUserId`
 *  is intentionally omitted — the actor's user id is implementation
 *  detail of the mark-as-read write. */
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

/** List envelope returned by `GET /api/notifications`. */
export const NotificationListEnvelopeSchema = z.object({
  notifications: z.array(NotificationPayloadSchema),
});
export type NotificationListEnvelope = z.infer<typeof NotificationListEnvelopeSchema>;

/** Admin-facing wire row (Story 5.1). Surfaces `acknowledgedByUserId`
 *  which the operator-facing schema intentionally omits. Sibling —
 *  not optional-field variant — keeps each surface's contract honest
 *  (no runtime filtering / no defensive-prop anti-pattern). */
export const AdminNotificationPayloadSchema = z.object({
  id: z.string().uuid(),
  severity: NotificationSeveritySchema,
  incidentId: z.string().uuid().nullable(),
  alertId: z.string().uuid().nullable(),
  recipientRole: NotificationRecipientRoleSchema,
  createdAt: ISO8601,
  acknowledgedAt: ISO8601.nullable(),
  acknowledgedByUserId: z.string().uuid().nullable(),
});
export type AdminNotificationPayload = z.infer<typeof AdminNotificationPayloadSchema>;

/** Admin-list envelope returned by `GET /api/notifications/admin/list`. */
export const AdminNotificationListEnvelopeSchema = z.object({
  notifications: z.array(AdminNotificationPayloadSchema),
});
export type AdminNotificationListEnvelope = z.infer<typeof AdminNotificationListEnvelopeSchema>;

/** Wire shape of the admin list's filter query params. Both web and
 *  api import this type so URL → query object contract has a single
 *  source of truth.
 *  - `severity` is the multi-select chip array (1, 2, or 3 entries);
 *    the api de-duplicates + coerces to a Prisma `in: [...]` shape.
 *  - `since` / `until` are ISO 8601 datetimes (inclusive / exclusive).
 *  - `sincePresetMs` (admin page polling): when set, the hook ignores
 *    `since` and recomputes `since = now - sincePresetMs` per fetch
 *    so the lower bound slides forward during 30s polling. */
export interface AdminNotificationFilters {
  readonly severity?: readonly NotificationSeverity[];
  readonly since?: string;
  readonly until?: string;
  readonly sincePresetMs?: number;
}
