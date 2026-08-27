/**
 * `IncidentDetailPage` — Story 4.4.
 *
 * The read-only detail view at `/incidents/:id`. Renders the
 * parent incident row + the IncidentEvent audit timeline.
 * Subscribes to `incident:state_changed` and mutates the cached
 * row in place; resolved incidents STAY visible (different from
 * the Kanban's drop-on-RESOLVED — the detail page is read-only;
 * resolved incidents are first-class).
 *
 * Wire shape (canonical from `@surakkha/shared/incident`):
 *
 *   GET /api/incidents/:id            → IncidentPayload
 *   GET /api/incidents/:id/events     → { events: IncidentEventPayload[] }
 *
 * The two fetches run in parallel; each has its own cache key
 * (`["incidents", "detail", id]` for the row;
 * `["incidents", "detail", id, "events"]` for the timeline).
 *
 * Why no action affordances: Story 4.4 is the read-only frame;
 * Stories 4.5 / 4.6 / 4.7 / 4.11 ship the acknowledge / assign /
 * submit-result / reopen buttons. The detail page surfaces the
 * data (state, assignee, resolved_at) that those buttons will
 * mutate.
 *
 * Why a 404 surface here but not on the Kanban: the active list
 * (Kanban) never 404s — it's a list endpoint. The per-incident
 * read can 404 when the id is bogus or the row was deleted.
 * The detail page is the FIRST 404 surface in the web codebase;
 * the `<NotFound />` component lives at
 * `packages/web/src/access/NotFound.tsx` so future per-entity
 * detail pages reuse it.
 *
 * Classnames + testids follow `KanbanCard.tsx` conventions.
 * Severity dot, severity label, state label are imported from
 * `KanbanCard.tsx` directly — no duplication.
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import {
  type IncidentEventPayload,
  IncidentEventPayloadSchema,
  type IncidentPayload,
  IncidentPayloadSchema,
} from "@surakkha/shared/incident";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { z } from "zod";

import { NotFound } from "../access/NotFound";
import { RbacDenied } from "../access/RbacDenied";
import { apiFetch } from "../api/apiClient";

import { IncidentDetailNotFoundError } from "./IncidentDetailNotFoundError";
import { IncidentDetailRbacDeniedError } from "./IncidentDetailRbacDeniedError";
import { SEVERITY_DOT_BG, SEVERITY_LABEL, STATE_LABEL } from "./KanbanCard";
import { incidentDetailQueryKey, useIncidentDetailSocket } from "./useIncidentDetailSocket";

/** HTTP status code sentinels — RBAC denial + not-found. */
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const IncidentEventEnvelopeSchema = z.object({
  events: z.array(IncidentEventPayloadSchema),
});

const IncidentDetailRowSchema = IncidentPayloadSchema;

interface IncidentDetailEnvelope {
  readonly incident: IncidentPayload;
}

interface IncidentDetailRow {
  readonly incident: IncidentPayload;
}

interface IncidentTimeline {
  readonly events: readonly IncidentEventPayload[];
}

/**
 * The error-state, loading-skeleton, and helper components
 * for the detail page.
 */
interface IncidentDetailErrorStateProps {
  readonly onRetry: () => void;
}

const IncidentDetailErrorState = ({ onRetry }: IncidentDetailErrorStateProps) => (
  <div data-testid="incident-detail-error-state" className="flex flex-col gap-3">
    <p
      data-testid="incident-detail-error-message"
      className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
    >
      Failed to load incident
    </p>
    <button
      type="button"
      data-testid="incident-detail-retry-button"
      onClick={onRetry}
      className="self-center rounded-input border border-primary px-4 py-2 text-sm text-primary"
    >
      Retry
    </button>
  </div>
);

const IncidentDetailSkeleton = () => (
  <div data-testid="incident-detail-loading" className="flex flex-col gap-4">
    <p className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary">
      Loading incident...
    </p>
  </div>
);

const formatDateOrDash = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toISOString().slice(0, ISO_DATE_PREFIX_LENGTH);

const formatActorOrAnonymous = (id: string | null): string => (id === null ? "anonymous" : id);

const ISO_DATE_PREFIX_LENGTH = 10;

/**
 * Render the incident row + timeline for a known id. Mounts the
 * realtime subscription (per-page lifecycle). Two TanStack
 * Queries (row + timeline); each has its own cache key so the
 * socket mutator updates the row independently of the timeline
 * fetch.
 */
