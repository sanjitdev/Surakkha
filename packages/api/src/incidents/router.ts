/**
 * `/api/incidents/:id/...` — transition router. Six routes
 * (5 transition POSTs + read-side GET + audit-timeline GET).
 * Per-verb RBAC is enforced via `authorize(...)`; the per-cell
 * `reopen` Admin gate lives in `transitionHelpers.ts`. The 5
 * transition POSTs are wrapped in `idempotency(...)` middleware
 * for `(user_id, route, key)` dedupe within `IDEMPOTENCY_TTL_MS`.
 */
import {
  type ActionVerb,
  type IncidentEventPayload,
  type IncidentPayload,
} from "@surakkha/shared/incident";
import { type Action } from "@surakkha/shared/rbac";
import { idPathSchema as sharedIdPathSchema } from "@surakkha/shared/schemas";
import express, { type Response, type Router } from "express";

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
import { idempotency, IdempotencyStore } from "../middleware/idempotency.js";

import {
  type IncidentEventRow,
  incidentEventRowToPayload,
  type IncidentRow,
  incidentRowToPayload,
  type IncidentStateRepository,
} from "./incidentStateRepository.js";
import {
  type PrepareCtxInput,
  prepareTransitionContext,
  respondSuccess,
  runTransitionPipeline,
  type TransitionContext,
} from "./transitionHelpers.js";

const idPathSchema = sharedIdPathSchema;

export interface IncidentsRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: IncidentStateRepository;
  /** Broadcast target for socket emits. Production wires `io.to(...)`;
   *  tests pass a stub that records emissions. Omit to disable. */
  readonly broadcast?: IncidentBroadcast;
  /** Lazy-upsert a `User` row on first JWT sight so audit writes do
   *  not fail with FK violations when an unrecognized `sub` claim
   *  appears. Omit to fall back to `req.user?.id ?? null`. */
  readonly resolveActorUserId?: (jwtSub: string | null) => Promise<string | null>;
  /** Idempotency-Key middleware factory. Production wires the
   *  process-wide store; tests can omit and a per-builder default
   *  store is created. */
  readonly idempotency?: ReturnType<typeof idempotency>;
}

export interface IncidentBroadcast {
  readonly to: (room: string) => {
    readonly emit: (event: "incident:state_changed" | "incident:opened", payload: unknown) => void;
  };
}

const buildAcknowledgeHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "acknowledge");

const buildAssignHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "assign");

const buildSubmitResultHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "submit_result");

const buildResolveHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "resolve");

const buildReopenHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "reopen");

const RBAC_ACTION_BY_VERB: Readonly<Record<ActionVerb, Action>> = {
  acknowledge: "acknowledge",
  assign: "assign",
  submit_result: "submit_result",
  resolve: "resolve",
  reopen: "reopen",
};

const buildTransitionHandler =
  (deps: IncidentsRouterDeps, verb: ActionVerb) =>
  async (req: AuthorizedRequest, res: Response): Promise<void> => {
    const ctx = await prepareTransitionContext({ deps, verb, req, res });
    if (ctx === null) return;
    const { id, body, currentRow } = ctx;

    const pipeline = await runTransitionPipeline({
      deps,
      verb,
      id,
      body,
      currentRow,
      req,
      res,
    });
    if (pipeline === null) return;
    const { applied, result } = pipeline;

    const actorUserId =
      deps.resolveActorUserId === undefined
        ? (req.user?.id ?? null)
        : await deps.resolveActorUserId(req.user?.id ?? null);

    respondSuccess({
      deps,
      currentRow,
      result,
      verb,
      actorUserId,
      applied,
      res,
    });
  };

