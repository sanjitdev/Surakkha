---
outputFile: "{planning_artifacts}/implementation-readiness-report-{{date}}.md"
stepsCompleted:
  [
    step-01-document-discovery,
    step-02-prd-analysis,
    step-03-epic-coverage-validation,
    step-04-ux-alignment,
    step-05-epic-quality-review,
    step-06-final-assessment,
  ]
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-20
**Project:** Surakkha

## Document Inventory (Step 1)

### PRD Documents

- Whole: `docs/Surakkha-PRD.md`
- Sharded: None

### Architecture Documents

- Whole: `docs/architecture.md`
- Sharded: None

### Epics & Stories Documents

- Whole: None
- Sharded: None

### UX Design Documents

- Whole: None
- Sharded: None

### Project context

- Project knowledge root: `docs/`
- BMAD config: `_bmad/bmm/config.yaml`
- `project_knowledge` already points to `docs/`; PRD and architecture are stored there rather than duplicated into the planning-artifacts directory
- Known duplication: the PRD was written before the BMAD directory was created, so the BMAD copy of the PRD is the `docs/Surakkha-PRD.md` file itself. This is acceptable because the BMAD config binds `project_knowledge` to `docs/`

### Supplementary documents

- `docs/Surakkha-BRD.md` — Business Requirements Document
- `docs/Surakkha-idea-refined.md` — Decision log from the brainstorm
- `docs/Surakkha-water-monitoring-system-spec.md` — Original combined spec (historical, removed; the architecture file is the refactored version)
- `docs/Surakkha-water-monioring-system-idea.md` — Original brainstorm (historical)

## Critical Issues

- None. No duplicate whole vs sharded documents. The PRD and architecture are stored in the project knowledge directory because that is the BMAD config binding. The readiness report will read them from `docs/` directly.

## Known gaps

- Epics and Stories — missing; BMAD requires this before the readiness check can finish.
- UX Design — missing; the project ships a UI and UI acceptance is part of the 10-step demo, so the readiness check will flag it as a required next artifact.

## Files selected for assessment

- `docs/Surakkha-PRD.md` — product requirements
- `docs/architecture.md` — architecture and technical contract
- `docs/Surakkha-BRD.md` — cross-checked for traceability
- `docs/Surakkha-idea-refined.md` — cross-checked for decision rationale

## PRD Analysis (Step 2)

### Functional Requirements

The PRD inherits the BRD's 36 functional requirements unchanged. They are extracted below in BRD order.