export const IncidentDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  useIncidentDetailSocket(id ?? "");

  const rowQuery = useQuery<IncidentDetailRow>({
    queryKey: [...incidentDetailQueryKey(id ?? "")],
    enabled: id !== undefined,
    queryFn: async () => {
      const res = await apiFetch(`/api/incidents/${id}`);
      if (res.status === HTTP_FORBIDDEN) {
        throw new IncidentDetailRbacDeniedError();
      }
      if (res.status === HTTP_NOT_FOUND) {
        // The detail page distinguishes 404 (not found) from generic
        // errors. We throw a tagged error so the `isError` branch
        // can render `<NotFound />` without a separate `error`
        // type union.
        throw new IncidentDetailNotFoundError();
      }
      if (!res.ok) {
        throw new Error(`/api/incidents/${id} failed: ${res.status}`);
      }
      const parsed = IncidentDetailRowSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("incidents/:id wire-shape mismatch", parsed.error);
        throw new Error("incidents/:id wire-shape mismatch");
      }
      const envelope: IncidentDetailEnvelope = { incident: parsed.data };
      return envelope;
    },
  });

  const timelineQuery = useQuery<IncidentTimeline>({
    queryKey: [...incidentDetailQueryKey(id ?? ""), "events"],
    enabled: id !== undefined && !rowQuery.isError,
    queryFn: async () => {
      const res = await apiFetch(`/api/incidents/${id}/events`);
      if (res.status === HTTP_FORBIDDEN) {
        // Mirror the row's RBAC denial.
        throw new IncidentDetailRbacDeniedError();
      }
      if (res.status === HTTP_NOT_FOUND) {
        // The timeline endpoint returns 404 when the parent
        // incident doesn't exist; treat it the same as the row's
        // 404 so the page renders `<NotFound />` cleanly.
        throw new IncidentDetailNotFoundError();
      }
      if (!res.ok) {
        throw new Error(`/api/incidents/${id}/events failed: ${res.status}`);
      }
      const parsed = IncidentEventEnvelopeSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("incidents/:id/events wire-shape mismatch", parsed.error);
        throw new Error("incidents/:id/events wire-shape mismatch");
      }
      return { events: parsed.data.events };
    },
  });

  const incident = rowQuery.data?.incident;

  // Project events into timeline rows. `useMemo` because the
  // projection is O(N) over the events array; re-running on every
  // render is wasteful for an operator that may park on this page
  // for minutes while inspecting a single incident.
  const timeline = useMemo<readonly IncidentEventPayload[]>(
    () => timelineQuery.data?.events ?? [],
    [timelineQuery.data?.events],
  );

  return (
    <IncidentDetailDispatch
      rowQuery={rowQuery}
      incident={incident}
      timeline={timeline}
      onRetry={() => {
        void queryClient.invalidateQueries({
          queryKey: [...incidentDetailQueryKey(id ?? "")],
        });
      }}
    />
  );
};

/**
 * State-dispatch: pick the right render branch based on the
 * row query's error/success state. Extracted from
 * `IncidentDetailPage` to keep its cyclomatic complexity under
 * the `complexity: 10` lint ceiling.
 */
const IncidentDetailDispatch = ({
  rowQuery,
  incident,
  timeline,
  onRetry,
}: {
  readonly rowQuery: ReturnType<typeof useQuery<IncidentDetailRow>>;
  readonly incident: IncidentPayload | undefined;
  readonly timeline: readonly IncidentEventPayload[];
  readonly onRetry: () => void;
}) => {
  if (rowQuery.isError && rowQuery.error instanceof IncidentDetailNotFoundError) {
    return <NotFound />;
  }
  if (rowQuery.isError && rowQuery.error instanceof IncidentDetailRbacDeniedError) {
    return <RbacDenied />;
  }
  if (rowQuery.isError) {
    return <IncidentDetailErrorState onRetry={onRetry} />;
  }
  if (incident === undefined) {
    return <IncidentDetailSkeleton />;
  }
  return <IncidentDetailBody incident={incident} timeline={timeline} />;
};

/**
 * The detail-page body (incident row + audit timeline). Extracted
 * from `IncidentDetailPage` so the page component stays under the
 * `max-lines-per-function: 200` lint ceiling; the body renders
 * the header (severity dot + state label), the field `<dl>`, and
 * the timeline list.
 */
