# Critique — `packages/api/src/ingest`

**Date:** 2026-09-02
**Surface:** `packages/api/src/ingest/` (5 source files + 6 spec files in scope)
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File              | LOC       | Heuristic score    | Findings                                                  |
| ----------------- | --------- | ------------------ | --------------------------------------------------------- |
| `frame.ts`        | 515       | 18/40              | 1 P1 (22-line header + 25 inline rationale blocks), 13 P2 |
| `server.ts`       | 197       | 22/40              | 1 P1 (19-line header + F-P1/F-P3 markers), 5 P2           |
| `subscriber.ts`   | 94        | 23/40              | 1 P1 (29-line header + cross-file refs), 4 P2             |
| `hooks.ts`        | 109       | 23/40              | 0 P1, 5 P2                                                |
| `sequence.ts`     | 66        | 24/40              | 0 P1, 4 P2                                                |
| `rateLimit.ts`    | 44        | 26/40              | 0 P1, 2 P2                                                |
| **Surface total** | **~1025** | **22/40 weighted** | **3 P1, 33 P2**                                           |

The ingest surface is the second-densest AI-slop in the api package — denser per-LOC than `incidents/` but smaller in absolute scope (1 file dominates: `frame.ts`). The 22-line `frame.ts` header re-narrates Story 2.2 + the 10-step driver contract + ADR 0013 + `frame.spec.ts` ordering assertion + 3 architecture §X.Y refs. The 25 inline JSDoc blocks under each step function re-narrate the same content (Story 2.3 stale-frame, Story 2.6 broadcast-room, F-P5/F-P6/F-P7 code-review markers).

Five distinct AI-slop patterns show up here that weren't in the prior surfaces:

1. **`F-P#` markers throughout `frame.ts`** (F-P1 in server.ts, F-P5/F-P6/F-P7 in frame.ts). These are unnamed fix-history markers — they look like a code-review cycle's "finding numbers" that slipped into source instead of git. The 4 markers in `frame.ts` don't trace to any external registry.
2. **"Story 3.2 — extended" markers** in `hooks.ts` + `frame.ts` + `server.ts`. The Story 3.2 retrospective added a `reading.findMany` method to `ReadingRepository` + extended `onRuleEvaluation` to return `BreachResult[]`. Three files have `Story 3.2` markers citing the same change.
3. **Cross-file line refs to `frame.ts:303`** (hooks.ts), `frame.ts` (subscriber.ts), `useDashboardSocket.ts` (subscriber.ts). These break on the first refactor.
4. **"Step 0 placeholder" rhetoric in the frame.ts header** — the file is the rewrite of a prior placeholder, but that history belongs in git, not in the live header.
5. **Lint-cap rationale (`complexity: 10`) repeated 2 separate times** in `frame.ts` — once in the header and once in the `dispatchStep` extractor comment. The lint config has the cap once; the surface needs one canonical reference.

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

1. **`frame.ts:1-22` — 22-line header re-narrating Story 2.2 + 10-step driver + ADR 0013 + `frame.spec.ts` ordering pin + 3 architecture §X.Y refs.** Every line is restatement of either the spec or the doc — the source is the renderer.

2. **`frame.ts` — 25+ inline JSDoc rationale blocks across the 10 step functions and the dispatch site.** Every step function (`stepValidate`, `stepRateCheck`, `stepSeqDropCheck`, `stepPersist`, `stepRuleEvaluation`, `stepAlertEmission`, `stepStateMachineUpdate`, `stepAuditAppend`, `stepSocketBroadcast`) re-narrates:

   - Story 2.2 / 2.3 / 2.6 / 3.2 / 3.5 / 3.7 codes
   - ADR 0013 architecture §3.2 references
   - `F-P1` / `F-P3` / `F-P5` / `F-P6` / `F-P7` code-review finding markers
   - The `complexity: 10` lint-cap rationale (twice)
   - Architecture §3.6 reference

   The body of each step is 5-15 lines; the JSDoc is 1-3× the code length.

