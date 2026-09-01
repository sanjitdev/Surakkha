# Surakkha — Refined Idea (post-brainstorm)

**Document type:** Refined ideation document
**Source:** Refinement of `Surakkha-water-monioring-system-idea.md` (the original brainstorm)
**Companion to:** `architecture.md` (the technical spec, refactored from the original combined spec)
**Audience:** Stakeholders, future contributors, and the author in six months
**Status:** Refined v1.0
**Date:** 2026-08-20

---

## 1. What this document is

The original idea file is a brainstorm. It contains five project ideas, an architectural sketch, a list of "production-grade features," and a final recommendation to build **Surakkha**. That recommendation was good. The brainstorm itself was not: it mixed decisions with aspirations, used "real-time" without a number, and quietly assumed a generic metric schema that would have made the project 3× longer to build.

This document is a **post-brainstorm refinement**: same idea, contradictions resolved, overclaims corrected, assumptions surfaced. It is **not** a technical spec — the spec lives in `architecture.md`. This document explains _what we chose and why we chose it_, in plain language.

---

## 2. The decision (one line)

**Surakkha is a real-time water safety monitoring and incident-management platform for government primary schools in Bangladesh, shipped as a 2–4 week MVP that demonstrates one end-to-end workflow (Sensor → Alert → Incident → Resolution) using a hardware-shape simulator instead of real devices.**

Everything below justifies, scopes, or qualifies that one-line decision.

---

## 3. Why schools, and only schools

The original idea listed five customer segments (schools, clinics, markets, apartment buildings, community water points) and three more vertical ideas (transport, cold-chain, agriculture). Refining to schools was the single most important cut.

Reasons that justified the cut:

- **Bounded user set.** Each school has a headmaster (decision-maker), a caretaker (sensor operator), and an education-officer escalation path. Permission model fits on one screen.
- **Real reporting chain.** A contaminated water source at a school affects 200–1,500 children. This is a politically and socially visible incident, with a real authority to escalate to (Upazila Education Office, BSTI).
- **Portfolio signal.** Education + health + IoT in one project reads well; it shows operational thinking (workflow, audit), not just CRUD.
- **Repeatable deployment.** Bangladesh has ~130,000 government primary schools. Even capturing 10 schools for the MVP is realistic; scaling later is a sales problem, not an architecture problem.

**Resolved contradiction (was: line 3 of original said "schools, apartment buildings, rural communities, or municipal water points"; line 391 listed "Schools, Clinics, Markets, Apartment buildings, Community water points"; line 567 said "schools, communities, and facilities"):** All three lists are collapsed to **schools only** for v1. Other verticals are explicitly v2 backlog.

**Resolved assumption (was: implicit in original idea that future verticals drop in "for free"):** They do not. The wire contract and rules engine abstractions are real, but adding a new customer type is a config change; **adding a new metric is a code change** unless we plan for it (see §8 on the two-layer schema).

---

## 4. Why one workflow

The original idea describes a sensor → alert → incident → technician → resolution → audit chain. That's the only chain that ships in v1.

**Why not more?** Every additional workflow multiplies:

- Screen count in the React app.
- State machine combinations in the API.
- Permission matrix cells.
- Test cases.
- Decision latency at every sprint review.

Two to four weeks does not accommodate even one extra workflow without compromising the depth of this one. The depth — clean state machine, real RBAC enforcement, real audit log, end-to-end demo — is the portfolio signal. The breadth would be the opposite.

**Explicit non-workflows for v1:**

- Threshold authoring UI for non-Admins.
- Multi-step approvals for any state change.
- Customer onboarding of new verticals.
- Device firmware update flows.
- Calibration workflows.

Each is a v2 candidate.

---

## 5. The "real-time" promise, with a number

The original idea says (line 253): "you have a real-time event-driven system without needing physical hardware." This is true but vacuous without an SLA.

**Refined SLA (locked):** end-to-end alert latency from breach detection to alert visible on the dashboard MUST be **under 3 seconds** under nominal load (6 simulated devices).

This number is achievable because:

