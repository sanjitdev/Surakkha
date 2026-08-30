# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary users:** Four-role model enforced server-side as `(subject, action, resource)` on every endpoint via a single `authorize.ts` middleware (architecture §8.3, Story 1.5). No implicit "Admin can do everything" — every grant is explicit.

| Role           | What they do                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Admin**      | Drives scenarios, edits thresholds, browses audit log, manages users, sees the SeverityBanner. |
| **Operator**   | Acknowledges incidents, assigns Technicians, resolves incidents, exports CSV.                  |
| **Technician** | Submits inspection results (SAFE / UNSAFE / MONITORING). Sees only their assigned incidents.   |
| **Viewer**     | Read-only access to the dashboard and incident Kanban.                                         |

**Named key-journey protagonist:** Rahim, an Operator, who acknowledges an alert, assigns a Technician, follows the inspection, and audits the outcome. The full RBAC matrix lives at `docs/architecture-appendix-rbac.md`.

**Audience for the demo:** portfolio reviewers who can run the 15-minute demo end-to-end on a clean laptop with Docker.

## Product Purpose

Surakkha is a real-time water-safety monitoring and incident-management platform that demonstrates a complete Sensor → Resolution workflow on simulated devices. Six simulated devices stream metrics (pH, TDS, turbidity, temperature, chlorine, water level) every 2 seconds; a rules engine fires alerts when a threshold is breached; incidents flow through a seven-state workflow from OPEN to RESOLVED.

The product is built for Bangladeshi government primary schools. Bengali typography is registered now so a v2 locale is a content drop, not a refactor.

**Success means:** a portfolio-defensible demo on simulated devices, plus a complete enough rule set, RBAC, and incident state machine to credibly extend to a production deployment.

## Positioning

**Confirmed by the user:** the meaningfully-different mechanism is the **WHO/BSTI-aligned water-safety rules engine**. Surakkha's edge is the alignment to WHO and BSTI source-of-truth thresholds (BRD §8.3.1) plus the seven-state incident workflow and the completeness of the rule set — not "real-time water monitoring" as a generic category.

What a neighbouring product could not truthfully copy: a pre-baked, versioned threshold catalog tied to WHO/BSTI standard revisions, with per-device overrides, hysteresis, and supersede-history — i.e. the rules engine is content, not infrastructure.

## Operating Context

**Deployment target:** Bangladesh government primary schools. Single-process Node 20 backend, Vite + React frontend, Postgres 15 database, and a separate simulator process that emits realistic water-quality telemetry over WebSocket. Demo runs in 15 minutes on Docker; production deployment is deferred (v2).

**Daily workflows:**

- An Operator monitors the dashboard, sees a sticky Critical banner for UNSAFE inspection results, acknowledges alerts, assigns Technicians, and resolves incidents.
- A Technician inspects a device and submits one of three outcomes: SAFE / UNSAFE / MONITORING.
- An Admin tunes thresholds (with hysteresis and supersede), drives simulator scenarios for demos, and browses the audit log.

**Workspace:** a shared Postgres-backed realtime canvas. Every state change, RBAC denial, threshold edit, and simulator event lands in the audit log.

**Operational constraints (v1, not durable):** 6 simulated devices only; Postgres-only persistence; single-process backend; manual install via `docker compose up`.

## Capabilities and Constraints

**Functional capabilities (36 FRs / 55 stories / 6 epics, all covered per implementation-readiness report v3):**

- 14 routes across 3 nav groups (Monitor / Operate / Admin).
- 7-state incident state machine (OPEN → ACKNOWLEDGED → INSPECTING → SAFE / UNSAFE / MONITORING → RESOLVED; REOPENED as the rewind).
- 4-column severity-mixed Kanban (`Open · Critical` · `Open · Warning` · `Acknowledged` · `Resolved`) — a derived projection, not stored state.
- 9 default thresholds (WHO/BSTI source of truth), with per-device overrides and hysteresis.
- Real-time WebSocket updates (`reading:new`, `incident:state_changed`).
- Audit log of every state change, threshold edit, RBAC denial, and simulator event.
- RBAC matrix enforced on every endpoint.

**Non-functional capabilities (15 NFRs, all covered):**

- Telemetry-to-alert latency < 3 seconds end-to-end (NFR-1).
- Backend ≥ 70% line coverage; frontend ≥ 50% (NFR-12).
- WCAG 2.1 AA on every page (UX-DR-16).
- `prefers-reduced-motion: reduce` honored — pulses and banner fade-in disabled under reduced motion.
- Light + dark themes via system preference (no manual toggle v1).

**Engineering principles** (from `AGENTS.md` — non-negotiable, project bar):

1. **Small** — components ≤ 4 hooks / ≤ 8 props / ≤ 6 JSX depth; functions ≤ 200 lines; files ≤ 500 (warn) / 800 (error) lines.
2. **Typed** — TypeScript strict mode, no `any`, no `@ts-ignore` without date + reason.
3. **Immutable** — `const` by default, `readonly` on props/state, React state updates always produce new values.
4. **Professional** — no `console.log` in committed code; no commented-out code; no `TODO` without date + owner; no magic numbers.
5. **Audited** — every state change, RBAC denial, threshold edit, and simulator event surfaces in the audit log.

