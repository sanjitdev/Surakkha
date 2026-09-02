---
title: "Story 5.6 — Negative Tests for the Audit Log"
type: "feature"
created: "2026-09-02"
status: "in-review"
review_loop_iteration: 1
baseline_commit: "c17da1019b7a5e10ca3a98d0ee7c0f55f06ec3bc"
context: []
amendments:
  - loop: 1
    decided: "2026-09-02"
    decision: "Path A — amend the I/O matrix to actions the routers actually emit today; keep the 'Never — NO call site changes' rule"
    rationale: "The matrix demands `incident_state_changed`/`rule_upserted`/`simulator_scenario_changed`/`attachment_added` rows that production does not emit. The 'Never' rule forbids 5.6 from adding call sites. Resolving the contradiction by amending the matrix is the minimum-change path."
---

<!-- Target: 900–1300 tokens. -->

## Spec Change Log

The frozen intent block below was authored with the original (pre-loop-1) intention. Loop 1 (2026-09-02) found that the I/O matrix demands audit rows that production does not emit (`incident_state_changed`, `rule_upserted`, `simulator_scenario_changed`, `attachment_added`), creating an internal contradiction with the "Never — NO call site changes" rule. Human decision: **Path A** — keep the "Never" rule and amend the matrix to actions the routers actually emit today. The amended matrix lives in the `## Amended I/O Matrix (Path A, loop 1)` section below; the frozen intent block is preserved verbatim for the historical record.

### KEEP instructions (must survive re-derivation)

The loop-1 implementation produced these positive features that the loop-2 derivation must preserve:

1. **`createAuditLogWriter({ resolvePrismaClient, logger })` lazy-resolver factory.** The lazy seam matches the codebase's `getPrisma` precedent at `boot/db.ts`; every other Prisma consumer in `index.ts` takes `() => Promise<unknown>`. The eager `{ prisma }` shape in the frozen spec prose contradicts the codebase and must NOT be re-derived.
2. **`auditActionResourceMap.ts` as a separate module.** The 24-entry `Record<AuditAction, { resource, resourceIdKey }>` table is the single seam that future per-action resource customisation would land in.
3. **`auditLogWriter.spec.ts` 5 unit tests** (WRITE_HAPPY / WRITE_NO_USER / WRITE_INCIDENT_RESOURCE / WRITE_DB_FAIL / WRITE_LOGOUT) — pinned.
4. **`audit.coverage.spec.ts` end-to-end rig** with a shared Prisma capture sink — preserved. Tests now assert on the actions routers actually emit (Path A), but the rig architecture (capture stub + `startApp` per test) is the right design.
5. **Lazy Prisma resolution with swallow-and-log failure mode** (the frozen spec already pins this).

### Patch items (must apply during loop-2 derivation)

These were deferred to `deferred-work.md` during loop-1 review (F-5.6-D15..D19) and should land in the loop-2 implementation:

- **D15** — `COVERAGE_ATTACHMENT` must assert at least one row landed (not `Array.isArray(sink.rows)`).
- **D16** — Replace the two-microtask `flush()` with a polling drain or expose a Promise-returning `write()` seam.
- **D18** — `WRITE_DB_FAIL` must assert `resource` / `resourceId` / `actorUserId` in the log payload.
- **D19** — `resolveResourceId` must trim whitespace (or return `null` on `raw.trim().length === 0`).

D17 (failure-recovery JSDoc) is a documentation nit; defer-able.

### Amended I/O Matrix (Path A, loop 1)

| Scenario                    | Input / State                                                   | Expected Output / Behavior                                                                                                                                                                                                                                         | Error Handling |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| WRITE_HAPPY                 | (unchanged)                                                     | (unchanged)                                                                                                                                                                                                                                                        | n/a            |
| WRITE_NO_USER               | (unchanged)                                                     | (unchanged)                                                                                                                                                                                                                                                        | n/a            |
| WRITE_DB_FAIL               | (unchanged)                                                     | (unchanged)                                                                                                                                                                                                                                                        | swallowed      |
| WRITE_INCIDENT_RESOURCE     | (unchanged)                                                     | (unchanged)                                                                                                                                                                                                                                                        | n/a            |
| WRITE_LOGOUT                | (unchanged)                                                     | (unchanged)                                                                                                                                                                                                                                                        | n/a            |
| COVERAGE_LOGIN              | (unchanged)                                                     | (unchanged)                                                                                                                                                                                                                                                        | n/a            |
| COVERAGE_RBAC_DENIED        | (unchanged)                                                     | (unchanged)                                                                                                                                                                                                                                                        | n/a            |
| **COVERAGE_INCIDENT_ACK**   | POST `/api/incidents/:id/acknowledge` as Operator               | One `AuditLog` row with `auditAction: "rbac_allowed"` from the RBAC middleware (the success-path type-machine miss path emits `invalid_state_transition`; the success path today emits only the socket event, so the regression guard is the RBAC middleware row). | n/a            |
| **COVERAGE_THRESHOLD_EDIT** | POST `/admin/thresholds/rules` as Admin                         | One `AuditLog` row with `auditAction: "rbac_allowed"` from the RBAC middleware (the rule-upsert router does not emit a `rule_created` row today; the writer pipeline + Admin permit is the regression guard).                                                      | n/a            |
| **COVERAGE_SIMULATOR**      | POST `/admin/simulator/:id/scenario` as Admin (success or 502)  | One `AuditLog` row with `auditAction: "rbac_allowed"`; the success path also writes `auditAction: "simulator_event"` (the action routers actually emit), the 502 path writes only `rbac_allowed`.                                                                  | n/a            |
| **COVERAGE_ATTACHMENT**     | POST `/api/incidents/:id/attachments` as Admin (success or 500) | At least one `AuditLog` row exists in the sink (any `auditAction`); proves the writer pipeline reaches the attachment router.                                                                                                                                      | n/a            |

