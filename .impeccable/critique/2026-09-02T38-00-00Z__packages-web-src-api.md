# Critique — `packages/web/src/api/` (apiClient + idempotencyKey)

**Date:** 2026-09-02
**Surface:** `packages/web/src/api/` (2 source files, 299 LOC)
**Scoring:** Nielsen 10-heuristics + AI-slop detection

## Scope

```
packages/web/src/api/
├── apiClient.ts        268 LOC  — fetch wrapper, refresh-once retry, login helper
└── idempotencyKey.ts    31 LOC  — RFC 4122 v4 UUID generator
```

Both files are web-only. Spec files (`apiClient.spec.ts`, `idempotencyKey.spec.ts`) are out of scope.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                                               |
| --- | ---------------- | ----- | ---------------------------------------------------------------------------------- |
| 1   | Visibility       | 4     | `console.error` not used; errors surface as `onOffline` / navigate                 |
| 2   | Match real world | 4     | "apiClient", "newIdempotencyKey", "configureApiClient", "refreshSession"           |
| 3   | User control     | 4     | `configureApiClient` injection seam; `skipAuth` for login path                     |
| 4   | Consistency      | 2     | "AC1 / AC2 / AC3 / AC4" restated across apiClient header; inline AC4 / AC2 markers |
| 5   | Error prevention | 4     | refresh-once lock, schema-drift `safeParse`, network-error distinct from 401       |
| 6   | Recognition      | 2     | "Story 1.7" codes RESTATE; "(P1 #2)" review marker RESTATED                        |
| 7   | Flexibility      | 3     | `configureApiClient` injection; no `skipAuth` for `/auth/refresh` (always authed)  |
| 8   | Minimalist       | 1     | apiClient header is 33 lines; idempotencyKey header is 30 lines (10× needed)       |
| 9   | Recoverability   | 4     | single-flight refresh, "network error" sentinel preserves tokens                   |
| 10  | Help docs        | 1     | All rationale is in code comments                                                  |

**Weighted total: 29/40.**

## AI-slop detection

### P1 (block merge)

- **P1-1: `idempotencyKey.ts` header is 30 lines** — restates "P1 #2 (api critique)" + persona-blocking rationale + 5-minute dedup window + DOM lib line ref + tsconfig line ref. The body is one line. Trim to ~3 lines.
- **P1-2: `apiClient.ts` header is 33 lines** — restates Story 1.7 wire contract + AC1/AC2/AC3/AC4 mapping + 4 AC inline bullets. Trim to ~6 lines.

### P2 (apply before merge)

#### Story codes / AC-N codes

- `idempotencyKey.ts:2`: `idempotencyKey.ts` — closes web-side P1 #2 (api critique)`
- `idempotencyKey.ts:11-12`: `Closes the persona-blocking "Rahim the Operator"` — character narrative
- `idempotencyKey.ts:25`: `TS 5.5+` pin
- `apiClient.ts:2`: `apiClient — Surakkha web (Story 1.7)`
- `apiClient.ts:7`: `AC4 in epics.md §Story 1.7`
- `apiClient.ts:13`: `(Story 1.7: "does not retry refresh more than once per API call" — we extend that to "once per concurrent burst" for the same reason)`
- `apiClient.ts:20-28`: `AC mapping (epics.md §Story 1.7): AC1 / AC2 / AC3 / AC4` block
- `apiClient.ts:96`: `// Network error during refresh — AC4 says we surface offline state and do NOT clear tokens / navigate. The caller will raise onOffline and bubble the original request's failure.`
- `apiClient.ts:216`: `// AC4: surface offline state, do NOT clear tokens or navigate.`
- `apiClient.ts:224`: `// AC2: refresh itself 401'd → log out, navigate to /login?next=...`

These are noise — git tracks the requirements.

#### Cross-file line refs

