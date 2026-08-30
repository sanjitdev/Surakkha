---
title: "Story 4.11 — Reopen Path (RESOLVED → REOPENED → OPEN)"
type: "feature"
created: "2026-08-28"
status: "in-progress"
review_loop_iteration: 0
baseline_commit: "8a3c889"
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md
  - _bmad-output/implementation-artifacts/spec-4-4-incident-detail-page.md
  - _bmad-output/implementation-artifacts/spec-4-6-assign-technician-inspecting-transition.md
  - _bmad-output/implementation-artifacts/spec-4-7-submit-result-safe-unsafe-monitoring.md
  - _bmad-output/implementation-artifacts/spec-4-8-sticky-severity-banner-rbac.md
  - docs/architecture.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A misclassified incident can land in RESOLVED with the wrong outcome (e.g., SAFE submit when it should have been UNSAFE, MONITORING close when the device is still failing). Operators currently have no recovery path — the only forward transition from RESOLVED in `transitions.ts` is none (the state machine treats RESOLVED as terminal). Per Epic 4 §4.11, an Admin must be able to reopen a RESOLVED incident by submitting a comment with `severity: critical`, which forces the row back into the active workflow as a critical OPEN.

**Approach:** Add a new transition `RESOLVED → OPEN` to `transitions.ts` (the canonical state machine) gated by `actorRole === "Admin"` and a comment payload with `reason ≥ 10 chars`. The transition forces `severity = "critical"` on the reopened row (the existing `projectKanbanColumn` rule already maps `state=OPEN, severity=critical` to the "Open · Critical" column — no projection change). Backend ships a new endpoint `POST /api/incidents/:id/reopen` mirroring 4.6's `POST /api/incidents/:id/assign` shape. Web consumes the endpoint from the existing detail page (`/incidents/:id`) via a "Reopen" button gated by `actionSlotsFor(incident, viewerRole, viewerUserId)` returning an open affordance only for Admin + `state === "RESOLVED"`. Reopen writes an `IncidentEvent` with `type: "reopen"` + payload `{ reason, previous_state, actor_user_id }`. No `notification:*` writer call (reopen is an Admin-only escalation; the existing 4.9 `notification:critical` writer already covers UNSAFE outcomes which is the load-bearing severity-critical signal; reopening is a recovery action, not a new incident). No Prisma schema change.

## Boundaries & Constraints

**Always:**

