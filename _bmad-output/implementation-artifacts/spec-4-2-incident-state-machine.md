# Story 4.2 — Incident State Machine + Migration

**Status:** done (lands with Epic 4 foundation slice)
**Epic:** 4 — Incidents & Workflow
**Covers:** FR-17, FR-19, AR-8, I-7 (from story 4.2 ACs in `epics.md:1202`)
**Review loop:** TBD — depends on live-Prisma test results
**Shipped:** 2026-08-27 (Epic 4 foundation slice)

---

## Context

Epic 4 introduces the 7-state incident machine. The Kanban (Story 4.3), the detail page (4.4), the acknowledge UI (4.5), the assignment UI (4.6), the result submission (4.7), and the reopen path (4.11) all consume this machine. **The state machine is the load-bearing seam** — every later Epic 4 story depends on it. Story 4.2 lands the schema migration, the pure `transition()` function, the write repository, the HTTP router, and the socket emits.

This is the **first Prisma migration in this epic** and it is the largest schema change Surakkha has seen to date. Forward-only per Epic 3 conventions. The migration adds the `User` table (FK target), the new columns on `Incident` (`state`, `assigneeUserId`, `acknowledgedAt`, `resolvedAt`), the `IncidentEvent` audit table, the `Notification` table (for Story 4.9), and the `Attachment` table (for Story 4.13 — table ships now, UI later).

The `severity` column on `Incident` stays `String` (free-form), matching the precedent set in Story 3.6. The new `state` column is the first Prisma enum on the table.

The 5 RBAC verbs (`acknowledge`, `assign`, `submit_result`, `resolve`, `reopen`) are **already in the `ActionSchema`** at `packages/shared/src/rbac.ts`. Zero RBAC matrix edits are needed. The existing 4 Incident negative cases (cases 2, 3, 4, 10 in `rbacNegativeRouter.ts`) are already wired — Story 4.2 just routes them at the new endpoints.

The plan calls for two AI-3 retro commits to be closed here: **AI-3.2** (the missing observability log line on incident auto-create) and **AI-3.3** (the missing `incident:opened` socket event). Both are pinned as AC4 and AC5 below.

## User Story

> As a developer, I want a server-enforced 7-state machine with an explicit transition table, so that every transition is testable and invalid attempts are rejected and audited.

## Acceptance Criteria