3. **`server.ts:1-19` + `server.ts:148-155` + `server.ts:172-177` — 19-line header + 2 inline "F-P1/F-P3" markers.** The header re-narrates Architecture §3.4 + I-3/I-4 invariants. Lines 148-155 carry an 8-line "F-P1" rationale block explaining the 4-way failure-mode differentiation. Lines 172-177 carry a 6-line "F-P3" rationale block explaining the `.catch` attachment.

4. **`subscriber.ts:1-29` — 29-line header** (longest in the surface). Re-narrates Story 2.2 (device endpoint) + Story 2.6 (dashboard subscription) + the sentinel-segment-vs-namespace design rationale + cross-file refs to `frame.ts` + `useDashboardSocket.ts`. Three architecture sections cited.

### P2 — Apply before merge, won't block on its own

1. **`frame.ts:39-49`** — 11-line `ReadingRepository` JSDoc citing Story 3.2 + `packages/api/src/rules/hooks.ts` + `__tests__/reading-repository-findmany.spec.ts`.

2. **`frame.ts:79-88`** — 10-line `BroadcastTarget` JSDoc citing `frame.spec.ts`.

3. **`frame.ts:117-123`** — 7-line `ProcessFrameOutcome` JSDoc re-narrating the per-step outcome seam.

4. **`frame.ts:132-147`** — 16-line `READINGS_LATEST_ROOM` JSDoc citing Story 2.6 + the broadcast-room-vs-per-device-rooms rationale.

5. **`frame.ts:150-157`** — 8-line `StepResult` JSDoc re-narrating the `next` vs `exit` arms + the `no-param-reassign` lint rule.

6. **`frame.ts:186-192`** — 7-line `step*` family header re-narrating the "tiny pure functions" pattern + the ESLint complexity ceiling.

7. **`frame.ts:207-214`** — 8-line "Story 2.3 — stale-frame check" inline comment.

8. **`frame.ts:222-225`** — 4-line "Story 2.3 — clock-skew flag stamping" inline comment.

9. **`frame.ts:228-232`** — 5-line "F-P6" marker re-narrating the `serverReceivedAt` source-of-truth pin.

10. **`frame.ts:278-281`** — 4-line "F-P7" marker re-narrating the audit pipeline hook.

11. **`frame.ts:322-324`** — 4-line "F-P5" marker re-narrating the persist-failed error path.

12. **`frame.ts:399-403`** — 5-line "Story 2.6 — broadcast the same payload" inline comment.

13. **`frame.ts:422-428`** — 7-line "F-P6" marker re-narrating the `serverReceivedAt` source-of-truth pin (second occurrence).

14. **`frame.ts:450-454`** — 5-line `eslint-disable complexity` rationale + 6-line `dispatchStep` JSDoc re-narrating the lint cap (THIRD occurrence of the complexity: 10 rationale).

15. **`server.ts:30`** — 1-line `INGEST_PATH_PREFIX` JSDoc.

16. **`server.ts:44-47`** — 4-line `MinimalSocket` JSDoc re-narrating the `unknown` seam.

17. **`server.ts:61-75`** — 15-line `parseDeviceIdFromHandshake` JSDoc citing Architecture §3.4 + AR-12 + I-3 + Socket.IO v4 namespace behavior + the legacy backward-compat rationale.

18. **`server.ts:88-93`** — 6-line `extractToken` JSDoc re-narrating the `auth.token` vs `?token=` priority.

19. **`server.ts:101-114`** — 14-line `buildIngestServer` JSDoc re-narrating the namespace-vs-room decision.

20. **`hooks.ts:1-16`** — 16-line header citing Story 2.2 + ADR 0013 + Architecture §3.2 + the typed-narrow-interface rationale.

21. **`hooks.ts:31-37`** — 6-line "Closed enum per ReadingFlagSchema (Story 2.3)" inline comment on `flags`.

22. **`hooks.ts:62-70`** — 8-line `IngestHooks` JSDoc re-narrating Story 3.2's `Promise<readonly BreachResult[]>` extension + cross-file ref to `frame.ts:303`.

