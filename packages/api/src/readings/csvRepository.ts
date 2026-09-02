/**
 * `csvRepository.ts` — lazy-resolved CSV streaming seam for the
 * readings export.
 *
 * Exposes `streamForCsv(deviceId, since, until, maxRows)` returning
 * `AsyncIterable<ReadingRow>` over the raw `Reading` table. Uses
 * keyset pagination on `(ts ASC, id ASC)` so the wire stays
 * linear as the dataset scales — a 30-day window for a busy
 * device can reach ~104k rows.
 */
import { type TelemetryMetrics } from "@surakkha/shared/telemetry";

/**
 * One Reading row in the canonical projection the CSV layer
 * expects. Mirrors the `Reading` Prisma model but with `metrics`
 * narrowed to `TelemetryMetrics` (the v1 wire contract shape,
 * not the raw `Json` column type).
 */
export interface ReadingRow {
  readonly id: string;
  readonly deviceId: string;
  readonly ts: Date;
  readonly metrics: TelemetryMetrics;
}

/**
 * Page size for keyset iteration. Tuned so a 100k-row window needs
 * ~40 round-trips at Postgres-wire costs; small enough that one
 * page never allocates more than a few hundred rows.
 */
const PAGE_SIZE = 2_500;

/**
 * Minimal Prisma-client shape this module needs. Declared locally
 * so this file never imports `@prisma/client` (the lazy-resolver
 * boundary returns `Promise<unknown>` and the function narrows at
 * the seam).
 */
interface PrismaClientSubset {
  $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown[]>;
}

/**
 * Raw projection returned by the SQL — `ts` may arrive as a `Date`
 * or a `string` (depending on Postgres driver behavior), so the
 * function narrows at the iteration boundary and re-wraps into
 * the canonical `ReadingRow` shape on yield.
 */
interface RawReadingRow {
  readonly id: string;
  readonly deviceId: string;
  readonly ts: Date | string;
  readonly metrics: TelemetryMetrics;
}

/**
 * First-page SQL — no cursor predicate (the `since` lower bound
 * IS the cursor on page 0).
 */
const FIRST_PAGE_SQL = `
  SELECT r."id",
         r."deviceId",
         r."ts",
         r."metrics"
    FROM "Reading" r
   WHERE r."deviceId" = $1
     AND r."ts" >= $2::timestamp
     AND r."ts" <  $3::timestamp
   ORDER BY r."ts" ASC, r."id" ASC
   LIMIT $4
`;

/**
 * Subsequent-page SQL — strict-greater-than keyset cursor on
 * `(ts, id)`. The row-tuple comparison breaks ties on `ts` by `id`,
 * so no rows are skipped or duplicated across pages.
 */
const NEXT_PAGE_SQL = `
  SELECT r."id",
         r."deviceId",
         r."ts",
         r."metrics"
    FROM "Reading" r
   WHERE r."deviceId" = $1
     AND r."ts" >= $2::timestamp
     AND r."ts" <  $3::timestamp
     AND (r."ts", r."id") > ($4::timestamp, $5::text)
   ORDER BY r."ts" ASC, r."id" ASC
   LIMIT $6
`;

/**
 * Inputs for one page-fetch. Bundled into a single arg so the
 * helper stays under the `max-params` lint cap (max 3) and the
 * cursor-state (`lastTs` / `lastId`) lives next to the read-only
 * bounds (deviceId / since / until).
 */
interface PageQuery {
  readonly deviceId: string;
  readonly since: Date;
  readonly until: Date;
  readonly lastTs: Date | null;
  readonly lastId: string | null;
  readonly limit: number;
}

/**
 * Fetch one page of readings from Postgres. The first page uses
 * `FIRST_PAGE_SQL` (no cursor — the `since` lower bound IS the
 * cursor); subsequent pages use `NEXT_PAGE_SQL` (cursor on
 * `(lastTs, lastId)`).
 *
 * Dates are bound as ISO strings so Postgres compares timestamps
 * correctly (the `$queryRaw` tagged-template only accepts literal
 * substitution sites; `$queryRawUnsafe` is the parametric
 * alternative).
 */