- WebSocket connection between simulator and platform is persistent (no polling delay).
- Rules engine evaluates frames in-process on the same Node runtime.
- Socket.IO broadcasts from ingestion directly to subscribed dashboards.
- Postgres is local (Docker Compose) — sub-millisecond writes.

The SLA is also tight enough to be a _useful_ portfolio claim — "3 seconds end-to-end" is specific, measurable, and impressive in a portfolio context. "Real-time" with no number is not.

**Note:** in real Bangladesh deployment over 2G/3G cellular with intermittent power, this SLA is unlikely to hold. That's a v2 problem; the v1 SLA is for the demo platform. Documented honestly.

---

## 6. The device abstraction — what it is, what it isn't

The original idea's most influential architectural paragraph (lines 515–525):

> "I would not build the system around 'hardware.' Build it around an abstraction: Device with device type, capabilities, telemetry, events, alerts, workflows."

This was the most overclaimed line in the original idea. Let me separate what's real from what isn't.

### What's real (the abstraction is real)

- **Transport abstraction.** Today, simulator connects via WebSocket with a per-device JWT. Tomorrow, real hardware can connect via MQTT, LoRaWAN, or any other transport — and the WS ingestion handler doesn't change. This is a clean seam and is genuinely valuable.
- **Identity abstraction.** A stable `device_id` (UUIDv4) is referenced everywhere. SIM card changes, MAC changes, even physical device swaps don't change identity. This is correct and matches industry practice.
- **Workflow abstraction.** The incident state machine (OPEN → ACKNOWLEDGED → INSPECTING → SAFE/UNSAFE/MONITORING → RESOLVED) is generic enough to be reused for any sensor-driven incident, not just water.

### What's not real (the generic schema claim)

- **Capabilities and generic metrics.** The original idea implies the device can declare "what metrics it emits" and the platform adapts. This is **not** true in v1. The platform has a fixed metric schema: `ph`, `tds_ppm`, `turbidity_ntu`, `temp_c`, `chlorine_ppm`, `water_level_cm`. Adding a metric requires code changes (DB column or jsonb field, rules engine case, chart series, simulator scenario, test cases).

### How we resolve this honestly: the two-layer schema

We commit to:

1. **v1 metric schema (fixed):** the six metrics above. This is what the simulator emits, what the rules engine knows about, what the charts show.
2. **v1 metric registry (scaffolded):** a `MetricDefinition` table with `(key, label, unit, type, default_severity, default_rule_template)`, read at startup by the rules engine and the simulator. **Seeded with the six v1 metrics**, not empty.
3. **v2 path (no data migration):** new metrics drop in by inserting a `MetricDefinition` row and adding a small per-metric adapter. Existing readings are unchanged because they store metrics as a `jsonb` blob already (spec §8).

This is a defensible promise. The original idea's "Device with capabilities" framing was not — it was an aspiration dressed as an architecture.

---

## 7. What the simulator is, and isn't

The original idea says (line 198): "Instead of simply inserting fake data into the database, create a Sensor Simulator inside your Node application."

**Refinement:** the simulator is **not** inside the Node application. It is a **separate process** that authenticates and connects via the same wire contract as a real device. This is deliberate and load-bearing.

Why:

- It forces the platform's ingestion path to be the _only_ way readings enter the system. No back-door insert paths.
- It exercises the auth layer, the rate limiter, the reconnection logic, the backpressure buffer — all of which real hardware will exercise too.
- The day real hardware lands, only the transport (WebSocket → MQTT/LoRaWAN adapter) changes. The simulator can stay for QA, demos, and regression tests.

**Simulator JWTs are scoped.** They carry `aud=simulator` and have read-only-equivalent scope. A compromised simulator cannot execute admin actions even if its tokens leak.

**Simulator actions are audited.** Triggering a scenario from the Admin UI emits a `__simulator_event` audit entry. The simulator is a privileged tool, and privileged tools leave traces.

---

## 8. RBAC — what's enforced, what's implied

The original idea lists three roles (Admin, Operator, Technician) and one Viewer-like capability ("View everything"). The spec adds **Viewer** as a 4th role and tightens the matrix.

