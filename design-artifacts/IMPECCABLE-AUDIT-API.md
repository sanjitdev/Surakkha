# Impeccable Audit — Surakkha API (Backend-Adapted)

**Date:** 2026-08-30
**Target:** `packages/api/src/` (Express 5 + Zod + Prisma + Socket.IO)
**Methodology:** Impeccable v4.1.2 detector (FULL mode — `htmlparser2`, `css-select`, `css-tree`, `domutils` installed) + manual backend-adapted scan. The standard 5-dimension UI framework from `audit.md` does NOT apply to a backend — Accessibility / Performance / Theming / Responsive score zero by definition (no pixels, no theme, no touch targets). **This audit scores 6 backend-specific dimensions instead** (Zod consistency, error envelope + HTTP status, RBAC coverage, Prisma client patterns, controller shape, state machine integrity). 0-4 per dimension, /24 total.
**Scope:** Companion to `IMPECCABLE-AUDIT.md` (web UI). The two audits together cover Surakkha's surface; `packages/db` (Prisma schema + migrations) and `packages/shared` (pure types) are excluded.
**Detector mode:** FULL. The detector's HTML pipeline finds no targets in a backend (no rendered HTML), so its value here is limited — findings below are 95% manual verification.

---

## Audit Health Score

| #         | Dimension                    | Score       | Key Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Zod schema consistency       | **4 / 4**   | Every router parses request bodies/params through `.strict()` Zod schemas (`transitionHelpers.ts:99, 105, 111, 132`; `acknowledgeRouter.ts:158`; `thresholdsRouter.ts:184, 192, 435, 471, 514`); the canonical incident / alert / device schemas live in `packages/shared/src/*` and are imported — no hand-rolled duplicates in production handlers. One deviation: `index.ts:256` re-declares the severity enum as a hand-rolled `Set` (P1, see §2).                                                                    |
| 2         | Error envelope + HTTP status | **2 / 4**   | HTTP status constants are re-declared in 5 files (`simulatorClient.ts`, `simulatorRouter.ts`, `thresholdsRouter.ts`, `transitionHelpers.ts`, plus `index.ts`). The 409 envelope has **three distinct shapes** in one file (`transitionHelpers.ts:498` vs `:545` vs `:558`); the 403 envelope has two shapes (auth deny + RBAC-ownership deny). The SPA must branch on every status + envelope key.                                                                                                                        |
| 3         | RBAC middleware coverage     | **4 / 4**   | `authorize({ action, resource })` is the single source of truth, applied to every non-public route; audit-row emission is consistent on denial; `smallestGrantingRole` computes the `required_role` field on 403 responses (`authorize.ts:165`). Incident ownership gate mirrors the contract for `submit_result`.                                                                                                                                                                                                        |
| 4         | Prisma client usage patterns | **3 / 4**   | Lazy `resolvePrismaClient()` singleton is the standard pattern; narrow repository slices (`incidentStateRepository.ts`, `thresholdsRouter.ts:61-178`, `notificationRepository.ts`, `attachmentRepository.ts`) are the contract everywhere — except in `index.ts` itself, where 4 list-readers bypass the slice pattern with `(client as any).$queryRaw` / `client.incident.findMany`. **The entrypoint file is the worst offender.**                                                                                      |
| 5         | Controller shape consistency | **3 / 4**   | All routers built with `buildXRouter(deps)` factories. Per-handler signatures are uniform. Deps-bag shapes drift: `buildAlertAcknowledgeRouter({audit, prisma, broadcast, now})` has 4 fields; `buildThresholdsRouter({audit, repo})` has 2; `buildIncidentsRouterMount(...)` has 4. No canonical `RouterDeps` base shape — each new router re-invents the contract. `index.ts` itself is **842 lines**, breaking the project's own `max-lines: 500` lint rule.                                                           |
| 6         | State machine integrity      | **4 / 4**   | `packages/api/src/incidents/transitions.ts` is a pure module with no DB / socket / audit dependencies — a textbook `TRANSITIONS` table per the spec. `transitionHelpers.ts:700` writes `auditAction: "invalid_state_transition"` on every rejection. `applyTransition` wraps alert+state+notification writes in a single `$transaction` with the P2002 idempotency guard (`rules/applyTransition.ts:114, 415`). Compare-and-set ack predicate (`updateMany({where: {id, acknowledgedAt: null}})`) is correctly race-free. |
| **Total** |                              | **20 / 24** | **Excellent.** Address Dimension 2 (error envelopes) and Dimension 5 (`index.ts` size) to reach the upper band.                                                                                                                                                                                                                                                                                                                                                                                                           |

