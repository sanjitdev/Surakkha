/**
 * Narrow Prisma slice for the alert + de-bounce state IO. Extracted
 * from `hooks.ts` so the hook module stays under the lint
 * `max-lines` ceiling. The interface shape is unchanged — it just
 * lives in its own file now. `hooks.ts` re-exports the type for
 * back-compat.
 *
 * The `$transaction` method exposes the callback form so the hook
 * wraps the (Alert write + state upsert) pair atomically. The
 * transaction's `tx` object is itself shaped as `AlertStateRepository`
 * so the same `tx.alert.create` / `tx.alert.findFirst` /
 * `tx.ruleDebounceState.upsert` calls work inside the callback.
 */
import type { RuleMetric } from "@surakkha/shared";

export interface AlertStateRepository {
  readonly ruleDebounceState: {
    findMany(args: {
      readonly where: {
        readonly deviceId: string;
        readonly OR: ReadonlyArray<{
          readonly metric: RuleMetric;
          /** Accept the direct-equality form in addition to `{ in: [...] }`
           *  so Prisma doesn't have to build a one-element IN clause. */
          readonly severity:
            | "info"
            | "warning"
            | "critical"
            | { in: ReadonlyArray<"info" | "warning" | "critical"> };
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
    findFirst(args: {
      readonly where: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly severity: "info" | "warning" | "critical";
        readonly clearedAt: null;
      };
    }): Promise<{ readonly id: string } | null>;
  };
  /** Auto-create Incident from warning/critical Alert on the SAME
   *  `$transaction` so the Alert + Incident + state row commit as one
   *  unit. Any throw inside the callback rolls back the entire
   *  transaction. */
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
  /** `notification:warning` write site. Lives on the SAME
   *  `$transaction` as the (Alert + Incident) pair. The idempotent
   *  partial-unique index is the safety net for the race. */
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
  /** `$transaction` wrapper. The callback runs the IO pair (Alert
   *  write + state upsert) atomically. Production forwards to
   *  `prisma.$transaction(cb)`. */
  $transaction<T>(cb: (tx: AlertStateRepository) => Promise<T>): Promise<T>;
}

/** Adapter — narrow the real `@prisma/client` to the
 *  `AlertStateRepository` slice. */
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
    incident: {
      create: (args) => client.incident.create(args) as Promise<{ readonly id: string }>,
    },
    notification: {
      create: (args) => client.notification.create(args) as Promise<{ readonly id: string }>,
      findFirst: (args) =>
        client.notification.findFirst(args) as Promise<{ readonly id: string } | null>,
    },
    $transaction: <T>(cb: (tx: AlertStateRepository) => Promise<T>): Promise<T> =>
      client.$transaction(cb) as Promise<T>,
  };
};
