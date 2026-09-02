# Critique — `packages/shared/src`

**Date:** 2026-09-02
**Surface:** `packages/shared/src/` (20 source modules + 5 spec files in scope)
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection.

## Summary

| File                   | LOC       | Heuristic score    | Findings                                                 |
| ---------------------- | --------- | ------------------ | -------------------------------------------------------- |
| `telemetry.ts`         | ~267      | 16/40              | 1 P1 (10+ long rationale blocks), 11 P2                  |
| `notification.ts`      | ~180      | 17/40              | 1 P1 (27-line header + sibling-schema rationale), 9 P2   |
| `events.ts`            | ~138      | 21/40              | 1 P1 ("Patch (code review 2026-08-27 #15)"), 4 P2        |
| `rbac.ts`              | ~557      | 21/40              | 0 P1, ~16 matrix-cell "Story 4.13" comments + 5 P2       |
| `audit.ts`             | ~143      | 22/40              | 0 P1, 3 P2 (preamble re-narrating notification.ts:8-27)  |
| `reading-aggregate.ts` | ~107      | 23/40              | 0 P1, 3 P2 (re-narrating audit.ts:1-35 + telemetry refs) |
| `retention.ts`         | ~105      | 24/40              | 0 P1, 3 P2 (re-narrating audit.ts:53-67 mirrors)         |
| `dashboard.ts`         | ~268      | 26/40              | 0 P1, 2 P2                                               |
| `rule.ts`              | ~209      | 24/40              | 0 P1, 3 P2                                               |
| `alerts.ts`            | ~111      | 24/40              | 0 P1, 2 P2 (cross-file ref recentRouter.ts:160)          |
| `auth.ts`              | ~156      | 27/40              | 0 P1, low yield (most JSDoc carries wire-contract pins)  |
| `attachment.ts`        | ~43       | 30/40              | 0 P1, 0 P2 — clean                                       |
| `schemas.ts`           | ~53       | 26/40              | 0 P1, 1 P2 (cross-file ref to audit P0.1 etc.)           |
| `error-envelope.ts`    | ~28       | 30/40              | 0 P1, 0 P2 — clean                                       |
| `mimeAutoDetect.ts`    | ~81       | 26/40              | 0 P1, 1 P2                                               |
| `urlValidation.ts`     | ~67       | 25/40              | 0 P1, 1 P2                                               |
| `simulator.ts`         | ~65       | 26/40              | 0 P1, 1 P2 (cross-file ref to scenarios.ts:35-44)        |
| `logger.ts`            | ~27       | 30/40              | 0 P1, 0 P2 — clean                                       |
| `index.ts`             | ~27       | 30/40              | 0 P1, 0 P2 — clean                                       |
| **Surface total**      | **~2532** | **22/40 weighted** | **4 P1, 56 P2**                                          |

The shared surface is the densest AI-slop concentration of the three surfaces I've critiqued so far. The web side had 38-58 line narrative headers; the api side had per-file preamble patterns plus inline patch markers; the shared side has ALL of those plus a new pattern: **the "sibling module preamble"** — every new Story that adds a sibling module (`audit.ts`, `reading-aggregate.ts`, `retention.ts`) opens with a 30-35 line block re-narrating why it doesn't merge into `notification.ts` or `audit.ts`. The same module-reference pair (`audit.ts:53-67`) is repeated 3 separate times across `audit.ts`, `reading-aggregate.ts`, `retention.ts`. This is the "preamble-by-template" pattern: an LLM that was asked to draft a sibling module produced a copy-paste preamble that justifies the file's existence by comparing it to existing siblings.

Two other dense patterns stand out:

