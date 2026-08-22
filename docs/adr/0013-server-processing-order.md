# 0013 — Server processing order is load-bearing

**Status:** Accepted (amended 2026-08-22)
**Date:** 2026-08-21 (amended 2026-08-22 to reflect Story 2.1's 10-step pipeline)
**Deciders:** Engineering team
**Related architecture IDs:** §3.2 (steps 1–10), I-1, I-2, I-3
**Supersedes:** (none)
**Superseded by:** (none)

> **Amendment (2026-08-22).** The pipeline was re-specified to 10 steps
> when Story 2.1 codified the wire contract. The amendment folds
> steps 2 (JSON parse) and 4 (path/`device_id` match) of the original
> 9-step order into step 1 (validate) as a single Zod-validation pass,
> and adds three downstream steps owned by later epics: rule
> evaluation (Epic 3), state-machine update + audit append (Epic 4),
> alert emission (Epic 3). The processing-order intent is unchanged:
> every step is load-bearing and the order is fixed.

## Context

Architecture §3.2 specifies a 10-step sequence for processing every
inbound telemetry frame:

1. **Validate** (Zod schema enforcement) → `400 bad_request` with `{error, missing_fields}`. Folds JSON parse, Zod validation, and path/`device_id` match into a single seam.
2. **Auth check** (JWT) → `401 unauthenticated` on fail. Pulled out of step 1 so the auth verifier can short-circuit before any DB work.
3. **Rate check** (`1 reading / 2s` per device) → `429 rate_limited` on fail with `Retry-After` header.
4. **Seq/drop check** (drop if `seq ≤ last_seq`).
5. **Persist** the `Reading` row.
6. **Rule evaluation** (Epic 3) — runs on the persisted row.
7. **Alert emission** (Epic 3) — opens/updates `Alert` records.
8. **State-machine update** (Epic 4) — derives incident state from new alerts.
9. **Audit append** (Epic 5) — appends a row to the audit log.
10. **Socket broadcast** (api → web) — emits `reading:new` to `device:<device_id>` room and `alerts:open` if any alert firings.

The order is not arbitrary. Each step's position relative to the
others is load-bearing in at least one direction, and a refactor that
reorders two adjacent steps can silently break the wire contract.

Forces:

- **Performance pressure**: a future contributor will be tempted to
  reorder for speed. Putting the cheap steps first (validate before
  auth, auth before rate-cap) is the obvious micro-optimisation that
  gets it wrong.
- **Correctness invariants**: steps 2 (auth), 3 (rate cap), and 4 (seq
  check) protect against three different attack/abuse modes. Their
  ordering matters.

## Decision

The 10-step sequence is **fixed**. The wire contract (§3.2) and
`PROCESSING_ORDER` in `packages/shared/src/telemetry.ts` are the
canonical statements; this ADR is the rationale. Each step's
position is justified by one of three reasons: **security**,
**correctness**, or **observability**.

| Step | Why this position |
|------|-------------------|
| 1    | Validate first: collapse JSON parse + Zod + path/device_id match into one Zod pass so the failure mode is a single `bad_request` envelope. ADR 0001 + the spec I/O Matrix pins the contract. |
| 2    | Auth check is performed **at connection level** in `buildIngestServer#verifyIngestClaims` (Story 2.2): the WS upgrade is claim-driven, so the per-frame step is a documented no-op today (`stepAuthCheck` returns `{ kind: "next" }`). A future per-frame auth-refresh check (e.g. mid-connection token rotation) slots into this step without re-ordering the pipeline. JWT failure at handshake is `auth_error {error:"device_id_mismatch"}` (or `unauthenticated` for missing/malformed-UUID/missing-token), distinct from validation's `400`. |
| 3    | Rate cap third: protects the database from bursts before they reach step 4 (which writes) and step 5 (which also writes). |
| 4    | Seq check fourth: drops dupes/replays **after** rate cap so a `429`-bypassed burst still cannot rewind `seq`. |
| 5    | Persist fifth: the `Reading` row is the authoritative record. All downstream steps read it. |
| 6    | Rules sixth: must run on a persisted row so a process restart mid-evaluation does not lose state. |
| 7    | Alert emission seventh: derived from rule output; runs after the row is durably stored. |
| 8    | State-machine update eighth: derives incident state from new alerts. |
| 9    | Audit append ninth: appends a row to the audit log for the entire pipeline run. |
| 10   | Broadcast tenth: only successful frames are broadcast; rate-limited, seq-dropped, and rule-failed frames are silent. |

Three corollaries:

1. **The response code carries information.** Each step has a distinct
   response (`400`, `401`, `429`). Reordering 2 and 3 would collapse
   `401 unauthenticated` and `429 rate_limited` into a single error
   class for clients that key behaviour on the code.
2. **Rate cap before seq check.** A misordered pair would let an
   attacker with a valid JWT flood the api with `seq=0..999999` and
   cause the seq check to drop most of them, masking the rate-limit
   abuse. Step 3 first stops the flood.
3. **Persist before broadcast.** If we broadcast before persist, a
   process crash between the two leaves the dashboard showing a
   reading that does not exist in the database. The reverse order
   means a crash before broadcast only loses the live update; the
   `Reading` row is still there, and the next REST query will pick it
   up.

## Consequences

**Positive**

- Performance optimisations are constrained to **within** a step, not
  across steps. A future contributor can replace step 1 with a faster
  Zod variant; they cannot move step 1 after step 2.
- The error codes are stable. A firmware team building retry logic on
  `429` does not need to worry about step reordering silently changing
  the meaning.
- Failure-mode reasoning is straightforward: if step N fails, steps
  N+1..10 do not run.

**Negative**

- **Step 3 (rate cap) requires a per-device counter in Postgres**
  (or a hot cache). It is the most expensive step on the hot path.
  We accept this; it is the price of correctness.
- **Optimisations that span multiple steps** are forbidden. For
  example, we cannot batch validate + auth into a single pass without
  first pinning the result of step 1 before step 2 looks at it.
- **The sequence is not visible from one file.** It is split across
  the ingestion handler (steps 1, 5, 10), the JWT verifier (step 2),
  the per-device rate-limit middleware (step 3), the per-device seq
  tracker (step 4), and the typed no-op hooks for steps 6–9 (Epic 3+
  fill these in). A refactor that consolidates them must preserve the
  order. The integration tests (`__tests__/e2e/`) assert the order by
  injecting failure at each step and verifying the response code; the
  shared-package test (`packages/shared/src/__tests__/telemetry.spec.ts`
  "PROCESSING_ORDER" describe block) pins the literal against the ADR.
- **Steps 6–9 are deferred to later epics.** Stories 2.1/2.2 implement
  steps 1–5 + 10 with typed no-op hooks for steps 6–9; Epic 3 fills
  in 6 + 7, Epic 4 fills in 8, Epic 5 fills in 9. The 10-step contract
  is pinned at the seam today so the later work has a stable shape.

**Neutral**

- The order is the same for the simulator and real devices. The
  simulator does not get a "fast path".

## Reversal

The processing order reverses when:

- **The wire contract itself is bumped** (ADR 0001). A `version: 2`
  frame may have different processing needs; the new sequence lives
  in the v2 contract.
- **A new threat model** changes which step gates which abuse. For
  example, if `seq` is replaced by a timestamp-based ordering, step 4
  changes shape (still position 4, but different logic). The position
  is what is load-bearing, not the implementation.
- **The hot path becomes a real bottleneck** (>5,000 frames/sec
  sustained) and a multi-stage pipeline is required. The split is
  between steps 5 and 6 (persist vs evaluate), not between 1 and 3.

Until then, 10 steps, fixed order, distinct response codes. The order
is part of the contract.
