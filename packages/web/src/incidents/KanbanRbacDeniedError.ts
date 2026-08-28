/**
 * `KanbanRbacDeniedError` — tagged error for the active-list 403 path.
 *
 * Originally defined inside `KanbanBoard.tsx` (Story 4.3). Story 4.8
 * extracted it to its own module so `useSeverityBanner.ts` can
 * throw the SAME tagged error from its own fetch path without
 * creating a circular import (the banner imports the error
 * class; the Kanban imports the banner's hook transitively via
 * `AppShell.tsx` → `SeverityBanner.tsx` → `useSeverityBanner.ts`).
 *
 * Single source of truth: this file. Both `KanbanBoard.tsx`
 * (re-exports from here for backward compat) and
 * `useSeverityBanner.ts` import directly.
 *
 * The instanceof check at `KanbanBoard.tsx:224` (the `<RbacDenied />`
 * render branch) and the banner's `queryFn` both rely on this
 * class — keep the name + `.name` field stable.
 */
export class KanbanRbacDeniedError extends Error {
  constructor() {
    super("RBAC denied for /api/incidents/active");
    this.name = "KanbanRbacDeniedError";
  }
}
