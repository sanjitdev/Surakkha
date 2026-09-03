/**
 * Notification wire types.
 *
 * Operator-facing `NotificationPayloadSchema` and admin-facing
 * `AdminNotificationPayloadSchema` are siblings, not variants: the
 * operator-facing schema intentionally omits `acknowledgedByUserId`.
 */
import { z } from "zod";

const ISO8601 = z.string().datetime({ offset: true });

/** Closed enumeration of notification severities. */
export const NotificationSeveritySchema = z.enum(["info", "warning", "critical"]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/** Closed enumeration of notification recipient roles. */
export const NotificationRecipientRoleSchema = z.enum([
  "Admin",
  "Operator",
  "Technician",
  "Viewer",
]);
export type NotificationRecipientRole = z.infer<typeof NotificationRecipientRoleSchema>;

/** Wire row for a `Notification`. Read by `GET /api/notifications`. */
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

/** Admin-facing wire row. Surfaces `acknowledgedByUserId` which the operator-facing schema intentionally omits. Sibling — not optional-field variant. */
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

/** Wire shape of the admin list's filter query params. */
export interface AdminNotificationFilters {
  readonly severity?: readonly NotificationSeverity[];
  readonly since?: string;
  readonly until?: string;
  readonly sincePresetMs?: number;
}
