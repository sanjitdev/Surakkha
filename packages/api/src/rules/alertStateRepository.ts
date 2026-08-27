/**
 * alertStateRepository.ts — Story 3.4 (de-bouncing IO).
 *
 * The narrow Prisma slice `AlertStateRepository` plus its
 * `resolveAlertStateRepository` adapter. Extracted from
 * `hooks.ts` so the hook module stays under the lint
 * `max-lines` ceiling. The interface is unchanged — it just
 * lives in its own file now. `hooks.ts` re-exports the type
 * for back-compat.
 *
 * Story 3.4 review-finding #3 + #4: the `$transaction` method
 * exposes the callback form so the hook wraps the (Alert write
 * + state upsert) pair atomically. The transaction's `tx`
 * object is itself shaped as `AlertStateRepository` so the same
 * `tx.alert.create` / `tx.alert.findFirst` / `tx.ruleDebounceState.upsert`
 * calls work inside the callback without re-binding.
 */
import type { RuleMetric } from "@surakkha/shared";

export interface AlertStateRepository {
  readonly ruleDebounceState: {
    findMany(args: {
      readonly where: {
        readonly deviceId: string;
        readonly OR: ReadonlyArray<{
          readonly metric: RuleMetric;
          readonly severity: { in: ReadonlyArray<"info" | "warning" | "critical"> };
        }>;
      };
    }): Promise<
      ReadonlyArray<{
        readonly metric: RuleMetric;
        readonly severity: "info" | "warning" | "critical";
        readonly inViolationSince: Date | null;
        readonly clearedSince: Date | null;
      }>
    >;
    upsert(args: {
      readonly where: {
        readonly deviceId_metric_severity: {
          readonly deviceId: string;
          readonly metric: RuleMetric;
          readonly severity: "info" | "warning" | "critical";
        };
      };
      readonly create: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly severity: "info" | "warning" | "critical";
        readonly inViolationSince: Date | null;
        readonly clearedSince: Date | null;
      };
      readonly update: {
        readonly inViolationSince?: Date | null;
        readonly clearedSince?: Date | null;
      };
    }): Promise<unknown>;
  };
  readonly alert: {
    create(args: {
      readonly data: {
        readonly deviceId: string;
        readonly ruleId: string;
        readonly severity: "info" | "warning" | "critical";
        readonly metric: RuleMetric;
        readonly openedAt: Date;
      };
    }): Promise<{ readonly id: string }>;
    update(args: {
      readonly where: { readonly id: string };
      readonly data: { readonly clearedAt: Date };
    }): Promise<unknown>;
    /**
     * Story 3.4 review-finding #3 + #4 + #6: the
     * `findOpenAlert` lookup now runs INSIDE the
     * `$transaction` (so the resolved `alertId` is the one
     * committed atomically with the state upsert). The
     * transaction's `tx` object must therefore expose
     * `alert.findFirst`. Production: `tx.alert.findFirst`
     * is the same Prisma method the outer `deps.alertReader`
     * uses. Tests: the rig exposes the same mock on `tx`
     * so the same `alertReaderFindFirst` mock drives both.
     */
    findFirst(args: {
      readonly where: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly severity: "info" | "warning" | "critical";
        readonly clearedAt: null;
      };
    }): Promise<{ readonly id: string } | null>;
  };
  /**
   * Story 3.6 — auto-create Incident from warning/critical Alert.
   * Lives on the SAME `$transaction` so the Alert row + Incident
   * row + state upsert commit as one unit. The `tx` object inside
   * `$transaction`'s callback exposes this slice via the
   * `AlertStateRepository` shape. Production forwards to
   * `tx.incident.create(...)`; tests inject a stub.
   *
   * Atomicity: any throw inside the `$transaction` callback rolls
   * back the entire transaction (Alert row + Incident row + state
   * row). No orphan alerts on Incident-write failure (AC6).
   */
  readonly incident: {
    create(args: {
      readonly data: {
        readonly deviceId: string;
        readonly severity: string;
        readonly metric: RuleMetric;
        readonly value: number;
        readonly openedAt: Date;
        readonly state: "OPEN";
        readonly assigneeUserId: null;
        readonly acknowledgedAt: null;
        readonly resolvedAt: null;
      };
    }): Promise<{ readonly id: string }>;
  };
  /**
   * Story 4.9 — `notification:warning` write site. Lives on the
   * SAME `$transaction` as the (Alert + Incident) pair so all
   * three rows commit as one unit. The idempotent partial-unique
   * index is the safety net for the race; the writer's P2002 catch
   * is the deterministic outcome.
   */
  readonly notification: {
    create(args: {
      readonly data: {
        readonly severity: "warning" | "critical";
        readonly incidentId: string | null;
        readonly alertId: string | null;
        readonly recipientRole: "Admin" | "Operator" | "Technician" | "Viewer";
      };
    }): Promise<{ readonly id: string }>;
    findFirst(args: {
      readonly where: {
        readonly incidentId: string;
        readonly severity: "warning" | "critical";
        readonly acknowledgedAt: null;
      };
    }): Promise<{ readonly id: string } | null>;
  };
  /**
   * Story 3.4 review-finding #3 + #4: `$transaction` wrapper.
   * The callback runs the IO pair (Alert write + state upsert)
   * atomically. Production forwards to `prisma.$transaction(cb)`.
   * The return type matches Prisma's: a callback form returns
   * the callback's return value; tests use the same shape.
   */
  $transaction<T>(cb: (tx: AlertStateRepository) => Promise<T>): Promise<T>;
}

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `AlertStateRepository` slice.
 */
export const resolveAlertStateRepository = (prisma: unknown): AlertStateRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    ruleDebounceState: {
      findMany: (args) =>
        client.ruleDebounceState.findMany(args) as Promise<
          ReadonlyArray<{
            readonly metric: RuleMetric;
            readonly severity: "info" | "warning" | "critical";
            readonly inViolationSince: Date | null;
            readonly clearedSince: Date | null;
          }>
        >,
      upsert: (args) => client.ruleDebounceState.upsert(args) as Promise<unknown>,
    },
    alert: {
      create: (args) => client.alert.create(args) as Promise<{ readonly id: string }>,
      update: (args) => client.alert.update(args) as Promise<unknown>,
      findFirst: (args) => client.alert.findFirst(args) as Promise<{ readonly id: string } | null>,
    },
    // Story 3.6 — incident auto-create lives in the same
    // `$transaction` as the alert write. Production forwards to
    // `client.incident.create(...)` (the same Prisma client the
    // rest of the call uses); tests inject a stub.
    incident: {
      create: (args) => client.incident.create(args) as Promise<{ readonly id: string }>,
    },
    // Story 4.9 — `notification:warning` write site. Production
    // forwards to `client.notification.create(...)`; tests inject
    // a stub that returns a stable row id.
    notification: {
      create: (args) => client.notification.create(args) as Promise<{ readonly id: string }>,
      findFirst: (args) =>
        client.notification.findFirst(args) as Promise<{ readonly id: string } | null>,
    },
    $transaction: <T>(cb: (tx: AlertStateRepository) => Promise<T>): Promise<T> =>
      client.$transaction(cb) as Promise<T>,
  };
};