| FR ID | Requirement                                                                                                                                                        | Source    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| FR-1  | Stable UUIDv4 device_id; persists across SIM/MAC changes                                                                                                           | BRD §8.1  |
| FR-2  | Telemetry frame schema (six metrics: ph, tds_ppm, turbidity_ntu, temp_c, chlorine_ppm, water_level_cm)                                                             | BRD §8.1  |
| FR-3  | Unknown fields ignored; missing required fields → 400                                                                                                              | BRD §8.1  |
| FR-4  | server_received_at separate from device ts; clock-skew exposed                                                                                                     | BRD §8.1  |
| FR-5  | Monotonic per-device seq counter; drop/reorder detection                                                                                                           | BRD §8.1  |
| FR-6  | Per-device JWT at transport layer (frame level unauthenticated)                                                                                                    | BRD §8.1  |
| FR-7  | WebSocket at /ingest/{device_id}                                                                                                                                   | BRD §8.2  |
| FR-8  | Short-lived per-device JWT, rotated on simulator start                                                                                                             | BRD §8.2  |
| FR-9  | Simulator reconnect with exponential backoff, 5K buffer, flush on reconnect                                                                                        | BRD §8.2  |
| FR-10 | Per-device rate cap 1/2s; bursts → 429                                                                                                                             | BRD §8.2  |
| FR-11 | JSON rules per device or global, versioned, audit-logged                                                                                                           | BRD §8.3  |
| FR-12 | Three rule types: instant, rate, absence                                                                                                                           | BRD §8.3  |
| FR-13 | Severity explicit per rule; defaults from §8.3.1 table                                                                                                             | BRD §8.3  |
| FR-14 | min_duration_seconds + hysteresis_seconds per (device, metric, severity)                                                                                           | BRD §8.3  |
| FR-15 | Threshold breach → Alert with severity, opened_at, acknowledged_at, cleared_at                                                                                     | BRD §8.4  |
| FR-16 | Warning/critical alerts auto-create incident                                                                                                                       | BRD §8.4  |
| FR-17 | Incident state machine with REOPENED branch                                                                                                                        | BRD §8.4  |
| FR-18 | UNSAFE → Critical notification banner, 24h or until acknowledged                                                                                                   | BRD §8.4  |
| FR-19 | Every state transition recorded in IncidentEvent                                                                                                                   | BRD §8.4  |
| FR-20 | RBAC enforced as (subject, action, resource) on every endpoint                                                                                                     | BRD §8.5  |
| FR-21 | Negative RBAC cases covered by tests                                                                                                                               | BRD §8.5  |
| FR-22 | JWT HS256, 8h expiry                                                                                                                                               | BRD §8.6  |
| FR-23 | Access + refresh tokens; refresh in httpOnly cookie                                                                                                                | BRD §8.6  |
| FR-24 | bcrypt cost 12                                                                                                                                                     | BRD §8.6  |
| FR-25 | Single JWT secret, no rotation in v1                                                                                                                               | BRD §8.6  |
| FR-26 | No SSO/MFA in v1 (v2 deferral)                                                                                                                                     | BRD §8.6  |
| FR-27 | UI-only notifications (toast + banner)                                                                                                                             | BRD §8.7  |
| FR-28 | /admin/notifications page listing recorded notifications                                                                                                           | BRD §8.7  |
| FR-29 | CSV export of 30 days of readings                                                                                                                                  | BRD §8.8  |
| FR-30 | All state changes / threshold changes / simulator events in audit log                                                                                              | BRD §8.8  |
| FR-31 | Aggregation cron: 30-day raw retention → 5-min mean/min/max                                                                                                        | BRD §8.9  |
| FR-32 | Hourly cron drives retention/aggregation                                                                                                                           | BRD §8.9  |
| FR-33 | Simulator is a separate Node process on the same wire contract                                                                                                     | BRD §8.10 |
| FR-34 | 6 default devices, 6 base scenarios including Offline (PRD notes 7 scenarios: Normal, RisingTDS, TurbiditySpike, ChlorineDrop, Offline, BatteryLow, RandomFailure) | BRD §8.10 |
| FR-35 | Simulator JWTs aud=simulator, telemetry:write scope                                                                                                                | BRD §8.10 |
| FR-36 | /admin/simulator Admin-only, emits \_\_simulator_event audit entries                                                                                               | BRD §8.10 |

**Total functional requirements: 36.**

### Non-Functional Requirements

| NFR ID | Category                  | Requirement                                                                 | Source |
| ------ | ------------------------- | --------------------------------------------------------------------------- | ------ |
| NFR-1  | Performance               | End-to-end alert latency <3s under 6-device load                            | BRD §9 |
| NFR-2  | Performance               | Dashboard input lag <100ms with 6 live devices at 1 reading / 2s            | BRD §9 |
| NFR-3  | Scalability (design)      | Single-process v1 supports 10–100 devices without redesign; not load-tested | BRD §9 |
| NFR-4  | Reliability               | Tolerate 60s disconnect mid-incident; Offline scenario exercises this       | BRD §9 |
| NFR-5  | Reliability               | Simulator buffer 5,000 readings without loss                                | BRD §9 |
| NFR-6  | Security                  | All endpoints enforce RBAC; JWT validated; bcrypt 12                        | BRD §9 |
| NFR-7  | Security (v2 deferred)    | Per-frame signing, JWKS/RS256, hash-chained audit                           | BRD §9 |
| NFR-8  | Usability                 | Reviewer 60-second comprehension from dashboard                             | BRD §9 |
| NFR-9  | Usability                 | School onboarding ≤5 minutes via UI                                         | BRD §9 |
| NFR-10 | Localisability (deferred) | English only; bn scaffold                                                   | BRD §9 |
| NFR-11 | Operability               | docker compose up + 5-min README                                            | BRD §9 |
| NFR-12 | Test coverage             | Backend 70% / frontend 50%; Playwright happy path                           | BRD §9 |
| NFR-13 | Maintainability           | Lint+format enforced; shared Zod schemas                                    | BRD §9 |
| NFR-14 | Compatibility             | Wire contract frozen behind version:1 header                                | BRD §9 |
| NFR-15 | Deployment                | Single Docker Compose with web, api, simulator, db services; Postgres 15    | BRD §9 |

