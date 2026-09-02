# Critique — `packages/api/src`

**Date:** 2026-09-02
**Surface:** `packages/api/src/` (4 routers + 4 middleware/repos in scope: `incidents/router.ts` 431 LOC, `incidents/transitionHelpers.ts` 658 LOC, `notifications/notificationRouter.ts` 703 LOC, `attachments/attachmentRouter.ts` 372 LOC, plus `alerts/acknowledgeRouter.ts`, `middleware/idempotency.ts`, `rules/applyTransition.ts`, `incidents/incidentStateRepository.ts`)
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File                                   | LOC       | Heuristic score    | Findings                                                |
| -------------------------------------- | --------- | ------------------ | ------------------------------------------------------- |
| `incidents/router.ts`                  | 431       | 24/40              | 1 P1 (58-line header), 7 P2                             |
| `incidents/transitionHelpers.ts`       | 658       | 23/40              | 1 P1 (18-line header), 9 P2                             |
| `notifications/notificationRouter.ts`  | 703       | 22/40              | 1 P1 (41-line header), 11 P2                            |
| `attachments/attachmentRouter.ts`      | 372       | 25/40              | 1 P1 (38-line header), 6 P2                             |
| `alerts/acknowledgeRouter.ts`          | ~530      | 24/40              | 1 P1 (50+ line header), 5 P2                            |
| `middleware/idempotency.ts`            | ~165      | 26/40              | 1 P1 (40-line header, stale web-client follow-up), 3 P2 |
| `rules/applyTransition.ts`             | ~220      | 25/40              | 0 P1, 4 P2                                              |
| `incidents/incidentStateRepository.ts` | ~280      | 26/40              | 0 P1, 3 P2                                              |
| **Surface total**                      | **~3360** | **24/40 weighted** | **6 P1, 48 P2**                                         |

The api surface mirrors the web side's AI-slop concentration: every router file opens with a 38-58 line narrative header that re-tells Story codes (`Story 3.5 (FR-15)`, `Story 4.2`, `Story 4.9`, `Story 4.10`, `Story 4.11`, `Story 4.13`, `Story 5.1`), Acceptance-Criterion codes (`AC1`, `AC1e`, `AC4`, `AC12`, `AC12b`), matrix-row codes (`ACK_VIEWER_DENIED`, `ACK_TECHNICIAN_DENIED`, `ACK_RACE_LOSER`, `MARK_AS_READ_IDEMPOTENT`), and Code-review-patch markers (`Patch (code review 2026-08-27 #1)`, `#3`, `#11`, `#12`, `#13`, `#14`, `#18`). The biggest offender — `notificationRouter.ts` — repeats "Extracted from the route handler to keep the PATCH closure under `complexity: 10`" 6 separate times across 6 inline JSDoc blocks. Several files include stale web-side file references that no longer exist (e.g., the `idempotency.ts` header points to `packages/web/src/components/IncidentCard.tsx`, which was removed in the web critique loops).

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

1. **All 6 source files open with 38-58 line narrative headers.** Every header re-tells the story (Story 3.5, 4.2, 4.9, 4.10, 4.11, 4.13, 5.1), matrix-row references, AC codes, and references to design docs. The contract is documented in the epic + DESIGN.md; the source is the renderer. Same anti-pattern as the web surfaces — readers outside the dev context cannot decode the matrix-row codes. Examples:

   - `notificationRouter.ts:1-41` (41 lines) lists 7 spec / matrix-row references and 2 cross-file line refs (`acknowledgeRouter.ts:349-443`, `listRouter.ts:326-487`).
   - `router.ts:1-58` (58 lines) is the densest — Story 4.2 AC list + idempotency section + atomicity section + AC4 section.
   - `transitionHelpers.ts:1-18` opens with a "pure support helpers" enumeration that lists 9 helper functions, each with its own per-function rationale.
   - `attachmentRouter.ts:1-38` enumerates 3 routes, RBAC per route, Tech-ownership, SECURITY URL validation, SECURITY XSS, and a "Attachments are NOT state transitions" footer.
   - `acknowledgeRouter.ts:1-50+` re-narrates AC1, AC1e, AC12, AC12b, plus RBAC matrix-row codes (`ACK_VIEWER_DENIED`, `ACK_TECHNICIAN_DENIED`).
   - `idempotency.ts:1-40` documents the wire contract in JSDoc + a "Web client follow-up (out of scope)" footer.

