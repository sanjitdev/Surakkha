/**
 * Negative RBAC test router — Surakkha api (Story 1.8).
 *
 * A test-only fixture that mounts one stub route per (action × resource)
 * denial cell from `RBAC_NEGATIVE_CASES` plus the cross-cutting
 * ownership rule. Each route is gated with `authorize({ action, resource
 * }, audit)`, mirroring the real surface so a regression in the matrix
 * or the middleware surfaces as a 200 here.
 *
 * NOT mounted by the production api (`packages/api/src/index.ts`) — the
 * file lives under `src/__tests__/` so vitest picks it up but the api's
 * production bundle never imports it.
 */
import {
  type Action,
  type AuditAction,
  type Resource,
  type Role as RbacRole,
} from "@surakkha/shared/rbac";
import express, { type Express, type Request, type Response } from "express";

import { type AuditLogger } from "../audit";
import { authenticate, authorize, requireOwner } from "../middleware/authorize";

const ADMIN_UUID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_UUID = "00000000-0000-4000-8000-00000000a002";
const TECHNICIAN_UUID = "00000000-0000-4000-8000-00000000a003";
const VIEWER_UUID = "00000000-0000-4000-8000-00000000a004";

export const ADMIN_ID = ADMIN_UUID;
export const OPERATOR_ID = OPERATOR_UUID;
export const TECHNICIAN_ID = TECHNICIAN_UUID;
export const VIEWER_ID = VIEWER_UUID;

interface MountArgs {
  readonly method: "get" | "post" | "put" | "patch" | "delete";
  readonly path: string;
  readonly action: Action;
  readonly resource: Resource;
}

const mountOne = (app: Express, audit: AuditLogger, args: MountArgs): void => {
  app[args.method](
    args.path,
    authorize({ action: args.action, resource: args.resource }, audit),
    (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    },
  );
};

/**
 * Mount a route for the `requireOwner` cross-cutting rule. The caller
 * passes the resource's owner id; the technician must match it.
 */
export const mountOwnerRoute = (
  app: Express,
  audit: AuditLogger,
  args: {
    readonly method: "get" | "post" | "put" | "patch" | "delete";
    readonly path: string;
    readonly action: Action;
    readonly resource: Resource;
    readonly ownerId: string;
  },
): void => {
  app[args.method](
    args.path,
    authorize({ action: args.action, resource: args.resource }, audit),
    requireOwner(args.ownerId, audit),
    (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    },
  );
};

/**
 * One entry per denial cell the Story 1.8 register pins. The set
 * superset'd `RBAC_NEGATIVE_CASES` (10 cases) plus extra cells that
 * catch obvious bypasses (Viewer reading AuditLog, Operator driving
 * Simulator, etc.).
 */
