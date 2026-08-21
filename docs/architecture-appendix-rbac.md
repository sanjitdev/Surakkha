# Surakkha — RBAC Matrix (Architecture Appendix)

> **Purpose.** Lock the full role × action × resource matrix for v1 so that `packages/api/src/middleware/authorize.ts` and every handler test have one canonical, machine-readable authority source.
>
> **Source of truth.** The machine-readable matrix lives in
> `packages/shared/src/rbac.ts` as the `RBAC_MATRIX` typed constant. The
> tables below are the prose mirror of that constant — every cell here
> corresponds to exactly one entry there.
>
> **Drift detection.** `pnpm lint:rbac` (and therefore `pnpm lint`) reads the
> Action enum from `rbac.ts` and fails CI when any handler file under
> `packages/api/src/**` references an action literal that is not in the
> matrix. Story 1.1 closes the loop by adding this lint.
>
> Source: Story 1.1 (`_bmad-output/planning-artifacts/epics.md` §1.1) + architecture §8.3 (RBAC enforcement contract).

---

## How to read this matrix

| Column         | Meaning                                                                                                              |
|----------------|----------------------------------------------------------------------------------------------------------------------|
| **Role**       | The subject's role: **Admin**, **Operator**, **Technician**, **Viewer**.                                            |
| **Action**     | The verb: `read`, `create`, `update`, `delete`, `acknowledge`, `assign`, `submit_result`, `resolve`, `reopen`, `export`, `manage` (RBAC matrix + user CRUD), `drive` (simulator control), `acknowledge_banner` (SeverityBanner dismiss). |
| **Resource**   | The target: `Device`, `Reading`, `Alert`, `Incident`, `Rule` (threshold), `User`, `School`, `AuditLog`, `Notification`, `Simulator`, `SeverityBanner`. |
| **Grant**      | `yes` (allowed) or `no` (denied — returns 403). Every grant is explicit; no implicit "Admin can do everything." |
| **Note**       | Optional clarification, especially for Technician ownership rules.                                                   |

The matrix is **flat** — every (role, action, resource) tuple gets one row. There are no wildcard grants. Negative tests in Story 1.8 verify every `no` cell.

---

## The matrix

### Read actions

| Role       | Action | Resource        | Grant | Note                                                            |
|------------|--------|-----------------|-------|-----------------------------------------------------------------|
| Admin      | read   | Device          | yes   |                                                                 |
| Operator   | read   | Device          | yes   |                                                                 |
| Technician | read   | Device          | yes   |                                                                 |
| Viewer     | read   | Device          | yes   | Read-only.                                                      |
| Admin      | read   | Reading         | yes   |                                                                 |
| Operator   | read   | Reading         | yes   |                                                                 |
| Technician | read   | Reading         | yes   |                                                                 |
| Viewer     | read   | Reading         | yes   |                                                                 |
| Admin      | read   | Alert           | yes   |                                                                 |
| Operator   | read   | Alert           | yes   |                                                                 |
| Technician | read   | Alert           | yes   |                                                                 |
| Viewer     | read   | Alert           | yes   |                                                                 |
| Admin      | read   | Incident        | yes   |                                                                 |
| Operator   | read   | Incident        | yes   |                                                                 |
| Technician | read   | Incident        | yes   | Only `Incident.assignee_user_id == self.id`. See negative test 4. |
| Viewer     | read   | Incident        | yes   | Read-only.                                                      |
| Admin      | read   | Rule            | yes   |                                                                 |
| Operator   | read   | Rule            | yes   |                                                                 |
| Technician | read   | Rule            | yes   |                                                                 |
| Viewer     | read   | Rule            | yes   |                                                                 |
| Admin      | read   | AuditLog        | yes   |                                                                 |
| Operator   | read   | AuditLog        | no    | Operator must not see the audit log. Negative test 1.           |
| Technician | read   | AuditLog        | no    | Negative test 1.                                                |
| Viewer     | read   | AuditLog        | no    | Negative test 1.                                                |
| Admin      | read   | Notification    | yes   |                                                                 |
| Operator   | read   | Notification    | yes   | Limited to notifications surfaced via the bell.                 |
| Technician | read   | Notification    | yes   |                                                                 |
| Viewer     | read   | Notification    | no    |                                                                 |
| Admin      | read   | User            | yes   |                                                                 |
| Operator   | read   | User            | no    |                                                                 |
| Technician | read   | User            | no    |                                                                 |
| Viewer     | read   | User            | no    |                                                                 |
| Admin      | read   | School          | yes   |                                                                 |
| Operator   | read   | School          | yes   |                                                                 |
| Technician | read   | School          | yes   |                                                                 |
| Viewer     | read   | School          | yes   |                                                                 |

### Write actions

