/**
 * `readingAggregateRepository.ts` — narrow Prisma slice for the
 * `ReadingAggregate` table.
 *
 * Interface-driven + adapter that narrows the real `@prisma/client`
 * via a structural cast. The repository is the seam between any
 * future reader (admin / chart query) and the data layer, so the
 * cron + admin reader can be tested in isolation without spinning
 * up Prisma.
 */

/**
 * The filter shape the (future) admin list endpoint accepts.
 * `metric` is a closed enum; the api validates against
 * `ReadingAggregateMetricSchema` before forwarding. `since` /
 * `until` are inclusive lower / exclusive upper bounds on
 * `bucketStart` (Prisma `gte` / `lt`).
 *
 * All fields are optional; an empty object yields "all rows
 * capped at 100, ordered by `bucketStart DESC`".
 */
export interface ReadingAggregateFilters {
  readonly deviceId?: string;
  readonly metric?: string;
  readonly since?: Date;
  readonly until?: Date;
}

/**
 * The narrow row shape the api reads. Matches Prisma's
 * `ReadingAggregate` model exactly. `deviceId` is nullable —
 * the FK is ON DELETE SET NULL so a removed Device's aggregates
 * survive. A future UI consumer can render `null` as a tombstone
 * ("device removed") rather than dropping the row.
 */
export interface ReadingAggregateRow {
  readonly id: string;
  readonly deviceId: string | null;
  readonly bucketStart: Date;
  readonly metric: string;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly sampleCount: number;
}

/**
 * Default page size when the caller does not pass `limit`.
 */
const DEFAULT_LIMIT = 100;

/**
 * Hard cap on `limit`. A future admin page must page explicitly
 * above this threshold.
 */
const MAX_LIMIT = 1_000;

/**
 * Narrow slice of `@prisma.client.readingAggregate` that a future
 * reader (and the test rig) consume.
 *
 * `findMany` returns `{ rows, total, truncated }`:
 *   - `rows` — the page-sized list (≤ `take`).
 *   - `total` — the full count of rows matching the WHERE clause
 *     (NOT capped). Drives the page's "showing 100 of N" copy.
 *   - `truncated` — `total > rows.length`. Symmetric shortcut so
 *     the page doesn't need to recompute the comparison.
 */
export interface ReadingAggregateRepository {
  readonly readingAggregate: {
    findMany(args: {
      readonly where: ReadingAggregateFilters;
      readonly orderBy: { readonly bucketStart: "desc" };
      readonly take: number;
    }): Promise<{
      readonly rows: ReadingAggregateRow[];
      readonly total: number;
      readonly truncated: boolean;
    }>;
  };
}

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `ReadingAggregateRepository` slice. The `as any` cast is
 * contained to this file so future Prisma type drifts do not
 * leak into the (future) reader or test rig.
 *
 * Production narrows via this adapter; the test rig provides a
 * hand-rolled stub matching the same shape.
 */
export const resolveReadingAggregateRepository = (prisma: unknown): ReadingAggregateRepository => {
  // Single `as any` cast at the seam — the interface on
  // `ReadingAggregateRepository` is the typed contract; the cast
  // is intentionally contained here so future Prisma type drifts
  // do not leak into the (future) reader or test rig.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    readingAggregate: {
      findMany: async (args) => {
        // Short-circuit on `take < 1` so the REPO_FIND_INVALID_LIMIT
        // envelope (`{ rows: [], total: 0, truncated: false }`) is
        // satisfied without hitting Prisma at all. Mirrors
        // `clampLimit`'s caller-side guard but at the seam so the
        // test rig + future router cannot accidentally bypass it.
        if (args.take < 1) {
          return { rows: [], total: 0, truncated: false };
        }
        // Hoist the where-clause coercion once and run the two
        // independent queries in parallel — narrows the
        // concurrent-writer race window between the findMany and
        // the count by issuing them concurrently, and avoids
        // re-running the helper chain on the count's hot path.
        const where = toPrismaWhere(args.where);
        const [rows, total] = await Promise.all([
          client.readingAggregate.findMany({
            where,
            orderBy: args.orderBy,
            take: args.take,
          }) as Promise<ReadingAggregateRow[]>,
          client.readingAggregate.count({ where }) as Promise<number>,
        ]);
        return {
          rows,
          total,
          truncated: total > rows.length,
        };
      },
    },
  };
};

/**
 * Caller-side guard — short-circuits before hitting Prisma when
 * `limit < 1` (the REPO_FIND_INVALID_LIMIT case). Returns the
 * same `{ rows, total, truncated }` envelope with `truncated:
 * false` so a caller that forgets to validate gets a benign empty
 * page rather than a Prisma throw.
 *
 * Also clamps `limit` to `[1, MAX_LIMIT]` so a runaway caller
 * can't OOM the api by asking for ten million rows. `null` /
 * `undefined` fall back to `DEFAULT_LIMIT`.
 */
export const clampLimit = (
  limit: number | null | undefined,
): { readonly take: number; readonly shortCircuit: boolean } => {
  if (limit === null || limit === undefined) {
    return { take: DEFAULT_LIMIT, shortCircuit: false };
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return { take: 0, shortCircuit: true };
  }
  return { take: Math.min(MAX_LIMIT, Math.floor(limit)), shortCircuit: false };
};

/**
 * Build the `deviceId` Prisma where clause (or `null` for "no
 * filter"). A non-empty string becomes an `equals`; an empty
 * string is treated as "no filter".
 */
export const deviceWhere = (filters: ReadingAggregateFilters): Record<string, unknown> | null =>
  filters.deviceId !== undefined && filters.deviceId.length > 0
    ? { deviceId: { equals: filters.deviceId } }
    : null;

/**
 * Build the `metric` enum Prisma where clause. Closed-enum
 * validation happens at the (future) router boundary via
 * `ReadingAggregateMetricSchema`; the helper trusts the input.
 * Empty string is treated as "no filter".
 */
export const metricWhere = (filters: ReadingAggregateFilters): Record<string, unknown> | null =>
  filters.metric !== undefined && filters.metric.length > 0
    ? { metric: { equals: filters.metric } }
    : null;

/**
 * Build the date-range Prisma where clause (`gte`/`lt` on
 * `bucketStart`). Inclusive lower bound (`since`), exclusive
 * upper bound (`until`).
 */
export const dateRangeWhere = (
  filters: ReadingAggregateFilters,
): Record<string, unknown> | null => {
  const bucketStart: Record<string, unknown> = {};
  if (filters.since !== undefined) bucketStart["gte"] = filters.since;
  if (filters.until !== undefined) bucketStart["lt"] = filters.until;
  return Object.keys(bucketStart).length > 0 ? { bucketStart } : null;
};

/**
 * Coerce the api-side `ReadingAggregateFilters` into the Prisma
 * `where` shape. AND-s every non-null helper output into a single
 * `where` clause. Returns `{}` for the empty-filter case so
 * Prisma's "match all" branch fires.
 */
export const toPrismaWhere = (filters: ReadingAggregateFilters): Record<string, unknown> => {
  const where: Record<string, unknown> = {};
  const device = deviceWhere(filters);
  if (device !== null) where["deviceId"] = device["deviceId"];
  const metric = metricWhere(filters);
  if (metric !== null) where["metric"] = metric["metric"];
  const range = dateRangeWhere(filters);
  if (range !== null) where["bucketStart"] = range["bucketStart"];
  return where;
};
