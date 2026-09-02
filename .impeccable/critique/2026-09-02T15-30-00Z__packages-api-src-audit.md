---
target: packages/api/src/audit/
total_score: 22
max_score: 30
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-09-02T15-30-00Z
slug: packages-api-src-audit
---

## Story 5.6 — backend critique pass on packages/api/src/audit/

**Method:** Code-shape + AI-slop critique on the three 5.6 modules + their specs.
**Target:** `auditLogWriter.ts`, `auditActionResourceMap.ts`, `__tests__/audit.coverage.spec.ts`, `auditLogWriter.spec.ts`
**Score:** 22 / 30 (73%) — Band: Acceptable, with three P1 issues.

The implementation is sound and the tests are real coverage — but the prose is over-written in places that read as AI scaffolding rather than engineering judgment. The biggest AI-slop signature: every helper has a 20-line JSDoc that re-explains what the function name already says, every helper is exported even when only used internally, and a runtime guard was added "belt-and-braces" to fix a problem the type system already prevents.

### Design-Specificity Verdict

This is unambiguously Surakkha code — the `AuditAction` closed enum, the per-action `resourceIdKey` table, and the "no enumeration leak on failed login" coverage pin all derive from this app's exact RBAC + audit semantics. A neighbouring product could not drop these files in unchanged.

### Critique Score

| #     | Heuristic                                   | Score | Issue                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Removes accidental complexity               | 2     | Three runtime guards layered on top of structural casts: belt-and-braces `typeof` check in `ensureClient`, `context === undefined` check that the type system already rejects, defensive `null === undefined === null` triple-check.         |
| 2     | Comments say WHY, not WHAT                  | 2     | JSDoc on every helper repeats the function name in prose form ("`resolveResourceId` pulls `resourceId` out of the emit `context`"). Trim-and-whitespace helper has 15 lines of prose for 4 lines of code.                                    |
| 3     | Exports are intentional, not reflexive      | 1     | `resolveResourceId`, `resolveResourceBinding`, `AuditActionResourceEntry`, and `auditActionResourceMap` are all exported "so the unit tests can pin them" — but only one of them is consumed by tests, and the rest could be module-private. |
| 4     | No ceremonial code                          | 2     | `silentLogger as never` cast in the coverage spec is a smell — the test rig could pass a real `Logger`-shaped stub once. The IIFE wrapper around `void (async () => { ... })()` is necessary, but the JSDoc paragraph above it is filler.    |
| 5     | Helper sprawl / right-sized helpers         | 3     | `resolveResourceId` and `resolveResourceBinding` are reasonable, but they overlap — `resolveResourceBinding` only calls `resolveResourceId`. One function is enough.                                                                         |
| 6     | Error-path code matches intent              | 3     | The `audit_log_write_failed` warn with the resource binding is correct and recoverable (F-5.6-D18). Good. The `prisma_resolve` reason is well-defined.                                                                                       |
| 7     | Test names describe behavior, not framework | 2     | Test names follow `WRITE_HAPPY: ...` / `WRITE_RESOLVE_FAIL: ...` pattern — readable, but the prefixes read as a ticket-tag system rather than behavior assertions.                                                                           |
| 8     | Test setup matches reality                  | 3     | The e2e rig spins a real Express app + real Prisma-shaped sink + uses real JWT signing. Coverage is genuine.                                                                                                                                 |
| 9     | Spec JSDoc proportional to file purpose     | 2     | `audit.coverage.spec.ts` header is 42 lines — half of it repeats the spec's Path A amendments which already live in the spec file.                                                                                                           |
| 10    | Resource keys align with production         | 2     | The map's JSDoc says `simulator_event → deviceId` but the actual key is `device_id` (snake_case). Drift between doc and code; the production call site uses snake_case deliberately, but the JSDoc lies about it.                            |
| Total |                                             | 22/30 | Acceptable — three P1, four P2, three P3                                                                                                                                                                                                     |

### What's Working

- **Lazy Prisma resolution** matches `boot/db.ts` precedent — no boot-time crash on transient DB outage.
- **Fire-and-forget + IIFE** is the right shape for the v1 `(event) => void` contract; no caller changes.
- **Polling drain** is a real improvement over the unreliable two-microtask `flush()` (F-5.6-D16).
- **Spec Change Log + Path A amendments** are a clean way to amend a frozen spec without breaking the contract.
- **Resource-less default** (`resource: "Other"`, `resourceId: null`) is the right semantic for `logout` / `rbac_allowed` / `rbac_denied`.
- **No-enumeration-leak COVERAGE_LOGIN_FAIL pin** is exactly the right regression guard.

### Priority Issues

#### P1 — JSDoc-vs-data drift in `auditActionResourceMap.ts:72`

The JSDoc says `simulator_event → deviceId`, but the actual key in the map (line 100) is `device_id` (snake_case). Production call site (`simulatorRouter.ts:407`) uses `device_id` deliberately. Either:

