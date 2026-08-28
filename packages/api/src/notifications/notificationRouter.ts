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
import { type NotificationRecipientRole } from "@surakkha/shared/notification";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
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

  return router;
};
