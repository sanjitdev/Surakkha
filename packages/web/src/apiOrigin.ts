/**
 * `API_ORIGIN` — empty string means same-origin. Vite / nginx proxy
 * `/auth/` and `/api/` to the api; a non-empty origin would double-
 * prefix (`/api/auth/login`).
 *
 * Lives in its own module (not `main.tsx`) so both `main.tsx` (the
 * entry point) and `<ProtectedShell />` (where `configureApiClient`
 * runs on every authed mount, including hard reloads) import the
 * single source of truth without a cyclic import.
 *
 * Source-walk pinned by `__tests__/apiOrigin.spec.ts` so future
 * edits can't reintroduce the `/api` prefix regression.
 */
export const API_ORIGIN = "";
