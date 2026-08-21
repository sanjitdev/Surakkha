# 0003 — Postgres-only storage for v1

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** I-10, §5, §7
**Supersedes:** (none)
**Superseded by:** (none)

## Context

The data Surakkha persists splits into four kinds:

1. **Relational data** — users, schools, devices, rules, incidents,
   audit log. Strongly typed, joined, indexed.
2. **Time-series telemetry** — `Reading` rows arriving at up to 0.5 Hz
   per device (rate cap of 1 reading / 2s). High write volume,
   append-mostly.
3. **Aggregates** — hourly rollups of metrics per device. Lower
   volume, more read.
4. **Cache state** — the alert de-bouncing windows, the simulator
   reconnect backoff, the per-device `seq` counters.

It is tempting to assign each kind a specialist store: a time-series DB
for telemetry, an in-memory cache for state, a key-value store for
sessions. That is a real architecture, and a justified one at scale. It
is also a non-trivial operational burden for a one-engineer team
running a single-school-cluster deployment.

## Decision

We use **Postgres 15 for everything in v1**. The schema
(`docs/architecture.md` §5) is one database with partitioned tables for
the time-series data. The "cache state" lives in Postgres with row-level
locks or `SELECT … FOR UPDATE`, not in Redis.

Three corollaries:

1. **Partitioning, not sharding.** `Reading` is range-partitioned by
   month. Old partitions are detached and archived; the working set
   stays small.
2. **No Redis, no Memcached, no message broker.** Not as a
   "not-yet"; as a "we evaluated and said no for v1".
3. **No time-series DB (TimescaleDB, InfluxDB, QuestDB).** Postgres
   handles the v1 write volume comfortably with proper indexing and
   partitioning. Specialist stores earn their keep at 10K+ writes/sec
   sustained; we are nowhere near that.

## Consequences

**Positive**

- One backup story (`pg_dump`), one monitoring surface, one connection
  pool.
- Joins across relational and time-series data are SQL-native. No
  eventual-consistency window between "the incident happened" and "the
  incident is queryable".
- Schema migrations are one tool (`node-pg-migrate`). No polyglot
  persistence to coordinate.

**Negative**

- The alert de-bouncing window and per-device `seq` counters live in
  Postgres. Every check costs a round-trip and a lock. Acceptable at
  v1 scale; a Redis-backed hot path is a clear v2 refactor.
- Heavy analytical queries (e.g. 90-day trend across all devices) can
  starve the OLTP path. We mitigate with read replicas only when v2
  brings cross-deployment analytics.

**Neutral**

- The schema is documented in `docs/architecture.md` §5 in prose
  first. We are not using an ORM as the source of truth.

## Reversal

Postgres-only reverses when any of the following is sustained:

- Sustained **>5,000 writes/sec** to the `Reading` table. At that point
  partitioning alone cannot keep WAL flushes under control, and a
  time-series engine becomes operationally cheaper.
- The de-bouncing path's **p99 latency exceeds 50ms** under load. That
  is the cue to lift the per-device state into Redis or a similar
  hot-path store.
- We need **cross-region replication** for disaster recovery. Then the
  relational core stays in Postgres but the time-series core moves to
  a store with native replication (TimescaleDB, ClickHouse).

Until then, one Postgres. The schema is the contract; the engine is
the implementation.
