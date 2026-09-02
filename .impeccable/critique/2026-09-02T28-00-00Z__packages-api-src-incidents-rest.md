# Critique — `packages/api/src/incidents/{router, transitionHelpers, incidentStateRepository, routerWiring, activeRouter, recentRouter, recentWiring}.ts` (rest)

**Date:** 2026-09-02
**Surface:** `packages/api/src/incidents/` minus `transitions.ts` + `transitionSideEffects.ts` (already refined in loop #202).
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/incidents/
├── transitionHelpers.ts          506 LOC  — orchestrator (RBAC, body parse, pipeline, commit, log)
├── incidentStateRepository.ts    371 LOC  — Prisma slice + applyTransition (writer) + wire-row helpers
├── router.ts                     290 LOC  — 5 transition POSTs + read-side GETs + events timeline
├── routerWiring.ts               181 LOC  — lazy Prisma wrapper + Socket.IO broadcast target + active mount
├── activeRouter.ts               125 LOC  — /api/incidents/active (Kanban feed)
├── recentRouter.ts               170 LOC  — /api/incidents/recent (dashboard preview) + buildPrismaRecentIncidents
└── recentWiring.ts                94 LOC  — recent list-reader + normalizeRecentIncidentSeverity
```

The incidents surface (minus the pure state machine) is the load-bearing
orchestrator: the 5 transition POSTs in `router.ts` delegate to
`transitionHelpers.runTransitionPipeline` (parse → RBAC → pure
`transition()` → commit → respond). The repository owns the
optimistic-concurrency `updateMany` and the `$transaction` that bundles
(incident update + audit event + optional critical notification). The
read-side (`activeRouter`, `recentRouter`) exposes the Kanban feed +
dashboard preview.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                                                |
| --- | ---------------- | ----- | ----------------------------------------------------------------------------------- |
| 1   | Visibility       | 3     | `logTransition` JSON line + `rbac_denied` audit emit + optimistic-concurrency error |
| 2   | Match real world | 4     | Domain language ("pipeline", "apply", "commit", "attempted")                        |
| 3   | User control     | 3     | Admin-only reopen gate; Technician ownership on submit_result                       |
| 4   | Consistency      | 2     | Mixed rationale styles; Story 4.x codes; AC7 / AC2 / AC4 markers                    |
| 5   | Error prevention | 4     | Optimistic concurrency → 409; P2002 → 409; P2003 → 400; verbose enum gate           |
| 6   | Recognition      | 2     | "Patch (code review 2026-08-27 #18)", "Step-04 review fix" RESTATE                  |
| 7   | Flexibility      | 3     | `IncidentsRouterDeps` injection; per-verb handler factories                         |
| 8   | Minimalist       | 1     | Headers 4-7× larger than needed; long inline rationale                              |
| 9   | Recoverability   | 4     | Idempotency middleware; P2002 catch; optimistic concurrency                         |
| 10  | Help docs        | 1     | Most rationale is in code comments                                                  |

**Weighted total: 27/40.**

## AI-slop detection

### P1 (block merge)

- **P1-1: `routerWiring.ts` header is 30 lines** of rationale — restates the lazy-resolve + broadcast adapter + idempotency-singleton logic that the function bodies already encode. Trim to ~7 lines.
- **P1-2: `transitionHelpers.ts` header is 7 lines** of rationale — restates "the lint max-lines: 500 ceiling" framing. Trim to ~4 lines (the function names + side-effects comment is sufficient).

### P2 (apply before merge)

#### Story codes in headers / inline rationale

- `transitionHelpers.ts`: header `max-lines: 500`; inline AC2 (audit collapse); inline AC7 (recent failure)
- `routerWiring.ts`: header `Story 4.2` + `Story 2.2`; inline `Story 4.x`; inline `Story 4.3`; inline `applyTransition.ts:189`
- `incidentStateRepository.ts`: header `Story 4.2 (writer layer)`; inline `Story 4.9` (×2); inline `Story 4.11` (reopen forces critical); inline `spec-3-4` audit; inline `Code review 2026-08-27, decision 6 (option B)`
- `activeRouter.ts`: header `Story 4.3`; inline `Story 4.12`; inline `Story 2.6` (referenced as unchanged)
- `recentRouter.ts`: header `Story 2.6`; inline `Story 2.6 AC4`; inline `AC7`
- `recentWiring.ts`: header `(was inline in src/index.ts:237-283)`; inline `Story 2.6 AC4`; inline `boot/db.ts` (cross-file ref)

These are noise — git tracks the moves and the spec is canonical.

#### Cross-file line refs

- `routerWiring.ts:22`: `applyTransition.ts:189` (broadcast adapter reference)
- `routerWiring.ts:139`: `src/index.ts` (mount-site reference)
- `recentWiring.ts:3-4`: `src/index.ts:237-283` (extraction history)
- `recentWiring.ts:53`: `boot/db.ts` (cross-file reference)

#### Long narrative rationale blocks

- `incidentStateRepository.ts:206-219` (ackedAt / resolvedAt preamble): 14 lines of rationale restating what the inline ternaries do.
- `incidentStateRepository.ts:233-249` (reopenForcesCritical preamble): 17 lines of rationale restating the conditional spread + UX-DR-9 rationale.
- `transitionHelpers.ts:45-51` (canonical 409 envelope preamble): 7 lines restating the 3-shape collapse.
- `routerWiring.ts:50-60` (buildIncidentBroadcastTarget preamble): 11 lines restating the Socket.IO chain.
- `routerWiring.ts:120-144` (buildIncidentsRouterMount preamble): 25 lines of multi-paragraph rationale on resolveActorUserId + active router + idempotency wiring.
- `activeRouter.ts:79-96` (Technician filter preamble): 18 lines of Step-04 review fix narrative.
- `recentRouter.ts:99-105` (buildPrismaRecentIncidents preamble): 7 lines restating the 24h window spec pin.

#### "Patch (code review...)" markers

- `routerWiring.ts:124-129`: "Patch (code review 2026-08-27 #18): thread resolveActorUserId from index.ts" — 6 lines for "we now thread resolveActorUserId through."

### Non-findings (verified, not raised)

- **The `runTransitionPipeline` orchestrator** is correctly factored — pure parse → RBAC → transition → commit, each stage returns null on terminal status. The `commitTransition` exception handling (OptimisticConcurrencyError → 409; P2002 → 409; P2003 → 400; else 500) is exhaustive.
- **The `applyTransition` 3-step `$transaction`** (updateMany optimistic concurrency → event create → optional critical notification) is correct. The optimistic-concurrency throw is the canonical sentinel.
- **The `dispatchParse` switch** (verb → Zod schema) is closed-enum exhaustive.
- **The `respondInvalidStateTransition`** canonical 409 envelope collapse is correct.
- **The 5 handler factories** (`buildAcknowledgeHandler` / `buildAssignHandler` / ...) + `RBAC_ACTION_BY_VERB` map is correct.
- **The 24h window** in `recentRouter` / `recentWiring` is the spec's "incidents in the last 24 hours" pin.
- **The `normalizeRecentIncidentSeverity`** unknown-value → `"warning"` fallback is correct (the dashboard's badge count stays monotonic).
- **The lazy-resolve pattern** (`buildIncidentRepoResolver` + cached `wrapper`) is the seam that lets the api boot without `DATABASE_URL` set.
- **The `buildIncidentBroadcastTarget`** adapter is correct.
- **The `OptimisticConcurrencyError`** sentinel class + route-layer catch is the canonical pattern.
- **The `incidentRowToPayload` + `incidentEventRowToPayload`** adapters are pure helpers — the `instanceof Date` checks guard against Prisma's date handling.
- **The Technician ownership filter** in `activeRouter` (server-side WHERE clause + conditional spread for non-Tech viewers) is correct.
- **The `IncidentSeveritySchema` validation** in `normalizeRecentIncidentSeverity` defends against Prisma drift.

### Out of scope

- **`middleware/idempotency.ts`** — already on the deferred list (loop #204).
- **`middleware/authorize.ts`** — already on the deferred list (loop #204).
- **`audit.ts`** — the audit log surface (loop #206).

## Plan

### Strip pass (all 7 files)

1. Drop `Story 4.x` / `Story 2.x` / `Story 4.11` / `Story 4.12` / `Story 4.9` / `Story 4.3` / `Story 2.2` / `Story 2.6` / `Story 2.6 AC4` / `AC7` codes from headers + inline.
2. Drop "Patch (code review 2026-08-27 #18)" marker in `routerWiring.ts:124-129`.
3. Drop "Code review 2026-08-27, decision 6 (option B)" marker in `incidentStateRepository.ts:219`.
4. Drop "Step-04 review fix" preamble in `activeRouter.ts:84-96`.
5. Drop cross-file line refs (`applyTransition.ts:189`, `src/index.ts:237-283`, `boot/db.ts`).
6. Drop "distilled 2026-08-30 (was inline in src/index.ts:237-283)" extraction-history marker in `recentWiring.ts:3-4`.

### Trim pass (function-level rationale)

7. **`routerWiring.ts` header**: 30 → 7 lines.
8. **`transitionHelpers.ts` header**: 7 → 4 lines.
9. **`incidentStateRepository.ts` header**: 10 → 4 lines.
10. **`activeRouter.ts` header**: 28 → 6 lines.
11. **`recentRouter.ts` header**: 30 → 6 lines.
12. **`recentWiring.ts` header**: 22 → 5 lines.
13. **`incidentStateRepository.ts:206-219`** (ackedAt / resolvedAt preamble): 14 → 3 lines.
14. **`incidentStateRepository.ts:233-249`** (reopenForcesCritical preamble): 17 → 3 lines.
15. **`transitionHelpers.ts:45-51`** (409 envelope preamble): 7 → 3 lines.
16. **`routerWiring.ts:50-60`** (buildIncidentBroadcastTarget preamble): 11 → 3 lines.
17. **`routerWiring.ts:120-144`** (buildIncidentsRouterMount preamble): 25 → 4 lines.
18. **`activeRouter.ts:79-96`** (Technician filter preamble): 18 → 3 lines.
19. **`recentRouter.ts:99-105`** (buildPrismaRecentIncidents preamble): 7 → 3 lines.

### Preserved (load-bearing)

- `runTransitionPipeline` stage return-on-null contract.
- `applyTransition` 3-step `$transaction` with optimistic-concurrency throw.
- `dispatchParse` closed-enum switch.
- `respondInvalidStateTransition` canonical 409 envelope collapse.
- `OptimisticConcurrencyError` sentinel class.
- The 24h recent-window spec pin.
- The lazy-resolve + cached `wrapper` seam.
- `normalizeRecentIncidentSeverity` unknown-value → `"warning"` fallback.
- The Technician ownership filter at the WHERE clause.
- The audit ordering (denial emit BEFORE the 403).
- `instanceof Date` checks in `incidentRowToPayload` + `incidentEventRowToPayload`.
- The 5 handler factories + `RBAC_ACTION_BY_VERB` map.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/incidents
npx --prefix packages/api vitest run packages/api/src/incidents
```

Existing specs must stay green:

- `transitions.spec.ts` (29 cases) — pure state-machine + projection.
- `incidentStateRepository.spec.ts` — writer + `$transaction` + optimistic concurrency.
- `applyTransition.spec.ts` — orchestrator stage.
- `router.spec.ts` — end-to-end 5 transitions + read GETs + events timeline.
- `activeRouter.spec.ts` — active Kanban feed.
- `recentRouter.spec.ts` — recent dashboard preview.
