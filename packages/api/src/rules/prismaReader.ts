/**
 * Prisma-side reader slice — Story 3.2.
 *
 * The engine is read-only against the `Rule` table at runtime. To
 * avoid coupling the engine to `@prisma/client`'s generated type
 * surface (which is enormous), we declare a NARROW slice interface
 * here that captures only the call site the engine needs. The
 * adapter (`resolvePrismaRuleReader`) narrows the real client at
 * boot; tests inject a hand-rolled stub.
 *
 * Why a slice interface (not a `PrismaClient` import):
 *   - The engine is a pure module — tests must be able to swap the
 *     reader without `vi.mock("@prisma/client")` at the package level.
 *   - Story 3.7's hot-reload will need the same slice; the boundary
 *     stays stable across both.
 */
import type { RuleMetric, RuleOperator, RuleRuleType, RuleSeverity } from "@surakkha/shared";

/**
 * The subset of `Rule` row columns the cache needs to build an
 * `EngineRule`. Mirrors the Prisma model — adding a column here
 * forces a cache update, so drift is loud.
 */
export interface RuleRow {
  readonly id: string;
  readonly deviceId: string | null;
  readonly metric: RuleMetric;
  readonly operator: RuleOperator;
  readonly threshold: number;
  readonly severity: RuleSeverity;
  readonly ruleType: RuleRuleType;
  readonly hysteresisSeconds: number;
  readonly isActive: boolean;
}

/**
 * Narrow slice of the Prisma client — just `rule.findMany` with the
 * `isActive` filter the engine needs. Production calls
 * `resolvePrismaRuleReader(prisma)` once to narrow the real client;
 * tests pass a `{ rule: { findMany: vi.fn() } }` stub.
 */
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
        readonly hysteresisSeconds: true;
        readonly isActive: true;
      };
    }): Promise<readonly RuleRow[]>;
  };
}

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `PrismaRuleReader` slice. The cast is contained to one file so
 * future Prisma type drifts don't ripple into the engine module.
 */
export const resolvePrismaRuleReader = (prisma: unknown): PrismaRuleReader => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    rule: {
      findMany: (args) => client.rule.findMany(args) as Promise<readonly RuleRow[]>,
    },
  };
};
