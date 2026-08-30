/**
 * RBAC middleware — Surakkha api (Story 1.5).
 *
 * Wire contract:
 *
 *   authenticate(req, res, next)
 *     - Reads `Authorization: Bearer <token>`
 *     - Calls `verifyAccessToken(token)`; on success sets `req.user =
 *       { id, role, scope }`. On failure (missing / tampered / expired)
 *       responds 401 unless `req.public === true`, in which case it
 *       sets `req.user = null` and continues.
 *
 *   markPublic(handler) → handler
 *     - Per-route opt-in flag (`req.public = true`) so authenticate()
 *       stops rejecting anonymous traffic. Story 1.4 marks the login
 *       and refresh routes with `// PUBLIC` comments; the call sites
 *       in `auth/router.ts` wrap their handler with this helper so
 *       the intent is also encoded in the type-checked source.
 *
 *   authorize({ action, resource, audit })(req, res, next)
 *     - Requires `req.user` to be present; 401 if not (defensive — the
 *       usual path is for authenticate() to have set it).
 *     - Calls `isAllowed({ subject, action, resource })` from
 *       `@surakkha/shared/rbac` (the canonical authority source).
 *     - On allow: `next()`.
 *     - On deny:
 *         - Writes a `rbac_denied` audit event via the injected
 *           `AuditLogger` (subject, action, resource, outcome: "failure").
 *         - Responds 403 with `{ error: "forbidden", required_role }`
 *           where `required_role` is the lowest-rank role that the
 *           matrix grants the action × resource.
 *
 *   requireOwner(req, res, next)
 *     - Ownership gate for Technician → Incident (Story 1.7 AC).
 *       Applied after authorize() when the handler has resolved the
 *       resource owner. Compares `ownerId` (passed in by the caller)
 *       with `req.user.id`; on mismatch, 403 + rbac_denied audit.
 *
 * Story 1.5 AC (epics.md §1.5):
 *   - Single `authorize.ts` runs after auth and before every handler
 *   - 403 returns `{ error: "forbidden", required_role }`
 *   - rbac_denied audit row on every denied attempt
 *   - Predicates come from `@surakkha/shared/rbac` only — no duplicated
 *     literals here (enforced by `pnpm lint:rbac`)
 *   - `// PUBLIC` opt-in is per-handler; the public intent is also
 *     surfaced via `markPublic(handler)` so a reader of the source can
 *     see it without scanning for the comment.
 */
import { type Action, isAllowed, type Resource, type Role } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../audit";
import { verifyAccessToken } from "../auth/jwt";
import { findUserById } from "../auth/users";

import type { NextFunction, Request, RequestHandler, Response } from "express";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

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

/**
 * Extract the bearer token from an `Authorization` header. Returns
 * `null` if the header is missing, malformed, or empty.
 */
const extractBearer = (header: string | undefined): string | null => {
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match === null ? null : (match[1] ?? null);
};

/**
 * `authenticate` — Story 1.5's first gate. Sets `req.user` when a
 * valid access token is presented. Public routes (those wrapped by
 * `markPublic()`) tolerate an absent token and continue anonymously.
 */
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
    res.status(HTTP_UNAUTHORIZED).json({ error: "unauthorized" });
    return;
  }

  const claims = verifyAccessToken(token);
  if (claims === null) {
    res.status(HTTP_UNAUTHORIZED).json({ error: "unauthorized" });
    return;
  }

  const user = findUserById(claims.sub);
  if (user === null) {
    // The token is signed but the subject does not match a known
    // user. Treat as 401 — structurally valid, semantically orphaned.
    res.status(HTTP_UNAUTHORIZED).json({ error: "unauthorized" });
    return;
  }

  areq.user = { id: user.id, role: user.role, scope: claims.scope };
  next();
};

/**
 * `markPublic(handler)` — returns a middleware that sets
 * `req.public = true` and then invokes the wrapped handler. Must be
 * mounted BEFORE `authenticate()` so the flag is in place when the
 * bearer-token check runs. Used by the auth router for `/login` and
 * `/refresh` (Story 1.4 AC: `// PUBLIC` markers; the source comment
 * and this wrapper together keep the intent colocated and type-checked).
 */
export const markPublic = <H extends RequestHandler>(handler: H): RequestHandler => {
  const wrapped: RequestHandler = (req, res, next) => {
    asAuthorized(req).public = true;
    handler(req, res, next);
  };
  return wrapped;
};

/**
 * "Smallest role that can perform `action` on `resource`." Used as
 * the `required_role` field in the 403 body so the SPA can render a
 * targeted message ("you need at least Operator to do this"). The
 * semantic is "the LEAST privileged role that the matrix grants the
 * action × resource" — i.e., the lowest tier of role that could fix
 * the denial by signing in as a different (more-privileged) account.
 *
 * `ROLE_ORDER` is therefore ordered LEAST-privileged-first
 * (Viewer, Technician, Operator, Admin) so the left-to-right walk
 * returns the smallest granting role on first match. The previous
 * most-privileged-first ordering returned `"Admin"` for any
 * multi-grantor action (e.g. `Alert.acknowledge`), making the SPA's
 * "you need at least X" copy incorrectly demand Admin when Operator
 * would suffice.
 */
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

/**
 * `authorize({ action, resource }, audit)` — Story 1.5 factory.
 * Returns an Express middleware that enforces the (subject, action,
 * resource) triple and writes an audit row on EVERY authorization
 * decision (allow OR deny). The triple is static per handler; for
 * dynamic cases (e.g. read on a device-id parsed from the URL), the
 * caller invokes `isAllowed` directly.
 *
 * Audit semantics:
 *   - On allow: writes `auditAction: "rbac_allowed"`, `outcome: "allow"`.
 *     Operational dashboards key off this row to count permitted vs
 *     denied attempts; without it dashboards cannot answer "how many
 *     Viewer reads of /api/alerts succeeded today?".
 *   - On deny: writes `auditAction: "rbac_denied"`, `outcome: "failure"`,
 *     plus a `required_role` context field naming the least-privileged
 *     role that WOULD satisfy the request.
 *
 * The allow-row is written BEFORE `next()` (synchronously, before any
 * downstream middleware can mutate the audit log) so a handler that
 * throws still leaves a faithful audit trail.
 */
export const authorize = (opts: AuthorizeOptions, audit: AuditLogger): RequestHandler => {
  const { action, resource } = opts;
  return (req: Request, res: Response, next: NextFunction): void => {
    const areq = asAuthorized(req);
    if (areq.user === undefined || areq.user === null) {
      res.status(HTTP_UNAUTHORIZED).json({ error: "unauthorized" });
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
    res.status(HTTP_FORBIDDEN).json({ error: "forbidden", required_role: required });
  };
};

/**
 * Ownership gate. Run AFTER `authorize()` has admitted the user and
 * AFTER the handler has resolved the resource. If `ownerId` differs
 * from the authenticated user's id, treat as RBAC denial (403 +
 * audit). The canonical use case is Technician → Incident (the only
 * ownership-restricted cell today: Technician read Incident, but only
 * when they are the assignee).
 */
export const requireOwner =
  (ownerId: string | undefined, audit: AuditLogger): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const areq = asAuthorized(req);
    if (areq.user === undefined || areq.user === null) {
      res.status(HTTP_UNAUTHORIZED).json({ error: "unauthorized" });
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
    res.status(HTTP_FORBIDDEN).json({ error: "forbidden", required_role: "Technician" });
  };
