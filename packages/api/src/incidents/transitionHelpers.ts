/**
 * Pure support helpers for the transition router pipeline
 * (parse → ownership → pure transition → commit → response).
 */
import { InvalidStateTransitionEnvelopeSchema } from "@surakkha/shared/error-envelope";
import {
  type ActionVerb,
  type IncidentPayload,
  type InspectionOutcome,
  InspectionOutcomeSchema,
} from "@surakkha/shared/incident";
import { type Response } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_INTERNAL_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from "../httpStatus.js";
import { type AuthorizedRequest } from "../middleware/authorize.js";

import {
  applyTransition,
  type ApplyTransitionInput,
  type IncidentRow,
  incidentRowToPayload,
  type IncidentStateRepository,
  OptimisticConcurrencyError,
} from "./incidentStateRepository.js";
import { transition } from "./transitions.js";
import {
  emitStateChanged,
  runOwnershipCheck,
  writeInvalidAttemptEvent,
} from "./transitionSideEffects.js";

/** Canonical 409 envelope for `invalid_state_transition`. The
 *  3-shape collapse (typed state-machine miss, optimistic-
 *  concurrency loss, P2002 race) lands at one discriminated body:
 *  `{ error, from?, attempted?, reason? }`. Clients discriminate
 *  on which optional fields are present. */
export const respondInvalidStateTransition = (
  res: Response,
  body: { readonly from?: string; readonly attempted?: string; readonly reason?: string },
): void => {
  const envelope = InvalidStateTransitionEnvelopeSchema.parse({
    error: ERROR_CODES.INVALID_STATE_TRANSITION.value,
    ...body,
  });
  res.status(HTTP_CONFLICT).json(envelope);
};

export interface IncidentsRouterDepsLike {
  readonly repo: IncidentStateRepository;
  readonly audit: AuditLogger;
  readonly broadcast?: {
    to(room: string): {
      emit(event: string, payload: unknown): void;
    };
  };
}

export {
  applyTransition,
  type ApplyTransitionInput,
  type IncidentRow,
  incidentRowToPayload,
  type IncidentStateRepository,
  OptimisticConcurrencyError,
  transition,
};

interface RunPipelineInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly verb: ActionVerb;
  readonly id: string;
  readonly body: Record<string, unknown> | undefined;
  readonly currentRow: IncidentRow;
  readonly req: AuthorizedRequest;
  readonly res: Response;
}

const idPathSchema = z.object({
  id: z.string().uuid(),
});

const acknowledgeBodySchema = z.object({}).strict().optional();

const assignBodySchema = z
  .object({
    assignee_user_id: z.string().uuid(),
  })
  .strict();

const submitResultBodySchema = z
  .object({
    outcome: InspectionOutcomeSchema,
  })
  .strict();

const resolveBodySchema = z.object({}).strict().optional();

const REOPEN_REASON_MIN_LENGTH = 10;
const REOPEN_REASON_MAX_LENGTH = 2000;

const reopenBodySchema = z
  .object({
    reason: z.string().trim().min(REOPEN_REASON_MIN_LENGTH).max(REOPEN_REASON_MAX_LENGTH),
  })
  .strict();

const parseBody = (
  verb: ActionVerb,
  raw: unknown,
):
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly issues: unknown } => {
  const parsed = dispatchParse(verb, raw);
  if (parsed.success) return { ok: true, body: parsed.data };
  return { ok: false, issues: parsed.error.issues };
};

const dispatchParse = (verb: ActionVerb, raw: unknown): z.SafeParseReturnType<unknown, unknown> => {
  switch (verb) {
    case "acknowledge":
      return acknowledgeBodySchema.safeParse(raw ?? {});
    case "assign":
      return assignBodySchema.safeParse(raw);
    case "submit_result":
      return submitResultBodySchema.safeParse(raw);
    case "resolve":
      return resolveBodySchema.safeParse(raw ?? {});
    case "reopen":
      return reopenBodySchema.safeParse(raw);
  }
};

export interface PrepareCtxInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly verb: ActionVerb;
  readonly req: AuthorizedRequest;
  readonly res: Response;
}

export interface TransitionContext {
  readonly id: string;
  readonly body: Record<string, unknown> | undefined;
  readonly currentRow: IncidentRow;
}

export const prepareTransitionContext = async (
  input: PrepareCtxInput,
): Promise<TransitionContext | null> => {
  const { deps, verb, req, res } = input;

  const idParsed = idPathSchema.safeParse(req.params);
  if (!idParsed.success) {
    res
      .status(HTTP_BAD_REQUEST)
      .json({ error: ERROR_CODES.VALIDATION_ERROR.value, issues: idParsed.error.issues });
    return null;
  }
  const { id } = idParsed.data;

  const bodyParsed = parseBody(verb, req.body);
  if (!bodyParsed.ok) {
    res
      .status(HTTP_BAD_REQUEST)
      .json({ error: ERROR_CODES.VALIDATION_ERROR.value, issues: bodyParsed.issues });
    return null;
  }
  const body = bodyParsed.body as Record<string, unknown> | undefined;

  const currentRow = await loadOrRespond({ deps, id, verb, res });
  if (currentRow === null) return null;

  return { id, body, currentRow };
};

