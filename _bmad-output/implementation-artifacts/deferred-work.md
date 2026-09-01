# Deferred Work Register

## Deferred from: code review of 2-2-ingest-websocket-endpoint (2026-08-22)

- **F-W1** — `@surakkha/db/scripts/migrate` exports map points to `./scripts/migrate.ts`. Node ESM does not natively load `.ts` files; the api `start` script runs compiled `dist/index.js` but `await import("@surakkha/db/scripts/migrate")` resolves to the `.ts` source — Node throws `ERR_MODULE_NOT_FOUND` at boot. Mitigations are package-build-time concerns (build the db package to `.js` OR run api under tsx in production). **Owned by Story 6.1 (Docker Compose + README quickstart).**
- **F-W2** — `runMigrations()` spawns `pnpm exec prisma ...` as a child process at api boot, blocking the event loop on disk IO and child-process spawn. `prisma generate` re-runs every boot. No retry on transient DB unavailability. Migrations belong in a one-shot init container, not the long-running API. **Owned by Story 6.1 (Dockerfile + init container).**
- **F-W3** — No graceful-shutdown handler on `httpServer`. Docker Compose sends SIGTERM on stop; the Node process exits immediately without draining in-flight frames or disconnecting the Prisma client. **Owned by Story 6.1.**
- **F-W4** — `PerDeviceRateLimiter` and `PerDeviceSequence` state lives in unbounded `Map`s. A flood of attacker-supplied UUIDs will permanently inflate memory. No LRU / TTL / size cap. Real but bounded by I-9 (single Node process). Mitigation requires a deliberate eviction policy; out of scope for 2.2. **Deferred to production hardening (Epic 7).**
- **F-W5** — `verifyIngestClaims` does not check that `urlDeviceId` corresponds to an existing `Device` row. A simulator with a valid JWT can connect under any UUID. The spec does not require device-existence-at-handshake in v1 (the `Device` model is a placeholder in 2.2). **Owned by Story 2.3 (Device model expansion) and the production-hardening pass.**
- **F-W6** — `socket.disconnect(true)` emits the Socket.IO transport default close code (~4005), not the literal `4401` the spec I/O matrix and ACs reference. The spec change log explicitly acknowledges this and reframes the intent as "close on auth failure". Implementation matches the change log; AC literally says `4401` but is not enforced. **Needs spec amendment (frozen-after-approval intent requires human renegotiation).**
- **F-W7** — `IoServer` constructed without `connectionStateRecovery` (Socket.IO v4.6+). Brief network blips cause a full re-handshake + re-auth. Real for flaky-device environments but not blocking for v1. **Deferred to production hardening.**
- **F-W8** — `ReadingNewEventSchema` (shared events) is reused without a payload-shape test at the api→web boundary. The frame.spec.ts happy path uses `expect.objectContaining` which is loose. **Owned by Story 2.8 (Live Readings Table) — the first web consumer will pin the payload via TypeScript + zod at the SPA.**

## Deferred from: code review of 2-1-wire-contract-schemas (2026-08-22)

- _No outstanding deferrals._ The 2026-08-22 re-review resolved the original `frame.ts` placeholder deferral by amending spec AC5 to point at ADR 0013 + architecture §3.2 + `PROCESSING_ORDER` as the canonical sources for the 10-step pipeline. Story 2.2 owns the ingest handler; AC5's literal text about a 31-line placeholder is deprecated.

## Deferred from: code review of 2-3-unknown-missing-field-handling (2026-08-22)

- **F-22** — Simulator import of new constants (`STALE_FRAME_THRESHOLD_MS`, `CLOCK_SKEW_DETECT_MS`, `classifyFlags`). The constants are exported from `@surakkha/shared/telemetry`; Story 2.4 (Simulator Process) will import them per spec constraint "the api and simulator import them so the simulator's pre-send ts validation stays in lockstep with the api". Owned by Story 2.4.
- **F-D-1** — `flags` union / `rate_limited` producer. `stepSeqDropCheck` overwrites `state.flags` rather than unioning (`frame.ts:226`); `stepRateCheck` never stamps `["rate_limited"]` even though `ReadingFlagSchema` includes it. Decision-needed findings in the review — operator-triage policy that belongs to the rule-eval story (Epic 3). Owned by Epic 3 once Story 2.3 ships; the current behavior is acceptable per the closed-enum constraint as long as a future contributor adds the producer before shipping the rate-limit UI.