**Locked decision:** four roles with the spec §4 matrix. The matrix is enforced as a `(subject, action, resource)` triple on every endpoint — no implicit "Admin can do everything."

**Locked decision:** only Admin can change thresholds/rules on a running device. The Operator can view rules, but cannot edit them. This is consistent with the original idea's caretakers-as-viewers framing; it makes threshold changes an auditable, privileged operation.

**Locked decision:** the audit log is **plain append-only** in v1 (no hash chain). It records actor + timestamp + before/after for every state change, threshold change, and simulator event. Cryptographic tamper-evidence is a v2 item.

---

## 9. What happens when the device goes offline

The original idea doesn't address this. The platform is designed for Bangladesh, where load-shedding and intermittent 2G/3G are normal — so this isn't an edge case, it's the common case.

**Locked decision:** when a device goes offline mid-incident, **the incident stays in its current state until a human acts on it.** No automatic escalation. No auto-resolution. No auto-flagging.

Reasons:

- "Auto-escalate to UNSAFE" sounds safe but produces noise in a country where load-shedding is routine — false UNSAFE events erode trust faster than silence.
- "Auto-create an Offline sub-incident" duplicates state and complicates the workflow without adding operator value.
- The simulator includes an `Offline` scenario specifically so this can be demonstrated and reasoned about, not papered over.

The Operator UI shows a clear "Device last seen 12 minutes ago" indicator. The decision to act — wait, dispatch, close — stays with the Operator.

---

## 10. The polished-but-not-bespoke UI

The original idea talks about visual impressiveness ("Water Safety Overview" mockup, color-coded map markers, live readings table). The refinement:

- **Stack:** Vite + React 18 + TypeScript + TanStack Query + Socket.IO client + Tailwind CSS (hand-rolled primitives on the `tailwind.config.ts` token system; **no shadcn installed** — Radix, CVA, and lucide were not adopted) + Recharts + Leaflet + react-i18next (en only for v1, bn scaffolded).
- **Polish level:** functional Tailwind utility composition on a strict token discipline (severity palette reserved for status only; chrome uses neutral tokens; touch-targets >= 44px; `prefers-reduced-motion` honoured across all keyframes). Not bespoke motion pieces. Not a generic SaaS look-alike.
- **Why:** a polished hand-rolled Tailwind dashboard is portfolio-quality and ships in days. The token system + prose linter (`scripts/lint-prose.mjs`) + hex-string ESLint rule + `eslint-plugin-tailwindcss` gates (Story 6.10) keep the surface coherent without a primitive library dependency.
- **Bangla-friendly typography:** Tailwind config registers a Bangla-capable font fallback stack now, so when `bn` locale content lands in v2, it's a translation file drop, not a refactor.

---

## 11. The demo story (the portfolio artefact)

The single most important deliverable from this project is not the codebase — it's the reproducible demo. The original idea implicitly assumes this; the refinement makes it explicit.

**The demo story, locked:**

1. Clone the repo.
2. Run `docker compose up`.
3. Open the dashboard. See DHAKA-SCHOOL-023 reporting healthy readings.
4. Open `/admin/simulator`, pick DHAKA-SCHOOL-023, pick `RisingTDS`, click Start.
5. Within seconds, see an alert appear on the dashboard, then an auto-created incident.
6. Log in as Operator, acknowledge, assign to a Technician.
7. Log in as Technician, mark Inspecting, submit result Unsafe.
8. Critical banner fires for all Admins.
9. Operator reviews and resolves.
10. Open `/audit`, see every transition with actor and timestamp.

**Time budget:** 15 minutes from `git clone` to "incident resolved and audited." This is the test. If a reviewer cannot reach step 10 inside 15 minutes, the demo story has failed.

---

## 12. The honest non-goals

Carried over from the spec §15 and stated here in business language:

| v1 does not have                                 | Reason                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| Real IoT hardware                                | Not buildable in 2–4 weeks; wire contract is the seam                   |
| Mobile app                                       | Web-first, mobile is v2                                                 |
| Bangla UI content                                | English UI with Bangla-friendly typography tokens; locale content is v2 |
| Multi-tenant data isolation                      | Single deployment, single customer base in v1                           |
| Audit-log hash chain / signed records            | Plain append-only is enough for portfolio; tamper-evident is v2         |
| Cryptographic frame signing                      | Per-device JWT auth is enough for v1                                    |
| Time-series DB                                   | 30-day retention + 5-min aggregation in Postgres is enough for v1       |
| Redis pub/sub / BullMQ / microservices           | Single Node process handles 10–100 devices comfortably                  |
| Real SMS / email / WhatsApp                      | UI-only notifications + `Notification` table for v1                     |
| BSTI/WHO compliance certification                | Not in scope; conservative WHO defaults are baseline                    |
| Production deployment (TLS, monitoring, backups) | Local demo only; production is v2                                       |

Each row is a deliberate cut. Each row is recoverable as a v2 BRD item.

---

## 13. What we're trading for what

| Trade                                                | Choice            | What we gave up                                                                |
| ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| Build speed vs. abstraction depth                    | Build speed       | Generic metric schema, multi-tenant boundaries, full audit-log tamper-evidence |
| Visual polish vs. design system                      | Functional polish | Bespoke design language, motion design, custom layouts                         |
| Single-process simplicity vs. horizontal scalability | Single-process    | Pub/sub, message queues, microservices — all deferred                          |
| Realism vs. demoability                              | Demoability       | Real cellular latency, real carrier integrations, real SMS                     |
| Scope discipline vs. feature breadth                 | Discipline        | Every feature that didn't serve the Sensor → Resolution chain                  |

Every choice in the left column is reversible in v2 without re-architecting v1, because the wire contract (§6 of spec) is the seam. That seam is the only architectural commitment we're making. Everything else is implementation detail.

---

## 14. How to read the three documents together

| Document                                  | Question it answers                                     | Audience                          |
| ----------------------------------------- | ------------------------------------------------------- | --------------------------------- |
| `Surakkha-water-monioring-system-idea.md` | "What are we building and why?"                         | First-time readers, brainstormers |
| `Surakkha-idea-refined.md` (this)         | "What did we choose, what did we cut, and why?"         | Stakeholders, future contributors |
| `architecture.md`                         | "How exactly do we build it?"                           | Developers building tomorrow      |
| `Surakkha-BRD.md`                         | "What does the business need and how do we measure it?" | Product owner, portfolio reviewer |

If you only read one, read the spec. If you read two, read the spec and this document. If you read three, add the BRD. The original idea is preserved as historical record, not active reference.

---

## Appendix — Resolution of the original idea's flaws

For traceability, every flaw identified in the brainstorm session is resolved here:

| #   | Flaw in original idea                                     | Resolution in this document / spec                                         |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| A   | Customer vertical is contradictory (4 lists, 3 different) | §3 — schools only                                                          |
| B   | "Abstraction" promise overclaims generic schema           | §6 — two-layer schema, generic registry scaffolded, fixed metrics for v1   |
| C   | "Real-time" without an SLA                                | §5 — 3 seconds, locked                                                     |
| D   | RBAC implies technicians can write to devices             | §8 — read-only telemetry in v1, no bi-directional commands                 |
| E   | Bangladesh angle is a list of "things in Dhaka"           | §3 — schools anchored to BSTI + Upazila Education Office escalation        |
| F   | "Simulated" and "real" notifications conflated            | §12 — UI-only notifications, recorded in `Notification` table              |
| G   | Audit log is a footnote                                   | §8 — append-only audit on every transition; tamper-evidence deferred to v2 |
| H   | Five-idea comparison has no criteria                      | Out of scope — decision was already made                                   |
| I   | No queue, by accident; spec by design                     | §12 — explicit, deliberate                                                 |
| J   | No onboarding-the-reviewer friction                       | §11 — 15-minute reproducible demo, locked                                  |
| K   | Simulator is a dev convenience                            | §7 — separate process, same wire contract, scoped JWTs, audited            |
| L   | Device count drifts (5 vs 6)                              | Spec §3 — locked at 6 for the demo                                         |

Every row was a real flaw. Every row now has an answer.