- The reopen transition is gated by `actorRole === "Admin"` at the transition function level (NOT just RBAC middleware). RBAC matrix already grants `update.Incident = Y` for Admin; the role check is the inner guard per `transitions.ts` 4.2's per-cell pattern. Operator + Technician get a 403 from inside the handler with `{ required_role: "Admin" }` — matches the `cross-role` pattern from 4.10's mark-as-read.
- The reopen payload validates `reason ≥ 10 chars` (server-side Zod). Empty or whitespace-only reasons return `400 invalid_payload`.
- The reopen transition FORCES `severity = "critical"` on the row (overriding whatever severity the row had at RESOLVED). Documented as the load-bearing recovery semantics — reopen is a re-escalation, not a state restore.
- The reopened row's `state = "OPEN"` (NOT `"REOPENED"` — the 7-state enum has REOPENED as a deprecated alias per `IncidentStateSchema`; the canonical post-4.2 path is OPEN). The audit event's `payload.previous_state` is `"RESOLVED"`.
- The reopen writes an `IncidentEvent` with `type: "reopen"` (canonical schema value at `packages/shared/src/incident.ts:130-138`). Payload is `{ reason, previous_state: "RESOLVED", actor_user_id }`. No `acknowledged_at` / `resolved_at` mutation on the row itself — `resolved_at` stays at the original RESOLVE timestamp (audit history); `acknowledged_at` is untouched.
- The endpoint mounts alongside the existing 4.5/4.6/4.7 transitions (`POST /api/incidents/:id/{acknowledge,assign,submit-result,reopen}`).
- The reopen button on `/incidents/:id` uses `actionSlotsFor(incident, viewerRole, viewerUserId)` per 4.1 — the slot returns the affordance only for Admin + `state === "RESOLVED"`. The 4.1 contract already includes reopen as a defined slot; 4.11 wires the renderer.
- The reopen form uses the existing inline toast pattern from 4.5/4.6/4.7. No modal library.
- Reopen is idempotent at the API level: re-opening an already-OPEN row returns `409 invalid_state_transition` (the existing state machine's invalid-transition response).
- Reopen emits the standard `incident:state_changed` socket event (the 4.2 hook already broadcasts on every transition). Kanban cache mutates via the existing `applyStateChangeToCache` helper; the new critical-severity row appears in "Open · Critical".
- Reopen does NOT write a `Notification` row (4.9's writer covers `notification:critical` for UNSAFE outcomes only; reopen's "critical severity" is a forced-display contract, not a notification contract). Documented as deferral.

**Ask First:**

- Whether the reopen reason should be rendered in the audit timeline UI (`/incidents/:id` Events section, 4.4's surface). **Decision: YES** — the `IncidentEvent.payload.reason` is already in the schema; 4.4's `IncidentEventPayloadSchema` exposes it; rendering is a 2-line addition to the timeline row. The reopen reason is operator-visible in the audit.
- Whether reopen should re-trigger the SeverityBanner (4.8) when the reopened row's severity is forced critical. **Decision: NO** — the banner's filter is `state === "UNSAFE"` (NOT `severity === "critical"`); a reopened row is `state === "OPEN"`, which falls outside the banner's filter. Documented as design-intent match.
- Whether to write an `AuditLog` row alongside the `IncidentEvent` (per 4.2's invalid-transition pattern). **Decision: NO** — the `IncidentEvent` with `type: "reopen"` IS the audit trail for this transition. AuditLog is reserved for denied attempts and security events, not state transitions.

**Never:**

- Touching the `IncidentStateSchema` enum (4.2 is locked).
- Touching `notificationWriter.ts` (4.9 is locked).
- Touching the Prisma schema (no new columns; `IncidentEvent.payload` is freeform `Record<string, unknown>`).
- Adding a new socket event. Reopen uses the existing `incident:state_changed` channel.
- Adding a new RBAC cell. The matrix already has `update.Incident = Y` for Admin (line 109 of `rbac.ts`); the inner `actorRole === "Admin"` check is the per-cell guard.
- Optimistic UI on the reopen button. Wait for the server's 200, then refetch the detail page (matches 4.5/4.6/4.7).
- Tailwind template-literal classes (Story 2.8 VG-1 lesson).
- Modifying the Kanban, SeverityBanner, or NotificationBell surfaces — they all consume `incident:state_changed` automatically.
- A reopen from states other than RESOLVED (return `409 invalid_state_transition` per the state machine).

## I/O & Edge-Case Matrix

| Scenario                      | Input / State                                                                                                        | Expected Output / Behavior                                                                                                                                                                                                                               | Error Handling                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `HAPPY_PATH_ADMIN`            | Admin POSTs `/api/incidents/:id/reopen` with `{ reason: "Misclassified — device still failing" }` on a RESOLVED row. | 200 with updated row; row transitions to `OPEN` with `severity: critical`; `IncidentEvent` written with `type: "reopen"`, payload `{ reason, previous_state: "RESOLVED", actor_user_id }`. Detail page refetches; Kanban shows row in "Open · Critical". | N/A                                    |
| `ZERO_HAPPY_OPERATOR`         | Operator POSTs the same endpoint.                                                                                    | 403 with `{ required_role: "Admin" }`. No transition. No IncidentEvent. AuditLog row NOT written (rejected by RBAC matrix, not by inner check).                                                                                                          | 403 surfaces in detail page toast.     |
| `ZERO_HAPPY_TECHNICIAN`       | Technician POSTs the same endpoint.                                                                                  | Same as Operator — 403.                                                                                                                                                                                                                                  | 403 surfaces in toast.                 |
| `REASON_TOO_SHORT`            | Admin POSTs with `{ reason: "wrong" }` (< 10 chars).                                                                 | 400 `invalid_payload` with `{ reason: "must be at least 10 characters" }`. No transition.                                                                                                                                                                | Toast surfaces validation message.     |
| `REASON_EMPTY`                | Admin POSTs with `{ reason: "" }`.                                                                                   | 400 `invalid_payload`.                                                                                                                                                                                                                                   | Toast.                                 |
| `REASON_WHITESPACE`           | Admin POSTs with `{ reason: "          " }` (whitespace only).                                                       | 400 `invalid_payload`.                                                                                                                                                                                                                                   | Toast.                                 |
| `WRONG_STATE_OPEN`            | Admin POSTs on a row currently in `OPEN` state.                                                                      | 409 `invalid_state_transition` with `{ from: "OPEN", action: "reopen" }`. No transition.                                                                                                                                                                 | Toast + stays on detail page.          |
| `WRONG_STATE_INSPECTING`      | Admin POSTs on `INSPECTING`.                                                                                         | 409 `invalid_state_transition`.                                                                                                                                                                                                                          | Toast.                                 |
| `WRONG_STATE_UNSAFE`          | Admin POSTs on `UNSAFE`.                                                                                             | 409 `invalid_state_transition`.                                                                                                                                                                                                                          | Toast.                                 |
| `WRONG_STATE_MONITORING`      | Admin POSTs on `MONITORING`.                                                                                         | 409.                                                                                                                                                                                                                                                     | Toast.                                 |
| `WRONG_STATE_ACKNOWLEDGED`    | Admin POSTs on `ACKNOWLEDGED`.                                                                                       | 409.                                                                                                                                                                                                                                                     | Toast.                                 |
| `IDEMPOTENT_DOUBLE_REOPEN`    | Admin re-POSTs after the first reopen succeeds (row is now OPEN).                                                    | 409 (state is no longer RESOLVED).                                                                                                                                                                                                                       | Toast.                                 |
| `RACE_REOPEN_WHILE_RESOLVING` | Two requests: one reopen + one resolve arrive within 1ms.                                                            | One wins on the `$transaction`; the other returns 409. Pinned by the live-Prisma concurrent-update test.                                                                                                                                                 | Whichever loses surfaces 409.          |
| `UNAUTHENTICATED`             | No JWT.                                                                                                              | 401 from `authenticate` middleware.                                                                                                                                                                                                                      | 401 surfaces in toast.                 |
| `NOT_FOUND`                   | Admin POSTs on non-existent `:id`.                                                                                   | 404 `not_found` from the existing fetch-then-check pattern.                                                                                                                                                                                              | Toast + detail page surfaces NotFound. |
| `FORCED_CRITICAL_SEVERITY`    | Admin reopens a row that was WARNING at RESOLVED.                                                                    | Row's `severity` is set to `"critical"` regardless of prior value. Pinned: the reopen handler mutates severity post-transition.                                                                                                                          | N/A — design contract.                 |
| `TIMELINE_RENDERS_REASON`     | Detail page loads after reopen.                                                                                      | The reopen `IncidentEvent` row in the timeline shows `reason` text. Pinned in 4.4's timeline renderer extension.                                                                                                                                         | N/A.                                   |
| `KEEP_RESOLVED_AT`            | Detail page after reopen.                                                                                            | `resolved_at` STILL shows the original RESOLVE timestamp (audit history). The reopened row is now `state: "OPEN"` but `resolved_at` is preserved.                                                                                                        | N/A — design contract.                 |
| `NO_NOTIFICATION_WRITTEN`     | Admin reopens a row.                                                                                                 | No new `Notification` row written (4.9's writer is NOT called from the reopen handler). Pinned: the reopen handler does NOT touch the notification writer.                                                                                               | N/A.                                   |
| `NO_SEVERITY_BANNER`          | Admin reopens a row.                                                                                                 | SeverityBanner (4.8) does NOT show — banner's filter is `state === "UNSAFE"`, not severity. Reopened row is `state: "OPEN"`.                                                                                                                             | N/A.                                   |

</frozen-after-approval>

## Code Map

**Shared (`packages/shared/`):**

- `src/incident.ts` — MODIFY. Add `IncidentEventTypeSchema.reopen = "reopen"` to the existing enum at line 130-138 (matches the canonical schema). No new types — `IncidentEventPayloadSchema` already accepts freeform `Record<string, unknown>`.
- `src/rbac.ts` — NO CHANGE. The matrix already grants `update.Incident = Y` for Admin (line 109). The inner `actorRole === "Admin"` check is the per-cell guard.

**Backend (`packages/api/`):**

- `src/incidents/transitions.ts` — MODIFY. Add a new transition cell `RESOLVED → OPEN` with action verb `reopen`. Inner guard: `actor.role === "Admin"` AND `payload.reason.trim().length >= 10`. Side effect: forces `severity: "critical"` on the next row. Mirror the 4.7 `submit-result` shape (action verb + role guard + payload validation).
- `src/incidents/transitionHelpers.ts` — MODIFY. Add `applyReopenTx` parallel to `applyAcknowledgeTx` / `applyAssignTx` / `applySubmitResultTx`. Writes `IncidentEvent` with `type: "reopen"`, payload `{ reason, previous_state: "RESOLVED", actor_user_id }`. Does NOT touch `resolved_at` / `acknowledged_at`. Mutates `state: "OPEN"`, `severity: "critical"`.
- `src/incidents/router.ts` — MODIFY. Mount `POST /api/incidents/:id/reopen` alongside the existing transition routes. Reuses the existing `authenticate` + `authorize({ action: "update", resource: "Incident" }, deps.audit)` + `transition()` + audit-on-fail pattern. Inline role check `req.user.role !== "Admin"` returns 403 with `{ required_role: "Admin" }`.
- `src/incidents/reopenPayloadSchema.ts` — NEW. Zod schema: `{ reason: z.string().min(10).max(2000).trim() }`. Re-exported for the spec.
- `src/incidents/reopenRouter.spec.ts` (or extend `router.spec.ts`) — NEW ~8 tests: HAPPY_PATH_ADMIN, ZERO_HAPPY_OPERATOR, ZERO_HAPPY_TECHNICIAN, REASON_TOO_SHORT, REASON_EMPTY, WRONG_STATE_OPEN, WRONG_STATE_INSPECTING, NOT_FOUND, UNAUTHENTICATED.
- `src/incidents/transitions.spec.ts` — MODIFY. Add ~5 unit tests for the new transition cell: pure-helper coverage on `RESOLVED + reopen + Admin → OPEN`, `RESOLVED + reopen + Operator → invalid (role)`, `RESOLVED + reopen + reason<10 → invalid (payload)`, `OPEN + reopen → invalid (state)`, `UNSAFE + reopen → invalid (state)`.

**Web (`packages/web/`):**

- `src/incidents/actionSlotsFor.ts` (4.1 contract) — MODIFY. Add the reopen-slot branch: returns `reopen` affordance when `actorRole === "Admin"` AND `incident.state === "RESOLVED"`. Slot shape mirrors 4.5/4.6/4.7.
- `src/incidents/ReopenControl.tsx` — NEW. The button + inline form component. Mirrors 4.6's `AssignControl` shape: button → textarea modal (inline, no library) → submit → toast on error → refetch detail page on success. Reads `actionSlotsFor(incident, viewerRole, viewerUserId)` for visibility.
- `src/incidents/IncidentDetailPage.tsx` (4.4) — MODIFY. Mount `<ReopenControl />` inside the existing actions slot (4.1 reserved this seam). Render only when `actionSlotsFor` returns a reopen slot.
- `src/incidents/IncidentDetailPage.spec.tsx` (4.4) — MODIFY. Add ~4 tests: HAPPY_PATH_ADMIN (button visible + click + reopen flow), ZERO_HAPPY_OPERATOR (button absent), ZERO_HAPPY_TECHNICIAN (button absent), REASON_TOO_SHORT (toast surfaces), FORCED_CRITICAL (row's `data-severity` updates to `"critical"` after reopen).
- `src/incidents/KanbanCard.tsx` — NO CHANGE. The card already drops RESOLVED rows from the active list (4.3 contract); reopened cards appear via the existing `incident:state_changed` socket path (4.2 broadcasts + 4.3's `applyStateChangeToCache` handles).
- `src/incidents/useIncidentDetailSocket.ts` (4.4) — NO CHANGE. The existing detail cache mutator updates the row in place on state change; reopened rows transition smoothly.

**Prisma:** NO CHANGE. `Incident.payload` is freeform; `IncidentEvent.type` enum already includes `"reopen"` per `schema.prisma:172-179`.

## Tasks & Acceptance

**Execution:**

- [ ] 1. Write spec doc (this file). Status: draft.
- [ ] 2. Modify `packages/shared/src/incident.ts` — add `"reopen"` to `IncidentEventTypeSchema`.
- [ ] 3. Create `packages/api/src/incidents/reopenPayloadSchema.ts` — `{ reason: z.string().min(10).max(2000).trim() }`.
- [ ] 4. Modify `packages/api/src/incidents/transitions.ts` — add `RESOLVED → OPEN` cell with role + payload guards + forced-severity side effect.
- [ ] 5. Modify `packages/api/src/incidents/transitionHelpers.ts` — add `applyReopenTx` writing `IncidentEvent{type:"reopen"}` + mutating `state:"OPEN"` + `severity:"critical"`.
- [ ] 6. Modify `packages/api/src/incidents/router.ts` — mount `POST /api/incidents/:id/reopen` with role check.
- [ ] 7. Add tests: `transitions.spec.ts` (~5 cells) + `router.spec.ts` or new spec file (~8 endpoint cases).
- [ ] 8. Modify `packages/web/src/incidents/actionSlotsFor.ts` — add reopen-slot branch.
- [ ] 9. Create `packages/web/src/incidents/ReopenControl.tsx` + spec (~4 cases).
- [ ] 10. Modify `packages/web/src/incidents/IncidentDetailPage.tsx` — mount `<ReopenControl />`.
- [ ] 11. Extend `packages/web/src/incidents/IncidentDetailPage.spec.tsx` (~4 cases).
- [ ] 12. Run `pnpm --filter @surakkha/api test`, `pnpm -F @surakkha/web test`, `pnpm -r typecheck`. Lint-fix any failures.
- [ ] 13. Commit `feat(Story 4.11): reopen path (RESOLVED → OPEN via Admin + comment)` with the standard trailer.
- [ ] 14. Step-04 review (3 parallel reviewers). Triage findings. Apply patches.
- [ ] 15. Append `## Suggested Review Order`. Flip status to `done`. Update `sprint-status.yaml`. Commit `chore(spec): mark Story 4.11 done`.

**Acceptance Criteria:**

1. Admin POSTs `POST /api/incidents/:id/reopen` with `{ reason: "..."≥10 chars }` on a RESOLVED row; row transitions to `OPEN` with `severity: "critical"`; `IncidentEvent{type:"reopen"}` is written. Pinned in endpoint spec.
2. Operator + Technician POSTs return `403` with `{ required_role: "Admin" }`. Pinned in endpoint spec.
3. Reason `< 10 chars` returns `400 invalid_payload`. Pinned in endpoint spec.
4. Reopen on a non-RESOLVED row returns `409 invalid_state_transition`. Pinned in endpoint spec (one test per non-RESOLVED state).
5. The reopened row's `resolved_at` is UNCHANGED (preserved for audit). Pinned in endpoint spec.
6. The reopened row's `severity` is `"critical"` regardless of prior severity. Pinned in endpoint spec.
7. The reopen `IncidentEvent` payload contains `{ reason, previous_state: "RESOLVED", actor_user_id }`. Pinned in endpoint spec + transitions.spec.ts.
8. The `<ReopenControl />` button appears on `/incidents/:id` only when viewer is Admin AND incident state is RESOLVED. Pinned in `IncidentDetailPage.spec.tsx`.
9. After reopen, the detail page refetches and shows the new `state: "OPEN"` + `severity: "critical"` on the header. Pinned in `IncidentDetailPage.spec.tsx`.
10. After reopen, the `incident:state_changed` socket event lands; the Kanban cache mutates; the reopened card appears in "Open · Critical" column. Pinned in `KanbanBoard.spec.tsx` extension (1 new test).
11. Reopen does NOT write a `Notification` row (no notification:critical call from reopen). Pinned in notificationWriter.spec.ts extension (assert no `writeCriticalNotification` invocation).
12. Reopen does NOT trigger the SeverityBanner (banner's filter is state=UNSAFE, not severity). Pinned by absence — reopen handler does NOT touch the banner cache.

## Design Notes

**Why reopen forces `severity: "critical"`.** A reopen is a re-escalation: an Admin says "this row was misclassified, re-enter the active workflow at the highest priority." Forcing critical matches the existing UX-DR-9 contract (critical-severity cards land in "Open · Critical" — the most operator-visible column). A WARNING-severity reopen would put the row in "Open · Warning" — invisible to the operator who needs to act on it. The forced-critical contract is the design-intent match for "Admin opened it back up because it was wrong" — they want it visible immediately.

**Why reopen does NOT write a `Notification` row.** 4.9's writer pins `notification:critical` for `transition.to === "UNSAFE"` outcomes only. Reopen's "critical severity" is a display-forcing contract (force the row into the critical column), not a notification contract (the operator is already looking at the row in the Kanban — the bell would be noise). Reopen is Admin-initiated; the Admin already knows they reopened it. A future story that adds operator-targeted reopen notifications (e.g., "Admin reopened incident X") can revisit — the writer's `recipientRole` parameter is the typed seam.

**Why the reopen handler does NOT re-emit the audit event.** The `IncidentEvent` with `type: "reopen"` IS the audit trail. `AuditLog` is reserved for denied attempts (`event: __invalid_transition_attempt`) and security events per 4.2's `transition()` helper. Adding a parallel AuditLog row would duplicate the trail and confuse downstream readers (4.4's renderer queries `IncidentEvent` rows, not `AuditLog`).

**Why the inner `actorRole === "Admin"` check is in the transition function, not just RBAC middleware.** RBAC matrix already grants `update.Incident = Y` for Admin + Operator (line 109 + 167 of `rbac.ts`). A naïve implementation would let Operator reopen because `update` is granted. The inner check is the per-cell guard that 4.2's `transitions.ts` uses for every action verb — `acknowledge` is gated to `Operator+`, `submit_result` is gated to `Technician`, etc. Reopen extends the pattern: `reopen` is gated to `Admin` ONLY. The middleware-level RBAC check passes; the inner guard is the per-verb authority.

**Why reopen uses `state: "OPEN"` and NOT `"REOPENED"`.** The `IncidentStateSchema` enum at `incident.ts:15-25` has `"REOPENED"` as a deprecated alias from the pre-4.2 v0 design. Post-4.2, the canonical state for a reopened row is `"OPEN"` (it enters the same column projection as any other OPEN row). The audit event's `payload.previous_state: "RESOLVED"` preserves the recovery history. Using `"REOPENED"` would require re-touching `projectKanbanColumn` (4.3 contract) and `transitions.ts` (4.2 contract) — neither story is in the 4.11 scope.

**Why the reopen form uses an inline textarea (no modal).** Matches the 4.6 `AssignControl` pattern (technician-picker dropdown inline; no modal library). Inline-toast pattern from 4.5 handles the success/error surfaces. Adding a modal library for one form is over-engineering.

## Verification

**Commands:**

- `pnpm --filter @surakkha/api test` — expected: green; `transitions.spec.ts` adds ~5 tests, `router.spec.ts` adds ~8 tests. Pre-existing 6 alerts/rules failures (AI-3.1) are unrelated — documented, not fixed.
- `pnpm --filter @surakkha/web test` — expected: existing 428 + ~4 new (ReopenControl) + ~4 new (IncidentDetailPage extension) = ~436 green.
- `pnpm -r typecheck` — expected: clean across 4 active packages.

**Manual checks (if no CLI):**

- Boot api + web; seed an incident; resolve it (submit SAFE); navigate to `/incidents/:id` as Admin; verify Reopen button appears; click it; enter a reason ≥ 10 chars; submit; verify URL stays at `/incidents/:id`, header now shows `state: OPEN, severity: critical`, and the Kanban `/incidents` view shows the row in "Open · Critical".
- Switch role to Operator; verify Reopen button is absent from `/incidents/:id`.
- Try POSTing `POST /api/incidents/:id/reopen` as Operator via curl; verify 403 response.

## Spec Change Log

Append-only. Populated by step-04 during review loops. Empty until the first bad_spec loopback.

## Suggested Review Order

A reviewer should walk the change in this order to catch the load-bearing seams first:

1. **Transition cell** — `packages/api/src/incidents/transitions.ts`. The new `RESOLVED → OPEN` cell with role + payload guards + forced-severity side effect.
2. **Reopen payload schema** — `packages/api/src/incidents/reopenPayloadSchema.ts`. The `reason ≥ 10 chars` Zod validation.
3. **Transition helper** — `packages/api/src/incidents/transitionHelpers.ts`. `applyReopenTx` writes `IncidentEvent{type:"reopen"}` + mutates state/severity + preserves `resolved_at`.
4. **Router mount** — `packages/api/src/incidents/router.ts`. `POST /api/incidents/:id/reopen` with inline Admin check returning `{ required_role: "Admin" }`.
5. **Action slot contract** — `packages/web/src/incidents/actionSlotsFor.ts`. The reopen-slot branch: Admin + RESOLVED.
6. **ReopenControl** — `packages/web/src/incidents/ReopenControl.tsx`. Inline button + textarea + submit + toast pattern.
7. **Detail page mount** — `packages/web/src/incidents/IncidentDetailPage.tsx`. `<ReopenControl />` slot integration.
8. **Kanban socket invalidation** — `packages/web/src/incidents/useKanbanBoardSocket.ts`. Reopen's `incident:state_changed` event lands; `applyStateChangeToCache` mutates; card appears in "Open · Critical".
9. **Spec doc + ACs** — this file. Each AC bullet maps to a specific test file.
