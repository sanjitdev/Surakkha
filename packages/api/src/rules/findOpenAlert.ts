/**
 * Thin IO helper for the partial-index lookup
 * `(deviceId, metric, severity) WHERE clearedAt IS NULL`.
 *
 * Consumed by the open `$transaction` (idempotency fast path) and
 * by the alert manager for `linked_alerts` collapse.
 */
import type { RuleMetric, RuleSeverity } from "@surakkha/shared";

/** The subset of the `Alert` model that the seam returns. */
export interface OpenAlertRow {
  readonly id: string;
  readonly deviceId: string;
  readonly ruleId: string;
  readonly severity: RuleSeverity;
  readonly metric: RuleMetric;
  readonly openedAt: Date;
}

/** Narrow slice of the Prisma client — `alert.findFirst` with the
 *  `clearedAt: null` filter. */
export interface PrismaAlertReader {
  readonly alert: {
    findFirst(args: {
      readonly where: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly severity: RuleSeverity;
        readonly clearedAt: null;
      };
    }): Promise<OpenAlertRow | null>;
  };
}

/** Adapter — narrow the real `@prisma/client` to the
 *  `PrismaAlertReader` slice. */
export const resolvePrismaAlertReader = (prisma: unknown): PrismaAlertReader => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    alert: {
      findFirst: (args) => client.alert.findFirst(args) as Promise<OpenAlertRow | null>,
    },
  };
};

/** Look up the at-most-one open `Alert` for a `(deviceId, metric,
 *  severity)` key. Returns `null` if no open alert exists. The
 *  partial unique index `Alert_open_unique_idx` ensures uniqueness. */
export const findOpenAlert = async (
  prisma: PrismaAlertReader,
  key: {
    readonly deviceId: string;
    readonly metric: RuleMetric;
    readonly severity: RuleSeverity;
  },
): Promise<OpenAlertRow | null> =>
  prisma.alert.findFirst({
    where: {
      deviceId: key.deviceId,
      metric: key.metric,
      severity: key.severity,
      clearedAt: null,
    },
  });