| Role       | Action          | Resource        | Grant | Note                                                                 |
|------------|-----------------|-----------------|-------|----------------------------------------------------------------------|
| Admin      | create          | Device          | yes   | Onboarding a new sensor.                                             |
| Operator   | create          | Device          | no    |                                                                      |
| Technician | create          | Device          | no    |                                                                      |
| Viewer     | create          | Device          | no    |                                                                      |
| Admin      | update          | Device          | yes   |                                                                      |
| Operator   | update          | Device          | no    |                                                                      |
| Technician | update          | Device          | no    |                                                                      |
| Viewer     | update          | Device          | no    |                                                                      |
| Admin      | delete          | Device          | yes   |                                                                      |
| Operator   | delete          | Device          | no    |                                                                      |
| Technician | delete          | Device          | no    |                                                                      |
| Viewer     | delete          | Device          | no    |                                                                      |
| Admin      | create          | Reading         | no    | The simulator + real devices write; human users do not.              |
| Operator   | create          | Reading         | no    |                                                                      |
| Technician | create          | Reading         | no    |                                                                      |
| Viewer     | create          | Reading         | no    |                                                                      |
| Admin      | create          | Alert           | no    | The rules engine creates alerts.                                     |
| Operator   | create          | Alert           | no    |                                                                      |
| Technician | create          | Alert           | no    |                                                                      |
| Viewer     | create          | Alert           | no    |                                                                      |
| Admin      | acknowledge     | Alert           | yes   |                                                                      |
| Operator   | acknowledge     | Alert           | yes   |                                                                      |
| Technician | acknowledge     | Alert           | no    | Technicians do not own alerts.                                       |
| Viewer     | acknowledge     | Alert           | no    |                                                                      |
| Admin      | create          | Incident        | no    | Incidents are auto-created by the rules engine.                      |
| Operator   | create          | Incident        | no    | Negative test 2 — Viewer attempting this returns 403.                |
| Technician | create          | Incident        | no    |                                                                      |
| Viewer     | create          | Incident        | no    |                                                                      |
| Admin      | acknowledge     | Incident        | yes   |                                                                      |
| Operator   | acknowledge     | Incident        | yes   |                                                                      |
| Technician | acknowledge     | Incident        | no    |                                                                      |
| Viewer     | acknowledge     | Incident        | no    |                                                                      |
| Admin      | assign          | Incident        | yes   |                                                                      |
| Operator   | assign          | Incident        | yes   |                                                                      |
| Technician | assign          | Incident        | no    |                                                                      |
| Viewer     | assign          | Incident        | no    |                                                                      |
| Admin      | submit_result   | Incident        | no    | The Technician submits the inspection result.                        |
| Operator   | submit_result   | Incident        | no    |                                                                      |
| Technician | submit_result   | Incident        | yes   | Only on assigned incidents.                                          |
| Viewer     | submit_result   | Incident        | no    |                                                                      |
| Admin      | resolve         | Incident        | yes   |                                                                      |
| Operator   | resolve         | Incident        | yes   |                                                                      |
| Technician | resolve         | Incident        | no    |                                                                      |
| Viewer     | resolve         | Incident        | no    |                                                                      |
| Admin      | reopen          | Incident        | yes   | Admin-only via critical comment. Story 4.11.                        |
| Operator   | reopen          | Incident        | no    |                                                                      |
| Technician | reopen          | Incident        | no    |                                                                      |
| Viewer     | reopen          | Incident        | no    |                                                                      |
| Admin      | update          | Rule            | yes   |                                                                      |
| Operator   | update          | Rule            | no    |                                                                      |
| Technician | update          | Rule            | no    |                                                                      |
| Viewer     | update          | Rule            | no    |                                                                      |
| Admin      | delete          | Rule            | yes   | Soft-delete via `is_active: false`.                                 |
| Operator   | delete          | Rule            | no    |                                                                      |
| Technician | delete          | Rule            | no    |                                                                      |
| Viewer     | delete          | Rule            | no    |                                                                      |

### Admin + simulator actions

| Role       | Action            | Resource       | Grant | Note                                                            |
|------------|-------------------|----------------|-------|-----------------------------------------------------------------|
| Admin      | manage            | User           | yes   | Create / update / delete users.                                 |
| Operator   | manage            | User           | no    |                                                                  |
| Technician | manage            | User           | no    |                                                                  |
| Viewer     | manage            | User           | no    |                                                                  |
| Admin      | manage            | School         | yes   | Create / update schools.                                         |
| Operator   | manage            | School         | no    |                                                                  |
| Technician | manage            | School         | no    |                                                                  |
| Viewer     | manage            | School         | no    |                                                                  |
| Admin      | export            | Reading        | yes   | CSV export of 30 days.                                           |
| Operator   | export            | Reading        | yes   |                                                                  |
| Technician | export            | Reading        | no    | Negative test 6.                                                |
| Viewer     | export            | Reading        | no    | Negative test 6.                                                |
| Admin      | drive             | Simulator      | yes   | `/admin/simulator` start / pause / scenario. Story 2.5.          |
| Operator   | drive             | Simulator      | no    | Negative test 5.                                                |
| Technician | drive             | Simulator      | no    |                                                                  |
| Viewer     | drive             | Simulator      | no    |                                                                  |
| Admin      | acknowledge_banner | SeverityBanner | yes   | Dismiss the sticky Critical banner. Story 4.8.                  |
| Operator   | acknowledge_banner | SeverityBanner | no    | Banner is Admin-only; non-Admin sees no banner even when UNSAFE. |
| Technician | acknowledge_banner | SeverityBanner | no    |                                                                  |
| Viewer     | acknowledge_banner | SeverityBanner | no    |                                                                  |