1. **`telemetry.ts` has the worst JSDoc-bloat ratio**: every Zod schema (`MetricExtendedRanges`, `TelemetryMetricsSchema`, `TelemetryFrameSchema`, `TelemetryBadRequest`, `TelemetryStaleFrame`, `ReadingFlagSchema`, `classifyFlags`, `translateZodError`) and every constant (`PROCESSING_ORDER`, `STALE_FRAME_THRESHOLD_MS`, `CLOCK_SKEW_DETECT_MS`) carries a 10-20 line rationale block. The `MetricExtendedRanges` JSDoc even contains a `Renamed from `MetricSoftRanges` (2026-08-22)` fix-history marker + a `[Review][Patch] F-A8` code-review marker — the same anti-pattern as the api's `Patch (code review 2026-08-27 #N)` markers.

2. **`notification.ts` has the most cross-file references**: 27-line header cites `incident.ts:15-25`, `incident.ts:154-165`, `notificationWriter.ts`, plus 5 inline JSDoc blocks cite Prisma enums + state-machine references. The 28-line "Why a SIBLING schema" rationale block at line 93 re-narrates the entire `AdminNotificationPayloadSchema` design rationale.

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

1. **`telemetry.ts` — 10 separate inline JSDoc rationale blocks totaling ~150 lines.** Every Zod schema and every constant in this file carries a 10-20 line "why" block citing Story codes (Story 2.3 I/O matrix, Story 3.3, Story 3.5), ADR codes (ADR 0001, ADR 0013), architecture §X.Y references, and code-review markers. The `MetricExtendedRanges` JSDoc (lines 30-48) alone is 19 lines for a 6-field const + carries a `Renamed from `MetricSoftRanges` (2026-08-22)` fix-history marker (line 30) + a `[Review][Patch] F-A8` marker (line 47-48). The actual type definition is a 6-line `Record`; the rationale is 3× the code.

2. **`notification.ts:1-27` — 27-line header** (longest in the surface). Lists Story 4.10/4.9/5.1 references, 5 cross-file references (`incident.ts:15-25`, `incident.ts:154-165`, `notificationWriter.ts`, `notification.ts:8-27`, `notification.ts:1-30`), Prisma enum references (`NotificationSeverity_`, `NotificationRecipientRole_`), and the spec design notes. The actual code starts at line 27.

3. **`notification.ts:93-120` — 28-line "Why a SIBLING schema" rationale block** explaining why `AdminNotificationPayloadSchema` exists alongside `NotificationPayloadSchema`. Re-narrates the entire 5.1 story rationale inside the source — the spec at `spec-5-1-admin-notifications-read-view.md` already documents this.

4. **`events.ts:62-75` + `:86-92` + `:105-116` — Story 2.3 / Story 3.4 + "Patch (code review 2026-08-27 #15)" + "Code review 2026-08-27, decision 1" markers.** Three fix-history/code-review markers in one file. The `INCIDENT_TRANSITION_VERB_LITERALS` JSDoc (line 105-116) cites "Code review 2026-08-27, decision 1" — git is the canonical record.

### P2 — Apply before merge, won't block on its own

1. **`telemetry.ts:30-48`** — `MetricExtendedRanges` JSDoc with `Renamed from ... (2026-08-22)` + `[Review][Patch] F-A8` markers. Trim to 2-3 lines stating the contract.

2. **`telemetry.ts:75-83`** — 9-line `TelemetryMetricsSchema` JSDoc citing Story 2.3 + architecture §3.1.

3. **`telemetry.ts:91-96`** — 6-line `TelemetryFrameSchema` JSDoc citing Story 2.3 + architecture §5.1.

4. **`telemetry.ts:110-118`** — 9-line `PROCESSING_ORDER` JSDoc citing architecture §5.4 + the `frame ordering invariant`.

5. **`telemetry.ts:133-142`** — 10-line `TelemetryBadRequest` JSDoc re-narrating the i18n placeholder copy.

6. **`telemetry.ts:148-159`** — 12-line `TelemetryStaleFrame` JSDoc.

7. **`telemetry.ts:165-175`** — 11-line `ReadingFlagSchema` JSDoc re-narrating each flag.

