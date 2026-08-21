# 0011 — RBAC as `(subject, action, resource)` middleware

**Status:** Accepted
**Date:** 2026-08-21
**Deciders:** Engineering team
**Related architecture IDs:** §8.3, I-3, I-4
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Surakkha has four roles (`Admin`, `Operator`, `Technician`, `Viewer`),
13 actions, and resources spanning 11 types (devices, readings,
alerts, incidents, rules, users, schools, audit logs, notifications,
simulator, severity banners). The full matrix is in
`docs/architecture-appendix-rbac.md` and runs 116 cells.

The architecture document (§8.3) is explicit on one thing: **there is
no implicit "Admin can do everything."** Every endpoint is a
`(subject, action, resource)` triple that must be authorised
individually. The matrix is data; the *enforcement mechanism* is
architecture.

Forces:

- Three packages (`api`, `web`, `simulator`) and five subsystems
  inside the api need to call the same authorisation decision.
- The decision must be made **after authentication** (we need
  `req.user`) and **before the handler** (we cannot let the handler
  see an unauthorised request).
- A failed authorisation attempt is itself a security-relevant event
  and must be logged.

## Decision

Authorisation is a **dedicated middleware** at
`packages/api/src/middleware/authorize.ts`, mounted on every
authenticated route. The middleware reads
`(req.user.role, action, resource.type, resource.owner_id)` from a
single source of truth in `packages/shared/src/rbac.ts` and either
calls `next()` or returns `403 forbidden`.

Three corollaries:

1. **No inline role checks in handlers.** A handler that contains
   `if (req.user.role !== 'Admin')` is a code-review reject. The
   decision is delegated to the middleware.
2. **The matrix lives in code, not in a config file.** The 116-cell
   table is TypeScript, typed exhaustively against the `Role` and
   `Action` enums. Drift between matrix and runtime is a compile
   error.
3. **Failed attempts are audited.** Every `403 forbidden` writes an
   `AuditLog` row with `actor_user_id`, `attempted_action`,
   `resource`, and `ip`. The audit log is itself readable only by
   `Admin` (matrix row 9.3).

## Consequences

**Positive**

- One place to audit when reviewing the authorisation surface. Code
  review becomes "is this route mounted with `authorize(action, type)`
  in front of the handler?".
- The matrix is typed. Adding a new role without specifying its
  permissions is a TypeScript error. Forgetting to authorise a new
  resource is a code-review reject, not a runtime vulnerability.
- The middleware is the only thing the web dashboard needs to mirror
  for UI-level affordances (hiding buttons, disabling actions). Both
  packages read the same `packages/shared/src/rbac.ts`.

**Negative**

- Every new endpoint must declare its action and resource type at
  mount time. This is two extra parameters per route. The cost is
  small; the benefit is uniform.
- The middleware reads `resource.owner_id` from the URL or the
  request body. Mis-wiring is a security bug. We mitigate with
  integration tests that exercise both the positive and the
  documented negative cases (Story 1.8, 10+ negative tests).

**Neutral**

- The middleware does not implement attribute-based access control
  (ABAC). v1 is RBAC only. Time-of-day or IP-range rules are v2.

## Reversal

The middleware-as-decision-point reverses when:

- **ABAC is required** (e.g. "Technicians can resolve incidents only
  during business hours" or "Operators cannot view alert payloads
  from a different district"). We extend `rbac.ts` with a policy
  engine; the middleware stays the entry point.
- **Per-resource, per-instance rules** outgrow the 116-cell matrix
  (e.g. "this Operator is temporarily restricted to school X"). The
  matrix becomes the *default*; an instance-level override table
  joins it. The middleware shape does not change.
- **The api is split into multiple processes** (ADR 0002 reversal).
  Each process still uses the same middleware; the `rbac.ts` module
  is the shared contract.

Until then, one middleware, one matrix in TypeScript, `403 forbidden`
on failure, audit row on failure. The matrix is data; the middleware
is the contract; both live in `packages/`.