23. **`hooks.ts:84-89`** — 5-line `NOOP_HOOKS` JSDoc citing the boot fallback path.

24. **`hooks.ts:97-101`** — 5-line `setIngestHooks` JSDoc re-narrating the no-concurrent-safety contract.

25. **`subscriber.ts:32-39`** — 7-line `SUBSCRIBER_PATH_SEGMENT` JSDoc citing cross-file ref to `useDashboardSocket.ts`.

26. **`subscriber.ts:41-45`** — 5-line `SUBSCRIBER_ROOM` JSDoc citing cross-file ref to `frame.ts`.

27. **`subscriber.ts:47-52`** — 5-line `SubscriberSocket` JSDoc re-narrating the explicit-typing rationale.

28. **`subscriber.ts:63-74`** — 11-line `handleSubscriberConnection` JSDoc re-narrating the join semantics.

29. **`sequence.ts:1-25`** — 25-line header citing Story 2.2 + Architecture §3.2 step 6 + I-9 single-process invariant + the FIRST_FRAME case.

30. **`sequence.ts:47-49`** — 3-line "Strictly later" inline comment.

31. **`sequence.ts:56-59`** — 4-line "seq <= previous: late arrival" inline comment.

32. **`sequence.ts:23-24`** — 2-line "State lives in process memory" inline comment re-narrating I-9.

33. **`rateLimit.ts:1-20`** — 20-line header citing Story 2.2 + Architecture §3.2 step 5 + I-9 + the `nowMs` parameter rationale.

### Non-findings (verified, not raised)

- The 10-step `PROCESSING_ORDER` switch in `dispatchStep` is correct — the `eslint-disable complexity` comment + the exhaustive `default: never` check + the `frame.spec.ts` ordering assertion form a load-bearing triple.
- `stepAuthCheck` is intentionally a no-op stub for v1 — Epic 3 fills in real device-token verification via the `verifyIngestClaims` path upstream in `server.ts`.
- `PerDeviceRateLimiter.tryAccept(deviceId, nowMs)` correctly anchors the throttle window to the LAST ACCEPTED frame (not the last rejected) — this is the load-bearing fairness pin called out in `rateLimit.ts:11-14`.
- `PerDeviceSequence.observe(deviceId, seq)` correctly returns `dropCount = seq - previous - 1` for accepts and `dropCount = 0` for reorders — the spec's FIRST_FRAME case is handled by `INITIAL_LAST_SEEN = -1`.
- `READINGS_LATEST_ROOM = "readings:latest"` + `SUBSCRIBER_ROOM = "readings:latest"` are pinned in `frame.ts` and `subscriber.ts`; keep in lockstep (the cross-file ref is load-bearing — keep one canonical reference, drop the rest).
- `verifyIngestClaims` failure-mode differentiation (`sig_fail` / `aud_fail` → `unauthenticated`; `scope_fail` → `forbidden_scope`; sub mismatch → `device_id_mismatch`) is correct — device / simulator error envelopes must distinguish "wrong device_id" from "wrong scope" for operator triage.
- The `processFrame` 10-step driver ordering matches the literal in `@surakkha/shared/telemetry.ts:PROCESSING_ORDER` — the `frame.spec.ts` pin catches adjacent-pair swaps.
- `stepPersist`'s `console.error` on the catch path is correct — the operator's audit log needs the underlying error to distinguish DB-down / FK-violation / unique-key-violation.

## Plan

### 1. Trim the 4 P1 headers + inline blocks

- `frame.ts`: 22-line header → 7 lines. Drop the 25 inline JSDoc blocks; collapse to 1-line per step function stating the contract. Drop F-P1 / F-P3 / F-P5 / F-P6 / F-P7 markers (they trace to no external registry). Drop the `eslint-disable complexity` rationale + the `dispatchStep` JSDoc (the lint config has the cap once). Drop Story 2.2 / 2.3 / 2.6 / 3.2 / 3.5 / 3.7 codes from inline JSDoc.

