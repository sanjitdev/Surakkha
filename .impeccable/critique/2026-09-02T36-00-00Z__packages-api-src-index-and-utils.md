# Critique — `packages/api/src/index.ts` + utils (audit.ts, errors.ts, httpStatus.ts)

**Date:** 2026-09-02T36:00:00Z
**Surface:** `packages/api/src/` top-level (4 files: `index.ts`, `audit.ts`, `errors.ts`, `httpStatus.ts`)
**Method:** Nielsen 10-heuristics (1–4 scale, total /40) + AI-slop detection
**Loop:** post-distillation, post-`boot/` extraction (loops #199, #200 series)

## Scope

```
packages/api/src/
├── index.ts        319 LOC  — boot() + Express app composition + process exit
├── audit.ts         32 LOC  — audit logger interface
├── errors.ts        82 LOC  — ERROR_CODES enum-like + error envelope mapper
└── httpStatus.ts    36 LOC  — HTTP status code constants
```

`index.ts` is the boot orchestrator. After the 2026-08-30 distillation
extracted boot concerns to `boot/`, the file is now 319 LOC (was 842).
The 3 utility files are the post-distillation single-source-of-truth
modules for canonical HTTP status codes and error-code identifiers.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic            | Score | Note                                                                                                                                                                                                  |
| --- | -------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visibility           | 4     | Health endpoint at `/health`; `EX_CONFIG` exit on WriteAmplificationError; `EXIT_FAILURE` on other boot failures; log lines on every state change.                                                    |
| 2   | Match real world     | 4     | Vocabulary: `assertJwtSecret`, `initializeRuleEngine`, `wireDashboardNamespace`, `wireIngestSocket` — domain-shaped names.                                                                            |
| 3   | User control/freedom | 3     | `SKIP_MIGRATIONS === "true"` env var short-circuit for runtime images without the db package's toolchain; `PORT` env var override; lazy-resolver for Prisma.                                          |
| 4   | Consistency          | 2     | `index.ts` header is 41 lines (still the worst on this surface); per-route inline JSDoc blocks restate Story codes; `httpStatus.ts` 14-line and `audit.ts` 9-line headers restate extraction history. |
| 5   | Error prevention     | 4     | `assertJwtSecret` fail-fast pre-Express; `WriteAmplificationError → EX_CONFIG` (78) sysexits.h; catch-all 404 pinned last; `:status` + `error` literal shape preserved.                               |
| 6   | Recognition > recall | 3     | `HTTP_OK`/`HTTP_NOT_FOUND`/`ERROR_CODES.NOT_FOUND` are first-class identifiers; `SKIP_MIGRATIONS` + `EX_CONFIG`/`EXIT_FAILURE` are named; `markPublic`/`authenticate` order visible.                  |
| 7   | Flexibility          | 4     | Lazy-resolve Prisma via `getPrisma`; `markPublic` wrapper on auth routes; boot-time vs runtime config separation; `audit.emit` lazy-resolves too.                                                     |
| 8   | Minimalist design    | 2     | `index.ts` 41-line header + 13 per-route JSDoc blocks; `errors.ts` 21-line + 22-line twin headers; `httpStatus.ts` 15-line header + 8-line footer.                                                    |
| 9   | Help recover errors  | 4     | `boot().catch(...)` routes `WriteAmplificationError` to `EX_CONFIG`; other failures to `EXIT_FAILURE`; `process.exit` only inside the catch.                                                          |
| 10  | Help & docs          | 3     | Comments over-narrate the WHY behind the catch-all 404 ordering and the WriteAmplificationError → EX_CONFIG pin, but the WHY is load-bearing for the source-walk specs.                               |

**Weighted total: 32/40.**

## AI-slop detection

### P1 (block merge)

- **`index.ts` header is 41 lines (lines 1-42).** Re-tells Story codes (`Story 1.4`, `Story 1.5`, `Story 2.2`, `Story 2.5`, `Story 2.6`, `Story 2.7`, `Story 3.2`, `Story 3.5`, `Story 3.7`, `Story 4.2`, `Story 4.10`, `Story 4.13`, `Story 5.2`, `Story 5.3`, `Story 5.5`, `Story 5.6`), AC codes (`AC-N`), matrix-row codes, `Patch (code review 2026-08-27)`, `Step 0`, `Step-NN`, `Loop N hardening`, `distilled 2026-08-30` extraction markers. The contract is in the epic + DESIGN.md; the source is the renderer.

  Trim to ≤ 15 lines stating the file purpose + boot orchestration sequence.

- **`index.ts` has 13+ per-route inline JSDoc blocks re-narrating Story codes.** Each `app.use(buildXxxRouter(...))` line carries a multi-line JSDoc above it restating Story X.Y, RBAC per route, and lint ceilings. Examples:

  - Lines 132-148: 17-line `io`/Socket.IO setup preamble restating `Story 2.2`, `Story 2.6`, and the dashboard namespace registration rationale.
  - Lines 257-274: 18-line `SKIP_MIGRATIONS` JSDoc restating F-W1 escape hatch rationale + Docker Compose CI vs runtime deployment story.
  - Lines 154-158: `Story 2.6 — `/api/readings/latest`(replaces the Story 1.5 stub at`/devices`). RBAC-gated by `read Device`so every authenticated role can hit it. The list-reader is lazy-resolved via`getPrisma()` so a transient DB outage at boot does not crash the api.` — 4-line preamble for a 6-line `app.use(...)` call.

- **`index.ts` lines 300-304** — `Patch (spec-3-4 review 2026-08-27, P-L2-1)` code-review marker re-narrates the WriteAmplificationError → EX_CONFIG fix that is already encoded in code. Move to critique + git history.

- **`httpStatus.ts` lines 1-15** — 15-line header restating "drift-safe today" + "AI-slop signature" + "12 routers each re-declared their own" extraction history. The module's purpose is self-evident from the constants it exports.

- **`audit.ts` lines 1-8** — 8-line header restating "v1 implementation in `index.ts`" + "v2 (Story 5.6) writes to the database" extraction history. The contract is the interface body.

- **`errors.ts` lines 1-21 + lines 23-27** — 21-line header + 5-line `as const` preamble. The header restates "single source of truth" + "12+ routers" + "ESLint would not catch it (the prose-linter misses it because it's a code-string, not prose)" extraction narrative. The `as const` preamble restates the obvious "as const" semantics.

### P2 (apply before merge)

#### Story codes / "distilled" / extraction markers

- `index.ts:6-11` — 7 inline route listings each prefixed with `Story X.Y` codes.
- `index.ts:18-25` — `Distilled 2026-08-30` extraction marker + cross-file line ref (`src/boot/` + `*wiring.ts` modules).
- `index.ts:26-37` — `Source-walk pins (do NOT refactor without updating the test)` block + cross-file line refs (`__tests__/catchall-404-order.spec.ts`, `health.public.spec.ts`, `boot-fallback.spec.ts`, `boot.skipMigrations.spec.ts`, `boot-exit-code.spec.ts`).
- `index.ts:89` — `Fail-fast — must precede Express construction (Story 1.4 AC + FR-25).`
- `index.ts:95-101` — `Story 5.6` rationale in v2 audit emitter preamble.
- `index.ts:113-118` — `Story 2.5 — /admin/simulator/status is public...` inline JSDoc.
- `index.ts:120-128` — `Health endpoint — must mount BEFORE authenticate` inline rationale.
- `index.ts:133-148` — 17-line `Story 2.2 — bind Socket.IO to the same HTTP server` + `Story 2.6 — declare the /dashboard namespace` block.
- `index.ts:154-158` — `Story 2.6 — /api/readings/latest` inline rationale.
- `index.ts:166-167` — `Story 2.7 — GET /api/devices` inline rationale.
- `index.ts:168-172` — `Story 5.2 — GET /api/devices/:deviceId/readings.csv` inline rationale + `RUNBOOK §6a` cross-file line ref.
- `index.ts:181-184` — `Story 2.6 — /api/incidents/recent` inline rationale + `SEVERITY_BUCKETS` removal note.
- `index.ts:192-199` — `Story 2.5 — mount the admin simulator router (authenticated surface).`
- `index.ts:201-204` — `Story 4.2 — resolveActorUserId(jwt) lazy-upsert helper. Extracted to auth/actorUserIdResolver.ts to keep index.ts under the lint max-lines: 500 ceiling (Patch #18 from code review 2026-08-27).`
- `index.ts:206-208` — `Story 3.7 — /admin/thresholds admin tab.`
- `index.ts:210-212` — `Story 3.5 — alerts (acknowledge + list).`
- `index.ts:214-218` — `Story 4.2 — mount the /api/incidents transition router`.
- `index.ts:227-228` — `Story 4.10 — mount /api/notifications`.
- `index.ts:230-235` — `Story 5.3 — mount /api/audit/list` + `Story 5.6` cross-ref.
- `index.ts:237-239` — `Story 4.13 — mount /api/incidents/:id/attachments`.
- `index.ts:241-247` — `Story 5.5 — schedule the hourly retention cron`.
- `index.ts:249-255` — `Final 404 — registered AFTER every router mount...` inline rationale.
- `index.ts:257-274` — `Story 2.2 — run migrations before binding the API port...` + `F-W1 escape hatch` + `packages/api/Dockerfile` cross-file ref.
- `index.ts:289-293` — `Story 3.2 — install the rule engine hooks`.
- `index.ts:300-304` — `Patch (spec-3-4 review 2026-08-27, P-L2-1)` + `boot-exit-code.spec.ts` test ref.
- `audit.ts:1-8` — `Story 1.5`, `Story 1.4`, `Story 5.6` extraction narrative.
- `errors.ts:1-21` — `2026-08-31 api polish pass` + `12+ routers` + `12 routers` extraction narrative.
- `httpStatus.ts:1-15` — `2026-08-31 api polish pass` + `12 routers each re-declared` + `55 declarations` extraction narrative.

These are noise — git tracks the moves.

#### Cross-file line refs

- `index.ts:20` — `boot/`, `*wiring.ts modules under their feature directories`
- `index.ts:21` — `__tests__/catchall-404-order.spec.ts`
- `index.ts:30-32` — `health.public.spec.ts`, `catchall-404-order.spec.ts`
- `index.ts:36-37` — `boot.skipMigrations.spec.ts` + `boot-exit-code.spec.ts`
- `index.ts:39-41` — `boot/ruleEngine.ts`, `boot-fallback.spec.ts`
- `index.ts:172` — `RUNBOOK §6a`
- `index.ts:269-273` — `packages/api/Dockerfile`
- `index.ts:251-252` — `__tests__/catchall-404-order.spec.ts`
- `index.ts:304` — `boot-exit-code.spec.ts`
- `audit.ts:6-7` — `index.ts`, `Story 5.6`

These break on every refactor. The boot/ directory layout is now stable; the cross-file pins are documented by the source-walk specs, not by the source.

#### Long narrative rationale blocks

- `index.ts:120-128` (9 lines) — `/health` ordering rationale restating the Docker Compose `depends_on: condition: service_healthy` flow. The ordering is pinned by `health.public.spec.ts`; the source just needs the order.
- `index.ts:201-204` (4 lines) — `Story 4.2 — resolveActorUserId` rationale restating `Patch #18 from code review 2026-08-27` extraction history.
- `index.ts:241-247` (7 lines) — `Story 5.5 — schedule the hourly retention cron` block restating `pg_try_advisory_lock`, `cron_run_completed` audit rows.
- `index.ts:257-274` (18 lines) — `Story 2.2 — run migrations before binding the API port` + `F-W1 escape hatch` + Docker runtime stage + production deploy CI step.
- `index.ts:300-304` (5 lines) — `Patch (spec-3-4 review 2026-08-27, P-L2-1)` rationale restating the WriteAmplificationError → EX_CONFIG fix that the code already encodes.
- `errors.ts:1-21` (21 lines) — header re-narrating "single source of truth" + "12+ routers" + ESLint-vs-prose-linter comparison.
- `errors.ts:23-27` (5 lines) — `as const` preamble restating the obvious semantics of `as const`.
- `errors.ts:36-40` (5 lines) — State-machine section header restating the InvalidStateTransition envelope vocabulary.
- `errors.ts:61-64` (4 lines) — Reason-payloads section re-narrating the api-vs-web envelope parsing contract.
- `errors.ts:68-72` (5 lines) — ErrorCode union preamble restating "type checker narrows the discriminant for callers".
- `errors.ts:75-80` (6 lines) — ALL_ERROR_CODES array preamble restating "use this in tests to assert every error envelope".
- `httpStatus.ts:1-15` (15 lines) — header restating extraction history + "low-grade AI-slop signature" + "single place to update".
- `httpStatus.ts:28-35` (8 lines) — HTTP_STATUS_MAX_CACHEABLE preamble restating Idempotency-Key replay semantics + middleware/idempotency.ts cross-file ref.
- `audit.ts:1-8` (8 lines) — header restating "imported by the auth router (Story 1.4)" + "the RBAC middleware (Story 1.5)" + "v1 implementation in index.ts" + "v2 (Story 5.6) writes to the database".

#### "Patch (code review ...)" / "F-P..." / "Loop N hardening" markers

- `index.ts:201-204` — `Patch #18 from code review 2026-08-27`
- `index.ts:300-304` — `Patch (spec-3-4 review 2026-08-27, P-L2-1)` + `P-L2-1` matrix pin.

These are commit-message material, not source.

### Non-findings (verified, not raised)

- **The `boot().catch(cause => { if (cause instanceof WriteAmplificationError) ... })` shape** is correct — `WriteAmplificationError → EX_CONFIG` + `EXIT_FAILURE` fallback is the load-bearing boot-fallback pin.
- **The mount order** (auth → public simulator → healthcheck → authenticate → routers → catch-all 404) is pinned by `__tests__/catchall-404-order.spec.ts` and `health.public.spec.ts`. Order preserved verbatim.
- **`app.get("/health", ...)` registered BEFORE `app.use(authenticate)`** without `markPublic` — pinned by `health.public.spec.ts`. Preserved.
- **The catch-all 404 handler** (`app.use((_req, res) => { res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value }); })`) — registered LAST; body uses `HTTP_NOT_FOUND` + `ERROR_CODES.NOT_FOUND.value`. Pinned by `__tests__/catchall-404-order.spec.ts`. Preserved.
- **`SKIP_MIGRATIONS === "true"` exact-string comparison** — pinned by `boot.skipMigrations.spec.ts`. Preserved.
- **`initializeRuleEngine()` call inside `boot()` (after `await migrateModule.runMigrations()`)** — rule cache must populate before WS connection. Pinned by `boot-fallback.spec.ts`. Preserved.
- **`audit = createAuditLogWriter({ resolvePrismaClient: getPrisma, logger })`** — lazy-resolves Prisma on first emit. Preserved.
- **The 16 HTTP status code constants** (`HTTP_OK = 200`, `HTTP_CREATED = 201`, `HTTP_NO_CONTENT = 204`, `HTTP_BAD_REQUEST = 400`, `HTTP_UNAUTHORIZED = 401`, `HTTP_FORBIDDEN = 403`, `HTTP_NOT_FOUND = 404`, `HTTP_CONFLICT = 409`, `HTTP_INTERNAL_ERROR = 500`, `HTTP_BAD_GATEWAY = 502`, `HTTP_SERVICE_UNAVAILABLE = 503`, `HTTP_STATUS_MAX_CACHEABLE = 500`) — every value pinned by `lint-rbac-matrix.mjs` (transitively, via the api handler files). Preserved.
- **The `ERROR_CODES` enum ordering** — `INTERNAL_ERROR`, `NOT_FOUND`, `VALIDATION_ERROR`, `FORBIDDEN`, `UNAUTHORIZED`, then state-machine, then auth, then validation, then simulator admin, then alerts ingest, then `CONCURRENT_MODIFICATION`. Position is load-bearing for the lint-rbac-matrix (the `Record<>` narrowing assumes the slot). Preserved.
- **`EX_CONFIG (78)` and `EXIT_FAILURE (1)` named constants** — pinned by `boot-exit-code.spec.ts` + `boot/socketIO.ts` callers. Preserved.
- **The `DEFAULT_API_PORT = 3000` constant + `PORT = Number(process.env["PORT"] ?? DEFAULT_API_PORT)` shape** — pinned by `boot.skipMigrations.spec.ts` (port is in scope). Preserved.
- **`assertJwtSecret()` call BEFORE `const app = express()`** — fail-fast contract. Pinned by the JWT_SECRET_MIN_LENGTH check. Preserved.
- **`{ name: "surakkha-api", level: "info" }` logger config** — preserved.
- **`createAuditLogWriter` lazy-resolve via `getPrisma`** — preserves the v1 no-boot-Prisma-deps property. Preserved.
- **`createHttpServer(app)` bound to Socket.IO BEFORE `httpServer.listen(PORT)`** — preserves the boot order. Preserved.
- **The `wireDashboardNamespace` + `wireIngestSocket` sequence** — preserved.
- **The 13 `app.use(...)` mount calls in their exact order** — `auth` → public simulator → (none after) → `authenticate` → `/api/readings/latest` → `/api/devices` → `/api/devices/:deviceId/readings.csv` → `/api/incidents/recent` → `/admin/simulator` → `/api/incidents` (transition) → `/api/notifications` → `/api/audit/list` → `/api/incidents/:id/attachments` + `/api/attachments/:id` → `scheduleRetentionCron` → catch-all 404. Pinned by `__tests__/catchall-404-order.spec.ts`. Preserved verbatim.
- **`mountThresholdsRouter({ app, ... })`** signature — `app` is passed (not `mount`), the wrapper attaches to it. Preserved.
- **`mountAlertRouters({ app, audit, resolvePrismaClient: getPrisma, io })`** — passes `io` so the wrapper can broadcast on alert state changes. Preserved.
- **`buildIncidentsRouterMount({ audit, resolvePrismaClient: getPrisma, resolveActorUserId, io })`** — passes `io` for `incident:state_changed` broadcast. Preserved.
- **`mountNotificationRouter` + `mountAuditRouter` + `mountAttachmentRouter`** — all take `app` (not `mount`) for the same reason as `mountThresholdsRouter`. Preserved.
- **`scheduleRetentionCron({ resolvePrismaClient: getPrisma, audit, logger })`** — return value (the `{ stop }` handle) is intentionally dropped (api is long-running). Preserved.
- **`writeAmplificationError` re-throw** — the catch inspects `cause instanceof WriteAmplificationError`. Preserved.
- **`process.exit(EX_CONFIG)` + `process.exit(EXIT_FAILURE)`** — both with `eslint-disable-next-line no-restricted-properties` comment. Preserved.
- **The `app` export at the bottom** — `export { app }` for HTTP-only tests (which don't need the `boot()` side effects). Preserved.

### Out of scope

- **`packages/api/src/boot/`** (5 files) — `db.ts`, `exits.ts`, `readingDelegate.ts`, `ruleEngine.ts`, `socketIO.ts`. Refined in loop #200 series.
- **`packages/api/src/middleware/authorize.ts`** — `authenticate` + `markPublic`. Source-walk specs in `__tests__/auth.spec.ts`.
- **`@surakkha/shared/auth`** — `assertJwtSecret` + `JWT_SECRET_MIN_LENGTH`. Out of scope.
- **The 16 router files** (`admin/simulatorRouter.ts`, `admin/thresholdsRouter.ts`, `alerts/wiring.ts`, `attachments/routerWiring.ts`, `audit/routerWiring.ts`, `auth/router.ts`, `devices/router.ts`, `incidents/recentRouter.ts`, `incidents/routerWiring.ts`, `notifications/routerWiring.ts`, `readings/csvRouter.ts`, `readings/latestRouter.ts`, `retention/cronWiring.ts`) — refined in earlier loops.
- **Spec files** — `__tests__/boot-exit-code.spec.ts`, `__tests__/boot-fallback.spec.ts`, `__tests__/boot.skipMigrations.spec.ts`, `__tests__/catchall-404-order.spec.ts`, `__tests__/health.public.spec.ts`. Not edited (NEVER edit spec files).

## Plan

### Strip pass

1. Drop `Story X.Y` / `AC-N` / `F-P#` / `Patch (code review ...)` / `Loop N hardening` / `Step-NN` markers from `index.ts` (22+ occurrences).
2. Drop the `Distilled 2026-08-30` extraction marker in `index.ts` header.
3. Drop `Story 1.5` / `Story 1.4` / `Story 5.6` markers in `audit.ts` header.
4. Drop the `2026-08-31 api polish pass` extraction narrative from `errors.ts` and `httpStatus.ts` headers.
5. Drop cross-file line refs (`__tests__/catchall-404-order.spec.ts`, `health.public.spec.ts`, `boot.skipMigrations.spec.ts`, `boot-exit-code.spec.ts`, `boot-fallback.spec.ts`, `RUNBOOK §6a`, `packages/api/Dockerfile`, `index.ts`, `middleware/idempotency.ts`, `boot/ruleEngine.ts`).
6. Drop the `Source-walk pins (do NOT refactor without updating the test)` block in `index.ts:26-37`.

### Trim pass

7. **`index.ts` header**: 41 → ≤ 15 lines. State the file purpose + boot orchestration sequence.
8. **`audit.ts` header**: 8 → ≤ 7 lines.
9. **`errors.ts` header**: 21 → ≤ 7 lines. Collapse the `as const` preamble into a single line.
10. **`errors.ts` `ErrorCode` + `ALL_ERROR_CODES` preambles**: 5 + 6 → ≤ 2 lines each.
11. **`httpStatus.ts` header**: 15 → ≤ 7 lines.
12. **`httpStatus.ts` `HTTP_STATUS_MAX_CACHEABLE` preamble**: 8 → ≤ 3 lines.
13. **`index.ts` per-route inline JSDoc blocks** (13+ occurrences): collapse to 1 line each, retaining only the load-bearing WHY (e.g., the `/health` ordering pin).

### Preserved (load-bearing)

- `boot()` return value signature.
- `boot()` orchestration sequence: `SKIP_MIGRATIONS` check → `runMigrations()` → `initializeRuleEngine()` → `httpServer.listen(PORT)`.
- `boot().catch(...)` shape with `WriteAmplificationError → EX_CONFIG` + `EXIT_FAILURE` fallback.
- `app.get("/health", ...)` registered BEFORE `app.use(authenticate)` without `markPublic`.
- The 13 `app.use(...)` mount calls in their exact order (auth → public simulator → health → authenticate → readers → CSV → recent → admin → alerts → incidents → notifications → audit → attachments → cron → catch-all 404).
- `audit = createAuditLogWriter({ resolvePrismaClient: getPrisma, logger })` lazy-resolve.
- `createHttpServer(app)` + `createSocketIOServer(httpServer)` + `wireDashboardNamespace` + `wireIngestSocket` sequence.
- `assertJwtSecret()` fail-fast BEFORE `const app = express()`.
- `process.exit(EX_CONFIG)` + `process.exit(EXIT_FAILURE)` + their `eslint-disable-next-line` comments.
- `DEFAULT_API_PORT = 3000` + `PORT = Number(process.env["PORT"] ?? DEFAULT_API_PORT)`.
- `SKIP_MIGRATIONS = process.env.SKIP_MIGRATIONS === "true"` exact-string comparison.
- `initializeRuleEngine()` call inside `boot()` (after migrations, before listen).
- `scheduleRetentionCron({ resolvePrismaClient: getPrisma, audit, logger })` — return value dropped.
- `export { app }` at bottom (HTTP-only test seam).
- **HTTP status constants** (16): `HTTP_OK = 200`, `HTTP_CREATED = 201`, `HTTP_NO_CONTENT = 204`, `HTTP_BAD_REQUEST = 400`, `HTTP_UNAUTHORIZED = 401`, `HTTP_FORBIDDEN = 403`, `HTTP_NOT_FOUND = 404`, `HTTP_CONFLICT = 409`, `HTTP_INTERNAL_ERROR = 500`, `HTTP_BAD_GATEWAY = 502`, `HTTP_SERVICE_UNAVAILABLE = 503`, `HTTP_STATUS_MAX_CACHEABLE = 500`.
- **`ERROR_CODES` enum ordering** (19 entries): `INTERNAL_ERROR`, `NOT_FOUND`, `VALIDATION_ERROR`, `FORBIDDEN`, `UNAUTHORIZED`, `INVALID_STATE_TRANSITION`, `INVALID_ASSIGNEE`, `INVALID_CREDENTIALS`, `INVALID_REFRESH`, `INVALID_PAYLOAD`, `INVALID_RANGE`, `INVALID_DEVICE_ID`, `INVALID_IDEMPOTENCY_KEY`, `INVALID_SCENARIO`, `SECRET_MISMATCH`, `SIMULATOR_UNREACHABLE`, `SWITCH_IN_PROGRESS`, `SCHEMA_DRIFT`, `CONCURRENT_MODIFICATION`.
- **All `.value` string literals** (19): `"internal_error"`, `"not_found"`, `"validation_error"`, `"forbidden"`, `"unauthorized"`, `"invalid_state_transition"`, `"invalid_assignee"`, `"invalid_credentials"`, `"invalid_refresh"`, `"invalid_payload"`, `"invalid_range"`, `"invalid_device_id"`, `"invalid_idempotency_key"`, `"invalid_scenario"`, `"secret_mismatch"`, `"simulator_unreachable"`, `"switch_in_progress"`, `"schema_drift"`, `"concurrent_modification"`.
- **`AuditLogger` interface** with `emit` method + `auditAction` / `userId` / `outcome: "success" | "failure" | "allow"` / `context` fields.
- **`ErrorCode` type union** + `ALL_ERROR_CODES` readonly array.

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src
cd packages/api && npx vitest run 2>&1 | tail -10
node scripts/lint-prose.mjs
node scripts/lint-rbac-matrix.mjs
```

All must pass. The `lint-rbac-matrix` script is critical — it pins HTTP status codes (transitively via the handler files that import these constants).

## Loop Status

This is loop #3 on `index.ts`. The 2026-08-30 distillation dropped the file from 842 → 319 LOC. This loop is the second pass on the post-distillation state — most extraction markers should already be gone, but a fresh look may find:

- 41-line header still carries extraction history + AC + matrix pins + lint caps
- 13+ per-route JSDoc blocks still restate Story codes
- 2 cross-file `Patch` markers still re-narrate code-review fixes
- 1 stale `RUNBOOK §6a` cross-file line ref
- 4 cross-file spec-name refs (the spec file names themselves — not necessarily wrong, but redundant with the spec file)

Convergence target: 32 → 36 /40.
