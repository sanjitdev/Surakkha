/**
 * `boot/readingDelegate.ts` — distilled 2026-08-30 (was inline in
 * `src/index.ts:600-645`).
 *
 * Narrow `Reading` delegate over the shared Prisma client. Used by
 * the rules engine (Story 3.2) for both the `create` path (writing
 * a new reading row inside `processFrame`) and the `findMany` path
 * (loading the rate-rule window for backfill).
 *
 * The delegate is intentionally narrower than the full
 * `PrismaClient.reading` surface — only the two methods the rules
 * engine calls are exposed. A future Prisma upgrade that renames
 * `reading.findMany` only affects this file (and the rules engine
 * that imports it), not every router.
 *
 * Lazy-resolved via `getPrisma()` — the same lazy pattern as the
 * shared client. The rules engine boot path awaits this delegate
 * on first WS connection, not on import.
 */
import { type RuleMetric, type TelemetryFrame } from "@surakkha/shared";

import { getPrisma } from "./db.js";

export interface ReadingDelegate {
  readonly reading: {
    create(args: {
      readonly data: {
        readonly deviceId: string;
        readonly ts: Date;
        readonly serverReceivedAt: Date;
        readonly metrics: unknown;
        readonly seq: number;
        readonly flags: readonly string[];
      };
    }): Promise<unknown>;
    findMany(args: {
      readonly where: {
        readonly deviceId: string;
        readonly metric: RuleMetric;
        readonly ts: { readonly gte: Date };
      };
      readonly orderBy: { readonly ts: "asc" };
      readonly take: number;
    }): Promise<
      ReadonlyArray<{
        readonly ts: Date;
        readonly metrics: TelemetryFrame["metrics"];
      }>
    >;
  };
}

export const resolveReadingDelegate = async (): Promise<ReadingDelegate> => {
  // The single allowed `(client as any)` boundary — `getPrisma()`
  // returns `Promise<unknown>` by design (see boot/db.ts). Narrow
  // here so the rest of the rules engine sees a structural type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (await getPrisma()) as any;
  return {
    reading: {
      create: (args) => client.reading.create(args) as Promise<unknown>,
      findMany: (args) =>
        client.reading.findMany(args) as Promise<
          ReadonlyArray<{
            readonly ts: Date;
            readonly metrics: TelemetryFrame["metrics"];
          }>
        >,
    },
  };
};