**Open product facts (deliberately undecided):**

- Pricing model: not in scope for v1 (portfolio demo).
- Multi-tenant tenancy: single school district assumed; multi-district is a v2 question.
- Mobile native: not planned; the web SPA is responsive but a native wrapper is not on the roadmap.
- Manual theme toggle: deferred to v2 per the UX-in-60-seconds section.

## Brand Commitments

- **Name:** Surakkha ("protection" in Bengali, but do not editorialise; the README does not define brand voice beyond "calm").
- **Voice:** calm, factual, no exclamation marks, no marketing language. Story 1.3 AC + DESIGN.md voice; pinned in the form primitives' copy discipline.
- **Aesthetic direction (inferred from existing DESIGN.md, not user-confirmed here):** critical-first visual hierarchy (Critical saturates red and pulses; Warning glows amber; Healthy is calm green). Dark sidebar + light canvas. Severity carried by colour, text, and icon simultaneously (not colour alone — accessibility floor).
- **Code-quality commitments:** the five principles in `AGENTS.md` are binding. Future work must not silently violate them.
- **Bengali locale:** registered now (typography hooks), even though v1 ships only English content.

## Evidence on Hand

- **`README.md`** (this repository) — full product description, quickstart, JWT contract, UX-in-60-seconds, RBAC matrix, default thresholds, incident state machine, road map.
- **`_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/`**:
  - `DESIGN.md` — visual design system (the single source of truth that `packages/web/tailwind.config.ts` mirrors).
  - `EXPERIENCE.md` — behavioural contract (component patterns, state patterns, key flows, accessibility floor).
  - `mockups/` — six rendered HTML key-screen mocks (dashboard, incident detail, admin simulator, login, sensor detail, incident Kanban).
- **`_bmad-output/planning-artifacts/epics.md`** — the 6 epics, 55 stories, 36 FRs / 15 NFRs decomposition.
- **`_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-21.md`** — the implementation-readiness gate v3 (returns READY, 36/36 FRs, 15/15 NFRs).
- **`docs/architecture-appendix-rbac.md`** — full RBAC matrix.
- **`docs/demo-script.md`** — the 60-second comprehension test for fresh reviewers.
- **`AGENTS.md`** — the five binding engineering principles.
- **`packages/web/tailwind.config.ts`** — the single source of truth for visual tokens at the Tailwind layer.
- **`packages/web/src/index.css`** — dark-mode severity lift + reduced-motion handling.

**Absences future work must not fabricate:** real customer testimonials, real school deployments, real incident logs, real press, real pricing. The platform ships with simulated devices only.

## Product Principles

1. **The rules engine is the product.** Real-time water monitoring is a generic category; the alignment to WHO/BSTI source-of-truth thresholds, with per-device overrides, hysteresis, and supersede history, is what makes Surakkha distinct. Future visual work should make the rules engine legible at a glance — the four-column Kanban, the SeverityBanner, the sticky Critical pulse are all surface expressions of this principle.

2. **Calm is a feature.** The product's tone is calm, factual, no exclamation marks, no marketing language. Critical events demand attention via visual hierarchy (colour, pulse, position) — never via copy shouting. The next surface should make a stressed Operator's job easier, not louder.

3. **Every action is auditable.** Every state change, RBAC denial, threshold edit, and simulator event lands in the audit log. Future work must preserve this — no "background" writes, no implicit denials, no operator actions without a trail.

4. **The Operator is the protagonist.** Named after Rahim, the Operator is who design and engineering optimize for first. Technician, Admin, Viewer matter; but the Operator's workflow (acknowledge → assign → follow inspection → audit) is the key journey every surface should support without friction.

5. **Build for the deployment context, not the demo.** The demo runs in 15 minutes on a laptop, but the product targets Bangladeshi government primary schools. Bengali typography is registered now; bandwidth assumptions are honest; the four-role RBAC mirrors school-District staffing. The visual polish that makes the demo portfolio-defensible must not introduce patterns that the deployment context cannot sustain.

## Accessibility & Inclusion

- **WCAG 2.1 AA** is the floor, enforced on every page via axe-core (`__tests__/a11y.reduced-motion.spec.ts`).
- **Reduced motion** is a hard requirement, not a polish item. The 1500ms critical pulse, 1200ms per-update glow, and 2000ms map-pin pulse all disable under `prefers-reduced-motion: reduce`. Severity is still conveyed by colour, text, and icon simultaneously (not colour alone).
- **Light + dark themes** honor system preference. No manual toggle in v1 (v2 polish).
- **Bengali locale** is registered in the typography layer even though v1 ships only English. v2 is a content drop, not a refactor.
- **Semantic HTML** is the rule: `<main>`, `<h1>` landmarks; ARIA roles only when no semantic equivalent exists; visible focus rings (2px outer with 2px white spacer on dark fills).
- **Keyboard reachability**: every interactive element is in the natural tab order; no keyboard traps.
