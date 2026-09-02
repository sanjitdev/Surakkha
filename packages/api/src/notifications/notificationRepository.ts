/**
 * Narrow Prisma slice for the notification read/acknowledge router.
 * Mirrors the `incidentStateRepository.ts` interface-driven + adapter
 * pattern (the `as any` cast is contained to the adapter file so
 * future Prisma drifts don't ripple into the router).
 *
 * Four methods:
 *   - `findMany(args)` — operator-facing read (filters by
 *     `recipientRole + acknowledgedAt: null`).
 *   - `findManyAdmin(args)` — admin audit-lens read (drops both
 *     operator filters; severity uses `in: [...]`).
 *   - `findUnique(args)` — PATCH pre-fetch before the cross-role RBAC.
 *   - `updateMany(args)` — compare-and-set ack (idempotent on
 *     already-acknowledged rows via `acknowledgedAt: null` predicate).
 */
import type {
  NotificationRecipientRole,
  NotificationSeverity,
} from "@surakkha/shared/notification";

/** The full state of a single `Notification` row. Mirrors the
 *  wire-row shape (`NotificationPayload`) but with Date objects. */
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

/** Admin filter shape. Drops two filters the operator-facing read
 *  applies:
 *    - `recipientRole` — the admin is the audit lens.
 *    - `acknowledgedAt: null` — admin sees the full trail.
 *  `severity` uses Prisma's `in: [...]` IN-list. `since` / `until`
 *  are inclusive lower / exclusive upper bounds; nullish →
 *  unbounded. */
export interface AdminNotificationFilters {
  readonly severity?: {
    readonly in: readonly NotificationSeverity[];
  };
  readonly since?: Date;
  readonly until?: Date;
}

/** Narrow slice of `@prisma/client.notification` that the router
 *  consumes. The writer owns its own narrow slice
 *  (`NotificationWriterRepository`). */
export interface NotificationRepository {
  readonly notification: {
    findMany(args: {
      readonly where: {
        readonly recipientRole: NotificationRecipientRole;
        readonly acknowledgedAt: null;
      };
      readonly orderBy: { readonly createdAt: "desc" };
      readonly take: number;
    }): Promise<NotificationRow[]>;
    findManyAdmin(args: {
      readonly where: AdminNotificationFilters;
      readonly orderBy: { readonly createdAt: "desc" };
      readonly take: number;
    }): Promise<NotificationRow[]>;
    findUnique(args: { readonly where: { readonly id: string } }): Promise<NotificationRow | null>;
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

/** Adapter — narrow the real `@prisma/client` to the
 *  `NotificationRepository` slice.
 *
 *  `findManyAdmin` is a Prisma extension method. If a future
 *  Prisma regeneration drops it (or a test stub doesn't define it),
 *  fail loud — silently falling back to `findMany` would apply the
 *  operator-facing filters the admin endpoint explicitly DROPS. */
export const resolveNotificationRepository = (prisma: unknown): NotificationRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  if (client.notification.findManyAdmin === undefined) {
    throw new Error(
      "Prisma client missing `notification.findManyAdmin` extension; run `prisma generate` against the Story 5.1 schema.",
    );
  }
  return {
    notification: {
      findMany: (args) => client.notification.findMany(args) as Promise<NotificationRow[]>,
      findManyAdmin: (args) =>
        client.notification.findManyAdmin(args) as Promise<NotificationRow[]>,
      findUnique: (args) => client.notification.findUnique(args) as Promise<NotificationRow | null>,
      updateMany: (args) =>
        client.notification.updateMany(args) as Promise<{ readonly count: number }>,
    },
  };
};

// Re-export the wire-row helper from its dedicated module so the
// repository module remains a single import surface for consumers
// that want both the data slice and the wire adapter.
export {
  adminNotificationRowToPayload,
  notificationRowToPayload,
} from "./notificationRowToPayload.js";
