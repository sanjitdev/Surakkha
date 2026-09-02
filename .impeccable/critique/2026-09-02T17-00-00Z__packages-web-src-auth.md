# Critique — `packages/web/src/auth/` (2026-09-02)

Nielsen heuristic scoring + AI-slop detection (manual pass; detector Bash-blocked).

## Surface inventory

7 source files + 3 spec files, ~1,100 LOC:

| File                     | LOC | Role                                                        |
| ------------------------ | --- | ----------------------------------------------------------- |
| `tokenStore.ts`          | 137 | Zustand store + localStorage persist + 3 sync read helpers  |
| `jwtDecode.ts`           | 76  | base64url decode + role/userId/exp extraction               |
| `CurrentRoleContext.tsx` | 113 | React context for `{role, userId}` (Story 1.6 + 1.7 + 4.12) |
| `LoginShell.tsx`         | 205 | Story 1.3 split-screen login form                           |
| `login.spec.tsx`         | 209 | Story 1.3 viewport + copy + submit matrix                   |
| `refresh.spec.ts`        | 234 | Story 1.7 401-refresh + offline + navigate-AC2 matrix       |
| `jwtDecode.spec.ts`      | 115 | role + sub + malformed-token matrix                         |

## Scoring

Nielsen 10 (1 = bad, 4 = good):

| H                              | Score | Note                                                                                                   |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------ |
| 1 Visibility of system status  | 4     | `submitting` button label flips; loading state visible.                                                |
| 2 Match real world             | 3     | Login copy uses operator personas ("you@school.edu.bd") — good.                                        |
| 3 User control + freedom       | 3     | Cancel via second click? No — submit is a state, not a nav.                                            |
| 4 Consistency + standards      | 4     | All transitions POST through `apiFetch` interceptor; Bearer header uniform.                            |
| 5 Error prevention             | 3     | Empty email validated client-side; password routed to `submitError` (per JSDoc rationale).             |
| 6 Recognition > recall         | 3     | Placeholder email shows domain.                                                                        |
| 7 Flexibility + efficiency     | 3     | None — single form, no shortcuts.                                                                      |
| 8 Aesthetic + minimal          | 3     | Hero gradient + brand mark + 2-line tagline. Acceptable for Story 1.3 baseline.                        |
| 9 Help users recognize/recover | 4     | `submitError` surfaces `err.message`; `setSubmitError(null)` on field re-edit clears the inline state. |
| 10 Help + documentation        | 2     | None in-product; JSDoc-only. Out of scope for this pass.                                               |

**Total: 32 / 40** (vs incidents loop-1: 20/30, ~10/12 normalized). Auth/ is in better shape because it's older / already iterated.

## AI-slop findings

### P1 (high-impact)

- **P1 #1 — `LoginShell.tsx` 27-line file-header JSDoc** (lines 1–27). The header narrates layout, viewport behavior, copy discipline, AND a story-cross-reference to Story 1.4 that's already shipped. Trim to intent only. (Mirrors incidents P1 #3.)
- **P1 #2 — `LoginShell.tsx` 5 separate `useState` calls** for a 4-field form (`email`, `password`, `emailError`, `submitting`, `submitError`). The 2 error states are the obvious sprawl candidate — both fire from `handleSubmit` and both clear on field re-edit. Consolidate into one error-state map.

### P2 (medium-impact)

- **P2 #1 — `tokenStore.ts` 24-line header JSDoc** + 3 inline JSDoc blocks on `readRoleFromStore` / `readUserIdFromStore` / `readAccessToken` that narrate the same "synchronous; used by apiClient" pattern. Trim to intent only.
- **P2 #2 — `CurrentRoleContext.tsx` 30-line header JSDoc** that narrates Stories 1.6 / 1.7 / 4.12 (3 stories in one header). Trim to intent.
- **P2 #3 — `jwtDecode.ts` 22-line header JSDoc** that explains the "why not jwt-decode" library decision and the wire contract. Trim; the doc is a design rationale, not a code contract.
- **P2 #4 — `tokenStore.ts` `_resetTokenStore()` exposes a `_*` helper from a production module** that mutates state outside the store's API. The naming suggests "test-only" but it's exported at module scope (no `__test__` guard). Either move to a `__test__` sub-export or document the production-blanket escape as intentional (it's used by the refresh path on logout — i.e. it IS a production concern, just badly named).

### P3 (low / out-of-scope)

- `LoginShell` re-implements `matchMedia` listener with `addEventListener('resize', ...)` instead of `matchMedia.addEventListener('change', ...)` (the modern API). The legacy approach still works but creates 60fps resize handler calls. Out of scope — would require viewport test-rig rework.
- `LoginShell`'s `MEDIA_LG` / `MEDIA_MD` strings are duplicated with `login.spec.tsx`'s `setViewport` mock (lines 27–29 of the spec). Could share a `breakpoints.ts` constants module. Out of scope — spec-local mock.
- `apiLogin` (apiClient.ts:247) is the right pattern but `LoginShell.tsx:90` ignores the Response — the shell throws on the stub error path even though `apiLogin` returns the Response. The shell's `onSubmit` callback signature `(email, password) => Promise<void>` was designed before `apiLogin` existed; could be tightened to take the parsed body. Out of scope — Story 1.4 wiring concern.

## Refinement plan

1. **Trim JSDoc** across all 4 files (mirrors incidents P1 #3).
2. **Consolidate LoginShell error states** — one `error: string | null` slot replaces `emailError` + `submitError`. The dual-slot exists because the form shows the email error INLINE (via `FormField`) and the password/submit error BELOW the form. To preserve that UX:
   - keep the `FormField`-level error wiring (the design system owns it),
   - but use a single `state.error: { field: "email" | "password" | "submit", message: string }` shape.
   - The state setter `setError({ field: "submit", message: "..." })` is one setter, one read.
3. **`_resetTokenStore` rename** → `clearAllTokensForTest` (test-only escape) OR move into a `__test__` sub-export. Pick the rename — moving to `__test__` requires more spec changes.
4. **No functional change** — the consolidation is a pure refactor.

## Estimated delta

- LoginShell.tsx: 205 → ~155 LOC (-50)
- tokenStore.ts: 137 → ~110 LOC (-27)
- CurrentRoleContext.tsx: 113 → ~85 LOC (-28)
- jwtDecode.ts: 76 → ~50 LOC (-26)
- **Net: -131 LOC** with no behavior change; same test surface green.

## Convergence

This is a single-loop pass. Loop-2 unlikely to surface more P1/P2 — the surface is small and already iterated.