**Rating band:** 18-20 Excellent (minor polish). Surakkha's api is in the lower-Excellent band — the surface is coherent, the contracts are clean, the score will move with one focused PR on the error-envelope and entrypoint-shape work.

---

## Implementation Integrity Verdict

**Pass, with two named exceptions.**

The api expresses a coherent product-specific system. The 7-state incident machine is implemented exactly once (`packages/shared/src/incident.ts`) and consumed by every transition path. The RBAC contract is a single source of truth (`middleware/authorize.ts`), mirrored for incident ownership in `transitionHelpers.ts`. All routers use the factory pattern; all request bodies go through `.strict()` Zod; all alert+state+notification writes are atomic; all idempotency is enforced via predicate-under-lock.

**Exception 1 — `index.ts` is 842 lines.** The comment at `index.ts:672` reads "Extracted to `notifications/routerWiring.ts` to keep `index.ts` under `max-lines: 500`" — but the file is 842 lines, contradicting the lint rule the file itself cites. This is the most fragile file in the api (boot path, Socket.IO wiring, Prisma resolution, dashboard namespace, 404 catch-all, alert wrappers, thresholds wrapper) and the only one to receive new mount logic with every story. Future stories (4.13, 4.14, 5.x) will continue to balloon it.

**Exception 2 — bypassed repository-slice pattern in `index.ts`.** Four list-readers (`listLatestReadingsFromPrisma`, `listDevicesRosterFromPrisma`, `listRecentIncidentsFromPrisma`, `listDevicesFromPrisma`) call `(client as any).$queryRaw` / `client.incident.findMany` directly. The cast at `index.ts:139` carries an `eslint-disable-next-line @typescript-eslint/no-explicit-any` suppression. A future Prisma schema drift on `Reading` or `Incident` columns will not be caught by the narrow slice's type contract — the call site relies on inline shape annotation.

Detector flagged **0 anti-patterns** in the api (the detector targets rendered HTML / CSS classes; a backend has no rendered output). The 8 anti-patterns flagged in the prior web audit (`side-tab` for `border-l-4`, `overused-font` for Inter) are both false positives documented in `IMPECCABLE-AUDIT.md` and do not recur here.

---

## Executive Summary

**Audit Health Score: 20 / 24 (Excellent).** Dimensions 2 (error envelopes) and 5 (controller shape) are the weakest, both with the same root cause: too much cross-cutting concern lives in `index.ts` and the cross-router error/HTTP conventions drift between sibling files.

**Total issues found (counted by severity):**

- **P0 (blocking):** 0
- **P1 (major):** 4
- **P2 (minor):** 5
- **P3 (polish):** 4
- **Total:** 13

**Top 5 critical issues:**

1. **[P1]** `index.ts` at 842 lines, contradicting the project's own `max-lines: 500` lint rule. Comments in the file itself acknowledge the rule was being followed; later features (Story 4.10, 4.13, incident mount) silently broke the contract.
2. **[P1]** Bypassed repository-slice pattern in `index.ts` — 4 list-readers use `(client as any)` directly, defeating the narrow-type contract that the rest of the codebase relies on for drift detection.
3. **[P1]** Hand-rolled severity bucket check duplicates shared logic (`index.ts:256`).
4. **[P1]** Inconsistent 409 error envelope — three shapes in `transitionHelpers.ts` alone (`{from, attempted}` at line 498 vs `{reason: "concurrent_modification"}` at lines 545 + 558).
5. **[P2]** HTTP status constants re-declared across 5 files — no `packages/api/src/http.ts` module.

**Recommended next steps:**