### Amended Code Map (Path A, loop 1)

- `packages/api/src/audit.ts:11-32` — unchanged
- `packages/api/src/index.ts:92-106` — `audit: createAuditLogWriter({ resolvePrismaClient: getPrisma, logger })` (the lazy-resolver factory; not the eager `{ prisma }` in the frozen prose)
- `packages/db/prisma/schema.prisma:678-692` — unchanged
- `packages/shared/src/rbac.ts:510-556` — unchanged
- `packages/shared/src/audit.ts:53-67` — unchanged
- `packages/api/src/auth/router.ts:97-107` — `login_success` emit (real call site)
- `packages/api/src/middleware/authorize.ts:212-238` — `rbac_allowed` / `rbac_denied` emits (real call sites)
- `packages/api/src/incidents/transitionSideEffects.ts:46-115` — `invalid_state_transition` emit (the row the COVERAGE_INCIDENT_ACK type-miss path produces)

The frozen `transitionHelpers.ts:498` pin is REMOVED in the amended map (the file/line does not exist in the codebase).

### Amended Factory Signature (Path A, loop 1)

The frozen spec prose names `createAuditLogWriter({ prisma })` (eager) and `createAuditLogWriter({ prisma, logger })` (also eager). The amended signature is:

```ts
createAuditLogWriter({ resolvePrismaClient: () => Promise<unknown>, logger: Logger }): AuditLogger
```

This is the signature the loop-1 implementation shipped and that loop-2 must re-derive. The lazy seam matches `boot/db.ts` precedent.

---

The frozen intent block follows below, preserved verbatim for the historical record. Loop-2 derivation must apply the Path-A amendments above while preserving the KEEP instructions.

---

<!-- ============================== -->
<!-- BEGIN FROZEN-AFTER-APPROVAL BLOCK -->
<!-- ============================== -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The v1 `audit.emit` (Story 1.5) writes a structured Pino log line but does NOT persist to the `AuditLog` Prisma table. The `GET /api/audit/list` endpoint (Story 5.3) reads from `AuditLog`, but today returns zero rows for every audited action — the audit log is a UI on top of an empty table. There is no CI proof that every audited action (incident ack, threshold edit, simulator scenario, RBAC denial) actually writes a row.

**Approach:** Swap the v1 logger-only audit emitter for a v2 Prisma writer that persists every `audit.emit` call to the `AuditLog` table. Add `packages/api/src/audit/__tests__/audit.coverage.spec.ts` with ≥8 cases, each one driving a real audited action end-to-end and asserting the corresponding `AuditLog` row was written. The coverage spec is the contract — without it, future refactors could silently re-route audit emits to log-only without anyone noticing.

## Boundaries & Constraints

**Always:**

