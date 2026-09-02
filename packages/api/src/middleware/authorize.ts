/**
 * RBAC middleware — Surakkha api. Exports `authenticate` +
 * `markPublic` + `authorize({ action, resource }, audit)` +
 * `requireOwner`. The matrix predicates come from
 * `@surakkha/shared/rbac` only.
 */
import { type Action, isAllowed, type Resource, type Role } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../audit";
import { verifyAccessToken } from "../auth/jwt";
import { findUserById } from "../auth/users";
import { ERROR_CODES } from "../errors.js";
import { HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from "../httpStatus.js";

import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Minimal user shape attached to the request by authenticate(). */
export interface AuthenticatedUser {
  readonly id: string;
  readonly role: Role;
  readonly scope: string;
}

/**
 * Request shape extended with the fields this module attaches.
 * We carry the augmentation as a named interface (rather than
 * `declare module "express-serve-static-core"`) so consumers can
 * type-cast at the boundary without polluting Express's globals.
 */
export interface AuthorizedRequest extends Request {
  public?: boolean;
  user?: AuthenticatedUser | null;
}

const asAuthorized = (req: Request): AuthorizedRequest => req as AuthorizedRequest;

/** Extract the bearer token from an `Authorization` header.
 *  Returns `null` if the header is missing, malformed, or empty. */
const extractBearer = (header: string | undefined): string | null => {
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match === null ? null : (match[1] ?? null);
};

/** `authenticate` — sets `req.user` when a valid access token is
 *  presented. Public routes (those wrapped by `markPublic()`)
 *  tolerate an absent token and continue anonymously. */
export const authenticate: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const areq = asAuthorized(req);
  const raw = req.headers["authorization"];
  const token = extractBearer(typeof raw === "string" ? raw : undefined);
  if (token === null) {
    if (areq.public === true) {
      areq.user = null;
      next();
      return;
    }
    res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.UNAUTHORIZED.value });
    return;
  }

  const claims = verifyAccessToken(token);
  if (claims === null) {
    res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.UNAUTHORIZED.value });
    return;
  }

  const user = findUserById(claims.sub);
  if (user === null) {
    // Token is signed but the subject does not match a known user —
    // structurally valid, semantically orphaned; treat as 401.
    res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.UNAUTHORIZED.value });
    return;
  }

  areq.user = { id: user.id, role: user.role, scope: claims.scope };
  next();
};

/** `markPublic(handler)` — sets `req.public = true` and invokes the
 *  wrapped handler. Must mount BEFORE `authenticate()`. Used by
 *  the auth router for `/login` and `/refresh` so the per-route
 *  PUBLIC intent is colocated and type-checked. */
export const markPublic = <H extends RequestHandler>(handler: H): RequestHandler => {
  const wrapped: RequestHandler = (req, res, next) => {
    asAuthorized(req).public = true;
    handler(req, res, next);
  };
  return wrapped;
};

/** Smallest role that the matrix grants for the (action, resource)
 *  pair — used as `required_role` in the 403 body so the SPA can
 *  say "you need at least Operator". `ROLE_ORDER` is
 *  LEAST-privileged-first; the previous most-privileged-first
 *  ordering returned "Admin" for any multi-grantor action. */
const ROLE_ORDER: readonly Role[] = ["Viewer", "Technician", "Operator", "Admin"];

const smallestGrantingRole = (action: Action, resource: Resource): Role | null => {
  for (const role of ROLE_ORDER) {
    if (isAllowed({ subject: role, action, resource })) return role;
  }
  return null;
};

export interface AuthorizeOptions {
  readonly action: Action;
  readonly resource: Resource;
}

/** `authorize({ action, resource }, audit)` — Express middleware
 *  factory that enforces the (subject, action, resource) triple and
 *  writes an audit row on EVERY decision (allow OR deny). The allow
 *  row is written BEFORE `next()` so a downstream handler that throws
 *  still leaves a faithful audit trail. */
export const authorize = (opts: AuthorizeOptions, audit: AuditLogger): RequestHandler => {
  const { action, resource } = opts;
  return (req: Request, res: Response, next: NextFunction): void => {
    const areq = asAuthorized(req);
    if (areq.user === undefined || areq.user === null) {
      res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.UNAUTHORIZED.value });
      return;
    }

    const allowed = isAllowed({
      subject: areq.user.role,
      action,
      resource,
    });
    if (allowed) {
      audit.emit({
        auditAction: "rbac_allowed",
        userId: areq.user.id,
        outcome: "allow",
        context: {
          subject: areq.user.role,
          action,
          resource,
        },
      });
      next();
      return;
    }

    const required = smallestGrantingRole(action, resource) ?? "Admin";
    audit.emit({
      auditAction: "rbac_denied",
      userId: areq.user.id,
      outcome: "failure",
      context: {
        subject: areq.user.role,
        action,
        resource,
        required_role: required,
      },
    });
    res
      .status(HTTP_FORBIDDEN)
      .json({ error: ERROR_CODES.FORBIDDEN.value, required_role: required });
  };
};

/** Ownership gate. Run AFTER `authorize()` has admitted the user and
 *  AFTER the handler has resolved the resource. If `ownerId` differs
 *  from `req.user.id`, treat as RBAC denial (403 + rbac_denied audit
 *  with `reason: "not_assignee"`). */
export const requireOwner =
  (ownerId: string | undefined, audit: AuditLogger): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const areq = asAuthorized(req);
    if (areq.user === undefined || areq.user === null) {
      res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.UNAUTHORIZED.value });
      return;
    }
    if (ownerId === undefined) {
      // Nothing to compare against; let the handler decide.
      next();
      return;
    }
    if (ownerId === areq.user.id) {
      next();
      return;
    }
    audit.emit({
      auditAction: "rbac_denied",
      userId: areq.user.id,
      outcome: "failure",
      context: {
        subject: areq.user.role,
        action: "read",
        resource: "Incident",
        reason: "not_assignee",
      },
    });
    res
      .status(HTTP_FORBIDDEN)
      .json({ error: ERROR_CODES.FORBIDDEN.value, required_role: "Technician" });
  };
