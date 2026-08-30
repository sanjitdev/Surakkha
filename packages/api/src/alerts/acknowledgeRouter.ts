/**
 * `POST /api/alerts/:alert_id/acknowledge` — Story 3.5 (FR-15).
 *
 * Operator-facing acknowledge flow for the alert lifecycle. Mirrors
 * `incidents/recentRouter.ts:65` factory shape (buildXxxRouter(deps):
 * Router) so the api's index mounting reads consistently across
 * surfaces.
 *
 * RBAC: `authorize({ action: "acknowledge", resource: "Alert" }, audit)`
 * — Admin + Operator per the matrix in `architecture-appendix-rbac.md`
 * lines 100-103. Viewer + Technician get 403 BEFORE any DB lookup
 * (matrix grants `Alert.acknowledge = false` for both; pinned by
 * ACK_VIEWER_DENIED + ACK_TECHNICIAN_DENIED + the extended
 * `rbac.negative.spec.ts` cases 16 + 17).
 *
 * Compare-and-set semantics (AC1 + AC1e + ACK_RACE_LOSER pin):
 *
 *   prisma.alert.updateMany({
 *     where: { id, acknowledgedAt: null },
 *     data: { acknowledgedAt, acknowledgedByUserId }
 *   })
 *
 * The `acknowledgedAt: null` predicate is the serialization point.
 * Two simultaneous acks: exactly ONE returns `count === 1` (first
 * writer commits); the other returns `count === 0` and follows up
 * with `prisma.alert.findUnique({ where: { id } })` to distinguish
 * "already ack'd at rest" (return 200 with existing values, no
 * emit) vs "no such alert" (return 404). No `READ COMMITTED` race
 * window — the predicate is evaluated under Postgres's row tuple
 * lock.
 *
 * First-ack-only emit (AC12b): `alert:acknowledged` is emitted ONLY
 * when `count === 1`. Re-acknowledge (same or different actor)
 * returns 200 with the existing values but does NOT emit. The
 * `console.warn('... first=true|false')` log line distinguishes
 * state-change from idempotent retry so operators can read the
 * boot log pipeline.
 *
 * Post-commit ordering (AC12 + 3.4 design note "Socket emit happens
 * post-commit"): the `broadcast.to(...).emit(...)` call runs AFTER
 * `prisma.alert.updateMany` resolves, in the same async function but
 * on a separate code path. If the emit itself throws, the row is
 * already committed — the handler catches the throw, logs
 * `console.warn('[alerts] acknowledge emit failed alertId=<id>')`,
 * and STILL returns 200 (no client retry that would re-update the
 * row).
 *
 * Single-read `now` (AC1c): the SAME `now()` Date instance is
 * passed to BOTH the Prisma `data.acknowledgedAt` write AND the
 * response body's `acknowledged_at`. Two separate reads of the clock
 * would risk a 1ms drift between the DB row and the wire payload
 * (Postgres's `DateTime` is `TIMESTAMP(3)`, millisecond precision).
 * The injectable `now` clock (production wires `() => new Date()`)
 * is the test seam — unit tests pin an exact value without time-
 * mocking libraries.
 *
 * `req.user.id`, NOT `req.user.userId` — see the AuthorizedRequest
 * type at `packages/api/src/middleware/authorize.ts:71-86`. The
 * spec text mentions `req.user.userId` (a slip; the JWT claim IS
 * `userId`, but the middleware attaches it to `req.user.id`). The
 * wire payload's `actor_user_id` and the DB row's
 * `acknowledgedByUserId` are the canonical names; only the runtime
 * field name is `.id`.
 */
import {
  type AlertAcknowledgedEvent,
  AlertAcknowledgedEventSchema,
  type AlertAcknowledgeResponse,
  AlertAcknowledgeResponseSchema,
} from "@surakkha/shared";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { type BroadcastTarget } from "../ingest/frame.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import { buildAcknowledgeUpdate } from "./acknowledge.js";

