/**
 * `POST /api/alerts/:alert_id/acknowledge` — Story 3.5 (FR-15).
 *
 * Compare-and-set: `updateMany({ where: { id, acknowledgedAt: null },
 * data: { acknowledgedAt, acknowledgedByUserId } })`. The
 * `acknowledgedAt: null` predicate is the serialization point —
 * two simultaneous acks race on Postgres's row tuple lock, exactly
 * one wins (`count === 1`), the loser re-reads and returns 200
 * with the existing row (idempotent path). `alert:acknowledged`
 * emit ONLY on `count === 1`. The same `now()` is passed to both
 * the DB write and the response body (Postgres `DateTime` is
 * `TIMESTAMP(3)`; two separate clock reads risk a 1ms drift).
 * RBAC: `acknowledge × Alert` = Admin + Operator (Viewer +
 * Technician → 403 + audit).
 */
import {
  type AlertAcknowledgedEvent,
  AlertAcknowledgedEventSchema,
  type AlertAcknowledgeResponse,
  AlertAcknowledgeResponseSchema,
} from "@surakkha/shared";
import { UuidSchema } from "@surakkha/shared/schemas";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_ERROR, HTTP_NOT_FOUND, HTTP_OK } from "../httpStatus.js";
import { type BroadcastTarget } from "../ingest/frame.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import { buildAcknowledgeUpdate } from "./acknowledge.js";

/**
 * Production adapter — narrow the real `@prisma/client` to the
 * `AlertAcknowledgeRepository` slice. The cast is contained to
 * this file so future Prisma type drifts don't ripple.
 */
export const resolveAlertAcknowledgeRepository = (prisma: unknown): AlertAcknowledgeRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    alert: {
      updateMany: (args) => client.alert.updateMany(args) as Promise<{ readonly count: number }>,
      findUnique: (args) => client.alert.findUnique(args),
    },
  };
};

/** Minimal Alert delegate surface the router needs from Prisma.
 *  Tests inject a stub that satisfies this interface. */
export interface AlertAcknowledgeRepository {
  readonly alert: {
    updateMany(args: {
      readonly where: {
        readonly id: string;
        readonly acknowledgedAt: null;
      };
      readonly data: {
        readonly acknowledgedAt: Date;
        readonly acknowledgedByUserId: string;
      };
    }): Promise<{ readonly count: number }>;
    findUnique(args: {
      readonly where: { readonly id: string };
      readonly select: {
        readonly id: true;
        readonly deviceId: true;
        readonly acknowledgedAt: true;
        readonly acknowledgedByUserId: true;
      };
    }): Promise<{
      readonly id: string;
      readonly deviceId: string;
      readonly acknowledgedAt: Date | null;
      readonly acknowledgedByUserId: string | null;
    } | null>;
  };
}

export interface AlertAcknowledgeDeps {
  readonly audit: AuditLogger;
  readonly prisma: AlertAcknowledgeRepository;
  readonly broadcast: BroadcastTarget;
  /** Injectable clock (single source of `now` for DB write +
   *  response body — same Date instance, no 1ms drift). */
  readonly now: () => Date;
}

const pathParamsSchema = z.object({
  alert_id: UuidSchema,
});

type AckStateResolution =
  | {
      readonly kind: "ok";
      readonly firstAck: boolean;
      readonly acknowledgedAt: Date;
      readonly deviceId: string;
      readonly actorUserId: string;
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "data_corruption" };

/** Read-back shape shared by the first-ack + re-ack `findUnique`
 *  calls. The two paths use the same `select` projection. */
interface AckRowShape {
  readonly id: string;
  readonly deviceId: string;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedByUserId: string | null;
}

const ackRowSelect = {
  id: true,
  deviceId: true,
  acknowledgedAt: true,
  acknowledgedByUserId: true,
} as const;

/** Resolve the post-compare-and-set state. `count === 1` → first
 *  ack (fetch row for `deviceId`); `count === 0` → re-ack or
 *  unknown id (fetch + check `acknowledgedAt` +
 *  `acknowledgedByUserId`). */
const resolveAckState = async (
  prisma: AlertAcknowledgeRepository,
  update: ReturnType<typeof buildAcknowledgeUpdate>,
  alertId: string,
): Promise<AckStateResolution> => {
  const result = await prisma.alert.updateMany({
    where: update.where,
    data: update.data,
  });
  if (result.count === 1) {
    const row = (await prisma.alert.findUnique({
      where: { id: alertId },
      select: ackRowSelect,
    })) as AckRowShape | null;
    if (row === null) {
      return { kind: "not_found" };
    }
    return {
      kind: "ok",
      firstAck: true,
      acknowledgedAt: update.data.acknowledgedAt,
      deviceId: row.deviceId,
      actorUserId: update.data.acknowledgedByUserId,
    };
  }
  const existing = (await prisma.alert.findUnique({
    where: { id: alertId },
    select: ackRowSelect,
  })) as AckRowShape | null;
  if (existing === null || existing.acknowledgedAt === null) {
    return { kind: "not_found" };
  }
  if (existing.acknowledgedByUserId === null) {
    return { kind: "data_corruption" };
  }
  return {
    kind: "ok",
    firstAck: false,
    acknowledgedAt: existing.acknowledgedAt,
    deviceId: existing.deviceId,
    actorUserId: existing.acknowledgedByUserId,
  };
};