const NEGATIVE_ROUTES: readonly MountArgs[] = [
  // 1. Operator → read → AuditLog (RBAC_NEGATIVE_CASES #1)
  { method: "get", path: "/audit", action: "read", resource: "AuditLog" },
  // 2. Viewer → create → Incident (RBAC_NEGATIVE_CASES #2)
  { method: "post", path: "/incidents", action: "create", resource: "Incident" },
  // 3. Operator → drive → Simulator (RBAC_NEGATIVE_CASES #5)
  { method: "post", path: "/admin/simulator/x/scenario", action: "drive", resource: "Simulator" },
  // 4. Viewer → submit_result → Incident (RBAC_NEGATIVE_CASES #4)
  {
    method: "post",
    path: "/incidents/x/submit_result",
    action: "submit_result",
    resource: "Incident",
  },
  // 5. Technician → export → Reading (RBAC_NEGATIVE_CASES #6)
  { method: "get", path: "/devices/x/export.csv", action: "export", resource: "Reading" },
  // 6. Operator → read → SeverityBanner (RBAC_NEGATIVE_CASES #7)
  { method: "get", path: "/banners/active", action: "read", resource: "SeverityBanner" },
  // 7. Viewer → update → Rule (RBAC_NEGATIVE_CASES #8)
  { method: "patch", path: "/admin/thresholds/x", action: "update", resource: "Rule" },
  // 8. Operator → manage → User (RBAC_NEGATIVE_CASES #9)
  { method: "post", path: "/admin/users", action: "manage", resource: "User" },
  // 9. Viewer → manage → User (extra)
  { method: "post", path: "/admin/users", action: "manage", resource: "User" },
  // 10. Technician → delete → Device (extra)
  { method: "delete", path: "/devices/x", action: "delete", resource: "Device" },
  // 11. Technician → update → Device (extra)
  { method: "patch", path: "/devices/x", action: "update", resource: "Device" },
  // 12. Technician → create → Device (extra)
  { method: "post", path: "/devices", action: "create", resource: "Device" },
  // 13. Operator → reopen → Incident (extra)
  { method: "post", path: "/incidents/x/reopen", action: "reopen", resource: "Incident" },
  // 14. Operator → delete → Device (extra)
  { method: "delete", path: "/devices/x", action: "delete", resource: "Device" },
  // 15. Viewer → acknowledge → Incident (extra)
  { method: "post", path: "/incidents/x/acknowledge", action: "acknowledge", resource: "Incident" },
  // 16. Technician → resolve → Incident (extra)
  { method: "post", path: "/incidents/x/resolve", action: "resolve", resource: "Incident" },
  // 17. Viewer → acknowledge → Alert (Story 3.5 AC3) and
  // 18. Technician → acknowledge → Alert (Story 3.5 AC4) — RBAC
  // matrix grants `Alert.acknowledge = false` to both. The test rig
  // drives BOTH subjects (NEGATIVE_CASES indices 16 + 17) against
  // the SINGLE mounted handler here (Express's `app.post` with
  // duplicate `(method, path)` literals would warn + override; only
  // one handler survives per unique path). The shared gate enforces
  // both denies by virtue of the matrix cell.
  { method: "post", path: "/alerts/x/acknowledge", action: "acknowledge", resource: "Alert" },
];

/**
 * Build a single Express app that mounts every negative-route fixture.
 * The `audit` logger is wired through so each denial is asserted.
 */
export const buildRbacNegativeApp = (audit: AuditLogger): Express => {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  for (const route of NEGATIVE_ROUTES) {
    mountOne(app, audit, route);
  }
  // Cross-cutting ownership route — Technician reads Incident, must
  // own it. Owner is fixed at the Admin UUID so any Technician token
  // fails the ownership check (RBAC_NEGATIVE_CASES #3, #10).
  mountOwnerRoute(app, audit, {
    method: "get",
    path: "/incidents/:id",
    action: "read",
    resource: "Incident",
    ownerId: ADMIN_UUID,
  });
  return app;
};

/**
 * The set of (subject, expected, action, resource, path, method) cases
 * the negative test file drives. Each entry corresponds to exactly
 * one `it(...)` block. The `(method, path)` tuple is what the test
 * fetches; the `(action, resource)` tuple is the gate the api
 * enforces; the `(subject, expected)` pair is the expected outcome.
 */
export interface NegativeCase {
  readonly index: number;
  readonly subject: RbacRole;
  readonly method: "get" | "post" | "put" | "patch" | "delete";
  readonly path: string;
  readonly action: Action;
  readonly resource: Resource;
  readonly expected: 403 | 200;
  /** Audit log action we expect to be emitted on a denial. */
  readonly auditAction: AuditAction | null;
  /** Path in `docs/architecture-appendix-rbac.md` this case pins. */
  readonly appendixRow: string;
}

