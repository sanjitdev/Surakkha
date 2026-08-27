# Epic 4 Context: Incidents & Workflow

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Operators, Technicians, and Admins move an incident through the full state machine, see the severity banner for UNSAFE results, and resolve or reopen with a full audit trail. The 4-column severity-mixed Kanban is the day-to-day surface; the underlying 7-state machine governs transitions and remains auditable. Epic 4 also owns the `Notification` row writer and the card-action-affordance contract that Epic 2's read-only incident preview consumes.

## Stories

- Story 4.1: Card Action Affordance Contract (type contract; component deferred to 4.4)
- Story 4.2: Incident State Machine Implementation (7 states + REOPENED; server-enforced transitions)
- Story 4.3: Kanban Column Projection (derived projection; no DB state for column)
- Story 4.4: Incident Detail Page (header + timeline + attachments + action buttons)
- Story 4.5: Acknowledge Flow (Operator one-click; SLA starts)
- Story 4.6: Assign Technician + INSPECTING Transition
- Story 4.7: Submit Result (SAFE / UNSAFE / MONITORING)
- Story 4.8: Sticky SeverityBanner + RBAC (UNSAFE → 24h banner / until ack)
- Story 4.9: Notification Writer (writer + schema; view side is Epic 5)
- Story 4.10: NotificationBell Dropdown
- Story 4.11: Reopen Path (Admin critical comment)
- Story 4.12: Technician-Filtered Kanban
- Story 4.13: Attachments

## Requirements & Constraints

- State machine is server-enforced (Story 4.2). Every transition writes an `IncidentEvent` row with `actor_user_id`, type, payload, `created_at`.
- Invalid transitions return 409 `invalid_state_transition` and write an `AuditLog` row with `event: __invalid_transition_attempt`.
- 4-column Kanban is a DERIVED projection over state + severity — never persisted on the Incident row.
- Action slots on IncidentCard are derived from `incident.state` + viewer role, NEVER from a column name. Slot derivation lives in `@surakkha/web/components/IncidentCard.types` (Story 4.1).
- Real-time recompute: the Kanban listens for `incident:state_changed` socket events and updates column placement without re-fetch.
- RBAC enforcement at every transition (Operator acknowledges, Technician submits result, Admin reopens).
- Audit trail: every transition is an `IncidentEvent`; every denied attempt is an `AuditLog` row.

## Technical Decisions

- State enum lives in `@surakkha/shared/incident` (`IncidentStateSchema`). One source of truth — no epic renumbers or renames a state.
- `IncidentPayloadSchema` (shared) is the wire-row type; backend Prisma row → zod-validated → frontend consumes.
- Transition function `transition(incident, action, actor)` lives in `packages/api/src/incidents/transitions.ts` (pure) + `transitionHelpers.ts` (DB + broadcast side effects). All in one `$transaction` for atomicity.
- `projectKanbanColumn(state, severity)` lives in `@surakkha/shared/incident` (PREFERRED over web-side projection so api + web share the source of truth). Returns `KanbanColumn = "OPEN_CRITICAL" | "OPEN_WARNING" | "ACKNOWLEDGED" | "RESOLVED"`.
- Socket events: `incident:state_changed` (post-commit) + `incident:opened` (alert→incident auto-create). Emitted on `device:<id>` and `incident:<id>` rooms.
- IncidentEvent audit type enum mirrors the ActionVerb enum 1:1 + adds `invalid_transition_attempt` for the rejected path.

## UX & Interaction Patterns

- UX-DR-9: 4-column severity-mixed Kanban — columns are "Open · Critical", "Open · Warning", "Acknowledged", "Resolved". States `INSPECTING`, `SAFE`, `UNSAFE`, `MONITORING`, `REOPENED` map onto the existing columns (per the projection).
- UX-DR-5: Sticky SeverityBanner (UNSAFE → 24h or until acknowledged) — owner is Story 4.8.
- UX-DR-14: Technician-filtered Kanban (Technician sees only their own assigned incidents) — owner is Story 4.12.
- Card affordances: acknowledge / assign / submit-result / resolve / reopen — slot derivation owned by Story 4.1 types module.

## Cross-Story Dependencies

- 4.3 consumes 4.1 (slot types are independent; 4.3 does not render `<IncidentCard />` itself — it renders a column container).
- 4.3 depends on 4.2's `incident:state_changed` socket event for real-time recompute.
- 4.4 + 4.5/4.6/4.7/4.11 depend on 4.3's column projection (the detail page reads from the same `projectKanbanColumn`).
- 4.8 (SeverityBanner) depends on the `UNSAFE` projection rule (already in shared).
- 4.9 (Notification writer) is independent of the Kanban — it writes to `Notification` rows on `incident:state_changed`.
