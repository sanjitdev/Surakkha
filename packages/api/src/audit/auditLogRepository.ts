/**
 * `auditLogRepository.ts` — Story 5.3.
 *
 * Narrow Prisma slice for the `AuditLog` table. Mirrors the
 * pattern from `notificationRepository.ts` (Story 4.10 / 5.1):
 * interface-driven + adapter that narrows the real
 * `@prisma/client` via a structural cast. The repository is the
 * SEAM between the router and the data layer so the router's
 * test rig can stub the data layer without spinning up Prisma.
 *
 * The interface is intentionally narrow: one method,
 * `findManyAuditLog`, that takes an AND-ed filter object and
 * returns `{ rows, total, truncated }`. The `total` + `truncated`
 * fields power the page's "showing 100 of N events" copy when
 * the row cap fires.
 *
 * Why a single method (vs splitting findMany + count):
 *
 *   - The query is a single round-trip: `findMany` with
 *     `take: 100` AND a parallel `count` of the same WHERE
 *     clause. The Prisma client exposes both natively; the
 *     seam below captures both.
 *   - The repository's surface stays narrow — adding a future
 *     write surface (Story 5.6's writer-swap) is a deliberate
 *     step that adds a new method rather than widening this one.
 */

/**
 * The filter shape the admin list endpoint accepts. Mirrors
 * the wire-level `AuditLogFilters` from `@surakkha/shared/audit`
 * with `string` arrays already split + dates already coerced to
 * `Date` objects ready for Prisma's `gte` / `lt`.
 *
 * All fields are optional; an empty object yields "all rows
 * capped at 100, ordered by `createdAt DESC`" — the spec's
 * HAPPY_PATH_ADMIN case.
 *
 * `event` is a SUBSTRING match (case-insensitive). The router
 * passes it through as `{ contains: event, mode: "insensitive" }`
 * — Postgres's `ILIKE` shape.
 *
 * `actorIds` is an IN-list — `{ in: [...] }` — the multi-select
 * chip row produces 0..N entries.
 */
export interface AuditLogFilters {
  readonly actorIds?: readonly string[];
  readonly event?: string;
  readonly resource?: string;
  readonly since?: Date;
  readonly until?: Date;
}

/**
 * The narrow row shape the api writes / reads. Matches Prisma's
 * `AuditLog` model exactly. The adapter (`auditLogRowToPayload.ts`)
 * converts this to the wire shape (`AuditLogEntry`) — server-
 * internal columns (`payload`) are forwarded verbatim as `unknown`.
 */
export interface AuditLogRow {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly auditAction: string;
  readonly resource: string;
  readonly resourceId: string | null;
  readonly payload: unknown;
  readonly outcome: string;
  readonly createdAt: Date;
}

/**
 * Narrow slice of `@prisma/client.auditLog` that the audit
 * router consumes.
 *
 * `findManyAuditLog` returns `{ rows, total, truncated }`:
 *   - `rows` — the page-sized list (≤ `take`).
 *   - `total` — the full count of rows matching the WHERE clause
 *     (NOT capped). Drives the page's "showing 100 of N" copy.
 *   - `truncated` — `total > rows.length`. Symmetric shortcut so
 *     the page doesn't need to recompute the comparison.
 */
export interface AuditLogRepository {
  readonly auditLog: {
    findManyAuditLog(args: {
      readonly where: AuditLogFilters;
      readonly orderBy: { readonly createdAt: "desc" };
      readonly take: number;
    }): Promise<{
      readonly rows: AuditLogRow[];
      readonly total: number;
      readonly truncated: boolean;
    }>;
  };
}

/**
 * Adapter — narrow the real `@prisma/client` to the
 * `AuditLogRepository` slice. Mirrors `resolveNotificationRepository`
 * at `notificationRepository.ts:191-209`. The `as any` cast is
 * contained to this file so future Prisma type drifts do not
 * ripple into the router.
 *
 * Production narrows via this adapter; the test rig provides a
 * hand-rolled stub matching the same shape.
 */
export const resolveAuditLogRepository = (prisma: unknown): AuditLogRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    auditLog: {
      findManyAuditLog: async (args) => {
        const rows = (await client.auditLog.findMany({
          where: toPrismaWhere(args.where),
          orderBy: args.orderBy,
          take: args.take,
        })) as AuditLogRow[];
        const count = (await client.auditLog.count({
          where: toPrismaWhere(args.where),
        })) as number;
        return {
          rows,
          total: count,
          truncated: count > rows.length,
        };
      },
    },
  };
};

/**
 * Coerce the api-side `AuditLogFilters` (string array of actor
 * ids, free `event` substring) into the Prisma `where` shape.
 *
 * The `actorIds` field uses Prisma's `in: [...]` IN-list (an
 * empty array would yield zero rows, so the router omits the
 * key entirely when there are no chips selected). `event` uses
 * `{ contains, mode: "insensitive" }` so the substring match is
 * case-INsensitive per the spec I/O matrix `FILTER_BY_EVENT`.
 *
 * `since` / `until` are `gte` / `lt` respectively (inclusive
 * lower, exclusive upper). `resource` is `equals` (the api
 * validates against the closed enum before forwarding).
 */
/** Build the `actorIds` Prisma where clause (or `null` for "no filter"). */
export const actorWhere = (filters: AuditLogFilters): Record<string, unknown> | null =>
  filters.actorIds !== undefined && filters.actorIds.length > 0
    ? { actorUserId: { in: filters.actorIds } }
    : null;

/**
 * Escape Postgres LIKE wildcards (`%`, `_`) and the escape
 * character (`\`) in the `event` substring before forwarding
 * to Prisma's `contains`. Without this escape, `?event=%admin%`
 * matches every row containing `admin` (the `%` wildcards
 * effectively become a no-op on either side of the literal),
 * which is a privilege-relevant information leak for an Admin
 * log surface. Escape backslashes FIRST so the added escapes
 * aren't themselves re-escaped.
 */
export const escapeLikeWildcards = (raw: string): string =>
  raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

/** Build the `event` substring Prisma where clause. */
export const eventWhere = (filters: AuditLogFilters): Record<string, unknown> | null =>
  filters.event !== undefined && filters.event.length > 0
    ? { auditAction: { contains: escapeLikeWildcards(filters.event), mode: "insensitive" } }
    : null;

/** Build the `resource` enum Prisma where clause. */
export const resourceWhere = (filters: AuditLogFilters): Record<string, unknown> | null =>
  filters.resource !== undefined && filters.resource.length > 0
    ? { resource: { equals: filters.resource } }
    : null;

/** Build the date-range Prisma where clause (`gte`/`lt` on `createdAt`). */
export const dateRangeWhere = (filters: AuditLogFilters): Record<string, unknown> | null => {
  const createdAt: Record<string, unknown> = {};
  if (filters.since !== undefined) createdAt["gte"] = filters.since;
  if (filters.until !== undefined) createdAt["lt"] = filters.until;
  return Object.keys(createdAt).length > 0 ? { createdAt } : null;
};

export const toPrismaWhere = (filters: AuditLogFilters): Record<string, unknown> => {
  const where: Record<string, unknown> = {};
  const actor = actorWhere(filters);
  if (actor !== null) where["actorUserId"] = actor["actorUserId"];
  const event = eventWhere(filters);
  if (event !== null) where["auditAction"] = event["auditAction"];
  const resource = resourceWhere(filters);
  if (resource !== null) where["resource"] = resource["resource"];
  const range = dateRangeWhere(filters);
  if (range !== null) where["createdAt"] = range["createdAt"];
  return where;
};
