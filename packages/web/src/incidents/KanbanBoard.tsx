/**
 * `KanbanBoard` — the 4-column active-incidents Kanban at `/incidents`.
 * TanStack Query owns the active-list cache; `useKanbanBoardSocket`
 * reconciles `incident:state_changed` events in place. The column
 * grouping is a pure helper (`groupByColumn`) so the test rig can
 * assert it without rendering.
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
 * Group incidents by column key. Pure helper — the test rig asserts
 * the grouping directly against a canned `IncidentPayload[]` fixture.
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
  return parsed.data as unknown as ActiveIncidentsEnvelope;
};

export const KanbanBoard = ({ socketUrl }: KanbanBoardProps = {}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const role = useCurrentRole();
  const currentUserId = useCurrentUserId();

  useKanbanBoardSocket(socketUrl);

  const query = useQuery<ActiveIncidentsEnvelope>({
    queryKey: [...KANBAN_ACTIVE_QUERY_KEY],
    queryFn: fetchActiveIncidents,
  });

  // Render-time Tech filter. The cache stays authoritative — the
  // underlying data feeds the severity banner, which is global.
  // Filtering at the cache layer would hide other-Tech UNSAFE rows
  // from a global safety surface.
  const renderedIncidents = useMemo<readonly IncidentPayload[]>(() => {
    const all = query.data?.incidents ?? [];
    if (role !== "Technician" || currentUserId === null) return all;
    return all.filter((i) => i.assignee_user_id === currentUserId);
  }, [query.data?.incidents, role, currentUserId]);

  // Columns always render, even while the query is loading or the
  // envelope is undefined — a loading→empty swap would unmount the
  // columns and break React-keyed DOM identity.
  const columns = useMemo<readonly KanbanColumnView[]>(
    () => groupByColumn(renderedIncidents),
    [renderedIncidents],
  );

  if (query.isError && query.error instanceof KanbanRbacDeniedError) {
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

  // Branch only fires when the QUERY has settled — a Tech with a
  // still-loading board must not flash the empty state for a frame.
  const isQuerySettled = !query.isLoading && !query.isFetching;
  const isTechEmpty = isQuerySettled && renderedIncidents.length === 0 && role === "Technician";

  return (
    <div
      data-testid="kanban-board-root"
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
    >
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
