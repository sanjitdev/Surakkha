/**
 * `GET /api/alerts` — Story 3.5 (FR-15).
 *
 * Dashboard-facing alert list. Mirrors `incidents/recentRouter.ts:65`
 * factory shape (buildXxxRouter(deps): Router). RBAC:
 * `authorize({ action: "read", resource: "Alert" }, audit)` — all 4
 * roles can read per the matrix at
 * `architecture-appendix-rbac.md` lines 47-50.
 *
 * Pagination: `(openedAt DESC, id DESC)` with an opaque base64url-
 * encoded JSON cursor `{ t: <ms>, i: <uuid> }`. The `id` tie-break
 * handles same-millisecond inserts from multiple devices (per AC9).
 * Default `limit=10`, max `limit=50`; cursor absent on the first
 * page; `next_cursor` non-null iff the returned page is full
 * (`rows.length === limit`).
 *
 * Defaults + filters (AC9 + AC10):
 *   - Default `clearedAt: null` (OPEN-only view). The user's locked
 *     decision: dashboard's main view shows active issues; the
 *     closed-archive requires an explicit `?cleared=true`.
 *   - `?cleared=true|false` overrides the default when present.
 *   - `?acknowledged=true|false` (mutually exclusive — the spec
 *     does NOT define a "no filter" + "filter applied" surface
 *     simultaneously; absence = no filter).
 *   - `?deviceId=<uuid>` (UUID-validated at parse — invalid UUIDs
 *     are 400, not silently propagated).
 *   - `?severity=info|warning|critical` (case-sensitive — uppercase
 *     `CRITICAL` rejected at parse, NOT silently coerced).
 *   - All filters compose as AND; a single `where` object is passed
 *     to the data layer (NOT four separate calls — pinned by
 *     LIST_FILTERS_COMPOSE + LIST_LINKED_ALERTS_BATCHED).
 *
 * Linked-alerts predecessor history (AC11):
 *   - Single batched `prisma.alert.findMany({ where: { OR:
 *     pageRows.map(r => ({ deviceId, metric, severity, id: { not: r.id },
 *     clearedAt: { not: null } })) }, orderBy: { openedAt: 'desc' },
 *     take: pageRows.length * 5 })` per request. Per-row slice to 5.
 *   - The `clearedAt: { not: null }` predicate is load-bearing: the
 *     partial unique index `Alert_open_unique_idx WHERE clearedAt IS
 *     NULL` makes "previous OPEN alert" structurally impossible, so
 *     the predecessor is always CLOSED.
 *   - For CLOSED page rows, `linked_alerts = []` directly (the
 *     predecessor lookup would itself match the closed page row
 *     itself, which is excluded via `id: { not: r.id }` — so the
 *     result is always empty for closed page rows; we skip the
 *     batched lookup entirely when no page rows are OPEN).
 *
 * Why NOT use the 3.4 `findOpenAlert` seam
 * (`packages/api/src/rules/findOpenAlert.ts:78`): the predecessor is
 * always CLOSED (by the partial-index contract), and `findOpenAlert`
 * hardcodes `clearedAt: null`. The batched `findMany({ OR: [...] })`
 * is the right shape for the predecessor-history lookup.
 */
import {
  type AlertLinked,
  type AlertListResponse,
  AlertListResponseSchema,
  AlertSeveritySchema,
  RULE_METRICS,
} from "@surakkha/shared";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
  type AlertCursor,
  type AlertRowShape,
  buildAlertSummary,
  buildNextCursor,
  decodeCursor,
} from "./list.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL_ERROR = 500;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const PREDECESSOR_PER_ROW = 5;

const SEVERITY_VALUES = AlertSeveritySchema.options;
const METRIC_VALUES = RULE_METRICS;

/**
 * Wire shape returned by `listAlerts`. Mirrors the `AlertRowShape`
 * in `list.ts` (the Prisma `select` projection the list helper
 * reads) plus the resolved `linked_alerts` per row. The router
 * fills this from the two data-layer calls (page + predecessor
 * batch) and the `buildAlertSummary` mapper.
 */
export interface AlertListPageRow extends AlertRowShape {
  readonly linkedAlerts: ReadonlyArray<{
    readonly id: string;
    readonly openedAt: Date;
    readonly clearedAt: Date | null;
  }>;
}

