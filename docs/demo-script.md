# Surakkha — Demo Script

> **The 60-second comprehension test.**
> A fresh reviewer with no prior context is placed in front of the dashboard. They follow this script. At the end, they can verbally describe the workflow without prompting.
>
> Source: Story 6.8 (`_bmad-output/planning-artifacts/epics.md` §6.8).

---

## Pre-demo setup

Before the reviewer arrives:

1. Bring up the stack: `docker compose up`.
2. Open `http://localhost:8080`.
3. Log in as **Admin** with the seeded credentials from `.env.example`.
4. Wait for the simulator's first readings to land on the dashboard (a few seconds).
5. Have the following credentials handy for switching roles:
   - **Operator** (Rahim)
   - **Technician** (the one Rahim will assign)
   - **Admin** (already logged in; needed for the SeverityBanner)
6. Open `/admin/simulator` in a separate tab so the scenario can be triggered without disrupting the demo flow.

**Total prep time:** under 2 minutes once the stack is up.

---

## The 60-second cycle

The reviewer follows this script. The presenter times the cycle and stops at 60 seconds.

### Beat 1 — Read the KPI band (10 seconds)

> "Look at the top of the dashboard. Tell me what you see."

The reviewer reads:

- Four KPI tiles, one per key metric (`pH`, `TDS`, `Turbidity`, `Chlorine`).
- Severity colour (Healthy = calm green, Warning = saturated amber + glow, Critical = saturated red + pulse).
- A permanent **LegendStrip** below the KPI band: three pills labelled Healthy / Warning / Critical.
- A **SeverityShowcase** with three side-by-side cards explaining what each severity means in the response workflow.

**Expected comprehension:** the reviewer can name the four KPI metrics and the three severity tones within 10 seconds.

---

### Beat 2 — Click a critical card (10 seconds)

> "Click a critical card. Tell me what happens."

The presenter pre-triggers the `RisingTDS` scenario via `/admin/simulator` before the beat starts (or the reviewer clicks the trigger themselves). A KPI or LiveReadingRow becomes Critical.

The reviewer:

- Clicks the critical KPI tile.
- Lands on `/incidents/:id` (or `/alerts`).
- Sees an OPEN incident with severity Critical, the breached metric, the device, the timestamp, and the actor of the original auto-creation.

**Expected comprehension:** the reviewer can state that the alert auto-creates an OPEN incident within 10 seconds.

---

### Beat 3 — Follow the incident (40 seconds)

> "Acknowledge the incident. Assign a Technician. Have the Technician submit a result. Resolve the incident. Tell me what you saw at each step."

The reviewer (or the presenter, while the reviewer watches) performs the four-step dance:

1. **Acknowledge** (Operator) — incident transitions `OPEN → ACKNOWLEDGED`; the Kanban card moves from `Open · Critical` to `Acknowledged`.
2. **Assign Technician** (Operator) — incident transitions `ACKNOWLEDGED → INSPECTING`. The Technician's filtered Kanban view now shows this incident.
3. **Submit result** (Technician) — submits `UNSAFE` with a one-line note (≥ 10 characters required). Incident transitions to `UNSAFE`.
4. **Resolve** (Operator) — reviews the Technician's submission; transitions `UNSAFE → RESOLVED`. The Critical banner clears.

**Expected comprehension:** the reviewer can describe the seven-state machine and the role handoffs within 40 seconds.

---

## After the 60-second cycle

If the reviewer is engaged, expand into one or more of these optional beats:

| Beat                          | Time   | What it shows                                              |
|-------------------------------|--------|-------------------------------------------------------------|
| Critical banner lifecycle     | 1 min  | Admin sees the sticky banner after UNSAFE; it clears on resolve or after 24 hours. |
| Offline scenario              | 1 min  | One device goes offline for 60 seconds; the `Reconnecting…` banner appears; the dashboard renders last-known state; API actions disable. |
| Audit log                     | 30 sec | `/audit` shows every state transition with actor and timestamp. |
| Threshold editor              | 1 min  | `/admin/thresholds` lets the Admin edit a rule; the rule versions and the previous row is preserved. |
| RBAC denied state             | 30 sec | A Viewer logs in and tries to navigate to `/audit` — sees the calm full-page denied state. |

---

## What the reviewer should be able to say at the end

Within 60 seconds of looking at the dashboard, a reviewer should be able to summarise Surakkha in one or two sentences. The intended summary, in the voice the product uses:

> "Surakkha monitors six water-quality metrics across six devices. When a reading breaches a threshold, an alert fires and auto-creates an incident. An Operator acknowledges and assigns a Technician. The Technician inspects and submits a result. The Operator reviews and resolves. Every step is recorded in an audit log. If a Technician submits `UNSAFE`, an Admin sees a sticky Critical banner for 24 hours or until acknowledged."

That summary is the success criterion. If the reviewer can articulate it without prompting, the demo passed.

---

## What if the demo fails

If the reviewer is confused, the most common reasons are:

| Symptom                                     | Likely cause                                                                |
|---------------------------------------------|------------------------------------------------------------------------------|
| Reviewer can't find the severity vocabulary | The LegendStrip / SeverityShowcase is not visible. Check Story 6.2 AC.       |
| Reviewer can't connect KPI to incident       | The Kanban projection is broken. Check Story 4.3 AC.                        |
| Reviewer doesn't see the Critical banner     | The user is not an Admin. Check Story 4.8 AC.                                 |
| Latency seems higher than 3 seconds         | Simulator is paused or scenario isn't running. Check Story 6.9 (latency test). |

---

## Rehearsal checklist

Before the live demo, the presenter confirms:

- [ ] `docker compose up` is running and the dashboard loads.
- [ ] Six devices are visible on the map.
- [ ] All four seeded user accounts can log in.
- [ ] `/admin/simulator` can switch a device to `RisingTDS` and back.
- [ ] The Critical banner appears within 5 seconds of an `UNSAFE` submission.
- [ ] `/audit` lists the test transitions.
- [ ] The 60-second cycle fits inside 60 seconds when rehearsed solo.
- [ ] The presenter can articulate the one-paragraph summary above from memory.

---

## Demo cadence (15-minute envelope)

| Minute | Activity                                                                                  |
|--------|-------------------------------------------------------------------------------------------|
| 0–2    | Stack is up, login as Admin.                                                              |
| 2–3    | Brief intro: "Surakkha is a water-safety monitoring platform. I'll show you the workflow."|
| 3–4    | Beat 1 — KPI band + LegendStrip + SeverityShowcase.                                       |
| 4–5    | Beat 2 — Trigger `RisingTDS` via `/admin/simulator`; click the critical KPI.              |
| 5–8    | Beat 3 — Acknowledge → assign → submit UNSAFE → resolve.                                  |
| 8–10   | Optional beats (banner, audit, RBAC denied state).                                        |
| 10–12  | Q&A.                                                                                      |
| 12–15  | "Want to see the planning artefacts?" — show `docs/` and `_bmad-output/planning-artifacts/`.|

The 60-second cycle is the centrepiece. Everything else is padding around it.