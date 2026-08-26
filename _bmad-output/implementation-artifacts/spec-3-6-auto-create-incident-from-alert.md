# Story 3.6 — Auto-Create Incident from Warning/Critical Alert

**Status:** done
**Epic:** 3 — Rules & Alerts
**Covers:** PRD-F-16, US-8, AR-7, I-8
**Review loop:** 1 (no loopback required; surface is 1 file extension + 1 helper + 1 hook call)
**Shipped:** 2026-08-26 (see Epic 3 sweep commits)

---

## Context

When the rule engine fires an Alert of severity `warning` or `critical`, the platform must auto-create an `Incident` row so the operator's Kanban (Epic 4) has a work item to acknowledge. Info-severity alerts do NOT create incidents (per PRD §5.3 "info is informational only").

The auto-create MUST land in the same `$transaction` as the Alert row write — atomicity is the spec's invariant. The P2002 race-catch path (a second writer losing the partial-index race) MUST NOT create an incident.

The `Incident` model already exists in `packages/db/prisma/schema.prisma` with 5 columns (`id, deviceId, severity, metric, value, openedAt`). 3.6 adds zero columns. Epic 4 (Story 4.2) adds the state machine; 3.6 only writes one row per OPEN alert with warning/critical severity.

## User Story

> As an Operator, when a sensor breaches a warning or critical threshold, I want an Incident to appear on my Kanban within the existing 3-second SLA — so I can acknowledge and assign without manual triage.

## Acceptance Criteria

| AC  | Description                                                                                                                                                                                                                    | Pin                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| AC1 | When `applyOpenTransition` commits an Alert of severity `warning` or `critical`, an `Incident` row is auto-created in the same `$transaction` as the Alert row.                                                                | live test (sibling to `alert-debounce.spec.ts`) |
| AC2 | Info-severity alerts (`severity === "info"`) do NOT create an Incident.                                                                                                                                                        | live test (sibling)                             |
| AC3 | On the P2002 race-catch path (two concurrent opens losing the partial-index race), the losing side does NOT create a duplicate Incident.                                                                                       | live test + `applyTransition.ts` flow           |
| AC4 | The Incident row is observable via `GET /api/incidents/recent` with the alert's `deviceId`, `severity`, `metric`, `value` (the alert's triggering reading), and `openedAt = alert.openedAt`.                                   | live test reads both tables                     |
| AC5 | The auto-create does NOT emit a separate socket event (`incident:opened` is out of scope — Epic 4 owns incident lifecycle emits). The Alert's `alert:opened` emit (Story 3.4 / Story 3.5) is the only socket side effect.      | code review + `applyTransition.ts:189`          |
| AC6 | Atomicity: if `tx.incident.create` throws, the Alert row also rolls back (transaction-wide rollback). The existing `$transaction` wrapper provides this — the helper just calls `tx.incident.create` inside the same callback. | live test asserts no orphan alert               |

## Out of scope (deferred to other stories)

- Story 3.5 wire schemas for the Alert lifecycle (separate from 3.6's write path).
- Story 4.2: `Incident.state` enum, `assignedTo`, `acknowledgedAt`, `closedAt`, `IncidentEvent` audit table.
- Story 4.5: `Incident.acknowledge` endpoint.
- The `incident:opened` socket event — Epic 4 owns incident-side emits.
- Deduplication across multiple alerts that auto-create Incidents on the same `(deviceId, metric)` key — Epic 4's `Incident.state` enum + reopen path owns this.

## Code Map

| File                                             | Change                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/rules/incidentFromAlert.ts`    | NEW — pure helper: `shouldCreateIncident(severity)` + `buildIncidentPayload(alert)`.                                                                                                                                                                                                                        |
| `packages/api/src/rules/alertStateRepository.ts` | MODIFY — add `incident.create` slice to the `AlertStateRepository` interface (lives in the same `$transaction` as `alert.create`). Adapter `resolveAlertStateRepository` gains one method.                                                                                                                  |
| `packages/api/src/rules/applyTransition.ts`      | MODIFY — inside `applyOpenTransition`'s `$transaction` callback, after `tx.alert.create` succeeds, call `tx.incident.create(buildIncidentPayload(...))` when `severity !== "info"`. The P2002 catch path (lines 130-141) returns BEFORE reaching this point — incident auto-create is skipped on race loss. |
| `packages/api/src/index.ts`                      | No change needed — `resolveAlertStateRepository(client)` already forwards every method via `client as any`; the new `incident.create` slice works automatically.                                                                                                                                            |
| `packages/db/prisma/alert-debounce.spec.ts`      | MODIFY — add a sibling `describe("Story 3.6 — auto-create Incident (AC1-AC4, AC6)", ...)` block with 4 live tests: warning creates, critical creates, info does NOT create, P2002 race suppresses the second writer's incident.                                                                             |

## Risks / sharp edges

- **Severity is a free-form `String` on the Alert model (NOT a Prisma enum)** — the spec's `info | warning | critical` enum is enforced at the wire boundary (Zod) and at the Rule schema (Prisma enum), but `Severity` columns on `Alert` and `Incident` are typed `String`. The helper uses `severity === "warning" || severity === "critical"` (strict equality). A future drift on the wire schema would surface as an unknown-severity row whose Incident is NOT auto-created — the test pins the exact strings.
- **The P2002 race path**: if two api processes race on the same `(deviceId, metric, severity)` key, only ONE wins the `alert.create`. The losing process catches P2002, returns from the `$transaction` callback, and never reaches the incident-create code. The AC3 test pins this with two concurrent `tx.alert.create` calls.
- **Atomicity**: the existing `deps.alertState.$transaction` wraps the entire callback. If `tx.incident.create` throws, the transaction rolls back; the alert row is not committed; the boot log shows the error. No orphan alerts.

## Implementation notes (locked)

- The helper file `incidentFromAlert.ts` is pure (no Prisma imports). It takes the alert row shape (from `tx.alert.create`'s return value) and returns the incident-write payload.
- The `$transaction` callback in `applyTransition.ts:101` gets ONE new line between the `ruleDebounceState.upsert` and the assignment `alertId = createdAlertId`:
  ```typescript
  if (transition.severity === "warning" || transition.severity === "critical") {
    await tx.incident.create({
      data: buildIncidentPayload({
        deviceId,
        severity: transition.severity,
        metric: transition.metric,
        value: metricValue,
        openedAt: transition.openedAt,
      }),
    });
  }
  ```
- The `tx` parameter type already extends `AlertStateRepository`. Adding the `incident.create` slice to the interface is a back-compat change — existing test stubs need a no-op `incident.create` mock to satisfy the new method.

## Verification (after implementation)

- `pnpm -F @surakkha/db test` — green; the new sibling `describe` block exercises AC1-AC4 + AC6 against live Postgres.
- `pnpm -F @surakkha/api test` — green; the existing `hooks.spec.ts` (and other rule tests) need a no-op `incident.create` on the test rig so the new method on the interface is satisfied.
- `pnpm -r typecheck` — no signature drift.
- Manual smoke (optional): boot api + simulator, trigger a warning scenario, query `psql -c 'SELECT * FROM "Incident"'` to see the auto-created row within 1 frame.
