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
| MISSING_METRIC | valid frame minus `ph` | `safeParse` returns `{success:false, error:ZodError}` with `ph` in `error.issues[].path` | `translateZodError` → `{error:"bad_request", missing_fields:["metrics.ph"]}` |
| OUT_OF_RANGE | `{…metrics:{ph:15, …}}` | `safeParse` fails | `translateZodError` returns `missing_fields:["metrics.ph"]` |
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
- Given a frame missing `ph`, when `translateZodError(error)` runs, then the returned `missing_fields` array contains `"metrics.ph"` and `error === "bad_request"`.
- Given `simulatorClaimTemplate(uuid)`, when the result is fed to `JwtClaimsSchema.parse`, then it parses cleanly and `result.data.aud === "simulator"`, `result.data.scope === "telemetry:write"`, `result.data.exp - result.data.iat === 3600`.
- Given `deviceClaimTemplate(uuid)`, when the result is fed to `JwtClaimsSchema.parse`, then it parses cleanly and `result.data.exp - result.data.iat === 86400`.
- Given the canonical sources for the 10-step processing order — `packages/shared/src/telemetry.ts`'s `PROCESSING_ORDER` constant, ADR 0013 (`docs/adr/0013-server-processing-order.md`), and architecture §3.2 — when a developer reads them, the three enumerate the same 10-step pipeline in the same order, with `validate` first and `socket broadcast` last. **Replaces prior AC5** (which referenced a 31-line placeholder in `frame.ts`); the placeholder was overwritten by Story 2.2, and the canonical order is now codified in the three sources above. The test `frame.spec.ts:115-130` asserts `PROCESSING_ORDER.length === 10` and the exact order.
- Given `MetricSoftRanges`, when the file is read, then `turbidity_ntu.max === 3000` and `chlorine_ppm.max === 10`.

## Spec Change Log

- **2026-08-22 — F1 loopback (9 → 10 step processing order).** ADR 0013 was amended to enumerate the 10-step pipeline (validate, auth check, rate check, seq/drop check, persist, rule evaluation, alert emission, state-machine update, audit append, socket broadcast) to align with the spec and code. Architecture §3.2 §"Server processing order" was updated identically. Per-step rationale was rewritten for all 10 steps. Response codes are now `400`, `401`, `429`; `403 device_id_mismatch` was intentionally dropped because the path/device_id match is now folded into step 1 (validate). Amendment block at the top of ADR 0013 explains the change.
- **2026-08-22 — F2 loopback (AC2 dotted-path representation).** AC2 and the I/O Matrix `MISSING_METRIC` / `OUT_OF_RANGE` rows now use `missing_fields:["metrics.ph"]` instead of `["ph"]`. The implementation (`translateZodError`) and the test were already correct; this is a spec-text amendment to match. Firmware keys on `metrics.ph`.
- **2026-08-22 — UUIDv4 fail-fast contract (not previously pinned by any spec AC).** The `assertUuidV4` helper in `packages/shared/src/auth.ts` throws on a non-UUIDv4 `sub`. This fail-fast is not in any spec AC; the test `auth.schema.spec.ts:114-127` documents it as implementation-pinned. The fail-fast regex pins BOTH version nibble (`4`) AND variant nibble (`[89ab]`).

## Review Findings (2026-08-22 — re-review of patch series)

### Failed Layers