- `server.ts`: 19-line header → 6 lines. Drop F-P1 / F-P3 inline markers. Drop Story 2.2 / Architecture §3.4 / I-3 / I-4 markers from inline JSDoc.

- `subscriber.ts`: 29-line header → 7 lines. Drop the 7-line `SUBSCRIBER_PATH_SEGMENT` JSDoc + the 5-line `SUBSCRIBER_ROOM` JSDoc + the 11-line `handleSubscriberConnection` JSDoc. Keep one canonical reference for the `readings:latest` room name lockstep with `frame.ts`.

- `hooks.ts`: 16-line header → 6 lines. Drop the 8-line `IngestHooks` JSDoc + the 5-line `NOOP_HOOKS` JSDoc + the 5-line `setIngestHooks` JSDoc. Drop cross-file ref to `frame.ts:303`.

- `sequence.ts`: 25-line header → 6 lines. Drop 2 inline rationale comments. Keep the FIRST_FRAME `INITIAL_LAST_SEEN = -1` rationale.

- `rateLimit.ts`: 20-line header → 6 lines. Keep the `nowMs` parameter rationale (load-bearing for vitest fake timers).

### 2. Drop cross-file line-number references

- `frame.ts:303` (referenced in `hooks.ts:69` — pin via test instead)
- `frame.ts` (referenced in `subscriber.ts:43` — replace with a single canonical room-name constant)
- `useDashboardSocket.ts` (referenced in `subscriber.ts:36-38` — pin via the wire-contract spec)
- `frame.spec.ts` (referenced in `frame.ts:14-16` — keep one canonical reference at the top of the file, drop the rest)

### 3. Drop fix-history + code-review markers

- `frame.ts`: F-P5, F-P6 (×2), F-P7
- `server.ts`: F-P1, F-P3

These unnamed markers don't trace to any external registry. Git is canonical.

### 4. Drop Story codes + architecture §X.Y references from inline JSDoc

Story 2.2 / 2.3 / 2.6 / 3.2 / 3.5 / 3.7 + Architecture §3.2 / §3.4 / §3.5 / §3.6 + ADR 0013 + AR-12 + I-3 / I-4 / I-9 references — all belong in the spec / ADR / architecture doc, not the source. Keep:

- The 10-step driver contract (the `PROCESSING_ORDER` literal already pins the order)
- The stale-frame window (`STALE_FRAME_THRESHOLD_MS` already pins the constant)
- The clock-skew detection (`CLOCK_SKEW_DETECT_MS` already pins the constant)
- The 60s staleness + 60s skew thresholds
- The 1 frame / 2s rate limit (`RATE_LIMIT_WINDOW_MS = 2_000` already pins the constant)
- The `(deviceId, metric, last 60s)` reading findMany contract
- The `readings:latest` room name

## Out of scope

- The 10-step PROCESSING_ORDER iteration site is correct as-is.
- The dispatchStep switch + exhaustive `default: never` check is correct as-is.
- The `READINGS_LATEST_ROOM = "readings:latest"` constant is correct (and load-bearing for the dashboard single-socket subscription).
- The `PerDeviceRateLimiter` in-memory Map is correct per I-9 single-process invariant.
- The `PerDeviceSequence`'s `INITIAL_LAST_SEEN = -1` is correct for the FIRST_FRAME case.
- The 4-way `verifyIngestClaims` failure-mode differentiation is correct as-is.
- The `stepAuthCheck` no-op stub is intentional — the real auth happens upstream in `server.ts:verifyIngestClaims`.

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/ingest
cd packages/api && npx vitest run src/ingest
```

Existing specs (must stay green):

- `frame.spec.ts` (PROCESSING_ORDER ordering pin — load-bearing)
- `server.spec.ts` (Socket.IO boot + frame delivery + disconnect-on-failure)
- `subscriber.spec.ts` (subscriber decision logic)
- `subscriberSocket.spec.ts` (full socket boot + room join)
- `rateLimit.spec.ts` (1 frame / 2s throttle + retry_after)
- `sequence.spec.ts` (accept / reorder / drop / FIRST_FRAME)
