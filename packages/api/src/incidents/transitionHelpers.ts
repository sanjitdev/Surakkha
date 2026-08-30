/**
 * `transitionHelpers.ts` — Story 4.2.
 *
 * Pure support helpers extracted from `router.ts` so the route
 * module stays under the lint `max-lines` ceiling (500). The
 * helpers handle every non-route concern of the transition
 * pipeline:
 *
 *   - Validation: `prepareTransitionContext` + `loadOrRespond`.
 *   - Pure transition: `computeTransition`.
 *   - Ownership: `runOwnershipCheck` + `maybeOwnershipDenied`.
 *   - DB write: `commitTransition` + `writeInvalidAttemptEvent`.
 *   - Response shaping: `respondInvalidAttempt` + `respondSuccess`
 *     + `logTransition` + `emitStateChanged`.
 *
 * The `runTransitionPipeline` orchestrator ties them together in
 * the order the route invokes them.
 */
import {
  type ActionVerb,
  type IncidentPayload,
  type InspectionOutcome,
  InspectionOutcomeSchema,
} from "@surakkha/shared/incident";
import { type Response } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
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

// HTTP status constants used across helpers.
export const HTTP_OK = 200;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_INTERNAL_ERROR = 500;

/**
 * `IncidentsRouterDeps` shape — duplicated here as a type-only
 * import so this file is self-contained. The real `IncidentsRouterDeps`
 * is in `./router.ts` and these two stay in sync via the type alias
 * declared at the bottom.
 */
export interface IncidentsRouterDepsLike {
  readonly repo: IncidentStateRepository;
  readonly audit: AuditLogger;
  readonly broadcast?: {
    to(room: string): {
      emit(event: string, payload: unknown): void;
    };
  };
}

// Re-exports for downstream files.
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

/**
 * Path-param schema for `/api/incidents/:id/...`. UUID-shaped id.
 */
const idPathSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Body schemas per verb. All strict-Zod (`z.object({...})`); unknown
 * fields are rejected with 400. The shape per verb mirrors the
 * spec-4-2-incident-state-machine.md AC list.
 */
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

/**
 * Story 4.11 — reopen body schema. Requires `reason ≥ MIN_LENGTH`
 * chars (trimmed). The Admin who reopens a misclassified incident
 * must record a meaningful explanation; the value lands in the
 * `IncidentEvent.payload.reason` for the audit trail.
 *
 * The length cap (`MAX_LENGTH` chars) matches the assign /
 * submit-result payload ceilings and prevents operator-misuse
 * (paste-the-PR-description anti-pattern). Trim prevents
 * whitespace-only reasons from passing.
 *
 * Bounds extracted to constants so the `no-magic-numbers` lint
 * rule does not flag the literal values in the Zod chain.
 */
const REOPEN_REASON_MIN_LENGTH = 10;
const REOPEN_REASON_MAX_LENGTH = 2000;

const reopenBodySchema = z
  .object({
    reason: z.string().trim().min(REOPEN_REASON_MIN_LENGTH).max(REOPEN_REASON_MAX_LENGTH),
  })
  .strict();

/**
 * Parse the request body for the given verb.
 *
 * Returns `{ ok: true, body }` on success; `{ ok: false, issues }`
 * on failure. The caller maps the failure to 400.
 */
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
      // Story 4.11 — reopen requires `{ reason }` (≥ 10 chars). The
      // body is required (not optional like the empty-body verbs);
      // a missing body yields a Zod issues list that the caller
      // surfaces as 400 `validation_error`.
      return reopenBodySchema.safeParse(raw);
  }
};

/**
 * Args for `prepareTransitionContext`. Wraps the path-param + body
 * + load-row validation pipeline.
 */
export interface PrepareCtxInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly verb: ActionVerb;
  readonly req: AuthorizedRequest;
  readonly res: Response;
}

/**
 * Shape returned when validation passes. The handler can then
 * proceed straight to the state machine + writer.
 */
export interface TransitionContext {
  readonly id: string;
  readonly body: Record<string, unknown> | undefined;
  readonly currentRow: IncidentRow;
}

/**
 * Validate the path-param + body + load the row. Writes the HTTP
 * 400/404 on failure (returns `null`). Extracted so the main
 * handler stays under the lint complexity ceiling.
 */
