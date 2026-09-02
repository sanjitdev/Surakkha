# Critique — `packages/api/src/ingest`

**Date:** 2026-09-02
**Surface:** `packages/api/src/ingest/` (6 source files: `frame.ts` 429 LOC, `server.ts` 156 LOC, `hooks.ts` 98 LOC, `subscriber.ts` 66 LOC, `sequence.ts` 64 LOC, `rateLimit.ts` 44 LOC)
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File              | LOC     | Heuristic score    | Findings                                          |
| ----------------- | ------- | ------------------ | ------------------------------------------------- |
| `frame.ts`        | 429     | 18/40              | 1 P1 (8-line header), 6 P2                        |
| `server.ts`       | 156     | 22/40              | 1 P1 (12-line header + first-person plural), 4 P2 |
| `hooks.ts`        | 98      | 21/40              | 1 P1 (15-line header), 5 P2                       |
| `subscriber.ts`   | 66      | 22/40              | 1 P1 (13-line header), 4 P2                       |
| `sequence.ts`     | 64      | 23/40              | 1 P1 (25-line header), 3 P2                       |
| `rateLimit.ts`    | 44      | 24/40              | 1 P1 (20-line header), 2 P2                       |
| **Surface total** | **857** | **22/40 weighted** | **6 P1, 24 P2**                                   |

The ingest surface is the second-densest AI-slop concentration in the api package. Five distinct anti-patterns recur:

1. **Headers of 8-25 lines re-narrating the spec.** `frame.ts` opens with an 8-line header (the only one under the limit), but the other 5 files open with 12-25 line narrative headers that re-tell the contract.
2. **First-person plural ("we use", "let's")** in `server.ts:33-34` ("We use `unknown` at the seam so tests can pass a stub…").
3. **Cross-file line refs** that break on every refactor: `frame.spec.ts` (×3), `boot/db.ts` (server.ts), `rules/cache.ts` (frame.ts).
4. **Story / AC / patch / distill markers** — `Story 2.2`, `Story 2.3`, `Story 2.6`, `Story 3.2`, `AC-N`, `Patch (code review YYYY-MM-DD #N)`, "distilled YYYY-MM-DD (was inline in src/index.ts:N-M)".
5. **Narrative rationale blocks** of 5+ lines that restate the function body.

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

1. **`server.ts:33-34` — first-person plural "We use `unknown` at the seam…"**. The prose-linter rule `hedge-we-use` flags this. The JSDoc reads as AI commentary ("the code, not 'we', is the subject"). Rewrite in passive voice.

2. **`server.ts:1-11` — 11-line header re-narrating the WS-upgrade contract + URL-claim authority + room naming.** The contract is the `buildIngestServer` signature; the header adds nothing.

3. **`hooks.ts:1-15` — 15-line header re-narrating the 10-step driver contract + Epic 3/4/5 boot integration + the typed-narrow-interface rationale.** The `IngestHooks` interface + `setIngestHooks` / `getIngestHooks` signatures are self-documenting.

4. **`subscriber.ts:1-13` — 13-line header re-narrating Story 2.6 + the sentinel-segment-vs-namespace design + read-only-by-construction semantics.** The `SUBSCRIBER_PATH_SEGMENT` constant + `handleSubscriberConnection` signature carry the meaning.

5. **`sequence.ts:1-24` — 24-line header citing Story 2.2 + Architecture §3.2 step 6 + I-9 single-process invariant + the FIRST_FRAME case.** The `INITIAL_LAST_SEEN = -1` constant + `observe()` signature carry the meaning.

6. **`rateLimit.ts:1-20` — 20-line header citing Story 2.2 + Architecture §3.2 step 5 + I-9 + the `nowMs` parameter rationale.** Keep the `nowMs` rationale (load-bearing for vitest fake timers); drop the Story / Architecture / I-9 markers.

### P2 — Apply before merge, won't block on its own

1. **`frame.ts:25-29`** — 5-line `ReadingRepository` JSDoc citing "Tests inject a stub that satisfies this surface; production code passes the real `@prisma/client` Reading delegate." Drop cross-file reference; the type signature carries the meaning.

2. **`frame.ts:96-101`** — 6-line `READINGS_LATEST_ROOM` JSDoc re-narrating the dashboard fan-out + the "LATEST state via REST on cold load" rationale. Keep one canonical reference at the top of the file; drop the rest.

3. **`frame.ts:104-107`** — 4-line `StepResult` JSDoc re-narrating the `next` vs `exit` arms + the `no-param-reassign` lint rule. The discriminated union + type alias are self-documenting.