2. **`notificationRouter.ts:113-115, 139-140, 177-179, 209-210, 239-241, 270-272, 366-368, 432-434, 614-616` — 9 separate "Extracted from the route handler to keep the closure under `complexity: 10`" inline JSDoc blocks.** Every helper JSDoc block restates the same lint-cap rationale. The lint config (`.eslintrc.cjs`) shows the cap once; the surface needs one canonical reference, not 9.

3. **`notificationRouter.ts:410-414` + `:482-484` — "Loop 1 review finding E2 / E5" markers** in the admin query parser and envelope validator. Same Loop-N-review-hardening anti-pattern that was stripped from `useAdminNotificationList.ts` in the notifications web loop. Two separate fix-history markers belong in git, not source.

4. **`transitionHelpers.ts:410-414, 590-592, 600-603` + `router.ts:113-119, 211-215, 221-223, 279-283, 340-344, 417-422` — "Patch (code review 2026-08-27 #1 / #3 / #11 / #12 / #13 / #14 / #18)" markers.** 10 separate code-review-patch markers scattered across 2 files. Each one re-narrates a fix that was already committed; the commit message + the diff is the canonical record.

5. **`idempotency.ts:35-39` — stale "Web client follow-up" footer** references `packages/web/src/components/IncidentCard.tsx`, which does NOT exist. The web side now uses `useAcknowledgeMutation.ts` (in `packages/web/src/incidents/`). The web follow-up has actually shipped — the critique loops for transitions surface in the `idempotencyKey.ts` plan file. The stale reference makes the file look out-of-date.

6. **Cross-file line-number references that drift on every refactor.** `notificationRouter.ts:23-27` (`packages/api/src/alerts/acknowledgeRouter.ts:349-443`, `packages/api/src/alerts/listRouter.ts:326-487`), `notificationRouter.ts:481-482` (`@surakkha/shared/notification.ts:144-149`), `router.ts:421-422` (`transitionHelpers.ts:526-546`), `attachmentRouter.ts:162` (`router.ts:251-265`), `idempotency.ts:13` (`packages/api/src/ingest/`), `idempotency.ts:32` (`PerDeviceRateLimiter`), `transitionHelpers.ts:65` (`incidentStateRepository.ts`), `acknowledgeRouter.ts:5` (`incidents/recentRouter.ts:65`). Every refactor breaks these references — they're a maintenance liability. The web side already stripped the equivalent references; the api side still has them.

### P2 — Apply before merge, won't block on its own

1. **`notificationRouter.ts:73-89`**: 17-line "valid recipient roles" header comment re-narrating the matrix grant + the Prisma enum filter. The `VALID_RECIPIENT_ROLES` constant is self-documenting.

2. **`notificationRouter.ts:91-97`**: 7-line "take limit" rationale. The constant `NOTIFICATION_TAKE_LIMIT = 50` carries the meaning.

3. **`notificationRouter.ts:99-103`**: 5-line "path parameter schema" comment. `idPathSchema` is the canonical reference.

4. **`notificationRouter.ts:106-126`**: 21-line `parsePathParams` JSDoc restating "Returns `null` if the handler should short-circuit (response already sent)" + the lint-cap rationale.

5. **`notificationRouter.ts:128-168`**: 41-line `enforceCrossRoleRecipient` JSDoc re-narrating the cross-role RBAC matrix grant + the writer's `recipientRole` pin + the lint-cap rationale.

6. **`notificationRouter.ts:170-202`**: 33-line `fetchRowForAck` JSDoc re-narrating the three `kind:` outcomes + the lint-cap rationale.

