# Critique — `packages/api/src/middleware/{idempotency.ts, authorize.ts}`

**Date:** 2026-09-02
**Surface:** `packages/api/src/middleware/idempotency.ts` (128 LOC) +
`packages/api/src/middleware/authorize.ts` (284 LOC)
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/middleware/
├── idempotency.ts       128 LOC  — Idempotency-Key middleware + IdempotencyStore
└── authorize.ts         284 LOC  — authenticate + markPublic + authorize + requireOwner
```

The middleware surface is the load-bearing pre-handler pipeline:
`authenticate` → `authorize({ action, resource }, audit)` →
`requireOwner` (when applicable) → `idempotency` (for the 5 transition
POSTs). Both files are at high heuristic-4 quality (visibility,
match-real-world, error prevention) but low on minimalist + help docs
— long file headers restate behaviour that the function bodies already
encode.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                             |
| --- | ---------------- | ----- | ---------------------------------------------------------------- |
| 1   | Visibility       | 4     | rbac_allowed + rbac_denied audit on every decision               |
| 2   | Match real world | 4     | "authenticate", "authorize", "requireOwner", "idempotency"       |
| 3   | User control     | 3     | `markPublic` opt-in per route                                    |
| 4   | Consistency      | 2     | Story codes in headers; AC marker restatements                   |
| 5   | Error prevention | 4     | Malformed Idempotency-Key → 400; missing user → 401              |
| 6   | Recognition      | 2     | "(Story 1.5)", "(Story 1.4 AC)", "(Story 1.7 AC)" RESTATE        |
| 7   | Flexibility      | 4     | `nowMs` injectable; `store` injectable; per-handler `markPublic` |
| 8   | Minimalist       | 1     | 49-line authorize header; 10-line idempotency header             |
| 9   | Recoverability   | 4     | TTL-evict on access; 5xx not cached; pass-through on missing key |
| 10  | Help docs        | 1     | Most rationale is in code comments                               |

**Weighted total: 29/40.**

## AI-slop detection

### P1 (block merge)

- **P1-1: `authorize.ts` header is 49 lines** of rationale — restates the per-method wire contract + Story 1.5 AC checklist + Story 1.7 AC. Trim to ~7 lines.
- **P1-2: `idempotency.ts` header is 10 lines** of rationale — restates the missing/malformed/5xx rules. Trim to ~5 lines.

### P2 (apply before merge)

#### Story codes / AC markers in headers + inline

- `authorize.ts`: header `Story 1.5`; inline `(Story 1.4 AC)`, `(Story 1.7 AC)`, `Story 1.5 AC (epics.md §1.5)`, `Story 1.5 factory`, `(Story 1.4 AC: \`// PUBLIC\` markers)`
- `idempotency.ts`: `I-9 single-process assumption` (loop review finding reference)

#### Cross-file line refs

- `authorize.ts`: `pnpm lint:rbac` (lint command reference, OK to keep but trim)
- `authorize.ts`: `auth/router.ts` (cross-file)
- `idempotency.ts`: `PerDeviceRateLimiter.tryAccept(deviceId, nowMs)` (cross-file ref to rate-limit module — same package, OK)

#### Long narrative rationale blocks

- `authorize.ts:79-87` (extractBearer preamble): 9 lines restating the obvious regex behaviour
- `authorize.ts:118-124` (findUserById null preamble): 6 lines restating "the token is signed but the subject does not match"
- `authorize.ts:130-144` (markPublic preamble): 14 lines restating the per-route opt-in flag intent + Story 1.4 AC + type-checked wrapper rationale
- `authorize.ts:146-161` (smallestGrantingRole preamble): 16 lines restating ROLE_ORDER ordering + the previous bug fix
- `authorize.ts:176-196` (authorize factory preamble): 21 lines restating the audit semantics + per-handler triple + dashboards rationale
- `idempotency.ts:106-115` (res.json wrap preamble): 10 lines restating the wrap rationale + max-params / no-param-reassign suppressions

### Non-findings (verified, not raised)

- **The `IdempotencyStore` TTL eviction on access** is correct — auto-evicts on `lookup`, keeps cache bounded without a separate sweeper.
- **The cache key shape `(userId, method, path, header)`** is correct — method+path prevent cross-route cache collisions; userId prevents cross-user.
- **The 5xx-not-cached rule** (`statusCode < HTTP_STATUS_MAX_CACHEABLE`) is correct — clients retry with the same key on 5xx.
- **`isUuidV4` gate** before cache lookup is correct — malformed keys must NOT touch the cache.
- **The `defaultStore` singleton** is correct — process-wide state is the single-process assumption.
- **`authenticate`'s `req.public === true` opt-in** is correct — public routes tolerate anonymous traffic.
- **`authorize`'s `rbac_allowed` audit BEFORE `next()`** is correct — synchronous audit write preserves the trail if a handler throws.
- **`smallestGrantingRole`'s `ROLE_ORDER` LEAST-privileged-first** is correct — the SPA's "you need at least X" copy must surface the LOWEST tier that WOULD work.
- **`requireOwner` 403 path** emits `rbac_denied` audit row with `reason: "not_assignee"` (the only ownership-restricted cell today).
- **The `AuthorizedRequest` interface** (named augmentation, not `declare module`) is correct — keeps the type-checked source clean.
- **The `extractBearer` regex** is correct — case-insensitive `Bearer`, optional trailing whitespace.

### Out of scope

- **`httpStatus.ts`** — shared HTTP status code constants. Out of scope.
- **`@surakkha/shared/rbac`** — the canonical RBAC matrix. Out of scope.
- **`PerDeviceRateLimiter`** in `ingest/rateLimit.ts` (cross-file ref to test-time pattern). Out of scope — already refined in loop #199.

## Plan

### Strip pass

1. Drop `Story 1.5` / `Story 1.4` / `Story 1.7` codes from headers + inline.
2. Drop `epics.md §1.5` reference (cross-doc).
3. Drop `pnpm lint:rbac` (the lint is enforced; the comment is noise).
4. Drop `I-9 single-process assumption` (loop review finding).

### Trim pass

5. **`authorize.ts` header**: 49 → 7 lines.
6. **`idempotency.ts` header**: 10 → 5 lines.
7. **`authorize.ts:79-87`** (extractBearer preamble): 9 → 2 lines.
8. **`authorize.ts:118-124`** (findUserById null preamble): 6 → 2 lines.
9. **`authorize.ts:130-144`** (markPublic preamble): 14 → 3 lines.
10. **`authorize.ts:146-161`** (smallestGrantingRole preamble): 16 → 3 lines.
11. **`authorize.ts:176-196`** (authorize factory preamble): 21 → 5 lines.
12. **`idempotency.ts:106-115`** (res.json wrap preamble): 10 → 3 lines.

### Preserved (load-bearing)

- `IdempotencyStore` TTL eviction on access.
- Cache key shape `(userId, method, path, header)`.
- 5xx-not-cached rule.
- `isUuidV4` gate before cache lookup.
- `defaultStore` singleton.
- `authenticate`'s `req.public === true` opt-in.
- `authorize`'s `rbac_allowed` audit BEFORE `next()`.
- `smallestGrantingRole`'s `ROLE_ORDER` LEAST-privileged-first.
- `requireOwner` 403 path with `rbac_denied` + `reason: "not_assignee"`.
- `AuthorizedRequest` named augmentation.
- `extractBearer` regex.
