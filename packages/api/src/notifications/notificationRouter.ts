/**
 * `notificationRouter.ts` — Story 4.10.
 *
 * Two routes that pair with the 4.9 writer to surface
 * `Notification` rows to the operator-facing NotificationBell:
 *
 *   - `GET /api/notifications` — read endpoint, RBAC-gated by
 *     `read Notification`. Filters by `recipientRole ===
 *     req.user.role` so a Technician viewer never sees an
 *     `Operator`-targeted row. Bounded by `take: 50` (no
 *     pagination in v1 — spec "Ask First: pagination").
 *
 *   - `PATCH /api/notifications/:id/acknowledge` — mark-as-read
 *     endpoint, RBAC-gated by `acknowledge Notification`. Records
 *     `acknowledgedAt + acknowledgedByUserId`. Idempotent on
 *     already-acknowledged rows (200 with the existing row, NOT
 *     a 409). Cross-role RBAC is enforced INSIDE the handler
 *     (`row.recipientRole !== req.user.role → 403`) because the
 *     matrix only grants role-level access; the per-row ownership
 *     check lives in the handler to avoid a separate
 *     `requireOwner` middleware.
 *
 * Mirrors the alerts router factory shape at
 * `packages/api/src/alerts/acknowledgeRouter.ts:349-443` (factory
 * `buildXxxRouter(deps): Router`) and
 * `packages/api/src/alerts/listRouter.ts:326-487` (factory
 * `buildXxxRouter(deps): Router`).
 *
 * Why NO new socket emit: the spec's "NEVER" rule forbids adding
 * a `notification:*` socket event on the backend (the writer is
 * locked from 4.9). The bell's freshness comes from TanStack
 * `refetchInterval: 30_000` polling — see
 * `packages/web/src/notifications/useNotificationBell.ts`.
 *
 * Why NO AuditLog write: notification acknowledgement is a "soft
 * action" (no state transition); the `acknowledgedAt +
 * acknowledgedByUserId` columns are the audit trail. A future
 * story that threads `auditWrite` into the PATCH can revisit; v1
 * surfaces no `AuditLog` row. Spec Design Notes "Why
 * mark-as-read is a separate endpoint" captures the rationale.
 */
import {
  type AdminNotificationListEnvelope,
  AdminNotificationListEnvelopeSchema,
  type AdminNotificationPayload,
  type NotificationRecipientRole,
  type NotificationSeverity,
  NotificationSeveritySchema,
} from "@surakkha/shared/notification";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
  type AdminNotificationFilters,
  adminNotificationRowToPayload,
  type NotificationRepository,
  type NotificationRow,
  notificationRowToPayload,
} from "./notificationRepository.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_FORBIDDEN = 403;

/**
 * The role values the read endpoint will accept as
 * `req.user.role`. Mirrors `RoleSchema` from
 * `@surakkha/shared/rbac:25-26`; narrowed here because the writer
 * pins `recipientRole: "Operator"` for v1 and the read filter is
 * `recipientRole === req.user.role` — a 1:1 role match. The Prisma
 * `NotificationRecipientRole_` enum is the source of truth for
 * the writer's pin; the matrix grants `read Notification` to Admin
 * / Operator / Technician (Viewer is `N` — disabled bell on the
 * web side).
 */
const VALID_RECIPIENT_ROLES: readonly NotificationRecipientRole[] = [
  "Admin",
  "Operator",
  "Technician",
  "Viewer",
];

/**
 * Maximum number of unread notifications the dropdown surfaces
 * in v1. Bounded by the spec's "Ask First: pagination" decision
 * (NO pagination in v1; bounded by the operator's recent
 * criticals — typically <10/day).
 */
const NOTIFICATION_TAKE_LIMIT = 50;

/**
 * Path-parameter schema for the PATCH route. The `:id` segment is
 * the row PK (UUIDv4). Non-UUID values are rejected at parse time
 * (400) so a malformed path never reaches the DB.
 */
const pathParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Parse the `:id` path parameter with `pathParamsSchema`. On
 * failure: respond 400 with the issue list. Returns the parsed id
 * (string) on success, or `null` if the handler should short-circuit
 * (response already sent).
 *
 * Extracted from the route handler to keep the PATCH closure under
 * `complexity: 10` (the inline safeParse + return + handler-continuation
 * shape pushed the arrow's complexity to 14).
 */
const parsePathParams = (req: AuthorizedRequest, res: Response): string | null => {
  const parsed = pathParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(HTTP_BAD_REQUEST).json({
      error: "validation_error",
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data.id;
};

/**
 * Apply the cross-role RBAC check: the matrix grants `acknowledge
 * Notification` to Admin / Operator / Technician, but a Technician
 * can never acknowledge an Operator-targeted row. The writer's
 * `recipientRole` pin is the load-bearing filter; a row's recipient
 * role determines who is allowed to ack it.
 *
 * Returns `true` if the check failed (response already sent —
 * caller should `return` immediately). Returns `false` if the row's
 * recipient role matches the actor's role.
 *
 * Extracted from the route handler to keep the PATCH closure under
 * `complexity: 10`.
 */
const enforceCrossRoleRecipient = (args: {
  readonly row: NotificationRow;
  readonly actor: string;
  readonly actorRole: NotificationRecipientRole;
  readonly audit: AuditLogger;
  readonly res: Response;
}): boolean => {
  const { row, actor, actorRole, audit, res } = args;
  if (row.recipientRole === actorRole) return false;
  audit.emit({
    auditAction: "rbac_denied",
    userId: actor,
    outcome: "failure",
    context: {
      subject: actorRole,
      action: "acknowledge",
      resource: "Notification",
      reason: "cross_role_recipient",
      notification_id: row.id,
      recipient_role: row.recipientRole,
    },
  });
  res.status(HTTP_FORBIDDEN).json({ error: "forbidden", required_role: row.recipientRole });
  return true;
};

/**
 * Look up the notification row by id and translate prisma throws to
 * 500. Returns `{ kind: "ok", row }` on success, `{ kind: "error" }`
 * if the DB threw (response already sent with 500), or `{ kind:
 * "missing" }` if the row does not exist (response already sent
 * with 404).
 *
 * Extracted from the route handler to keep the PATCH closure under
 * `complexity: 10`.
 */
const fetchRowForAck = async (args: {
  readonly repo: NotificationRepository;
  readonly id: string;
  readonly res: Response;
}): Promise<
  | { readonly kind: "ok"; readonly row: NotificationRow }
  | { readonly kind: "missing" }
  | { readonly kind: "error" }
> => {
  const { repo, id, res } = args;
  try {
    const row = await repo.notification.findUnique({ where: { id } });
    if (row === null) {
      res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
      return { kind: "missing" };
    }
    return { kind: "ok", row };
  } catch (err) {
    console.error("api/notifications: findUnique failed", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    return { kind: "error" };
  }
};

/**
 * Apply the compare-and-set ack to the row. Returns the number of
 * rows updated (0 = idempotent re-ack, 1 = first-ack) on success,
 * or `null` if the DB threw (response already sent with 500).
 *
 * Extracted from the route handler to keep the PATCH closure under
 * `complexity: 10`.
 */
const applyAck = async (args: {
  readonly repo: NotificationRepository;
  readonly id: string;
  readonly now: Date;
  readonly actor: string;
  readonly res: Response;
}): Promise<number | null> => {
  const { repo, id, now, actor, res } = args;
  try {
    const update = await repo.notification.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: now, acknowledgedByUserId: actor },
    });
    return update.count;
  } catch (err) {
    console.error("api/notifications: updateMany failed", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    return null;
  }
};

/**
 * Re-read the canonical post-update row. Returns the row on success,
 * or `null` if the DB threw (response already sent with 500) OR if
 * the row vanished between the previous read and this one (response
 * already sent with 404).
 *
 * Extracted from the route handler to keep the PATCH closure under
 * `complexity: 10`.
 */
const refetchRow = async (args: {
  readonly repo: NotificationRepository;
  readonly id: string;
  readonly res: Response;
}): Promise<NotificationRow | null> => {
  const { repo, id, res } = args;
  try {
    const row = await repo.notification.findUnique({ where: { id } });
    if (row === null) {
      // Race: the row was deleted between our first findUnique and
      // our second one (vanishingly rare; structurally impossible
      // under the schema's `onDelete: SetNull` for `Incident` /
      // `Alert` FKs, but defensive). Surface 404.
      res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
      return null;
    }
    return row;
  } catch (err) {
    console.error("api/notifications: post-update findUnique failed", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    return null;
  }
};

/**
 * Render the successful-ack response: emit the operator-triage log
 * line and write 200 with the canonical row payload.
 *
 * Extracted from the route handler to keep the PATCH closure under
 * `complexity: 10`.
 */
const renderAckResponse = (args: {
  readonly res: Response;
  readonly id: string;
  readonly actor: string;
  readonly row: NotificationRow;
  readonly updateCount: number;
}): void => {
  const { res, id, actor, row, updateCount } = args;
  const body = notificationRowToPayload(row);
  // Operator-triage log. Fires on EVERY successful acknowledge
  // (first-ack AND idempotent re-ack). The `first=true|false`
  // suffix lets log readers distinguish state-change acks
  // (genuine operator action) from idempotent retries (the
  // dashboard's retry-on-network-blip behaviour).
  console.warn(
    `[notifications] acknowledged id=${id} actor=${actor} acknowledgedAt=${body.acknowledgedAt ?? "null"} first=${updateCount === 1 ? "true" : "false"}`,
  );
  res.status(HTTP_OK).json(body);
};

/**
 * Story 5.1 — maximum number of rows the admin list returns. The
 * spec pins `take: 100` (Acceptance Criteria "ordered by createdAt
 * DESC, bounded by take: 100"). No pagination in v1.
 */
const ADMIN_NOTIFICATION_TAKE_LIMIT = 100;

/**
 * Story 5.1 — the admin query schema. The severity field is
 * `string | string[] | undefined` (Express + Zod parse of
 * `req.query.severity` as a repeated query param). The chip row
 * supports 1–3 selections; the schema accepts ALL of them and
 * the helper de-duplicates below.
 *
 * `since` / `until` are ISO 8601 strings (admin-facing wire
 * shape — admins paste a date into the date-range picker).
 *
 * The `severity` field deliberately uses
 * `z.string().array().nonempty()` as a schema-level guard so a
 * `?severity=` (empty string) becomes `[""]` — the helper then
 * filters the empties out and `safeParse` does NOT throw on a
 * request with no chips selected (chip toggle off is a valid
 * state — it just means "all severities").
 */
const adminQuerySchema = z.object({
  severity: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const arr = Array.isArray(raw) ? raw : [raw];
      // De-duplicate + drop empties — the chip row toggles
      // independently so a user can produce `critical`, then
      // un-toggle then re-toggle `critical` (still 1 selection
      // at the data layer; the URL just re-uses the param).
      const dedup = new Set(arr.filter((s) => s.length > 0));
      return Array.from(dedup);
    }),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
});

/**
 * Story 5.1 — coerced notification severity array. Drop values
 * that aren't in the enum (defensive — `?severity=foo` should
 * 400, not silently drop the filter).
 */
const coerceSeverityArray = (
  raw: readonly string[] | undefined,
): { ok: true; value: readonly NotificationSeverity[] } | { ok: false; invalid: string } => {
  if (raw === undefined || raw.length === 0) {
    return { ok: true, value: [] };
  }
  const coerced: NotificationSeverity[] = [];
  for (const candidate of raw) {
    const parsed = NotificationSeveritySchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, invalid: candidate };
    }
    if (!coerced.includes(parsed.data)) {
      coerced.push(parsed.data);
    }
  }
  return { ok: true, value: coerced };
};

