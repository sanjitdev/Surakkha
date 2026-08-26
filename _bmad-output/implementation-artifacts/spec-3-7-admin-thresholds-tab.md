# Story 3.7 — `/admin/thresholds` Admin Tab

**Status:** done
**Epic:** 3 — Rules & Alerts
**Covers:** PRD-F-21, US-9, AR-9, I-9
**Review loop:** 1 (no loopback required; mirror of `simulator` template)
**Shipped:** 2026-08-26 (see Epic 3 sweep commits)

---

## Context

Operators need a UI to manage per-device alerting thresholds without touching the DB or hand-editing SQL. Story 3.7 wires the `/admin/thresholds` admin tab end-to-end: a backend router with list / create / edit-via-new-version / activate endpoints, plus a React page that mirrors the simulator admin tab's UX.

The existing `Rule` model already supports edit-via-new-version: each `Rule` row has `version Int @default(1)` and `isActive Bool @default(true)`, with `@@unique([deviceId, metric, operator, threshold, version])` so two rules on the same `(deviceId, metric, operator, threshold)` can coexist at different versions as long as their `version` differs. Editing means "create a new Rule row at `old.version + 1` and flip the old row's `isActive` to false". Re-activation flips a specific version's `isActive` back to true.

This story adds zero schema columns — `Rule` is unchanged. 3.7 only writes through the existing CRUD surface.

## User Story

> As an Admin, I want a `/admin/thresholds` page that lists, creates, edits, and activates alerting thresholds for each device — so I can tune the operator's alerting behavior without going through the API by hand.

## Acceptance Criteria

| AC   | Description                                                                                                                                                                                                                                                                                                          | Pin                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| AC1  | `GET /admin/thresholds/rules?limit=50&cursor=<id>&activeOnly=true` returns a paginated list of `Rule` rows, newest first. `activeOnly=false` (default) returns both active and inactive rows for the history panel.                                                                                                  | live test (router spec) + curl           |
| AC2  | `POST /admin/thresholds/rules` creates a new `Rule` at `version: 1, isActive: true` with the body's `deviceId`, `metric`, `operator`, `threshold`, `severity`, `ruleType`, `minDurationSeconds`, `hysteresisSeconds`, `createdBy`. The body's Zod schema rejects unknown fields; missing required fields return 400. | live test                                |
| AC3  | `PATCH /admin/thresholds/rules/:id` with `{ supersede: true, ...newFields }` creates a new `Rule` row at `old.version + 1, isActive: true` and flips the old row's `isActive` to `false`. The response includes both the new and old rows.                                                                           | live test                                |
| AC4  | `PATCH /admin/thresholds/rules/:id` with `{ activate: false }` flips the row's `isActive` to `false` without creating a new version.                                                                                                                                                                                 | live test                                |
| AC5  | `PATCH /admin/thresholds/rules/:id/activate` flips a specific version's `isActive` to `true` (idempotent: re-flipping returns the same row, no new version).                                                                                                                                                         | live test                                |
| AC6  | RBAC: `update Rule` is Admin-only (the matrix cell that governs rule edits; the matrix has no `create × Rule` so the POST endpoint also gates on `update × Rule`). Operator / Technician / Viewer → 403.                                                                                                             | `rbac.negative.spec.ts` extended entries |
| AC7  | The `/admin/thresholds` route renders a table of active rules with columns `deviceId, metric, operator, threshold, severity, version`. A history toggle reveals inactive versions of the same `(deviceId, metric, operator, threshold)` key.                                                                         | RTL page test                            |
| AC8  | Each rule row has an "Edit" button that opens a modal pre-filled with the rule's current fields. Submitting the modal sends `PATCH /admin/thresholds/rules/:id` with `{ supersede: true, ...changes }` and refetches the list on success.                                                                            | RTL test                                 |
| AC9  | Each rule row has an "Activate" / "Deactivate" button that sends the corresponding `PATCH` and refetches. Failures roll back optimistic UI updates and show a toast.                                                                                                                                                 | RTL test                                 |
| AC10 | The page mounts inside the existing `RbacRoute` admin shell at `/admin/thresholds`, replacing the `PageStub` placeholder. Non-admin users see the existing 403 redirect.                                                                                                                                             | visual smoke + RTL `RbacRoute` test      |

## Out of scope (deferred to other stories)

- Story 4.6: bulk import/export of rule sets.
- Story 5.x: `AuditLog` writes for rule edits (Epic 5 owns the audit table).
- Multi-version activate in one request (re-activate ALL versions of a `(deviceId, metric, operator, threshold)` key — out of scope; 3.7 activates one version per request).
- Soft-delete (`deletedAt`) on `Rule` — out of scope; 3.7 uses `isActive: false` as the "deleted" state.
- The simulator's frame-injection UX (Epic 5 owns a separate "test rule" affordance).

## Code Map