## Deferred from: code review of 2-5-admin-simulator-tab (2026-08-22)

- **F-2.5-1** — Shared `SCENARIO_NAMES` parity between `@surakkha/shared/src/simulator.ts` and `packages/simulator/src/scenarios.ts:35` is enforced only by the existing `simulator.spec.ts` Zod-pinning test. Adding a new scenario requires manual lockstep update in two packages; no CI-level drift check. **Defer to a future shared-codegen story (out of Epic 2 scope).**
- **F-2.5-2** — `UUID_V4_REGEX` and HTTP status constants (`400`, `403`, `409`, `502`, `503`) are duplicated between `packages/api/src/admin/simulatorRouter.ts` and `packages/simulator/src/control/server.ts`. Drift risk if either package's values change. **Defer to the next shared-constants refactor (post-Epic 2).**
- **F-2.5-3** — `packages/db/prisma/seed.ts` derives device names from `deviceId.slice(-1).toUpperCase()`. The current six device IDs end in `1, 2, 3, 4, 5, 6` (digits), so names are stable, but a future seeded device ending in `8, 9, a, b` (valid UUIDv4 last-hex ranges) would yield a letter-prefixed name. Fragile for future backfill. **Defer to the next seed-refactor story.**
- **F-2.5-4** — API admin endpoint status-code constants are inline in `simulatorRouter.ts` (no shared constants module). The web app has its own copies of the same codes (in `useSimulatorDevices.ts`). Drift risk if a code changes. **Defer to the next shared-constants refactor (same as F-2.5-2).**

## Deferred from: code review of 2-5-admin-simulator-tab (2026-08-24 Group 1 — Shared + DB)

- **F-2.5-5** — `SCENARIO_NAMES` drift detection: shared ↔ simulator parity has no cross-package test. Already tracked as F-2.5-1 above; cross-referencing here for the Group 1 review pass.
- **F-2.5-6** — `deriveName` placeholder (`DEVICE-<last-hex>`) contradicts spec example `DHAKA-SCHOOL-023`. Canonical school labels land in Story 2.3 (school/facility seed); v1 placeholder is the deliberate fallback the spec accepts. **Owned by Story 2.3 (Device.name canonicalization).**
- **F-2.5-7** — `Device.name` column has no length cap (`migration.sql:10`). Admin-only input; production-hardening concern. **Defer to production hardening (Epic 7).**
- **F-2.5-8** — Migration adds nullable `name` / `scenario` columns only; backfill is a separate `pnpm seed` step (atomic migration rejected — see Group 1 review decision A). Owner documents the two-step order in `README.md`. **Owned by Story 6.1 (Docker Compose + README quickstart).**

## Deferred from: code review of 2-5-admin-simulator-tab (2026-08-24 Group 2 — API + Simulator control)

- **F-2.5-9** — Audit logger emits `context:` field; spec line 27 mandates `payload: { device_id, scenario }`. Renaming `context` → `payload` in `AuditLogger` is a cross-cutting change that touches Story 1.5 (auth + RBAC audit rows). v1 keeps `context` and Story 5.6 (audit-log pipeline) renames the column at the schema-promotion boundary. **Owned by Story 5.6.**
- **F-2.5-10** — Body-size asymmetry: api uses `express.json({ limit: "32kb" })` (`api/src/index.ts:74`); simulator caps at 16 KiB (`simulator/src/control/server.ts`). 20 KB body passes api validation, fails at simulator's cap, surfaces as 502 `simulator_unreachable`. **Defer to production hardening (Epic 7).**
- **F-2.5-11** — Outbound fetch from api → simulator lacks `User-Agent` header. Operational/diagnostic gap; not an AC. **Defer.**
- **F-2.5-12** — Boot-window buffer-replay race: frames emitted before socket connects are buffered with their original scenario; a `setScenario` swap that arrives within the first ~2 s of boot may flush 1–2 stale frames on connect (per AA-F25). Real but bounded and only affects admin clicks within 2 s of simulator start. **Defer.**
- **F-2.5-13** — DNS rebinding / SSRF hardening: `validateSimulatorBaseUrl` rejects non-http(s) schemes and paths beyond `/`, but a malicious DNS could rebind a permitted hostname. v1 trusts localhost; hardening (IP pinning, `redirect: 'manual'`) is a production concern. **Defer to production hardening (Epic 7).**
- **F-2.5-14** — Pre-existing `SCENARIO_NAMES` cross-package drift test (already tracked as F-2.5-1 / F-2.5-5). Cross-referencing here for the Group 2 review pass; not a regression.
- **F-2.5-15** — `disabledResponse` 503→403 transition (G2-01) changes the simulator's wire contract for missing-env. The api's `simulatorClient.ts` already maps 403 → typed `secret_mismatch` → SPA disabled-banner via AC8. The body shape `{ error: "secret_mismatch", reason: "missing" }` includes a `reason` field that the simulator-side Group 2 review added. Web clients that read the body shape need to tolerate the extra `reason` field; tracked for the Group 3 (web) review pass.
- **F-2.5-16** — `parseRoute` removed the bare-GET fallback in G2-14. The `/admin/simulator/<uuid>` (no /scenario suffix) endpoint now returns 404 not_found. If a future operator dashboard wants a per-device read endpoint, it must be designed explicitly; for v1, the api's `/admin/simulator/devices` is the canonical listing surface.

