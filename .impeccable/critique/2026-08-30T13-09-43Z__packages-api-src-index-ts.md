---
target: packages/api/src/index.ts
total_score: 12
max_score: 16
na_heuristics: 2,3,6,7,8
p0_count: 0
p1_count: 4
timestamp: 2026-08-30T13-09-43Z
slug: packages-api-src-index-ts
---

# Impeccable Critique — Surakkha API (Backend)

**Target:** `packages/api/src/index.ts` (full backend: `packages/api/src/`, ~50 production TS files)
**Date:** 2026-08-30
**Method:** dual-agent (A: design review · B: detector evidence)

> **Note on Nielsen applicability:** 6 of 10 heuristics score `n/a` for a backend — the heuristics were authored for interactive interfaces. The applicable max is **/16** (4 heuristics × 4 points), not /40. The audit's 6-dimension backend score (20/24, Excellent) is the authoritative rating for this surface.

---

## Design-Specificity Verdict

**LLM assessment (Assessment A): PASS.**
The wire shapes, error codes, and routing morphology are unmistakably Surakkha-shaped. `IncidentState` is a 7-state enum whose transitions (OPEN → ACKNOWLEDGED → INSPECTING → SAFE/UNSAFE/MONITORING → RESOLVED → REOPENED-as-alias-for-OPEN) only make sense for a monitoring/safety operations workflow. `InspectionOutcome` is `SAFE | UNSAFE | MONITORING` (`packages/shared/src/incident.ts:66`). The `submit_result` verb carries an outcome payload that wouldn't translate to an unrelated domain. Socket rooms are `incident:<uuid>` with `incident:state_changed` events — domain-shaped even on generic Socket.IO infrastructure. The error codes (`invalid_state_transition`, `not_assignee`, `rbac_denied` with `required_role`, `concurrent_modification`) carry product meaning, not HTTP synonyms.

**Deterministic scan (Assessment B):** detector returned `[]` for `packages/api/src/` — **expected**, not a sign of clean code. The detector targets rendered HTML / CSS classes; a backend emits JSON envelopes and HTTP status lines, neither of which carry DOM nodes for the rule pipeline. Of the 13 audit findings, ~46% are within reach of an extended detector (regexes for `(client as any)`, distinct-envelope-per-`error`-code, line-count thresholds); the rest require control-flow or cross-file AST analysis that the current detector cannot do. Three concrete new detector rules (`no-prisma-client-as-any`, `single-error-envelope-per-error-code`, `max-lines-enforce-with-allowlist`) would have caught 4 audit findings directly.

**Visual overlays:** SKIPPED — no viewable surface to instrument.

---

## Nielsen Heuristic Scores

