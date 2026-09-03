/**
 * `GET /api/audit/list` — admin audit-lens read view. Admin-only
 * (matrix grants `read × AuditLog` to Admin; the factory's
 * `authorize({ action: "read", resource: "AuditLog" }, audit)`
 * short-circuits non-Admins with 403 + `rbac_denied` audit).
 *
 * Wire:
 *   200 → `{ rows: AuditLogEntry[≤100], total: number, truncated: boolean }`
 *         ordered by `createdAt DESC`.
 *   400 → invalid `since` / `until` / resource, `since >= until`.
 *   500 → Prisma throw.
 *
 * The audit log is append-only; this read endpoint does not imply
 * a write endpoint exists.
 */
import {
  type AuditLogEntry,
  type AuditLogListEnvelope,
  AuditLogListEnvelopeSchema,
  AuditLogResourceSchema,
} from "@surakkha/shared/audit";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_ERROR, HTTP_OK } from "../httpStatus.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
  type AuditLogFilters,
  type AuditLogRepository,
  type AuditLogRow,
} from "./auditLogRepository.js";
import { auditLogRowToPayload } from "./auditLogRowToPayload.js";

/** Maximum number of rows the list returns. The spec pins `take: 100`. */
const AUDIT_LOG_TAKE_LIMIT = 100;

/** Maximum actor ids a single list request may carry. Surfaces 400 `validation_error` when exceeded. */
const ACTOR_IDS_MAX = 50;

const adminQuerySchema = z.object({
  actorIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const arr = Array.isArray(raw) ? raw : [raw];
      const dedup = new Set(arr.filter((s) => s.length > 0));
      return Array.from(dedup);
    })
    .pipe(
      z
        .array(z.string())
        .max(ACTOR_IDS_MAX, {
          message: `too many actorIds (max ${ACTOR_IDS_MAX})`,
        })
        .optional(),
    ),
  event: z.string().optional(),
  resource: z
    .string()
    .optional()
    .refine((v) => v === undefined || AuditLogResourceSchema.safeParse(v).success, {
      message: "unknown resource",
    }),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
});

const buildFiltersFromQuery = (parsed: z.infer<typeof adminQuerySchema>): AuditLogFilters => {
  const filters: AuditLogFilters = {};
  if (parsed.actorIds !== undefined && parsed.actorIds.length > 0) {
    (filters as { actorIds?: readonly string[] }).actorIds = parsed.actorIds;
  }
  if (parsed.event !== undefined && parsed.event.length > 0) {
    (filters as { event?: string }).event = parsed.event;
  }
  if (parsed.resource !== undefined && parsed.resource.length > 0) {
    (filters as { resource?: string }).resource = parsed.resource;
  }
  if (parsed.since !== undefined) {
    (filters as { since?: Date }).since = new Date(parsed.since);
  }
  if (parsed.until !== undefined) {
    (filters as { until?: Date }).until = new Date(parsed.until);
  }
  return filters;
};

const parseAdminQueryParams = (
  res: Response,
  query: unknown,
): { readonly kind: "ok"; readonly filters: AuditLogFilters } | { readonly kind: "error" } => {
  const parsed = adminQuerySchema.safeParse(query);
  if (!parsed.success) {
    res.status(HTTP_BAD_REQUEST).json({
      error: ERROR_CODES.VALIDATION_ERROR.value,
      issues: parsed.error.issues,
    });
    return { kind: "error" };
  }
  // Defense-in-depth: surface 400 `invalid_range` for `since >= until`
  // so the data layer never receives a bad range.
  if (parsed.data.since !== undefined && parsed.data.until !== undefined) {
    if (new Date(parsed.data.since).getTime() >= new Date(parsed.data.until).getTime()) {
      res.status(HTTP_BAD_REQUEST).json({
        error: ERROR_CODES.INVALID_RANGE.value,
        message: "`since` must be strictly less than `until`",
      });
      return { kind: "error" };
    }
  }
  return { kind: "ok", filters: buildFiltersFromQuery(parsed.data) };
};

const fetchAuditRows = async (args: {
  readonly repo: AuditLogRepository;
  readonly filters: AuditLogFilters;
  readonly res: Response;
}): Promise<
  | {
      readonly kind: "ok";
      readonly rows: readonly AuditLogRow[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | { readonly kind: "error" }
> => {
  const { repo, filters, res } = args;
  try {
    const out = await repo.auditLog.findManyAuditLog({
      where: filters,
      orderBy: { createdAt: "desc" },
      take: AUDIT_LOG_TAKE_LIMIT,
    });
    return {
      kind: "ok",
      rows: out.rows,
      total: out.total,
      truncated: out.truncated,
    };
  } catch (err) {
    console.error("api/audit/list: prisma error", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return { kind: "error" };
  }
};

const buildAuditEnvelope = (args: {
  readonly rows: readonly AuditLogRow[];
  readonly total: number;
  readonly truncated: boolean;
  readonly res: Response;
}):
  | { readonly kind: "ok"; readonly envelope: AuditLogListEnvelope }
  | { readonly kind: "error" } => {
  const { rows, total, truncated, res } = args;
  const entries: AuditLogEntry[] = rows.map((row) => auditLogRowToPayload(row));
  const envelope: AuditLogListEnvelope = {
    rows: entries,
    total,
    truncated,
  };
  const parsed = AuditLogListEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    console.error("api/audit/list: envelope failed shape validation", parsed.error);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return { kind: "error" };
  }
  return { kind: "ok", envelope: parsed.data };
};

export interface AuditLogRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: AuditLogRepository;
}

export const buildAuditRouter = (deps: AuditLogRouterDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/audit/list",
    authorize({ action: "read", resource: "AuditLog" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const parsedQuery = parseAdminQueryParams(res, req.query);
      if (parsedQuery.kind !== "ok") return;
      const { filters } = parsedQuery;

      const fetched = await fetchAuditRows({ repo: deps.repo, filters, res });
      if (fetched.kind !== "ok") return;
      const { rows, total, truncated } = fetched;

      const built = buildAuditEnvelope({ rows, total, truncated, res });
      if (built.kind !== "ok") return;
      res.status(HTTP_OK).json(built.envelope);
    },
  );

  return router;
};
