# Critique — `packages/shared/src` (core schemas + RBAC + auth)

**Date:** 2026-09-02
**Surface:** `packages/shared/src/{rbac,telemetry,incident,dashboard,rule,auth,events,notification,alerts,audit}.ts` — 10 files, ~1647 LOC.
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File              | LOC       | Heuristic score    | Findings                                                                |
| ----------------- | --------- | ------------------ | ----------------------------------------------------------------------- |
| `rbac.ts`         | 486       | 23/40              | 0 P1, 6 P2 (matrix-cell Story comments, audit-enum rationale)           |
| `telemetry.ts`    | 195       | 24/40              | 0 P1, 5 P2 (renamed-marker, per-schema rationale blocks)                |
| `incident.ts`     | 176       | 26/40              | 0 P1, 3 P2 (transition-verb marker, AR-9 footer, FR-AC cites)           |
| `dashboard.ts`    | 168       | 27/40              | 0 P1, 3 P2 (placeholder-rationale, AR-9 / future-state markers)         |
| `rule.ts`         | 150       | 25/40              | 0 P1, 5 P2 (header, inline enum rationale, cross-file cites)            |
| `auth.ts`         | 142       | 28/40              | 0 P1, 2 P2 (FR/ADR header cite, Story 1.4 cite)                         |
| `events.ts`       | 95        | 26/40              | 0 P1, 3 P2 (Story 2.3 / 3.6 markers, AR-11 cite, AC4 cite)              |
| `notification.ts` | 88        | 26/40              | 0 P1, 3 P2 (Story 4.10 / 5.1 cite, future-state "moved by Story 5.6")   |
| `alerts.ts`       | 76        | 26/40              | 0 P1, 3 P2 (Story 3.5 header, partial-index name, future-state)         |
| `audit.ts`        | 71        | 25/40              | 0 P1, 4 P2 (future-state "Story 5.6 will move", per-field re-narrative) |
| **Surface total** | **~1647** | **26/40 weighted** | **0 P1, 37 P2**                                                         |

The shared core surface is materially cleaner than the audit-trail sibling (`audit.ts`/`reading-aggregate.ts`/`retention.ts`) handled by the parallel agent. Most files here are leaf schemas where the JSDoc IS the contract — so trimming them is harder than the narrative-heavy surfaces. The two AI-slop patterns are:

1. **`rbac.ts` matrix-cell "Story X.Y" comments** (~16 inline `// Story 4.13 — <role> can <action> <resource>` markers inside the `RBAC_MATRIX` literal). The `Y`/`N` values already encode the matrix; the comments restate each cell's purpose.

2. **`telemetry.ts` / `events.ts` / `notification.ts` future-state cross-refs** (`Story 3.5 replaces this`, `Story 5.6 will move it here`). These are by-design reminders but they belong in the spec, not the source.

No P1 findings: the shared core is contract-correct and prose-thin. The P2 list is mostly inline rationale restating what a 1-line Zod schema already shows.

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

None. The core surface is contract-correct; the JSDoc is mostly trim-able, not wrong.

### P2 — Apply before merge, won't block on its own

