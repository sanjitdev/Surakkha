/**
 * `notificationAdminExtension` — Prisma client extension that adds
 * `notification.findManyAdmin(args)` as a pure wrapper around
 * `notification.findMany` with the admin-lens filters applied.
 *
 * Why an extension (rather than the prior hand-rolled adapter)?
 * -------------------------------------------------------------
 * `notifications/notificationRepository.ts:resolveNotificationRepository`
 * does a runtime `client.notification.findManyAdmin === undefined`
 * guard and throws when missing. The throw is deliberate — silently
 * falling back to `findMany` would re-introduce the operator-shaped
 * filters the admin endpoint explicitly DROPS, which is exactly
 * what the spec at `notificationRouter.spec.ts:731` pins. So the
 * fix is to make `findManyAdmin` actually exist at runtime.
 *
 * Prisma 5.x's `$extends({ model: ... })` lets us attach a custom
 * method to `notification`. The wrapper calls the underlying
 * `findMany` with the same shape the admin router uses
 * (`{ where: filters, orderBy, take }`); the inner `findMany` already
 * knows the schema, so we forward the args directly. No transaction
 * wrapper, no relation traversal — admin queries are flat reads.
 *
 * Why this lives in `boot/` (not `notifications/`)?
 * --------------------------------------------------
 * `boot/db.ts` is the single source of truth for `getPrisma()`. The
 * extension must be applied EXACTLY ONCE at client construction —
 * otherwise a re-apply creates a new extended client and downstream
 * `client.notification.findManyAdmin` typings diverge from the
 * underlying model. Keeping the extension definition next to
 * `getPrisma()` makes the "applied once" invariant obvious.
 */
import { Prisma } from "@prisma/client";

import type { AdminNotificationFilters } from "../notifications/notificationRepository.js";

/**
 * Map an admin-lens time bound (`since` / `until`) onto Prisma's
 * `createdAt: { gte, lt }` filter shape. Returns `undefined` when
 * neither bound is set so the caller can skip the `createdAt` key
 * entirely.
 */
const buildCreatedAtFilter = (
  where: AdminNotificationFilters | undefined,
): { gte?: Date; lt?: Date } | undefined => {
  if (where?.since === undefined && where?.until === undefined) {
    return undefined;
  }
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (where?.since !== undefined) createdAt.gte = where.since;
  if (where?.until !== undefined) createdAt.lt = where.until;
  return createdAt;
};

/**
 * Translate the admin-lens filter shape (`AdminNotificationFilters`)
 * into the underlying Prisma `NotificationWhereInput`. The two
 * diverge on the time bounds — admin `since` / `until` map onto
 * `createdAt: { gte, lt }`. Severity passes through unchanged
 * (`{ in: [...] }` is the same shape on both sides).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildPrismaWhere = (where: AdminNotificationFilters | undefined): Record<string, any> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaWhere: Record<string, any> = {};
  if (where?.severity !== undefined) {
    prismaWhere["severity"] = where.severity;
  }
  const createdAt = buildCreatedAtFilter(where);
  if (createdAt !== undefined) {
    prismaWhere["createdAt"] = createdAt;
  }
  return prismaWhere;
};

export const notificationAdminExtension = Prisma.defineExtension((client) =>
  client.$extends({
    model: {
      notification: {
        findManyAdmin(args: {
          readonly where?: AdminNotificationFilters;
          readonly orderBy?: { readonly createdAt: "desc" };
          readonly take?: number;
        }) {
          const prismaWhere = buildPrismaWhere(args.where);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (client.notification as any).findMany({
            where: prismaWhere,
            orderBy: args.orderBy,
            take: args.take,
          });
        },
      },
    },
  }),
);

/** The extended client type — what `getPrisma()` returns after
 *  the extension is applied. Importers narrow to a structural
 *  slice via `as any` (matching the existing api pattern in
 *  `boot/readingDelegate.ts`). */
export type ExtendedPrismaClient = ReturnType<typeof notificationAdminExtension>;