interface PipelineOutcome {
  readonly applied: Awaited<ReturnType<typeof applyTransition>>;
  readonly result: Extract<Awaited<ReturnType<typeof transition>>, { ok: true }>;
}

/** Per-cell RBAC gate for `reopen`: Admin-only (the matrix-level
 *  RBAC check already grants the cell). Returns `true` if denied
 *  (handler should short-circuit). */
export const maybeReopenAdminDenied = (input: {
  readonly deps: IncidentsRouterDepsLike;
  readonly verb: ActionVerb;
  readonly req: AuthorizedRequest;
  readonly res: Response;
}): boolean => {
  if (input.verb !== "reopen") return false;
  if (input.req.user?.role === "Admin") return false;
  input.deps.audit.emit({
    auditAction: "rbac_denied",
    userId: input.req.user?.id,
    outcome: "failure",
    context: {
      subject: input.req.user?.role ?? null,
      action: "reopen",
      resource: "Incident",
      reason: "not_admin",
    },
  });
  input.res
    .status(HTTP_FORBIDDEN)
    .json({ error: ERROR_CODES.FORBIDDEN.value, required_role: "Admin" });
  return true;
};

export const runTransitionPipeline = async (
  input: RunPipelineInput,
): Promise<PipelineOutcome | null> => {
  const { deps, verb, id, body, currentRow, req, res } = input;

  const actorUserId = req.user?.id ?? null;
  if (maybeReopenAdminDenied({ deps, verb, req, res })) return null;
  if (await maybeOwnershipDenied({ deps, verb, currentRow, req, res, actorUserId })) return null;

  const computed = computeTransition({ body, currentRow, verb, actorUserId });
  if (!computed.ok) {
    await respondInvalidAttempt({
      deps,
      incidentId: currentRow.id,
      actorUserId,
      from: computed.from,
      attempted: computed.attempted,
      at: computed.at,
      res,
    });
    return null;
  }

  const applied = await commitTransition({
    deps,
    verb,
    id,
    currentRow,
    result: computed.result,
    actorUserId,
    assigneeUserId: computed.assigneeUserId,
    res,
  });
  if (applied === null) return null;

  return { applied, result: computed.result };
};

interface OwnershipDeniedInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly verb: ActionVerb;
  readonly currentRow: IncidentRow;
  readonly req: AuthorizedRequest;
  readonly res: Response;
  readonly actorUserId: string | null;
}

export const maybeOwnershipDenied = async (input: OwnershipDeniedInput): Promise<boolean> => {
  const { deps, verb, currentRow, req, res } = input;
  if (verb !== "submit_result") return false;
  if (currentRow.assigneeUserId === req.user?.id) return false;
  return runOwnershipCheck({
    ownerId: currentRow.assigneeUserId,
    req,
    res,
    audit: deps.audit,
  });
};

interface ComputeInput {
  readonly body: Record<string, unknown> | undefined;
  readonly currentRow: IncidentRow;
  readonly verb: ActionVerb;
  readonly actorUserId: string | null;
}

type ComputeOutcome =
  | {
      readonly ok: true;
      readonly result: Extract<Awaited<ReturnType<typeof transition>>, { ok: true }>;
      readonly assigneeUserId: unknown;
    }
  | {
      readonly ok: false;
      readonly from: string;
      readonly attempted: ActionVerb;
      readonly at: string;
    };

const extractOutcome = (
  body: Record<string, unknown> | undefined,
): InspectionOutcome | undefined => {
  const raw = body?.["outcome"];
  if (typeof raw !== "string") return undefined;
  return raw as InspectionOutcome;
};

const extractAssigneeUserId = (body: Record<string, unknown> | undefined): string | undefined => {
  const raw = body?.["assignee_user_id"];
  return typeof raw === "string" ? raw : undefined;
};

const extractReopenReason = (
  verb: ActionVerb,
  body: Record<string, unknown> | undefined,
): string | null => {
  if (verb !== "reopen") return null;
  const raw = body?.["reason"];
  return typeof raw === "string" ? raw : null;
};

export const computeTransition = (input: ComputeInput): ComputeOutcome => {
  const { body, currentRow, verb, actorUserId } = input;
  const outcome = extractOutcome(body);
  const assigneeUserId = extractAssigneeUserId(body);
  const reason = extractReopenReason(verb, body);
  const result = transition({
    incident: incidentRowToPayload(currentRow),
    action: verb,
    actorUserId,
    ...(outcome !== undefined ? { outcome } : {}),
    ...(assigneeUserId !== undefined ? { assigneeUserId } : {}),
    ...(reason !== null ? { reason } : {}),
  });
  if (!result.ok) {
    return { ok: false, from: result.from, attempted: result.attempted, at: result.at };
  }
  return { ok: true, result, assigneeUserId };
};