const fetchPage = async (
  client: PrismaClientSubset,
  q: PageQuery,
): Promise<readonly RawReadingRow[]> => {
  if (q.lastTs === null || q.lastId === null) {
    const rows = (await client.$queryRawUnsafe(
      FIRST_PAGE_SQL,
      q.deviceId,
      q.since.toISOString(),
      q.until.toISOString(),
      q.limit,
    )) as readonly RawReadingRow[];
    return rows;
  }
  const rows = (await client.$queryRawUnsafe(
    NEXT_PAGE_SQL,
    q.deviceId,
    q.since.toISOString(),
    q.until.toISOString(),
    q.lastTs.toISOString(),
    q.lastId,
    q.limit,
  )) as readonly RawReadingRow[];
  return rows;
};

/**
 * Narrow `row.ts` to a real `Date` (driver may return either).
 */
const coerceDate = (raw: Date | string): Date => (raw instanceof Date ? raw : new Date(raw));

/**
 * Stream Reading rows for `deviceId` whose `ts` is in
 * `[since, until)` (inclusive lower bound, exclusive upper bound).
 * Yields in `ts ASC, id ASC` order. Stops yielding once `maxRows`
 * rows have been delivered (the caller flips `truncated: true`).
 */
/* eslint-disable max-params -- spec mandates 4 positional args */
export const streamForCsv = (
  deviceId: string,
  since: Date,
  until: Date,
  maxRows: number,
): AsyncIterable<ReadingRow> => ({
  async *[Symbol.asyncIterator](): AsyncIterator<ReadingRow> {
    // `null` client → DB unavailable. Yield nothing — the router's
    // try/catch surfaces 500 and the audit row stays unwritten.
    const resolve = resolvePrismaClient;
    if (resolve === null) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (await resolve()) as any as PrismaClientSubset | null;
    if (client === null || client === undefined) {
      return;
    }

    // First page starts with no cursor (the lower-bound predicate
    // IS the cursor). Subsequent pages carry `(lastTs, lastId)`.
    let lastTs: Date | null = null;
    let lastId: string | null = null;
    let yielded = 0;

    while (yielded < maxRows) {
      const limit = Math.min(PAGE_SIZE, maxRows - yielded);
      const rows = await fetchPage(client, {
        deviceId,
        since,
        until,
        lastTs,
        lastId,
        limit,
      });
      if (rows.length === 0) {
        return;
      }
      for (const row of rows) {
        if (yielded >= maxRows) {
          return;
        }
        yielded += 1;
        const rowTs = coerceDate(row.ts);
        lastTs = rowTs;
        lastId = row.id;
        yield {
          id: row.id,
          deviceId: row.deviceId,
          ts: rowTs,
          metrics: row.metrics,
        };
      }
    }
  },
});

/**
 * Module-scoped lazy-resolver seam. Set once at boot by
 * `buildPrismaStreamForCsv(getPrisma)`; the public `streamForCsv`
 * reads it lazily on the first iteration so a transient DB outage
 * at boot does not crash the api.
 *
 * Module-scope state is the smallest change to the spec-mandated
 * public signature `streamForCsv(deviceId, since, until, maxRows)`
 * (4 args). The alternative — passing `resolvePrismaClient` through
 * `BuildCsvRouterDeps.streamForCsv` — would force the router's deps
 * type to thread a 5th arg through every test stub, breaking the
 * spec's "Injectable data layer" shape.
 */
let resolvePrismaClient: (() => Promise<unknown>) | null = null;

/**
 * Bind the lazy-resolver seam. Called once at api boot by
 * `buildPrismaStreamForCsv`. Idempotent — a second call replaces the
 * previous resolver (useful in tests; the api only ever calls this
 * once during construction).
 */
export const bindPrismaResolverForCsv = (resolver: () => Promise<unknown>): void => {
  resolvePrismaClient = resolver;
};