7. **`notificationRouter.ts:204-264`**: 60-line `applyAck` + `refetchRow` JSDoc pair re-narrating the compare-and-set semantics + the vanishingly-rare race-window + the lint-cap rationale.

8. **`notificationRouter.ts:266-291`**: 26-line `renderAckResponse` JSDoc re-narrating the `first=true|false` log line suffix.

9. **`notificationRouter.ts:300-333`**: 34-line `adminQuerySchema` JSDoc re-narrating the chip-row toggle behaviour + the `?severity=` (empty) parse edge case.

10. **`notificationRouter.ts:335-357`**: 23-line `coerceSeverityArray` JSDoc.

11. **`notificationRouter.ts:359-425`**: 67-line `parseAdminQueryParams` JSDoc re-narrating the `since > until` validation + the Loop 1 review finding E2 marker.

12. **`notificationRouter.ts:427-455`**: 29-line `fetchAdminRows` JSDoc re-narrating the take: 100 + the lint-cap rationale.

13. **`notificationRouter.ts:457-494`**: 38-line `buildAdminEnvelope` JSDoc re-narrating the strict shape check + the Loop 1 review finding E5 marker + the "previous `z.array(z.unknown())` match accepted any shape" narrative.

14. **`notificationRouter.ts:514-555`**: 42-line `buildNotificationRouter` factory JSDoc that re-narrates the order of operations for both routes + the per-route step list.

15. **`notificationRouter.ts:559-562, 602-609, 656-682`**: 3 separate route-handler JSDoc blocks re-narrating what the route does (already shown by the path + the authorize + the handler body).

16. **`transitionHelpers.ts:60-77`**: 18-line `respondInvalidStateTransition` JSDoc re-narrating the 3-shape collapse + the Zod parse guarantee.

17. **`transitionHelpers.ts:89-103`**: 15-line `IncidentsRouterDepsLike` JSDoc re-narrating the type alias sync + the broadcast surface shape.

18. **`transitionHelpers.ts:153-167`**: 15-line reopen body schema rationale re-narrating the length bounds + the trim + the lint magic-numbers rule.

19. **`transitionHelpers.ts:177-192`**: 16-line `parseBody` JSDoc re-narrating the result shape.

20. **`transitionHelpers.ts:213-232`**: 20-line `PrepareCtxInput` + `TransitionContext` JSDoc pair.

21. **`transitionHelpers.ts:234-238`**: 5-line "Validate the path-param + body + load the row" comment restating the function name.

22. **`transitionHelpers.ts:276-310`**: 35-line `maybeReopenAdminDenied` JSDoc re-narrating the per-cell RBAC gate + the matrix-level grant + the seam rationale.

23. **`transitionHelpers.ts:364-379`**: 16-line `maybeOwnershipDenied` JSDoc re-narrating the Technician-only-mine rule.

24. **`transitionHelpers.ts:401-460`**: 60-line `extractOutcome` + `extractAssigneeUserId` + `extractReopenReason` + `computeTransition` JSDoc chain — the body is straightforward extraction + state-machine call; the rationale is already in the state-machine file.

25. **`transitionHelpers.ts:472-475, 505-507, 536-538, 557-560, 616-619, 636-637`**: 6 separate "AC4 observability log + AC5 `incident:state_changed` emit + respond 200 with the committed `IncidentPayload`"-style 3-4 line inline JSDoc blocks that restate what each helper does.

26. **`transitionHelpers.ts:654-657`**: 4-line footer comment re-narrating that the side-effect helpers were re-exported at the top — the import statement already shows this.

27. **`router.ts:97-130`**: 33-line `IncidentsRouterDeps` JSDoc re-narrating the lazy-upsert helper + the idempotency middleware factory + the test rig stub pattern.

28. **`router.ts:132-141`**: 10-line `IncidentBroadcast` JSDoc re-narrating the `BroadcastTarget` mirror reference.

29. **`router.ts:168-181`**: 14-line `RBAC_ACTION_BY_VERB` JSDoc re-narrating the matrix grant + the lint rule (`pnpm lint:rbac`).