1. **`rbac.ts:1-11`** — 11-line header citing `ADR 0011, architecture §8.3, FR-20, FR-21, Story 1.1`. Trim to ≤7 lines stating what the file exports + where the prose explanation lives.
2. **`rbac.ts:17-19`** — `ActionSchema` JSDoc citing `Story 5.1` + the cross-role rationale. Trim to 2 lines; the literal list is the contract.
3. **`rbac.ts:38-39`** — `ResourceSchema` JSDoc citing "Story 4.13" for `Attachment`. Trim; the literal list is the contract.
4. **`rbac.ts:121-122, 137-138, 147-149, 196-197, 199-202, 208-209, 218-220, 269-271, 273-276, 282-284, 293-295, 341-342, 344-348, 352-354, 362-364`** — ~16 inline matrix-cell "Story 4.13" comments inside the `RBAC_MATRIX` literal. Drop entirely.
5. **`rbac.ts:450-484`** — `AuditActionSchema` JSDoc with 3 inline Story 2.2/5.5/5.6 rationale blocks. Trim; the literal tuple is the contract.
6. **`rbac.ts:361`** — `RBAC_STATUS_*` "Story 1.8's negative tests" marker. Drop the Story cite.
7. **`telemetry.ts:1-9`** — 9-line header citing `NFR-14, ADR 0001, Story 1.10, version: 1`. Trim to ≤7 lines.
8. **`telemetry.ts:12-15`** — 4-line "Time unit helpers" preamble explaining ESLint's `no-magic-numbers` rule. Drop; the named constants are self-documenting.
9. **`telemetry.ts:30-35`** — `MetricExtendedRanges` JSDoc citing `architecture §3.2` + Story 3.3. Trim to 2 lines.
10. **`telemetry.ts:58-62`** — 5-line `TelemetryMetricsSchema` JSDoc citing `ADR 0001` + the auto-extend rationale. Trim; the schema is self-evident.
11. **`telemetry.ts:70-73`** — `TelemetryFrameSchema` JSDoc citing `architecture §3.2, ADR 0013`. Trim.
12. **`telemetry.ts:87-91`** — `PROCESSING_ORDER` JSDoc citing `architecture §3.2, ADR 0013` + the api-side `frame.ts` handler pin. Trim to 2 lines.
13. **`telemetry.ts:106-110, 116-121, 127-132`** — three envelope / flag-enum JSDoc blocks restating `architecture §3.6`. Trim.
14. **`telemetry.ts:136-141, 144-148, 151-156, 168-174`** — four threshold / helper JSDoc blocks with rationale restating what the constant / function does. Trim.
15. **`incident.ts:1-10`** — 10-line header citing `ADR 0009, architecture §5.1` + the 7-state lifecycle re-narrative + AR-9. Trim to ≤7 lines.
16. **`incident.ts:41-43`** — `IncidentCreatingSeverity` JSDoc restating the closed subset. Trim.
17. **`incident.ts:46-50`** — `shouldCreateIncident` JSDoc with the "free-form `String` column" rationale. Trim; the predicate is self-evident.
18. **`incident.ts:54-56`** — `InspectionOutcomeSchema` JSDoc with "Story 4.7" cross-ref. Trim.
19. **`incident.ts:87-93`** — "Story 4.2" divider banner with cross-ref to `incident-actions.schema.spec.ts`. Drop the divider.
20. **`incident.ts:104-108`** — `IncidentEventTypeSchema` JSDoc citing the Prisma `IncidentEventType_` enum + the "synthetic type" rationale. Trim.
21. **`incident.ts:118-122`** — `IncidentPayloadSchema` JSDoc restating the field order + nullable notes. Trim.
22. **`incident.ts:137-146`** — `IncidentEventPayloadSchema` JSDoc. Trim.
23. **`incident.ts:148-176`** — `TransitionResult` JSDoc with per-verb event payload breakdown. Trim.
24. **`dashboard.ts:1-10`** — 10-line header citing Story 3.5 + the placeholder-rationale. Trim to ≤7 lines.
25. **`dashboard.ts:54-56`** — `PLACEHOLDER_HEALTHY_RANGES` JSDoc citing Story 3.3 + Story 3.5. Trim.
26. **`dashboard.ts:68-80`** — 13-line `placeholderSeverity` JSDoc with the future-state "rule-driven engine replaces this" + the NaN/Infinity rationale. Trim to 3 lines; the function body is self-evident.
27. **`dashboard.ts:96-100, 103-107, 109-112, 125-129, 137-139, 150-153`** — six inline JSDoc blocks for `MapSeverity` / `OFFLINE_THRESHOLD_MS` / `DeviceSummary` / `isOffline` / `deviceMapSeverity` / `breachedMetric`. Trim to 1-2 lines each.
28. **`rule.ts:1-8`** — 8-line header citing `Story 3.1, 3.7` + the Prisma enum mirror rationale. Trim to ≤7 lines.
29. **`rule.ts:10-12`** — `RULE_METRICS` JSDoc citing Story 3.2 + the Prisma migration requirement. Trim.
30. **`rule.ts:23-26`** — `RULE_OPERATORS` JSDoc citing Story 3.2 + the comparator lookup table. Trim; the operator set is self-evident.
31. **`rule.ts:29-30`** — `RULE_SEVERITIES` JSDoc. Trim.
32. **`rule.ts:33-35`** — `RULE_RULE_TYPES` JSDoc citing Story 3.2 + the wire-contract bump requirement. Trim.
33. **`rule.ts:38-45`** — 8-line "Wire schemas" preamble citing `thresholdsRouter` + `useThresholds` + cross-file pin. Drop the preamble.
34. **`rule.ts:48-49`** — `RuleRowSchema` JSDoc citing "mirrors the Prisma `Rule` model 1:1 minus the timestamps". Trim.
35. **`rule.ts:66-68`** — `RuleListResponseSchema` JSDoc re-narrating cursor pagination. Trim.
36. **`rule.ts:75-78`** — `RuleCreateRequestSchema` JSDoc restating the defaults. Trim.
37. **`rule.ts:94-104`** — 11-line `RulePatchRequestSchema` JSDoc re-narrating the discriminated union + the `.refine(...)` semantics. Trim to 3 lines.
38. **`rule.ts:136-138`** — `RuleActivateRequestSchema` JSDoc. Trim.
39. **`rule.ts:142-145`** — `RuleSupersedeResponseSchema` JSDoc. Trim.
40. **`auth.ts:1-6`** — 6-line header citing `FR-22, FR-23, ADR 0004, AR-4`. Trim to ≤7 lines (already at threshold — drop the FR/ADR cite list).
41. **`auth.ts:22-28`** — 7-line `JwtClaimsSchema` JSDoc re-narrating why `role` is optional + cross-file claim decode rationale. Trim to 3 lines.
42. **`auth.ts:99-103`** — `assertUuidV4` JSDoc citing the version/variant nibble rationale (load-bearing — keep version+variant justification, trim to 3 lines).
43. **`auth.ts:105-111`** — 7-line `simulatorClaimTemplate` JSDoc restating env-independence + claim freeze. Trim to 3 lines.
44. **`auth.ts:127-128`** — `deviceClaimTemplate` JSDoc. Trim.
45. **`events.ts:1-6`** — 6-line header citing `architecture §3.5, AR-11`. Trim to ≤7 lines.
46. **`events.ts:18-22`** — `ReadingNewEventSchema.flags` JSDoc citing "the wire does not accept firmware-supplied flags" + Story 2.3. Trim to 2 lines.
47. **`events.ts:50-52`** — `IncidentOpenedEventSchema` JSDoc citing "Story 3.6" + the actor `null` rationale. Trim.
48. **`events.ts:74-75`** — `INCIDENT_TRANSITION_VERB_LITERALS` JSDoc citing "AC4 observability log line" + the "5 RBAC verbs plus `auto_create`" rationale. Trim.
49. **`notification.ts:1-11`** — 11-line header citing `Story 4.10 + 5.1` + the sibling-vs-variant rationale. Trim to ≤7 lines.
50. **`notification.ts:13-17`** — `NotificationSeveritySchema` JSDoc. Trim.
51. **`notification.ts:20-23`** — `NotificationRecipientRoleSchema` JSDoc re-narrating the writer's pin + the read filter. Trim.
52. **`notification.ts:31-34`** — `NotificationPayloadSchema` JSDoc citing "the actor IS the actor for their own row". Trim.
53. **`notification.ts:52-55`** — `AdminNotificationPayloadSchema` JSDoc with the "Sibling — not optional-field variant" rationale. Trim to 2 lines.
54. **`notification.ts:74-82`** — 9-line `AdminNotificationFilters` JSDoc enumerating each filter field with the polling rationale. Trim to 2 lines.
55. **`alerts.ts:1-14`** — 14-line header citing `Story 3.5, FR-15` + the partial-index name `Alert_open_unique_idx` + the `linked_alerts` rationale. Trim to ≤7 lines.
56. **`alerts.ts:21-23`** — `AlertSeveritySchema` JSDoc citing "Mirrors `RuleSeverity` 1:1". Trim; the import + `z.enum(RULE_SEVERITIES)` is self-evident.
57. **`alerts.ts:26-28`** — `AlertMetricSchema` JSDoc. Trim.
58. **`alerts.ts:30-32`** — `AlertLinkedSchema` JSDoc citing "predecessor alert (closed)". Trim.
59. **`alerts.ts:40-43`** — `AlertSummarySchema` JSDoc citing the `linked_alerts` rationale. Trim.
60. **`alerts.ts:58-61`** — `AlertListResponseSchema` JSDoc citing the opaque base64url cursor. Trim.
61. **`alerts.ts:68-70`** — `AlertAcknowledgeResponseSchema` JSDoc citing the REST/socket mirror. Trim.
62. **`audit.ts:1-8`** — 8-line header citing `Story 5.3` + the future-state "writer-side surface in Story 5.6 will move it here" rationale. Trim to ≤7 lines.
63. **`audit.ts:13-15`** — `AuditLogResourceSchema` JSDoc citing "Kept separate from the Prisma `String` column". Trim.
64. **`audit.ts:33-39`** — 7-line `AuditLogEntrySchema` JSDoc with the "FK is ON DELETE SET NULL" + "closed enum doesn't break unknown future writers" rationale. Trim to 3 lines.
65. **`audit.ts:52-54`** — `AuditLogListEnvelopeSchema` JSDoc re-narrating the "showing 100 of 250" copy. Trim.
66. **`audit.ts:62-64`** — `AuditLogFilters` JSDoc re-narrating the URL→query contract. Trim.