- New `auditLogWriter.ts` module — a pure function `createAuditLogWriter({ prisma }): AuditLogger` that adapts the existing `AuditLogger.emit` interface to a `prisma.auditLog.create(...)` call. The writer is the single seam between `audit.emit` callers and the database.
- The v2 writer maps `auditAction` (closed `AuditActionSchema`) → `resource` + `resourceId` via a per-action lookup table (e.g. `incident_state_changed` → `resource: "Incident"` + `resourceId: <from context>`). For actions without a resource binding (`logout`, `rbac_allowed`), `resource` defaults to `"Other"` and `resourceId` is `null`.
- `userId: undefined` → `actorUserId: null` (the FK is nullable per the ON DELETE SET NULL invariant from 5.3).
- The `context` arg is the `payload` Json — pass through verbatim. No validation (audit payloads are heterogeneous by design).
- Wire the writer in `index.ts` (replace the v1 `logger.info(...)` with the new `createAuditLogWriter({ prisma })`). Both auth router + RBAC middleware + the 17 call sites continue to use the `AuditLogger.emit` interface — no caller-side changes.
- New `audit.coverage.spec.ts` at `packages/api/src/audit/__tests__/` with ≥8 cases covering: login_success, login_failure, rbac_denied (×2: technician blocked from another technician's incident, viewer blocked from admin route), rbac_allowed, incident_state_changed (acknowledge), threshold_edit (rule upsert), simulator_scenario_changed, attachment_added. Each case drives the action end-to-end via the real router stub + asserts the AuditLog row count + resource + outcome.
- The coverage spec uses a Prisma test rig (not a stubbed AuditLogger) so it would catch a regression that re-routes the writer away from Prisma.

**Ask First:**

- _Resolved at step-01:_ Failure-mode semantics — when `auditLog.create` rejects (DB outage), do we (a) swallow + log, (b) throw + 500 the parent request, or (c) queue for retry? Default: (a) swallow + structured `audit_log_write_failed` log line — the audit trail is best-effort; failing the user's request because the audit write failed is wrong (the action succeeded). A future story can add a retry worker.

**Never:**

- No `audit.emit` call sites are removed or restructured — the `AuditLogger.emit({ auditAction, userId?, outcome, context? })` interface is stable.
- No changes to the `AuditLog` Prisma model — the table is the Story 5.3 read surface's data source and stays as-is.
- No backfill of historical log-line audit events into the `AuditLog` table. The audit pipeline starts fresh at the swap point (the spec acknowledges this gap; backfill is deferred).
- No changes to the `GET /api/audit/list` endpoint — the Story 5.3 read surface reads from the same `AuditLog` table the writer now populates.

## I/O & Edge-Case Matrix

| Scenario                | Input / State                                                                                                | Expected Output / Behavior                                                                                                     | Error Handling |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| WRITE_HAPPY             | `audit.emit({ auditAction: "login_success", userId: <uuid>, outcome: "success", context: {} })`              | `AuditLog` row with `actorUserId`, `auditAction`, `resource: "Other"`, `resourceId: null`, `payload: {}`, `outcome: "success"` | n/a            |
| WRITE_NO_USER           | `audit.emit({ auditAction: "logout", outcome: "success" })` (no `userId`)                                    | `AuditLog` row with `actorUserId: null`, `resource: "Other"`, `resourceId: null`                                               | n/a            |
| WRITE_DB_FAIL           | `prisma.auditLog.create` rejects with P2xxx                                                                  | `audit.emit` swallows + structured `audit_log_write_failed` log line; caller is unaffected                                     | swallowed      |
| WRITE_INCIDENT_RESOURCE | `audit.emit({ auditAction: "incident_state_changed", userId, outcome: "success", context: { incidentId } })` | `AuditLog` row with `resource: "Incident"`, `resourceId: incidentId`, `payload: { incidentId, ...rest }`                       | n/a            |
| WRITE_LOGOUT            | `audit.emit({ auditAction: "logout", outcome: "success" })`                                                  | `AuditLog` row with `resource: "Other"`, `resourceId: null`                                                                    | n/a            |
| COVERAGE_LOGIN          | POST `/auth/login` with valid creds                                                                          | One `AuditLog` row with `auditAction: "login_success"`, `outcome: "success"`                                                   | n/a            |
| COVERAGE_RBAC_DENIED    | GET `/admin/thresholds` as Operator                                                                          | One `AuditLog` row with `auditAction: "rbac_denied"`, `outcome: "failure"`                                                     | n/a            |
| COVERAGE_INCIDENT_ACK   | POST `/incidents/:id/acknowledge` as Operator                                                                | One `AuditLog` row with `auditAction: "incident_state_changed"`, `resource: "Incident"`, `resourceId: incident.id`             | n/a            |
| COVERAGE_THRESHOLD_EDIT | POST `/admin/thresholds` upsert                                                                              | One `AuditLog` row with `auditAction: "rule_upserted"`, `resource: "Rule"`, `resourceId: rule.id`                              | n/a            |
| COVERAGE_SIMULATOR      | POST `/admin/simulator/:device/scenario`                                                                     | One `AuditLog` row with `auditAction: "simulator_scenario_changed"`, `resource: "Simulator"`                                   | n/a            |
| COVERAGE_ATTACHMENT     | POST `/incidents/:id/attachments`                                                                            | One `AuditLog` row with `auditAction: "attachment_added"`, `resource: "Attachment"`                                            | n/a            |

## Code Map

- `packages/api/src/audit.ts:11-32` — current `AuditLogger` interface (the contract the v2 writer keeps).
- `packages/api/src/index.ts:97-101` — current v1 `audit.emit = logger.info(...)` (replaced with `createAuditLogWriter({ prisma })`).
- `packages/db/prisma/schema.prisma:678-692` — `AuditLog` model (5.3 already shipped; no changes).
- `packages/shared/src/rbac.ts:510-548` — `AuditActionSchema` closed enum (the per-action resource map uses this).
- `packages/shared/src/audit.ts:53-67` — `AuditLogResourceSchema` (the writer's `resource` column comes from this enum).
- `packages/api/src/auth/router.ts:50-90` — `login_success` / `login_failure` audit emit sites.
- `packages/api/src/middleware/authorize.ts:222` — `rbac_denied` / `rbac_allowed` emit sites.
- `packages/api/src/incidents/transitionHelpers.ts:498` — `incident_state_changed` emit.
- `packages/api/src/admin/thresholdsWiring.ts:130` — `rule_upserted` emit.
- `packages/api/src/admin/simulatorRouter.ts:85` — `simulator_scenario_changed` emit.
- `packages/api/src/attachments/attachmentRouter.ts:60` — `attachment_added` emit.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/api/src/audit/auditLogWriter.ts` — NEW `createAuditLogWriter({ prisma, logger }): AuditLogger` adapter. Internally maps `auditAction` → `{ resource, resourceId }` via a static lookup keyed on the `AuditAction` enum.
- [ ] `packages/api/src/audit/auditActionResourceMap.ts` — NEW static lookup table mapping each `AuditAction` value to its `AuditLogResource` (+ `resourceId` extraction path from `context`). Carries a `// "logout", "rbac_allowed" map to { resource: "Other", resourceId: null }` default.
- [ ] `packages/api/src/audit/auditLogWriter.spec.ts` — NEW unit tests covering WRITE_HAPPY, WRITE_NO_USER, WRITE_INCIDENT_RESOURCE, WRITE_DB_FAIL (stub `prisma.auditLog.create` rejects), WRITE_LOGOUT.
- [ ] `packages/api/src/index.ts` — REPLACE the v1 `audit: { emit: (event) => logger.info(...) }` with `audit: createAuditLogWriter({ prisma: getPrisma(), logger })`. Defer prisma resolution so a transient DB outage at boot does not crash the api.
- [ ] `packages/api/src/audit/__tests__/audit.coverage.spec.ts` — NEW end-to-end coverage spec. ≥8 cases (COVERAGE_LOGIN / COVERAGE_RBAC_DENIED / COVERAGE_RBAC_ALLOWED / COVERAGE_INCIDENT_ACK / COVERAGE_THRESHOLD_EDIT / COVERAGE_SIMULATOR / COVERAGE_ATTACHMENT / COVERAGE_LOGOUT) driving each audited action end-to-end via the real router + middleware and asserting the AuditLog row was written. Uses a per-test Prisma transaction that rolls back so the spec is order-independent.

**Acceptance Criteria:**

- Given the v1 audit emitter has been replaced with `createAuditLogWriter({ prisma })`, when ANY caller invokes `audit.emit({ auditAction, userId?, outcome, context? })`, then a corresponding `AuditLog` row is persisted with `actorUserId` (or `null`), `auditAction`, `resource`, `resourceId` (or `null`), `payload` (the `context` verbatim), and `outcome` matching the call.
- Given `audit.emit` is called with no `userId` (e.g. system-emitted `logout`), when the writer persists the row, then `actorUserId: null` and `resource: "Other"` (per the default mapping for resource-less actions).
- Given `prisma.auditLog.create` rejects (DB outage), when `audit.emit` is called, then the writer swallows the rejection + emits a structured `audit_log_write_failed` log line; the caller is unaffected (the parent request continues).
- Given the api boots and `audit.emit` is invoked for a `login_success` event, when the coverage spec drives a real `POST /auth/login` request, then the spec asserts exactly one `AuditLog` row with `auditAction: "login_success"` and `outcome: "success"` was written.
- Given a Technician requests an Incident they're not assigned to, when the RBAC middleware emits `rbac_denied`, then the coverage spec asserts an `AuditLog` row with `auditAction: "rbac_denied"` and `outcome: "failure"` was written.
- Given an Operator posts an Acknowledge transition, when the `incident_state_changed` audit fires, then the coverage spec asserts an `AuditLog` row with `resource: "Incident"`, `resourceId: <incidentId>`, and `payload` containing the `from`/`to` states.
  </frozen-after-approval>

<!-- ============================== -->
<!-- END FROZEN-AFTER-APPROVAL BLOCK -->
<!-- ============================== -->
