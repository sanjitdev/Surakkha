/**
 * Pure adapter from a Prisma `Notification` row to the wire
 * `NotificationPayload`. Two siblings: `notificationRowToPayload`
 * (operator-facing) and `adminNotificationRowToPayload` (admin
 * audit lens — surfaces `acknowledgedByUserId`).
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

/** Admin-facing adapter. Surfaces `acknowledgedByUserId` for audit. */
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