export const buildIncidentsRouter = (deps: IncidentsRouterDeps): Router => {
  const router = express.Router();

  const idempotencyMw = deps.idempotency ?? idempotency(new IdempotencyStore());

  // Read-side. RBAC: `read × Incident`. All four v1 roles can read;
  // Technician's ownership rule (only assigned) is enforced via
  // `requireOwner` on the resolved `assignee_user_id`.
  router.get(
    "/api/incidents/:id",
    authorize({ action: "read", resource: "Incident" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res
          .status(HTTP_BAD_REQUEST)
          .json({ error: ERROR_CODES.VALIDATION_ERROR.value, issues: idParsed.error.issues });
        return;
      }
      const { id } = idParsed.data;
      let row: IncidentRow | null;
      try {
        row = await deps.repo.incident.findUnique({ where: { id } });
      } catch (err) {
        console.error(`api/incidents/${id}: findUnique failed`, err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      if (row === null) {
        res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
        return;
      }
      if (req.user?.role === "Technician" && row.assigneeUserId !== req.user.id) {
        deps.audit.emit({
          auditAction: "rbac_denied",
          userId: req.user.id,
          outcome: "failure",
          context: {
            subject: req.user.role,
            action: "read",
            resource: "Incident",
            reason: "not_assignee",
          },
        });
        res
          .status(HTTP_FORBIDDEN)
          .json({ error: ERROR_CODES.FORBIDDEN.value, required_role: "Technician" });
        return;
      }
      const payload: IncidentPayload = incidentRowToPayload(row);
      res.status(HTTP_OK).json(payload);
    },
  );

  // Read-side timeline. RBAC + Tech-ownership mirror the parent GET.
  router.get(
    "/api/incidents/:id/events",
    authorize({ action: "read", resource: "Incident" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res
          .status(HTTP_BAD_REQUEST)
          .json({ error: ERROR_CODES.VALIDATION_ERROR.value, issues: idParsed.error.issues });
        return;
      }
      const { id } = idParsed.data;
      let row: IncidentRow | null;
      try {
        row = await deps.repo.incident.findUnique({ where: { id } });
      } catch (err) {
        console.error("api/incidents/:id/events: findUnique failed", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      if (row === null) {
        res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
        return;
      }
      if (req.user?.role === "Technician" && row.assigneeUserId !== req.user.id) {
        deps.audit.emit({
          auditAction: "rbac_denied",
          userId: req.user.id,
          outcome: "failure",
          context: {
            subject: req.user.role,
            action: "read",
            resource: "Incident",
            reason: "not_assignee",
          },
        });
        res
          .status(HTTP_FORBIDDEN)
          .json({ error: ERROR_CODES.FORBIDDEN.value, required_role: "Technician" });
        return;
      }
      let events: IncidentEventRow[];
      try {
        events = await deps.repo.incidentEvent.findMany({
          where: { incidentId: id },
          orderBy: { createdAt: "asc" },
        });
      } catch (err) {
        console.error("api/incidents/:id/events: findMany failed", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      const body: { events: IncidentEventPayload[] } = {
        events: events.map((row_) => incidentEventRowToPayload(row_)),
      };
      res.status(HTTP_OK).json(body);
    },
  );

  // Write-side. RBAC per verb:
  //   - acknowledge / assign / resolve: Admin + Operator
  //   - submit_result: Technician ONLY (with ownership)
  //   - reopen: Admin ONLY
  router.post(
    "/api/incidents/:id/acknowledge",
    authorize({ action: RBAC_ACTION_BY_VERB.acknowledge, resource: "Incident" }, deps.audit),
    idempotencyMw,
    buildAcknowledgeHandler(deps),
  );
  router.post(
    "/api/incidents/:id/assign",
    authorize({ action: RBAC_ACTION_BY_VERB.assign, resource: "Incident" }, deps.audit),
    idempotencyMw,
    buildAssignHandler(deps),
  );
  router.post(
    "/api/incidents/:id/submit-result",
    authorize({ action: RBAC_ACTION_BY_VERB.submit_result, resource: "Incident" }, deps.audit),
    idempotencyMw,
    buildSubmitResultHandler(deps),
  );
  router.post(
    "/api/incidents/:id/resolve",
    authorize({ action: RBAC_ACTION_BY_VERB.resolve, resource: "Incident" }, deps.audit),
    idempotencyMw,
    buildResolveHandler(deps),
  );
  router.post(
    "/api/incidents/:id/reopen",
    authorize({ action: RBAC_ACTION_BY_VERB.reopen, resource: "Incident" }, deps.audit),
    idempotencyMw,
    buildReopenHandler(deps),
  );

  return router;
};

export type { PrepareCtxInput, TransitionContext };