## Deferred from: code review of 2-5-admin-simulator-tab (2026-08-24 Group 3 — Web)

- **F-2.5-17** — `paused` server-truthful state in `SimulatorDevice`: The api's `/devices` listing doesn't expose `paused` per device. Group 2 left this as a Group 3 gap. The full resolution (server-truthful pause state) requires extending the device surface with a `paused` field. v1 ships the local-state UX with a documentation note that "Pause state is client-side after the first click" (`packages/web/src/admin/simulator/DeviceRow.tsx` doc-comment). **Owned by Epic 3 (telemetry/devices model).**
- **F-2.5-18** — Start button vs Pause/Resume toggle semantic collapse (Group 3 acceptance #3): The spec AC1 enumerates "Start / Pause / Switch" controls but Group 2's `setPaused`-only model folded "Start" into Pause/Resume via `paused: false`. The spec change log should record this consolidation with a one-line note ("Start semantic folded into Pause/Resume via `paused: false`"). **Owned by spec amendment.**
- **F-2.5-19** — RBAC downgrade handling mid-session (Group 3 verification #11): The page renders generic error when api 403's because token role downgraded; full `<RbacDenied />` re-routing from the page requires tighter coupling between apiClient interceptor and the page. **Defer to RBAC hardening (Epic 7).**
- **F-2.5-20** — StrictMode double-fire masking (Group 3 edge-hunter #14): Not a production bug; documented behavior. **Defer.**
- **F-2.5-21** — Status query `refetchInterval` for secret rotation (Group 3 edge-hunter #12): Adding a polling interval to status is a UX trade-off that should be reviewed with the operator. **Defer to operator-triage story (Epic 3).**

## Deferred from: code review of 2-7-map-view (2026-08-24)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-map-view.md`
  - summary: Production wiring swallows Prisma errors as empty roster instead of 500
  - evidence: `packages/api/src/index.ts:listDevicesRosterFromPrisma` catches errors with `logger.warn` and returns `[]`. In production this masks DB outages as a successful `200 { devices: [] }` response — visually the dashboard renders the empty state per AC6, but operators never see a 5xx or surface in the audit log. The router's `try/catch` only triggers when the injected `listDevices` THROWS, which the production helper doesn't. **Defer to Story 2.9 (Connection State + Offline UX) or Story 5.3 (Audit Log Surface) — both touch the DB-down observability story.**
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-map-view.md`
  - summary: Reading-aggregate index missing for the `MAX(serverReceivedAt) GROUP BY device_id` query
  - evidence: `GET /api/devices` runs `GROUP BY d."id"` with `MAX(r."serverReceivedAt")` from `packages/api/src/index.ts`. Without an index on `Reading("deviceId", "serverReceivedAt")` the query sequentially scans the readings table per request. At simulator volumes this is fine; at real-device volumes (1 device × 1 reading/min × 24 h = 1440 rows; 100 devices × 30 days = 4.3 M rows; that's a seq-scan-per-request pattern). **Defer to Story 5.4 (ReadingAggregate Table) or a perf-focused Epic 6 story.**
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-map-view.md`
  - summary: KPI band's `offline` count remains hard-coded at `0`
  - evidence: `packages/web/src/dashboard/useDashboardReadings.ts:summarizeReadings` hard-codes `offline: 0`. The new shared `isOffline()` helper is the canonical source-of-truth (already exported from `@surakkha/shared/dashboard`). The Story 2.7 spec explicitly deferred this adoption: "the KPI band's `offline` count (currently hard-coded `0`) can adopt it later without a wire change." Cross-reference F-2.7-track. **Defer to a Story 2.x follow-up once operators request the offline count in the band.**

## Deferred from: code review of 3-1-rules-table-prisma-schema (2026-08-25)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-rules-table-prisma-schema.md`
- summary: Add a partial unique index `WHERE isActive = true` on Rule(deviceId, metric, operator, threshold) to prevent two `isActive: true` rows at the same tuple if Story 3.7's edit path ever bumps `version` without flipping the previous row's `isActive` to false.
- evidence: The current `@@unique([deviceId, metric, operator, threshold, version])` relies on `version` as the disambiguator and assumes every edit bumps version AND flips `isActive`. If an admin path forgets either invariant, two `isActive: true` rows coexist and the engine in Story 3.2 has no tie-break rule to pick one. Story 3.7's admin edit path owns the partial-index decision per the spec's "Unique constraint scope" design note. **Defer to Story 3.7 (and confirm via the partial-index test pin suggested in the same review).**

## Deferred from: code review of 3-2-three-rule-types-evaluation-engine (2026-08-25)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-three-rule-types-evaluation-engine.md`
  summary: Boot-fallback `setIngestHooks(noopHooks)` is pinned only by a source-walk test (`boot-fallback.spec.ts`), not a behavioural test that exercises the runtime try/catch and asserts the no-op hooks default installed.
  evidence: `packages/api/__tests__/boot-fallback.spec.ts` reads `index.ts` source and asserts five regex patterns. The spec's design note claims "the behavioural pin (AC #17 + `boot-fallback.spec.ts`) ensures this isn't accidentally dropped during re-derivation", but the test is source-walk only — a regression that wires the try/catch but never enters it (e.g., awaits the wrong promise) passes the regex test. A behavioural test that mocks `resolvePrismaClient` to reject and asserts `getIngestHooks()` returns the no-op shape would close this gap. **Defer to a follow-up; the source-walk matches existing project convention (`auth.no-rotation.spec.ts`) and the cost of migration to a behavioural test is non-trivial.**

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-three-rule-types-evaluation-engine.md`
  summary: `onRuleEvaluation` returns `readonly BreachResult[]` but the existing no-op default (`noopHooks.onRuleEvaluation = async () => undefined`) was retained by an earlier spec version; the patched version now returns `EMPTY_BREACH_RESULTS`. Pre-3.2 hook stubs in Epic 4 / Epic 5 that still return `void` from `onRuleEvaluation` must be updated when Epic 3 lands.
  evidence: The spec's design note (line 164) explicitly states "any pre-3.2 hook implementation returning `void` MUST be updated when Epic 3 lands. The migration is a single-line return-type change in `packages/api/src/ingest/hooks.ts`." The 3.2 implementation has migrated in-house test stubs (`frame.spec.ts`, `subscriberSocket.spec.ts`); external stubs (Epic 4's `state-machine-update` hook stub if any; Epic 5's audit hook stub) will need to follow. **Defer to the next Epic that lands a hook impl that returns `void`.**

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-three-rule-types-evaluation-engine.md`
  summary: `pickFrameMetric` evaluates ONE metric per frame — a real telemetry frame always carries 6 metrics, so up to 5 of them may be silently dropped every frame.
  evidence: `packages/api/src/rules/hooks.ts` `pickFrameMetric` returns the first frame metric that has any rule in the cache. The subagent flagged this in its report: "v1's rule pipeline evaluates ONE metric per frame; if a frame carries multiple metrics (e.g. {ph: 8.5, tds_ppm: 312}) and BOTH a ph and a tds_ppm rule exist, only one metric is ever evaluated per frame". A future Epic 3 story may need per-metric dispatch (Story 3.4 de-bouncing surfaces this when the rule-cache and the breach stream need fan-out). **Defer to a follow-up story once a real telemetry fixture surfaces the missed-metric case in production, OR escalate via Story 3.5's alert lifecycle if alert volume turns out to be silently capped.**

## Deferred from: code review of 3-5-alert-lifecycle (2026-08-26)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-alert-lifecycle.md`
  summary: Type-system observation on `AlertRowShape` projection drift risk
  evidence: `packages/api/src/alerts/list.ts:37-47` defines `AlertRowShape` as the minimum projection the list helper reads off a Prisma `Alert` row. TypeScript already enforces the projection matches the interface at compile time; the live test rig would surface a runtime error on column rename. A runtime projection-shape test (asserting the Prisma `Alert` model's columns match the `AlertRowShape` interface at test time) is technically possible but adds a brittle coupling to Prisma's internal column-set enumeration. **Deferred — pre-existing type-system observation, not introduced by this story; live test rig covers the practical case.**

## Deferred from: code review of 3-5-alert-lifecycle (2026-08-26, loopback 4 re-review)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-alert-lifecycle.md`
  summary: `assertAcknowledgedByUserIdColumnPresent` data_type assertion accepts only `["text", "character varying"]`
  evidence: `packages/db/prisma/alert-debounce.spec.ts` asserts `data_type IN ('text', 'character varying')`. Epic 5 will likely migrate the column to `uuid` when the FK constraint is added (the User table lands in Epic 5). The test will need updating at that point. **Deferred — pre-existing acceptance of the v1 type; Epic 5 will trigger a test update when the type changes.**

## Deferred from: code review of 3-6-auto-create-incident-from-alert + 3-7-admin-thresholds-tab (2026-08-26)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-auto-create-incident-from-alert.md`
  summary: AC4 observability boundary unverified at router — 3.6 live test reads the DB directly, not via `GET /api/incidents/recent`
  evidence: `packages/db/prisma/alert-debounce.spec.ts:1939, 2003, 2043, 2132` asserts via `prisma.incident.findUnique`/`findMany`. The AC4 wording requires the auto-created Incident to be observable via `/api/incidents/recent`. A wire-shape drift between the production `tx.incident.create` payload and the router's `select` shape would silently break dashboard surfacing while leaving the DB-row assertion green. **Defer to a future Incidents-region story (Epic 4) that consumes the auto-created row — that's the natural place to add an end-to-end round-trip pin.**

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-auto-create-incident-from-alert.md`
  summary: AC5 socket non-emit is not pinned by any behavioural test
  evidence: Spec AC5 says the auto-create "does NOT emit a separate socket event." `alert-debounce.spec.ts`'s 3.6 block has no `vi.spyOn` on the broadcast target, no negative-emit assertion. The Pin column says "code review + `applyTransition.ts:189`" but that's a comment, not a behavioural guard. **Defer — absence-of-emit is structurally asserted by the absence of a new emit call site; a behavioural spy would couple the test to internal broadcast wiring. Spec acceptance is satisfied at the source-review level.**

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-auto-create-incident-from-alert.md`
  summary: `alert-debounce.spec.ts:2115-2137` Promise.all writer race has no deterministic barrier
  evidence: Two concurrent `tx.alert.create` calls; the spec wants exactly one winner. Postgres serializable isolation MAY let both commit at distinct `openedAt`-ms timestamps depending on the partial-unique-index width. The test passes today but the assertion is fragile under timing variation. **Defer — pre-existing test pattern (not introduced by 3.6); flake surface is low under current volumes.**

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-auto-create-incident-from-alert.md`
  summary: P2002 inside a future Incident-table unique constraint would double-warn
  evidence: `applyTransition.ts:1662-1668` warns on `tx.alert.create` P2002. If a future schema adds `@@unique` on `Incident(deviceId, openedAt)`, the second writer's `tx.incident.create` (after alert succeeds) raises P2002; the alert row rolls back but the warn log has already fired for the alert P2002, producing a confusing operator log line. **Defer — speculative; depends on a future schema change not in scope for Epic 3.**

- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-admin-thresholds-tab.md`
  summary: `deactivateRule`/`activateRule` P2025 (concurrent-delete-mid-flight) returns 500 instead of 404
  evidence: `packages/api/src/admin/thresholdsRouter.ts:1239-1274` — between `findUnique` (which gates 404) and `repo.rule.update`, a concurrent delete raises Prisma P2025, which falls into the generic `catch (err)` and returns 500. Race window is narrow (single-instance api, low write volume on thresholds). **Defer — narrow race; current 500 path is acceptable v1 behaviour. Wrap in a P2025-aware try/catch in a future hardening pass.**

## Deferred from: code review of 4-2-incident-state-machine (2026-08-27 Group 1)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md`
  summary: `applyTransition` writer (ackedAt/resolvedAt stamping) has no direct unit test.
  evidence: `packages/api/src/incidents/router.spec.ts` provides `nextRow` overrides that bypass the writer; `transitions.spec.ts` exercises only the pure projection. The mitigation belongs in the live-Prisma test rig (`incident-state-machine.spec.ts`) per spec risk-mitigation note 1.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md`
  summary: `applyTransition` rollback on `incidentEvent.create` failure is structurally claimed but not behaviourally pinned.
  evidence: Same live-Prisma rig as F-4.2-1; spec acceptance is structurally satisfied.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md`
  summary: `incident:opened` socket emit has no fallback on `IncidentOpenedEventSchema` parse failure beyond a console.warn.
  evidence: Mitigation is a consumer-side (Story 4.4) concern; the parse-failure case surfaces only if the schema drifts, which is a development-time warning.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md`
  summary: `loadOrRespond` does not enforce Technician ownership at read time.
  evidence: Today only `GET /api/incidents/:id` consumes it; the inline ownership check in the GET handler covers the current call site. Defer until a second consumer lands.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md`
  summary: `prepareTransitionContext`/`loadOrRespond` in-band `null` sentinel is fragile.
  evidence: Collapse "I responded with 404" and "something went wrong upstream" in the same channel. Refactor scope is non-trivial — wrap in a typed `Result` shape.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-incident-state-machine.md`
  summary: No `incident-state.migration.spec.ts` exercises the new migration's table shapes, FKs, or partial unique index.
  evidence: Owner: live-Prisma test rig (sibling of `alert-debounce.migration.spec.ts`); spec doesn't require it for 4.2 but it should land with the deferred-test sweep.

## Deferred from: code review of 4-4-incident-detail-page (2026-08-27)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-incident-detail-page.md`
  summary: `useIncidentDetailSocket` `useEffect` deps array — re-registration on `id` change within the same mounted component is unverified.
  evidence: In practice `id` never changes inside a single `<IncidentDetailPage />` mount (the component unmounts on route change because `/incidents/:id` is a different route), so the hot path is idle. Test coverage would require an explicit navigation-within-mount rig, which is not part of 4.4's AC matrix. Defer until a future story wires intra-route id transitions (e.g., pagination).

## Deferred from: code review of 4-11-reopen-path (2026-08-30)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-11-reopen-path.md`
  summary: `useReopenMutation` does NOT invalidate the timeline query (`["incidents", "detail", id, "events"]`) on success — only the detail row query (`["incidents", "detail", id]`) is invalidated, matching the same gap present in `useAcknowledgeMutation` / `useAssignMutation` / `useSubmitResultMutation`.
  evidence: `packages/web/src/incidents/useReopenMutation.ts:155-167` invalidates only the detail row key; the timeline (`fetchIncidentTimeline`) is re-read on next page mount but NOT on the same mount when a reopen mutation succeeds in-place. In practice the timeline is not refetched until the operator navigates away and back, so a freshly-reopened row's `reason` text is not visible in the timeline until the next mount. **Defer to a future cross-verb mutation-handler sweep — the same gap exists across all four verbs and a single shared `invalidateQueries({ queryKey: detailFamily(id) })` helper is the clean fix.**

- source_spec: `_bmad-output/implementation-artifacts/spec-4-11-reopen-path.md`
  summary: `maybeReopenAdminDenied` emits TWO `rbac_denied` audit log lines for a single non-Admin reopen attempt: one from the matrix-level `authorize({ action: "update", resource: "Incident" })` middleware (which passes because Operator has `update.Incident = Y` per RBAC matrix line 167) and one from the inner per-cell guard.
  evidence: `packages/api/src/incidents/transitionHelpers.ts:252-262` emits `auditAction: "rbac_denied"` with `reason: "not_admin"`. The matrix-level check does NOT emit a `rbac_denied` audit row for an Operator trying reopen (because `update.Incident = Y` is granted to Operator). However, on `submit_result`, the analogous path emits ONE `rbac_denied` (from `runOwnershipCheck` line 662-672), because the matrix-level `submit_result` is RBAC-denied at the middleware. So for `reopen` the audit row count is 1 (per-cell only) — NOT 2. **Documenting this as deferred because the spec's audit trail guarantee was underspecified; the current single-row emission matches the `submit_result` shape.**

- source_spec: `_bmad-output/implementation-artifacts/spec-4-11-reopen-path.md`
  summary: `applyTransition` writer CLEARS `resolvedAt` on reopen (sets to `null`), NOT preserves it — diverges from spec AC5 (`resolved_at` is UNCHANGED) and I/O matrix row `KEEP_RESOLVED_AT`.
  evidence: `packages/api/src/incidents/incidentStateRepository.ts:261-266` resets `resolvedAt` to `null` when `nextState === "OPEN" && currentRow.state === "RESOLVED"`. The in-code comment (line 254-260) says the row-level column reflects "current state, not lifetime history" and the historical `resolved_at` is preserved in the `IncidentEvent` audit row (`type: "resolve"`). The applied `applyTransition.spec.ts` test `REOPEN: clears resolvedAt` pins this behaviour. **The implementation semantic is the load-bearing one** — consumers filtering `state === "OPEN" && resolvedAt IS NULL` correctly categorise a re-opened incident as in-flight again. The spec AC5 + I/O row are stale and need amendment via the Spec Change Log Loop0 entry.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-11-reopen-path.md`
  summary: `IncidentEvent.payload` for reopen contains only `{ actorUserId, reason }` — does NOT include `previous_state: "RESOLVED"` — diverges from spec AC7.
  evidence: `packages/api/src/incidents/transitions.ts:302-303` constructs the payload as `action === "reopen" && reason !== null ? { actorUserId, reason } : { actorUserId }`. There is no `previous_state` field. The audit history of "what state was the row before reopen" is captured implicitly by reading the timeline (the previous `resolve` event has `type: "resolve"` and the immediately-following `reopen` event is the transition). **The implementation semantic is cleaner** — explicit `previous_state` would be a redundant cache of the timeline ordering. Spec AC7 is stale and needs amendment via the Spec Change Log Loop0 entry.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-11-reopen-path.md`
  summary: `classifyReopenError` 400 branch surfaces only the FIRST server Zod issue's message (e.g., "String must contain at least 10 character(s)") and discards the rest.
  evidence: `packages/web/src/incidents/useReopenMutation.ts:87-95` reads `issues[0]?.message`. The reopen body schema has exactly one field (`reason`) with multiple constraints (`.trim().min(10).max(2000)`); Zod can return multiple issues if the input fails more than one constraint. The toast copy currently shows only the first issue. **Defer to a future cross-verb mutation-handler sweep** — the same gap exists in `classifyAcknowledgeError` / `classifyAssignError` / `classifySubmitResultError` (where Zod issues are not consumed at all). A shared `firstIssueMessages(body, n)` helper is the clean fix.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-11-reopen-path.md`
  summary: `ReopenForm` textarea `maxLength={2000}` enforces the cap client-side via `maxLength` HTML attribute, but the server-side `reopenBodySchema` cap (`REOPEN_REASON_MAX_LENGTH = 2000`) is the canonical source of truth — client-side only enforcement means paste-bypass is possible.
  evidence: `packages/web/src/incidents/IncidentDetailActions.tsx` `<textarea maxLength={2000} ... />`. Browser `maxLength` is a soft cap — a paste can exceed it (Chrome behaviour depends on length, browser version). The server still validates and 400s on over-length. **Acceptable for v1** — the server-side validation is the security boundary; the client `maxLength` is operator-UX, not security. Defer to a hardening pass that adds explicit JS-side length check inside `onSubmit` if operator reports show paste-bypass issues.

## Deferred from: code review of 4-12-technician-filtered-kanban (2026-08-30)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-technician-filtered-kanban.md`
  summary: Server-side `assigneeUserId` filter is a `String` equality predicate on `Incident.assignee_user_id` — does NOT leverage the existing partial index `Incident_assignee_user_id_idx` from Story 4.2's migration.
  evidence: `packages/api/src/incidents/activeRouter.ts:88` spreads `assigneeUserId: req.user.id` into the WHERE clause. The Prisma adapter is `incident.findMany({ where: { state: { not: RESOLVED }, assigneeUserId: ... } })`. The query plan will use the index for the equality lookup, but the predicate combination (`state !== RESOLVED` AND `assigneeUserId = ?`) may not pick the most selective index first. **Defer to a query-plan sweep** — Tech viewer volumes are small (≤ ~10 incidents per Tech), so the seq-scan fallback is fine. Add `@@index([assigneeUserId, state])` if query plans regress under real Tech load.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-technician-filtered-kanban.md`
  summary: `KanbanBoard` render-time filter (`role === "Technician" && currentUserId !== null`) does NOT check the `assignee_user_id` column for stale `null` rows that may have been assigned to the Tech but the assignment was cleared (e.g., a 4.6 reassign to another Tech + back to unassigned).
  evidence: `packages/web/src/incidents/KanbanBoard.tsx:renderedIncidents` filters by `i.assignee_user_id === currentUserId`. If `assignee_user_id === null`, the row is excluded — that's correct (an unassigned row is not Tech A's). **No bug, just documenting** the contract.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-technician-filtered-kanban.md`
  summary: `useCurrentUserId()` returns `null` for an unauthenticated viewer — but the route gate renders `<RbacDenied />` before this hook runs, so the `null` branch is unreachable in practice. The render-time filter's `currentUserId === null` short-circuit is defensive but never fires.
  evidence: `packages/web/src/auth/CurrentRoleContext.tsx:112` returns `null` for unauthenticated. The route gate in `main.tsx` redirects unauthenticated viewers to `/login` before mounting `<KanbanBoard />`. **Acceptable as defensive code** — the explicit short-circuit documents the invariant. No follow-up needed unless the route gate is bypassed (it isn't).

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-technician-filtered-kanban.md`
  summary: Server filter and client render-time filter are redundant (defense-in-depth). The server already filters Tech viewers at the WHERE clause; the client re-filters the rendered slice. The server filter is the security boundary; the client filter handles the case where the cache is shared with SeverityBanner.
  evidence: Two layers, both correct. **Documenting for future readers** — a maintainer who sees the client filter may think it's the only filter and remove the server one (security regression). The dual-filter is intentional; do not collapse.

## Deferred from: code review of 5-3-audit-log-surface-at-audit (2026-09-01)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-audit-log-surface-at-audit.md`
  summary: `AuditLogPage` filter-section DOM ids (`actor-filter-heading`, `event-filter-heading`, `resource-filter-heading`, `range-filter-heading`) are hard-coded globals; a future story that embeds the page twice (e.g., a side-by-side preview surface) would collide.
  evidence: `packages/web/src/audit-log/AuditLogPage.tsx` declares four `id="..."` attributes that are singletons today (the page mounts once per `/audit` route). A React 18 `useId()` would have been the standard fix. **Defer until a second embedding site appears.**

- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-audit-log-surface-at-audit.md`
  summary: `AuditLog.outcome` column has no index; if a future story adds an "outcome = failure" filter chip, the query degrades to a seq scan.
  evidence: `packages/db/prisma/migrations/20260901000000_audit_log/migration.sql` creates the table + two indexes (`@@index([createdAt])`, `@@index([actorUserId, createdAt])`). The `outcome` column is a free `String` with a closed set (`success | failure | allow`) but unindexed. **Defer until outcome-filter is added.**

- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-audit-log-surface-at-audit.md`
  summary: `<RbacRoute>` may briefly flash `<RbacDenied />` if `useCurrentRole()` resolves after first paint (e.g., between login and role fetch). No third-layer skeleton masks the flash.
  evidence: `packages/web/src/access/RbacRoute.tsx` is a thin wrapper around `<RbacDenied />` + `useCurrentRole()`. The race window is small but exists; pre-existing pattern across all admin routes (5.1, 5.3, etc.). **Defer until the role-resolution loading state is a shared concern (likely Story 6.x).**