30. **`router.ts:183-191`**: 9-line "Build the per-verb transition handler" rationale re-narrating what the factory function does.

31. **`router.ts:236-239`**: 4-line "Build the `/api/incidents` router" rationale.

32. **`router.ts:380-385`**: 6-line "Write-side. RBAC per verb" inline comment re-narrating the matrix grants already shown in the header.

33. **`router.ts:427-429`**: 3-line footer re-export comment that the test-rig import already shows.

34. **`attachmentRouter.ts:90-103`**: 14-line `validateUrlOrRespond` JSDoc restating the SECURITY rationale + the `unicorn/consistent-function-scoping` rule reference.

35. **`attachmentRouter.ts:124-155`**: 32-line `enforceDeleteOwnership` JSDoc re-narrating the per-row ownership rule.

36. **`attachmentRouter.ts:157-198`**: 42-line `enforceTechOwnership` JSDoc re-narrating the 4.4/4.6 mirror reference + the audit semantics.

37. **`attachmentRouter.ts:200-234`**: 35-line `createAttachmentRowOrRespond` JSDoc re-narrating the closure capture + the lint caps (`complexity: 10`, `max-params: 3`).

38. **`attachmentRouter.ts:236-241, 285-288, 323-330`**: 3 separate route-handler JSDoc blocks re-narrating the matrix grant + Tech-ownership.

39. **`acknowledgeRouter.ts:50+`**: 50+ line header (similar pattern to `router.ts`). Once the header is trimmed, the per-verb JSDoc blocks also need trimming.