**Total non-functional requirements: 15.**

### Additional Requirements and Constraints

#### User Stories (19)

- US-1 through US-4: Onboarding and configuration (Admin)
- US-5 through US-7: Live monitoring
- US-8 through US-12: Incident workflow
- US-13 through US-15: Permissions / RBAC
- US-16 and US-17: Reporting and audit
- US-18 and US-19: Demo and operator simulation

#### Acceptance Criteria (17)

The PRD inherits all 17 acceptance criteria from BRD §11, including:

- Onboarding SLA (≤5 minutes)
- Live monitoring SLA
- Alert latency <3s
- End-to-end workflow reproducibility
- RBAC negative cases
- All 14 routes reachable (now including /admin/notifications)
- Wire contract frozen behind version:1
- MetricDefinition registry seeded
- DHAKA-SCHOOL-023 demo reproducible in ≤15 minutes

#### Implicit constraints

- **Two-layer metric schema (BRD §10.1):** fixed six metrics for v1, MetricDefinition registry scaffolded and seeded for v2.
- **Single-process backend:** one Node process for api + ingestion + rules + alerts + workflow + cron (simulator separate). No Redis, no message queue, no Kubernetes.
- **Local deployment:** Docker Compose on a laptop only.
- **Demo reproducibility:** the 10-step BRD §13 walkthrough is the operational definition of v1 done.
- **Bangla-friendly typography:** Tailwind config registers a Bangla-capable font fallback stack now, so v2 translation is a content drop, not a refactor.
- **WHO/BSTI defaults:** the 9-row table in BRD §8.3.1 is the authoritative source for v1 default thresholds.

### PRD Completeness Assessment

**Strengths:**

- All 36 BRD FRs are carried forward unchanged; no requirement loss.
- All 15 BRD NFRs are carried forward unchanged; no requirement loss.
- MoSCoW prioritization covers all 51 items.
- The 14 P0 feature deep-dives cover the full demo surface area and use F-N identifiers for traceability.
- The 8-slice sequencing plan is concrete (days, deliverables, P0 features per slice).
- The 13-action RBAC matrix and 8 negative test cases are testable.
- The demo story is fully specified (10-step walkthrough).
- The architecture file carries the implementation contract that the PRD relies on, and the wire-contract/rule-engine/data-model pieces are now strict enough to be implemented by an AI coding agent without ambiguity.

**Gaps and risks identified:**

1. **FR-34 scenario count discrepancy.** BRD §8.10 says "6 base scenarios" but then lists 7 scenarios (`Normal`, `RisingTDS`, `TurbiditySpike`, `ChlorineDrop`, `Offline`, `BatteryLow`, `RandomFailure`). The PRD repeats both numbers inconsistently: BRD §8.10 says 6 but lists 7; PRD F-6 lists 7; PRD P0 entry for FR-34 says "7 scenarios including Offline." The architecture file (post-validation) specifies 7 scenarios as canonical. **Decision needed:** the 7-scenario list is canonical; "6 base scenarios" wording should be corrected to "7 base scenarios" in both BRD and PRD, or a deliberate cut should be made.