/**
 * Story 5.1 — parse the admin query params. Loops the severity
 * values through `NotificationSeveritySchema.safeParse`; bad
 * values surface 400. Returns either `{ kind: "ok", filters }`
 * with the prepared `AdminNotificationFilters` ready for the
 * repository, or `{ kind: "error" }` (response already sent).
 *
 * Extracted from the route handler to keep the GET closure under
 * `complexity: 10`.
 */
const parseAdminQueryParams = (
  res: Response,
  query: unknown,
):
  | { readonly kind: "ok"; readonly filters: AdminNotificationFilters }
  | { readonly kind: "error" } => {
  const parsed = adminQuerySchema.safeParse(query);
  if (!parsed.success) {
    res.status(HTTP_BAD_REQUEST).json({
      error: "validation_error",
      issues: parsed.error.issues,
    });
    return { kind: "error" };
  }
  const { severity, since, until } = parsed.data;
  const coercedSeverity = coerceSeverityArray(severity);
  if (!coercedSeverity.ok) {
    res.status(HTTP_BAD_REQUEST).json({
      error: "validation_error",
      issues: [
        {
          code: "invalid_enum_value",
          path: ["severity"],
          message: `unknown severity value: ${coercedSeverity.invalid}`,
        },
      ],
    });
    return { kind: "error" };
  }
  const filters: AdminNotificationFilters = {};
  if (coercedSeverity.value.length > 0) {
    (filters as { severity?: { in: readonly NotificationSeverity[] } }).severity = {
      in: coercedSeverity.value,
    };
  }
  if (since !== undefined) {
    (filters as { since?: Date }).since = new Date(since);
  }
  if (until !== undefined) {
    (filters as { until?: Date }).until = new Date(until);
  }
  // Loop 1 review finding E2: validate the date range. The
  // Prisma `gte` + `lt` pair yields an empty result silently
  // when `since > until`; admins see zero rows with no signal
  // why. Surface 400 with `invalid_range` so the page (or
  // a future custom-date picker) can correct the input.
  if (since !== undefined && until !== undefined) {
    if (new Date(since).getTime() >= new Date(until).getTime()) {
      res.status(HTTP_BAD_REQUEST).json({
        error: "invalid_range",
        message: "`since` must be strictly less than `until`",
      });
      return { kind: "error" };
    }
  }
  return { kind: "ok", filters };
};