4. **`frame.ts:323-326`** — 4-line inline comment re-narrating the per-device-vs-readings:latest broadcast. The two `emit` calls immediately below show the same content.

5. **`frame.ts:345-348`** — 4-line inline comment re-narrating the `serverReceivedAt` source-of-truth pin. The variable name + `now()` call are self-documenting.

6. **`frame.ts:370-374`** — 5-line `eslint-disable complexity` rationale + 6-line `dispatchStep` JSDoc re-narrating the lint cap. The lint config has the cap once; the surface needs one canonical reference, not 2.

7. **`server.ts:48-54`** — 7-line `parseDeviceIdFromHandshake` JSDoc re-narrating `auth.device_id` vs URL priority + the legacy backward-compat rationale. The function body shows the priority.

8. **`server.ts:67-68`** — 2-line `extractToken` JSDoc re-narrating `auth.token` vs `?token=` priority. The function body shows the priority.

9. **`server.ts:77`** — 1-line `buildIngestServer` JSDoc. Drop; the signature is self-documenting.

10. **`server.ts:108-116`** — 9-line inline comment re-narrating the 4-way `verifyIngestClaims` failure-mode differentiation. The `if/else` immediately below shows the same content.

11. **`server.ts:131-136`** — 6-line inline comment re-narrating the bidirectional-writes-only contract + the `.catch` rationale. The `.catch` block immediately below shows the same content.

12. **`hooks.ts:31-33`** — 3-line `flags` JSDoc re-narrating the closed-enum rationale. The `readonly ReadingFlag[]` type is self-documenting.

13. **`hooks.ts:60-63`** — 4-line `onRuleEvaluation` JSDoc re-narrating the `Promise<readonly BreachResult[]>` extension + the no-op `EMPTY_BREACH_RESULTS` rationale. The return type + the `noopHooks` implementation show the same content.

14. **`hooks.ts:77-80`** — 4-line `NOOP_HOOKS` JSDoc citing the boot fallback + the test-rig use case. The export name + the `noopHooks` definition show the same content.

15. **`hooks.ts:88-90`** — 3-line `setIngestHooks` JSDoc re-narrating the no-concurrent-safety contract. The function body shows the contract.

16. **`subscriber.ts:18-21`** — 4-line `SUBSCRIBER_ROOM` JSDoc citing cross-file ref to `frame.ts`. Replace with a single canonical room-name constant; the export name is self-documenting.

17. **`subscriber.ts:23-26`** — 4-line `SubscriberSocket` JSDoc re-narrating the explicit-typing rationale. The interface body is self-documenting.

18. **`subscriber.ts:37-48`** — 11-line `handleSubscriberConnection` JSDoc re-narrating the join semantics + the boolean return value semantics. The function body + the `true` / `false` returns show the same content.

19. **`sequence.ts:53-57`** — 5-line inline comment re-narrating the `seq <= previous: late arrival` semantics + the `lastSeen` non-mutation rationale. The branch immediately above shows the same content.

20. **`sequence.ts:23-24`** — 2-line "State lives in process memory" inline comment re-narrating I-9. Drop; the `Map` field shows this.

21. **`rateLimit.ts:11-17`** — 7-line inline rationale re-narrating the fairness-pin semantics + the "throttle window anchored to the LAST accepted frame". The `tryAccept` body shows the same content.

22. **`frame.ts:151-153`** — 3-line "Stale-frame check" inline comment re-narrating the soft-disconnect rationale. The branch immediately below shows the same content.

23. **`frame.ts:330-336`** — 7-line `processFrame` JSDoc re-narrating the iteration site + the `frame.spec.ts` ordering pin. The `for (const step of PROCESSING_ORDER)` loop + the `dispatchStep` call show the same content.

24. **`subscriber.ts:16`** — 1-line `SUBSCRIBER_PATH_SEGMENT` JSDoc. Drop; the constant name is self-documenting.

### Non-findings (verified, not raised)

