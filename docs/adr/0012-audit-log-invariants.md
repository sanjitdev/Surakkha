# 0012 — Audit log is append-only and exhaustive

**Status:** Accepted
**Date:** 2026-08-21
**Deciders:** Engineering team
**Related architecture IDs:** §5 (data model), §8.3, §3.2, §4.1, §6.2
**Supersedes:** (none)
**Superseded by:** (none)

## Context

The audit log appears in five places in the architecture document:

- §5 — data model: `AuditLog` table shape
- §3.2 — implicitly via the wire contract: every accepted frame is a
  record, but not necessarily an audit row
- §4.1 — rules are "audit-logged on change"
- §6.2 — every simulator scenario start/stop emits a `__simulator_event`
  audit entry
- §8.3 — failed authorization attempts write an audit row

Plus `SECURITY.md` treats the audit log as a load-bearing part of the
threat model ("coordinated disclosure", "audit log frozen" on
incident close).

There is a real decision here, and it is not in the architecture
document: **what gets logged, and what does not**. The wrong choice
silently weakens the regulatory posture. The right choice is
exhaustive for security-relevant events and silent for everything
else.

Forces:

- **Regulatory expectation** (government primary schools, BSTI
  source-of-truth): every change to a threshold, every state
  transition on an incident, every login, every authorisation failure
  must be reconstructable from the audit log.
- **Volume**: at 0.5 Hz per device, raw `Reading` rows are 7.2M/day
  per 100 devices. Logging every reading to the audit table would
  dwarf the relational data and break the partitioning strategy.
- **Performance**: an audit-log write inside a hot path (e.g. every
  accepted frame) is a real cost. It must be justified.

## Decision

The audit log is **append-only** and **exhaustive for
security-relevant events**. The exhaustive list is enumerated; nothing
outside the list is logged.

**Logged (every occurrence, every time):**

- Authentication events: `user.login`, `user.logout`,
  `user.token_expired`, `device.token_expired`
- Authorization failures: any `403 forbidden` (ADR 0011)
- Rule changes: `rule.created`, `rule.updated`, `rule.deleted`,
  including the before/after diff
- Incident state transitions: every transition in the 7-state
  machine (ADR 0009), with `actor_user_id` and any free-text note
- Threshold defaults overridden: `seed.threshold_override` with the
  diff against the BRD §8.3.1 baseline
- Simulator events: `__simulator_event` for every scenario start/stop
  (§6.2)
- Audit-log access: `auditlog.viewed` (the act of reading the audit
  log is itself audited)

**Not logged:**

- Raw `Reading` rows. The `Reading` table is the authoritative record
  of telemetry; the audit log would only duplicate it.
- Every accepted WebSocket frame. The frame is dropped after the
  `Reading` row is written (ADR 0013 step 7).
- Per-frame authentication. A single `device.connected` /
  `device.disconnected` event covers the connection lifecycle.
- Page-view traffic on the web dashboard. The web dashboard's own
  access log is sufficient.

Three corollaries:

1. **The audit log is not editable.** Even `Admin` cannot `UPDATE` or
   `DELETE` an `AuditLog` row. Database-level enforcement uses a
   trigger that rejects `UPDATE` and `DELETE` on the table.
2. **Audit log writes are best-effort durable, not transactional.**
   A rule change commits the rule change and the audit row in the
   same transaction (so the audit trail cannot be split). A
   `403 forbidden` audit row is written with `try/catch`; if the
   audit write itself fails, the request is still rejected (security
   takes precedence) but the failure is logged via a separate
   `auditlog.write_failed` alarm.
3. **Audit log retention is the same as the rest of the data.** The
   retention scheduled task (Story 6.5) keeps audit rows for the
   regulatory minimum (TBD; defaults to 7 years for v1, matching the
   WHO/BSTI guidance in BRD §8.3.1).

## Consequences

**Positive**

- The regulatory posture is unambiguous: every action that affects
  thresholds, incidents, or access is auditable. The list is closed,
  not open-ended.
- The audit log is small relative to telemetry. We estimate
  ≤10K audit rows/day per 100 devices, vs 7.2M `Reading` rows/day.
- The append-only constraint is enforced at the database layer, not
  by application discipline. A bug in the api cannot corrupt the
  audit trail.

**Negative**

- **The exhaustive list can drift.** We add a new security-relevant
  event in code and forget to add it to the list. We mitigate with
  a CI test that fails if any `INSERT INTO audit_log` call site uses
  an `action` not in the list.
- **`auditlog.write_failed` is a rare alarm path** that needs its
  own monitoring. If it fires, the security model is degraded.
- **Audit log access is itself audited.** A malicious `Admin` cannot
  read the audit log without leaving a trail.

**Neutral**

- The audit log is Postgres, not a separate store. ADR 0003 applies;
  if Postgres is replaced, the audit log goes with it.

## Reversal

The audit-log-as-invariants reverses when:

- **A compliance regime mandates a separate audit store** (e.g. an
  immutable WORM bucket, AWS QLDB). We replicate audit rows to the
  separate store inside the same transaction.
- **The audit log volume grows beyond Postgres's comfort zone**
  (>100M rows/year). We partition the `AuditLog` table by month and
  move old partitions to cold storage; the append-only constraint
  is preserved.
- **Real-time audit access** is required (e.g. "show me every action
  by user X in the last 5 minutes" with sub-second latency). We add
  a read replica and a per-user index; the write path stays the same.

Until then, append-only, enumerated, partitioned alongside the
relational data. The audit log is the regulatory boundary between
the system and its operators.
