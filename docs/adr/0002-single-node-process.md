# 0002 — Single Node process for v1

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** I-9, §2
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Surakkha v1 is scoped to 10–100 devices per deployment
(architecture §2). The workload runs five server-side subsystems:
ingestion, rules engine, alert manager, workflow engine, and background
jobs. Each could plausibly be its own service.

Forces:

- **One small team** is building and operating v1. Splitting into
  microservices means five deploys, five logs, five dashboards, and a
  network boundary between subsystems that already share a memory space.
- **Single-region, single-tenancy.** The v1 deployment is a single
  school-cluster SaaS instance, not a multi-tenant platform.
- **Capacity is the bottleneck, not correctness.** The components are
  CPU-light and I/O-light at the v1 scale.

## Decision

We run **all five subsystems in one Node process** for v1. The internal
boundaries are kept as **module boundaries** (folders, typed interfaces,
unit tests), not as **process boundaries**. We use one Postgres instance
and one Docker container for the api.

When the day comes to split, the module boundaries become the cut
points. The split is mechanical, not architectural.

## Consequences

**Positive**

- One log stream, one process to restart, one Docker image, one port.
- No serialization tax between subsystems (in-process function calls).
- Tests are honest: integration tests run the whole stack in one
  process, no testcontainers for service-to-service mocks.

**Negative**

- A bug in the rules engine can crash ingestion. We compensate with
  per-device try/catch and a process-level uncaught-error handler that
  drains bad frames into a quarantine table.
- Vertical scaling only. We scale by sizing the box, not by adding
  pods. This is fine for v1's expected load.

**Neutral**

- We are not placing bets on Kubernetes, service mesh, or distributed
  tracing. The pill is not swallowed. The pill is rejected.

## Reversal

The single-process design reverses when any of the following holds for
sustained periods, not for one-off spikes:

- Sustained **>2,000 readings/second** across the deployment (device
  fan-out, not one school's worth).
- The **rules engine** must evaluate against state held out-of-process
  (e.g. cross-region aggregation or shared learning models).
- A **compliance regime** requires per-subsystem isolation (e.g. PCI
  scopes the workflow engine away from the rules engine).

When one of these triggers, the cut is between modules, not within
them. The first split is most likely between the **WebSocket ingestion
path** and the **rules/alert/workflow path**, because ingestion is
load-shedding-friendly and the rest is correctness-critical.

Until then, single process. The architecture is the seam; one Node
process is the v1 implementation.
