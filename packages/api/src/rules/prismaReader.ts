/**
 * Narrow Prisma slice for the `Rule` reader. The engine is read-only
 * against the `Rule` table at runtime. The slice interface captures
 * only the call site the engine needs; tests inject a hand-rolled
 * stub.
 */
import type { RuleMetric, RuleOperator, RuleRuleType, RuleSeverity } from "@surakkha/shared";

/** Subset of `Rule` row columns the cache needs. Adding a column here
 *  forces a cache update. */
export interface RuleRow {
  readonly id: string;
  readonly deviceId: string | null;
  readonly metric: RuleMetric;
  readonly operator: RuleOperator;
  readonly threshold: number;
  readonly severity: RuleSeverity;
  readonly ruleType: RuleRuleType;
  readonly minDurationSeconds: number;
  readonly hysteresisSeconds: number;
  readonly isActive: boolean;
}

/** Narrow slice of the Prisma client — `rule.findMany` with the
 *  `isActive` filter. */
export interface PrismaRuleReader {
  readonly rule: {
    findMany(args: {
      readonly where: { readonly isActive: true };
      readonly select: {
        readonly id: true;
        readonly deviceId: true;
        readonly metric: true;
        readonly operator: true;
        readonly threshold: true;
        readonly severity: true;
        readonly ruleType: true;
        readonly minDurationSeconds: true;
        readonly hysteresisSeconds: true;
        readonly isActive: true;
      };
    }): Promise<readonly RuleRow[]>;
  };
}

/** Adapter — narrow the real `@prisma/client` to the slice. The cast
 *  is contained to one file so future Prisma type drifts don't ripple. */
export const resolvePrismaRuleReader = (prisma: unknown): PrismaRuleReader => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    rule: {
      findMany: (args) => client.rule.findMany(args) as Promise<readonly RuleRow[]>,
    },
  };
};
