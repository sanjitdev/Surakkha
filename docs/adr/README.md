# Surakkha — Architecture Decision Records

This directory captures the **why** behind the load-bearing decisions in
[`docs/architecture.md`](../architecture.md). Each ADR is a self-contained
proposal that was either accepted, superseded, or rejected.

## What goes in an ADR

Architecture §1 defines a load-bearing decision as one where two engineers,
building independently, could plausibly choose incompatibly. Those are
the only decisions that earn an ADR. Other decisions live in code and
comments.

## Status

| Status      | Meaning                                                            |
|-------------|--------------------------------------------------------------------|
| `Accepted`  | Decision is in force for v1.                                       |
| `Superseded`| Replaced by a later ADR (link to it).                              |
| `Deprecated`| No longer applies (feature removed).                               |
| `Proposed`  | Draft; awaiting decision.                                          |
| `Rejected`  | Considered and explicitly rejected; recorded so we don't relitigate. |

## Index

| ADR                              | Title                                                | Status   | Architecture ID |
|----------------------------------|------------------------------------------------------|----------|------------------|
| [0001](./0001-wire-contract-first.md) | Wire-contract-first design                            | Accepted | I-1              |
| [0002](./0002-single-node-process.md) | Single Node process for v1                           | Accepted | I-9              |
| [0003](./0003-postgres-only.md)       | Postgres-only storage for v1                          | Accepted | I-10             |
| [0004](./0004-hs256-single-secret.md) | HS256 with a single JWT_SECRET                        | Accepted | I-13             |
| [0005](./0005-plain-ws-v1.md)         | Plain ws:// for v1 telemetry                          | Accepted | I-14             |
| [0006](./0006-hourly-aggregation.md)  | Hourly aggregation cron at 10K rows/run               | Accepted | I-15             |
| [0007](./0007-monorepo-layout.md)     | Monorepo with pnpm workspaces                         | Accepted | n/a (workspace)  |
| [0008](./0008-rule-engine-json.md)    | Rule-based engine with JSON DSL + de-bouncing         | Accepted | §4               |
| [0009](./0009-severity-and-states.md) | Three-tier severity and 7-state incident machine      | Accepted | §5.1             |
| [0010](./0010-device-id-in-path.md)   | Device-id encoded in WebSocket path                   | Accepted | §3.3             |
| [0011](./0011-rbac-middleware.md)     | RBAC as `(subject, action, resource)` middleware      | Accepted | §8.3, I-3, I-4   |
| [0012](./0012-audit-log-invariants.md) | Audit log is append-only and exhaustive               | Accepted | §5, §8.3         |
| [0013](./0013-server-processing-order.md) | Server processing order is load-bearing            | Accepted | §3.2, I-1, I-2   |
| [0014](./0014-ai-agent-guardrails.md) | AI-agent guardrails as code (AGENTS.md + ESLint + PR checklist) | Accepted | (workspace policy) |

## How to read these

Read in order. Each ADR answers four questions:

1. **Context** — what was the situation when we decided?
2. **Decision** — what did we choose?
3. **Consequences** — what becomes easier and harder?
4. **Reversal** — under what conditions would we revisit?

The reversal section is the most important: it bounds when the decision
stops applying. Most v1 simplifications are relaxed in v2 — that's
documented here, not in code.

## How to add a new ADR

1. Copy `template.md` to `NNNN-short-title.md` (next four-digit number).
2. Fill the four sections. Keep it under 200 lines.
3. Add a row to the index table above.
4. Reference the architecture ID(s) in the front-matter.
5. Commit with `docs: ADR NNNN — <title>`.