export interface AlertListRepository {
  readonly alert: {
    /**
     * Page query — returns up to `limit` rows matching the WHERE
     * clause, ordered `(openedAt DESC, id DESC)`, with the cursor
     * predicate applied as `(openedAt, id) < (cursor.t, cursor.i)`.
     * No cursor → first page (no cursor predicate in WHERE).
     */
    findMany(args: {
      readonly where: Record<string, unknown>;
      readonly orderBy: ReadonlyArray<{ readonly openedAt: "desc" } | { readonly id: "desc" }>;
      readonly take: number;
      readonly select: {
        readonly id: true;
        readonly deviceId: true;
        readonly ruleId: true;
        readonly severity: true;
        readonly metric: true;
        readonly openedAt: true;
        readonly clearedAt: true;
        readonly acknowledgedAt: true;
        readonly acknowledgedByUserId: true;
      };
    }): Promise<readonly AlertRowShape[]>;
    /**
     * Batched predecessor lookup. SINGLE call per request (NOT per
     * page row — pinned by LIST_LINKED_ALERTS_BATCHED). Returns
     * closed predecessors for the page rows' `(deviceId, metric,
     * severity)` keys, ordered `openedAt DESC`, capped at
     * `<pageRows.length> * 5` so the result set is bounded.
     *
     * The page rows themselves are excluded via `id: { notIn: pageIds }`
     * (or per-row `id: { not: r.id }` — production may translate the
     * OR-list to a single `id: { notIn: [...] }` predicate for
     * efficiency; both forms are semantically equivalent because the
     * OR-list's per-branch `id: { not: r.id }` is idempotent under
     * the union). The router passes the OR-list form verbatim.
     */
    findMany(args: {
      readonly where: {
        readonly OR: ReadonlyArray<{
          readonly deviceId: string;
          readonly metric: (typeof METRIC_VALUES)[number];
          readonly severity: (typeof SEVERITY_VALUES)[number];
          readonly id: { readonly not: string };
          readonly clearedAt: { readonly not: null };
        }>;
      };
      readonly orderBy: { readonly openedAt: "desc" };
      readonly take: number;
      readonly select: {
        readonly id: true;
        readonly openedAt: true;
        readonly clearedAt: true;
        readonly deviceId: true;
        readonly metric: true;
        readonly severity: true;
      };
    }): Promise<
      ReadonlyArray<{
        readonly id: string;
        readonly openedAt: Date;
        readonly clearedAt: Date | null;
        readonly deviceId: string;
        readonly metric: (typeof METRIC_VALUES)[number];
        readonly severity: (typeof SEVERITY_VALUES)[number];
      }>
    >;
  };
}

/**
 * Production adapter — narrow the real `@prisma/client` to the
 * `AlertListRepository` slice. Mirrors `resolvePrismaAlertReader`
 * at `rules/findOpenAlert.ts:62`.
 */
export const resolveAlertListRepository = (prisma: unknown): AlertListRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    alert: {
      findMany: (args) => client.alert.findMany(args),
    },
  };
};

export interface AlertListDeps {
  readonly audit: AuditLogger;
  readonly prisma: AlertListRepository;
}

/**
 * Query-string schema (Zod). Every filter is parsed at the boundary
 * so an invalid value never reaches the data layer. Specifically:
 *
 *   - `?limit=banana|51.5|-5|0|51` → 400 (`z.coerce.number().int()
 *     .min(1).max(50)` rejects — non-integers and out-of-range
 *     bypass the `.max(50)` if `.int()` is forgotten).
 *   - `?deviceId=not-a-uuid` → 400 (`z.string().uuid()`).
 *   - `?severity=CRITICAL|banana` → 400 (case-sensitive enum).
 *   - `?acknowledged=banana` → 400 (`z.enum(["true","false"])
 *     .transform(...)` — NOT `z.coerce.boolean()` which would
 *     silently coerce `"banana"` → `true`).
 *   - `?cleared=banana` → 400 (same rationale).
 *   - `?cursor=banana` → 400 (decoded by `decodeCursor`; base64/
 *     JSON/shape failures all surface as 400, NOT 500).
 *
 * `transform` on `?acknowledged` / `?cleared` keeps the parsed
 * shape typed (`boolean`) so the WHERE-builder can branch without
 * a separate `=== "true"` check at every call site.
 */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  deviceId: z.string().uuid().optional(),
  severity: AlertSeveritySchema.optional(),
  acknowledged: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cleared: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cursor: z
    .string()
    .min(1)
    // DoS guard: a malicious actor could otherwise send a multi-MB
    // opaque cursor that forces an unbounded base64-decode + JSON.parse
    // + Zod-validate cycle on every request. The legitimate cursor
    // payload is `btoa(JSON.stringify({ t: <ms>, i: <uuid> }))` —
    // ~80 chars. 1024 is 12× headroom for future schema evolution
    // (e.g. adding a `v: 2` discriminator) and well under any
    // realistic client or proxy header limit. Rejected as
    // `validation_error` (400) at parse — never reaches `decodeCursor`.
    .max(1024)
    .optional(),
});