| AC   | Description                                                                                                                                                                                                                                                                                                                                  | Pin                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | --- | ------------------- | ------ |
| AC1  | `packages/api/src/incidents/transitions.ts` exports a pure `transition(incident, action, actor)` function. The function returns `{ ok: true, nextIncident, event } \| { ok: false, code: 'invalid_state_transition', from, attempted }`. No DB, no fetch, no clock — pure logic over the input shape.                                        | `transitions.spec.ts` AC for each `(state × action)` cell.                                                                    |
| AC2  | `TRANSITIONS` table in the same file maps every valid `(from_state, action) → to_state` for all 7 stable states. The `REOPENED` alias maps `RESOLVED + reopen → OPEN` (REOPENED is a transition alias, not a stored state — per `incident.ts` header comment).                                                                               | Table exported + iterated test.                                                                                               |
| AC3  | Every successful transition writes an `IncidentEvent` row inside the same `$transaction` as the `Incident.update`. Atomicity is asserted by the live-Prisma test (a thrown `tx.incidentEvent.create` rolls back the `Incident.update`).                                                                                                      | Live test in `incident-state-machine.spec.ts`.                                                                                |
| AC4  | **(Closes AI-3.2)** Every successful transition emits a `console.info({ event: 'incident_transition', from, to, actor, incidentId })` log line. Auto-created incidents (Story 3.6 path) emit a separate `console.info({ event: 'incident_auto_created', deviceId, severity, metric })` log line.                                             | `transitions.spec.ts` + `applyTransition.ts` log call.                                                                        |
| AC5  | **(Closes AI-3.3)** `IncidentOpenedEventSchema` is added to `packages/shared/src/events.ts`. `applyTransition.ts`'s auto-create-incident path emits `incident:opened` on the post-commit hook (alongside the existing `alert:opened`).                                                                                                       | Wire test pins schema; live test pins emit call.                                                                              |
| AC6  | Optimistic-concurrency via `Incident.updatedAt`. `tx.incident.updateMany({ where: { id, updatedAt: priorUpdatedAt } })` returns `count: 0` on a lost race. The handler converts that to `409 invalid_state_transition` with the actual current `state` and writes an `IncidentEvent` with `type: "__invalid_transition_attempt"`.            | Live test creates two concurrent transitions; asserts one 409 + one IncidentEvent with type "\_\_invalid_transition_attempt". |
| AC7  | Negative transitions write a structured `console.warn({ event: '__invalid_transition_attempt', actorUserId, payload: { incidentId, attempted, from } })` log line with the same shape Epic 5.3's `AuditLog` table will consume (v1 has no `AuditLog` table; the warn log is the v1 stand-in).                                                | `transitions.spec.ts` + `router.spec.ts` capture console.                                                                     |
| AC8  | Every cell in the `TRANSITIONS` table has a unit test in `transitions.spec.ts`. The spec pins `(state, action) → expected_next_or_invalid`.                                                                                                                                                                                                  | Test count ==                                                                                                                 | valid transitions | +   | invalid transitions | cells. |
| AC9  | Migration adds: `User` table (id PK, role enum, displayName, timestamps); `Incident.state` enum + default `OPEN`; `Incident.assigneeUserId` nullable FK to User; `Incident.acknowledgedAt` + `Incident.resolvedAt` nullable DateTime; `IncidentEvent` table; `Notification` table; `Attachment` table. Forward-only; no destructive changes. | `psql -c '\d "Incident"'` etc. + `prisma migrate dev` clean.                                                                  |
| AC10 | `packages/db/prisma/seedUsers.ts` creates 6 demo users: 1 Admin, 2 Operators, 2 Technicians, 1 Viewer. Idempotent on `upsert(user.id)`. Wired to `pnpm db:seed`.                                                                                                                                                                             | Live test asserts 6 rows after seed.                                                                                          |

## Out of scope (deferred to other stories)

- The Kanban projection wiring to UI — Story 4.3 (deferred).
- The detail page UI — Story 4.4 (deferred).
- The acknowledge flow UI, the assignment UI, the result submission UI, the SeverityBanner, the NotificationBell, the reopen UI, the technician-filtered view, the attachment UI — Stories 4.5-4.8, 4.10-4.13 (deferred).
- The `AuditLog` Prisma table — Epic 5 Story 5.3. The 4.2 invalid-transition event logs to `console.warn` with the same shape 5.3 will consume.
- The `notification:info` event — only `critical` and `warning` are emitted by 4.9.
- Index optimization on `(state, openedAt)` — not on a hot path yet; revisit in 4.3.
- Real-time `incident:state_changed` room broadcasting to clients other than the dashboard — Epic 4.4 deferred UI does this.

## Code Map

