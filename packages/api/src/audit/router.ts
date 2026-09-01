/**
 * `router.ts` — Story 5.3.
 *
 * The `/api/audit/list` read endpoint. Mirrors the 5.1
 * `notificationRouter.ts` complexity-10 helper-extraction pattern:
 * query parsing + row fetching + envelope building are each
 * extracted to a helper so the route closure stays under the
 * `complexity: 10` ESLint ceiling.
 *
 * Wire contract:
 *   GET /api/audit/list[?actorIds=a,b&event=incident_state&resource=Incident&since=...&until=...]
 *     - Admin only (matrix grants `read × AuditLog` to Admin; the
 *       factory's `authorize({ action: "read", resource: "AuditLog" }, audit)`
 *       short-circuits non-Admins with 403 + `rbac_denied` audit).
 *     - 200 + `{ rows: AuditLogEntry[≤100], total: number, truncated: boolean }`
 *       ordered by `createdAt DESC`.
 *     - 400 on invalid `since` / `until` / resource values, or
 *       `since >= until`.
 *     - 500 on Prisma throw.
 *
 * Why no write affordance: the audit log is append-only (per
 * epic-5-context §Audit and retention). The presence of a read
 * endpoint does NOT imply a write endpoint exists.
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

/**
 * Maximum number of rows the list returns. The spec pins
 * `take: 100` (Acceptance Criteria "100 most recent ... rows ...
 * ordered createdAt DESC"); no pagination in v1. Mirrors the
 * Story 5.1 `ADMIN_NOTIFICATION_TAKE_LIMIT` constant.
 */
const AUDIT_LOG_TAKE_LIMIT = 100;

/**
 * Maximum number of actor ids a single list request may carry.
 * Without a cap a request with 10k actor IDs pushes a huge
 * IN-list to Prisma and 500s the request. 50 is a comfortable
 * upper bound — the actor multi-select is a manual Admin
 * affordance, not a bulk-paste path; a chip row past 50 is a
 * misclick. Surfaces 400 `validation_error` when exceeded.
 */
const ACTOR_IDS_MAX = 50;

/**
 * The admin query schema. Mirrors the 5.1 `adminQuerySchema` in
 * `notificationRouter.ts:317-333` with the filter fields swapped
 * to the audit-log vocabulary:
 *
 * - `actorIds` is CSV-repeated (`?actorIds=a&actorIds=b`); the
 *   schema coerces string-or-string[] to a deduplicated array.
 * - `event` is a free-text substring (the route applies
 *   `contains` + `insensitive` mode at the data layer).
 * - `resource` is a closed enum chip; unknown values surface 400.
 * - `since` / `until` are ISO 8601 strings.
 *
 * The `actorIds` field deliberately uses
 * `z.union([z.string(), z.array(z.string())])` to handle the
 * repeated-query-param Express quirk. The `transform` below
 * de-duplicates and drops empties — `?actorIds=` (empty) is
 * "no filter applied" (matches all rows), per the spec
 * EMPTY_FILTER_VALUE row.
 */
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

/**
 * Coerce the parsed query into the api-side `AuditLogFilters`
 * shape (Dates, array fields ready for Prisma). Extracted so the
 * route closure stays under the lint complexity ceiling.
 */
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

/**
 * Parse the admin query params. Loops the resource values
 * through `AuditLogResourceSchema.safeParse`; bad values surface
 * 400 with `validation_error`. Returns either `{ kind: "ok",
 * filters }` with the prepared `AuditLogFilters` ready for the
 * repository, or `{ kind: "error" }` (response already sent).
 *
 * Extracted from the route handler to keep the GET closure under
 * `complexity: 10` (mirrors `parseAdminQueryParams` at
 * `notificationRouter.ts:369-425`).
 */
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
  // Validate the date range — same defense-in-depth the 5.1
  // notification router applies (loop 1 review finding E2):
  // silently returning an empty result for `since > until` is
  // a confusing UX. Surface 400 with `invalid_range` so the
  // page (or a future custom-date picker) can correct the
  // input. The data layer MUST NOT receive the bad range.
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

/**
 * Fetch the admin-list rows + total from the repository. Returns
 * `{ kind: "ok", rows, total, truncated }` on success or
 * `{ kind: "error" }` if Prisma threw (response already sent
 * with 500).
 *
 * Extracted from the route handler to keep the GET closure under
 * `complexity: 10` (mirrors `fetchAdminRows` at
 * `notificationRouter.ts:435-455`).
 */
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

/**
 * Build the wire envelope. Maps rows through `auditLogRowToPayload`
 * so the wire shape matches `@surakkha/shared/audit`'s
 * `AuditLogEntrySchema`. The envelope is parse-checked to catch
 * adapter↔schema drift early.
 *
 * Returns `{ kind: "ok", envelope }` on success; surfaces 500 on
 * validation failure (structural drift is a bug).
 */
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

/**
 * The router's dependency surface. Mirrors the alerts / notification
 * router factory shape: every dep is a typed reference the test rig
 * can stub without spinning up Prisma.
 */
export interface AuditLogRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: AuditLogRepository;
}

/**
 * Build the `/api/audit/list` read router. One route on a single
 * Express `Router`.
 *
 * Order of operations:
 *   1. `authenticate()` (mounted upstream) → sets `req.user`.
 *   2. `authorize({ action: "read", resource: "AuditLog" }, audit)`
 *      — Operator / Technician / Viewer → 403 + `rbac_denied`
 *      audit. Admin → continue.
 *   3. `parseAdminQueryParams(req, res)` — Zod parse the query;
 *      a malformed `?since=not-a-date` or `?resource=foo`
 *      surfaces 400. Bad date ranges surface 400.
 *   4. `fetchAuditRows({ repo, filters, res })` — Prisma exception
 *      surfaces 500.
 *   5. `buildAuditEnvelope({ rows, total, truncated, res })` — map
 *      through `auditLogRowToPayload`. The envelope is parse-
 *      checked to catch adapter↔schema drift early.
 *   6. 200 with the envelope.
 *
 * The complexity ceiling stays low (≤10) by extracting the three
 * helpers above (`parseAdminQueryParams`, `fetchAuditRows`,
 * `buildAuditEnvelope`).
 */
export const buildAuditRouter = (deps: AuditLogRouterDeps): Router => {
  const router = express.Router();

  /**
   * GET /api/audit/list — admin audit-lens read view.
   */
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
