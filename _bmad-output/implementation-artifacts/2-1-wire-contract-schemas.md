---
title: 'Story 2.1 — Wire Contract Schemas'
type: 'feature'
created: '2026-08-21'
status: 'done'
review_loop_iteration: 0
baseline_commit: 364449c2e90ff9524a83a8f8cb72cd562c7759db
context:
  - docs/architecture.md#3.2-telemetry-frame
  - docs/architecture.md#3.4-device-authentication
  - docs/adr/0001-wire-contract-first.md
  - docs/adr/0013-server-processing-order.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The api, simulator, and web packages each need to agree on the exact shape of a telemetry frame and a device/simulator JWT claim. Without a single shared source of truth, a contract bump becomes a multi-package edit that drifts. Three load-bearing decisions (ADR 0001, ADR 0013, I-13 HS256) must be enforced by code, not just prose.

**Approach:** Codify the v1 telemetry frame and JWT claim as Zod schemas in `packages/shared/src/telemetry.ts` and `packages/shared/src/auth.ts`. Add a `translateZodError` helper and claim-template factory functions. Document the 10-step processing order in a placeholder `packages/api/src/ingest/frame.ts` whose comment block is consumed by Story 2.2.

## Boundaries & Constraints

**Always:**
- `version: z.literal(1)` is hard-coded; unknown versions rejected with `400 invalid_version` (ADR 0001).
- All six v1 metrics are required: `ph`, `tds_ppm`, `turbidity_ntu`, `temp_c`, `chlorine_ppm`, `water_level_cm`. Missing metric → reject.
- BRD §8.3.1 v1 hard-reject ranges: `ph 0–14`, `tds_ppm 0–5000`, `turbidity_ntu 0–1000`, `temp_c -10–80`, `chlorine_ppm 0–5`, `water_level_cm 0–500`.
- JWT claims require `iss: "surakkha-api"`, `aud: enum(["device", "simulator"])`, `scope`, `sub: uuid`. HS256 single-secret (I-13); no JWKS.
- The processing order documented in `packages/api/src/ingest/frame.ts` is the AC's 10-step order: validate → auth check → rate check → seq/drop check → persist → rule evaluation → alert emission → state-machine update → audit append → socket broadcast.
- All schema edits land in `packages/shared`; api and simulator import from `@surakkha/shared` (ADR 0007).
- Test coverage ≥70% backend / ≥50% frontend (NFR-12); `packages/shared` contributes to both targets.

**Ask First:**
- None — this story is foundational and all decisions are pinned in the ACs and ADRs.

