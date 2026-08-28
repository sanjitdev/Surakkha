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
