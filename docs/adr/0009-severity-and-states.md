# 0009 — Three-tier severity and 7-state incident machine

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** §5.1
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Two vocabulary decisions shape every user-visible interaction:

1. **Severity**: how bad is the situation right now?
2. **Incident state**: where is the response in its lifecycle?

A water-safety officer needs to glance at the dashboard and know both
in under a second. The wrong vocabulary creates alert fatigue; the
right vocabulary creates a shared mental model across the school, the
district office, and the duty team.

Forces:

- The PRD specifies three tiers: **Healthy**, **Warning**, **Critical**.
  These map to the WHO/BSTI bands for the six metrics in scope.
- The incident response workflow has a small, fixed number of
  transitions: open, acknowledge, mitigate, resolve, close, reopen.
- The vocabulary must be **plain English** (or natural Bangla
  translation) so non-technical staff can use it.

## Decision

**Severity is a three-tier field** on every reading-derived event:
`Healthy` | `Warning` | `Critical`. The mapping (Story 3.3) is
threshold-based, versioned, and centralised in the rules engine.

**Incident state is a 7-state machine** with the following transitions:

```
        OPEN ────► ACKNOWLEDGED ────► MITIGATING ────► RESOLVED ────► CLOSED
         │              │                  │                │
         │              │                  │                │
         └──────────────┴──────────────────┴────────────────┘
                              (REOPENED)
```

| State          | Meaning                                                                          |
|----------------|----------------------------------------------------------------------------------|
| `OPEN`         | New alert, no human has seen it.                                                 |
| `ACKNOWLEDGED` | A duty officer has accepted responsibility.                                      |
| `MITIGATING`   | Active work (e.g. flushing pipes, replacing a filter).                            |
| `RESOLVED`     | Readings are back in the healthy range. Verification in progress.                |
| `CLOSED`       | Verified clean. Audit log frozen.                                                |
| `REOPENED`     | A reading post-resolution crossed the threshold again. Back to `MITIGATING`.      |
| `CANCELLED`    | False alarm (sensor fault, deliberate reset). Back to clean state.               |

Three corollaries:

1. **Severity is on the alert, not on the incident.** An incident
   escalates if its alert severity escalates.
2. **State transitions are append-only.** Every transition writes a
   row to `IncidentTransition` with timestamp, actor, and any
   free-text note. The state of the incident is the latest row.
3. **`REOPENED` is not a new incident.** It is a new branch on the
   same `incident_id`, preserving the audit trail.

## Consequences

**Positive**

- Officers learn the vocabulary in one session. The PRD's three
  threshold bands are the only severity decisions.
- The state machine is the only workflow machinery. No BPMN, no
  pipelines, no rule chains.
- The audit trail is complete: every transition has a timestamp, an
  actor, and a note. The security log table is the same shape.

**Negative**

- **Three tiers plus zero means no "informational"** severity. A
  sensor going offline is a `Warning` (something needs attention),
  not a `Healthy`. The dashboard's "sensor offline" badge is the
  affordance for the "informational" tier.
- **Seven states is a lot to enumerate.** Mitigated by the dashboard
  rendering them as a Kanban with explicit columns. Officers do not
  need to memorise the machine; they drag the card.

**Neutral**

- The states and transitions are documented in
  `docs/architecture.md` §5.1. The state machine is also encoded in
  a Zod schema in `packages/shared/src/incident.ts`.

## Reversal

The vocabulary reverses when:

- **A fourth severity tier is required** (e.g. "Catastrophic" for a
  school-wide contamination event). We add a tier, redo the UI
  affordances, and ship a wire contract bump for the new enum value.
- **Two states collide or one state becomes unreachable** in practice.
  We collapse or split based on observed usage.
- **A regulatory regime mandates a different vocabulary** (e.g.
  WHO's own severity tiers). We map to the new vocabulary in the
  export endpoints, not in the internal model.

Until then, three tiers, seven states. Plain English. The vocabulary
is the user contract.