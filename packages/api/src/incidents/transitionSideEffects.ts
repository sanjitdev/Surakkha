/**
 * Side-effect helpers for incident transitions: ownership check
 * for the Technician-only-mine 403 path, post-commit
 * `incident:state_changed` socket emit, and the audit-trail
 * `IncidentEvent` row for invalid state-machine misses.
 */
import { type ActionVerb } from "@surakkha/shared/incident";
import { type Response } from "express";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import { HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from "../httpStatus.js";
import { type AuthorizedRequest } from "../middleware/authorize.js";

import { type IncidentsRouterDepsLike } from "./transitionHelpers.js";

interface OwnershipCheckInput {
  readonly ownerId: string | null;
  readonly req: AuthorizedRequest;
  readonly res: Response;
  readonly audit: AuditLogger;
}

/** Mirror the canonical `requireOwner` middleware's audit-log
 *  shape so the inline path stays equivalent. */
export const runOwnershipCheck = async (input: OwnershipCheckInput): Promise<boolean> => {
  const { ownerId, req, res, audit } = input;
  if (req.user === undefined || req.user === null) {
    res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.UNAUTHORIZED.value });
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
  res
    .status(HTTP_FORBIDDEN)
    .json({ error: ERROR_CODES.FORBIDDEN.value, required_role: "Technician" });
  return true;
};

interface StateChangedEmitInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly incidentId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly at: string;
  readonly actorUserId: string | null;
}

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

interface InvalidAttemptInput {
  readonly deps: IncidentsRouterDepsLike;
  readonly incidentId: string;
  readonly actorUserId: string | null;
  readonly from: string;
  readonly attempted: ActionVerb;
  readonly at: string;
}

/** Audit trail for typed state-machine misses and DB-layer
 *  concurrent-modification losses. Lives outside `$transaction`
 *  because the route has already decided to 409 — a failed event
 *  write should not block the response. */
export const writeInvalidAttemptEvent = async (input: InvalidAttemptInput): Promise<void> => {
  const { deps, incidentId, actorUserId, from, attempted, at } = input;
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