- The 10-step `PROCESSING_ORDER` switch in `dispatchStep` is correct — the `eslint-disable complexity` comment + the exhaustive `default: never` check + the `frame.spec.ts` ordering assertion form a load-bearing triple.
- `stepAuthCheck` is intentionally a no-op stub for v1 — Epic 3 fills in real device-token verification via the `verifyIngestClaims` path upstream in `server.ts`.
- `PerDeviceRateLimiter.tryAccept(deviceId, nowMs)` correctly anchors the throttle window to the LAST ACCEPTED frame (not the last rejected) — load-bearing fairness pin.
- `PerDeviceSequence.observe(deviceId, seq)` correctly returns `dropCount = seq - previous - 1` for accepts and `dropCount = 0` for reorders — the spec's FIRST_FRAME case is handled by `INITIAL_LAST_SEEN = -1`.
- `READINGS_LATEST_ROOM = "readings:latest"` + `SUBSCRIBER_ROOM = "readings:latest"` are pinned in `frame.ts` and `subscriber.ts`; keep in lockstep.
- `verifyIngestClaims` failure-mode differentiation (`sig_fail` / `aud_fail` → `unauthenticated`; `scope_fail` → `forbidden_scope`; sub mismatch → `device_id_mismatch`) is correct — device / simulator error envelopes must distinguish "wrong device_id" from "wrong scope" for operator triage.
- `stepPersist`'s `console.error` on the catch path is correct — the operator's audit log needs the underlying error to distinguish DB-down / FK-violation / unique-key-violation.

## Plan

### 1. Header trim pass (all 6 files)

Each `/** ... */` opening block compresses to ≤ 10 lines stating the file purpose only. Story / AC / distill / patch / loop-N markers move to the critique artifact + git history.

- `frame.ts`: already under 10 lines — keep as-is. Trim 6 inline JSDoc blocks.
- `server.ts`: 11-line header → ≤ 10 lines. Drop the `We use` first-person plural.
- `hooks.ts`: 15-line header → ≤ 10 lines.
- `subscriber.ts`: 13-line header → ≤ 10 lines.
- `sequence.ts`: 24-line header → ≤ 10 lines.
- `rateLimit.ts`: 20-line header → ≤ 10 lines (keep the `nowMs` rationale).

### 2. Drop first-person plural

`server.ts:33-34` "We use `unknown`…" — rewrite in passive voice ("`unknown` is used at the seam so tests can pass a stub…").

### 3. Drop cross-file line-number references

- `frame.ts` references to `frame.spec.ts` — keep ONE canonical reference at the top, drop the rest
- `frame.ts` references to `rules/cache.ts:N` — drop (cross-package ref)
- `server.ts` references to `boot/db.ts` — drop (cross-package ref)
- `hooks.ts` reference to `frame.ts:N-M` — drop (use a test pin instead)
- `subscriber.ts` reference to `frame.ts` — replace with single canonical room-name constant

### 4. Drop fix-history + Story + AC markers

- `Story 2.2 / 2.3 / 2.6 / 3.2`, `AC-N`, `Patch (code review YYYY-MM-DD #N)`, `distilled YYYY-MM-DD (was inline in src/index.ts:N-M)`, `Loop N hardening`, `Step-NN review fix`, `F-P#` — all belong in the spec / ADR / git history, not the source.

### 5. Drop narrative rationale blocks

~20 inline comments across the 6 files restate what the code does. Keep 1-2 lines only when the rationale is genuinely non-obvious (e.g., the `nowMs` parameter rationale in `rateLimit.ts` is load-bearing for vitest fake timers).

## Out of scope

- The 10-step PROCESSING_ORDER iteration site is correct as-is.
- The `dispatchStep` switch + exhaustive `default: never` check is correct as-is.
- The `READINGS_LATEST_ROOM = "readings:latest"` constant is correct (and load-bearing for the dashboard single-socket subscription).
- The `PerDeviceRateLimiter` in-memory Map is correct per I-9 single-process invariant.
- The `PerDeviceSequence`'s `INITIAL_LAST_SEEN = -1` is correct for the FIRST_FRAME case.
- The 4-way `verifyIngestClaims` failure-mode differentiation is correct as-is.
- The `stepAuthCheck` no-op stub is intentional — the real auth happens upstream in `server.ts:verifyIngestClaims`.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/ingest
cd packages/api && npx vitest run src/ingest 2>&1 | tail -15
node scripts/lint-prose.mjs
```

Existing specs (must stay green):

- `frame.spec.ts` (PROCESSING_ORDER ordering pin — load-bearing)
- `server.spec.ts` (Socket.IO boot + frame delivery + disconnect-on-failure)
- `subscriber.spec.ts` (subscriber decision logic)
- `subscriberSocket.spec.ts` (full socket boot + room join)
- `rateLimit.spec.ts` (1 frame / 2s throttle + retry_after)
- `sequence.spec.ts` (accept / reorder / drop / FIRST_FRAME)
