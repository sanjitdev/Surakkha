/**
 * `notificationWriter.ts` — Story 4.9.
 *
 * The pure writer for the `Notification` table. Idempotent on
 * `(incidentId, severity) WHERE "acknowledgedAt" IS NULL` via the
 * partial unique index in the migration; the P2002 catch returns
 * the existing row so a double-click emits a single row.
 *
 * Why a dedicated module (not just an inline `tx.notification.create`):
 *
 *   - The idempotent double-click is a tricky pattern; isolating it
 *     here lets the test rig exercise the P2002 catch in isolation
 *     without spinning up the whole transition handler.
 *
 *   - The `writeCriticalNotification` and `writeWarningNotification`
 *     wrappers are typed helpers so the call sites
 *     (`applyTransition.ts:154-164`, `incidentStateRepository.ts:264-281`)
 *     read as a single named verb instead of an open-coded
 *     `tx.notification.create({...})` shape that drifts between
 *     call sites.
 *
 *   - The `recipientRole` is locked per-severity in the
 *     `writeCriticalNotification` / `writeWarningNotification`
 *     wrappers. The call site can never accidentally target the
 *     wrong role; the row is always `Operator` (the on-call role
 *     in the v1 RBAC matrix).
 *
 *   - The P2002 catch is the canonical pattern from
 *     `rules/applyTransition.ts:131-141` (Story 3.4's
 *     auto-create-from-alert path) and
 *     `alerts/acknowledgeRouter.ts` (Story 3.5's linked-alerts
 *     collapse). The two-layer check (partial unique index at the
 *     DB + P2002 catch in the writer) means a race between two
 *     concurrent writers collapses to one row without throwing.
 */
import { type PrismaAlertReader } from "../rules/findOpenAlert";

/** The Prisma error code that signals a unique-constraint violation. */
export const PRISMA_P2002 = "P2002";

/**
 * Narrow type guard for the Prisma P2002 race. Mirrors the pattern
 * at `rules/applyTransition.ts:131-141`. Open-coded (not imported
 * from `@prisma/client`) so the api module does not need a runtime
 * Prisma import for the type guard.
 */
export const isPrismaP2002 = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const obj = err as { code?: unknown };
  return obj.code === PRISMA_P2002;
};

/**
 * The narrow slice the writer needs from the real Prisma client.
 * Production forwards to `tx.notification.create` /
 * `tx.notification.findFirst`; tests inject a stub.
 */
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
  /**
   * `true` when the row was newly inserted; `false` when an
   * existing active row was returned (the idempotent double-click
   * case). The test rig uses this to assert the
   * `idempotent_double_click` AC.
   */
  readonly wasInserted: boolean;
}

/**
 * Write a `Notification` row idempotently. On a P2002 collision
 * (the partial unique index flagged a duplicate active row), the
 * existing row is returned and `wasInserted: false`.
 *
 * The `incidentId` and `alertId` are mutually-non-null in v1 (a
 * notification is always backed by an Incident OR an Alert, never
 * both). The function accepts either shape and pins the role to
 * `Operator` (the on-call role for the v1 RBAC matrix).
 */
export const writeNotification = async (
  repo: NotificationWriterRepository,
  input: WriteNotificationInput,
): Promise<WriteNotificationOutput> => {
  // Defensive guard: the partial unique index requires a non-null
  // `incidentId` (it indexes on `(incidentId, severity) WHERE
  // acknowledgedAt IS NULL`). If the caller passes a null
  // `incidentId`, fall back to a non-indexed write (no
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
    // Idempotent double-click: another writer beat us. Refetch
    // the active row and return it. The `findFirst` mirrors the
    // partial-index lookup so a row that was acknowledged
    // between the failed insert and the refetch does not collide.
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
      // row. The test rig mocks the second `create` to verify
      // this fallback path.
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

/**
 * The `notification:critical` write site. Used in the
 * `submit_result → UNSAFE` transition handler (router.ts). Pure
 * thin wrapper around `writeNotification` for call-site
 * readability.
 */
export const writeCriticalNotification = async (
  repo: NotificationWriterRepository,
  args: { readonly incidentId: string; readonly alertId: string | null },
): Promise<WriteNotificationOutput> =>
  writeNotification(repo, {
    severity: "critical",
    incidentId: args.incidentId,
    alertId: args.alertId,
  });

/**
 * The `notification:warning` write site. Used in the
 * `applyOpenTransition` path (3.6's auto-create-from-alert hook).
 * Same shape as `writeCriticalNotification` but for `warning`
 * severity.
 */
export const writeWarningNotification = async (
  repo: NotificationWriterRepository,
  args: { readonly incidentId: string; readonly alertId: string },
): Promise<WriteNotificationOutput> =>
  writeNotification(repo, {
    severity: "warning",
    incidentId: args.incidentId,
    alertId: args.alertId,
  });

/**
 * Re-export the alert-reader type so the auto-create-from-alert
 * path in `applyTransition.ts` does not need a separate import.
 */
export type { PrismaAlertReader };