export const prepareTransitionContext = async (
  input: PrepareCtxInput,
): Promise<TransitionContext | null> => {
  const { deps, verb, req, res } = input;

  // Path-param validation.
  const idParsed = idPathSchema.safeParse(req.params);
  if (!idParsed.success) {
    res.status(HTTP_BAD_REQUEST).json({ error: "validation_error", issues: idParsed.error.issues });
    return null;
  }
  const { id } = idParsed.data;

  // Body validation (verb-specific shape).
  const bodyParsed = parseBody(verb, req.body);
  if (!bodyParsed.ok) {
    res.status(HTTP_BAD_REQUEST).json({ error: "validation_error", issues: bodyParsed.issues });
    return null;
  }
  const body = bodyParsed.body as Record<string, unknown> | undefined;

  // Load the row.
  const currentRow = await loadOrRespond({ deps, id, verb, res });
  if (currentRow === null) return null;

  return { id, body, currentRow };
};

interface PipelineOutcome {
  readonly applied: Awaited<ReturnType<typeof applyTransition>>;
  readonly result: Extract<Awaited<ReturnType<typeof transition>>, { ok: true }>;
}

/**
 * Story 4.11 — per-cell RBAC gate for `reopen`. The matrix-level
 * RBAC check (`authorize({ action: "reopen", resource: "Incident" })`)
 * already runs in `router.ts`; this is the inner per-verb guard
 * that mirrors the `submit_result` ownership rule. A naïve matrix
 * would let Operator reopen because `update.Incident = Y` is
 * granted to Operator; the per-cell guard is the seam.
 *
 * Returns `true` if the request was denied (handler should
 * short-circuit), `false` otherwise.
 */
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
  input.res.status(HTTP_FORBIDDEN).json({ error: "forbidden", required_role: "Admin" });
  return true;
};

/**
 * Run the (ownership-check → pure-transition → commit) pipeline.
 * Returns `null` if any step short-circuited (handler already
 * responded).
 */
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

/**
 * Returns `true` if the request was denied by the ownership check
 * (handler should short-circuit), `false` otherwise.
 */