- **Extract `boot/` directory from `index.ts`** (P1): `boot/runMigrations.ts`, `boot/initSocketIO.ts`, `boot/wireRouters.ts`, `boot/resolvers.ts`. Drop `index.ts` to ~100 lines (Express app + listen). This is the highest-leverage single PR — it touches the file the boot path lives in, the file every new story adds mount logic to, and the file that hosts the 4 bypassed list-readers.
- **Define `@surakkha/shared/error-envelope` Zod schema** (P1): one union of `{ error: ErrorCode, details?: {...} }`. Sweep every `res.status(...).json(...)` site to conform; replace 3-shape 409 with `{error: "invalid_state_transition", reason, from?, attempted?}`.
- **Add `packages/api/src/http.ts` exporting the canonical `HTTP_*` constants** (P2): import at every router. Two-line PR; one review cycle.

---

## Detailed Findings by Severity

### [P1] `index.ts` is 842 lines, breaking `max-lines: 500`

- **Dimension:** 5 (Controller shape consistency)
- **Location:** `packages/api/src/index.ts` (entire file)
- **Evidence:** `// Story 4.10 — mount /api/notifications ... Extracted to notifications/routerWiring.ts to keep index.ts under max-lines: 500 (Story 4.10 added ~63 lines).` (line 672) — but `wc -l packages/api/src/index.ts` returns 842.
- **Impact:** Boot path is in one file: migrations, rule engine hydration, Socket.IO wiring, dashboard namespace, 404 catch-all, Prisma resolution, alert wrappers, thresholds wrapper, incident mount, notification mount, attachment mount, subscriber connection. Hard to audit, hard to test in isolation, and the comment lies. New stories will continue to balloon it.
- **Recommendation:** Extract `boot/` directory: `boot/runMigrations.ts`, `boot/initSocketIO.ts`, `boot/wireRouters.ts`, `boot/resolvers.ts`, `boot/listReaders.ts`. `index.ts` should drop to ~100 lines (Express app + listen + boot orchestration).

### [P1] Bypassed repository-slice pattern in `index.ts`

- **Dimension:** 4 (Prisma client usage patterns)
- **Location:** `packages/api/src/index.ts:139, 189, 241, 431` (and `:632` for the reading delegate)
- **Evidence:**
  - Line 139: `// eslint-disable-next-line @typescript-eslint/no-explicit-any\n const rows = await (client as any).$queryRaw\`SELECT DISTINCT ON ...\``
  - Line 189: `// eslint-disable-next-line @typescript-eslint/no-explicit-any\n const c = client as any;`
  - Line 241: `// eslint-disable-next-line @typescript-eslint/no-explicit-any\n const c = client as any;`
  - Line 631: `// eslint-disable-next-line @typescript-eslint/no-explicit-any\n const c = client as any;`
- **Impact:** Bypasses the narrow repository-slice pattern used everywhere else (`incidentStateRepository.ts`, `thresholdsRouter.ts`, `notificationRepository.ts`, `attachmentRepository.ts`). A future Prisma schema drift on `Reading` / `Incident` columns will not be caught by the narrow slice's type contract — the call site relies on `as any` and inline shape annotation. **The entrypoint file is the worst offender for the only Prisma pattern that catches drift.**
- **Recommendation:** Move `listLatestReadingsFromPrisma`, `listDevicesRosterFromPrisma`, `listRecentIncidentsFromPrisma`, `listDevicesFromPrisma` into dedicated `*Repository.ts` modules; consume via the same lazy-resolver pattern as `resolveAlertListRepository`. Sweep `(client as any)` casts to zero.

### [P1] Hand-rolled severity bucket duplicates `@surakkha/shared/incident.SeveritySchema`

- **Dimension:** 1 (Zod schema consistency)
- **Location:** `packages/api/src/index.ts:256`
- **Evidence:** `const SEVERITY_BUCKETS = new Set(["info", "warning", "critical"]);`
- **Impact:** The canonical severity enum lives in `@surakkha/shared/incident` (and is the source of truth for both wire shapes + the Zod schemas). The inline `Set` is a duplicate: a new severity added in `shared` would not be reflected here silently — the inline set will reject the new value and silently coerce to `"warning"` (line 271).
- **Recommendation:** Import the canonical `SeveritySchema` from `@surakkha/shared` and use `SeveritySchema.safeParse(row.severity).data ?? "warning"`. The hand-rolled Set disappears; the silent-coerce becomes typed.