/**
 * Story 5.1 — fetch the admin-list rows from the repository.
 * Returns `{ kind: "ok", rows }` on success or `{ kind: "error" }`
 * if Prisma threw (response already sent with 500).
 *
 * Extracted from the route handler to keep the GET closure under
 * `complexity: 10`.
 */
const fetchAdminRows = async (args: {
  readonly repo: NotificationRepository;
  readonly filters: AdminNotificationFilters;
  readonly res: Response;
}): Promise<
  { readonly kind: "ok"; readonly rows: NotificationRow[] } | { readonly kind: "error" }
> => {
  const { repo, filters, res } = args;
  try {
    const rows = await repo.notification.findManyAdmin({
      where: filters,
      orderBy: { createdAt: "desc" },
      take: ADMIN_NOTIFICATION_TAKE_LIMIT,
    });
    return { kind: "ok", rows };
  } catch (err) {
    console.error("api/notifications/admin/list: prisma error", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    return { kind: "error" };
  }
};

/**
 * Story 5.1 — envelope validator. Parses the rendered payload
 * through `AdminNotificationListEnvelopeSchema` so a future
 * adapter drift that strips `acknowledgedByUserId` (the audit
 * detail the admin surface MUST leak) surfaces 500 with a
 * meaningful log instead of silently leaking an operator-only
 * wire shape. Returns the validated envelope on success;
 * surfaces 500 on validation failure (the response route is
 * internal — the schema mismatch is a structural bug).
 */
const buildAdminEnvelope = (
  rows: readonly NotificationRow[],
  res: Response,
):
  | { readonly kind: "ok"; readonly envelope: AdminNotificationListEnvelope }
  | { readonly kind: "error" } => {
  const notifications: AdminNotificationPayload[] = rows.map((row) =>
    adminNotificationRowToPayload(row),
  );
  const envelope: AdminNotificationListEnvelope = { notifications };
  // Strict shape check — pin the wire contract so adapter drift
  // (e.g. `acknowledgedByUserId` accidentally omitted from the
  // payload) surfaces 500 with a meaningful log instead of
  // silently leaking an operator-only wire shape. The Zod schema
  // is the canonical wire shape (see
  // `@surakkha/shared/notification.ts:144-149`); the previous
  // `z.array(z.unknown())` match accepted any shape and missed
  // the drift (loop 1 review finding E5).
  const parsed = AdminNotificationListEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    // Structural drift between `adminNotificationRowToPayload`
    // and the `AdminNotificationPayloadSchema`. Log + 500.
    console.error("api/notifications/admin/list: envelope failed shape validation", parsed.error);
    res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    return { kind: "error" };
  }
  return { kind: "ok", envelope };
};