- **blind-hunter** and **edge-case-hunter** could not run: their review-prompt files live at `C:\Users\BS707\.agents\skills\bmad-code-review\review-prompts\` which is outside the working directory scope (`C:\ZDrive Folders\Projects\Surakkha`). The subagents refused to read the prompts per the "If the instruction file is unreadable, report that exact failure and stop" rule. Verification-gap and acceptance-auditor ran with an inline instruction (no prompt file) and succeeded. **The patch-series review may be incomplete in the adversarial and edge-case dimensions.**

### Decision Needed (1)

- [ ] [Review][Decision] AC5 placeholder contract is unsatisfiable — `packages/api/src/ingest/frame.ts` is now Story 2.2's 380-line implementation, not the 31-line Story 2.1 placeholder. Spec AC5 still requires "the comment block at the top of `frame.ts` lists AC4 order verbatim and references ADR 0013." The current file's JSDoc is a narrative, not a verbatim 10-step list. Cannot be patched without deciding whether to (a) amend AC5 to point at ADR 0013 + architecture §3.2 + `PROCESSING_ORDER` as the canonical sources, or (b) prepend a verbatim 10-step list at the top of the (already-overwritten) `frame.ts`.

### Patch (12 — all applied 2026-08-22 re-review)

- [x] [Review][Decision] AC5 placeholder contract is unsatisfiable — **Resolved: amend AC5** to point at ADR 0013 + architecture §3.2 + `PROCESSING_ORDER` as canonical sources.
- [x] [Review][Patch] Architecture §3.2 field contract table `device_id mismatch → 403` [`docs/architecture.md:91`] — updated to fold into step 1's `400 bad_request` with `missing_fields:["device_id"]`.
- [x] [Review][Patch] Architecture §3.2 metric range row "Unknown metric keys are ignored" [`docs/architecture.md:96`] — updated to disambiguate top-level (`.strict()` rejects) vs nested metric keys (forward-compat drop).
- [x] [Review][Patch] ADR 0013 §"Consequences → Negative" 9-step-era terminology [`docs/adr/0013-server-processing-order.md`] — paragraph rewritten to enumerate step owners explicitly (1, 5, 10 → ingest handler; 2 → JWT verifier; 3 → rate-limit; 4 → seq tracker; 6–9 → typed no-op hooks).
- [x] [Review][Patch] Architecture §3.2 metric type contract conflation [`docs/architecture.md`] — split into "Hard reject (v1)" and "Soft (extended observation)" tables; `MetricExtendedRanges` is the canonical name.
- [x] [Review][Patch] `unrecognized_keys` test only covers single unknown key [`telemetry.spec.ts`] — added a 2-key boundary test; revealed a bug in the prior `[basePath, ...keys].join(".")` (it joined them into one path). `translateZodError` was fixed to emit each unknown key as a separate `missing_fields` entry. Single-key test strengthened to `toEqual(["unknown_top_level"])`.
- [x] [Review][Patch] `MetricSoftRanges` dead-fields confusion [`telemetry.ts`] — renamed to `MetricExtendedRanges`; JSDoc explains the four coincident fields and tracks architecture terminology.
- [x] [Review][Patch] `MetricKeySchema` enum unused by `TelemetryMetricsSchema` [`telemetry.ts`] — `TelemetryMetricsSchema` is now derived from `MetricKeySchema.options` via `Object.fromEntries`. Adding an entry to the enum auto-extends the schema.
- [x] [Review][Patch] Wall-clock `iat > 1_700_000_000` fixed threshold [`auth.schema.spec.ts:80-90, 103-111`] — replaced with `expect(claim.iat).toBeCloseTo(Math.floor(Date.now()/1000), -1)` (within ±10s).
- [x] [Review][Patch] `translateZodError` path|code dedup unobservable [`telemetry.spec.ts`] — added a synthetic `ZodError` test that emits two issues on `["metrics","ph"]` with codes `invalid_type` and `too_small`; asserts both surface in `missing_fields`.
- [x] [Review][Patch] `unrecognized_keys` test `toContain` partial pin [`telemetry.spec.ts`] — `toEqual(["unknown_top_level"])` + `translated.error === "bad_request"`.
- [x] [Review][Patch] `PROCESSING_ORDER` literal not pinned in Story 2.1 tests [`telemetry.spec.ts`] — added "PROCESSING_ORDER matches the canonical 10-step literal character-for-character" test.

### Dismissed (3)

- `Readonly<JwtClaims>` + `Object.freeze` does not propagate to verify path — correct separation of concerns; the verify side is Story 2.2's contract.
- Happy-path `toEqual(VALID_FRAME)` with constant `ts` — `toEqual` is deep-equality; a regression to `Date` would fail because number ≠ Date. Test is sound.
- Spec test count promise "10 new tests pass" — cosmetic doc drift; not a code issue.

### Decision Items Resolved in Patch Series (2)

- [x] [Review][Decision] 9-step (ADR 0013 / architecture §3.2) vs 10-step (spec/code) processing-order divergence — **Resolved: amend ADR 0013 + architecture §3.2 to align with the 10-step code.** Updated `docs/adr/0013-server-processing-order.md` §"Decision" and §"Reversal" sections to enumerate the 10 steps: validate, auth check, rate check, seq/drop check, persist, rule evaluation, alert emission, state-machine update, audit append, socket broadcast. Updated architecture.md §3.2 identically.
- [x] [Review][Decision] AC2 prose vs test divergence on dotted path — **Resolved: update spec AC2 + I/O Matrix to use `missing_fields:["metrics.ph"]`.** Implementation/test are canonical; firmware contract keys on `metrics.ph`.

### Patch (12 — all applied 2026-08-22)

- [x] [Review][Patch] Amend ADR 0013 to enumerate the 10-step pipeline [`docs/adr/0013-server-processing-order.md`] — updated; amendment block + 10-step table + per-step rationale added. ← from decision F1.
- [x] [Review][Patch] Amend architecture.md §3.2 to enumerate the 10-step pipeline [`docs/architecture.md` §3.2] — updated; 10-step list replaces 9-step list with reference to ADR 0013 amendment. ← from decision F1.
- [x] [Review][Patch] Update spec AC2 + I/O Matrix `MISSING_METRIC` / `OUT_OF_RANGE` rows to use `missing_fields:["metrics.ph"]` [`_bmad-output/implementation-artifacts/2-1-wire-contract-schemas.md` lines 49, 50, 79] — updated. ← from decision F2.
- [x] [Review][Patch] `translateZodError` overloads `missing_fields` to mean any invalid field [`telemetry.ts:114-141`] — kept `missing_fields` for firmware compat; JSDoc now documents the misleading name and notes v2 may split into `missing_fields` + `invalid_fields`.
- [x] [Review][Patch] `translateZodError` de-dup is path-based; same path with multiple Zod issue codes silently drops the rest [`telemetry.ts:114-141`] — fixed: dedup key is now `path|code`, so two issues on the same path with different codes are both surfaced. Also handles `unrecognized_keys` to append the offending key name to the dotted path.
- [x] [Review][Patch] `assertUuidV4` regex variant nibble `[89ab]` accepts real UUIDv1 with variant `8-b` [`auth.ts:108-114`] — clarified comment: the regex pins BOTH version nibble (`4`) AND variant nibble (`[89ab]`); UUIDv1 with valid variant still has version `1` and is rejected. Added a second test case for variant-nibble failure (`9b1c4d2e-1234-4abc-0def-...`).
- [x] [Review][Patch] Boundary tests missing for `MetricRanges` [`telemetry.spec.ts:115-167`] — added 18 boundary tests (3 per metric × 6 metrics: min-1 rejected, min accepted, max+1 rejected).
- [x] [Review][Patch] `.strict()` schema rejects unknown top-level keys, contradicting ADR 0001 ignore-not-reject for unknown metric keys [`telemetry.ts:65-79`] — added two new tests: (1) unknown top-level key is rejected with `.strict()` and the offending key name surfaces in `missing_fields`; (2) unknown metric keys inside `metrics` are ignored per ADR 0001 forward-compat. Updated JSDoc to clarify the dual behavior.
- [x] [Review][Patch] Happy-path test does not assert `result.data` field-for-field [`telemetry.spec.ts:90-98`] — replaced spot-field assertions with `expect(result.data).toEqual(VALID_FRAME)`.
- [x] [Review][Patch] `assertUuidV4` is not pinned by any spec AC [`auth.schema.spec.ts:90-101`] — added a spec change-log entry noting the 5th describe block is implementation-pinned; AC note in test comment.
- [x] [Review][Patch] Non-deterministic `Date.now()` in factory functions — no clock injection [`auth.ts:131-138,151-158`] — added `expect(claim.iat).toBeGreaterThan(1_700_000_000)` to both factory tests so a regression returning `iat = 0` is caught.
- [x] [Review][Patch] `simulatorClaimTemplate` / `deviceClaimTemplate` return mutable `JwtClaims` [`auth.ts:131-138,151-158`] — return type is now `Readonly<JwtClaims>` and the returned object is `Object.freeze`d. Tests pin `Object.isFrozen(claim) === true`.
- [x] [Review][Patch] `MetricSoftRanges` is structurally hollow for 4 of 6 metrics [`telemetry.spec.ts:178-194`] — added a full-set `toEqual` assertion that pins all 6 metrics in `MetricSoftRanges`, so a drift in any of the four silent fields surfaces as a single named failure.

### Deferred (1)

- [x] [Review][Defer] `frame.ts` was supposed to be a 31-line placeholder [`packages/api/src/ingest/frame.ts`] — deferred, pre-existing — Spec Execution Task item 6 says "one comment block + one import line, no logic." Story 2.1's diff created the placeholder; Story 2.2 (commit `c81e7e6`) replaced it with a 380-line implementation. Out of scope for this review; the spec should be renegotiated to reflect reality.

### Dismissed (4)

- `as unknown as 1` cast on `version:2` test input — schema's `z.literal(1)` still rejects at runtime; cast is a test ergonomics pattern.
- ADR0007 barrel re-export integrity — `index.ts:8-9` uses `export * from` correctly; verified all 5 new symbols are reachable.
- Stale JSDoc comment on `TelemetryFrameSchema` "Unknown fields are stripped" — folded into the `.strict()` patch finding above.
- `(root)` fallback in `translateZodError` is dead code — folded into the de-dup patch finding; `path.join(".") || "(root)"` is reachable when Zod issues have empty path arrays (e.g. parsing `null`).

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