**Never:**
- No `.passthrough()` on the frame schema — keep it strict until Story 2.3 explicitly relaxes it. ADR 0001 says unknown metric *keys* are forward-compat (ignored), but that's a Story 2.3 decision.
- No JWT rotation, no JWKS, no `JWT_PUBLIC_KEY` env var (I-13, Story 1.10 invariant).
- No metric values stored in the shared package — keep it pure schema.
- No bidirectional WS commands (architecture §3.6).
- Do not create `scripts/lint-wire-contract.mjs` in this story — deferred to a follow-up (Epic 1 retro lesson L2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| VALID_FRAME | `{version:1, device_id:"9b1c…", ts:1700000000, fw:"1.0.3", seq:8421, metrics:{ph:7.2, tds_ppm:180, turbidity_ntu:0.4, temp_c:27.4, chlorine_ppm:0.6, water_level_cm:85}}` | `TelemetryFrameSchema.safeParse` returns `{success:true, data:TelemetryFrame}` | n/a |
| MISSING_METRIC | valid frame minus `ph` | `safeParse` returns `{success:false, error:ZodError}` with `ph` in `error.issues[].path` | `translateZodError` → `{error:"bad_request", missing_fields:["ph"]}` |
| OUT_OF_RANGE | `{…metrics:{ph:15, …}}` | `safeParse` fails | `translateZodError` returns `missing_fields:["ph"]` |
| WRONG_VERSION | `{version:2, …}` | `safeParse` fails on `version` literal | `translateZodError` → `missing_fields:["version"]` |
| NA_NUMBER | `{…metrics:{ph:NaN}}` | `safeParse` fails on `.finite()` | `translateZodError` → `missing_fields:["ph"]` |
| VALID_SIMULATOR_CLAIM | factory `simulatorClaimTemplate(uuid)` | returns object that re-parses through `JwtClaimsSchema.parse()` with `aud:"simulator"`, `scope:"telemetry:write"`, `exp-iat===3600` | n/a |
| INVALID_AUD | factory output with `aud:"admin"` | `JwtClaimsSchema.parse` fails | caller surfaces auth error |

</frozen-after-approval>

## Code Map

- `packages/shared/src/telemetry.ts` -- existing: `MetricRanges`, `MetricKeySchema`, `TelemetryMetricsSchema`, `TelemetryFrameSchema`. **Edit** to add `MetricSoftRanges` (architecture §3.2 extended range), `translateZodError`, `PROCESSING_ORDER`.
- `packages/shared/src/auth.ts` -- existing: `JwtClaimsSchema`, `JwtAudienceSchema`. **Edit** to add `simulatorClaimTemplate`, `deviceClaimTemplate` factories.
- `packages/shared/src/index.ts` -- existing barrel re-exporting `telemetry`, `auth`, `events`, `incident`, `rbac`, `logger`. **Edit** to re-export new symbols.
- `packages/shared/src/__tests__/telemetry.spec.ts` -- **new**: round-trip happy path + 5 edge cases from I/O Matrix rows 2–6.
- `packages/shared/src/__tests__/auth.schema.spec.ts` -- **new**: claim-field presence, `aud` enum rejection, factory-output re-parses cleanly.
- `packages/api/src/ingest/frame.ts` -- **new placeholder**: top-of-file comment block quoting the 10-step order from AC4; imports `PROCESSING_ORDER` from `@surakkha/shared`. No implementation — Story 2.2 owns the handler.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/telemetry.ts` -- add `MetricSoftRanges` constant (architecture §3.2 extended ranges: turbidity 0–3000, chlorine 0–10), `translateZodError(error)` returning `{error:"bad_request", missing_fields:string[]}`, `PROCESSING_ORDER` string-tuple (10 entries, AC4 order) -- reason: AC1 (ranges), AC3 (translation), AC4 (order documented in shared so Story 2.2 picks it up).
- [ ] `packages/shared/src/auth.ts` -- add `simulatorClaimTemplate(sub:UUIDv4):JwtClaims` and `deviceClaimTemplate(sub:UUIDv4):JwtClaims` factories, with `iat=Math.floor(Date.now()/1000)`, `exp-iat=3600` (simulator) or `86400` (device) -- reason: AC2.
- [ ] `packages/shared/src/index.ts` -- re-export `MetricSoftRanges`, `translateZodError`, `PROCESSING_ORDER`, `simulatorClaimTemplate`, `deviceClaimTemplate` -- reason: ADR 0007 cross-cutting rule.
- [ ] `packages/shared/src/__tests__/telemetry.spec.ts` -- create; 6 tests covering the I/O Matrix happy path + 5 error cases; parameterize error cases over a `ZOD_ERROR_CASES` table -- reason: AC1 + AC3.
- [ ] `packages/shared/src/__tests__/auth.schema.spec.ts` -- create; 4 tests: required-field presence, `aud` rejects `["admin",""]`, simulator factory output re-parses through `JwtClaimsSchema.parse`, device factory output re-parses -- reason: AC2.
- [ ] `packages/api/src/ingest/frame.ts` -- create placeholder file (one comment block + one import line, no logic); comment quotes AC4's 10-step order verbatim and references ADR 0013 -- reason: AC4.

**Acceptance Criteria:**
- Given the v1 frame in the I/O Matrix, when `TelemetryFrameSchema.safeParse(frame)` is called, then `result.success === true` and `result.data` matches the input shape.
- Given a frame missing `ph`, when `translateZodError(error)` runs, then the returned `missing_fields` array contains `"ph"` and `error === "bad_request"`.
- Given `simulatorClaimTemplate(uuid)`, when the result is fed to `JwtClaimsSchema.parse`, then it parses cleanly and `result.data.aud === "simulator"`, `result.data.scope === "telemetry:write"`, `result.data.exp - result.data.iat === 3600`.
- Given `deviceClaimTemplate(uuid)`, when the result is fed to `JwtClaimsSchema.parse`, then it parses cleanly and `result.data.exp - result.data.iat === 86400`.
- Given the comment block at the top of `packages/api/src/ingest/frame.ts`, when a developer reads it, then they see the AC4 order verbatim and a reference to ADR 0013.
- Given `MetricSoftRanges`, when the file is read, then `turbidity_ntu.max === 3000` and `chlorine_ppm.max === 10`.

## Spec Change Log

(empty until first bad_spec loopback in step-04)

## Suggested Review Order

**Telemetry wire contract (the load-bearing schema)**

- Entry point: the v1 frame schema with `version: z.literal(1)` and `.strict()` — pins ADR 0001.
  [`telemetry.ts:67`](../../packages/shared/src/telemetry.ts#L67)
- `MetricSoftRanges` constant — explicit sensor envelope distinct from the hard reject band.
  [`telemetry.ts:29`](../../packages/shared/src/telemetry.ts#L29)
- `METRIC_RANGES` (BRD §8.3.1 hard-reject) — same shape, narrower envelope; locked by Story 1.10.
  [`telemetry.ts:13`](../../packages/shared/src/telemetry.ts#L13)
- `translateZodError` — collapses Zod issues into the canonical `bad_request` envelope.
  [`telemetry.ts:114`](../../packages/shared/src/telemetry.ts#L114)
- `PROCESSING_ORDER` tuple — single source of truth for the 10-step pipeline (ADR 0013).
  [`telemetry.ts:88`](../../packages/shared/src/telemetry.ts#L88)

**JWT claim templates (env-independent, re-parseable)**

- `simulatorClaimTemplate` / `deviceClaimTemplate` factories — return `JwtClaims`, not signed JWTs.
  [`auth.ts:114`](../../packages/shared/src/auth.ts#L114)
- TTLs + `assertUuidV4` — fail-fast on bad `sub` at the call site, not at verify time.
  [`auth.ts:102`](../../packages/shared/src/auth.ts#L102)

**Ingest seam placeholder (the 10-step contract)**

- Comment block in `packages/api/src/ingest/frame.ts` — the AC4 contract visible before Story 2.2 lands.
  [`frame.ts:1`](../../packages/api/src/ingest/frame.ts#L1)
- `PROCESSING_ORDER` import anchors the comment block to the shared constant.
  [`frame.ts:26`](../../packages/api/src/ingest/frame.ts#L26)

**Tests (data-driven register + factory round-trips)**

- `ZOD_ERROR_CASES` table — one `it` per row, regression surfaces as a single named failure.
  [`telemetry.spec.ts:58`](../../packages/shared/src/__tests__/telemetry.spec.ts#L58)
- Auth factory round-trips + non-UUIDv4 rejection (Epic 1 retro L1 data-driven pattern).
  [`auth.schema.spec.ts:65`](../../packages/shared/src/__tests__/auth.schema.spec.ts#L65)

## Design Notes

**Why two range constants.** `MetricRanges` (BRD §8.3.1) carries the v1 hard-reject thresholds — frames outside the range fail validation. `MetricSoftRanges` (architecture §3.2) carries the extended observation range — frames inside the soft range but outside the hard range are observationally unusual but not invalid. v1 only hard-rejects (Story 2.3 owns the soft-vs-hard policy); the soft constants exist so Story 3.3 (Default Thresholds Seed Script) can reference them.

**Why factories return `JwtClaims` not signed JWTs.** Signing requires `JWT_SECRET`, which lives in `process.env`. The shared package must not depend on env (it's consumed by the simulator which mints its own token, and by the api which verifies). The factory returns a claim *template*; signing happens at the call site with the right secret.

**Why a placeholder `frame.ts`.** AC4 says "When a developer inspects the comment block at the top of `packages/api/src/ingest/frame.ts`". The file does not exist yet — Story 2.2 owns the actual ingest handler. Pre-creating the placeholder with the comment block (and the `PROCESSING_ORDER` import it references) gives Story 2.2 a one-line copy-and-extend starting point. The placeholder compiles; it just exports nothing.

## Verification

**Commands:**
- `pnpm --filter @surakkha/shared typecheck` -- expected: 0 errors.
- `pnpm --filter @surakkha/shared test` -- expected: all 10 new tests pass (6 telemetry + 4 auth.schema), no regressions.
- `pnpm --filter @surakkha/api typecheck` -- expected: 0 errors (the placeholder `frame.ts` must compile).
- `pnpm --filter @surakkha/api lint` -- expected: 0 errors, max-warnings 0.
- `pnpm typecheck` (root) -- expected: 4/4 packages green.
- `pnpm lint` (root) -- expected: 5/5 packages green.

**Manual checks (if no CLI):**
- Open `packages/api/src/ingest/frame.ts` — the comment block must list the 10 AC4 steps in order and reference ADR 0013.
- Open `packages/shared/src/telemetry.ts` — `MetricSoftRanges.turbidity_ntu.max` must read `3000`; `MetricSoftRanges.chlorine_ppm.max` must read `10`.