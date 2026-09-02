# Test spec — `packages/api/src/incidents/{router, transitionHelpers, incidentStateRepository, routerWiring, activeRouter, recentRouter, recentWiring}.ts` critique loop

**Date:** 2026-09-02
**Surface:** rest of `packages/api/src/incidents/` (minus `transitions.ts` + `transitionSideEffects.ts` already refined in loop #202)
**Companion critique:** `.impeccable/critique/2026-09-02T28-00-00Z__packages-api-src-incidents-rest.md` (27/40 weighted)

This spec pins the load-bearing invariants of the incidents surface
that survived the refactor pass.

## Behavioural pins

### Orchestrator (transitionHelpers.ts)

- **B-OH-1**: Given `respondInvalidStateTransition(res, { from: "RESOLVED", attempted: "acknowledge" })`, when called, then it sends `{ error: "invalid_state_transition", from: "RESOLVED", attempted: "acknowledge" }` (the canonical 409 envelope — 3-shape collapse).
- **B-OH-2**: Given `respondInvalidStateTransition(res, { reason: "concurrent_modification" })`, when called, then it sends `{ error: "invalid_state_transition", reason: "concurrent_modification" }` (optimistic-concurrency loser shape).
- **B-OH-3**: Given `maybeReopenAdminDenied({ deps, verb: "reopen", req: { user: { role: "Operator" } }, res })`, when called, then it emits an `rbac_denied` audit row with `reason: "not_admin"` BEFORE the 403.
- **B-OH-4**: Given `maybeOwnershipDenied({ verb: "submit_result", currentRow: { assigneeUserId: "tech-1" }, req: { user: { id: "tech-2" } } })`, when called, then it calls `runOwnershipCheck` (the 403 path).
- **B-OH-5**: Given `runTransitionPipeline` and a typed state-machine miss, when called, then it calls `writeInvalidAttemptEvent` THEN `respondInvalidStateTransition({ from, attempted })` and returns `null`.
- **B-OH-6**: Given `commitTransition` and `OptimisticConcurrencyError`, when caught, then it calls `writeInvalidAttemptEvent` (with the current row's state) THEN `respondInvalidStateTransition({ reason: "concurrent_modification" })` and returns `null`.
- **B-OH-7**: Given `commitTransition` and `P2002` (partial-unique-index race on `notification:critical`), when caught, then it sends 409 with `reason: "concurrent_modification"` (benign idempotency, NOT 500).
- **B-OH-8**: Given `commitTransition` and `P2003` (FK violation on assignee), when caught, then it sends 400 with `{ error: "invalid_assignee", reason: "not_found" }`.
- **B-OH-9**: Given `dispatchParse` and any verb in the `ActionVerb` closed set, when called, then it routes to the per-verb Zod schema (exhaustive).
- **B-OH-10**: Given `logTransition`, when called, then it emits a single `console.warn` JSON line with `event: "incident_transition", incident_id, from, to, verb, actor_user_id, at`.

### Writer (incidentStateRepository.ts)

- **B-IR-1**: Given `applyTransition` and `result.ok === false`, when called, then it THROWS (defense — the orchestrator should never call with a typed error).
- **B-IR-2**: Given `applyTransition` and `nextState === "UNSAFE"` with `writeCriticalNotification: true`, when committed, then `tx.notification.create` is called with `severity: "critical", recipientRole: "Operator"`.
- **B-IR-3**: Given `applyTransition` and `result.event_type === "reopen"`, when committed, then `updateMany` data includes `severity: "critical"` (force-critical on reopen).
- **B-IR-4**: Given `applyTransition` and `result.event_type !== "reopen"`, when committed, then `updateMany` data does NOT include `severity` (other verbs preserve severity).
- **B-IR-5**: Given `applyTransition` and `update.count === 0`, when committed, then it throws `OptimisticConcurrencyError(currentRow.id)`.
- **B-IR-6**: Given `applyTransition` and the row disappears after update (vanishingly rare), when re-read, then it throws `Error("incident ... disappeared after update")`.
- **B-IR-7**: Given `applyTransition` and an `assign` verb, when computing `newAssignee`, then it uses `assigneeUserId` (the new value).
- **B-IR-8**: Given `applyTransition` and a non-assign verb, when computing `newAssignee`, then it preserves `currentRow.assigneeUserId`.
- **B-IR-9**: Given `applyTransition` and `nextState === "RESOLVED"`, when stamping, then `resolvedAt = at` (stamped).
- **B-IR-10**: Given `applyTransition` and `nextState === "OPEN"` from `currentRow.state === "RESOLVED"`, when stamping, then `resolvedAt = null` (cleared).
- **B-IR-11**: Given `applyTransition` and `nextState !== "OPEN" && nextState !== "REOPENED"` AND `currentRow.acknowledgedAt === null`, when stamping, then `ackedAt = at` (first transition out of OPEN).
- **B-IR-12**: Given `applyTransition` and `currentRow.acknowledgedAt !== null`, when stamping, then `ackedAt = currentRow.acknowledgedAt` (preserved).
- **B-IR-13**: Given `OptimisticConcurrencyError`, when thrown, then `err.incidentId` is the current row's id (sentinel class carries context).

### Router (router.ts)

- **B-RT-1**: Given `POST /api/incidents/:id/acknowledge` with `authorize("acknowledge", "Incident")`, when called, then it routes through `buildTransitionHandler(deps, "acknowledge")` after `idempotencyMw`.
- **B-RT-2**: Given `GET /api/incidents/:id` with `req.user.role === "Technician"` AND `row.assigneeUserId !== req.user.id`, when called, then it emits `rbac_denied` audit row + responds 403 (the technician-only-mine rule).
- **B-RT-3**: Given `GET /api/incidents/:id/events`, when called, then it returns `{ events: IncidentEventPayload[] }` ordered by `createdAt ASC`.

### Read-side — active (activeRouter.ts)

- **B-AR-1**: Given `GET /api/incidents/active` with `req.user.role === "Technician"` AND `req.user.id === undefined`, when called, then it sends 500 (defensive — filter-by-undefined would match every row).
- **B-AR-2**: Given `GET /api/incidents/active` with `req.user.role === "Technician"` AND `req.user.id !== undefined`, when called, then it filters by `assigneeUserId: req.user.id` (server-side WHERE clause).
- **B-AR-3**: Given `GET /api/incidents/active` with `req.user.role !== "Technician"`, when called, then it does NOT filter by `assigneeUserId` (unfiltered global view).
- **B-AR-4**: Given `GET /api/incidents/active`, when called, then the query includes `state: { not: "RESOLVED" }` (RESOLVED never surfaces on the Kanban).

### Read-side — recent (recentRouter.ts, recentWiring.ts)

- **B-RR-1**: Given `GET /api/incidents/recent` with no `limit` query, when called, then it uses `limit = 10` (default).
- **B-RR-2**: Given `GET /api/incidents/recent?limit=51`, when called, then it sends 400 (max 50).
- **B-RR-3**: Given `GET /api/incidents/recent?limit=0`, when called, then it sends 400 (min 1).
- **B-RR-4**: Given `buildPrismaRecentIncidents` and Prisma returns a row with `severity: "TYPO"`, when mapped, then `normalizeRecentIncidentSeverity` returns `"warning"` (fallback, NOT dropping the row).
- **B-RR-5**: Given `buildRecentIncidentsListReader` and any Prisma failure, when called, then it returns `[]` (the dashboard's empty-state path).
- **B-RR-6**: Given `buildRecentIncidentsListReader` and Prisma succeeds, when called, then it filters by `openedAt >= now - 24h` (the 24h window).

### Wiring (routerWiring.ts)

- **B-RW-1**: Given `buildIncidentsRouterMount` and a fresh process, when called, then it creates a single process-wide `IdempotencyStore` and shares it across all 5 transition routes.
- **B-RW-2**: Given `buildIncidentsRouterMount`, when called, then it returns an adapter `Router` that mounts both `buildActiveIncidentsRouter` and `buildIncidentsRouter` (single `app.use` for the consumer).
- **B-RW-3**: Given `buildIncidentBroadcastTarget(io)` and `io.to("incident:inc-1").emit("incident:state_changed", payload)`, when called, then `io.to("incident:inc-1").emit(...)` is invoked exactly once.
- **B-RW-4**: Given the lazy-resolve wrapper, when the first request lands, then `resolvePrismaClient()` is awaited and cached; subsequent calls reuse the cached `IncidentStateRepository`.

## Static / lint pins

- **P-FS-1**: All 7 file headers MUST be ≤ 10 lines. Current: transitionHelpers.ts 4 lines, incidentStateRepository.ts 6 lines, router.ts 7 lines, routerWiring.ts 7 lines, activeRouter.ts 5 lines, recentRouter.ts 5 lines, recentWiring.ts 6 lines.
- **P-FS-2**: No file MUST contain `Story 4.x` / `Story 2.x` / `AC7` / `Step-04 review fix` / `Patch (code review 2026-08-27 #N)` / `Code review 2026-08-27, decision N (option N)` strings.
- **P-FS-3**: No file MUST contain cross-file line refs (e.g., `applyTransition.ts:189`, `src/index.ts:237-283`, `boot/db.ts`).
- **P-PIPELINE-1**: `runTransitionPipeline` MUST return `null` on every terminal path (parse error / RBAC denial / typed state-machine miss / commit error / optimistic concurrency / P2002).
- **P-IR-1**: `applyTransition` MUST throw on `result.ok === false` (defense — orchestrator contract).
- **P-IR-2**: The `reopen` verb MUST force `severity: "critical"` via the conditional spread (type-safe alternative to explicit undefined).
- **P-IR-3**: `OptimisticConcurrencyError` MUST carry `incidentId` (sentinel context).
- **P-LINT-1**: `npx eslint packages/api/src/incidents` MUST exit 0.
- **P-LINT-2**: `npx tsc -b packages/api` MUST exit 0.

## Negative pins

- **N-1**: `applyTransition` MUST NOT mutate the input `currentRow` (immutable update pattern).
- **N-2**: `dispatchParse` MUST NOT have a `default` case (closed-enum exhaustiveness).
- **N-3**: `commitTransition` MUST NOT swallow non-mapped Prisma error codes silently — only P2002 / P2003 are mapped; others fall through to 500.
- **N-4**: `runTransitionPipeline` MUST NOT call `writeInvalidAttemptEvent` on the SUCCESS path — the audit-trail `IncidentEvent` row is written by `applyTransition.tx.incidentEvent.create`.
- **N-5**: The active router's Technician filter MUST NOT be applied to non-Technician viewers (the conditional spread keeps the payload shape identical).
- **N-6**: The recent router MUST NOT return rows outside the 24h window (the SQL-level `openedAt >= since` filter is the contract).
- **N-7**: `normalizeRecentIncidentSeverity` MUST NOT drop a row on unknown severity — fallback to `"warning"` keeps the badge count monotonic.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/incidents
npx --prefix packages/api vitest run packages/api/src/incidents
```

Existing specs must stay green:

- `transitions.spec.ts` (29 cases) — pure state machine + projection
- `incidentStateRepository.spec.ts` (7 cases) — writer + `$transaction`
- `applyTransition.spec.ts` (8 cases) — orchestrator stage
- `router.spec.ts` (54 cases) — 5 transition POSTs + read GETs + events timeline
- `activeRouter.spec.ts` (13 cases) — active Kanban feed
- `recentRouter.spec.ts` (8 cases) — recent dashboard preview

Total: 119 tests.