2. **Architecture RBAC appendix missing.** The architecture file references `docs/architecture-appendix-rbac.md` as the locked RBAC matrix but this file does not yet exist. The PRD's F-4 / F-5 describe the matrix but as text, not as the locked artefact the architecture calls for. This is a blocker for epics and stories generation.

3. **NFR-15 service-count wording.** NFR-15 says "three services: web, api, db" but the architecture defines four: web, api, db, simulator. The simulator runs in the same Docker Compose file. Wording correction needed.

4. **PRD open questions not yet resolved.** PRD §11 lists 5 open questions (Postgres schema, MetricDefinition lookup strategy, chart layout, required comments, attachment storage). These should be answered before epic generation; several are already resolved by the architecture file (ReadingAggregate table, RateCalculation model, etc.).

5. **F-13 default threshold completeness.** F-13 lists 6 default rules. BRD §8.3.1 ships 9 rules (including TDS ≥ 1000 critical, chlorine > 1.5 warning, water_level_cm < 20 warning). F-13 should be updated to match the canonical 9-row table.

6. **F-12 contact-user relationship.** F-12 references "contact user" but the data model now spells out the `School.contact_user_id` semantics in §5.

7. **No UX design document.** The PRD references screen layouts (F-7 mockup) but no formal UX artefact exists. This is a BMAD gap that the readiness check will flag in step 4 (UX alignment). Mitigation: the PRD's ASCII mockup and the 14-route table from architecture §11.2 can serve as a minimal UX contract until a fuller artefact is created.

8. **No epics and stories document.** This is the next BMAD blocker. The readiness check will halt after step 5 (epic-quality review) until this is resolved.

**PRD completeness verdict: Sufficient for epic generation, with the FR-34 scenario count and NFR-15 service count clarified, and the architecture RBAC appendix created.**

### Open cross-document inconsistencies to resolve

| #   | Issue                                        | Source                   | Required action                                                   |
| --- | -------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| 1   | FR-34 says "6 base scenarios" but lists 7    | BRD §8.10 + PRD P0 entry | Update to "7 base scenarios" in both documents                    |
| 2   | NFR-15 lists 3 services; architecture has 4  | BRD §9 + PRD             | Update NFR-15 wording to "four services: web, api, simulator, db" |
| 3   | F-13 lists 6 default rules; BRD §8.3.1 has 9 | PRD F-13 + BRD §8.3.1    | Update F-13 to mirror the canonical 9-row table                   |
| 4   | RBAC matrix reference missing                | architecture §8.3        | Create `docs/architecture-appendix-rbac.md`                       |
| 5   | `/admin/notifications` listed as route       | BRD §11.8                | Already corrected in previous pass                                |

## Epic Coverage Validation (Step 3)

### Document load

The epics and stories document does not exist. The Step 1 document inventory confirmed:

- Whole: None
- Sharded: None

This is a structural blocker for the readiness check. Without an epics document, FR coverage cannot be validated, and the remaining steps (UX alignment, epic quality review, final assessment) will also be blocked.

### Coverage matrix

Cannot be produced. The 36 PRD functional requirements cannot be traced to epics because no epics exist.

### Missing requirements

Every PRD functional requirement is currently uncovered in an epics and stories document. The PRD itself records the 14 P0 feature areas (F-1 through F-14), but these are feature deep-dives, not epic-ready stories.

### Coverage statistics

- Total PRD FRs: 36
- FRs covered in epics: 0
- Coverage percentage: 0%

### Required next step

Create the epics and stories document before resuming this readiness check. The bmad-create-epics-and-stories skill is the correct next BMAD action. It will also produce the RBAC matrix that the architecture file references as `docs/architecture-appendix-rbac.md`, resolving one of the cross-document inconsistencies recorded in step 2.

### Decision point

