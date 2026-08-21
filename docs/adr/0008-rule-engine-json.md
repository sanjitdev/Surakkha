# 0008 — Rule-based engine with JSON DSL and de-bouncing

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** §4
**Supersedes:** (none)
**Superseded by:** (none)

## Context

The rules engine is the core of Surakkha. Every reading enters, every
alert exits. The decision of *how* rules are expressed is load-bearing
because it determines:

- Who can author a rule (admin? water-safety officer? vendor?)
- How a rule change is audited
- Whether the system can run without network access to a third-party
  service

Three plausible approaches:

1. **Hand-coded thresholds in TypeScript.** Simple, fast, but every
   threshold change is a code change and a deploy.
2. **JSON DSL with operators.** Declarative, serialisable, auditable,
   and version-controlled as data rather than code.
3. **Learned model (regression, decision tree).** Powerful, but
   requires training data, an ML pipeline, and explainability work.
   Wrong fit for v1 where rules are mandated by WHO/BSTI standards.

## Decision

We use a **JSON DSL** with the shape in `docs/architecture.md` §4.1.
Rules are stored per device (or globally with `device_id IS NULL`),
versioned, and audited on change. Evaluation is synchronous, in the
rules engine's process, with two layers of de-bouncing:

- **Min duration**: a reading must remain in violation for at least
  `min_duration_seconds` before the rule can fire.
- **Hysteresis**: after firing, the rule cannot re-fire for
  `hysteresis_seconds` unless the reading crosses back into a
  non-violating state.

Three corollaries:

1. **Rules are data, not code.** Editing a threshold is an
   `UPDATE rules SET value = ? WHERE rule_id = ?` plus an audit log
   row. No deploy.
2. **The DSL is intentionally narrow.** Five operators (`>`, `>=`,
   `<`, `<=`, `==`), three windows (`instant`, `rolling_N_seconds`,
   `rolling_N_readings`), two severities (`warning`, `critical`).
3. **No code execution in rules.** Rules cannot call functions, load
   modules, or reach the network. The DSL is a closed form.

## Consequences

**Positive**

- Water-safety officers (with the right RBAC role) can author and
  tune rules without engineering involvement.
- Rule changes are versioned in the database. The audit log records
  who changed what, when, and the diff.
- The de-bouncing layers prevent alert storms from noisy sensors.
  A flaky pH probe does not page a duty officer every 30 seconds.
- The closed DSL is auditable in a regulatory sense: a regulator can
  read every active rule in plain JSON.

**Negative**

- The DSL cannot express everything a hand-coded rule could. v1
  accepts this limit. v2 may add a `script` operator behind a flag.
- Min-duration + hysteresis tuning is per-rule craft. We ship
  sensible defaults (from the PRD's Story 3.3 thresholds) but each
  deployment will iterate.

**Neutral**

- The engine is in-memory, evaluated per reading. There is no
  pre-computation, no lookup cache. At v1 scale (≤100 devices,
  ≤0.5 Hz each) the cost is negligible.

## Reversal

The JSON DSL reverses when:

- **A rule needs to reference state held outside the current reading**
  (e.g. historical baselines, cross-device comparisons). The DSL is
  extended with a `reference` clause; if that grows past a small
  surface area, we re-evaluate.
- **A learned model is mandated by compliance** (e.g. "the threshold
  must adapt to seasonal baselines"). A model layer is added beside
  the rule layer, not replacing it.
- **A rule evaluation latency** exceeds the alert SLA (NFR-1, ≤3s).
  This is unlikely at v1 scale; if it happens, the engine moves to a
  precompiled form or a rules-database index.

Until then, JSON DSL, de-bouncing on every rule, audit log on every
change. Rules are the audit boundary between the system and its
operators.