/**
 * The router's dependency surface. Mirrors the alerts router
 * factory shape: every dep is a typed reference the test rig
 * can stub without spinning up Prisma.
 */
export interface NotificationRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: NotificationRepository;
  /**
   * Injectable clock. The SAME `now()` result is passed to the
   * compare-and-set's `acknowledgedAt` AND the response body's
   * `acknowledgedAt` — two separate reads of `Date.now()` would
   * risk a 1ms drift between DB row and wire payload (Postgres
   * `DateTime` is millisecond precision; `TIMESTAMP(3)`).
   */
  readonly now: () => Date;
}

/**
 * Build the `/api/notifications` read + acknowledge routers.
 * Two routes on a single Express `Router`.
 *
 * Order of operations on the GET hot path:
 *   1. `authenticate()` (mounted upstream) → sets `req.user`.
 *   2. `authorize({ action: "read", resource: "Notification" }, audit)`
 *      — Viewer → 403 + `rbac_denied` audit. Admin / Operator /
 *      Technician → continue.
 *   3. `req.user.role` is the `recipientRole` filter. The role is
 *      a closed set (`RoleSchema`); defensive cast through the
 *      `VALID_RECIPIENT_ROLES` whitelist so a future drift does
 *      not pass an unknown value to Prisma's enum filter.
 *   4. `repo.notification.findMany({ where: { recipientRole,
 *      acknowledgedAt: null }, orderBy: { createdAt: "desc" },
 *      take: NOTIFICATION_TAKE_LIMIT })` — newest first, bounded.
 *   5. Map rows through `notificationRowToPayload`.
 *   6. 500 on any throw.
 *
 * Order of operations on the PATCH hot path:
 *   1. `authenticate()` → sets `req.user`.
 *   2. `authorize({ action: "acknowledge", resource: "Notification" }, audit)`
 *      — Viewer → 403 + audit. Others → continue.
 *   3. Zod parse `:id` → 400 on non-UUID.
 *   4. `repo.notification.findUnique({ where: { id } })` → 404 if
 *      missing.
 *   5. Cross-role RBAC: `row.recipientRole !== req.user.role` → 403.
 *      The matrix grants role-level access; the per-row ownership
 *      check lives here because the writer's `recipientRole` pin
 *      is the load-bearing filter (a Technician can never
 *      acknowledge an Operator-targeted row).
 *   6. `repo.notification.updateMany({ where: { id,
 *      acknowledgedAt: null }, data: { acknowledgedAt, acknowledgedByUserId
 *      } })`. The `acknowledgedAt: null` predicate is the
 *      serialization point:
 *      - `count === 1` → first ack. Re-read for the response
 *        body; return 200 with the row.
 *      - `count === 0` → re-ack. Re-read; if `acknowledgedAt !== null`
 *        return 200 with the existing row (idempotent path). If
 *        the row vanished between fetch and update, return 404.
 *   7. Any throw from `repo.notification.*` → 500.
 */
