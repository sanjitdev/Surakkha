/**
 * Three routes on `/api/notifications`:
 *   - GET    /api/notifications                  — role-scoped unread list (take: 50)
 *   - PATCH  /api/notifications/:id/acknowledge  — idempotent mark-as-read
 *   - GET    /api/notifications/admin/list       — Admin-only audit surface (take: 100)
 *
 * The PATCH handler is idempotent on already-acknowledged rows
 * (200 with the existing row, NOT 409). Cross-role RBAC is enforced
 * per-row inside the handler.
 */
import {
  type AdminNotificationListEnvelope,
  AdminNotificationListEnvelopeSchema,
  type AdminNotificationPayload,
  type NotificationRecipientRole,
  type NotificationSeverity,
  NotificationSeveritySchema,
} from "@surakkha/shared/notification";
import { idPathSchema } from "@surakkha/shared/schemas";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import {
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_INTERNAL_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from "../httpStatus.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
  type AdminNotificationFilters,
  adminNotificationRowToPayload,
  type NotificationRepository,
  type NotificationRow,
  notificationRowToPayload,
} from "./notificationRepository.js";

const VALID_RECIPIENT_ROLES: readonly NotificationRecipientRole[] = [
  "Admin",
  "Operator",
  "Technician",
  "Viewer",
];

const NOTIFICATION_TAKE_LIMIT = 50;
const ADMIN_NOTIFICATION_TAKE_LIMIT = 100;

const pathParamsSchema = idPathSchema;

/** Helpers below are extracted to keep the PATCH / GET closures
 *  under the ESLint complexity ceiling. */

const parsePathParams = (req: AuthorizedRequest, res: Response): string | null => {
  const parsed = pathParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(HTTP_BAD_REQUEST).json({
      error: ERROR_CODES.VALIDATION_ERROR.value,
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data.id;
};

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
  res
    .status(HTTP_FORBIDDEN)
    .json({ error: ERROR_CODES.FORBIDDEN.value, required_role: row.recipientRole });
  return true;
};

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
      res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
      return { kind: "missing" };
    }
    return { kind: "ok", row };
  } catch (err) {
    console.error("api/notifications: findUnique failed", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return { kind: "error" };
  }
};

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
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return null;
  }
};

const refetchRow = async (args: {
  readonly repo: NotificationRepository;
  readonly id: string;
  readonly res: Response;
}): Promise<NotificationRow | null> => {
  const { repo, id, res } = args;
  try {
    const row = await repo.notification.findUnique({ where: { id } });
    if (row === null) {
      // Vanishingly rare race — row vanished between first read and
      // second (structurally impossible under `onDelete: SetNull` for
      // Incident / Alert FKs, but defensive).
      res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
      return null;
    }
    return row;
  } catch (err) {
    console.error("api/notifications: post-update findUnique failed", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return null;
  }
};

const renderAckResponse = (args: {
  readonly res: Response;
  readonly id: string;
  readonly actor: string;
  readonly row: NotificationRow;
  readonly updateCount: number;
}): void => {
  const { res, id, actor, row, updateCount } = args;
  const body = notificationRowToPayload(row);
  console.warn(
    `[notifications] acknowledged id=${id} actor=${actor} acknowledgedAt=${body.acknowledgedAt ?? "null"} first=${updateCount === 1 ? "true" : "false"}`,
  );
  res.status(HTTP_OK).json(body);
};

const adminQuerySchema = z.object({
  severity: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const arr = Array.isArray(raw) ? raw : [raw];
      // De-duplicate + drop empties; an empty array is the canonical
      // "all severities" signal (chip toggle off).
      const dedup = new Set(arr.filter((s) => s.length > 0));
      return Array.from(dedup);
    }),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
});

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

const parseAdminQueryParams = (
  res: Response,
  query: unknown,
):
  | { readonly kind: "ok"; readonly filters: AdminNotificationFilters }
  | { readonly kind: "error" } => {
  const parsed = adminQuerySchema.safeParse(query);
  if (!parsed.success) {
    res.status(HTTP_BAD_REQUEST).json({
      error: ERROR_CODES.VALIDATION_ERROR.value,
      issues: parsed.error.issues,
    });
    return { kind: "error" };
  }
  const { severity, since, until } = parsed.data;
  const coercedSeverity = coerceSeverityArray(severity);
  if (!coercedSeverity.ok) {
    res.status(HTTP_BAD_REQUEST).json({
      error: ERROR_CODES.VALIDATION_ERROR.value,
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
  // `since > until` would yield an empty result silently — surface
  // 400 with `invalid_range` so the page can correct the input.
  if (since !== undefined && until !== undefined) {
    if (new Date(since).getTime() >= new Date(until).getTime()) {
      res.status(HTTP_BAD_REQUEST).json({
        error: ERROR_CODES.INVALID_RANGE.value,
        message: "`since` must be strictly less than `until`",
      });
      return { kind: "error" };
    }
  }
  return { kind: "ok", filters };
};

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
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return { kind: "error" };
  }
};

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
  // Strict shape check — adapter drift (e.g. `acknowledgedByUserId`
  // omitted) surfaces 500 with a meaningful log.
  const parsed = AdminNotificationListEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    console.error("api/notifications/admin/list: envelope failed shape validation", parsed.error);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return { kind: "error" };
  }
  return { kind: "ok", envelope };
};

export interface NotificationRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: NotificationRepository;
  /** Injectable clock. The SAME `now()` is passed to the
   *  compare-and-set's `acknowledgedAt` AND the response body's
   *  `acknowledgedAt` (Postgres `DateTime` is millisecond precision). */
  readonly now: () => Date;
}

export const buildNotificationRouter = (deps: NotificationRouterDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/notifications",
    authorize({ action: "read", resource: "Notification" }, deps.audit),
    async (_req: AuthorizedRequest, res: Response) => {
      const req = _req;
      const role = req.user?.role;
      if (role === undefined || !VALID_RECIPIENT_ROLES.includes(role)) {
        // Defensive: a future role slipping past the matrix
        // surface 500 rather than passing an unknown value to the
        // Prisma enum filter.
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
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
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      const body = {
        notifications: rows.map((row) => notificationRowToPayload(row)),
      };
      res.status(HTTP_OK).json(body);
    },
  );

  router.patch(
    "/api/notifications/:id/acknowledge",
    authorize({ action: "acknowledge", resource: "Notification" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const id = parsePathParams(req, res);
      if (id === null) return;

      const actor = req.user?.id;
      const actorRole = req.user?.role;
      if (actor === undefined || actorRole === undefined) {
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }

      const fetched = await fetchRowForAck({ repo: deps.repo, id, res });
      if (fetched.kind !== "ok") return;
      const { row } = fetched;

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

      const finalRow = await refetchRow({ repo: deps.repo, id, res });
      if (finalRow === null) return;

      renderAckResponse({ res, id, actor, row: finalRow, updateCount });
    },
  );

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