| File                                                                        | Change                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                          | MODIFY — add `User`, `IncidentEvent`, `Notification`, `Attachment` models; modify `Incident` (add `state`, `assignee`, `acknowledgedAt`, `resolvedAt`, relations); add enums `IncidentState_`, `IncidentEventType_`, `NotificationSeverity_`, `UserRole_`. |
| `packages/db/prisma/migrations/YYYYMMDDHHMMSS_incident_state/migration.sql` | NEW — forward-only migration. New tables; new nullable columns on Incident; default value `'OPEN'` for `state`. Existing `Incident` rows from Story 3.6 get `state: 'OPEN'` automatically.                                                                 |
| `packages/db/prisma/seedUsers.ts`                                           | NEW — idempotent seed. Reads `SURAKKHA_DEMO_USERS` env var if present; else produces the default 6-user set.                                                                                                                                               |
| `packages/db/prisma/package.json`                                           | MODIFY — add `db:seed` script.                                                                                                                                                                                                                             |
| `packages/shared/src/incident.ts`                                           | MODIFY — add `ActionVerbSchema`, `TransitionResultSchema`, `IncidentPayloadSchema`, `IncidentEventPayloadSchema`. Re-export `ActionVerb` type. Pin `REOPENED` comment for Story 4.11 consumers.                                                            |
| `packages/shared/src/events.ts`                                             | MODIFY — add `IncidentOpenedEventSchema` (AI-3.3 closure).                                                                                                                                                                                                 |
| `packages/shared/src/index.ts`                                              | MODIFY — re-export new schemas.                                                                                                                                                                                                                            |
| `packages/shared/src/rbac.ts`                                               | MODIFY — extend `ActionSchema` enum if "manage Incident" or "transition Incident" is a NEW verb (it isn't — the 5 verbs already exist; verify before adding).                                                                                              |
| `packages/api/src/incidents/transitions.ts`                                 | NEW — pure `transition()` + `TRANSITIONS` table + observability log helper.                                                                                                                                                                                |
| `packages/api/src/incidents/transitions.spec.ts`                            | NEW — Vitest full-table coverage AC1, AC2, AC7, AC8. Captures `console.info` and `console.warn` via spy.                                                                                                                                                   |
| `packages/api/src/incidents/incidentStateRepository.ts`                     | NEW — `incidentState.$transaction(fn)` delegate + `applyTransitionTx(tx, incident, action, actor)` writer. Mirrors `alertStateRepository.ts` shape.                                                                                                        |
| `packages/api/src/incidents/router.ts`                                      | NEW — `POST /api/incidents/:id/{acknowledge,assign,submit-result,resolve,reopen}` + `GET /api/incidents/:id`. Per-verb RBAC. Optimistic-concurrency on `updatedAt`.                                                                                        |
| `packages/api/src/incidents/router.spec.ts`                                 | NEW — RTL+server tests. Strict-Zod rejection pattern from `thresholdsRouter.spec.ts:295-337`. RBAC negative paths.                                                                                                                                         |
| `packages/api/src/rules/applyTransition.ts`                                 | MODIFY — extend `buildIncidentPayload` to include `state: "OPEN"`. Add `incident:opened` socket emit on post-commit hook (AC5). Add `console.info` observability log (AC4).                                                                                |
| `packages/api/src/rules/incidentFromAlert.ts`                               | MODIFY — extend `buildIncidentPayload` to include `state: "OPEN"`. Wire the notification write (Story 4.9) and the `incident:opened` socket emit.                                                                                                          |
| `packages/api/src/index.ts`                                                 | MODIFY — mount `incidentsRouter` at `/api/incidents` post-authenticate. Add `resolveActorUserId(jwt): Promise<string                                                                                                                                       | null>`middleware-level helper that lazy-upserts a`User` row on first JWT sight (defense-in-depth). |
| `packages/api/src/middleware/authorize.ts`                                  | MODIFY — extend the audit shape for `__invalid_transition_attempt` events. The audit log call still uses `console.warn` for v1 (no `AuditLog` table).                                                                                                      |
| `packages/db/prisma/alert-debounce.spec.ts`                                 | MODIFY (sibling live test file) — add `incident-state-machine.spec.ts` for AC1-AC9 end-to-end against real Postgres. Two concurrent transitions test, P2002 idempotency test, observability log capture test.                                              |
| `packages/api/src/__tests__/rbacNegativeRouter.ts`                          | MODIFY — surface the existing 4 Incident negative cases against the new `/api/incidents/:id/acknowledge` route (matrix says denied; actual 403 test pins that).                                                                                            |

## Risks / sharp edges

- **`transition()` is pure, but the writer is not.** The pure function decides _what_ state to write; the `incidentState.$transaction(fn)` writes it + the `IncidentEvent`. Both layers must agree on shapes. Mitigation: both test suites import the same `TRANSITIONS` constant and assert the same `expectedNext` per cell.
- **Optimistic-concurrency on `updatedAt`** — the `updateMany({ where: { id, updatedAt } })` pattern returns `count: 0` on a lost race. The handler converts that to `409 invalid_state_transition` **with the actual current state** so the loser can refresh. The `__invalid_transition_attempt` IncidentEvent must include the actual current state, not the state the caller attempted.
- **Lazy User upsert on first JWT sight** — the middleware-level upsert can fire on every request (cached) or per request (slow). Mitigation: cache the upsert in-memory keyed on `sub` for the duration of the process, with a 60s TTL. Refresh on 401.
- **Migration idempotency in tests** — the live Prisma test rig resets the DB per test. The migration adds new tables + new nullable columns + a default value for `state`. Existing `Incident` rows from Story 3.6 will have `state: "OPEN"` post-migration. Verify with `psql -c "select count(*), state from \"Incident\" group by state"`.
- **The `REOPENED` state** is documented as a transition alias (`incident.ts` header), not a stored state. The reopen path (`RESOLVED + reopen → OPEN`) writes `state: "OPEN"`, and the `IncidentEvent.type` discriminator is `"reopen"`. The 4.2 transition table keys off `OPEN` post-reopen, not `REOPENED`.
- **Forward-only migration** — no destructive changes. Per Epic 3 conventions. Existing rows must survive. New columns are all nullable; new tables are empty.

## Implementation notes (locked)

The pure `transition()` function signature:

```ts
export type ActionVerb = "acknowledge" | "assign" | "submit_result" | "resolve" | "reopen";

export interface TransitionResult {
  readonly ok: true;
  readonly nextIncident: IncidentPayload;
  readonly eventType: IncidentEventType;
  readonly payload: { readonly [key: string]: unknown };
}
export interface TransitionError {
  readonly ok: false;
  readonly code: "invalid_state_transition";
  readonly from: IncidentState;
  readonly attempted: ActionVerb;
  readonly at: Date;
}

export const TRANSITIONS: Readonly<
  Record<IncidentState, Readonly<Partial<Record<ActionVerb, IncidentState>>>>
> = {
  OPEN: { acknowledge: "ACKNOWLEDGED", assign: "INSPECTING" },
  ACKNOWLEDGED: { assign: "INSPECTING" },
  INSPECTING: { submit_result: "UNSAFE" /* + SAFE | MONITORING via result enum */ },
  SAFE: { resolve: "RESOLVED" },
  UNSAFE: { resolve: "RESOLVED" },
  MONITORING: { resolve: "RESOLVED" },
  RESOLVED: { reopen: "OPEN" },
  REOPENED: {
    /* alias; resolved as OPEN at write time */
  },
};
```

The router shape:

```ts
router.post(
  "/:id/acknowledge",
  authorize({ action: "acknowledge", resource: "Incident" }, audit),
  async (req, res) => {
    const id = req.params.id;
    const actorUserId = await resolveActorUserId(req.auth!); // lazy-upsert
    const incident = await incidentState.findUnique({ where: { id } });
    if (incident === null) return res.status(404).json({ error: "not_found" });

    const result = transition(incident, "acknowledge", actorUserId);
    if (!result.ok) {
      await incidentState.recordInvalidAttemptTx(incident, actorUserId, result);
      return res
        .status(409)
        .json({
          error: "invalid_state_transition",
          from: result.from,
          attempted: result.attempted,
        });
    }

    const updated = await incidentState.applyTransitionTx(result, actorUserId);
    res.json(IncidentPayloadSchema.parse(updated));
  },
);
```

## Verification (after implementation)

- `pnpm --filter @surakkha/db test` — green; `incident-state-machine.spec.ts` pins AC1-AC9 against live Postgres.
- `pnpm --filter @surakkha/api test` — green; `transitions.spec.ts` covers every cell of the `TRANSITIONS` table; `router.spec.ts` covers every endpoint + RBAC denial.
- `pnpm -r typecheck` — no signature drift on `AlertStateRepository` or any cross-package types.
- `psql` checks:
  - `\d "Incident"` shows new columns (`state`, `assigneeUserId`, `acknowledgedAt`, `resolvedAt`).
  - `\d "User"` shows the 6 seeded rows after `pnpm db:seed`.
  - `\d "IncidentEvent"` shows the audit table.
  - `\d "Notification"` shows the notification table.
  - `select count(*), state from "Incident" group by state` — existing rows have `state: 'OPEN'`.
- Manual smoke (optional, since tests cover this): boot the api, hit `POST /api/incidents/:id/acknowledge` with valid + invalid states, confirm `IncidentEvent` row is written + `incident:state_changed` socket event fires.
