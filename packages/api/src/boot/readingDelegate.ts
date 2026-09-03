/**
 * Narrow `Reading` delegate over the shared Prisma client. Used by
 * the rules engine for both the `create` path (writing a new
 * reading row inside `processFrame`) and the `findMany` path
 * (loading the rate-rule window for backfill).
 */
import { type TelemetryFrame } from "@surakkha/shared";

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
  // The single allowed `(client as any)` boundary; narrow here so
  // the rules engine sees a structural type.
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