8. **`telemetry.ts:183-190`** — 8-line `STALE_FRAME_THRESHOLD_MS` JSDoc.

9. **`telemetry.ts:193-203`** — 11-line `CLOCK_SKEW_DETECT_MS` JSDoc citing NFR-14.

10. **`telemetry.ts:205-221`** — 17-line `classifyFlags` JSDoc with a "Rules" sub-section.

11. **`telemetry.ts:233-243`** — 11-line `translateZodError` JSDoc re-narrating the de-dup logic.

12. **`notification.ts:32-50`** — 19-line `NotificationSeveritySchema` + `NotificationRecipientRoleSchema` JSDoc pair citing Prisma enums.

13. **`notification.ts:73-91`** — 19-line `NotificationPayloadSchema` + 2 sibling schemas JSDoc.

14. **`notification.ts:122-144`** — 23-line `AdminNotificationPayloadSchema` JSDoc.

15. **`notification.ts:149-179`** — 31-line `AdminNotificationFilters` JSDoc + "Loop 1 review finding H1" / "Loop 2 hardening" markers. Same anti-pattern that was stripped from `useAdminNotificationList.ts` in the notifications web loop.

16. **`events.ts:18-29`** — 12-line `ReadingNewEventSchema.flags` JSDoc citing Story 2.3.

17. **`events.ts:39-44`** — `AlertOpenedEventSchema` "Story 3.4" marker.

18. **`events.ts:62-75`** — 14-line `IncidentOpenedEventSchema` JSDoc.

19. **`rbac.ts:121-122, 137-138, 147-149, 196-197, 199-202, 208-209, 218-220, 269-271, 273-276, 282-284, 293-295, 341-342, 344-348, 352-354, 362-364`** — ~16 inline matrix-cell comments of the form `// Story 4.13 — <role> can <action> <resource>` inside the `RBAC_MATRIX` literal. The `Y` / `N` values already encode the matrix.

20. **`rbac.ts:530-554`** — 5 separate "Story X.Y — <feature> audit-action rationale" blocks in `AuditActionSchema`. The enum literal tuple already lists all 24 values; the comments restate each block's purpose.

21. **`rbac.ts` inline cross-file references** at lines 33-47 (matrix grant pin) + `rbac.ts` header (22 lines, Story 4.13 + cross-file refs).

22. **`audit.ts:1-35`** — 35-line preamble re-narrating the "Why a dedicated module" rationale that mirrors `notification.ts`'s pattern. The "Mirrors the `notification.ts:8-27` preamble pattern" comment at line 5 is even more meta — the cross-reference breaks on either file's refactor.

23. **`audit.ts:97-107`** — 11-line `AuditLogEntrySchema` JSDoc re-narrating the wire shape.

24. **`audit.ts:109-115`** — 7-line `AuditLogListEnvelopeSchema` JSDoc re-narrating the "showing 100 of 250" copy.

25. **`audit.ts:123-135`** — 13-line `AuditLogFilters` JSDoc enumerating each filter field.

26. **`reading-aggregate.ts:1-31`** — 31-line preamble re-narrating `audit.ts:1-35`'s pattern + cross-file refs to `telemetry.ts` + `audit.ts:53-67`.

27. **`reading-aggregate.ts:34-51`** — 18-line `ReadingAggregateMetricSchema` JSDoc mirroring `audit.ts:53-67`.

28. **`reading-aggregate.ts:63-85`** — 23-line `floorToFiveMinutes` JSDoc + cross-file ref to `telemetry.ts:191-232`.

29. **`retention.ts:1-30`** — 30-line preamble mirroring `reading-aggregate.ts:1-31` + cross-file refs to `audit.ts:53-67` + `reading-aggregate.ts:54-62` (the latter is a fragile line-ref).

30. **`retention.ts:33-49`** — 17-line `CronRunStatusSchema` JSDoc.

