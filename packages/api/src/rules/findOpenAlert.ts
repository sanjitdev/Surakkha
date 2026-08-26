/**
 * findOpenAlert — Story 3.4 (architecture §5.1, FR-14/AR-7 seam).
 *
 * Thin IO helper that wraps the partial-index lookup
 * `(deviceId, metric, severity) WHERE clearedAt IS NULL`. Lives in
 * its own file (NOT inside `debounce.ts`) so the de-bounce module
 * stays pure — `debounce.spec.ts` runs without any Prisma mock.
 *
 * Consumed by:
 *   - 3.4 hooks: idempotency check inside the open `$transaction`
 *     (the partial unique index is the safety net; this lookup is
 *     the fast path that avoids an unnecessary INSERT attempt).
 *   - 3.5 alert manager: cross-story seam — `linked_alerts` collapse
 *     re-uses the same lookup.
 *
 * Why not inline into `hooks.ts`: keeping the seam in its own file
 * means 3.5 imports the helper without taking a transitive dependency
 * on the rest of the hook implementation.
 */
import type { RuleMetric, RuleSeverity } from "@surakkha/shared";

/**
 * The subset of the `Alert` model that the seam returns. Mirrors
 * the wire shape Story 3.5 needs to link a newly-opened alert to its
 * predecessor; the full row is intentionally NOT returned to keep
 * the seam narrow.
 */
export interface OpenAlertRow {
  readonly id: string;
  readonly deviceId: string;
  readonly ruleId: string;
  readonly severity: RuleSeverity;
  readonly metric: RuleMetric;
  readonly openedAt: Date;
}

/**
 * Narrow slice of the Prisma client — just `alert.findFirst` with the
 * `clearedAt: null` filter. Mirrors the `PrismaRuleReader` pattern
 * (`prismaReader.ts`): the engine and de-bounce modules do not
 * import `@prisma/client` directly; production narrows the real
 * client via `resolvePrismaAlertReader`, tests inject a stub.
 */
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

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `PrismaAlertReader` slice. The cast is contained to this file so
 * future Prisma type drifts don't ripple into the de-bounce modules.
 */
export const resolvePrismaAlertReader = (prisma: unknown): PrismaAlertReader => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    alert: {
      findFirst: (args) => client.alert.findFirst(args) as Promise<OpenAlertRow | null>,
    },
  };
};

/**
 * Look up the at-most-one open `Alert` for a `(deviceId, metric,
 * severity)` key. Returns `null` if no open alert exists. The
 * partial unique index `Alert_open_unique_idx` (in the migration
 * SQL, `WHERE clearedAt IS NULL`) ensures the result is unique.
 */
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