export const maybeOwnershipDenied = async (input: OwnershipDeniedInput): Promise<boolean> => {
  const { deps, verb, currentRow, req, res } = input;
  // Only `submit_result` is Technician-only-mine; other verbs skip.
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

/**
 * Per-verb body field extraction — pulls the verb-specific typed
 * value out of the validated body envelope. Split into small
 * helpers to keep `computeTransition`'s cyclomatic complexity
 * under the `complexity: 10` lint ceiling.
 */
const extractOutcome = (
  body: Record<string, unknown> | undefined,
): InspectionOutcome | undefined => {
  // Patch (code review 2026-08-27 #14): drop `outcome as never`.
  // `transition()` accepts `InspectionOutcome | undefined` and
  // the route's strict-Zod schema has already narrowed `body` to
  // the verb-specific shape; pass through the typed value instead
  // of bypassing the type system.
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
  // Story 4.11 — for `reopen`, the body is `{ reason: string }`
  // (length-validated by Zod upstream). `null` for other verbs
  // so the pure function's optional arg stays shape-stable.
  if (verb !== "reopen") return null;
  const raw = body?.["reason"];
  return typeof raw === "string" ? raw : null;
};

/**
 * Run the pure state machine on the validated row + body. Returns
 * either a successful `TransitionResult` (with the captured
 * `assigneeUserId` so the writer can use it) or a typed failure
 * for the handler to respond 409.
 */
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

/**
 * AC4 observability log + AC5 `incident:state_changed` emit +
 * respond 200 with the committed `IncidentPayload`.
 */
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

/**
 * Load the Incident row by id. Writes the HTTP error response
 * (`null` return = "I handled it, stop here") on any failure.
 */
export const loadOrRespond = async (input: LoadRowInput): Promise<IncidentRow | null> => {
  const { deps, id, verb, res } = input;
  let row: IncidentRow | null;
  try {
    row = await deps.repo.incident.findUnique({ where: { id } });
  } catch (err) {
    console.error(`api/incidents/${id}/${verb}: findUnique failed`, err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    return null;
  }
  if (row === null) {
    res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
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

/**
 * Write the `invalid_transition_attempt` audit event + respond
 * 409 with the from/attempted pair.
 */
export const respondInvalidAttempt = async (input: InvalidAttemptResponseInput): Promise<void> => {
  const { deps, incidentId, actorUserId, from, attempted, at, res } = input;
  await writeInvalidAttemptEvent({ deps, incidentId, actorUserId, from, attempted, at });
  res.status(HTTP_CONFLICT).json({
    error: "invalid_state_transition",
    from,
    attempted,
  });
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

/**
 * Apply the transition inside `$transaction`. Returns the applied
 * result on success, or `null` if the handler already wrote the
 * response (writer error or optimistic-concurrency loss).
 */
export const commitTransition = async (
  input: CommitTransitionInput,
): Promise<Awaited<ReturnType<typeof applyTransition>> | null> => {
  const { deps, verb, id, currentRow, result, actorUserId, assigneeUserId, res } = input;
  const applyInput: ApplyTransitionInput = {
    currentRow,
    result,
    actorUserId,
    // `notification:critical` fires on UNSAFE only (Story 4.9 AC2).
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
      res.status(HTTP_CONFLICT).json({
        error: "invalid_state_transition",
        reason: "concurrent_modification",
      });
      return null;
    }
    if (isPrismaErrorWithCode(err, "P2002")) {
      // Patch (code review 2026-08-27 #1): partial-unique-index
      // race on `notification:critical` is benign idempotency.
      // Map to 409 instead of 500.
      console.warn(
        `api/incidents/${id}/${verb}: P2002 collapsed to existing row, treating as concurrent_modification`,
      );
      res.status(HTTP_CONFLICT).json({
        error: "invalid_state_transition",
        reason: "concurrent_modification",
      });
      return null;
    }
    if (isPrismaErrorWithCode(err, "P2003")) {
      // Patch (code review 2026-08-27 #3): FK violation on
      // assigneeUserId most likely means the User was deleted
      // between request validation and write. Surface as 400
      // not_found rather than 500.
      console.warn(`api/incidents/${id}/${verb}: P2003 FK violation (likely missing assignee)`);
      res.status(HTTP_BAD_REQUEST).json({ error: "invalid_assignee", reason: "not_found" });
      return null;
    }
    console.error(`api/incidents/${id}/${verb}: applyTransition failed`, err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    return null;
  }
};

/**
 * Narrow type guard for Prisma error code matching. The shape
 * varies across Prisma versions; the minimal `code` check is
 * what the writer layer relies on.
 */
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

/**
 * AC4 observability log line for every successful transition.
 */
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

interface StateChangedEmitInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly incidentId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly at: string;
  readonly actorUserId: string | null;
}

/**
 * Post-commit `incident:state_changed` socket emit on the
 * per-incident room.
 */
export const emitStateChanged = (input: StateChangedEmitInput): void => {
  const { deps, incidentId, fromState, toState, at, actorUserId } = input;
  if (deps.broadcast === undefined) return;
  const room = `incident:${incidentId}`;
  deps.broadcast.to(room).emit("incident:state_changed", {
    incident_id: incidentId,
    from_state: fromState,
    to_state: toState,
    changed_at: at,
    actor_user_id: actorUserId,
  });
};

interface OwnershipCheckInput {
  readonly ownerId: string | null;
  readonly req: AuthorizedRequest;
  readonly res: Response;
  readonly audit: AuditLogger;
}

/**
 * Run the canonical `requireOwner` shape inline so we can return
 * the 403 directly without re-wiring the middleware. The
 * middleware's audit-log shape is mirrored exactly.
 */
export const runOwnershipCheck = async (input: OwnershipCheckInput): Promise<boolean> => {
  const { ownerId, req, res, audit } = input;
  if (req.user === undefined || req.user === null) {
    res.status(HTTP_UNAUTHORIZED).json({ error: "unauthorized" });
    return true;
  }
  if (ownerId === req.user.id) return false;
  audit.emit({
    auditAction: "rbac_denied",
    userId: req.user.id,
    outcome: "failure",
    context: {
      subject: req.user.role,
      action: "submit_result",
      resource: "Incident",
      reason: "not_assignee",
    },
  });
  res.status(HTTP_FORBIDDEN).json({ error: "forbidden", required_role: "Technician" });
  return true;
};

interface InvalidAttemptInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly incidentId: string;
  readonly actorUserId: string | null;
  readonly from: string;
  readonly attempted: ActionVerb;
  readonly at: string;
}

/**
 * Write an `IncidentEvent` with `type: "invalid_transition_attempt"`
 * so the audit trail captures the loser's intent. Lives outside
 * `$transaction` because the route has already decided to 409 — a
 * failed event write should not block the response.
 */
export const writeInvalidAttemptEvent = async (input: InvalidAttemptInput): Promise<void> => {
  const { deps, incidentId, actorUserId, from, attempted, at } = input;
  // Patch (code review 2026-08-27 #16): emit a structured audit log
  // alongside the IncidentEvent row. The row is the durable audit
  // trail; the structured log line is the immediate observability
  // hook (Story 5.6 will swap `index.ts`'s console transport for
  // a real AuditLog writer — both surfaces stay in lockstep).
  deps.audit.emit({
    auditAction: "invalid_state_transition",
    userId: actorUserId ?? undefined,
    outcome: "failure",
    context: { incidentId, from, attempted, at },
  });
  try {
    await deps.repo.incidentEvent.create({
      data: {
        incidentId,
        actorUserId,
        type: "invalid_transition_attempt",
        payload: { from, attempted, at },
      },
    });
  } catch (err) {
    console.error(
      `api/incidents/${incidentId}: invalid_transition_attempt event write failed`,
      err,
    );
  }
};
