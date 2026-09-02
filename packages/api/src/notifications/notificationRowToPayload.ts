/**
 * Pure adapter from a Prisma `Notification` row to the wire
 * `NotificationPayload`. Mirrors the `incidentRowToPayload` pattern.
 *
 * Two siblings: `notificationRowToPayload` (operator-facing —
 * `acknowledgedByUserId` is dropped as implementation detail) and
 * `adminNotificationRowToPayload` (admin audit lens — surfaces the
 * field for diagnostic use).
 */
import {
  type AdminNotificationPayload,
  type NotificationPayload,
} from "@surakkha/shared/notification";

import { type NotificationRow } from "./notificationRepository.js";

export const notificationRowToPayload = (row: NotificationRow): NotificationPayload => ({
  id: row.id,
  severity: row.severity,
  incidentId: row.incidentId,
  alertId: row.alertId,
  recipientRole: row.recipientRole,
  createdAt:
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString(),
  acknowledgedAt:
    row.acknowledgedAt === null
      ? null
      : row.acknowledgedAt instanceof Date
        ? row.acknowledgedAt.toISOString()
        : new Date(row.acknowledgedAt).toISOString(),
});

/** Admin-facing wire-row adapter. Surfaces `acknowledgedByUserId`
 *  for audit detail. Pair with `AdminNotificationPayloadSchema` —
 *  the schema's `safeParse` rejects a response that lacks the
 *  field (defense in depth against a future router regression that
 *  swaps the adapter back). */
export const adminNotificationRowToPayload = (row: NotificationRow): AdminNotificationPayload => ({
  id: row.id,
  severity: row.severity,
  incidentId: row.incidentId,
  alertId: row.alertId,
  recipientRole: row.recipientRole,
  createdAt:
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString(),
  acknowledgedAt:
    row.acknowledgedAt === null
      ? null
      : row.acknowledgedAt instanceof Date
        ? row.acknowledgedAt.toISOString()
        : new Date(row.acknowledgedAt).toISOString(),
  acknowledgedByUserId: row.acknowledgedByUserId,
});