/**
 * Production adapter — narrow the real `@prisma/client` to the
 * `AlertAcknowledgeRepository` slice. Mirrors
 * `resolvePrismaAlertReader` at `rules/findOpenAlert.ts:62`. The cast
 * is contained to this file so future Prisma type drifts don't
 * ripple into the router.
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

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;

/**
 * Minimal Alert delegate surface that the router needs from Prisma.
 * Production narrows the real `PrismaClient.alert` via
 * `resolveAlertAcknowledgeDeps`; tests inject a stub that satisfies
 * this interface (mirrors `PrismaAlertReader` from
 * `rules/findOpenAlert.ts:44-70`).
 */
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
  /**
   * Injectable clock. The SAME `now()` result is passed to the
   * compare-and-set's `acknowledgedAt` AND the response body's
   * `acknowledged_at` — two separate reads of `Date.now()` would
   * risk a 1ms drift between DB row and wire payload (Postgres
   * `DateTime` is millisecond precision; `TIMESTAMP(3)`).
   */
  readonly now: () => Date;
}

/**
 * Path-parameter schema. The `alert_id` segment is the row PK
 * (UUIDv4). Non-UUID values are rejected at parse time (400) so a
 * malformed path never reaches the DB.
 */
const pathParamsSchema = z.object({
  alert_id: z.string().uuid(),
});

/**
 * Outcome of `resolveAckState` — what the data layer reported.
 *
 *   `kind: "ok"` — writeable state available. The handler proceeds to
 *     emit (if first-ack) and write the response.
 *   `kind: "not_found"` — no such alert (or vanishingly rare
 *     deleted-between-calls race). The handler responds 404.
 *   `kind: "data_corruption"` — `acknowledgedAt` set but
 *     `acknowledgedByUserId` is null. Structurally impossible under
 *     the schema + update primitive; surfaces as 500.
 */
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

/**
 * Read-back shape shared by both first-ack (`count === 1`) and
 * re-ack (`count === 0`) paths. The two `findUnique` calls in
 * `resolveAckState` use the same `select` projection, so the type
 * is hoisted here.
 */
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

/**
 * Resolve the post-compare-and-set state. Extracted from the route
 * handler to keep the handler's cyclomatic complexity under the
 * project cap (10). The handler is a thin orchestrator; the
 * state-resolution logic lives here.
 *
 * Order of branches:
 *   - `updateMany.count === 1` (first ack) → fetch the row to get
 *     `deviceId` for the room literal; if missing, race-deleted.
 *   - `updateMany.count === 0` (re-ack or unknown) → fetch the row;
 *     if missing OR `acknowledgedAt: null`, no row to ack.
 *   - The `acknowledgedByUserId === null` check is a 500 trap for a
 *     structurally-impossible DB state.
 */
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

/**
 * Post-commit emit. The row is committed; an emit throw does NOT
 * undo the commit. We catch + log + STILL 200 so a flaky socket
 * doesn't force the client to retry a write that already succeeded
 * (AC1d). Extracted from the handler for complexity budget.
 *
 * Returns true on a successful (or attempted-but-failed) emit, false
 * if the payload schema-drifted and the emit was skipped entirely
 * (the row is committed; the next eval pass would re-emit if needed).
 *
 * The `alertId` is read from `payload.alert_id` (3 params, max).
 */
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

/**
 * Build + validate the wire response body. Returns the validated
 * payload OR an error tuple if the schema-drift guard fails. Extracted
 * from the handler for complexity budget.
 *
 * AC1c pin: the same `acknowledgedAt` Date instance is rendered to
 * the wire here AND was written to the DB above. `.safeParse` (vs
 * `.parse`) is the guard rail against future drift throwing
 * `ZodError` after headers were sent.
 */
const buildAckResponseBody = (
  alertId: string,
  acknowledgedAt: Date,
  actorUserId: string,
): AlertAcknowledgeResponse | { readonly error: "schema_drift" } => {
  const body: AlertAcknowledgeResponse = {
    alert_id: alertId,
    acknowledged_at: acknowledgedAt.toISOString(),
    actor_user_id: actorUserId,
  };
  const validated = AlertAcknowledgeResponseSchema.safeParse(body);
  if (!validated.success) {
    return { error: "schema_drift" };
  }
  return validated.data;
};