export const NEGATIVE_CASES: readonly NegativeCase[] = [
  {
    index: 1,
    subject: "Operator",
    method: "get",
    path: "/audit",
    action: "read",
    resource: "AuditLog",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "AuditLog · read",
  },
  {
    index: 2,
    subject: "Viewer",
    method: "post",
    path: "/incidents",
    action: "create",
    resource: "Incident",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Incident · create",
  },
  {
    index: 3,
    subject: "Technician",
    method: "get",
    path: "/incidents/abc",
    action: "read",
    resource: "Incident",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Incident · read (not assignee)",
  },
  {
    index: 4,
    subject: "Viewer",
    method: "post",
    path: "/incidents/x/submit_result",
    action: "submit_result",
    resource: "Incident",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Incident · submit_result",
  },
  {
    index: 5,
    subject: "Operator",
    method: "post",
    path: "/admin/simulator/x/scenario",
    action: "drive",
    resource: "Simulator",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Simulator · drive",
  },
  {
    index: 6,
    subject: "Technician",
    method: "get",
    path: "/devices/x/export.csv",
    action: "export",
    resource: "Reading",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Reading · export",
  },
  {
    index: 7,
    subject: "Operator",
    method: "get",
    path: "/banners/active",
    action: "read",
    resource: "SeverityBanner",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "SeverityBanner · read",
  },
  {
    index: 8,
    subject: "Viewer",
    method: "patch",
    path: "/admin/thresholds/x",
    action: "update",
    resource: "Rule",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Rule · update",
  },
  {
    index: 9,
    subject: "Operator",
    method: "post",
    path: "/admin/users",
    action: "manage",
    resource: "User",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "User · manage",
  },
  // 10. Technician → reopen → Incident (RBAC_NEGATIVE_CASES #10 was
  // mis-anchored — the matrix grants Technician submit_result on
  // Incident but denies reopen. We pin the actual deny cell.)
  {
    index: 10,
    subject: "Technician",
    method: "post",
    path: "/incidents/x/reopen",
    action: "reopen",
    resource: "Incident",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Incident · reopen (Technician)",
  },
  // Extra cells beyond RBAC_NEGATIVE_CASES so the register exceeds the
  // Story 1.8 floor of "at least 10 negative RBAC cases".
  {
    index: 11,
    subject: "Viewer",
    method: "post",
    path: "/admin/users",
    action: "manage",
    resource: "User",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "User · manage (Viewer)",
  },
  {
    index: 12,
    subject: "Technician",
    method: "delete",
    path: "/devices/x",
    action: "delete",
    resource: "Device",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Device · delete (Technician)",
  },
  {
    index: 13,
    subject: "Operator",
    method: "post",
    path: "/incidents/x/reopen",
    action: "reopen",
    resource: "Incident",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Incident · reopen (Operator)",
  },
  {
    index: 14,
    subject: "Viewer",
    method: "post",
    path: "/incidents/x/acknowledge",
    action: "acknowledge",
    resource: "Incident",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Incident · acknowledge (Viewer)",
  },
  {
    index: 15,
    subject: "Technician",
    method: "post",
    path: "/incidents/x/resolve",
    action: "resolve",
    resource: "Incident",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Incident · resolve (Technician)",
  },
  // Story 3.5 — Alert lifecycle. The matrix cell
  // `Alert.acknowledge = Admin + Operator only` is new; cases 16 + 17
  // pin Viewer + Technician denials on the new endpoint so a future
  // matrix drift surfaces as a failed test rather than a silent
  // privilege escalation. The path `/alerts/x/acknowledge` mirrors
  // the production route literal.
  {
    index: 16,
    subject: "Viewer",
    method: "post",
    path: "/alerts/x/acknowledge",
    action: "acknowledge",
    resource: "Alert",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Alert · acknowledge (Viewer)",
  },
  {
    index: 17,
    subject: "Technician",
    method: "post",
    path: "/alerts/x/acknowledge",
    action: "acknowledge",
    resource: "Alert",
    expected: 403,
    auditAction: "rbac_denied",
    appendixRow: "Alert · acknowledge (Technician)",
  },
];

/** Map subject → UUID for token minting in tests. */
export const SUBJECT_UUID: Record<RbacRole, string> = {
  Admin: ADMIN_UUID,
  Operator: OPERATOR_UUID,
  Technician: TECHNICIAN_UUID,
  Viewer: VIEWER_UUID,
};