| File                                                                         | Change                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/rule.ts`                                                | MODIFY — add Zod parse schemas: `RuleRowSchema`, `RuleListResponseSchema`, `RuleCreateRequestSchema`, `RulePatchRequestSchema`, `RuleActivateRequestSchema`, plus inferred types. Re-export from `packages/shared/src/index.ts`.                                                       |
| `packages/api/src/admin/thresholdsRouter.ts`                                 | NEW — `buildThresholdsRouter(deps): Router`. Routes: `GET /admin/thresholds/rules`, `POST /admin/thresholds/rules`, `PATCH /admin/thresholds/rules/:id`, `PATCH /admin/thresholds/rules/:id/activate`. RBAC Admin-only via `authorize({ action: "manage", resource: "Rule" }, audit)`. |
| `packages/api/src/admin/thresholdsRouter.spec.ts`                            | NEW — RTL+server tests covering happy path + each error path + RBAC denial.                                                                                                                                                                                                            |
| `packages/api/src/index.ts`                                                  | MODIFY — mount `thresholdsRouter` at `/admin/thresholds` post-authenticate.                                                                                                                                                                                                            |
| `packages/api/src/__tests__/rbacNegativeRouter.ts` + `rbac.negative.spec.ts` | MODIFY — append 3 entries: Operator/Technician/Viewer → `update Rule` → 403.                                                                                                                                                                                                           |
| `packages/web/src/admin/thresholds/ThresholdsPage.tsx`                       | NEW — admin page: rule table + history toggle + edit modal + activate/deactivate buttons. Mirrors `simulator/SimulatorPage.tsx` structure.                                                                                                                                             |
| `packages/web/src/admin/thresholds/useThresholds.ts`                         | NEW — TanStack Query hooks: `useThresholds(activeOnly)`, `useCreateThreshold()`, `useUpdateThreshold()`, `useDeactivateThreshold()`, `useActivateThreshold()`.                                                                                                                         |
| `packages/web/src/admin/thresholds/ThresholdsPage.spec.tsx`                  | NEW — RTL tests for page branches + form interactions.                                                                                                                                                                                                                                 |
| `packages/web/src/main.tsx`                                                  | MODIFY — swap the `PageStub` body for `<ThresholdsPage />`.                                                                                                                                                                                                                            |

## Risks / sharp edges

- **`supersede` is not idempotent**: re-sending the same `PATCH { supersede: true }` creates a new version each time. The response includes the new row's `version`, and the spec pins this with an AC3 test that drives 2 successive supersedes and asserts `version` increments by 1 each time.
- **`@@unique([deviceId, metric, operator, threshold, version])`**: the unique key includes `version`, so two rules on the same `(deviceId, metric, operator, threshold)` can coexist at different versions. A future change that drops `version` from the unique constraint would break the `supersede` flow — no live test pins this directly, but the AC3 test asserts the new row's `version === old.version + 1` and that both rows persist.
- **RBAC matrix**: the `update Rule` cell (`Admin.update.Rule = Y`, all others `N`) is the gate. The existing simulator router mirrors this for `drive Simulator`; 3.7 follows the same Admin-only pattern. If a future release adds a Technician role that can edit thresholds, the spec would need a separate update — this is out of scope.
- **Frontend form**: `useState`-controlled form (no `react-hook-form` dependency). The submit handler calls the PATCH and refetches on success; on failure, the optimistic UI rolls back and a toast surfaces the error.

## Implementation notes (locked)

- The shared schemas in `packages/shared/src/rule.ts` are the wire contract for the new endpoints. The api router Zod-parses the body using these schemas; the frontend hook also imports them for client-side validation.
- The `supersede` flow is implemented as: `prisma.$transaction(async (tx) => { ... })` wrapping (1) the old row's `update({ isActive: false })` and (2) the new row's `create({ version: old.version + 1, isActive: true })`. The atomicity guarantee means a partial supersede (e.g. old deactivated, new never created) cannot happen.
- The activate endpoint is a single-row `update({ isActive: true })` — no transaction needed (no multi-row write).
- The frontend's history toggle filters by `(deviceId, metric, operator, threshold)` key in-memory (the list endpoint returns all versions; the toggle is purely client-side).
- The `RbacRoute` admin shell already handles the 403 redirect for non-admin users; 3.7 mounts `<ThresholdsPage />` as the body and lets the shell's guard do the RBAC work.

## Verification (after implementation)

- `pnpm -F @surakkha/api test` — green; the new `thresholdsRouter.spec.ts` exercises AC1-AC5 + RBAC denial.
- `pnpm -F @surakkha/web test` — green; `ThresholdsPage.spec.tsx` exercises AC7-AC10.
- `pnpm -r --if-present test` — every package green; `rbac.negative.spec.ts` extended entries green.
- `pnpm -r typecheck` — no signature drift on `Rule` types or any cross-package types.
- Manual smoke: boot api + simulator, navigate to `/admin/thresholds`, create a rule for `device-1` + `ph` + `lt` + `6.5`, edit it via the modal (supsersede), observe the new version row + old version's `isActive: false` flip in the table; activate the old version, observe it returns to the active table.