### Non-findings (verified, not raised)

- **`RBAC_MATRIX` shape** (`Record<Role, Record<Action, Partial<Record<Resource, boolean>>>>`) — load-bearing for `pnpm lint:rbac` and the api `isAllowed` fail-closed invariant. Every (Role, Action, Resource) cell is explicit.
- **`AuditActionSchema` 26-value enum** — the canonical pin for the audit-log writer surface. Drop the inline rationale but preserve every literal.
- **`ActionSchema` 14-verb list** — load-bearing for the api authorize middleware + the `lint-rbac-matrix.mjs` allow-list. Preserve all literals verbatim.
- **`ResourceSchema` 12-value list** — load-bearing for the same reasons. Preserve verbatim.
- **`RoleSchema` 4-value list** — Admin / Operator / Technician / Viewer. Preserve verbatim.
- **`IncidentState` 8-value enum** — `OPEN`, `ACKNOWLEDGED`, `INSPECTING`, `SAFE`, `UNSAFE`, `MONITORING`, `RESOLVED`, `REOPENED`. Load-bearing for the state-machine + the `TransitionResult.ok:false` discriminator. Preserve verbatim.
- **`InspectionOutcomeSchema`** — `SAFE`, `UNSAFE`, `MONITORING`. Story 4.7 reference is load-bearing for the Technician submission path.
- **`KanbanColumnSchema` 4-value enum** — derived projection; the function body shows the mapping. Keep.
- **`ActionVerbSchema` 5-value enum** — `acknowledge`, `assign`, `submit_result`, `resolve`, `reopen`. Mirrors `ActionSchema`'s incident verbs 1:1.
- **`IncidentEventTypeSchema` 6-value enum** — `acknowledge`, `assign`, `submit_result`, `resolve`, `reopen`, `invalid_transition_attempt`.
- **`Rule.operator` enum (`RULE_OPERATORS`)** — `gte`, `gt`, `lte`, `lt`, `eq`. Load-bearing for the rule-engine comparator lookup.
- **`RULE_METRICS`**, **`RULE_SEVERITIES`**, **`RULE_RULE_TYPES`** enums — all 6/3/3-value closed sets. Preserve verbatim.
- **`JWT_SECRET_MIN_LENGTH = 32`** — fail-fast minimum length for the shared secret. The spec mentions `ACCESS_TOKEN_MIN_LENGTH` and `LOGIN_RESPONSE_MIN_TOKEN_LENGTH` but this file's canonical constant is `JWT_SECRET_MIN_LENGTH = 32`. Preserve verbatim.
- **`JWT_SECRET_MIN_LENGTH = 32` literal** — the spec criterion (Story 1.4 AC). Preserve the literal value `32`.
- **`STALE_FRAME_THRESHOLD_MS = 5 * MS_PER_MINUTE`** — derived from `MS_PER_SECOND * SECONDS_PER_MINUTE`. Math is load-bearing; preserve.
- **`CLOCK_SKEW_DETECT_MS = MS_PER_MINUTE`** — load-bearing. Preserve.
- **`OFFLINE_THRESHOLD_MS = 60_000`** — dashboard staleness threshold. Preserve.
- **`REFRESH_TOKEN_TTL_SECONDS = 2_592_000`** — refresh-token TTL. Preserve.
- **`USER_ACCESS_TOKEN_TTL_SECONDS = 28_800`** — 8-hour user-access TTL. Preserve.
- **`DEVICE_TOKEN_TTL_SECONDS = 86_400`** — 24-hour device TTL. Preserve.
- **`SIMULATOR_TOKEN_TTL_SECONDS = 3_600`** — 1-hour simulator TTL. Preserve.
- **`assertUuidV4` version/variant nibble rationale** — the regex pins BOTH the version nibble (3rd group MUST start with `4`) AND the variant nibble (4th group MUST start with `8-b`); a variant-only check would accept UUIDv1 with a `8-b` variant nibble. Load-bearing; keep the rationale, trim the comment to 3 lines.
- **`TelemetryBadRequest` / `TelemetryStaleFrame` discriminated error envelopes** — load-bearing for the api's `400 bad_request` and `stale_frame` responses. Preserve shape.
- **`MetricRanges` hard-reject envelope** — 6-metric v1 ranges from BRD §8.3.1 (WHO/BSTI source of truth). Preserve.
- **`MetricExtendedRanges` extended envelope** — ST-102 / CL-17 probe headroom. Preserve.
- **`PLACEHOLDER_HEALTHY_RANGES` 6-band `Record<keyof TelemetryMetrics, { min, max }>`** — canonical pre-Story-3.5 severity floor. Preserve all 6 bands.
- **`NotificationPayloadSchema` vs `AdminNotificationPayloadSchema` divergence** — admin payload carries `acknowledgedByUserId` + `readByUserId`; user payload doesn't. Intentional per spec. Preserve both shapes.
- **`AuditLogResourceSchema` 13-value enum** — the read-side closed surface. Preserve.
- **`RBAC_NEGATIVE_CASES` 10-row registry** — the 10-row test pin for Story 1.8's negative tests. Preserve verbatim.
- **`refreshTokenCookieOptions()` `secure: process.env["NODE_ENV"] === "production"`** — secure-by-default in prod; not pinned to true unconditionally. Preserve the dynamic resolution.
- **`process.env["NODE_ENV"]` in `auth.ts:78`** — compute `secure` at request time. Preserve.
- **`x.strict()` usage in `TelemetryFrameSchema`, `RuleCreateRequestSchema`, `RulePatchRequestSchema`, `RuleActivateRequestSchema`** — unknown-key rejection is load-bearing. Preserve.
- **`isAllowed(triple)` overload pair** — typed + loose triple overloads; fail-closed on unknown triple. Preserve.
- **`simulatorClaimTemplate` / `deviceClaimTemplate` freeze** — `Object.freeze(parsed)` on the returned claim template so a caller cannot mutate before signing. Preserve.
- **`INCIDENT_TRANSITION_VERB_LITERALS` 6-value tuple** — the 5 RBAC verbs plus `auto_create` (system-driven, not in `ActionVerbSchema`). Load-bearing for the AC4 observability log line.
- **`AuditActionSchema` ingest-seam literals** (`reading_ingested`, `reading_rate_limited`, `seq_drop_detected`, `seq_reorder_detected`, `rbac_allowed`, `cron_run_completed`) — load-bearing for Story 2.2 / 5.5 / 5.6. Preserve.