/**
 * Build the `where` object passed to `prisma.alert.findMany`.
 *
 * Default behaviour (no `cleared` filter): `clearedAt: null`
 * (OPEN-only view per AC9 + user's locked decision).
 *
 * `?cleared=true` → `clearedAt: { not: null }` (closed archive).
 * `?cleared=false` → `clearedAt: null` (explicit override of the
 * default; semantically the same as the default but pinned by
 * LIST_FILTER_CLEARED_FALSE so the test rig asserts the override).
 *
 * All other filters compose as AND; no OR-leakage (a single
 * `where` object passed to Prisma).
 *
 * `cursor` is decoded to a `(t, i)` tuple and added as a separate
 * pair-keyed predicate. The row-comparison
 * `(openedAt, id) < (cursor.t, cursor.i)` for `DESC, DESC` ordering
 * translates to `(openedAt < cursor.t) OR (openedAt = cursor.t AND
 * id < cursor.i)` — Prisma's `OR` form is the canonical encoding
 * and Postgres evaluates it under the `(openedAt DESC, id DESC)`
 * index scan. For the simpler first-page case (no cursor), this
 * predicate is omitted entirely.
 */
const buildWhere = (
  filters: z.infer<typeof querySchema>,
  cursor: AlertCursor | null,
): Record<string, unknown> => {
  const where: Record<string, unknown> = {};

  // `clearedAt` default + override (AC9). The default (no filter)
  // and the explicit `?cleared=false` override are semantically
  // identical (both → `clearedAt: null`); the explicit override
  // exists so the wire response carries the user's intent in
  // `?cleared=false` round-trips (LIST_FILTER_CLEARED_FALSE pins
  // this branch separately).
  if (filters.cleared === true) {
    where["clearedAt"] = { not: null };
  } else {
    where["clearedAt"] = null;
  }

  if (filters.deviceId !== undefined) where["deviceId"] = filters.deviceId;
  if (filters.severity !== undefined) where["severity"] = filters.severity;
  if (filters.acknowledged === true) {
    where["acknowledgedAt"] = { not: null };
  } else if (filters.acknowledged === false) {
    where["acknowledgedAt"] = null;
  }

  if (cursor !== null) {
    // (openedAt, id) < (cursor.t, cursor.i) under DESC, DESC ordering.
    // Prisma's row-comparison form: `(openedAt < t) OR (openedAt = t AND id < i)`.
    where["OR"] = [
      { openedAt: { lt: new Date(cursor.t) } },
      {
        openedAt: new Date(cursor.t),
        id: { lt: cursor.i },
      },
    ];
  }

  return where;
};

/**
 * Build the `/api/alerts` router. Single route: `GET /api/alerts`.
 *
 * Order of operations on the hot path:
 *   1. `authenticate()` (mounted upstream) → sets `req.user`.
 *   2. `authorize({ action: "read", resource: "Alert" }, audit)` →
 *      all 4 roles allowed; the middleware also writes a
 *      `rbac_allowed` audit row on the allow path (per the existing
 *      `authorize()` middleware at
 *      `packages/api/src/middleware/authorize.ts:189`).
 *   3. Zod parse `req.query` → 400 on any invalid filter (with
 *      `issues` from Zod).
 *   4. Decode `?cursor=<opaque>` → 400 on base64/JSON/shape failure.
 *   5. `prisma.alert.findMany({ where, orderBy, take })` for the page.
 *   6. If page is non-empty AND has at least one OPEN row, run ONE
 *      batched `prisma.alert.findMany({ where: { OR: [...] }, ... })`
 *      for predecessor history. (CLOSED page rows get `linked_alerts = []`
 *      directly — no lookup, per AC11.)
 *   7. Map per-page-row predecessor slice via `buildAlertSummary`.
 *   8. Build `next_cursor` from the last page row iff
 *      `rows.length === limit`.
 *   9. 500 on any `prisma` throw.
 */
