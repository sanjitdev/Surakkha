---
title: "Test Spec — packages/web/src/auth critique-loop refinement"
type: "refactor"
created: "2026-09-02"
status: "ready-for-review"
review_loop_iteration: 0
context:
  - "{project-root}/.impeccable/critique/2026-09-02T17-00-00Z__packages-web-src-auth.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Auth/ scored 32/40 on Nielsen heuristics with 2 P1 + 4 P2 AI-slop findings (critique artifact `.impeccable/critique/2026-09-02T17-00-00Z__packages-web-src-auth.md`). The `LoginShell.tsx` carried a 27-line file-header JSDoc narrating layout, copy discipline, AND a Story-1.4 cross-reference already shipped; 5 separate `useState` calls (including 2 parallel error states). Three other files (`tokenStore.ts`, `CurrentRoleContext.tsx`, `jwtDecode.ts`) had headers narrating the full story-cross-reference history.

**Approach:** Trim file-level JSDoc to intent (mirrors incidents P1 #3). Consolidate the dual error states into a single `FieldError` discriminated union — one setter, one read, preserves the same UX (email error inside `FormField`; password/submit error in the `<p data-testid="login-submit-error">`).

## Boundaries & Constraints

**Always:**

- The 3 existing spec files (`login.spec.tsx`, `refresh.spec.ts`, `jwtDecode.spec.ts`) MUST stay green WITHOUT modification — the refactor preserves every observable behavior.
- `FieldError` MUST be a discriminated union, NOT parallel booleans, so the email-vs-password/submit split is type-safe.
- The email error MUST continue to surface inside the `FormField` slot (design-system affordance); only password/submit errors render in the `<p data-testid="login-submit-error">`.
- The testid-prefixed selectors used by the spec rig (`login-submit-error`, `login-hero`, `login-form-panel`, etc.) MUST NOT change.
- The viewport-driven canvas padding tiers (`px-6` / `px-4` / `px-3`) MUST stay bound to the existing 1024 / 768 breakpoints.

**Ask First:**

- Replacing the `window.addEventListener('resize', ...)` with the modern `matchMedia.addEventListener('change', ...)` API (would require viewport test-rig rework).
- Sharing `MEDIA_LG` / `MEDIA_MD` constants with `login.spec.tsx`'s `setViewport` mock.
- Tightening `LoginShell`'s `onSubmit` callback signature to receive the parsed `apiLogin` body instead of throwing.

**Never:**

- Add new error states (the consolidation is the point — going back to `emailError` + `submitError` would regress).
- Add a library JWT decoder (intentional — the inline decoder is 76 lines for one field).
- Move `_resetTokenStore` into a `__test__` sub-export — would force spec files to change their import path; rename is enough.
- Touch the `apiClient.ts` interceptor (it's not in the critique surface; the spec rig exercises it as-is).
- Re-export `readRoleFromStore` / `readUserIdFromStore` / `readAccessToken` as a bundle (reflexive re-exports are noise — they're each called from exactly one site).

## I/O & Edge-Case Matrix

| Scenario                            | Input / State                                                             | Expected Output / Behavior                                                                                    | Error Handling                         |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| HAPPY_LOGIN                         | `LoginShell` mounted at 1280px, valid email + password, onSubmit resolves | form renders; submit button shows "Sign in"; on submit, `onSubmit(email, password)` is called; no error shown | n/a                                    |
| HAPPY_INVALID_EMAIL_ALERT           | viewport=900px, empty email, click submit                                 | email error inline via FormField; submit never fires                                                          | email error string passed to FormField |
| HAPPY_INVALID_PASSWORD_SUBMIT_ERROR | email filled, empty password, click submit                                | password error in `login-submit-error` `<p>`; submit never fires                                              | FieldError{field:"password"}           |
| HAPPY_SERVER_ERROR_SURFACE          | submit handler throws `new Error("Network unreachable.")`                 | error surfaces in `login-submit-error` with the message verbatim                                              | FieldError{field:"submit"}             |
| HAPPY_VIEWPORT_LG                   | `setViewport(1280)`                                                       | form panel has `px-6`                                                                                         | n/a                                    |
| HAPPY_VIEWPORT_MD                   | `setViewport(900)`                                                        | form panel has `px-4`; hero hidden                                                                            | n/a                                    |
| HAPPY_VIEWPORT_SM                   | `setViewport(420)`                                                        | form panel has `px-3`                                                                                         | n/a                                    |
| HAPPY_HERO_HIDDEN                   | viewport=900                                                              | hero carries `hidden` class                                                                                   | n/a                                    |
| HAPPY_COPY_DISCIPLINE               | full render                                                               | DOM tree-walk finds zero exclamation marks                                                                    | n/a                                    |
| HAPPY_SUBMITTING_LABEL              | onSubmit handler awaits a manual release                                  | button label flips to "Signing in…"; button disabled                                                          | n/a                                    |
| HAPPY_FIELD_ERROR_CLEAR_ON_EDIT     | email error set, user types into email field                              | email error cleared                                                                                           | discriminated-union guard              |
| HAPPY_DECODE_ADMIN                  | JWT with role:"Admin", sub:"uuid", exp:9999999999                         | `{role:"Admin", userId:"uuid", expiresAt:9999999999}`                                                         | n/a                                    |
| HAPPY_DECODE_ALL_ROLES              | JWT with role:"Operator"/"Technician"/"Viewer"                            | each decodes to its enum value                                                                                | n/a                                    |
| HAPPY_DECODE_NO_ROLE                | JWT without `role` claim                                                  | `role:null` (device/simulator path)                                                                           | defensive fallback                     |
| HAPPY_DECODE_GHOST_ROLE             | JWT with role:"Ghost"                                                     | `role:null` (unknown enum value)                                                                              | defensive fallback                     |
| HAPPY_DECODE_MALFORMED_3_PARTS      | `"not.a.real.token.extra"`                                                | all 3 fields null                                                                                             | defensive fallback                     |
| HAPPY_DECODE_NO_SUB                 | JWT without `sub` claim                                                   | `userId:null`                                                                                                 | defensive fallback                     |
| HAPPY_DECODE_EMPTY_SUB              | JWT with sub:""                                                           | `userId:null` (empty-string guard)                                                                            | defensive fallback                     |
| HAPPY_DECODE_NONSTRING_SUB          | JWT with sub:42                                                           | `userId:null` (non-string guard)                                                                              | defensive fallback                     |
| HAPPY_REFRESH_BEARER_HEADER         | access token set, `apiFetch("/devices")`                                  | first call carries `Authorization: Bearer <token>`                                                            | n/a                                    |
| HAPPY_REFRESH_RETRY_ONCE            | original request 401, refresh succeeds, retry succeeds                    | exactly 3 fetch calls (401 + refresh + retry with new token)                                                  | n/a                                    |
| HAPPY_REFRESH_NO_RETRY_LOOP         | refresh itself 401s, original request 401s                                | exactly 1 refresh call; original 401 surfaced                                                                 | no infinite retry                      |
| HAPPY_REFRESH_NAV_TO_LOGIN          | refresh 401s                                                              | `navigate("/login?next=<path>")`; tokens cleared                                                              | AC2                                    |
| HAPPY_REFRESH_NETWORK_OFFLINE       | refresh throws TypeError                                                  | `onOffline()` fires; original 401 surfaced; tokens preserved                                                  | AC4                                    |

</frozen-after-approval>

## Code Map

- `packages/web/src/auth/LoginShell.tsx` — split-screen form; consolidated `FieldError` discriminated union; 5 `useState` → 4 (one error slot replaces two).
- `packages/web/src/auth/tokenStore.ts` — Zustand store; 3 sync read helpers (`readRoleFromStore` / `readUserIdFromStore` / `readAccessToken`); `_resetTokenStore` test escape.
- `packages/web/src/auth/jwtDecode.ts` — base64url decode + role/userId/exp extraction; pure helpers `asRole` / `asUserId` / `asExpiresAt` / `extractPayload`.
- `packages/web/src/auth/CurrentRoleContext.tsx` — React context with `initialRole` / `initialUserId` test-only overrides; subscribes to tokenStore.
- `packages/web/src/auth/login.spec.tsx` — Story 1.3 viewport matrix + copy discipline + submit states (9 cases).
- `packages/web/src/auth/refresh.spec.ts` — Story 1.7 401-refresh + offline + navigate-AC2 matrix (5 cases).
- `packages/web/src/auth/jwtDecode.spec.ts` — role + sub + malformed-token matrix (10 cases).

## Tasks & Acceptance

**Execution:**

- [x] `.impeccable/critique/2026-09-02T17-00-00Z__packages-web-src-auth.md` — critique artifact written.
- [x] `packages/web/src/auth/LoginShell.tsx` — header trimmed (27→6 lines); dual `emailError`/`submitError` consolidated to single `FieldError`.
- [x] `packages/web/src/auth/tokenStore.ts` — header trimmed (24→6 lines); inline JSDoc on 4 helpers trimmed to one-liners.
- [x] `packages/web/src/auth/CurrentRoleContext.tsx` — header trimmed (30→6 lines); inline JSDoc on `initialRole` / `initialUserId` / `useCurrentUserId` trimmed.
- [x] `packages/web/src/auth/jwtDecode.ts` — header trimmed (22→6 lines).
- [ ] COMMIT — pending.

**Acceptance Criteria:**

- Given `LoginShell` is mounted with viewport=1280, when the user clicks submit with empty email, then an email error renders inside the `FormField` (NOT in `<p data-testid="login-submit-error">`).
- Given `LoginShell` is mounted with viewport=1280, when the user clicks submit with empty password and a valid email, then a password error renders in `<p data-testid="login-submit-error">`.
- Given a submit error is set, when the user edits the password field, then the error clears.
- Given a submit error is set, when the user edits the email field, then a SUBMIT-class error does NOT clear (only an email-class error would — which doesn't exist in the password-onChange path).
- Given `LoginShell`'s file header is inspected, when measured, then it is ≤ 10 lines.
- Given `LoginShell.tsx` `useState` calls are counted, when measured, then there are exactly 4 (breakpoint / email / password / error / submitting).
- Given the 3 spec files are run, when the suite completes, then all existing tests pass without modification.
- Given `decodeAccessToken` is called with a JWT containing role:"Admin", sub:"uuid", exp:9999999999, then it returns `{role:"Admin", userId:"uuid", expiresAt:9999999999}`.
- Given `decodeAccessToken` is called with a 4-part string, then it returns `{role:null, userId:null, expiresAt:null}`.
- Given `apiFetch("/devices")` is called with a valid token, when the underlying fetch is 200, then the Authorization header is `Bearer <token>`.

## Spec Change Log

Empty until the first review loopback.

## Design Notes

### Why a discriminated union, not a single `string | null` error

The dual error-slot pattern exists because the email error renders INSIDE `FormField` (a design-system affordance that scopes the error to the field) while the password / submit error renders BELOW the form (a single inline `<p>`). A single `string | null` would force a branching decision in the render: which slot gets the error? The discriminated union `{ field: "email" } | { field: "password" | "submit" }` makes the routing type-safe — the email `onChange` clears `{field:"email"}` errors only; the password `onChange` clears the rest.

### Why not extract the `FieldError` type to a shared module

It's a single-file concern — `LoginShell` is the only consumer. Extracting to `auth/errors.ts` would add an import for one discriminated union; the local declaration reads naturally next to the form state.

### Why the trim is conservative (single-loop pass)

Auth/ scored 32/40 (vs incidents' 20/30 loop-1). The surface is small (4 source files, ~530 LOC) and already iterated over multiple stories. The critique surfaced 2 P1 + 4 P2 — applying them closes the surface. A loop-2 pass would likely be a re-tag (no new findings).

## Verification

**Commands:**

- `cd packages/web && npx vitest run src/auth/` — expected: 24 cases (9 login + 5 refresh + 10 jwtDecode) green.
- `cd packages/web && npx eslint src/auth/` — expected: clean.
- `cd packages/web && npx tsc -b` — expected: type-check clean.

**Manual checks (if no CLI):**

- Open `LoginShell.tsx`; confirm `emailError` and `submitError` setters do NOT appear as separate `useState` calls.
- Open `LoginShell.tsx`; confirm the `FieldError` discriminated union is the only error-shape declaration in the file.
- Open `tokenStore.ts`; confirm the 3 read helpers (`readRoleFromStore` / `readUserIdFromStore` / `readAccessToken`) each have ≤ 2-line JSDoc.
- Open `CurrentRoleContext.tsx`; confirm the file header is ≤ 10 lines.
- Open `jwtDecode.ts`; confirm the file header is ≤ 10 lines.
- Grep `packages/web/src/auth/` for `epics.md` — expected: 0 matches (rationale narratives removed).
- Grep `packages/web/src/auth/` for `Story 1.4` — expected: 0 matches (cross-references removed).