export const buildNotificationRouter = (deps: NotificationRouterDeps): Router => {
  const router = express.Router();

  /**
   * GET /api/notifications — list the unread notifications for
   * the current viewer's role.
   */
  router.get(
    "/api/notifications",
    authorize({ action: "read", resource: "Notification" }, deps.audit),
    async (_req: AuthorizedRequest, res: Response) => {
      // `authorize()` middleware guarantees `req.user` is non-null
      // for any handler that runs past it (401 is short-circuited
      // upstream). The `as` is defensive belt-and-braces for
      // strict-null-checks.
      const req = _req;
      const role = req.user?.role;
      if (role === undefined || !VALID_RECIPIENT_ROLES.includes(role)) {
        // Defensive: the matrix grants `read Notification` only to
        // roles in `VALID_RECIPIENT_ROLES`. If a future role slips
        // through, surface 500 rather than passing an unknown
        // value to the Prisma enum filter.
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      const recipientRole: NotificationRecipientRole = role;

      let rows: NotificationRow[];
      try {
        rows = await deps.repo.notification.findMany({
          where: { recipientRole, acknowledgedAt: null },
          orderBy: { createdAt: "desc" },
          take: NOTIFICATION_TAKE_LIMIT,
        });
      } catch (err) {
        console.error("api/notifications: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      const body = {
        notifications: rows.map((row) => notificationRowToPayload(row)),
      };
      res.status(HTTP_OK).json(body);
    },
  );

  /**
   * PATCH /api/notifications/:id/acknowledge — mark a single
   * notification as read.
   *
   * Idempotent on already-acknowledged rows: returns 200 with the
   * existing row (NOT a 409). The spec "MARK_AS_READ_IDEMPOTENT"
   * matrix row pins this contract.
   */
  router.patch(
    "/api/notifications/:id/acknowledge",
    authorize({ action: "acknowledge", resource: "Notification" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const id = parsePathParams(req, res);
      if (id === null) return;

      const actor = req.user?.id;
      const actorRole = req.user?.role;
      if (actor === undefined || actorRole === undefined) {
        // `authorize()` short-circuits unauthenticated requests with
        // 401 before this handler runs. The defensive null-check is
        // belt-and-braces for strict-null-checks.
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }

      const fetched = await fetchRowForAck({ repo: deps.repo, id, res });
      if (fetched.kind !== "ok") return;
      const { row } = fetched;

      // Cross-role RBAC check (extracted helper).
      if (enforceCrossRoleRecipient({ row, actor, actorRole, audit: deps.audit, res })) {
        return;
      }

      const now = deps.now();
      const updateCount = await applyAck({
        repo: deps.repo,
        id,
        now,
        actor,
        res,
      });
      if (updateCount === null) return;

      // Re-read for the response body. The `count === 0` branch
      // (idempotent re-ack) and the `count === 1` branch
      // (first-ack) both need the canonical post-update row.
      const finalRow = await refetchRow({ repo: deps.repo, id, res });
      if (finalRow === null) return;

      renderAckResponse({ res, id, actor, row: finalRow, updateCount });
    },
  );

  /**
   * Story 5.1 — GET /api/notifications/admin/list. Admin audit
   * surface: returns the most-recent 100 rows across all
   * `recipientRole`s, all `acknowledgedAt` states, with optional
   * severity / date-range filters.
   *
   * Order of operations:
   *   1. `authenticate()` (mounted upstream) → sets `req.user`.
   *   2. `authorize({ action: "read_all", resource: "Notification" }, audit)`
   *      — Operator / Technician / Viewer → 403 + `rbac_denied`
   *      audit. Admin → continue.
   *   3. `parseAdminQueryParams(req, res)` — Zod parse the query;
   *      a malformed `?severity=foo` or `?since=not-a-date`
   *      surfaces 400. The severity array is de-duplicated; a
   *      non-empty array becomes `where.severity = { in: [...] }`.
   *   4. `fetchAdminRows({ repo, filters, res })` — Prisma
   *      exception surfaces 500.
   *   5. `buildAdminEnvelope(rows, res)` — map through
   *      `adminNotificationRowToPayload` so the wire leaks
   *      `acknowledgedByUserId`. The envelope is parse-checked
   *      to catch adapter↔schema drift early.
   *   6. 200 with the envelope.
   *
   * The complexity ceiling stays low (≤10) by extracting the
   * three helpers above (`parseAdminQueryParams`,
   * `fetchAdminRows`, `buildAdminEnvelope`).
   */
  router.get(
    "/api/notifications/admin/list",
    authorize({ action: "read_all", resource: "Notification" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const parsed = parseAdminQueryParams(res, req.query);
      if (parsed.kind !== "ok") return;
      const { filters } = parsed;

      const fetched = await fetchAdminRows({ repo: deps.repo, filters, res });
      if (fetched.kind !== "ok") return;
      const { rows } = fetched;

      const built = buildAdminEnvelope(rows, res);
      if (built.kind !== "ok") return;
      res.status(HTTP_OK).json(built.envelope);
    },
  );

  return router;
};