### [P1] Inconsistent 409 error envelope — three shapes in one file

- **Dimension:** 2 (Error envelope + HTTP status)
- **Location:** `packages/api/src/incidents/transitionHelpers.ts:498, 545, 558`
- **Evidence:**
  - Line 498: `{ error: "invalid_state_transition", from, attempted }`
  - Line 545: `{ error: "invalid_state_transition", reason: "concurrent_modification" }`
  - Line 558: `{ error: "invalid_state_transition", reason: "concurrent_modification" }`
- **Impact:** Same HTTP status (409), same `error` code, three different envelope shapes — the SPA cannot render uniform error UI. The `from`/`attempted` keys appear in 1 of 3 sites; `reason` appears in 2 of 3.
- **Recommendation:** Define `@surakkha/shared/error-envelope` as a Zod union with discriminated `error` codes:
  ```
  type ErrorEnvelope =
    | { error: "forbidden"; required_role: Role }
    | { error: "not_found" }
    | { error: "invalid_state_transition"; from?: string; attempted?: string; reason?: "concurrent_modification" | "stale_state" }
    | { error: "validation_error"; issues: ZodIssue[] }
    | { error: "internal_error" }
  ```
  One PR introduces the schema + one helper `respondError(res, code, details)`; one follow-up sweep converts every `res.status(...).json(...)` site.

### [P2] HTTP status constants re-declared across 5 files

- **Dimension:** 2 (Error envelope + HTTP status)
- **Location:** `simulatorClient.ts:34`, `simulatorRouter.ts:46-51`, `thresholdsRouter.ts:61-64`, `transitionHelpers.ts:42-48`, `index.ts:81-83`
- **Evidence:** Each file declares its own subset of `HTTP_OK = 200`, `HTTP_BAD_REQUEST = 400`, `HTTP_FORBIDDEN = 403`, `HTTP_NOT_FOUND = 404`, `HTTP_CONFLICT = 409`, `HTTP_INTERNAL_ERROR = 500`, `HTTP_BAD_GATEWAY = 502`, `HTTP_SERVICE_UNAVAILABLE = 503`. `transitionHelpers.ts` exports them; the others redeclare.
- **Impact:** If a status code convention changes (e.g. switching `not_found` from 404 to 410), all sites must be updated in lockstep — no compiler help across files. The numeric values are duplicated by hand.
- **Recommendation:** Add `packages/api/src/http.ts` exporting the full set of canonical constants. Import everywhere; delete the local declarations. Mechanical sweep; one PR.

### [P2] Two different transaction wrapper signatures

- **Dimension:** 4 (Prisma client usage patterns)
- **Location:** `index.ts:498` vs `thresholdsRouter.ts:170` vs `rules/applyTransition.ts:114, 415`
- **Evidence:** `index.ts:498` does `$transaction: <T>(cb) => cb(await ensureThresholdsRepo())` (wraps the wrapper itself as `tx`); `thresholdsRouter.ts:170` does `client.$transaction(cb)` (raw Prisma call); `rules/applyTransition.ts:114, 415` does `deps.alertState.$transaction(async (tx) => ...)` (typed delegate).
- **Impact:** Three shapes for the same primitive (`$transaction`). The `index.ts` wrapper passes the wrapper itself as `tx`, so the callback's `tx` arg type widens to the wrapper type — non-obvious at the call site.
- **Recommendation:** Standardize on `Repository.$transaction<T>(cb: (tx: Repository) => Promise<T>)` (the `ThresholdsRepository` shape) and reuse via `resolve*Repository` adapters. Three call sites converge to one shape.

### [P2] `markPublic` wrapper not applied to `/health`

