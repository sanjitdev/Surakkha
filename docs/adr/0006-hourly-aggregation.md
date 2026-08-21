# 0006 — Hourly aggregation cron at 10K rows/run

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** I-15, §5
**Supersedes:** (none)
**Superseded by:** (none)

## Context

The system persists raw `Reading` rows at up to 0.5 Hz per device. With
100 devices, that is ~7.2M rows/day. Querying the raw table for
dashboards ("pH trend for the last 24h") is feasible but expensive,
and the raw rows must be retained for compliance regardless.

Forces:

- Hourly aggregates answer **most** dashboard queries and **all**
  alert-review queries. They are the right shape for the use cases
  in the BRD §13 demo walkthrough.
- Aggregation must be **idempotent and recoverable**. The job must
  survive a process restart and not double-count a row.
- The job runs inside the single Node process (ADR 0002). It cannot
  starve the request path.

## Decision

We run **node-cron** in-process, scheduled at the top of every hour,
aggregating the previous hour's raw `Reading` rows into the
`ReadingHourly` table. The job processes at most **10,000 rows per
run** to bound its CPU and lock footprint. If more than 10K rows
accumulate between runs (because the process was down), the next run
processes them in batches of 10K until caught up.

Three corollaries:

1. **The job is idempotent on `(device_id, hour_bucket)`**. Re-running
   an aggregation overwrites the aggregate row.
2. **Catch-up is bounded**. We track a `last_aggregated_at` watermark.
   On boot, the job inspects the watermark and runs catch-up batches
   before resuming the hourly schedule.
3. **Raw rows are never deleted by the aggregation job.** Retention
   is a separate scheduled task (Story 6.5).

## Consequences

**Positive**

- Dashboard queries hit `ReadingHourly` (≤2400 rows/device/year)
  instead of `Reading` (~315K rows/device/year). Two orders of
  magnitude smaller.
- The job is in-process, so there is no extra deployment, no queue,
  no separate scheduler to monitor.
- 10K rows/run fits comfortably in the single Node process's memory
  and Postgres connection-pool budget (1 connection, ~30s wall time).

**Negative**

- **Aggregate freshness is at most one hour stale.** A real-time
  dashboard showing the "last 5 minutes" still queries `Reading`. This
  is intentional and called out in the dashboard specs.
- **Catch-up after a long outage** can take many runs. If the api
  was down for a day, catch-up is 24 × 10K = 240K rows processed in
  24 sequential batches. Acceptable; visible in the admin ops view.
- **A clock skew between the api host and the cron library** can
  trigger an extra run. Idempotency handles it.

**Neutral**

- The job is a pure cron, not an event-driven pipeline. There is no
  "aggregating as frames arrive" mode in v1.

## Reversal

The hourly cron reverses when any of the following holds:

- **Catch-up takes longer than one hour to clear** after a normal
  restart. That is the cue that 10K rows/run is too small, or that
  the workload has outgrown node-cron.
- **A dashboard query needs minute-level freshness** for compliance
  or operations reasons. We add a `ReadingMinute` aggregation tier
  alongside the hourly one.
- **The single Node process is split** (ADR 0002 reversal). The cron
  becomes a separate worker service or moves to Postgres's
  `pg_cron` extension.

Until then, hourly, in-process, 10K rows/run, idempotent on the hour
bucket. The watermark is the source of truth for what has been
aggregated.