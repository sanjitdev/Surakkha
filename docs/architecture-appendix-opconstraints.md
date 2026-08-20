# Surakkha — Operational Constraints Register

> **Purpose.** List the v1 deliberate simplifications (architecture §8.2 I-9..I-15) so that no future contributor — human or AI coding agent — mistakes a v1 simplification for a durable decision.
>
> Source: Story 6.7 (`_bmad-output/planning-artifacts/epics.md` §6.7).
> Companion to: `docs/architecture.md` (the architecture substrate).

---

## How to read this document

Each constraint is a footprint of v1, not a guarantee. The architecture document calls them out as invariants, but they are *operational* invariants — deliberate choices for the single-process, single-secret, single-host v1. They may be relaxed in v2 without a wire-contract bump.

If a future change wants to keep one of these constraints, treat it as a new architectural decision and document it under architecture §8 with a new `I-N` ID. Do not silently re-introduce a v1 simplification as a v2 default.

The voice discipline is the same as the rest of the product: short sentences, no exclamation marks, no marketing copy. Each constraint's "do not mistake" warning is intentionally brief.

---

## I-9 — Single Node process

**What it is.** The api process carries ingestion, the rules engine, the alert manager, the workflow engine, and the hourly cron in one Node process. There is no separate worker process, no separate scheduler, no separate queue consumer.

**Why it is here.** For 10–100 devices, the workload fits comfortably in one process. The simulator is the only intentionally separate Node process (because it must run on the same wire contract as a real device, AR-12).

**v1 posture.**

- One `package.json` `start` script in `packages/api`.
- One `node-cron` schedule for retention; no external scheduler.
- One `process.on('SIGTERM')` shutdown handler.
- Horizontal scaling is **not** supported in v1.

**Do not mistake for durable.** *"This is a single-process app, and that is how it must stay."* In v2, ingestion may split from the rules engine behind a pub/sub seam. The seam is the wire contract (§3); the api process is the v1 implementation of it.

**Code-comment snippet (copy-paste into v1 modules):**

```ts
// v1 constraint (architecture I-9): single Node process for api + ingestion +
// rules + alerts + workflow + cron. The seam for splitting in v2 is the wire
// contract (packages/shared/src/telemetry.ts), not this process model.
```

---

## I-10 — Postgres only

**What it is.** Surakkha uses Postgres 15 and Postgres 15 only. No Redis, no message queue, no time-series database, no search index.

**Why it is here.** Six devices and a 30-day rolling window fit in a single Postgres instance. The hourly retention aggregation caps at 10,000 rows per run (I-15), which keeps the working set bounded.

**v1 posture.**

- All state, including audit log and aggregated readings, lives in Postgres.
- The simulator's reconnect buffer is in memory (5,000 readings, FR-9).
- No external services are listed in `docker-compose.yml`.

**Do not mistake for durable.** *"We do not need Redis or a queue because we have Postgres."* Postgres is a bottleneck for v2's pub/sub layer or session cache. The v1 simplification is the right call for the demo; v2 may add Redis or a queue without a wire-contract bump.

**Code-comment snippet:**

```ts
// v1 constraint (architecture I-10): Postgres only. No Redis, no MQ, no TSDB.
// v2 may add a pub/sub layer; the wire contract stays the same.
```

---

## I-13 — HS256 single secret, no rotation

**What it is.** JWTs are signed with HS256 and a single `JWT_SECRET` env var. There is no `JWT_PUBLIC_KEY`, no JWKS endpoint, no key rotation policy.

**Why it is here.** A single-process v1 with one api signatory does not need asymmetric keys. The invariant test in Story 1.10 asserts the api never reads a `JWT_PUBLIC_KEY` env var.

**v1 posture.**

- `JWT_SECRET` is a single env var, ≥ 32 characters.
- The api process fails fast on a missing or weak `JWT_SECRET` (Story 1.4 AC).
- An invariant test (`__tests__/auth.no-rotation.spec.ts`) prevents accidental JWKS introduction.
- HS256 is the only allowed signing algorithm.

**Do not mistake for durable.** *"This codebase is HS256-only forever."* Asymmetric signing (RS256 / EdDSA) and key rotation are v2 (FR-25, NFR-7). Any PR that introduces JWKS support must include a v2-bump justification in its description.

**Code-comment snippet:**

```ts
// v1 constraint (architecture I-13): HS256 single secret, no rotation.
// v2 introduces JWKS / RS256. Do not introduce a JWT_PUBLIC_KEY env var
// without a v2-bump justification in the PR description.
```

---