- **Dimension:** 5 (Controller shape consistency)
- **Location:** `packages/api/src/index.ts:119-121`
- **Evidence:** `app.get("/health", (_req: Request, res: Response) => { res.status(HTTP_OK).json({ status: "ok", service: "surakkha-api" }); });` — registered BEFORE `app.use(authenticate)` (line 123).
- **Impact:** This works only because `/health` mounts before `authenticate`. Relocating `authenticate` to mount earlier (a future refactor — or a Story that needs an early middleware) silently turns `/health` into 401, breaking Docker healthcheck + Compose service dependency chain. The `markPublic` pattern was designed for exactly this case but isn't used.
- **Recommendation:** Wrap the `/health` handler in `markPublic` and move the registration AFTER `authenticate` so the contract is enforced, not coincidentally satisfied.

### [P2] Deps-bag drift between routers

- **Dimension:** 5 (Controller shape consistency)
- **Location:** `alerts/acknowledgeRouter.ts:139-151`, `admin/thresholdsRouter.ts:175-178`, `incidents/transitionHelpers.ts:56-64`
- **Evidence:**
  - `AlertAcknowledgeDeps`: `{ audit; prisma; broadcast; now: () => Date; }` — 4 fields
  - `ThresholdsRouterDeps`: `{ audit; repo; }` — 2 fields
  - `IncidentsRouterDepsLike`: `{ repo; audit; broadcast?; }` — 3 fields (with optional broadcast)
- **Impact:** Three routers, three different deps contracts. A reviewer must read each `buildXxxRouter` signature to know what to wire. Adding a new router requires choosing which pattern to mirror — no canonical example.
- **Recommendation:** Codify `RouterDeps` base shape `{ audit: AuditLogger; repo: R; broadcast?: BroadcastTarget; now?: () => Date }` with `R` per-router. The fields all flatten; `now` becomes optional + defaulted to `() => new Date()`.

### [P2] Magic HTTP status `78` inline at boot-failure

- **Dimension:** 2 (Error envelope + HTTP status)
- **Location:** `packages/api/src/index.ts:834`
- **Evidence:** `// eslint-disable-next-line no-restricted-properties, no-magic-numbers\n process.exit(78);`
- **Impact:** The `EX_CONFIG` code is hardcoded with a `no-magic-numbers` suppression. The `WriteAmplificationError` handling is repeated knowledge. A future contributor adding a second config-error class will copy-paste the literal 78.
- **Recommendation:** Export `EX_CONFIG = 78` constant from a new `packages/api/src/exitCodes.ts` module. Reference it. Document the exit-code contract in the same module as `WriteAmplificationError`.

### [P3] Swallowed DB errors return `200 []` in 4 list-readers

- **Dimension:** 2 (Error envelope + HTTP status)
- **Location:** `packages/api/src/index.ts:171, 221, 279, 436`
- **Evidence:** `catch (err) { logger.warn({ err }, "...: prisma error, returning empty list"); return []; }` in `listLatestReadingsFromPrisma`, `listDevicesRosterFromPrisma`, `listRecentIncidentsFromPrisma`, `listDevicesFromPrisma`.
- **Impact:** A DB outage returns `200 []` to the dashboard, indistinguishable from "no data yet". Operators can't tell "DB down" from "freshly seeded" from the response alone. The logger emits a `warn` line but the SPA cannot surface it.
- **Recommendation:** Either return `503 Service Unavailable` on transient DB errors, or surface the empty list under a response flag (`{ items: [], degraded: true, last_error_at: iso }`). Trade-off: 503 requires the SPA to render an "unavailable" state vs the current "empty list" state.

### [P3] `$queryRaw` typed as `as any` leaks to call sites