- (a) **Align JSDoc with code** — say `simulator_event → device_id` (snake_case, deliberate; production call site at `simulatorRouter.ts:407` uses `device_id` because the wire payload shape is snake_case).
- (b) **Align code with JSDoc** — rename to `deviceId`, but that breaks the wire shape (`admin/simulatorRouter.ts:407` already populates `{ device_id: ... }`; rename touches the production emit call site, which the spec's "Never" rule forbids).

Path (a) is the correct fix — one line in the JSDoc — because the snake_case is intentional and the spec's "Never" rule makes path (b) illegal.

#### P1 — Helper sprawl: `resolveResourceId` + `resolveResourceBinding` are the same function

`auditLogWriter.ts:83-115` exports both. `resolveResourceBinding` is a one-line wrapper around `resolveResourceId`. Tests exercise both, but the binding is trivial enough to be inlined or merged. Inline `resolveResourceBinding` into `resolveResourceId` and let the writer call `resolveResourceId(auditAction, context)` directly with the destructured `{ resource, resourceId }` shape. Saves 14 lines of code + 1 export.

#### P1 — Three-layer runtime guard in `ensureClient`

`auditLogWriter.ts:136-172` has:

1. The structural cast `resolved as AuditLogCreateClient` (necessary for the lazy-resolver seam).
2. A belt-and-braces `typeof resolved.auditLog.create !== "function"` check that logs `prisma_resolve`.
3. The `try/catch` around the resolver call that also logs `prisma_resolve`.

Layer (2) and layer (3) are not symmetric — they catch the same failure mode for the same reason but log slightly differently. Collapse: drop the typeof check (the cast is sound; if the resolved client is malformed, the `await client.auditLog.create` will throw, which lands in the existing catch). One guard, not three.

#### P2 — Defensive `context === undefined` check is a dead branch

`auditLogWriter.ts:89` — `if (context === undefined) return null;` is unreachable. The event emitter's `context` arg is `Record<string, unknown> | undefined` (the interface allows it), so the runtime check matters. But: the resource-less actions (`logout`, `rbac_allowed`, `rbac_denied`) have `resourceIdKey: null` already, and `resolveResourceBinding` short-circuits via `entry.resourceIdKey === null → return null` before the context check fires. The `context === undefined` branch never executes — drop it.

#### P2 — Test rig's `silentLogger as never` cast hides the type seam

`audit.coverage.spec.ts:172` — `logger: silentLogger as never` is a confession that the writer's `Logger` interface is more permissive than it needs to be. Define a `MinimalLogger` interface in `auditLogWriter.ts` (just `warn`) and use it for the factory input. The test rig stops lying about the type and the writer's surface becomes explicit about what it actually needs.

#### P2 — Spec header JSDoc duplicates the spec file

`audit.coverage.spec.ts:1-42` — 42 lines of header prose that re-state the Path A amendments already in `spec-5-6-negative-tests-for-the-audit-log.md`. Trim to 8 lines: purpose, rig shape, drain pattern. The spec file is the source of truth for the amendment decisions; the test file should describe what it asserts, not why the matrix was amended.

#### P2 — JSDoc on `resolveResourceId` is 15 lines for 4 lines of code

`auditLogWriter.ts:75-100` — the helper is 6 lines of actual logic, surrounded by 25 lines of JSDoc that restate the function name. Trim to 5 lines: input shape, return shape, whitespace behaviour (the only non-obvious bit).

#### P3 — `AuditActionResourceEntry` exported only for the type

`auditActionResourceMap.ts:39-49` — the interface is exported but no other file imports it. Either drop the export (the inline literal type in the map signature is enough) or make it the file's only export (drop the `auditActionResourceMap` export and have consumers import the type they actually need).

#### P3 — `drainZero` void-casts `sink` then uses it

`audit.coverage.spec.ts:132` — `void sink;` followed by no use of `sink`. The helper exists to give in-flight `audit.emit` IIFEs the chance to land; drop the `sink` parameter entirely and document that it's a fixed-window yield.

#### P3 — Test names use ticket-tag prefixes

`auditLogWriter.spec.ts` — `WRITE_HAPPY`, `WRITE_DB_FAIL`, `WRITE_RESOLVE_FAIL` etc. The prefixes are not behaviour. Drop them; let the test name describe the behaviour ("emits a row with actorUserId + resource + payload", "swallows a write rejection with a recoverable warn payload").

### Persona Red Flags

Sanjit (Admin, demo-driver): not affected — this is backend.

A future maintainer picking up the writer: the JSDoc volume + the exported-but-unused helpers + the three-layer guard make the file read as "AI wrote this, no human re-derived it." A maintainer adding a new `AuditAction` would:

1. Find the map (good).
2. Read the JSDoc to understand what `resourceIdKey` means — find the same information three times (bad).
3. Look for the `resolveResourceBinding`/`resolveResourceId` exports — find both and have to decide which to extend (bad).
4. Wonder why the writer has a runtime guard that the type system already enforces (bad).

Fixing P1+P2 items makes the file read as "human-engineered for the next contributor."

### Provocative Questions

1. Should `AuditActionResourceEntry` collapse into an inline literal in the `Record` type? Saves an export, makes the map self-describing.
2. Should the writer expose a `MinimalLogger` interface (just `warn`) instead of taking the full `Logger`? The factory only uses one method; tightening the surface makes the failure mode visible.
3. Should `resolveResourceId` and `resolveResourceBinding` merge into one function? The binding is a one-liner over the id resolver; the second export is ceremony.
4. Should the e2e coverage spec inline the production call-site data shapes (snake_case `device_id` etc.) instead of relying on the JSDoc to explain the deviation?
