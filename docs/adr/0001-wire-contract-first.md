# 0001 — Wire-contract-first design

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** I-1, NFR-14, §3
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Surakkha ships three distinct runtime processes — the **api** (rules engine,
workflow, REST/WS), the **simulator** (telemetry source), and the **web**
dashboard — plus a future device firmware that does not exist yet. The
firmware team is a separate organization. They have no working code, no
shared repo, and no shared schema. The day firmware lands, our server
must accept its frames without a coordinated release.

Architecture §1 calls out the load-bearing decisions as the ones where
two engineers, building independently, could plausibly choose
incompatibly. The telemetry frame schema is exactly such a decision: it
sits at the boundary between processes owned by different teams.

## Decision

We treat the **wire contract as the seam**. The frame schema,
field-by-field, is locked in `docs/architecture.md` §3.2, codified as a
Zod schema in `packages/shared/src/telemetry.ts`, versioned with a
top-level `version` integer, and any change is a contract bump that
requires simultaneous updates on both sides of the seam.

Three corollaries:

1. **No new metric keys in v1.** All v1 metrics are listed in §3.2.
   Unknown keys are ignored (forward-compat), not rejected (strict).
2. **`version: 1` is hard-coded.** Unknown versions rejected with
   `400 invalid_version`. Bumping to `2` is a deliberate cut-over.
3. **The contract lives in `docs/architecture.md` first.** Code is a
   reflection of the document, not the other way around. Architecture
   changes go through review; code edits follow.

## Consequences

**Positive**

- Firmware and server teams can develop in parallel against the same
  schema.
- Contract drift is detectable: every frame carries `version`, so an
  out-of-spec device is rejected at the edge with a clear error code.
- The same Zod schema validates inbound frames, builds outbound
  payloads, and generates the type definitions consumed by `packages/web`
  and the simulator. One source of truth.

**Negative**

- Every feature that touches the wire is a multi-package change. Adding
  a metric is a contract bump, not a one-line edit.
- The shared Zod schema is now part of the critical path: every release
  must rebuild it.

**Neutral**

- We accept the v1 metric set (six metrics) as the seed of the
  two-layer schema from BRD §10.1. v2 may grow the metric registry
  without changing the frame shape.

## Reversal

The contract becomes a problem only when a future requirement cannot
be expressed as an additive change to the existing fields. Triggers:

- A new device class produces fundamentally different data (e.g. video,
  continuous spectra). At that point, a new contract `version: 2` is
  cut, with the old contract supported for one release cycle.
- Compliance requires per-frame cryptographic signing or end-to-end
  attestation. That is not a contract version bump; it is a transport
  change (see ADR 0005).

Until one of those triggers, the wire-contract-first design is the
default. There is no "v1.5" of the contract.