The readiness check cannot complete without epics. Two options are available:

- **Option A:** Halt the readiness check now and run bmad-create-epics-and-stories to produce the epics document, then resume the readiness check from step 3.
- **Option B:** Treat the PRD's 14 P0 feature deep-dives as a temporary substitute for epics and continue the readiness check, marking the missing epics artefact as a known blocker.

Option A is the BMAD-correct path. Option B is a shortcut that hides the underlying gap.

## UX Alignment Assessment (Step 4)

### UX Document Status

Not Found. No UX, design, or wireframe document exists in the project. Searched for `*ux*.md`, `*UX*.md`, and `*design*.md` patterns across the workspace.

### UI is implied by the PRD

The PRD is UI-centric. UI is not optional:

- The 10-step demo walkthrough (BRD §13) requires a working dashboard, alerts page, incident Kanban, incident detail, admin simulator, admin notifications, and audit log.
- The architecture defines 14 routes (`/`, `/alerts`, `/incidents`, `/incidents/:id`, `/sensors`, `/sensors/:id`, `/admin/users`, `/admin/thresholds`, `/admin/simulator`, `/admin/notifications`, `/audit`, `/login`, `/reports`, `/healthz`).
- F-7 contains an ASCII wireframe of the executive dashboard.
- F-10 specifies the incident Kanban layout.
- F-4 says "All UI elements are role-aware. Operators never see 'Manage users' links. Technicians only see their assigned incidents."
- NFR-8 requires a 60-second comprehension SLA from the dashboard.
- The Bengali-friendly typography token is a UX concern declared in the refined idea (§10).

### Alignment Status

Because no UX document exists, alignment cannot be validated against one. The PRD and architecture together describe the UI but in prose, not as a UX artefact.

| Area                       | PRD status                        | Architecture status      | UX document status                                                                                                                                            |
| -------------------------- | --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14 routes enumerated       | Yes (PRD §3 personas)             | Yes (architecture §11.2) | None                                                                                                                                                          |
| Executive dashboard layout | ASCII mockup in F-7               | No                       | None                                                                                                                                                          |
| Incident Kanban columns    | Listed in F-10                    | No                       | None                                                                                                                                                          |
| Sensor detail chart        | Described in F-8                  | No                       | None                                                                                                                                                          |
| Role-aware UI affordances  | Described in F-4                  | No                       | None                                                                                                                                                          |
| Bangla-friendly typography | Mentioned in refined idea §10     | Not specified            | None                                                                                                                                                          |
| Design tokens (shadcn/ui)  | Mentioned in PRD and refined idea | No                       | None _(later superseded — the implementation shipped hand-rolled Tailwind primitives on `tailwind.config.ts`; see `_bmad-output/.../DESIGN.md` §`ui_system`)_ |
| Accessibility (WCAG)       | Not addressed                     | Not addressed            | None                                                                                                                                                          |

### Warnings

UX is clearly implied but no UX document exists. This is a readiness gap. The implications for a 1-developer + AI-agent build:

1. **Screen-by-screen behavior will be inferred by the AI agent.** Without a UX artefact, the agent will guess at layout, interaction patterns, and visual hierarchy. The result will be functional but inconsistent.
2. **Role-aware UI affordances will be missed.** F-4's requirement that "Operators never see 'Manage users' links" is enforceable in code only if the UI explicitly gates each component on the user's role. Without a UX map, the agent will likely implement server-side gates but render unrestricted menu items.
3. **The 60-second comprehension SLA has no design contract.** The wireframe in F-7 is ASCII; a reviewer reading the live demo cannot match the wireframe to the rendered UI without a design artefact.
4. **Bangla-friendly typography is a v2 hook.** Without a UX artefact, the typography registry may not be wired into the Tailwind config.

### Mitigation options