## I-14 — Plain `ws://` transport, no mTLS

**What it is.** Devices and the simulator connect to the api over plain `ws://`. There is no per-connection mTLS, no per-frame signing, no client-certificate authentication.

**Why it is here.** The demo runs on a developer laptop. The simulator and the api live on the same Docker Compose network. Production deployments terminate TLS at a reverse proxy.

**v1 posture.**

- The api listens on `ws://0.0.0.0:3000/ingest/{device_id}`.
- The simulator connects to the same path.
- No client certificates; no per-frame signing.
- `JWT_SECRET` authenticates the WebSocket upgrade.

**Do not mistake for durable.** *"Plain `ws://` is fine for production."* It is **not** fine for production. A production deployment must terminate TLS at a reverse proxy and reject plain `ws://` traffic at the network edge. v2 may add mTLS or per-frame signing (NFR-7).

**Code-comment snippet:**

```ts
// v1 constraint (architecture I-14): plain ws://. Production deployments
// must terminate TLS at a reverse proxy. Do not route plain ws:// traffic
// over the public internet.
```

---

## I-15 — Hourly cron retention, max 10,000 rows per run

**What it is.** The hourly retention + aggregation cron runs once per hour, capped at 10,000 rows per run. The cron is idempotent and cursor-based; a second invocation while the first is running exits with `outcome: "skipped_overlap"` (Story 5.5 AC).

**Why it is here.** The 30-day retention plus 5-minute aggregation is bounded: at 6 devices × 1 reading / 2s × 30 days × 6 metrics, the working set is small. A 10,000-row cap keeps the cron fast and predictable.

**v1 posture.**

- `RETENTION_CRON` env var controls the schedule (default: hourly).
- The cron selects raw readings older than 30 days in batches of ≤ 10,000 rows.
- For each `(device_id, metric, 5-minute bucket)`, the cron inserts a `ReadingAggregate` row with mean/min/max/sample_count.
- The original raw rows are deleted in the same transaction.
- A `cron_runs` row records `started_at`, `finished_at`, `aggregated_rows`, `deleted_rows`, `outcome`.
- A second invocation is gated by a `SELECT ... FOR UPDATE` lock on the `cron_runs` row or a `cron.lock` advisory lock.

**Do not mistake for durable.** *"Cron-driven retention is the right answer for any volume."* It is the right answer for v1's volume. v2 may swap to a continuous aggregation worker (e.g. Materialize, ClickHouse, or a streaming pipeline) without a wire-contract bump.

**Code-comment snippet:**

```ts
// v1 constraint (architecture I-15): hourly cron, max 10,000 rows per run.
// Idempotent + cursor-based. v2 may swap to a continuous aggregation worker.
```

---

## What this register does NOT cover

The I-N series that are **durable invariants** (not v1 simplifications):

- **I-1 (wire contract).** `version: 1` is frozen. Edits to `packages/shared/src/telemetry.ts` are a contract bump.
- **I-2 (rate limit).** 1 reading / 2s per device with `429 Retry-After` is the contract. Devices MUST honour the rate limit.
- **I-3 (JWT claims).** `iss: surakkha-api`, `aud: device | simulator`, `scope` is the contract.
- **I-4 (simulator scope).** Simulator JWTs have `scope: telemetry:write` only. They cannot reach admin endpoints.
- **I-5 (rule types).** Three rule types: `instant`, `rate`, `absence`. Anything else is rejected at registration.
- **I-6 (severity-from-rule).** Severity is set by the rule, not inferred.
- **I-7 (transition table).** The 7-state incident machine is the source of truth.
- **I-8 (defaults from seed).** The WHO / BSTI default thresholds are seeded, never computed at runtime.
- **I-11 (webhook-style events).** `reading:new`, `alert:opened`, `alert:acknowledged`, `incident:updated`, `incident:state_changed`, `notification:critical` are the wire-level event names.
- **I-12 (simulator is real client).** The simulator connects to `/ingest/{device_id}` like a real device. No back-door endpoints.

These are *durable* invariants. They are documented in `docs/architecture.md` §8.

---

## How to update this register

When a v1 constraint is relaxed in v2:

1. Remove the constraint from this document.
2. Add a new `I-N` invariant to `docs/architecture.md` §8 with the new posture.
3. Note the change in `CHANGELOG.md` under the v2 release.
4. Update Story 6.7's "Covers:" line to reference the new contract.

When a v1 constraint needs to be tightened further in v1.x (e.g., a stricter rate limit), treat it as a patch release and update the constraint's "v1 posture" section here.