- `idempotencyKey.ts:16`: `packages/api/src/middleware/idempotency.ts` (cross-file module ref)
- `idempotencyKey.ts:22`: `IDEMPOTENCY_TTL_MS (5 minutes)` (cross-file constant ref)
- `idempotencyKey.ts:26`: `packages/web/tsconfig.json` line 8: "lib": ["ES2022", "DOM", "DOM.Iterable"]`
- `idempotencyKey.ts:31`: `configured via configureApiClient` (cross-file fn ref)

#### Long narrative rationale blocks

- `idempotencyKey.ts:11-23` (Rahim narrative): 13 lines restating "the key captures intent in a useRef so a flaky double-tap replays"
- `apiClient.ts:20-28` (AC mapping): 9 lines restating each AC; the 4 AC anchors in the file body already encode the contract.
- `apiClient.ts:96-101` (refresh network error preamble): 6 lines restating "AC4 says we surface offline state" — the function body already encodes it.

#### "we use X" / first-person plural

- `apiClient.ts:18`: `we extend that to "once per concurrent burst" for the same reason`
- `apiClient.ts:31`: `decouples it from react-router-dom so unit tests do not need a Router`

The first is reviewer-facing narrative; the second is a justification of the injection seam. Both rewrite as imperative/passive.

### Non-findings (verified, not raised)

- **`inflightRefresh` module-scoped lock** — single-flight per concurrent burst. Correct.
- **`refreshSession()` exposed for socket layer** — re-entrancy guard `if (inflightRefresh !== null) return inflightRefresh` is correct.
- **`performRefresh()` throws `refresh_network_error` sentinel** — distinct from `null` (refresh itself 401'd). Caller branches on `err.message === "refresh_network_error"`. Correct.
- **`apiLogin()` returns the Response, not throws** — login form needs to branch on 401 vs 422 vs network. Correct.
- **`withJsonContentType` defaults Content-Type only when body present** — `GET`s don't accidentally carry a body. Correct.
- **`withBearer` no-ops when `skipAuth` or no token** — login form runs before any token. Correct.
- **`computeNextPath` falls back to `/dashboard` SSR** — web is browser-only but the fallback is defense-in-depth.
- **`apiFetch` retries exactly once with the new token** — no exponential backoff (matches Story 1.7).
- **`AccessTokenSchema.safeParse` schema-drift check** — returns null on a malformed body. Correct.
- **`newIdempotencyKey()` is a single line: `crypto.randomUUID()`** — DOM lib provides it natively in TS 5.5+ and all evergreen browsers since 2022. Correct.
- **`configureApiClient` injection seam** — decouples from react-router-dom. Correct.
- **`_resetApiClientConfig` test seam** — exports the only state-mutation hook. Correct.
- **`credentials: "include"` on every fetch** — the httpOnly refresh cookie must travel. Correct.
- **The `RetryArgs` interface separation** — keeps `retryAfterRefresh` under the eslint complexity ceiling.

### Out of scope

- `packages/web/src/api/apiClient.spec.ts` — covers refresh + 401 + 4xx branch. Source of truth for the wire contract.
- `packages/web/src/api/idempotencyKey.spec.ts` — UUID format check + uniqueness. Refined in a separate in-flight PR per `smooth-singing-aurora` plan.

## Plan

### Strip pass

1. Drop `(Story 1.7)` from `apiClient.ts:2`.
2. Drop `AC1 / AC2 / AC3 / AC4` mapping block (9 lines) at `apiClient.ts:20-28`.
3. Drop `epics.md §Story 1.7` cross-refs at `apiClient.ts:7` + `apiClient.ts:20`.
4. Drop `// Network error during refresh — AC4 says we surface offline state and do NOT clear tokens / navigate. The caller will raise onOffline and bubble the original request's failure.` (6 lines) — function body already encodes it.
5. Drop inline `// AC4: surface offline state, do NOT clear tokens or navigate.` at `apiClient.ts:216`.
6. Drop inline `// AC2: refresh itself 401'd → log out, navigate to /login?next=...` at `apiClient.ts:224`.
7. Drop `(Story 1.7: "does not retry refresh more than once per API call" — we extend that to "once per concurrent burst" for the same reason)` at `apiClient.ts:13`.
8. Drop `(P1 #2)` + `(api critique)` review marker at `idempotencyKey.ts:2`.
9. Drop the Rahim persona narrative (13 lines) at `idempotencyKey.ts:11-23`.
10. Drop `packages/api/src/middleware/idempotency.ts` cross-ref at `idempotencyKey.ts:16`.
11. Drop `IDEMPOTENCY_TTL_MS (5 minutes)` constant ref at `idempotencyKey.ts:22`.
12. Drop `packages/web/tsconfig.json` line ref at `idempotencyKey.ts:26`.

### Trim pass

13. **`idempotencyKey.ts` header**: 30 → 3 lines.
14. **`apiClient.ts` header**: 33 → 7 lines.

### Preserved (load-bearing)

- The single-flight `inflightRefresh` lock.
- The `refresh_network_error` sentinel distinct from `null`.
- The `AccessTokenSchema.safeParse` schema-drift guard.
- The `RetryArgs` interface boundary.
- The `configureApiClient` injection seam + `_resetApiClientConfig` test seam.
- `credentials: "include"` on every fetch (httpOnly cookie).
- The `withJsonContentType` body-presence default.
- The `withBearer` `skipAuth` short-circuit.
- `crypto.randomUUID()` direct call (no shim).

## Verification

```bash
npx --prefix packages/web tsc -b
npx --prefix packages/web eslint packages/web/src/api
cd packages/web && npx vitest run src/api 2>&1 | tail -10
node scripts/lint-prose.mjs
node scripts/lint-impeccable.mjs 2>&1 | head -5 || true
```