- **Option A:** Run bmad-ux to produce a formal UX artefact before proceeding. This is the BMAD-correct path.
- **Option B:** Treat the PRD's F-7 mockup, the 14-route table in the architecture, and the role-aware UI requirements as a minimal UX contract. Document this as a known gap and proceed to epics and stories.
- **Option C:** Embed screen-by-screen specifications inside the epics document when it is generated. Each epic carries its own UI contract.

Option A is the BMAD-correct path. Option C is the pragmatic compromise that fits the 1-developer + AI-agent constraint. Option B is the fastest but carries the highest risk of drift between the agent's interpretation and the user's mental model.

### Required next step

Either run bmad-ux or commit to Option C (UI specs embedded in epics). The readiness check cannot meaningfully validate UX alignment without one of these.

## Epic Quality Review (Step 5)

### Document load

The epics and stories document does not exist. This is the same structural blocker from step 3.

### Critical structural violations

#### 🔴 Critical Violation 1: No epics document

Without epics, the following best-practice checks cannot be performed:

- **User value focus:** cannot verify that each epic delivers user value rather than being a technical milestone.
- **Epic independence:** cannot verify that Epic N does not require Epic N+1.
- **Story sizing:** cannot verify that each story is appropriately sized.
- **Forward dependencies:** cannot detect forward references in stories.
- **Acceptance criteria quality:** cannot validate Given/When/Then structure.
- **Database creation timing:** cannot verify that each story creates only the tables it needs.
- **Starter template compliance:** the architecture and refined idea specify a pnpm monorepo starter. This must be Epic 1 Story 1.

#### 🔴 Critical Violation 2: No RBAC matrix artefact

The architecture file references `docs/architecture-appendix-rbac.md` for the locked RBAC matrix. It does not exist. The PRD's F-4 describes the 13-action matrix in prose only. Without a locked matrix:

- Story-level authorization behavior has no authoritative source.
- The 8 negative test cases (T-1 through T-8 in PRD F-4) cannot be derived from the matrix.
- RBAC regressions cannot be detected at code-review time.

### Pre-emptive best-practice recommendations for the epics document

When the epics document is generated, the following best practices must be applied. These are pre-emptive so the AI coding agent has a checklist rather than discovering them one at a time.

#### Epic structure

- Each epic is user-centric. Title and goal describe what the user can do, not what the engineer builds.
- Epic 1 is the demo-ready baseline: it must produce a working app, even if minimal, that the user can interact with.
- Each epic stands alone; later epics may extend but cannot be required.
- The 14 PRD feature deep-dives (F-1 through F-14) map to epics; the 8-slice sequencing plan maps to epic execution order.

#### Story structure

- Each story is a vertical slice (one feature path end-to-end), not a horizontal layer.
- Each story has at most 8 acceptance criteria, written in Given/When/Then.
- Each story creates only the database tables it needs; never create all tables upfront.
- No forward dependencies between stories. Each story references only the stories it depends on, not the ones that depend on it.

#### Acceptance criteria

- Each AC is independently testable.
- Each AC specifies the expected HTTP status, response shape, or DOM state.
- Error paths are explicit (400, 403, 409, 429, 500).
- The 8 RBAC negative test cases from PRD F-4 must each appear as a test in the auth/RBAC epic.

#### Starter template compliance

- Epic 1 Story 1 must be: "Set up pnpm monorepo with apps/web, apps/api, packages/simulator, packages/shared, Docker Compose skeleton, /healthz endpoint, README quickstart."
- This is the only place where Docker Compose, the monorepo, and the README skeleton are created. Slices later in the build extend this skeleton.

#### Demo readiness

- Epic 1 must produce a smoke-testable app: a curl to /healthz returns 200, the README's `docker compose up` works on a fresh clone.
- Epic 7 (or the last functional epic) must produce a runnable demo. The 10-step BRD §13 walkthrough must be reproducible from Epic 7 alone; Epic 8 is for polish and Playwright.

### Required next step

The epics and stories document must be created before any readiness gate can pass. The correct BMAD next action is bmad-create-epics-and-stories. It will also produce the RBAC matrix artefact that resolves the architecture reference.

