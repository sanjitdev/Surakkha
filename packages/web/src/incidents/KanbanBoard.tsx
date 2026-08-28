/**
 * `KanbanBoard` — Story 4.3.
 *
 * The operator-facing 4-column severity-mixed Kanban view at
 * `/incidents`. Top-level component; TanStack Query for the active
 * list (cache key `["incidents", "active"]`); `useKanbanBoardSocket`
 * for in-place re-derivation on every `incident:state_changed`.
 *
 * Why no zustand store: the board state is `Map<incident_id,
 * IncidentPayload>` + the column grouping. A zustand store buys
 * us nothing over TanStack Query's cache + `useState` for the
 * column-keyed React tree. If a future story (4.10 NotificationBell,
 * 4.12 technician filter) needs cross-page state, that story wires
 * the store. (See spec Design Notes.)
 *
 * 4-column grid (CSS grid; `grid-template-columns: repeat(4, ...)`):
 *
 *   ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
 *   │  OPEN · CRITICAL │  OPEN · WARNING  │  ACKNOWLEDGED    │  RESOLVED        │
 *   │  KanbanColumn=   │  KanbanColumn=   │  KanbanColumn=   │  KanbanColumn=   │
 *   │  OPEN_CRITICAL   │  OPEN_WARNING    │  ACKNOWLEDGED    │  RESOLVED        │
 *   ├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
 *   │ <KanbanCard/>    │ <KanbanCard/>    │ <KanbanCard/>    │ <KanbanCard/>    │
 *   │ <KanbanCard/>    │                  │                  │                  │
 *   └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
 *
 * `RESOLVED` is reserved for the projection of `SAFE / UNSAFE /
 * MONITORING / RESOLVED` (these states are NOT on the active board
 * by default — the spec's "RESOLVED_DROP" edge case removes them
 * on transition). On a brand-new boot with no incidents, every
 * column renders "No incidents".
 *
 * The column key (NOT the incident id) is the React key for the
 * outer `map`. When a card's `projectKanbanColumn(state, severity)`
 * flips (e.g., OPEN critical → ACKNOWLEDGED), React re-derives the
 * column-keyed mapping and moves the card between columns without
 * touching the rest of the board.
 *
 * 403 RBAC denial renders the existing `<RbacDenied />` per the
 * spec's "NETWORK_500 / RBAC denial (403)" edge case. The api
 * returns 403 only for Technician ownership violations on the
 * per-incident read; the active list is read-accessible to every
 * authenticated role, so 403 is rare in practice — but the spec
 * pins the surface to satisfy the 4.1 pattern.
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import {
  type IncidentPayload,
  type IncidentSeverity,
  type IncidentState,
  type KanbanColumn,
  KanbanColumnSchema,
  projectKanbanColumn,
} from "@surakkha/shared/incident";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { RbacDenied } from "../access/RbacDenied";
import { apiFetch } from "../api/apiClient";

import { KanbanCard } from "./KanbanCard";
import { KanbanRbacDeniedError } from "./KanbanRbacDeniedError";
import { KANBAN_ACTIVE_QUERY_KEY, useKanbanBoardSocket } from "./useKanbanBoardSocket";

const COLUMN_ORDER: readonly KanbanColumn[] = [
  "OPEN_CRITICAL",
  "OPEN_WARNING",
  "ACKNOWLEDGED",
  "RESOLVED",
];

/** HTTP status code sentinel — RBAC denial. */
const HTTP_FORBIDDEN = 403;

const COLUMN_HEADLINE: Record<KanbanColumn, string> = {
  OPEN_CRITICAL: "Open · Critical",
  OPEN_WARNING: "Open · Warning",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
};

const COLUMN_ACCENT: Record<KanbanColumn, string> = {
  OPEN_CRITICAL: "border-severity-critical-value",
  OPEN_WARNING: "border-severity-warning-value",
  ACKNOWLEDGED: "border-primary",
  RESOLVED: "border-neutral-border",
};

