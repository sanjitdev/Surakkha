/**
 * Narrow Prisma slice for the `AuditLog` table. Interface-driven
 * + adapter that narrows the real `@prisma/client` via a
 * structural cast. The repository is the seam between the router
 * and the data layer so the router's test rig can stub the data
 * layer without spinning up Prisma.
 */

/** Filter shape the admin list endpoint accepts. */
export interface AuditLogFilters {
  readonly actorIds?: readonly string[];
  readonly event?: string;
  readonly resource?: string;
  readonly since?: Date;
  readonly until?: Date;
}

/** Narrow row shape the api writes / reads. Matches Prisma's `AuditLog` model. */
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
 * Narrow slice of `@prisma/client.auditLog`. `findManyAuditLog`
 * returns `{ rows, total, truncated }`: `total` drives the page's
 * "showing 100 of N" copy; `truncated` is the symmetric shortcut.
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
 * `AuditLogRepository` slice. The `as any` cast is contained to
 * this file so future Prisma type drifts do not ripple into the
 * router.
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
 * Escape Postgres LIKE wildcards (`%`, `_`) and the escape
 * character (`\`) in the `event` substring before forwarding to
 * Prisma's `contains`. Without this escape, `?event=%admin%`
 * matches every row containing `admin` — a privilege-relevant
 * information leak for an Admin log surface. Escape backslashes
 * FIRST so the added escapes aren't themselves re-escaped.
 */
export const escapeLikeWildcards = (raw: string): string =>
  raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

export const actorWhere = (filters: AuditLogFilters): Record<string, unknown> | null =>
  filters.actorIds !== undefined && filters.actorIds.length > 0
    ? { actorUserId: { in: filters.actorIds } }
    : null;

export const eventWhere = (filters: AuditLogFilters): Record<string, unknown> | null =>
  filters.event !== undefined && filters.event.length > 0
    ? {
        auditAction: {
          contains: escapeLikeWildcards(filters.event),
          mode: "insensitive",
        },
      }
    : null;

export const resourceWhere = (filters: AuditLogFilters): Record<string, unknown> | null =>
  filters.resource !== undefined && filters.resource.length > 0
    ? { resource: { equals: filters.resource } }
    : null;

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
