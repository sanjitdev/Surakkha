/**
 * `IncidentsPage` — page-level wrapper for the `/incidents` route.
 *
 * The board (column grouping, socket reconciliation, RBAC + error
 * surfaces) lives in `KanbanBoard.tsx`. This wrapper contributes only
 * the page-level chrome (`<PageHeader />`) so the `/incidents` route
 * reads with the same heading rhythm as `/admin/thresholds`,
 * `/admin/notifications`, `/audit`, etc. — DESIGN.md §Layout &
 * Spacing pins 16px top margin + 24px section gap below the heading.
 *
 * Why a wrapper instead of putting `<PageHeader />` inside
 * `KanbanBoard`: `KanbanBoard` is also reused by the test rig at
 * `KanbanBoard.spec.tsx`, which mounts the board directly under
 * `<AppShell>` to assert column rendering and socket reconciliation
 * without a heading getting in the way of the assertions. Keeping
 * the board "chrome-less" and putting the header in this thin
 * wrapper preserves that test surface and matches the
 * `ThresholdsPage` / `ThresholdsPopulatedView` split.
 */
import { PageHeader } from "../components/PageHeader";

import { KanbanBoard } from "./KanbanBoard";

export const IncidentsPage = () => (
  <div data-testid="incidents-page" className="flex flex-col">
    <PageHeader title="Incidents" />
    <KanbanBoard />
  </div>
);