const IncidentDetailBody = ({
  incident,
  timeline,
}: {
  readonly incident: IncidentPayload;
  readonly timeline: readonly IncidentEventPayload[];
}) => (
  <div
    data-testid="incident-detail-root"
    data-state={incident.state}
    data-severity={incident.severity}
    className="flex flex-col gap-6"
  >
    <header className="flex items-center justify-between">
      <h1 className="text-lg font-semibold text-neutral-body">Incident {incident.id}</h1>
      <div className="flex items-center gap-2 text-sm text-neutral-body">
        <span
          aria-hidden
          data-testid="incident-detail-severity-dot"
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: SEVERITY_DOT_BG[incident.severity] }}
        />
        <span data-testid="incident-detail-severity-label">
          {SEVERITY_LABEL[incident.severity]}
        </span>
        <span className="text-neutral-secondary">·</span>
        <span data-testid="incident-detail-state-label">{STATE_LABEL[incident.state]}</span>
      </div>
    </header>

    <dl className="grid grid-cols-2 gap-3 rounded-card border border-neutral-border bg-neutral-surface p-4 text-sm">
      <dt className="text-neutral-secondary">Device</dt>
      <dd data-testid="incident-detail-device" className="font-mono text-neutral-body">
        {incident.device_id}
      </dd>
      <dt className="text-neutral-secondary">Metric</dt>
      <dd data-testid="incident-detail-metric" className="text-neutral-body">
        {incident.metric}
      </dd>
      <dt className="text-neutral-secondary">Value</dt>
      <dd data-testid="incident-detail-value" className="text-neutral-body">
        {incident.value}
      </dd>
      <dt className="text-neutral-secondary">Opened at</dt>
      <dd data-testid="incident-detail-opened-at" className="text-neutral-body">
        {new Date(incident.opened_at).toISOString().slice(0, ISO_DATE_PREFIX_LENGTH)}
      </dd>
      <dt className="text-neutral-secondary">Assignee</dt>
      <dd data-testid="incident-detail-assignee" className="font-mono text-neutral-body">
        {formatActorOrAnonymous(incident.assignee_user_id)}
      </dd>
      <dt className="text-neutral-secondary">Acknowledged at</dt>
      <dd data-testid="incident-detail-acknowledged-at" className="text-neutral-body">
        {formatDateOrDash(incident.acknowledged_at)}
      </dd>
      <dt className="text-neutral-secondary">Resolved at</dt>
      <dd data-testid="incident-detail-resolved-at" className="text-neutral-body">
        {formatDateOrDash(incident.resolved_at)}
      </dd>
    </dl>

    <section data-testid="incident-detail-timeline-section" className="flex flex-col gap-3">
      <h2 className="text-md font-semibold text-neutral-body">Audit timeline</h2>
      {timeline.length === 0 ? (
        <p
          data-testid="incident-detail-timeline-empty"
          className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
        >
          No audit events yet
        </p>
      ) : (
        <ul data-testid="incident-detail-timeline-list" className="flex flex-col gap-2">
          {timeline.map((event) => (
            <li
              key={event.id}
              data-testid={`incident-detail-event-${event.id}`}
              data-event-type={event.type}
              className="rounded-input border border-neutral-border bg-neutral-surface p-3 text-sm text-neutral-body"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{event.type}</span>
                <time dateTime={event.created_at} className="text-xs text-neutral-secondary">
                  {new Date(event.created_at).toISOString()}
                </time>
              </div>
              <div className="mt-1 text-xs text-neutral-secondary">
                actor: {formatActorOrAnonymous(event.actor_user_id)}
              </div>
              {Object.keys(event.payload).length > 0 && (
                <pre
                  data-testid={`incident-detail-event-${event.id}-payload`}
                  className="mt-2 overflow-x-auto rounded-input bg-neutral-page p-2 text-xs text-neutral-body"
                >
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
);

/**
 * Re-export the page's tagged errors so the test rig can assert
 * against them by import path.
 */
export { IncidentDetailNotFoundError } from "./IncidentDetailNotFoundError";
export { IncidentDetailRbacDeniedError } from "./IncidentDetailRbacDeniedError";

export type { IncidentStateChangedEvent };