export const buildAlertListRouter = (deps: AlertListDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/alerts",
    authorize({ action: "read", resource: "Alert" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: "validation_error",
          issues: parsed.error.issues,
        });
        return;
      }
      const filters = parsed.data;
      const limit = filters.limit ?? DEFAULT_LIMIT;

      let cursor: AlertCursor | null = null;
      if (filters.cursor !== undefined) {
        try {
          cursor = decodeCursor(filters.cursor);
        } catch (err) {
          // base64 decode failure, JSON parse failure, or shape
          // mismatch — all surface as 400 (NOT 500). The cursor is
          // opaque to the client; the Zod schema in `list.ts`
          // validates the `{ t, i }` shape.
          console.warn("[alerts] list cursor decode failed", err);
          res.status(HTTP_BAD_REQUEST).json({
            error: "validation_error",
            issues: [
              {
                code: "invalid_cursor",
                path: ["cursor"],
                message: "opaque cursor failed decode",
              },
            ],
          });
          return;
        }
      }

      const where = buildWhere(filters, cursor);

      try {
        const rows = await deps.prisma.alert.findMany({
          where,
          orderBy: [{ openedAt: "desc" }, { id: "desc" }],
          take: limit,
          select: {
            id: true,
            deviceId: true,
            ruleId: true,
            severity: true,
            metric: true,
            openedAt: true,
            clearedAt: true,
            acknowledgedAt: true,
            acknowledgedByUserId: true,
          },
        });

        // Linked-alerts predecessor lookup. AC11: batched into a
        // SINGLE `findMany({ where: { OR: [...pageRowKeys] } })` call
        // — NOT one-per-row. Closed page rows have no predecessors
        // (the partial unique index makes "previous OPEN alert"
        // structurally impossible, and the lookup would match the
        // closed page row itself, which is excluded via `id: { not: r.id }`).
        // Skip the lookup entirely if no page rows are OPEN.
        const openRows = rows.filter((r) => r.clearedAt === null);
        let predecessorGroups: ReadonlyArray<{
          readonly id: string;
          readonly openedAt: Date;
          readonly clearedAt: Date | null;
          readonly deviceId: string;
          readonly metric: (typeof METRIC_VALUES)[number];
          readonly severity: (typeof SEVERITY_VALUES)[number];
        }> = [];
        if (openRows.length > 0) {
          predecessorGroups = await deps.prisma.alert.findMany({
            where: {
              OR: openRows.map((r) => ({
                deviceId: r.deviceId,
                metric: r.metric,
                severity: r.severity,
                id: { not: r.id },
                clearedAt: { not: null },
              })),
            },
            orderBy: { openedAt: "desc" },
            take: openRows.length * PREDECESSOR_PER_ROW,
            select: {
              id: true,
              openedAt: true,
              clearedAt: true,
              deviceId: true,
              metric: true,
              severity: true,
            },
          });
        }

        // Group predecessors by (deviceId, metric, severity) key
        // tuple. The per-row slice is the first PREDECESSOR_PER_ROW
        // entries in `openedAt DESC` order (the batched query
        // already ordered the union; per-key slicing preserves
        // that order). Returns the wire `AlertLinked` shape so the
        // caller can pass directly to `buildAlertSummary`.
        const groupByKey = (
          deviceId: string,
          metric: (typeof METRIC_VALUES)[number],
          severity: (typeof SEVERITY_VALUES)[number],
        ): readonly AlertLinked[] =>
          predecessorGroups
            .filter(
              (p) => p.deviceId === deviceId && p.metric === metric && p.severity === severity,
            )
            .slice(0, PREDECESSOR_PER_ROW)
            .map((p) => ({
              id: p.id,
              opened_at: p.openedAt.toISOString(),
              cleared_at:
                p.clearedAt === null || p.clearedAt === undefined
                  ? null
                  : p.clearedAt.toISOString(),
            }));

        const summaries = rows.map((row) => {
          const linkedAlerts =
            row.clearedAt === null ? groupByKey(row.deviceId, row.metric, row.severity) : [];
          return buildAlertSummary(row, linkedAlerts);
        });

        const nextCursor = buildNextCursor(rows, limit);
        const body: AlertListResponse = {
          alerts: summaries,
          next_cursor: nextCursor,
        };
        // `.safeParse(...).success` is preferred over `.parse(body)` so
        // a future schema drift doesn't throw `ZodError` after headers
        // were sent (which would leave Express's default HTML 500).
        // The body is structurally pinned by the TypeScript types; the
        // safeParse is a guard rail against future drift.
        const validated = AlertListResponseSchema.safeParse(body);
        if (!validated.success) {
          console.error("[alerts] list: response schema drift", validated.error);
          res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
          return;
        }
        res.status(HTTP_OK).json(validated.data);
      } catch (err) {
        // AC7-equivalent: dashboard regions render empty states on
        // any read failure; surface 500 so TanStack Query marks the
        // query `isError`.
        console.error("api/alerts: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
      }
    },
  );

  return router;
};
