# 0013 — Server processing order is load-bearing

**Status:** Accepted
**Date:** 2026-08-21
**Deciders:** Engineering team
**Related architecture IDs:** §3.2 (steps 1–9), I-1, I-2, I-3
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Architecture §3.2 specifies a 9-step sequence for processing every
inbound telemetry frame:

1. Auth check (JWT) → `401 unauthenticated`
2. JSON parse → `400 invalid_json`
3. Zod schema validation → `400` with `{error, missing_or_invalid}`
4. Path / `device_id` match → `403 device_id_mismatch`
5. Rate cap (`1 reading / 2s` per device) → `429 rate_limited`
6. Sequence check (drop if `seq ≤ last_seq`)
7. Persist `Reading` row
8. Evaluate rules
9. Broadcast via Socket.IO room

The order is not arbitrary. Each step's position relative to the
others is load-bearing in at least one direction, and a refactor that
reorders two adjacent steps can silently break the wire contract.

Forces:

- **Performance pressure**: a future contributor will be tempted to
  reorder for speed. Putting the cheap steps first (parse before
  validate, validate before rate-cap) is the obvious micro-optimisation
  that gets it wrong.
- **Correctness invariants**: steps 4 (path/JWT match), 5 (rate cap),
  and 6 (seq check) protect against three different attack/abuse
  modes. Their ordering matters.

## Decision

The 9-step sequence is **fixed**. The wire contract (§3.2) is the
canonical statement; this ADR is the rationale. Each step's position
is justified by one of three reasons: **security**, **correctness**,
or **observability**.

| Step | Why this position                                                                                       |
|------|---------------------------------------------------------------------------------------------------------|
| 1    | Auth first: nothing about a frame is meaningful without knowing whose frame it is.                      |
| 2    | Parse second: cannot validate JSON that has not been parsed; cannot enforce schema on a string.        |
| 3    | Validate third: cannot enforce field contract before Zod has decoded the object.                       |
| 4    | Path/JWT match fourth: a JWT with `sub=device-A` connecting to `/ingest/device-B` is **a different** error class from validation failure — `403` vs `400`. |
| 5    | Rate cap fifth: protects the database from bursts before they reach the seq-check (which writes).        |
| 6    | Seq check sixth: drops dupes/replays **after** rate cap so a `429`-bypassed burst still cannot rewind `seq`. |
| 7    | Persist seventh: the `Reading` row is the authoritative record. All downstream steps read it.            |
| 8    | Rules eighth: must run on a persisted row so a process restart mid-evaluation does not lose state.       |
| 9    | Broadcast ninth: only successful frames are broadcast; rate-limited and seq-dropped frames are silent.    |

Three corollaries:

1. **The response code carries information.** Each step has a distinct
   response (`401`, `400`, `403`, `429`). Reordering 4 and 5 would
   collapse `403 device_id_mismatch` and `429 rate_limited` into a
   single error class for clients that key behaviour on the code.
2. **Rate cap before seq check.** A misordered pair would let an
   attacker with a valid JWT flood the api with `seq=0..999999` and
   cause the seq check to drop most of them, masking the rate-limit
   abuse. Step 5 first stops the flood.
3. **Persist before broadcast.** If we broadcast before persist, a
   process crash between the two leaves the dashboard showing a
   reading that does not exist in the database. The reverse order
   means a crash before broadcast only loses the live update; the
   `Reading` row is still there, and the next REST query will pick
   it up.

## Consequences

**Positive**

- Performance optimisations are constrained to **within** a step, not
  across steps. A future contributor can replace step 3 with a
  faster Zod variant; they cannot move step 3 before step 1.
- The error codes are stable. A firmware team building retry logic
  on `429` does not need to worry about step reordering silently
  changing the meaning.
- Failure-mode reasoning is straightforward: if step N fails, steps
  N+1..9 do not run.

**Negative**

- **Step 5 (rate cap) requires a per-device counter in Postgres**
  (or a hot cache). It is the most expensive step on the hot path.
  We accept this; it is the price of correctness.
- **Optimisations that span multiple steps** are forbidden. For
  example, we cannot batch the parse + Zod validate into a single
  pass without first pinning the result of step 2 before step 3
  looks at it.
- **The sequence is not visible from one file.** It is split across
  the ingestion handler, the validation middleware, the rate-limit
  middleware, and the seq-check helper. A refactor that consolidates
  them must preserve the order. The integration tests
  (`__tests__/e2e/`) assert the order by injecting failure at each
  step and verifying the response code.

**Neutral**

- The order is the same for the simulator and real devices. The
  simulator does not get a "fast path".

## Reversal

The processing order reverses when:

- **The wire contract itself is bumped** (ADR 0001). A `version: 2`
  frame may have different processing needs; the new sequence lives
  in the v2 contract.
- **A new threat model** changes which step gates which abuse. For
  example, if `seq` is replaced by a timestamp-based ordering, step 6
  changes shape (still position 6, but different logic). The
  position is what is load-bearing, not the implementation.
- **The hot path becomes a real bottleneck** (>5,000 frames/sec
  sustained) and a multi-stage pipeline is required. The split is
  between steps 7 and 8 (persist vs evaluate), not between 1 and 5.

Until then, 9 steps, fixed order, distinct response codes. The order
is part of the contract.
