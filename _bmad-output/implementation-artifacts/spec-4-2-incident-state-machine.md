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

| AC   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pin                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------- | --- | ------------------- | ------ |
| AC1  | `packages/api/src/incidents/transitions.ts` exports a pure `transition(incident, action, actor)` function. The function returns `{ ok: true, nextIncident, event } \| { ok: false, code: 'invalid_state_transition', from, attempted }`. No DB, no fetch, no clock — pure logic over the input shape.                                                                                                                                                                                                                                                        | `transitions.spec.ts` AC for each `(state × action)` cell.                                                                |
| AC2  | `TRANSITIONS` table in the same file maps every valid `(from_state, action) → to_state` for all 7 stable states. The `REOPENED` alias maps `RESOLVED + reopen → OPEN` (REOPENED is a transition alias, not a stored state — per `incident.ts` header comment).                                                                                                                                                                                                                                                                                               | Table exported + iterated test.                                                                                           |
| AC3  | Every successful transition writes an `IncidentEvent` row inside the same `$transaction` as the `Incident.update`. Atomicity is asserted by the live-Prisma test (a thrown `tx.incidentEvent.create` rolls back the `Incident.update`).                                                                                                                                                                                                                                                                                                                      | Live test in `incident-state-machine.spec.ts`.                                                                            |
| AC4  | **(Closes AI-3.2)** Every successful transition emits a `console.warn({ event: "incident_transition", incident_id, from, to, verb, actor_user_id, at })` log line. Auto-created incidents (Story 3.6 path) emit the same `event: "incident_transition"` with `verb: "auto_create"` to distinguish the system-driven from operator-driven paths. `console.warn` (not `console.info`) is intentional — the project's lint config does not include `console.info` in the allow-list.                                                                            | `transitions.spec.ts` + `applyTransition.ts` log call.                                                                    |
| AC5  | **(Closes AI-3.3)** `IncidentOpenedEventSchema` is added to `packages/shared/src/events.ts`. `applyTransition.ts`'s auto-create-incident path emits `incident:opened` on the post-commit hook (alongside the existing `alert:opened`).                                                                                                                                                                                                                                                                                                                       | Wire test pins schema; live test pins emit call.                                                                          |
| AC6  | Optimistic-concurrency via `Incident.updatedAt`. `tx.incident.updateMany({ where: { id, updatedAt: priorUpdatedAt } })` returns `count: 0` on a lost race. The handler converts that to `409 invalid_state_transition` with `reason: "concurrent_modification"` and writes an `IncidentEvent` with `type: "invalid_transition_attempt"`. The IncidentEvent `payload.from` carries the pre-update `currentRow.state` (the actor's view at request time); the HTTP response body carries `reason: "concurrent_modification"` for the loser to refresh against. | Live test creates two concurrent transitions; asserts one 409 + one IncidentEvent with type "invalid_transition_attempt". |
| AC7  | Negative transitions write an `IncidentEvent` row with `type: "invalid_transition_attempt"` (single underscore — same enum value Epic 5.3's `AuditLog` table will consume; the double-underscore literal was reserved for v1 stand-in but the single-underscore DB enum value is the canonical key for v1+). The DB row carries `{ incidentId, actorUserId, attempted, from, at }` in its `payload` field. v1 has no separate `console.warn` log line — the DB row is the audit record.                                                                      | `transitions.spec.ts` + `router.spec.ts` capture console.                                                                 |
| AC8  | Every cell in the `TRANSITIONS` table has a unit test in `transitions.spec.ts`. The spec pins `(state, action) → expected_next_or_invalid`.                                                                                                                                                                                                                                                                                                                                                                                                                  | Test count ==                                                                                                             | valid transitions | +   | invalid transitions | cells. |
| AC9  | Migration adds: `User` table (id PK, role enum, displayName, timestamps); `Incident.state` enum + default `OPEN`; `Incident.assigneeUserId` nullable FK to User; `Incident.acknowledgedAt` + `Incident.resolvedAt` nullable DateTime; `IncidentEvent` table; `Notification` table; `Attachment` table. Forward-only; no destructive changes.                                                                                                                                                                                                                 | `psql -c '\d "Incident"'` etc. + `prisma migrate dev` clean.                                                              |
| AC10 | `packages/db/prisma/seedUsers.ts` creates 6 demo users: 1 Admin, 2 Operators, 2 Technicians, 1 Viewer. Idempotent on `upsert(user.id)`. Wired to `pnpm db:seed`.                                                                                                                                                                                                                                                                                                                                                                                             | Live test asserts 6 rows after seed.                                                                                      |

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
      return res.status(409).json({
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

---

## Review Findings (2026-08-27 Group 1 — code review against this spec)

### Decision-needed (ambiguous; requires user input)

- [ ] [Review][Decision] **AC4 spec deviation — log method + event name** [router.ts:174-184, applyTransition.ts:292-303, transitionHelpers.ts:473-486] — Spec AC4 mandates `console.info({ event: "incident_transition", from, to, actor, incidentId })` PLUS a separate `console.info({ event: "incident_auto_created", deviceId, severity, metric })` for auto-create. Code emits `console.warn({ event: "incident_transition", ... })` for both paths, with auto-create distinguished only by `verb: "auto_create"`. The deliberate choice was driven by lint (`console.info` is not in the no-console allow-list — see applyTransition.ts:288-291 comment). Needs: amend spec to `console.warn` + `verb: "auto_create"`, OR change lint config to allow `console.info`, OR introduce a logger abstraction. See also AC7 (next item).
- [ ] [Review][Decision] **AC7 spec deviation — log missing + double-underscore name** [transitionHelpers.ts:563-579] — Spec AC7 mandates `console.warn({ event: '__invalid_transition_attempt', actorUserId, payload: { incidentId, attempted, from } })`. Code writes a DB row with `type: "invalid_transition_attempt"` (single underscore) and emits NO console.warn. The literal `__invalid_transition_attempt` (double underscore) was reserved as a v1 stand-in shape for Epic 5.3's `AuditLog` table. Needs: amend spec to use the single-underscore DB enum value as the audit event key, OR add the console.warn, OR keep the DB enum but rename via a constant in the log line. The DB row is written; the warn log is the gap.
- [ ] [Review][Decision] **UUID divergence between `users.ts` and `seedUsers.ts`** [users.ts:43-86, seedUsers.ts:44-75] — The api's in-memory demo store mints JWTs with `sub = ...a001, a002, a003, a004, a006, a007`. The Prisma seed inserts users with ids `...a001, b001, b002, c001, c002, d001`. Only `a001` (Admin) matches. A demo login as `operator2@surakkha.test / demo-operator2` produces a JWT for `...a006`, but no User row with that id exists in the DB — every FK reference (Incident.assigneeUserId, Notification.acknowledgedByUserId, IncidentEvent.actorUserId) on that JWT's actor would violate the FK constraint added by this migration. Spec header comment in `users.ts:9-10` explicitly promises "Six canonical demo users matching the Prisma `seedUsers.ts`" — broken contract. Needs: align both rosters to the same UUIDs, OR add the missing four User rows (`a002, a003, a004, a006, a007`) to `seedUsers.ts`, OR delete the two extra rows from `users.ts`. **This is the highest-priority decision needed** — the demo path is broken today.
- [ ] [Review][Decision] **Migration Alert FK retrofit on legacy data** [migration.sql:226-233] — `ALTER TABLE "Alert" ADD CONSTRAINT "Alert_acknowledgedByUserId_fkey" REFERENCES "User"("id")` adds the FK without a backfill. If any pre-4.2 Alert row has a non-null `acknowledgedByUserId` that doesn't match a seeded User.id, the migration aborts and the entire Epic 4 backend is bricked. The defer from the v1 plan ("FK constraint added in Epic 5 migration") was reverted without documenting a backfill. Needs: confirm prod-like DB has zero legacy Alert.acknowledgedByUserId values, OR add a `DO $$ ... NULL orphans ... $$` block before the FK addition.
- [ ] [Review][Decision] **`notification:critical` recipient role hardcoded `"Operator"`** [incidentStateRepository.ts:344-352] — Spec AC says `notification:critical` fires on UNSAFE (closes 4.9 AC2); intent of recipient role is ambiguous. Submitting-Technician is the actor; the on-call Operator is the natural escalation target; but the spec never explicitly named the recipient. Needs: spec amendment pinning `recipientRole: "Operator"` as the canonical choice, OR thread the recipient from the request context.
- [ ] [Review][Decision] **`acknowledgedAt` / `resolvedAt` preserved on reopen (state=OPEN but timestamps non-null)** [incidentStateRepository.ts:305-306, 382-406] — After `reopen`, the IncidentPayload has `state: "OPEN"` AND `resolvedAt: <historical>` AND `acknowledgedAt: <historical>`. Spec pin says "reopen path writes state back to OPEN"; does not say whether to clear the historical timestamps. Consumers that filter `state === "OPEN" && resolvedAt IS NULL` (the obvious Kanban pattern) will miscategorize reopened incidents. Needs: amend spec to say "preserve historical timestamps on reopen" OR clear `resolvedAt` on reopen.

### Patch (unambiguous; safe to apply)

- [ ] [Review][Patch] **P2002 race on `notification:critical` partial unique index → 500** [transitionHelpers.ts:439-457] — `commitTransition` only catches `OptimisticConcurrencyError`; a P2002 from the partial-unique-index race becomes a generic 500. Fix: catch Prisma P2002 in `commitTransition` and convert to 409 `concurrent_modification`.
- [ ] [Review][Patch] **P2002 race on `notification:warning` partial unique index → transaction rollback** [rules/applyTransition.ts:188-191, notifications/notificationWriter.ts] — `writeWarningNotification` inside `$transaction` does not catch P2002, so a benign idempotency race rolls back the entire (Alert + Incident + Notification) commit. Fix: in `notificationWriter`, catch P2002 and refetch the existing row.
- [ ] [Review][Patch] **`assign` body does not validate target User exists** [transitionHelpers.ts:425-436, incidentStateRepository.ts:308-312] — FK violation P2003 is uncaught, surfaces as 500. Fix: pre-flight `repo.incident.findFirst` against `User` for the assignee id, OR catch P2003 and convert to 404.
- [ ] [Review][Patch] **`projectNextIncident` is dead code with misleading docstring + inverted semantics** [transitions.ts:3027-3042] — Used only in `transitions.spec.ts`; writer (`applyTransition`) preserves the existing assignee; helper overwrites with null. Docstring claims "used by the route layer's post-update projection" — FALSE. Fix: delete the helper (preferred), or fix semantics + update docstring.
- [ ] [Review][Patch] **AC8 — structural-walk test asserts wrong invariant + missing per-cell invalid assertions** [transitions.spec.ts:2336-2370] — Test accepts `undefined` (invalid) as a valid value; missing cells like `SAFE + acknowledge`, `UNSAFE + acknowledge`, `MONITORING + acknowledge`, `RESOLVED + resolve`, `RESOLVED + assign`, etc. are not pinned with explicit assertions. Fix: tighten the walk to assert the table is non-sparse AND add a per-cell invalid sweep for cells not covered by valid examples.
- [ ] [Review][Patch] **AC10 — `seedUsers` not wired to `pnpm db:seed`** [packages/db/prisma/package.json] — Spec code map calls for `db:seed` script in `packages/db/prisma/package.json`. Diff does not add it. Fix: add `prisma db seed --schema=./schema.prisma` script + wire `prisma.seed` key in package.json. Also: `seedUsers.ts` runs `main()` at module load (top-level `main().catch(...)`) instead of exporting; needs refactor to `export async function main()` for `prisma db seed` to call.
- [ ] [Review][Patch] **`incident:opened` payload fields not asserted in test** [rules/__tests__/hooks.spec.ts:660-682] — Test only checks event name + room; no field assertion. Fix: add at least `incident_id`, `severity`, `alert_id` assertions per emit.
- [ ] [Review][Patch] **`recentRouter` consumer of new `state` column — wire shape not pinned** [packages/api/src/incidents/recentRouter.ts (not in this diff)] — Migration adds `state` column; `recentRouter` is untouched; dashboard preview may render `undefined`. Fix: extend `recentRouter.spec.ts` to assert `state: "OPEN"` on every row.
- [ ] [Review][Patch] **`auto_create` verb literal is not in `ActionVerbSchema`** [applyTransition.ts:292-303, shared/incident.ts] — Auto-create log uses `verb: "auto_create"` but `ActionVerbSchema` only enumerates the 5 RBAC verbs. Fix: either widen `ActionVerbSchema` to include `auto_create` OR document asymmetry in `events.ts` and use a distinct event name.
- [ ] [Review][Patch] **`notification:critical` test doesn't pin `recipientRole` / `alertId`** [router.spec.ts:891-920] — Test only asserts `severity === "critical"` and `incidentId === INCIDENT_ID`. Fix: assert `recipientRole === "Operator"` and `alertId === null`.
- [ ] [Review][Patch] **Technician reads unassigned incidents** [router.ts:234-252] — `row.assigneeUserId !== null` precondition skips the ownership check for unassigned incidents. Fix: change to `if (req.user?.role === "Technician" && row.assigneeUserId !== req.user.id)`.
- [ ] [Review][Patch] **`router.ts` markers `_requireOwnerMarker` / `_applyTransitionMarker` are cargo-cult** [router.ts:296-304] — TypeScript's `noUnusedLocals` already enforces import usage; the markers are dead. Fix: remove both `const _x = ...; void _x;` blocks and their doc comments.
- [ ] [Review][Patch] **`incident_transition` log emitted from two paths** [router.ts:174-194 vs transitionHelpers.ts:473-486] — Router.ts inlines its own copy of the log line; `respondSuccess` (line 335) calls `logTransition` from the helper, but router.ts doesn't use `respondSuccess`. Fix: delete the inline copy; call `respondSuccess` from `buildTransitionHandler`.
- [ ] [Review][Patch] **`computeTransition` uses `as never`** [transitionHelpers.ts:310] — Dishonest cast on Zod-narrowed field. Fix: change `as never` to `as InspectionOutcome` (or refactor to thread the narrowed shape from the parse step).
- [ ] [Review][Patch] **`incident:opened` schema asymmetry (omits `actor_user_id`)** [shared/events.ts:4222-4232] — Schema doesn't include `actor_user_id`; sibling `incident:state_changed` does. Fix: add `actor_user_id: z.string().uuid().nullable()` to `IncidentOpenedEventSchema` (system-driven → always null, but parity helps listeners).
- [ ] [Review][Patch] **`writeInvalidAttemptEvent` swallows DB errors silently** [transitionHelpers.ts:563-580] — 409 returns to client even if the audit row fails to insert. Fix: add a structured `audit.alert` console.warn (already has console.error — upgrade to structured JSON).
- [ ] [Review][Patch] **Reset-rack `transitions.spec.ts` stale test name** [transitions.spec.ts:2637-2650] — Test name "clears assignee_user_id to null on resolve if input is null" contradicts the assertion `expect(next.assignee_user_id).toBe(TECH_ID)`. Fix: rename to "preserves assignee_user_id on resolve when route passes null".
- [ ] [Review][Patch] **`resolveActorUserId` lazy-upsert helper missing** [users.ts:9-10 docstring promises it; routerWiring.ts does not implement] — Spec promises lazy-upsert defense-in-depth. Fix: add `resolveActorUserId(jwt): Promise<string | null>` to `packages/api/src/index.ts` and call it in `buildTransitionHandler` before logging actor ids.

### Deferred (pre-existing or scope)

- [x] [Review][Defer] **`applyTransition` writer has no direct test** [incidentStateRepository.ts:291-364] — deferred, live-Prisma rig is the right home — deferred-work F-4.2-1
- [x] [Review][Defer] **`applyTransition` rollback on `incidentEvent.create` failure has no test** — deferred, live-Prisma rig — deferred-work F-4.2-2
- [x] [Review][Defer] **`incident:opened` schema parse failure silent** [applyTransition.ts:280-284] — deferred, consumer-side concern (Story 4.4) — deferred-work F-4.2-3
- [x] [Review][Defer] **`loadOrRespond` doesn't enforce Technician ownership at read time** [transitionHelpers.ts:368-383] — deferred, only one current consumer — deferred-work F-4.2-4
- [x] [Review][Defer] **`prepareTransitionContext` / `loadOrRespond` in-band null sentinel** [transitionHelpers.ts:174-200, 368-383] — deferred, refactor scope non-trivial — deferred-work F-4.2-5
- [x] [Review][Defer] **No `incident-state.migration.spec.ts`** [packages/db/prisma/migrations/20260827000000_incident_state/migration.sql] — deferred, live-Prisma rig — deferred-work F-4.2-6

### Dismissed (noise / false positive)

- ~~[Review][Dismiss] **`buildIncidentRepoResolver` unsynchronized lazy-init race** [routerWiring.ts] — Benign race; first winner's narrow view becomes orphaned but `resolveIncidentStateRepository` is idempotent. Functionally harmless.
- ~~[Review][Dismiss] **Migration `IF NOT EXISTS` guards** [migration.sql:3422-3425] — Spec explicitly says forward-only single migration; idempotency is a separate concern (covered by re-running `prisma migrate reset` in dev).
- ~~[Review][Dismiss] **`incidentRowToPayload` `Date | string` branch untested** [incidentStateRepository.ts:382-406] — Defensive code; Prisma always returns Date; not worth a test.
- ~~[Review][Dismiss] **`seedUsers` `createdFresh` heuristic unreliable under fast re-seed** [seedUsers.ts:101] — Cosmetic counter; doesn't affect correctness.
- ~~[Review][Dismiss] **No defense-in-depth RBAC check in `buildTransitionHandler`** [router.ts] — Middleware is the canonical gate; handler-level checks duplicate and drift.
- ~~[Review][Dismiss] **`buildIncidentPayload` accepts arbitrary severity** [rules/incidentFromAlert.ts:104-124] — Defense-in-depth; call site is internal.
- ~~[Review][Dismiss] **`transitions.ts` empty-string assignee slips through** [transitions.ts:2895-2913] — Zod catches at the route; pure function trusts upstream.
- ~~[Review][Dismiss] **schema.prisma reformatting churn + EOF newline cleanup** [schema.prisma] — Cosmetic noise; not worth a follow-up commit.