31. **`retention.ts:53-77`** — 25-line `CronTickResult` JSDoc re-narrating the success/skipped arms.

32. **`retention.ts:78-104`** — 27-line `RetentionConfigSchema` JSDoc enumerating each field with cross-file ref to `cronWiring.ts`.

33. **`dashboard.ts:84-97`** — 14-line `PLACEHOLDER_HEALTHY_RANGES` JSDoc.

34. **`dashboard.ts:109-130`** — 22-line `placeholderSeverity` JSDoc.

35. **`rule.ts:1-21`** — 21-line header.

36. **`rule.ts:23-30, 41-48, 52-58, 60-66`** — 4 inline JSDoc blocks (5-9 lines each) on the `RULE_*` enums restating the closed-set contract.

37. **`rule.ts:68-90`** — 23-line inline header for the `/admin/thresholds` admin-tab block + cross-file refs to `thresholdsRouter.ts` + `useThresholds` + `rule-table.schema.spec.ts`.

38. **`rule.ts:124-143`** — 20-line `RuleCreateRequestSchema` JSDoc.

39. **`rule.ts:145-187`** — 43-line `RulePatchRequestSchema` JSDoc re-narrating the discriminated union.

40. **`rule.ts:189-196`** — 8-line `RuleActivateRequestSchema` JSDoc.

41. **`alerts.ts:1-26`** — 26-line header with cross-file ref to `recentRouter.ts:160` + Story 3.5 + FR-15 + ADR 0007 + `Alert_open_unique_idx` partial-index name + `spec-3-5-alert-lifecycle.md:AC11`.

42. **`alerts.ts:33-47`** — 15-line `AlertSeveritySchema` + `AlertMetricSchema` JSDoc pair.

43. **`alerts.ts:49-62`** — 14-line `AlertLinkedSchema` JSDoc.

44. **`alerts.ts:64-86`** — 23-line `AlertSummarySchema` JSDoc.

45. **`alerts.ts:88-97`** — 10-line `AlertListResponseSchema` JSDoc.

46. **`alerts.ts:100-110`** — 11-line `AlertAcknowledgeResponseSchema` JSDoc.

47. **`auth.ts:1-7`** — 7-line header (already clean).

48. **`auth.ts:22-28`** — 7-line `JwtClaimsSchema` JSDoc citing Story 1.7.

49. **`auth.ts:106-113`** — 8-line `assertUuidV4` JSDoc citing regex rationale (this one is load-bearing — keep the version/variant nibble rationale, trim to 4 lines).

50. **`auth.ts:115-122`** — 8-line `simulatorClaimTemplate` JSDoc.

51. **`auth.ts:138-141`** — 4-line `deviceClaimTemplate` JSDoc.

52. **`schemas.ts:1-22`** — 22-line header citing "impeccable audit, 2026-09-01 P0.1/P0.2/P1.1" markers. The audit-loop markers should not live in source.

53. **`schemas.ts:25-29`** — 5-line `UUID_V4_REGEX` JSDoc (clean — version/variant pin is load-bearing).

54. **`mimeAutoDetect.ts:1-20`** — 20-line header citing Story 4.13 + SECURITY + cross-file ref to `attachmentRouter.ts` + spec §MIME_OVERRIDE.

55. **`mimeAutoDetect.ts:50-60`** — 11-line `detectMimeFromURL` JSDoc.

56. **`urlValidation.ts:1-25`** — 25-line header citing Story 4.13 + SECURITY + cross-file ref to web+api.

57. **`urlValidation.ts:40-51`** — 12-line `validateHttpUrl` JSDoc with examples (the examples are load-bearing — keep, but trim the comment).

58. **`simulator.ts:1-17`** — 17-line header citing Story 2.5 + cross-file refs to `packages/simulator/src/scenarios.ts:35-44` + `_bmad-output/implementation-artifacts/2-5-admin-simulator-tab.md`.

