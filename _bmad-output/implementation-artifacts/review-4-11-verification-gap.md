# Story 4.11 — Reopen Path — review distillation

**Source:** Spec Change Log Loop 0 of `_bmad-output/implementation-artifacts/spec-4-11-reopen-path.md:182-225`.

**Step-04 reviewers:** parallel (blind-hunter + edge-case-hunter + verification-gap).
**Severity:** 0 HIGH bugs; **5 patches applied** (3 test/seam, 2 web-form); **2 spec amendments**.
**Outcome:** All 5 patches + 2 spec amendments landed in commit `ea37f43`. Re-verification: 114/114 api tests + 435/435 web tests + clean typecheck + clean lint.

---

## Patches applied

| #   | Type     | Surface                                                             | Pin                                                                                                                                                                                                                                                          |
| --- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1  | test     | `packages/api/src/incidents/applyTransition.spec.ts` (NEW, 8 tests) | `REOPEN: forces severity: "critical"` (warning→critical + idempotent critical→critical + clears `resolvedAt`). `ACK/ASSIGN/SUBMIT_RESULT/RESOLVE: does NOT touch severity` (4 tests). `'critical' is a valid IncidentSeverity` (schema belt-and-suspenders). |
| #2  | refactor | `packages/web/src/incidents/useReopenMutation.ts`                   | `classifyReopenError` is now `async`, takes `Response`, reads body for 400 → extracts `issues[0].message`. Operator sees the specific Zod violation ("String must contain at least 10 character(s)") instead of generic "Reason invalid".                    |
| #3  | refactor | `useReopenMutation.ts`                                              | `firstIssueMessage(body): string \| null` helper. Network-error fallback uses `new Response(null, { status: 0 })` so the same classifier produces the toast copy.                                                                                            |
| #4  | surface  | `ReopenForm` in `IncidentDetailActions.tsx`                         | Added `REOPEN_REASON_MAX_LENGTH = 2000` constant (mirrors server). Textarea gets `required`, `aria-required="true"`, `maxLength={REOPEN_REASON_MAX_LENGTH}`. Label copy updated to "Reason (required, between 10 and 2000 characters)".                      |
| #5  | surface  | `ReopenForm`                                                        | Form mirrors server bounds at the client surface so operators see the cap before submitting.                                                                                                                                                                 |

## Spec amendments (intent-gap corrections)

| #   | Amends                                   | Reason                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #S1 | `KEEP_RESOLVED_AT` I/O row + AC5         | The writer CLEARS `resolved_at` on reopen (sets to `null`); the row-level column reflects current state (OPEN + not yet resolved), not lifetime history. Historical `resolved_at` is preserved in the prior `resolve` `IncidentEvent` audit row's payload. The pre-review spec text ("preserved for audit") was wrong — the implementation semantic is load-bearing. |
| #S2 | `IncidentEvent.payload` for reopen (AC7) | Implementation constructs `{ actor_user_id, reason }` (NO `previous_state`). The "previous state" history is captured implicitly by reading the timeline ordering (the prior `resolve` event + immediately-following `reopen` event). Explicit `previous_state` would be a redundant cache of the timeline; implicit form is the design-intent match.                |

## KEEP (verified load-bearing, no change)

- **Reopen-forces-critical writer** — the conditional spread `...(reopenForcesCritical ? { severity: "critical" as const } : {})` in `incidentStateRepository.ts:298` is the type-safe seam that allows ACK/ASSIGN/SUBMIT_RESULT/RESOLVE to omit `severity` from `data` without violating Prisma's required-scalar-field rule.
- **Admin-only RBAC gate via `maybeReopenAdminDenied` helper** — matrix-level `update.Incident = Y` is granted to Operator; the inner per-cell guard is the seam (mirrors `submit_result`'s ownership-check pattern).
- **Reason ≥ 10 chars body validation** — Zod `.trim().min(10).max(2000)`; `extractReopenReason` strips whitespace before forwarding to `transition()`.
- **`useReopenMutation` 400 branch now surfaces Zod issues** (Patches #2 + #3).
- **ReopenForm client-side bounds mirror server bounds** (Patches #4 + #5).

## KEEP for next reviewer (load-bearing seams)

1. The **forced-critical spread** in `applyTransition` must preserve the conditional-spread shape. Any refactor that drops the conditional would break the 4-verb (no-severity) + 1-verb (force-critical) split.
2. **`maybeReopenAdminDenied` MUST stay the only Admin gate** — matrix-level RBAC does NOT cover Operator-vs-Admin for `update.Incident`. Moving the Admin check to middleware would erase the per-cell role guard.
3. The **400 Zod-issues surfacing pattern** in `classifyReopenError` is the template for the future cross-verb error-UX sweep (AI-4.1).

## Verification re-run after patches

- `pnpm --filter @surakkha/api test` — 114/114 green.
- `pnpm --filter @surakkha/web test` — 435/435 green.
- `pnpm -r typecheck` — clean.
- `lint` — clean (both packages).
- **Pre-existing failures noted:** 6 alerts/rules failures (AI-3.1) are unrelated and were failing before 4.11 started. Documented, not fixed.

## Deferrals

6 entries appended to `_bmad-output/implementation-artifacts/deferred-work.md` under "Deferred from: code review of 4-11-reopen-path (2026-08-30)".