| #         | Heuristic                       | Score       | Key Issue                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 2           | `/api/incidents/recent` returns `200 []` on transient DB outage (`index.ts:279`) — indistinguishable from "no data yet." Operators cannot tell DB-down from freshly-seeded.                                                                                                                                                                                |
| 2         | Match System / Real World       | n/a         | No interactive surface — vocabulary mapping happens in the SPA, not the api.                                                                                                                                                                                                                                                                               |
| 3         | User Control and Freedom        | n/a         | No user-controlled state on the api side.                                                                                                                                                                                                                                                                                                                  |
| 4         | Consistency and Standards       | 2           | 409 envelope has **3 distinct shapes** in one file (`transitionHelpers.ts:498/545/558`); HTTP status constants re-declared in 5 files; deps-bag shape drifts across 3 routers. The strictness claim breaks at the cross-router boundary.                                                                                                                   |
| 5         | Error Prevention                | 3           | `.strict()` Zod at every boundary rejects unknown fields; compare-and-set ack predicate (`updateMany({where: {id, acknowledgedAt: null}})`) prevents double-ack; `applyTransition` wraps alert+state+notification in `$transaction`. Strong, with one named gap: **no Idempotency-Key on transition POSTs** — a flaky-network retry writes two audit rows. |
| 6         | Recognition Rather Than Recall  | n/a         | No interactive surface.                                                                                                                                                                                                                                                                                                                                    |
| 7         | Flexibility and Efficiency      | n/a         | No keyboard nav, no shortcuts to evaluate.                                                                                                                                                                                                                                                                                                                 |
| 8         | Aesthetic and Minimalist Design | n/a         | No visual layer.                                                                                                                                                                                                                                                                                                                                           |
| 9         | Error Recovery                  | 2           | 409 carries `from`/`attempted` on one path, `reason: "concurrent_modification"` on two paths — the SPA cannot render uniform retry UI. P2002 idempotency collapses to 409 with `concurrent_modification` but the loser doesn't know if a retry is safe.                                                                                                    |
| 10        | Help and Documentation          | 3           | `smallestGrantingRole(action, resource)` computes the `required_role` field on 403 — the SPA gets "you need at least Operator," not "forbidden." Three-state `outcome` enum (`audit.ts:29`) documents the audit semantics in-place.                                                                                                                        |
| **Total** |                                 | **12 / 16** | **Excellent** (lower-Excellent — address #1, #4, #9 to reach the upper band).                                                                                                                                                                                                                                                                              |

---

## What's Working

- **Pure state-machine module.** `incidents/transitions.ts` has zero DB / socket / audit dependencies. The `TRANSITIONS` table is data-driven; adding a verb is a one-row insertion (`transitions.ts:75-96`). Code-walk audit target per the spec.
- **Lazy-resolver + forwarder wrapper.** Routers mount before migrations; the first request resolves Prisma. DB-down at boot does not crash the API — a real ops requirement. Replicated across 5 routers with consistent shape (`index.ts:553-589`, `routerWiring.ts:61-110`).
- **`smallestGrantingRole` for targeted 403 copy.** The SPA gets "you need at least Operator," not "forbidden." Wired through `authorize.ts:163-170` + the 403 envelope at `authorize.ts:239`. This is the kind of error language specificity the audit celebrates.

## Priority Issues

**[P1] `index.ts` is 842 lines, breaking the project's own `max-lines: 500`**

- _Why it matters:_ The file hosts the boot path, Socket.IO wiring, Prisma resolution, dashboard namespace, 404 catch-all, alert wrappers, thresholds wrapper, incident mount, notification mount, attachment mount, and subscriber connection. Future stories will continue to balloon it. The comment at `index.ts:672` claiming `max-lines: 500` is enforced is a lie.
- _Fix:_ Extract `boot/` directory: `runMigrations.ts`, `initSocketIO.ts`, `wireRouters.ts`, `resolvers.ts`, `listReaders.ts`. Drop `index.ts` to ~100 lines (Express app + listen + boot orchestration).
- _Suggested command:_ `/impeccable distill`.

**[P1] No `Idempotency-Key` on transition POSTs**

- _Why it matters:_ Rahim taps Acknowledge on a flaky network; the client retries the POST; two `IncidentEvent` rows are written (the second is `invalid_state_transition`); her audit timeline shows her as flaky. The compare-and-set ack predicate handles double-ack, but the audit row + notification write still happen twice on a transient retry. Persona-blocking.
- _Fix:_ Idempotency-Key middleware on the 5 transition routes (`acknowledge`, `assign`, `submit-result`, `resolve`, `reopen`). Store the key in a `RequestIdempotency` table scoped to `(user_id, route, key)` with the response payload; replay the cached response on a match.
- _Suggested command:_ `/impeccable harden`.

**[P1] Three distinct 409 envelopes in `transitionHelpers.ts` (lines 498/545/558)**

- _Why it matters:_ Same HTTP status, same `error` code, three different envelope shapes. The SPA must branch on every status + envelope key. The `from`/`attempted` keys appear in 1 of 3 sites; `reason` appears in 2 of 3. P2002 idempotency collapses to 409 but the loser doesn't know if retry is safe.
- _Fix:_ Define `@surakkha/shared/error-envelope` Zod schema (one PR introduces the union + one helper `respondError(res, code, details)`; one follow-up sweep converts every site). Converge the 3 shapes to `{error: "invalid_state_transition", from?, attempted?, reason?: "concurrent_modification" | "stale_state"}`.
- _Suggested command:_ `/impeccable harden`.

**[P1] Bypassed repository-slice pattern in `index.ts:139, 189, 241, 632`**

- _Why it matters:_ 4 list-readers use `(client as any)` directly with `eslint-disable-next-line` suppressions. The narrow repository-slice pattern that catches Prisma schema drift is bypassed exactly at the file every new contributor reads first when wiring a new endpoint. Pattern is contagious.
- _Fix:_ Move `listLatestReadingsFromPrisma`, `listDevicesRosterFromPrisma`, `listRecentIncidentsFromPrisma`, `listDevicesFromPrisma` into dedicated `*Repository.ts` modules. Sweep `(client as any)` to zero (allow exactly one occurrence per file, at the lazy-resolver boundary).
- _Suggested command:_ `/impeccable distill` (in same PR as `index.ts` extraction).

**[P2] `/health` mounted before `authenticate` without `markPublic`**

- _Why it matters:_ Works only because `/health` registers at line 119 and `authenticate` at line 123. A future refactor that re-orders middleware silently turns `/health` into 401, breaking Docker healthcheck + Compose service dependency chain.
- _Fix:_ Wrap `/health` in `markPublic`; move registration AFTER `authenticate`.
- _Suggested command:_ `/impeccable harden`.

## Persona Red Flags

**Rahim (Operator on a phone in the field, named key-journey protagonist):**

- _Concurrent ack storm._ Two operators open `/api/incidents/:id/acknowledge` at the same moment. Loser gets a 409 with no `required_role`-style hint and no `Retry-After`. Phone shows generic error; she has to refresh.
- _Flaky-network double-tap._ No Idempotency-Key on the transition routes means a retry writes two `IncidentEvent` rows. Audit timeline shows her as flaky.
- _Severity filter silently downgrades._ `/api/incidents/recent` uses a hand-rolled `SEVERITY_BUCKETS` Set (`index.ts:256`) that silently coerces unknown severity strings to `"warning"`. If a future Prisma drift returns a new severity, the dashboard's "all critical" badge under-reports.

## Minor Observations

- The `RBAC_ACTION_BY_VERB` map (`router.ts:151`) currently maps each verb to itself (`acknowledge → acknowledge`) — defensible as a drift canary for when a future verb diverges, but undocumented why it exists.
- `INSPECTING.submit_result` is stored as the literal `"UNSAFE"` sentinel in the table (`transitions.ts:89`) and resolved at call time. The comment is the only thing protecting this invariant — a maintainer could miss it.
- `cachedPrismaRaw: unknown` + the `Awaited<ReturnType<typeof resolvePrismaClient>>` self-referential cast (`index.ts:553, 580-588`) is fragile. Replace with `getPrisma(): PrismaClient` exported from a new `db.ts`.
- Hand-rolled `SEVERITY_BUCKETS` Set (`index.ts:256`) duplicates `@surakkha/shared/incident.SeveritySchema`. One-line fix.
- Magic status `78` (EX_CONFIG) inline at `index.ts:834` with a `no-magic-numbers` suppression. Export a constant.

## Questions to Consider

- Should `reopen` write a separate `incident_reopened` audit row (with `reason`) in addition to the `reopen` event, so the Kanban can colour REOPENED rows without parsing the `reason` payload?
- Will the lazy-resolver pattern hold when the rule cache + incident repo + admin thresholds all race to resolve the same Prisma singleton on the first request after a cold start — or do we need an explicit `await resolvePrismaClient()` in `boot()` before binding the port?
- The `outcome: "success" | "failure" | "allow"` enum (`audit.ts:29`) reserves `success` but only `failure` and `allow` are emitted in v1. Is that intentional, or a latent contract that should be tightened now while the schema is young?