59. **`simulator.ts:20-23`** — 4-line `SCENARIO_NAMES` JSDoc (already clean).

60. **`simulator.ts:42-48`** — 7-line `SIMULATOR_FW_VERSION` JSDoc.

61. **`simulator.ts:50-64`** — 15-line `BASELINE_METRICS` JSDoc with cross-file ref to `scenarios.ts`.

### Non-findings (verified, not raised)

- `error-envelope.ts` (28 LOC) — 19-line header documents the discriminated-union contract (`{ error, from?, attempted?, reason? }`). Load-bearing for the 4 web mutation hooks + the api `transitionHelpers.ts` 409 envelope. Keep.
- `logger.ts` (27 LOC) — clean factory, no narrative bloat.
- `index.ts` (27 LOC) — barrel re-export, no narrative bloat.
- `attachment.ts` (43 LOC) — clean preload of nullable rationale.
- `BASELINE_METRICS`, `SIMULATOR_FW_VERSION`, `OFFLINE_THRESHOLD_MS` constants are correctly named — no rename needed.
- The `RBAC_MATRIX` shape (`Record<Role, Record<Action, Partial<Record<Resource, boolean>>>>`) is the canonical pin — load-bearing for `pnpm lint:rbac` in the api + `isAllowed` fail-closed invariant.
- The `INVALID_STATE_TRANSITION_ENVELOPE` discriminated union (`{ error, reason: 'concurrent_modification' }` vs `{ error, from, attempted }`) is load-bearing — both arms are returned by the api in different code paths and discriminated by the web helper.
- `AdminNotificationPayloadSchema` vs `NotificationPayloadSchema` having different shapes (the admin payload carries `acknowledgedByUserId` + `readByUserId`; the user payload doesn't) is intentional — the spec at `spec-5-1-admin-notifications-read-view.md` documents the divergence.
- `PLACEHOLDER_HEALTHY_RANGES` 6-field `Record<keyof TelemetryMetrics, { min, max }>` keyed by every telemetry metric is the canonical pre-Story-3.5 severity floor — load-bearing.
- `processingOrder: readonly ProcessingOrderStep[]` 10-step ordering is load-bearing — Story 2.3 I/O matrix.

## Plan

### 1. Trim the 4 P1 headers + inline blocks

- `telemetry.ts`: 10 rationale blocks collapse to 1-2 lines each (one per schema/constant). Drop `Renamed from `MetricSoftRanges` (2026-08-22)` + `[Review][Patch] F-A8`. Drop the "Rules" sub-section in `classifyFlags`. Drop Story codes from inline JSDoc.
- `notification.ts`: 27-line header → 6 lines. Drop 28-line "Why a SIBLING schema" rationale block at line 93. Drop 5 inline JSDoc blocks citing Prisma enums. Drop "Loop 1 review finding H1" / "Loop 2 hardening" markers.
- `events.ts`: Drop "Patch (code review 2026-08-27 #15)" marker. Drop "Code review 2026-08-27, decision 1" marker. Drop Story 2.3 / Story 3.4 markers from inline JSDoc. Keep "Per-frame flags" rationale to 3 lines.
- `rbac.ts`: Drop ~16 inline matrix-cell "Story 4.13" comments (the Y/N values already encode the matrix). Drop 5 "Story X.Y" rationale blocks in `AuditActionSchema`. Trim 22-line header → 6 lines.

### 2. Drop cross-file line-number references

All shared file references that pin specific line numbers break on every refactor. Strip:

- `notification.ts:23-27` (`incident.ts:15-25`, `incident.ts:154-165`)
- `events.ts:23` (`incident.ts`)
- `audit.ts:5` (`notification.ts:8-27`)
- `audit.ts:53-67` (3× references across `audit.ts`, `reading-aggregate.ts`, `retention.ts`)
- `reading-aggregate.ts:54-62` (referenced in `retention.ts`)
- `retention.ts:lockKey` (cross-file ref to `cronWiring.ts`)
- `rule.ts:71-83` (`thresholdsRouter.ts`, `useThresholds`, `rule-table.schema.spec.ts`)
- `alerts.ts:13-17` (`recentRouter.ts:160`, `Alert_open_unique_idx`)
- `alerts.ts:34-47` (`./rule.js`)
- `auth.ts:9-12` (`assertUuidV4`)
- `schemas.ts:7-9, 11-17, 21-22` (impeccable audit P0.1/P0.2/P1.1 ref)
- `simulator.ts:9-13` (`scenarios.ts:35-44`, `_bmad-output/.../2-5-admin-simulator-tab.md`)
- `simulator.ts:53-55` (`scenarios.ts`)
- `mimeAutoDetect.ts:11-19` (`attachmentRouter.ts`, spec §MIME_OVERRIDE)
- `urlValidation.ts:22-24` (web+api cross-package contract pin)

### 3. Drop the "sibling module preamble" pattern in 3 files

`audit.ts:1-35`, `reading-aggregate.ts:1-31`, `retention.ts:1-30` all open with the same template preamble ("Why a dedicated module (vs adding to `X` or `Y`)"). The actual cross-cutting rationale lives in the spec; trim each preamble to 4-6 lines.

### 4. Drop fix-history + code-review markers

- `telemetry.ts:30, 47-48` (`Renamed from `MetricSoftRanges` (2026-08-22)`, `[Review][Patch] F-A8`)
- `events.ts:86-92` (`Patch (code review 2026-08-27 #15)`)
- `events.ts:105-116` (`Code review 2026-08-27, decision 1`)
- `notification.ts:149-179` (`Loop 1 review finding H1`, `Loop 2 hardening`)
- `schemas.ts:8, 14, 21` (`impeccable audit, 2026-09-01 P0.1/P0.2/P1.1`)

### 5. Trim P2 inline JSDoc blocks

The 56 P2 items above are largely inline rationale restating what the Zod schema already shows. Keep:

- Wire-contract pins (`UUID_V4_REGEX` version/variant nibble justification)
- Security boundary pins (`ALLOWED_PROTOCOLS` rationale for XSS rejection)
- Load-bearing invariants (`PROCESSING_ORDER` ordering rationale, `OFFLINE_THRESHOLD_MS` derivation, `floorToFiveMinutes` UTC-floor rationale)
- Discriminator shape (`INVALID_STATE_TRANSITION_ENVELOPE` two-arm discriminator)
- The 6 examples block in `validateHttpUrl` (load-bearing for test pins)

Drop everything else (rationale that restates a 1-line schema with a 10-line JSDoc).

## Out of scope

- The `RBAC_MATRIX` shape is correct as-is.
- The `INVALID_STATE_TRANSITION_ENVELOPE` discriminator is correct as-is.
- The `AdminNotificationPayloadSchema` / `NotificationPayloadSchema` divergence is correct as-is.
- The `OFFLINE_THRESHOLD_MS = 60_000` derivation is correct as-is.
- The 7 `SCENARIO_NAMES` closed enum is correct as-is.
- The `TelemetryMetrics` 6-metric shape is correct as-is.
- The 24-value `AuditActionSchema` enum is correct as-is.
- The 4-state `IncidentState` enum (OPEN, ACKNOWLEDGED, INSPECTING, SAFE, UNSAFE, MONITORING, RESOLVED, REOPENED) is correct as-is.
- The 5-verb `ActionVerb` enum is correct as-is.

## Verification

```bash
cd packages/shared && npx tsc -b
cd packages/shared && npx eslint src/
cd packages/shared && npx vitest run
```

Existing specs: `notification.spec.ts`, `rbac.spec.ts`, `reading-aggregate.spec.ts`, `retention.spec.ts`, `shared.spec.ts`, `simulator.spec.ts`. All must stay green.
