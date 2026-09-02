/**
 * Idempotent writer for the `Notification` table. Idempotency via
 * the partial unique index `(incidentId, severity) WHERE
 * acknowledgedAt IS NULL`; the P2002 catch returns the existing row
 * so a double-click emits a single row.
 *
 * Two named helpers (`writeWarningNotification` /
 * `writeCriticalNotification`) pin `recipientRole: Operator` per
 * severity — the call site can never accidentally target the wrong
 * role. The writer is consumed by `applyTransition.ts`'s
 * auto-create-from-alert path and the `submit_result → UNSAFE`
 * transition handler.
 */
import { type PrismaAlertReader } from "../rules/findOpenAlert";

/** The Prisma error code that signals a unique-constraint violation. */
export const PRISMA_P2002 = "P2002";

/** Narrow type guard for the Prisma P2002 race. The `code` field
 *  is the only stable surface across Prisma versions. */
export const isPrismaP2002 = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const obj = err as { code?: unknown };
  return obj.code === PRISMA_P2002;
};

/** The narrow Prisma slice the writer needs. Production forwards to
 *  `tx.notification.create` / `tx.notification.findFirst`; tests
 *  inject a stub. */
export interface NotificationWriterRepository {
  readonly notification: {
    create(args: {
      readonly data: {
        readonly severity: "warning" | "critical";
        readonly incidentId: string | null;
        readonly alertId: string | null;
        readonly recipientRole: "Admin" | "Operator" | "Technician" | "Viewer";
      };
    }): Promise<{ readonly id: string; readonly createdAt: Date }>;
    findFirst(args: {
      readonly where: {
        readonly incidentId: string;
        readonly severity: "warning" | "critical";
        readonly acknowledgedAt: null;
      };
    }): Promise<{ readonly id: string; readonly createdAt: Date } | null>;
  };
}

export interface WriteNotificationInput {
  readonly severity: "warning" | "critical";
  readonly incidentId: string | null;
  readonly alertId: string | null;
}

export interface WriteNotificationOutput {
  readonly id: string;
  readonly createdAt: Date;
  /** `true` when the row was newly inserted; `false` when an
   *  existing active row was returned (the idempotent double-click
   *  case). */
  readonly wasInserted: boolean;
}

/** Write a `Notification` row idempotently. On a P2002 collision
 *  (the partial unique index flagged a duplicate active row), the
 *  existing row is returned and `wasInserted: false`.
 *
 *  The `incidentId` and `alertId` are mutually-non-null in v1 (a
 *  notification is always backed by an Incident OR an Alert, never
 *  both). The function accepts either shape and pins the role to
 *  `Operator`. */
export const writeNotification = async (
  repo: NotificationWriterRepository,
  input: WriteNotificationInput,
): Promise<WriteNotificationOutput> => {
  // The partial unique index requires a non-null `incidentId`. If
  // the caller passes null, fall back to a non-indexed write (no
  // idempotency, but the row still lands).
  if (input.incidentId === null) {
    const created = await repo.notification.create({
      data: {
        severity: input.severity,
        incidentId: null,
        alertId: input.alertId,
        recipientRole: "Operator",
      },
    });
    return { id: created.id, createdAt: created.createdAt, wasInserted: true };
  }

  try {
    const created = await repo.notification.create({
      data: {
        severity: input.severity,
        incidentId: input.incidentId,
        alertId: input.alertId,
        recipientRole: "Operator",
      },
    });
    return { id: created.id, createdAt: created.createdAt, wasInserted: true };
  } catch (err) {
    if (!isPrismaP2002(err)) throw err;
    // Idempotent double-click: another writer beat us. Refetch the
    // active row and return it.
    const existing = await repo.notification.findFirst({
      where: {
        incidentId: input.incidentId,
        severity: input.severity,
        acknowledgedAt: null,
      },
    });
    if (existing === null) {
      // Race: the active row was acknowledged between the failed
      // insert and the refetch. Re-insert to mint a fresh active
      // row.
      const created = await repo.notification.create({
        data: {
          severity: input.severity,
          incidentId: input.incidentId,
          alertId: input.alertId,
          recipientRole: "Operator",
        },
      });
      return { id: created.id, createdAt: created.createdAt, wasInserted: true };
    }
    return { id: existing.id, createdAt: existing.createdAt, wasInserted: false };
  }
};

/** The `notification:critical` write site. Used in the
 *  `submit_result → UNSAFE` transition handler. */
export const writeCriticalNotification = async (
  repo: NotificationWriterRepository,
  args: { readonly incidentId: string; readonly alertId: string | null },
): Promise<WriteNotificationOutput> =>
  writeNotification(repo, {
    severity: "critical",
    incidentId: args.incidentId,
    alertId: args.alertId,
  });

/** The `notification:warning` write site. Used in the
 *  `applyOpenTransition` path. */
export const writeWarningNotification = async (
  repo: NotificationWriterRepository,
  args: { readonly incidentId: string; readonly alertId: string },
): Promise<WriteNotificationOutput> =>
  writeNotification(repo, {
    severity: "warning",
    incidentId: args.incidentId,
    alertId: args.alertId,
  });

/** Re-export the alert-reader type so the auto-create-from-alert
 *  path in `applyTransition.ts` does not need a separate import. */
export type { PrismaAlertReader };