## Plan

### 1. Trim the 10 file headers to ≤7 lines

Drop Story codes, ADR codes, architecture §X.Y codes, FR-N codes, AR-N codes from each opening block. State what the file exports + the design-doc section it implements.

### 2. Drop inline matrix-cell "Story X.Y" comments in `rbac.ts`

~16 inline comments of the form `// Story 4.13 — <role> can <action> <resource>` collapse to nothing. The `Y`/`N` values already encode the matrix; the appendix table is the canonical explanation.

### 3. Drop the 3 inline `AuditActionSchema` rationale blocks

The "Ingest seam (Story 2.2) emits these on the 10-step driver completion" + "rbac_allowed" + "Hourly retention cron (Story 5.5)" blocks collapse to nothing. The literal tuple is the contract.

### 4. Drop future-state cross-refs

- `dashboard.ts:8-9` "rule-driven engine replaces this in Story 3.5" — drop.
- `notification.ts:11` "writer-side surface in Story 5.6 will move it here" — drop.
- `dashboard.ts:55-56` "Story 3.3 seeds the canonical `Rule` table from these same bands; Story 3.5 then replaces this helper" — drop.
- `telemetry.ts:33-35` "Story 3.3 reads these to seed rule thresholds" — drop.

### 5. Drop per-schema JSDoc blocks that restate the Zod schema