const IncidentPayloadWireSchema = z.object({
  id: z.string().uuid(),
  device_id: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  metric: z.string(),
  value: z.number(),
  opened_at: z.string().datetime({ offset: true }),
  state: z.enum([
    "OPEN",
    "ACKNOWLEDGED",
    "INSPECTING",
    "SAFE",
    "UNSAFE",
    "MONITORING",
    "RESOLVED",
    "REOPENED",
  ]),
  assignee_user_id: z.string().uuid().nullable(),
  acknowledged_at: z.string().datetime({ offset: true }).nullable(),
  resolved_at: z.string().datetime({ offset: true }).nullable(),
});

/**
 * Re-export the wire schema for the test rig. The canonical
 * `IncidentPayloadSchema` lives in `@surakkha/shared/incident`;
 * this hand-rolled copy MUST stay structurally equivalent to it
 * (see `KanbanBoard.spec.tsx`'s "structural equivalence" test).
 * If a future change adds a field to the canonical schema, this
 * copy must move in lock-step or the `safeParse` at the fetch
 * site will start failing at runtime.
 */
export { IncidentPayloadWireSchema };

const ActiveIncidentsEnvelopeSchema = z.object({
  incidents: z.array(IncidentPayloadWireSchema),
});

interface ActiveIncidentsEnvelope {
  readonly incidents: readonly IncidentPayload[];
}

const deriveColumn = (state: IncidentState, severity: IncidentSeverity): KanbanColumn =>
  KanbanColumnSchema.parse(projectKanbanColumn(state, severity));

interface KanbanColumnView {
  readonly column: KanbanColumn;
  readonly incidents: readonly IncidentPayload[];
}

/**
 * Group incidents by column key. Pure helper (no React, no fetch)
 * — the test rig asserts the grouping directly against a canned
 * `IncidentPayload[]` fixture.
 */
export const groupByColumn = (
  incidents: readonly IncidentPayload[],
): readonly KanbanColumnView[] => {
  const buckets: Record<KanbanColumn, IncidentPayload[]> = {
    OPEN_CRITICAL: [],
    OPEN_WARNING: [],
    ACKNOWLEDGED: [],
    RESOLVED: [],
  };
  for (const incident of incidents) {
    const col = deriveColumn(incident.state, incident.severity);
    buckets[col].push(incident);
  }
  return COLUMN_ORDER.map((column) => ({
    column,
    incidents: buckets[column],
  }));
};

export interface KanbanBoardProps {
  /**
   * Override the socket URL for tests. Production leaves this
   * undefined and uses the `/dashboard` namespace default.
   */
  readonly socketUrl?: string;
}