### Cross-cutting

| Role       | Action | Resource        | Grant | Note                                                            |
|------------|--------|-----------------|-------|-----------------------------------------------------------------|
| Admin      | read   | SeverityBanner  | yes   | Banner state is served to Admin sessions only.                  |
| Operator   | read   | SeverityBanner  | no    | Endpoint returns 403 for non-Admin tokens. Negative test 7.    |
| Technician | read   | SeverityBanner  | no    | Negative test 7.                                                |
| Viewer     | read   | SeverityBanner  | no    | Negative test 7.                                                |

---

## Coverage summary

| Resource        | Actions                       | Cells |
|-----------------|-------------------------------|-------|
| Device          | read, create, update, delete  | 16    |
| Reading         | read, create, export          | 12    |
| Alert           | read, create, acknowledge     | 12    |
| Incident        | read, create, acknowledge, assign, submit_result, resolve, reopen | 28 |
| Rule            | read, update, delete          | 12    |
| User            | read, manage                  | 8     |
| School          | read, manage                  | 8     |
| AuditLog        | read                          | 4     |
| Notification    | read                          | 4     |
| Simulator       | drive                         | 4     |
| SeverityBanner  | read, acknowledge_banner      | 8     |
| **Total**       |                               | **116 cells** |

(13 actions × 4 roles = 52 base cells; the matrix above expands each resource × action pair into 4 cells, giving 116 total. Every cell is `yes` or `no`.)

---

## Negative test cases (Story 1.8)

The matrix is enforced by automated tests. At least 10 negative cases run in CI; the canonical list:

| #  | Scenario                                                                                          | Expected response                  |
|----|----------------------------------------------------------------------------------------------------|------------------------------------|
| 1  | Operator, Technician, or Viewer attempts `GET /audit`.                                              | 403 forbidden; audit row written.  |
| 2  | Viewer attempts `POST /incidents` with a valid payload.                                             | 403 forbidden; no row created.     |
| 3  | Technician attempts `GET /incidents/{id}` for an incident assigned to another Technician.            | 403 forbidden; not in their list.  |
| 4  | Viewer attempts `POST /incidents/{id}/submit_result`.                                              | 403 forbidden.                     |
| 5  | Operator attempts `POST /admin/simulator/{device_id}/scenario`.                                    | 403 forbidden.                     |
| 6  | Technician or Viewer attempts `GET /devices/{device_id}/export.csv`.                                | 403 forbidden.                     |
| 7  | Operator, Technician, or Viewer attempts `GET /banners/active`.                                     | 403 forbidden; no banner rendered. |
| 8  | Viewer attempts `POST /admin/thresholds/{rule_id}` to edit a rule.                                  | 403 forbidden; no row updated.     |
| 9  | Operator attempts `POST /admin/users` to create a user.                                             | 403 forbidden.                     |
| 10 | Technician attempts to acknowledge an incident they are not assigned to.                            | 403 forbidden.                     |

Test file: `__tests__/rbac.negative.spec.ts`.

---

## How to update this matrix

When a v2 change adds a new action, role, or resource:

1. Add the new cell(s) to this matrix.
2. Re-export the matrix as a typed TypeScript constant from `packages/shared/src/rbac.ts`.
3. Add the corresponding negative case(s) to `__tests__/rbac.negative.spec.ts`.
4. Update Story 1.8's "Covers:" line.
5. Note the change in `CHANGELOG.md` under the v2 release.

When a v1 cell flips from `no` to `yes` (rare; usually a permission expansion):

1. Update the cell.
2. Add a positive test that exercises the new grant.
3. Update this document's note column with the rationale.
4. Update `CHANGELOG.md`.

---

## Implementation pointers

- **`packages/shared/src/rbac.ts`** exports `Role`, `Action`, `Resource`, and `RBAC_MATRIX: Record<Role, Record<Action, Record<Resource, boolean>>>`.
- **`packages/api/src/middleware/authorize.ts`** reads the matrix and either calls `next()` or returns `403 forbidden` with body `{ error: "forbidden", required_role: "<role>" }`.
- **Every failed attempt** writes an `AuditLog` row with `actor_user_id`, `attempted_action`, `resource`, `outcome: "denied"`, and `ip`.
- **No handler bypasses the middleware** without an explicit `// PUBLIC` comment that is CI-lint-checked.