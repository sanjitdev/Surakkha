/**
 * `KanbanBoard` — the 4-column active-incidents Kanban at
 * `/incidents`. TanStack Query owns the active-list cache;
 * `useKanbanBoardSocket` reconciles `incident:state_changed` events
 * in place. The column grouping is a pure helper (`groupByColumn`)
 * so the test rig can assert it without rendering.
 */
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

import { RbacDenied } from "../access/RbacDenied";
import { apiFetch } from "../api/apiClient";
import { useCurrentRole, useCurrentUserId } from "../auth/CurrentRoleContext";

import { ErrorState } from "./ErrorState";
import { KanbanCard } from "./KanbanCard";
import { KanbanRbacDeniedError } from "./KanbanRbacDeniedError";
import { KANBAN_ACTIVE_QUERY_KEY, useKanbanBoardSocket } from "./useKanbanBoardSocket";
import { ActiveIncidentsEnvelopeSchema } from "./wire";

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

const fetchActiveIncidents = async (): Promise<ActiveIncidentsEnvelope> => {
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
};

export const KanbanBoard = ({ socketUrl }: KanbanBoardProps = {}) => {
  const queryClient = useQueryClient();
  // Story 4.4 — clicking a card navigates to the read-only
  // detail page at `/incidents/:id`. The detail page handles
  // 404 / 403 / 500 / loading / success; the Kanban stays focused
  // on the active-list projection.
  const navigate = useNavigate();
  // Story 4.12 — the role + userId drive the render-time Tech
  // filter and the empty-state branch. The hooks return `null`
  // for unauthenticated; the route gate handles that case before
  // this component renders.
  const role = useCurrentRole();
  const currentUserId = useCurrentUserId();

  // Mount the realtime subscription (per-page lifecycle). The hook
  // mutates the SHARED `["incidents", "active"]` cache in place —
  // it does NOT apply the Tech filter (see `useKanbanBoardSocket.ts`
  // header). The render-time filter below is the single place the
  // Tech-only view is enforced; the cache stays authoritative for
  // `useSeverityBanner` (a global safety surface).
  useKanbanBoardSocket(socketUrl);

  const query = useQuery<ActiveIncidentsEnvelope>({
    queryKey: [...KANBAN_ACTIVE_QUERY_KEY],
    queryFn: fetchActiveIncidents,
  });

  // Story 4.12 — render-time Tech filter. The server's `/api/
  // incidents/active` endpoint returns EVERY active row (the
  // server doesn't know the viewer is a Tech until they pass the
  // token; the shared cache also feeds the severity banner which
  // is global). The Kanban filters its rendered slice by
  // `assignee_user_id === currentUserId` for Technicians.
  //
  // Why render-time and not query-time: the cache is shared with
  // `useSeverityBanner` (Story 4.8). A cache-time filter would
  // hide other-Tech UNSAFE rows from the banner — a global
  // safety surface must NOT be Tech-filtered (spec line 144 +
  // AC9). The Kanban's Tech-only view is a render concern; the
  // underlying data is global.
  const renderedIncidents = useMemo<readonly IncidentPayload[]>(() => {
    const all = query.data?.incidents ?? [];
    if (role !== "Technician" || currentUserId === null) return all;
    return all.filter((i) => i.assignee_user_id === currentUserId);
  }, [query.data?.incidents, role, currentUserId]);

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
    () => groupByColumn(renderedIncidents),
    [renderedIncidents],
  );

  if (query.isError && query.error instanceof KanbanRbacDeniedError) {
    // Story 6.11 — thread the role so the back-link picks the
    // role-aware destination.
    return <RbacDenied viewerRole={role} />;
  }

  if (query.isError) {
    return (
      <ErrorState
        testIdPrefix="kanban-board"
        message="Failed to load incidents"
        onRetry={() => {
          void queryClient.invalidateQueries({ queryKey: [...KANBAN_ACTIVE_QUERY_KEY] });
        }}
      />
    );
  }

  // Story 4.12 — Tech-empty-state branch. The branch only fires
  // when the QUERY has finished loading (no flash during the
  // initial fetch — a Tech with a still-loading board should NOT
  // see the empty state for a frame). The Tech-empty branch
  // counts the render-time-filtered rows (NOT the raw envelope),
  // so a Tech whose server envelope has rows but none are theirs
  // also sees the empty state.
  const isQuerySettled = !query.isLoading && !query.isFetching;
  const isTechEmpty = isQuerySettled && renderedIncidents.length === 0 && role === "Technician";

  return (
    <div
      data-testid="kanban-board-root"
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
    >
      {/*
        Story 4.12 — Tech-specific empty state. UX-DR-14 mandates
        "No incidents assigned to you." for a Technician whose
        active list is empty. The branch is positioned above the
        column loop (instead of inside the per-column empty-state
        fallback) so the message replaces the four-column grid for
        a Tech with zero assignments — a Tech should NOT see "No
        incidents" repeated four times, that implies "the system is
        empty" rather than "your queue is empty". Admin / Operator
        / Viewer keep the per-column "No incidents" fallback
        (4.3's surface).
      */}
      {isTechEmpty ? (
        <p
          data-testid="kanban-empty-state-technician"
          className="col-span-4 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
        >
          No incidents assigned to you.
        </p>
      ) : (
        <KanbanColumnGrid columns={columns} onCardClick={(id) => navigate(`/incidents/${id}`)} />
      )}
    </div>
  );
};

interface KanbanColumnGridProps {
  readonly columns: readonly KanbanColumnView[];
  readonly onCardClick: (id: string) => void;
}

const KanbanColumnGrid = ({ columns, onCardClick }: KanbanColumnGridProps) => (
  <>
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
                <KanbanCard incident={incident} onClick={onCardClick} />
              </li>
            ))}
          </ul>
        )}
      </section>
    ))}
  </>
);

/**
 * `applyStateChangeToCache` and `IncidentStateChangedEvent` are
 * imported directly from `./useKanbanBoardSocket` + the shared
 * events module — no re-export here.
 */