/**
 * Build the `/api/alerts/:alert_id/acknowledge` router.
 *
 * Order of operations on the hot path:
 *   1. `authenticate()` (mounted upstream in `packages/api/src/index.ts`)
 *      — sets `req.user` from the JWT.
 *   2. `authorize({ action: "acknowledge", resource: "Alert" }, audit)`
 *      — Viewer + Technician → 403 + `rbac_denied` audit.
 *   3. Zod parse `:alert_id` → 400 on non-UUID.
 *   4. `prisma.alert.updateMany({ where: { id, acknowledgedAt: null },
 *      data: { acknowledgedAt: <now>, acknowledgedByUserId: <actor> } })`.
 *      - `count === 1` → first ack. Emit `alert:acknowledged` post-commit
 *        (try/catch around emit; on throw, log + STILL 200). Log
 *        `first=true`.
 *      - `count === 0` → re-ack or unknown id. `findUnique` distinguishes:
 *        - `null` → 404 `{ error: "not_found" }`.
 *        - non-null with `acknowledgedAt: null` → race-condition race winner
 *          pulled the rug out under us (treat as 404 — `count === 0` means
 *          the row was deleted between our updateMany and findUnique;
 *          vanishingly rare but the case is well-defined).
 *        - non-null with `acknowledgedAt: <iso>` → 200 with the EXISTING
 *          values (idempotent path). Log `first=false`. NO emit.
 *   5. Any thrown error from `prisma.alert.*` (not from the emit
 *      wrapper) → 500 `{ error: "internal_error" }`.
 *
 * The emit is wrapped in `try { ... } catch { ... }` because the row
 * is committed by step 4; an emit throw does NOT undo the commit,
 * so 5xx-ing here would force the client to retry a write that
 * already succeeded (which would now hit the idempotent path).
 */
export const buildAlertAcknowledgeRouter = (deps: AlertAcknowledgeDeps): Router => {
  const router = express.Router();

  router.post(
    "/api/alerts/:alert_id/acknowledge",
    authorize({ action: "acknowledge", resource: "Alert" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const parsed = pathParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: "validation_error",
          issues: parsed.error.issues,
        });
        return;
      }
      const alertId = parsed.data.alert_id;

      // `req.user` is guaranteed non-null by the authorize() middleware —
      // if it were null/undefined, authorize() would have already responded
      // 401 before we got here. The `as` is defensive belt-and-braces
      // for the strict-null-checks compiler.
      const actor = req.user?.id;
      if (actor === undefined) {
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
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
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }

      if (resolution.kind === "not_found") {
        res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
        return;
      }
      if (resolution.kind === "data_corruption") {
        // Structurally impossible under the schema + update
        // primitive — surfacing as 500 (data corruption signal)
        // rather than silently substituting the requester's UUID
        // (which the wire schema would reject as non-UUID anyway).
        console.error(
          `[alerts] acknowledge: row ${alertId} has acknowledgedAt set but acknowledgedByUserId is null`,
        );
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      const { firstAck, acknowledgedAt, deviceId, actorUserId } = resolution;

      // AC1c pin: the same `acknowledgedAt` Date instance is rendered
      // to the wire here AND was written to the DB above. `.safeParse`
      // (vs `.parse`) is the guard rail against future drift throwing
      // `ZodError` after headers were sent.
      const body = buildAckResponseBody(alertId, acknowledgedAt, actorUserId);
      if ("error" in body) {
        console.error(`[alerts] acknowledge: response schema drift alertId=${alertId}`);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }

      // Emit `alert:acknowledged` AFTER the response-schema safeParse
      // check. Contract: a schema-drift 500 must NOT fire an emit,
      // otherwise downstream WebSocket consumers would see a phantom
      // event claiming the row changed when the wire response says
      // it didn't. Pinned by ACK_RESPONSE_SCHEMA_DRIFT
      // (acknowledgeRouter.spec.ts:812).
      if (firstAck) {
        emitAckIfFirst(deps.broadcast, deviceId, {
          alert_id: alertId,
          acknowledged_at: acknowledgedAt.toISOString(),
          actor_user_id: actorUserId,
        });
      }

      // Operator-triage log. Fires on EVERY successful acknowledge
      // (first-ack AND idempotent re-ack). The `first=true|false`
      // suffix lets log readers distinguish state-change acks
      // (genuine operator action) from idempotent retries (the
      // dashboard's retry-on-network-blip behaviour). Fires AFTER
      // the schema-drift 500 check so a drift-500 never produces a
      // `first=true` line claiming success.
      console.warn(
        `[alerts] acknowledged alertId=${alertId} actor=${actorUserId} acknowledgedAt=${acknowledgedAt.toISOString()} first=${firstAck ? "true" : "false"}`,
      );
      res.status(HTTP_OK).json(body);
    },
  );

  return router;
};
