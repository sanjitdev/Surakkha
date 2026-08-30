/**
 * `notificationRowToPayload.ts` — Story 4.10 + Story 5.1.
 *
 * Pure adapter from a Prisma `Notification` row to the wire
 * `NotificationPayload` (defined in
 * `@surakkha/shared/notification`). Mirrors
 * `incidentRowToPayload` at
 * `packages/api/src/incidents/incidentStateRepository.ts:341-365` —
 * the canonical "row-to-payload" pattern in this codebase.
 *
 * Story 5.1 adds a sibling adapter `adminNotificationRowToPayload`
 * that surfaces `acknowledgedByUserId` (audit detail). The operator-
 * facing `notificationRowToPayload` keeps the field stripped.
 *
 * Why a separate module (vs living inside
 * `notificationRepository.ts`):
 *
 *   - The adapter is a PURE HELPER with no IO and no Prisma
 *     dependency at runtime — it could be invoked from any
 *     layer that holds a `NotificationRow`. Splitting it out
 *     keeps the repository module's surface narrow (the data
 *     slice only) while this module owns the wire shape.
 *
 *   - The 4.4 incident detail page's `incidentEventRowToPayload`
 *     follows the same pattern (separate module, lives next to
 *     the repository). Mirroring the convention keeps the
 *     cross-story code review surface uniform.
 *
 *   - `acknowledgedByUserId` is intentionally DROPPED from the
 *     operator-facing wire payload (operator-facing surface; the
 *     actor is implementation detail). The DB column persists
 *     the audit trail; the wire row never leaks it.
 */
import {
  type AdminNotificationPayload,
  type NotificationPayload,
} from "@surakkha/shared/notification";

import { type NotificationRow } from "./notificationRepository.js";

/**
 * Build the wire-row `NotificationPayload` from a Prisma
 * `Notification` row.
 */
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

/**
 * Story 5.1 — the admin-facing wire-row adapter. Identical to
 * `notificationRowToPayload` EXCEPT it surfaces
 * `acknowledgedByUserId` (audit detail). The admin list endpoint
 * pairs this with `AdminNotificationPayloadSchema` so the wire
 * contract is structural — the schema's `safeParse` rejects a
 * response that lacks the field (defense in depth against a
 * future router regression that swaps the adapter back).
 *
 * Lives in the same module as `notificationRowToPayload` (vs a
 * separate file) because both adapters share the same
 * `NotificationRow → wire` shape and the cross-cutting comment
 * about `acknowledgedByUserId` stays in one place. The PR review
 * checklist's "sibling adapters in the same module" convention
 * matches the active-router / incidents-router split.
 */
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
