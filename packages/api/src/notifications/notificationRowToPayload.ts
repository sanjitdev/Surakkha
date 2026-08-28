/**
 * `notificationRowToPayload.ts` — Story 4.10.
 *
 * Pure adapter from a Prisma `Notification` row to the wire
 * `NotificationPayload` (defined in
 * `@surakkha/shared/notification`). Mirrors
 * `incidentRowToPayload` at
 * `packages/api/src/incidents/incidentStateRepository.ts:341-365` —
 * the canonical "row-to-payload" pattern in this codebase.
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
 *     wire payload (operator-facing surface; the actor is
 *     implementation detail). The DB column persists the audit
 *     trail; the wire row never leaks it.
 */
import { type NotificationPayload } from "@surakkha/shared/notification";

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