interface RespondSuccessInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly currentRow: IncidentRow;
  readonly result: Extract<Awaited<ReturnType<typeof transition>>, { ok: true }>;
  readonly verb: ActionVerb;
  readonly actorUserId: string | null;
  readonly applied: Awaited<ReturnType<typeof applyTransition>>;
  readonly res: Response;
}

export const respondSuccess = (input: RespondSuccessInput): void => {
  const { deps, currentRow, result, verb, actorUserId, applied, res } = input;
  logTransition({
    incidentId: currentRow.id,
    fromState: currentRow.state,
    toState: result.next_state,
    verb,
    actorUserId,
    at: result.at,
  });
  emitStateChanged({
    deps,
    incidentId: currentRow.id,
    fromState: currentRow.state,
    toState: result.next_state,
    at: result.at,
    actorUserId,
  });
  const payload: IncidentPayload = incidentRowToPayload(applied.nextRow);
  res.status(HTTP_OK).json(payload);
};

interface LoadRowInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly id: string;
  readonly verb: ActionVerb;
  readonly res: Response;
}

export const loadOrRespond = async (input: LoadRowInput): Promise<IncidentRow | null> => {
  const { deps, id, verb, res } = input;
  let row: IncidentRow | null;
  try {
    row = await deps.repo.incident.findUnique({ where: { id } });
  } catch (err) {
    console.error(`api/incidents/${id}/${verb}: findUnique failed`, err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return null;
  }
  if (row === null) {
    res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
    return null;
  }
  return row;
};

interface InvalidAttemptResponseInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly incidentId: string;
  readonly actorUserId: string | null;
  readonly from: string;
  readonly attempted: ActionVerb;
  readonly at: string;
  readonly res: Response;
}

export const respondInvalidAttempt = async (input: InvalidAttemptResponseInput): Promise<void> => {
  const { deps, incidentId, actorUserId, from, attempted, at, res } = input;
  await writeInvalidAttemptEvent({ deps, incidentId, actorUserId, from, attempted, at });
  respondInvalidStateTransition(res, { from, attempted });
};

interface CommitTransitionInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly verb: ActionVerb;
  readonly id: string;
  readonly currentRow: IncidentRow;
  readonly result: Extract<Awaited<ReturnType<typeof transition>>, { ok: true }>;
  readonly actorUserId: string | null;
  readonly assigneeUserId: unknown;
  readonly res: Response;
}

export const commitTransition = async (
  input: CommitTransitionInput,
): Promise<Awaited<ReturnType<typeof applyTransition>> | null> => {
  const { deps, verb, id, currentRow, result, actorUserId, assigneeUserId, res } = input;
  const applyInput: ApplyTransitionInput = {
    currentRow,
    result,
    actorUserId,
    writeCriticalNotification: result.next_state === "UNSAFE",
    ...(verb === "assign" && typeof assigneeUserId === "string" ? { assigneeUserId } : {}),
  };
  try {
    return await applyTransition(deps.repo, applyInput);
  } catch (err) {
    if (err instanceof OptimisticConcurrencyError) {
      await writeInvalidAttemptEvent({
        deps,
        incidentId: currentRow.id,
        actorUserId,
        from: currentRow.state,
        attempted: verb,
        at: new Date().toISOString(),
      });
      respondInvalidStateTransition(res, { reason: "concurrent_modification" });
      return null;
    }
    if (isPrismaErrorWithCode(err, "P2002")) {
      // Partial-unique-index race on `notification:critical` —
      // map to 409 instead of 500 (benign idempotency).
      console.warn(
        `api/incidents/${id}/${verb}: P2002 collapsed to existing row, treating as concurrent_modification`,
      );
      respondInvalidStateTransition(res, { reason: "concurrent_modification" });
      return null;
    }
    if (isPrismaErrorWithCode(err, "P2003")) {
      // FK violation on assigneeUserId most likely means the User
      // was deleted between request validation and write. Surface
      // 400 not_found rather than 500.
      console.warn(`api/incidents/${id}/${verb}: P2003 FK violation (likely missing assignee)`);
      res
        .status(HTTP_BAD_REQUEST)
        .json({ error: ERROR_CODES.INVALID_ASSIGNEE.value, reason: ERROR_CODES.NOT_FOUND.value });
      return null;
    }
    console.error(`api/incidents/${id}/${verb}: applyTransition failed`, err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return null;
  }
};

const isPrismaErrorWithCode = (err: unknown, code: string): boolean =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: unknown }).code === code;

interface TransitionLogInput {
  readonly incidentId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly verb: ActionVerb;
  readonly actorUserId: string | null;
  readonly at: string;
}

export const logTransition = (input: TransitionLogInput): void => {
  const { incidentId, fromState, toState, verb, actorUserId, at } = input;
  console.warn(
    JSON.stringify({
      event: "incident_transition",
      incident_id: incidentId,
      from: fromState,
      to: toState,
      verb,
      actor_user_id: actorUserId,
      at,
    }),
  );
};