- **Dimension:** 4 (Prisma client usage patterns)
- **Location:** `packages/api/src/index.ts:139, 190` (with `:632` for the reading delegate)
- **Evidence:** `// eslint-disable-next-line @typescript-eslint/no-explicit-any\n const rows = await (client as any).$queryRaw\`...\``
- **Impact:** Three `as any` suppressions in `index.ts` (the entrypoint) — the exact file a future contributor reads first when wiring a new endpoint. The pattern is contagious: one `as any` invites another.
- **Recommendation:** Wrap `$queryRaw` in the corresponding `*Repository.ts` with explicit row-type narrowing (mirroring `incidentStateRepository.ts`'s pattern); routers consume the typed delegate.

### [P3] `cachedPrismaRaw` typed as `unknown`, then re-cast at every call site

- **Dimension:** 4 (Prisma client usage patterns)
- **Location:** `packages/api/src/index.ts:553, 580-588`
- **Evidence:** `let cachedPrismaRaw: unknown = null;` … `if (cachedPrismaRaw !== null) { return cachedPrismaRaw as Awaited<ReturnType<typeof resolvePrismaClient>>; }`
- **Impact:** The `Awaited<ReturnType<...>>` self-referential cast is fragile — if `resolvePrismaClient`'s signature is re-arranged, the cast silently lies. The hand-rolled type only models `device.findMany` and `reading.create`; other delegates (`incident`, `alert`, `notification`) are accessed via separate casts per call site.
- **Recommendation:** Replace the bespoke `resolvePrismaClient` with `getPrisma(): PrismaClient` exported from a new `db.ts` (already used by `rules/prismaReader.ts`). Eliminate `cachedPrismaRaw`.

### [P3] State-machine event_type switch — not data-driven

- **Dimension:** 6 (State machine integrity)
- **Location:** `packages/api/src/incidents/transitions.ts:314-327`
- **Evidence:** `switch (action) { case "acknowledge": return "acknowledge"; ... }` — manual 1:1 map
- **Impact:** Each new `ActionVerb` requires editing both the `TRANSITIONS` table and this switch. TS exhaustiveness catches a missed verb at compile time, but only after a stale switch breaks the build.
- **Recommendation:** Replace with `EVENT_TYPE: Record<ActionVerb, IncidentEventType> = {...} as const; return EVENT_TYPE[action];`

---

## Patterns & Systemic Issues

- **`index.ts` is the systemic outlier.** Of the 13 findings, 6 cluster in `packages/api/src/index.ts`. The file is the entry point AND the largest single file AND the file with the most `(client as any)` bypasses AND the file that breaks `max-lines: 500`. Every story that adds a mount adds lines to this file. **The single highest-leverage PR for the api is to extract `boot/` modules.**
- **Cross-router error envelope drift.** The same `error: "invalid_state_transition"` code has 3 shapes; `error: "forbidden"` has 2 shapes (auth deny + RBAC ownership deny). The SPA must branch on every status + envelope key. A shared `error-envelope` Zod schema in `@surakkha/shared` would close this.
- **Magic status numbers + manual constants redeclaration.** The same HTTP status constants are re-declared in 5 files. A single `packages/api/src/http.ts` would close this.
- **Repository-slice discipline holds except at the entrypoint.** Everywhere except `index.ts`, Prisma is accessed through narrow repository slices with typed delegates. `index.ts` itself bypasses the pattern. This is contagious — new contributors model on what they see first.

---

## Positive Findings

- **Canonical RBAC seam:** `middleware/authorize.ts` is the single source of truth for RBAC enforcement. `smallestGrantingRole(action, resource)` computes the `required_role` field on 403 responses — excellent ergonomics for the SPA's "Request Access" copy.
- **Pure state machine:** `transitions.ts` is a pure module with no DB / socket / audit dependencies. The `TRANSITIONS` table is data-driven and code-walked by `transitions.spec.ts` per the spec. Easy to audit, impossible to drift.
- **Atomic transitions:** `applyTransition` wraps alert+state+notification writes in a single `$transaction`. The P2002 idempotency guard is well-tested (BH-09 patches).
- **Compare-and-set ack semantics:** `acknowledgeRouter.ts:223-260` uses `updateMany({where: {id, acknowledgedAt: null}})` — predicate-under-lock pattern with no race window. AC12b first-ack-only emit is correctly implemented.
- **Strict Zod schemas at boundaries:** Every router body / path-param parses via `.strict()` Zod schemas — unknown fields are rejected. This catches a whole class of "the client added a field we silently ignored" bug.
- **Lazy Prisma resolution:** `resolvePrismaClient` is a singleton with first-use resolution so the HTTP-only test suite doesn't need `DATABASE_URL`. The `as any` casts are contained at the resolver boundary (in the bypass-list-reader modules, not at the call sites).
- **Dependency-injected `now` clock:** `AlertAcknowledgeDeps.now` keeps the wire `acknowledged_at` and DB `acknowledgedAt` on the same Date instance — eliminates 1ms drift (AC1c pin).
- **Incident ownership gate:** `requireOwner` / `maybeOwnershipDenied` enforces Technician-only-mine for `submit_result` with an identical audit-row envelope as `authorize.ts:268-279`. The contract is mirrored, not duplicated.

---

## Recommended Actions

In priority order (P1 first, then P2):

1. **[P1] Extract `boot/` directory from `index.ts`** — single highest-leverage PR. Touches the file the boot path lives in, the file every new story adds mount logic to, and the file that hosts the 4 bypassed list-readers. After this PR, `index.ts` drops to ~100 lines and the `max-lines: 500` rule is restored.
2. **[P1] Define `@surakkha/shared/error-envelope` Zod schema** + sweep every `res.status(...).json(...)` site. The schema also includes the `required_role` field on `forbidden` (already typed), the `issues` array on `validation_error` (already typed via Zod), and the `from`/`attempted`/`reason` fields on `invalid_state_transition` (currently 3 distinct shapes — collapse to one).
3. **[P1] Move the 4 bypassed list-readers in `index.ts` into dedicated `*Repository.ts` modules.** Each gets a narrow typed delegate; `index.ts` consumes via the `resolve*Repository` pattern. Sweep `(client as any)` to zero.
4. **[P1] Replace hand-rolled severity Set (`index.ts:256`) with `SeveritySchema.safeParse(...)` from `@surakkha/shared/incident`.**
5. **[P2] Add `packages/api/src/http.ts` exporting canonical `HTTP_*` constants; sweep every router.**
6. **[P2] Standardize the `$transaction` shape across `index.ts:498`, `thresholdsRouter.ts:170`, `rules/applyTransition.ts:114, 415` to one signature.**
7. **[P2] Wrap `/health` in `markPublic`; move its registration after `authenticate`.**
8. **[P2] Codify `RouterDeps` base shape across `AlertAcknowledgeDeps`, `ThresholdsRouterDeps`, `IncidentsRouterDepsLike`.**
9. **[P2] Export `EX_CONFIG = 78` constant from a new `packages/api/src/exitCodes.ts` module.**
10. **[P3] Make swallowed-DB-error list-readers return `503` or `{ items: [], degraded: true }`.**
11. **[P3] Replace bespoke `cachedPrismaRaw` + `Awaited<ReturnType<...>>` self-referential cast with `getPrisma(): PrismaClient` exported from a `db.ts` module.**
12. **[P3] Replace state-machine event_type switch with `Record<ActionVerb, IncidentEventType>`.**

After applying the P1 set, re-run `/impeccable audit` on `packages/api` to confirm the score moves from 20/24 → 23+/24.

---

## Notes & Methodology

- **Backend-adapted, not standard audit.md.** The standard 5-dimension framework (A11y / Performance / Theming / Responsive / Implementation Integrity) does not apply to a backend — Accessibility / Performance / Theming / Responsive score zero by definition (no pixels, no theme, no touch targets). This audit scores 6 backend-specific dimensions instead. The score is /24, not /20.
- **No browser visualization.** Per the critique step's mandate, browser visualization would normally be used to surface rendering defects. There is no rendering surface in a backend; visualization is N/A.
- **Detector finds 0 anti-patterns in the api.** The detector targets rendered HTML / CSS classes (designed for the web); a backend has no rendered output. Findings are 95% manual verification.
- **Spec files were read for behavior pinning** but not analyzed. Production code under `packages/api/src/` (excluding `__tests__/` and `*.spec.ts`) was the target.
- **Validation:** `pnpm --filter @surakkha/api typecheck` and `pnpm --filter @surakkha/api lint` both clean at audit time (audit findings would change post-`boot/` extraction). Test suite: `pnpm --filter @surakkha/api test` reports green at audit time (not re-run for this report).