/** Post-commit emit. Row is committed; an emit throw does NOT
 *  undo the commit. Catch + log + STILL 200 — a flaky socket must
 *  not force the client to retry a write that already succeeded. */
const emitAckIfFirst = (
  broadcast: BroadcastTarget,
  deviceId: string,
  payload: AlertAcknowledgedEvent,
): boolean => {
  const parsedEvent = AlertAcknowledgedEventSchema.safeParse(payload);
  if (!parsedEvent.success) {
    console.warn(`[alerts] ack emit schema drift alertId=${payload.alert_id}`);
    return false;
  }
  try {
    broadcast.to(`device:${deviceId}`).emit("alert:acknowledged", parsedEvent.data);
  } catch (emitErr) {
    console.warn(`[alerts] acknowledge emit failed alertId=${payload.alert_id}`, emitErr);
  }
  return true;
};

/** Build + validate the wire response body. Returns the validated
 *  payload OR an error tuple if the schema-drift guard fails.
 *  `.safeParse` (vs `.parse`) is the guard rail against future
 *  drift throwing `ZodError` after headers were sent. */
const buildAckResponseBody = (
  alertId: string,
  acknowledgedAt: Date,
  actorUserId: string,
): AlertAcknowledgeResponse | { readonly error: typeof ERROR_CODES.SCHEMA_DRIFT.value } => {
  const body: AlertAcknowledgeResponse = {
    alert_id: alertId,
    acknowledged_at: acknowledgedAt.toISOString(),
    actor_user_id: actorUserId,
  };
  const validated = AlertAcknowledgeResponseSchema.safeParse(body);
  if (!validated.success) {
    return { error: ERROR_CODES.SCHEMA_DRIFT.value };
  }
  return validated.data;
};

/** Build the `/api/alerts/:alert_id/acknowledge` router. The
 *  emit is wrapped in `try { ... } catch { ... }` because the row
 *  is committed by the compare-and-set; an emit throw does NOT undo
 *  the commit, so 5xx-ing here would force the client to retry a
 *  write that already succeeded (which would hit the idempotent
 *  path). */
export const buildAlertAcknowledgeRouter = (deps: AlertAcknowledgeDeps): Router => {
  const router = express.Router();

  router.post(
    "/api/alerts/:alert_id/acknowledge",
    authorize({ action: "acknowledge", resource: "Alert" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const parsed = pathParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: ERROR_CODES.VALIDATION_ERROR.value,
          issues: parsed.error.issues,
        });
        return;
      }
      const alertId = parsed.data.alert_id;

      // `authorize()` guarantees `req.user` is non-null; defensive
      // null-check is belt-and-braces for strict-null-checks.
      const actor = req.user?.id;
      if (actor === undefined) {
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }

      const now = deps.now();
      const update = buildAcknowledgeUpdate({
        alertId,
        actorUserId: actor,
        now,
      });

      let resolution: AckStateResolution;
      try {
        resolution = await resolveAckState(deps.prisma, update, alertId);
      } catch (err) {
        console.error("api/alerts/acknowledge: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }

      if (resolution.kind === "not_found") {
        res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
        return;
      }
      if (resolution.kind === "data_corruption") {
        // Structurally impossible under the schema + update primitive.
        console.error(
          `[alerts] acknowledge: row ${alertId} has acknowledgedAt set but acknowledgedByUserId is null`,
        );
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      const { firstAck, acknowledgedAt, deviceId, actorUserId } = resolution;

      const body = buildAckResponseBody(alertId, acknowledgedAt, actorUserId);
      if ("error" in body) {
        console.error(`[alerts] acknowledge: response schema drift alertId=${alertId}`);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }

      // Emit AFTER the schema-drift 500 check so a drift-500 never
      // fires a phantom emit claiming the row changed.
      if (firstAck) {
        emitAckIfFirst(deps.broadcast, deviceId, {
          alert_id: alertId,
          acknowledged_at: acknowledgedAt.toISOString(),
          actor_user_id: actorUserId,
        });
      }

      console.warn(
        `[alerts] acknowledged alertId=${alertId} actor=${actorUserId} acknowledgedAt=${acknowledgedAt.toISOString()} first=${firstAck ? "true" : "false"}`,
      );
      res.status(HTTP_OK).json(body);
    },
  );

  return router;
};
