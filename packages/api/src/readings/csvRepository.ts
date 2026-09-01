/**
 * `csvRepository.ts` — Story 5.2 CSV export.
 *
 * Lazy-resolved `streamForCsv(deviceId, since, until, maxRows)`
 * `AsyncIterable<ReadingRow>` over the raw `Reading` table. Streams
 * via keyset pagination on `(ts ASC, id ASC)` so the wire stays
 * linear as the dataset scales; a 30-day window for a busy device
 * can reach ~104k rows (6 metrics × ~17,280 readings/day) and we
 * refuse to buffer the full result in memory.
 *
 * Why keyset pagination on `(ts, id)`:
 *   - Plain `LIMIT 100000` would still return the same volume as the
 *     full table scan; the API process would allocate the rows even
 *     though only the first 100k is yielded. Keyset paging keeps
 *     each round-trip bounded.
 *   - `(ts ASC, id ASC)` is a stable ordering: ties on `ts` break by
 *     the unique `id`. Without the tie-breaker two rows sharing the
 *     same `ts` could be duplicated or skipped across pages.
 *
 * Why a separate repo file (not inlined in `csvRouter.ts`):
 *   - `csvRouter.ts` is the HTTP seam; this file owns the SQL so the
 *     `(client as any)` boundary lives in one place (mirrors
 *     `latestRouter.ts`'s separation from `wiring.ts`).
 *   - Tests inject a stub iterator and never touch Prisma.
 *
 * Stop conditions:
 *   - `maxRows` reached → yield nothing more (caller flips the
 *     `truncated` trailer).
 *   - Underlying `Symbol.asyncIterator` exhausted naturally → end
 *     iteration.
 *
 * Lazy Prisma: this module never imports `@prisma/client`. The
 * production wiring injects `resolvePrismaClient` (same seam as
 * `wiring.ts:53-76`).
 */
import { type TelemetryMetrics } from "@surakkha/shared/telemetry";

/**
 * One Reading row in the canonical projection the CSV layer
 * expects. Mirrors `Reading` (`packages/db/prisma/schema.prisma:79`)
 * but with `metrics` narrowed to `TelemetryMetrics` (the v1 wire
 * contract shape, not the raw `Json` column type).
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
 * boundary returns `Promise<unknown>` and we narrow at the seam).
 */
interface PrismaClientSubset {
  $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown[]>;
}

/**
 * Raw projection returned by the SQL — `ts` may arrive as a `Date`
 * or a `string` (depending on Postgres driver behavior), so we
 * narrow at the iteration boundary and re-wrap into the canonical
 * `ReadingRow` shape on yield. Declared as a named interface so
 * the two branches of the page-1 vs page-N ternary below can
 * share an annotation (TS rejects an inline anonymous shape on a
 * self-referential `const`).
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
 *
 * Implementation notes (lazy-resolver + raw SQL seam):
 *   - The lazy-resolver seam lives in `buildPrismaStreamForCsv`
 *     (`csvRouter.ts:251-254`), which sets the module-scoped
 *     `resolvePrismaClient` and forwards the remaining args; this
 *     keeps the public signature at the spec-mandated 4 params.
 *   - The `(client as any)` boundary is localized to this function
 *     (mirrors `wiring.ts:53-76`).
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
 * `buildPrismaStreamForCsv(getPrisma)` in `csvRouter.ts:251-254`;
 * the public `streamForCsv` reads it lazily on the first iteration
 * so a transient DB outage at boot does not crash the api.
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
