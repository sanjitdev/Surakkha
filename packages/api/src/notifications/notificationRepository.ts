/**
 * `notificationRepository.ts` — Story 4.10.
 *
 * The narrow Prisma slice the notification read/acknowledge router
 * needs. Mirrors the 4.4 `incidentStateRepository.ts:77-166` pattern
 * (interface-driven + adapter that narrows the real `@prisma/client`
 * via `as any` cast).
 *
 * Three methods:
 *
 *   - `findMany(args)` — read path. Filters by `recipientRole +
 *     acknowledgedAt: null` at the SQL level. Ordered by `createdAt
 *     DESC` so the dropdown lists newest first. Bounded by `take`
 *     to keep the wire payload small (no pagination in v1 — see
 *     spec "Ask First: pagination").
 *
 *   - `findUnique(args)` — used by the PATCH handler to fetch the
 *     targeted row before the cross-role RBAC check
 *     (`row.recipientRole !== req.user.role → 403`).
 *
 *   - `update(args)` — used by the PATCH handler to record
 *     `acknowledgedAt + acknowledgedByUserId`. Idempotent on
 *     already-acknowledged rows: the router's
 *     `update.count === 0` branch treats the row as a no-op
 *     (returns 200 with the existing values, NOT a 409).
 *
 * Why a narrow slice (vs importing the full `@prisma/client`):
 *
 *   - The router's test rig injects stubs that satisfy only the
 *     methods this file declares — no transitive surface area
 *     leaks into the test rig (mirrors the `incidentStateRepository`
 *     pattern).
 *
 *   - Future schema drift in unrelated `Notification` columns does
 *     not ripple into the router (the adapter's `as any` is the
 *     single typed seam).
 *
 *   - The interface is the contract between the router and the
 *     data layer; production narrows via `resolveNotificationRepository`,
 *     unit tests inject a hand-rolled stub.
 */
import type {
  NotificationRecipientRole,
  NotificationSeverity,
} from "@surakkha/shared/notification";

/**
 * The full state of a single `Notification` row. Mirrors the wire-
 * row shape (`NotificationPayload`) but with Date objects (the
 * Prisma client returns Date, not ISO 8601). Conversion to wire
 * happens in the route layer via `notificationRowToPayload`.
 */
export interface NotificationRow {
  readonly id: string;
  readonly severity: NotificationSeverity;
  readonly incidentId: string | null;
  readonly alertId: string | null;
  readonly recipientRole: NotificationRecipientRole;
  readonly createdAt: Date;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedByUserId: string | null;
}

/**
 * Narrow slice of `@prisma/client.notification` that the
 * notification router consumes.
 *
 * Methods NOT exposed here are intentionally out of scope for the
 * router — the writer (4.9) owns its own narrow slice
 * (`NotificationWriterRepository` at
 * `packages/api/src/notifications/notificationWriter.ts:58-76`).
 */
export interface NotificationRepository {
  readonly notification: {
    /**
     * Story 4.10 — read path for `GET /api/notifications`. Filters
     * by `recipientRole` (matches the writer's `recipientRole` pin
     * — `req.user.role` for v1) and `acknowledgedAt: null` so the
     * wire payload never carries an already-acknowledged row.
     * Ordered by `createdAt DESC` so the dropdown lists newest
     * first; bounded by `take: 50` to keep the wire payload small
     * (no pagination in v1).
     */
    findMany(args: {
      readonly where: {
        readonly recipientRole: NotificationRecipientRole;
        readonly acknowledgedAt: null;
      };
      readonly orderBy: { readonly createdAt: "desc" };
      readonly take: number;
    }): Promise<NotificationRow[]>;
    /**
     * Story 4.10 — read path used by the PATCH handler before the
     * cross-role RBAC check. Returns the full row including
     * `acknowledgedAt` + `acknowledgedByUserId` so the router can
     * distinguish the first-ack path from the idempotent
     * re-ack path.
     */
    findUnique(args: { readonly where: { readonly id: string } }): Promise<NotificationRow | null>;
    /**
     * Story 4.10 — compare-and-set update for the PATCH handler.
     * The `acknowledgedAt: null` predicate is the serialization
     * point: a row already acknowledged by a concurrent actor
     * returns `count: 0`, which the router maps to the idempotent
     * re-ack path (200 with the existing values, NOT 409).
     */
    updateMany(args: {
      readonly where: {
        readonly id: string;
        readonly acknowledgedAt: null;
      };
      readonly data: {
        readonly acknowledgedAt: Date;
        readonly acknowledgedByUserId: string;
      };
    }): Promise<{ readonly count: number }>;
  };
}

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `NotificationRepository` slice. Mirrors
 * `resolveIncidentStateRepository` at
 * `packages/api/src/incidents/incidentStateRepository.ts:172-191`.
 * The `as any` cast is contained to this file so future Prisma
 * type drifts do not ripple into the router.
 */
export const resolveNotificationRepository = (prisma: unknown): NotificationRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    notification: {
      findMany: (args) => client.notification.findMany(args) as Promise<NotificationRow[]>,
      findUnique: (args) => client.notification.findUnique(args) as Promise<NotificationRow | null>,
      updateMany: (args) =>
        client.notification.updateMany(args) as Promise<{ readonly count: number }>,
    },
  };
};

// Re-export the wire-row helper from its dedicated module
// (`./notificationRowToPayload.ts`) so the repository module remains
// a single import surface for consumers that want both the data
// slice and the wire adapter (mirrors how `incidentStateRepository.ts`
// houses `incidentRowToPayload`).
export { notificationRowToPayload } from "./notificationRowToPayload.js";