40. **`idempotency.ts:35-39`**: 5-line "Web client follow-up" footer referencing the deleted `IncidentCard.tsx` file. (Already pinned in P1 #5.)

41. **`rules/applyTransition.ts:1-25`**: 25-line header re-narrating the writer layer + the broadcast target shape + the atomicity guarantees.

42. **`rules/applyTransition.ts:50-90`**: ~40 lines of inline JSDoc per side-effect helper (emitStateChanged, writeIncidentEvent, writeNotification, etc.) that re-narrate the audit log + the broadcast + the transaction boundary.

43. **`incidents/incidentStateRepository.ts:1-30`**: 30-line header re-narrating the optimistic-concurrency + the `OptimisticConcurrencyError` class + the broadcast target.

44. **`incidents/incidentStateRepository.ts:50-120`**: ~70 lines of inline JSDoc per repository method (`findUnique`, `applyTransition`, etc.) that re-narrate the audit + the transaction + the broadcast.

### Non-findings (verified, not raised)

- The 5 transition POSTs' `idempotencyMw` mounting (router.ts:386-415) is correct — production wires `deps.idempotency`, tests fall back to a fresh per-builder `IdempotencyStore`.
- The `OptimisticConcurrencyError` throw-and-catch in `commitTransition` (transitionHelpers.ts:577-588) is correct — the discriminated union closure on `result.ok` is the load-bearing pattern.
- The `respondInvalidStateTransition` shape collapse (transitionHelpers.ts:78-87) is correct — the canonical 409 envelope is the single source of truth.
- The `fetchRowForAck` + `applyAck` + `refetchRow` 3-phase compare-and-set (notificationRouter.ts:180-264) is correct — `count === 1` (first-ack) vs `count === 0` (idempotent re-ack) is the canonical concurrency pin.
- The `validateHttpUrl` security boundary (attachmentRouter.ts:104-116) is correct — the `javascript:` / `data:` / `file:` / `vbscript:` rejection list is the canonical XSS-prevention pin.
- The `enforceTechOwnership` admin-bypass + assignee-check (attachmentRouter.ts:164-198) is correct — the per-row ownership rule is the canonical access-narrowing pattern.
- The `IdempotencyStore` in-memory + TTL eviction (idempotency.ts:50+) is correct — the per-process assumption is documented in the header.
- The `RBAC_ACTION_BY_VERB` lookup (router.ts:175-181) is correct — the `pnpm lint:rbac` rule pin is load-bearing.

## Plan

### 1. Header trim pass (all 6 files in scope)

Each `/** ... */` opening block compresses to ≤ 6 lines stating what the file exports + which DESIGN.md section it implements. Story codes (Story 3.5, 4.2, 4.9, 4.10, 4.11, 4.13, 5.1), AC codes (AC1, AC1e, AC4, AC12, AC12b), matrix-row codes (ACK_VIEWER_DENIED, ACK_TECHNICIAN_DENIED, ACK_RACE_LOSER, MARK_AS_READ_IDEMPOTENT, RBAC_NO_FETCH), and self-critique markers (Loop 1 / Loop 2 review finding, Patch (code review 2026-08-27)) move to the critique artifact (this file).

### 2. Drop the 9 "Extracted from the route handler to keep the closure under `complexity: 10`" rationale blocks

The 9 inline JSDoc blocks in `notificationRouter.ts` that restate the lint-cap rationale collapse to 1 line each. The lint config (`.eslintrc.cjs` + the `pnpm lint:api` script) shows the cap once; the surface needs one canonical reference at the top of the file, not 9.

### 3. Drop the 10 "Patch (code review 2026-08-27 #N)" markers

The code-review-patch markers across `transitionHelpers.ts` and `router.ts` (10 instances) move to the critique artifact + git history. The current code already encodes the patches (lazy-upsert helper, `respondSuccess` delegation, `_requireOwnerMarker` removal, etc.).

### 4. Drop the 2 "Loop 1 review finding E2 / E5" markers

Same anti-pattern as the web `useAdminNotificationList.ts` strip. The current code already encodes the fixes (date-range validation, strict envelope validation).

### 5. Fix the stale "Web client follow-up" footer in `idempotency.ts`

The follow-up has actually shipped — the plan for `idempotencyKey.ts` in `~/.puku-cli/plans/` covers it. Remove the 5-line footer.

### 6. Drop cross-file line-number references

Remove all `transitionHelpers.ts:526-546`, `router.ts:251-265`, `acknowledgeRouter.ts:349-443`, `listRouter.ts:326-487`, `@surakkha/shared/notification.ts:144-149`, `packages/web/src/components/IncidentCard.tsx`, `incidents/recentRouter.ts:65` references. They break on every refactor. If a cross-file mirror relationship is load-bearing for correctness, write a test that pins the contract instead.

### 7. Drop inline comments that restate the JSX / function bodies

~30 inline comments across the 6 files restate what the JSX / function names / type signatures already show. Keep comments that explain a non-obvious _decision_ (the optimistic-concurrency discriminator is correct to keep — trim the JSDoc to 2 lines).

## Out of scope

- The `OptimisticConcurrencyError` class shape is correct as-is.
- The canonical 409 envelope (`InvalidStateTransitionEnvelopeSchema`) is correct as-is — already collapsed from 3 shapes to 1 in commit `ffd3fcf`.
- The 5-min `IDEMPOTENCY_TTL_MS` is correct per spec.
- The `validateHttpUrl` security boundary list (`javascript:` / `data:` / `file:` / `vbscript:`) is correct as-is — security boundary.
- The compare-and-set semantics (`acknowledgedAt: null` predicate) is correct as-is — load-bearing concurrency pin.

## Verification

```bash
cd packages/api && npx tsc -b
cd packages/api && npx eslint src/incidents src/notifications src/attachments src/middleware src/rules src/alerts
cd packages/api && npx vitest run
```

Existing specs: `incidents/transitions.spec.ts`, `incidents/router.spec.ts`, `incidents/applyTransition.spec.ts`, `notifications/notificationRouter.spec.ts`, `attachments/attachmentRouter.spec.ts`, `middleware/idempotency.spec.ts`, `alerts/acknowledgeRouter.spec.ts`, `rules/__tests__/engine.spec.ts`, `rules/__tests__/hooks.spec.ts`. All must stay green; the `respondInvalidStateTransition` envelope shape is load-bearing for the `incidents/transitions.spec.ts` discriminated-union assertions.