export const KanbanBoard = ({ socketUrl }: KanbanBoardProps = {}) => {
  const queryClient = useQueryClient();
  // Story 4.4 — clicking a card navigates to the read-only
  // detail page at `/incidents/:id`. The detail page handles
  // 404 / 403 / 500 / loading / success; the Kanban stays focused
  // on the active-list projection.
  const navigate = useNavigate();

  // Mount the realtime subscription (per-page lifecycle).
  useKanbanBoardSocket(socketUrl);

  const query = useQuery<ActiveIncidentsEnvelope>({
    queryKey: [...KANBAN_ACTIVE_QUERY_KEY],
    queryFn: async () => {
      const res = await apiFetch("/api/incidents/active");
      if (res.status === HTTP_FORBIDDEN) {
        // RBAC denial — surface the existing denied surface (per
        // the 4.1 pattern). We throw a tagged error so the query's
        // `isError` branch can distinguish RBAC from generic
        // failures without a separate `error` type.
        throw new KanbanRbacDeniedError();
      }
      if (!res.ok) {
        throw new Error(`/api/incidents/active failed: ${res.status}`);
      }
      const parsed = ActiveIncidentsEnvelopeSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("incidents/active wire-shape mismatch", parsed.error);
        throw new Error("incidents/active wire-shape mismatch");
      }
      // The wire schema is structural; the runtime cast keeps the
      // type narrow at the consumer.
      return parsed.data as unknown as ActiveIncidentsEnvelope;
    },
  });

  // Project incidents into columns. `useMemo` because the
  // grouping is O(N) over the active list and re-running on
  // every render is wasteful for a board that may render
  // hundreds of cards.
  //
  // The columns are ALWAYS rendered, even when the query is
  // loading or the envelope is `undefined`. AC: "Given the board
  // renders with zero incidents, when the page mounts, then all
  // 4 columns render the 'No incidents' empty-state copy." A
  // loading-then-empty swap would unmount + remount the columns
  // and break the React-keyed DOM identity (the columns are the
  // layout seam; their order matters to the grid).
  const columns = useMemo<readonly KanbanColumnView[]>(
    () => groupByColumn(query.data?.incidents ?? []),
    [query.data?.incidents],
  );

  if (query.isError && query.error instanceof KanbanRbacDeniedError) {
    return <RbacDenied />;
  }

  if (query.isError) {
    return (
      <KanbanErrorState
        onRetry={() => {
          void queryClient.invalidateQueries({ queryKey: [...KANBAN_ACTIVE_QUERY_KEY] });
        }}
      />
    );
  }

  return (
    <div
      data-testid="kanban-board-root"
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
    >
      {columns.map(({ column, incidents }) => (
        <section
          key={column}
          data-testid={`kanban-column-${column}`}
          aria-label={COLUMN_HEADLINE[column]}
          className={`flex min-h-[40vh] flex-col gap-3 rounded-card border bg-neutral-surface p-3 ${COLUMN_ACCENT[column]}`}
        >
          <header className="flex items-center justify-between">
            <h2 className="text-md font-semibold text-neutral-body">{COLUMN_HEADLINE[column]}</h2>
            <span
              data-testid={`kanban-column-${column}-count`}
              className="text-xs text-neutral-secondary"
            >
              {incidents.length}
            </span>
          </header>
          {incidents.length === 0 ? (
            <p
              data-testid={`kanban-column-${column}-empty`}
              className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
            >
              No incidents
            </p>
          ) : (
            <ul data-testid={`kanban-column-${column}-list`} className="flex flex-col gap-2">
              {incidents.map((incident) => (
                // The React key is the incident id (stable per row),
                // NOT the column key — when a card flips columns,
                // the React tree remaps the SAME node into a NEW
                // `<li>` parent, which preserves component state.
                <li key={incident.id} className="list-none">
                  <KanbanCard
                    incident={incident}
                    onClick={(clickedId) => navigate(`/incidents/${clickedId}`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
};

/**
 * Re-export `KanbanRbacDeniedError` from its dedicated module
 * (`./KanbanRbacDeniedError`) for backward compat — Story 4.3
 * defined it here originally; Story 4.8 extracted it to break
 * the import cycle between `KanbanBoard.tsx` and
 * `useSeverityBanner.ts`. The original export path stays
 * available so external callers (tests + sibling modules) don't
 * need to update imports.
 */
export { KanbanRbacDeniedError };

interface KanbanErrorStateProps {
  readonly onRetry: () => void;
}

const KanbanErrorState = ({ onRetry }: KanbanErrorStateProps) => (
  <div data-testid="kanban-board-error-state" className="flex flex-col gap-3">
    <p
      data-testid="kanban-board-error-message"
      className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
    >
      Failed to load incidents
    </p>
    <button
      type="button"
      data-testid="kanban-board-retry-button"
      onClick={onRetry}
      className="self-center rounded-input border border-primary px-4 py-2 text-sm text-primary"
    >
      Retry
    </button>
  </div>
);

/**
 * Re-export for tests. The pure cache mutator lives in
 * `useKanbanBoardSocket.ts`; this re-export keeps the import
 * path consistent when the test rig wants to assert against
 * the SAME helper the board uses.
 */
export { applyStateChangeToCache } from "./useKanbanBoardSocket";
export type { IncidentStateChangedEvent };
