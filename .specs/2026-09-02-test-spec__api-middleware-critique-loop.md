# Test spec — `packages/api/src/middleware/{idempotency, authorize}.ts` critique loop

**Date:** 2026-09-02
**Surface:** `packages/api/src/middleware/` (2 files, 412 LOC → ~250 LOC)
**Companion critique:** `.impeccable/critique/2026-09-02T29-00-00Z__packages-api-src-middleware.md` (29/40 weighted)

This spec pins the load-bearing invariants of the middleware surface
that survived the refactor pass.

## Behavioural pins

### Idempotency middleware (idempotency.ts)

- **B-ID-1**: Given `idempotency(store)` and a request WITHOUT `Idempotency-Key` header, when called, then it calls `next()` (pass-through — the route is idempotent by state-machine machinery).
- **B-ID-2**: Given `idempotency(store)` and a malformed `Idempotency-Key` header (not UUIDv4), when called, then it responds 400 `{ error: "invalid_idempotency_key" }`.
- **B-ID-3**: Given `idempotency(store)` and a valid `Idempotency-Key` header with a CACHED `(userId, method, path, key)`, when called, then it replays the cached `(status, body)` byte-for-byte.
- **B-ID-4**: Given `idempotency(store)` and a valid header WITHOUT a cached entry, when called, then it wraps `res.json`, calls `next()`, and on a 2xx/4xx response records `(status, body)` keyed by `(userId, method, path, key)`.
- **B-ID-5**: Given `idempotency(store)` and a 5xx response, when the wrapped `res.json` fires, then it does NOT call `store.record(...)` (5xx must NOT poison the cache; client retries with the same key).
- **B-ID-6**: Given `IdempotencyStore.lookup(key, nowMs)` and an entry whose `expiresAtMs <= nowMs`, when called, then it deletes the entry and returns `null` (auto-evict on access).
- **B-ID-7**: Given `IdempotencyStore.record(key, status, body, nowMs)`, when called, then the entry's `expiresAtMs = nowMs + IDEMPOTENCY_TTL_MS` (5 minutes).
- **B-ID-8**: Given `IdempotencyStore.reset()`, when called, then the cache is cleared (test-only seam).
- **B-ID-9**: Given `idempotency(store)` and `req.user === undefined` (the `authorize()` short-circuit should have caught this), when called, then it calls `next()` (pass-through — don't mask the underlying 401).

### authorize middleware (authorize.ts)

- **B-AZ-1**: Given `authenticate` and a request WITHOUT `Authorization` header AND `req.public === true`, when called, then it sets `req.user = null` and calls `next()`.
- **B-AZ-2**: Given `authenticate` and a request WITHOUT `Authorization` header AND `req.public !== true`, when called, then it responds 401 `{ error: "unauthorized" }`.
- **B-AZ-3**: Given `authenticate` and a malformed bearer token, when called, then it responds 401.
- **B-AZ-4**: Given `authenticate` and a structurally-valid-but-expired bearer token (`verifyAccessToken` returns null), when called, then it responds 401.
- **B-AZ-5**: Given `authenticate` and a structurally-valid token whose `sub` is NOT in the user table, when called, then it responds 401 (orphan subject).
- **B-AZ-6**: Given `authenticate` and a valid token, when called, then it sets `req.user = { id, role, scope }` and calls `next()`.
- **B-AZ-7**: Given `markPublic(handler)`, when invoked, then it sets `req.public = true` and invokes the wrapped handler.

- **B-AZ-8**: Given `authorize({ action, resource }, audit)` and a request with `req.user === null`, when called, then it responds 401 (defensive — `authenticate()` should have rejected).
- **B-AZ-9**: Given `authorize({ action, resource }, audit)` and `isAllowed({ subject, action, resource }) === true`, when called, then it emits `auditAction: "rbac_allowed", outcome: "allow"` BEFORE `next()`.
- **B-AZ-10**: Given `authorize({ action, resource }, audit)` and `isAllowed(...) === false`, when called, then it emits `auditAction: "rbac_denied", outcome: "failure"` with `context.required_role` = the smallest granting role, AND responds 403 `{ error: "forbidden", required_role }`.
- **B-AZ-11**: Given `smallestGrantingRole` for a multi-grantor action (e.g. `Alert.acknowledge` granted to Operator + Admin), when called, then it returns `"Operator"` (LEAST-privileged-first).
- **B-AZ-12**: Given `smallestGrantingRole` for an action with NO granting role, when called, then it returns `"Admin"` (the caller-side fallback — should not happen because the matrix always grants at least Admin).
- **B-AZ-13**: Given `smallestGrantingRole` for an Admin-only action, when called, then it returns `"Admin"`.

- **B-AZ-14**: Given `requireOwner(ownerId, audit)` and `ownerId === req.user.id`, when called, then it calls `next()` (allowed).
- **B-AZ-15**: Given `requireOwner(ownerId, audit)` and `ownerId !== req.user.id`, when called, then it emits `rbac_denied` with `reason: "not_assignee"` and responds 403 `{ error: "forbidden", required_role: "Technician" }`.
- **B-AZ-16**: Given `requireOwner(undefined, audit)`, when called, then it calls `next()` (nothing to compare against).

## Static / lint pins

- **P-FS-1**: Both file headers MUST be ≤ 10 lines.
- **P-FS-2**: No file MUST contain `Story 1.x` / `epics.md §` / `pnpm lint:rbac` / `I-9 single-process assumption` strings.
- **P-ID-1**: `IdempotencyStore.cache` MUST be a `Map<string, CachedResponse>` (O(1) lookup).
- **P-ID-2**: The cache key shape MUST be `${userId}|${method}|${path}|${header}` (cross-route + cross-user collision pin).
- **P-ID-3**: 5xx MUST NOT be cached (`statusCode < HTTP_STATUS_MAX_CACHEABLE`).
- **P-ID-4**: Malformed keys MUST be rejected BEFORE the cache lookup.
- **P-AZ-1**: `ROLE_ORDER` MUST be `["Viewer", "Technician", "Operator", "Admin"]` (LEAST-privileged-first).
- **P-AZ-2**: The `rbac_allowed` audit emit MUST run BEFORE `next()`.
- **P-AZ-3**: The `AuthorizedRequest` interface MUST be a named interface (not a `declare module` augmentation).
- **P-LINT-1**: `npx eslint packages/api/src/middleware` MUST exit 0.
- **P-LINT-2**: `npx tsc -b packages/api` MUST exit 0.

## Negative pins

- **N-1**: `IdempotencyStore.lookup` MUST NOT return an entry whose `expiresAtMs <= nowMs` (auto-evict).
- **N-2**: `idempotency(store)` MUST NOT cache a 5xx response.
- **N-3**: `idempotency(store)` MUST NOT block a malformed-key response that should be 400.
- **N-4**: `authorize` MUST NOT call `next()` BEFORE emitting the `rbac_allowed` audit row.
- **N-5**: `authenticate` MUST NOT set `req.user` on a malformed / orphan token (defense — token verification is the gate).
- **N-6**: `requireOwner` MUST NOT skip the audit emit on a denied match (every denied attempt gets a row).
- **N-7**: `markPublic` MUST NOT be a global toggle — per-route opt-in only.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/middleware
npx --prefix packages/api vitest run packages/api/src/middleware
```

Existing specs must stay green:

- `idempotency.spec.ts` (11 cases) — middleware + store
- `authorize.spec.ts` (13 cases) — authenticate + authorize + requireOwner

Total: 24 tests.