### Proceeding

The epic quality review is complete in the sense that the structural violations are documented. There is nothing to validate further until the epics document exists.

## Summary and Recommendations (Step 6)

### Overall Readiness Status

**NOT READY.**

The PRD, BRD, and architecture documents are complete and aligned for the most part. Five small cross-document inconsistencies need correction. The structural blockers preventing the readiness check from completing are the missing epics and stories document, the missing UX design artefact, and the missing RBAC matrix appendix. These are pre-development artefacts that BMAD requires before Phase 4 implementation can start.

### Critical Issues Requiring Immediate Action

The following issues must be resolved before the project is implementation-ready:

1. **Create the epics and stories document.** This is the highest-priority blocker. The 14 P0 PRD feature deep-dives are feature-level, not epic-level. They need to be decomposed into epics (user-value slices) and stories (independently completable vertical paths) per the create-epics-and-stories standard. Run the bmad-create-epics-and-stories skill.
2. **Create the RBAC matrix artefact.** The architecture file references `docs/architecture-appendix-rbac.md` for the locked RBAC matrix. The PRD F-4 describes 13 actions × 4 roles = 52 cells. The bmad-create-epics-and-stories skill should produce this artefact as part of its RBAC epic.
3. **Decide on UX handling.** Either run bmad-ux to produce a formal UX artefact, or commit to Option C (UI specs embedded in epics) where each story carries its own UI contract. For a 1-developer + AI-agent build, Option C is the pragmatic compromise.
4. **Resolve five cross-document inconsistencies** identified in step 2:
   - FR-34 scenario count: BRD says "6 base scenarios" but lists 7. Update to "7 base scenarios" in BRD and PRD.
   - NFR-15 service count: lists 3 services; architecture has 4. Update NFR-15 wording to "four services: web, api, simulator, db."
   - F-13 default rule count: PRD F-13 lists 6 default rules; BRD §8.3.1 has 9 canonical rules. Update F-13 to mirror the canonical table.
   - Architecture RBAC appendix: reference exists, file does not.
   - `/admin/notifications` route: already corrected in previous pass.

### Recommended Next Steps

1. **Fix the five cross-document inconsistencies.** These are 5-minute edits and prevent downstream AI-agent confusion.
2. **Run bmad-create-epics-and-stories.** This produces the epics document and the RBAC matrix appendix. It is the highest-leverage BMAD action remaining.
3. **Decide UX handling.** Either run bmad-ux, or commit to UI specs embedded in epics (Option C).
4. **Re-run bmad-check-implementation-readiness** after epics exist. The check should pass cleanly once the structural blockers are resolved and the inconsistencies are corrected.
5. **Begin implementation in story-driven slices** following the 8-slice PRD sequencing plan. The AI agent's working unit is one story at a time, validated against its acceptance criteria.

### Final Note

This assessment identified 2 critical structural blockers (missing epics and missing UX artefact), 1 missing reference artefact (RBAC matrix), and 5 cross-document inconsistencies. The PRD, BRD, and architecture together form a strong foundation; the missing pieces are the development-planning artefacts that BMAD requires before code can be written.

The readiness report's overall verdict is **NOT READY**, but with the recommended next steps completed, the project should reach **READY** in a single follow-up cycle of bmad-create-epics-and-stories plus the five small text corrections.

## Implementation Readiness Assessment Complete

**Report generated:** `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-20.md`

The assessment found:

- 2 critical structural blockers (missing epics document, missing UX artefact)
- 1 missing referenced artefact (architecture RBAC matrix)
- 5 cross-document inconsistencies
- 8 pre-emptive best-practice recommendations for the upcoming epics document

Review the detailed report for specific findings and recommendations. The next BMAD action is `bmad-create-epics-and-stories`, with optional bmad-ux before it if the user prefers a formal UX artefact over Option C (UI specs in epics).
</content>
</invoke>
