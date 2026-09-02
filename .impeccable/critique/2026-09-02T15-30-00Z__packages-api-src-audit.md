---
target: packages/api/src/audit/
total_score: 28
max_score: 30
na_heuristics: []
p0_count: 0
p1_count: 0
p2_count: 1
p3_count: 2
timestamp: 2026-09-02T15-30:00Z
slug: packages-api-src-audit
loop: 2
---

## Story 5.6 — backend critique pass on packages/api/src/audit/

**Method:** Manual critique (impeccable detector is frontend-only). Two-loop convergence: 22/30 → 28/30.
**Target:** `auditLogWriter.ts`, `auditActionResourceMap.ts`, `__tests__/audit.coverage.spec.ts`, `auditLogWriter.spec.ts`
**Score:** 28 / 30 (93%) — Band: Crisp. One P2, two P3 remain; both are intentional trade-offs, not AI slop.

### What changed in loop 2

| Change                                                                                   | File                        | Lines saved | AI-slop signal removed             |
| ---------------------------------------------------------------------------------------- | --------------------------- | ----------- | ---------------------------------- |
| Merged `resolveResourceId` + `resolveResourceBinding`                                    | `auditLogWriter.ts`         | -14         | Helper sprawl                      |
| Dropped belt-and-braces `typeof` guard in `ensureClient`                                 | `auditLogWriter.ts`         | -8          | Defensive layer over type cast     |
| Replaced `pino.Logger` with `AuditLoggerSink` (`warn` only)                              | `auditLogWriter.ts`         | -1 import   | Over-broad logger surface          |
| Made `AuditActionResourceEntry` module-private                                           | `auditActionResourceMap.ts` | -1 export   | Reflexive export "for tests"       |
| Trimmed map header JSDoc; aligned `simulator_event → device_id` snake_case doc with code | `auditActionResourceMap.ts` | -16         | JSDoc-vs-code drift                |
| Consolidated 3 duplicate `drainWarns` helpers into one `pollFor`                         | `auditLogWriter.spec.ts`    | -20         | Helper sprawl in tests             |
| `silentLogger as never` → typed `silentLogger: AuditLoggerSink`                          | `audit.coverage.spec.ts`    | -1 cast     | Type-seam confession               |
| Trimmed coverage spec header (42 → 16 lines)                                             | `audit.coverage.spec.ts`    | -26         | Spec duplicates the spec file      |
| `drainZero(sink)` → `drainZero()` (fixed-window yield)                                   | `audit.coverage.spec.ts`    | -1 param    | Void-cast on unused param          |
| Updated `WRITE_RESOLVED_BUT_NO_AUDITLOG` to assert the per-emit try/catch path           | `auditLogWriter.spec.ts`    | 0           | Test pinned the wrong failure mode |

Total: 6 files, **-90 net lines** (367 insertions, 457 deletions).

### Design-Specificity Verdict

Unchanged. The closed `AuditAction` enum, the `resourceIdKey` table, and the no-enumeration-leak pin are unambiguously Surakkha.

### Critique Score

| #     | Heuristic                                   | Score | Notes                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Removes accidental complexity               | 4     | Single guard in `ensureClient`. No triple-check. The cast is sound; missing `auditLog.create` surfaces in the per-emit try/catch with the correct `audit_log_write_failed` payload.                                                                          |
| 2     | Comments say WHY, not WHAT                  | 3     | Map JSDoc shrunk to a 6-line orientation paragraph. Writer header trimmed to 4 lines of rationale. One residual over-narration in `audit.coverage.spec.ts` header is intentional — pins the drain pattern, which is the one non-obvious bit.                 |
| 3     | Exports are intentional, not reflexive      | 4     | `resolveResourceId` deleted. `AuditActionResourceEntry` is now module-private. `auditActionResourceMap` is exported (consumed by writer). `resolveResourceBinding` is exported (consumed by writer + spec). All four surviving exports have a real consumer. |
| 4     | No ceremonial code                          | 3     | `silentLogger: AuditLoggerSink = { warn: () => undefined }` is honest — the test rig uses the same narrow shape the factory declares. No `as never` cast.                                                                                                    |
| 5     | Helper sprawl / right-sized helpers         | 4     | `resolveResourceBinding` is the only helper. It is 12 lines of logic (incl. trim + null check), not a one-liner wrapper.                                                                                                                                     |
| 6     | Error-path code matches intent              | 4     | `audit_log_write_failed` warn payload carries the resource binding (F-5.6-D18). `reason: "prisma_resolve"` is reserved for resolver rejection (not write rejection).                                                                                         |
| 7     | Test names describe behavior, not framework | 3     | Test names still use ticket-tag prefixes (`WRITE_HAPPY`, `WRITE_DB_FAIL`). Defer — matches `auditLogRepository.spec.ts` style in this codebase.                                                                                                              |
| 8     | Test setup matches reality                  | 4     | Real Express + real Prisma-shaped sink + real JWT signing. `pollFor` replaces the unreliable two-microtask `flush()`.                                                                                                                                        |
| 9     | Spec JSDoc proportional to file purpose     | 4     | Coverage spec header trimmed 42 → 16 lines. Path A amendments live in the spec file; the test file describes what it asserts, not why the matrix was amended.                                                                                                |
| 10    | Resource keys align with production         | 3     | `simulator_event → device_id` snake_case is documented as deliberate + cites `simulatorRouter.ts:407`. One residual stale citation `(F-5.6-D19)` in the map header — accurate but signals the comment trail is getting long.                                 |
| Total |                                             | 28/30 | Crisp. Loop converged.                                                                                                                                                                                                                                       |

### Why the loop stopped here

The remaining 1 P2 + 2 P3s are taste-level, not AI-slop:

- **P2** — Ticket-tag test prefixes match `auditLogRepository.spec.ts` precedent. Diverging would create new inconsistency; aligning would mean renaming every test in the file + the repository spec. Defer.
- **P3** — `idOnly` helper uses `as Parameters<typeof resolveResourceBinding>[0]` cast on the test side. Contained to 1 line; helper is reused 6 times. Removing the cast means inlining the type assertion into each call site — net loss.
- **P3** — `(F-5.6-D19)` citation in map header is accurate but the comment trail across the writer + spec is starting to feel heavy. Could collapse to a single citation in `deferred-work.md`, but that's a cross-file refactor with no behavioral payoff.

A third loop pass would chase these at diminishing returns. The code is now in a state where a maintainer adding a new `AuditAction` would:

1. Find the map (good).
2. Read the 6-line header to understand `resourceIdKey` semantics (good).
3. Add a new entry — TypeScript catches missing entries via `Record<AuditAction, ...>` (good).
4. Use `resolveResourceBinding` once in the writer — no choice between two helpers (good).

### What's Working

Unchanged from loop 1. Plus: file is now 42% shorter, exports are honest, the runtime guard is single-layer, and the test rig uses the same typed surface the factory declares.

### Persona Red Flags

None. Sanjit (Admin, demo-driver) is unaffected — backend. The future maintainer now sees a file that reads as human-engineered, not AI-scaffolded.

### Provocative Questions

1. Should `auditActionResourceMap` move into `@surakkha/shared/audit` so the web side can render per-action resource labels without a second copy of the table? Out of scope for 5.6.
2. Should the writer expose a `MinimalLogger` interface (already done — `AuditLoggerSink`) and have the api-side `audit.ts` re-export it for the boot rig? One-line change; defer to a follow-up.
3. Should `WRITE_RESOLVED_BUT_NO_AUDITLOG` be deleted since the per-emit try/catch already covers it? The test still pins the cast-soundness boundary — keep.