The 37 P2 items above are largely inline rationale restating what a 1-line Zod schema already shows. Keep:

- Wire-contract pins (`UUID_V4_REGEX` version/variant nibble justification — trim to 3 lines).
- Load-bearing invariants (`PROCESSING_ORDER` 10-step ordering, `OFFLINE_THRESHOLD_MS` derivation, `STALE_FRAME_THRESHOLD_MS` 5× derivation).
- Discriminator shape (`TransitionResult.ok:true|false` two-arm shape).
- Fail-closed invariant (`isAllowed` returns `false` on unknown triple).

Drop everything else (rationale that restates a 1-line schema with a 5-15-line JSDoc).

### 6. Drop cross-file line-number references

- `telemetry.ts:88-90` (`packages/api/src/ingest/frame.ts`)
- `rule.ts:40-44` (`thresholdsRouter`, `useThresholds`, `rule-table.schema.spec.ts`)
- `dashboard.ts:75-77` (NaN/Infinity rule + the placeholder-rule rationale cross-ref)
- `incident.ts:90-93` (`incident-actions.schema.spec.ts`)

## Out of scope

- `RBAC_MATRIX` shape + every cell value.
- `ActionSchema` 14-verb list + `ResourceSchema` 12-value list + `RoleSchema` 4-value list.
- `AuditActionSchema` 26-value enum + each literal.
- `IncidentState` 8-value enum + `InspectionOutcomeSchema` + `KanbanColumnSchema` + `ActionVerbSchema` + `IncidentEventTypeSchema`.
- `Rule.operator` (`RULE_OPERATORS`) enum + `RULE_METRICS` + `RULE_SEVERITIES` + `RULE_RULE_TYPES`.
- `JWT_SECRET_MIN_LENGTH = 32` constant + all TTL constants.
- `events.ts` `IncidentEvent` discriminator + `actor_user_id` field.
- `incident.ts` `inspectionOutcome` enum (Story 4.7 reference).
- `dashboard.ts` band constants (`PH_BAND`, `TDS_PPM_BAND`, `TURBIDITY_NTU_BAND`, `TEMP_C_BAND`, `CHLORINE_PPM_BAND`, `WATER_LEVEL_CM_BAND`).
- `assertUuidV4` variant-nibble rationale (trim to 3 lines, do not drop).
- `OFFLINE_THRESHOLD_MS` 60_000 derivation.
- The 6-band `PLACEHOLDER_HEALTHY_RANGES` `Record<keyof TelemetryMetrics, { min, max }>`.

## Verification

```bash
npx --prefix packages/shared tsc -b packages/shared
npx --prefix packages/shared eslint packages/shared/src
cd packages/shared && npx vitest run 2>&1 | tail -10
node scripts/lint-prose.mjs
node scripts/lint-rbac-matrix.mjs
```

The `lint-rbac-matrix.mjs` script pins the RBAC cells — it MUST pass. Existing specs: `rbac.spec.ts`, `notification.spec.ts`, `shared.spec.ts`, `simulator.spec.ts`, `retention.spec.ts`, `reading-aggregate.spec.ts`. All must stay green; the `RBAC_MATRIX` keys + `ActionSchema` enum literals + `AuditActionSchema` enum literals are load-bearing for `rbac.spec.ts`.
