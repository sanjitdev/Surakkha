/**
 * `IncidentDetailPage` — Story 4.4 + Story 4.5.
 *
 * The detail view at `/incidents/:id`. Renders the parent incident
 * row + the IncidentEvent audit timeline. Subscribes to
 * `incident:state_changed` and mutates the cached row in place;
 * resolved incidents STAY visible (different from the Kanban's
 * drop-on-RESOLVED — the detail page surfaces the resolved row as
 * a first-class citizen).
 *
 * Story 4.5 layers in the Acknowledge button + a page-local toast
 * surface. The button is gated by `actionSlotsFor` (single source
 * of truth across the Kanban card affordance contract + the detail
 * page action region). Click → `POST /api/incidents/:id/acknowledge`
 * → toast feedback. The mutation does NOT mutate the cache
 * directly; on success it invalidates the row query so the existing
 * `useIncidentDetailSocket` subscriber reconciles via the next
 * socket event.
 *
 * Wire shape (canonical from `@surakkha/shared/incident`):
 *
 *   GET  /api/incidents/:id                  → IncidentPayload
 *   GET  /api/incidents/:id/events           → { events: IncidentEventPayload[] }
 *   POST /api/incidents/:id/acknowledge      → IncidentPayload (200) / error envelope (4xx/5xx)
 *
 * The two reads run in parallel; each has its own cache key
 * (`["incidents", "detail", id]` for the row;
 * `["incidents", "detail", id, "events"]` for the timeline).
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
  type IncidentPayload,
  type InspectionOutcome,
} from "@surakkha/shared/incident";
import { type Role } from "@surakkha/shared/rbac";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { NotFound } from "../access/NotFound";
import { RbacDenied } from "../access/RbacDenied";
import { AttachmentsSection } from "../attachments/AttachmentsSection";
import { useCurrentRole } from "../auth/CurrentRoleContext";
import { readUserIdFromStore } from "../auth/tokenStore";

import { IncidentDetailActions } from "./IncidentDetailActions";
import { IncidentDetailNotFoundError } from "./IncidentDetailNotFoundError";
import { IncidentDetailRbacDeniedError } from "./IncidentDetailRbacDeniedError";
import { SEVERITY_DOT_BG, SEVERITY_LABEL, STATE_LABEL } from "./KanbanCard";
import { ToastRegion, useToasts } from "./toast";
import { useAcknowledgeMutation } from "./useAcknowledgeMutation";
import { useAssignMutation } from "./useAssignMutation";
import { useDetailActionHandlers } from "./useDetailActionHandlers";
import {
  type IncidentDetailRowQuery,
  useIncidentDetailPageQueries,
} from "./useIncidentDetailPageQueries";
import { incidentDetailQueryKey, useIncidentDetailSocket } from "./useIncidentDetailSocket";
import { useReopenMutation } from "./useReopenMutation";
import { useSubmitResultMutation } from "./useSubmitResultMutation";

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

/**
 * Format an actor for the audit-timeline prose. The legacy helper
 * rendered the raw UUID, which read as noise ("Assigned to
 * f4a1c2b3 by 7d8e9f0a…") to the Operator. Critique 2026-08-31
 * valley finding: UUIDs erode trust at the highest-stakes row of
 * the Operator's day.
 *
 * Resolution: when the actor is the viewer, render "you" (the
 * common case — the Operator's own actions). When the actor is
 * null, render "anonymous" (legacy fallback — system events).
 * Otherwise render "another {role}" inferred from the verb, since
 * the state machine implies the actor role:
 *   - `submit_result` → Technician (only Technicians submit
 *     inspection results; a non-Technician's submit_result is a
 *     403 the api never produces, so the inference is safe).
 *   - `acknowledge` / `assign` / `resolve` / `reopen` /
 *     `invalid_transition_attempt` → Operator or Admin (both
 *     roles hold these verbs; the prose reads "another operator"
 *     because 95% of these come from the Operator).
 *
 * Without a per-user role lookup on the wire, the per-event
 * timeline can't disambiguate "another operator" from "an Admin".
 * Story 5.x surfaces `display_name` + role from the user roster
 * and this helper is the seam that consumes it.
 */
const ACTOR_LABEL_BY_VERB: Record<string, string> = {
  acknowledge: "another operator",
  assign: "another operator",
  submit_result: "a Technician",
  resolve: "another operator",
  reopen: "another operator",
  invalid_transition_attempt: "another operator",
};
const formatActorOrAnonymous = (
  id: string | null,
  verb: string,
  viewerUserId: string | null,
): string => {
  if (id === null) return "anonymous";
  if (id === viewerUserId) return "you";
  return ACTOR_LABEL_BY_VERB[verb] ?? "another operator";
};

/** Assignee surface — assignees are always Technicians (the only
 *  role the state machine accepts for INSPECTING ownership).
 *  Same `you`/`anonymous` semantics as the timeline helper but the
 *  "another" fallback is always "a Technician". */
const formatAssigneeLabel = (id: string | null, viewerUserId: string | null): string => {
  if (id === null) return "unassigned";
  if (id === viewerUserId) return "you";
  return "a Technician";
};

const ISO_DATE_PREFIX_LENGTH = 10;

/**
 * Human-readable relative timestamp for the audit timeline.
 * Buckets mirror `KanbanCard`'s `formatRelativeOpenedAt` so the two
 * surfaces read in lock-step, but anchored to the EVENT's
 * `created_at` (not the incident's `opened_at`) so the operator can
 * see at a glance which action was recent and which was days old.
 *
 * Pure function — the test rig passes `now` to pin the bucket.
 */
const formatTimelineTimestamp = (iso: string): string => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const delta = Date.now() - at;
  if (delta < 0) return iso;
  if (delta < MS_PER_MINUTE) return "just now";
  if (delta < MS_PER_HOUR) return `${Math.floor(delta / MS_PER_MINUTE)} min ago`;
  if (delta < MS_PER_DAY) return `${Math.floor(delta / MS_PER_HOUR)} h ago`;
  if (delta < MS_PER_WEEK) return `${Math.floor(delta / MS_PER_DAY)} d ago`;
  return new Date(at).toISOString().slice(0, ISO_DATE_PREFIX_LENGTH);
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 604_800_000;

/**
 * The InspectionOutcome wire form is the canonical vocabulary
 * (SAFE / UNSAFE / MONITORING) — kept in caps on the timeline so
 * the operator can scan a busy incident and match the headline to
 * the action they took in the field.
 */
const OUTCOME_LABEL: Record<InspectionOutcome, string> = {
  SAFE: "Marked safe",
  UNSAFE: "Marked unsafe",
  MONITORING: "Marked for monitoring",
};

/**
 * Render the audit-timeline summary line for one event.
 *
 * Replaces the previous `<pre>{JSON.stringify(payload)}</pre>` block,
 * which surfaced raw JSON to the named key-journey protagonist
 * (Rahim, an Operator). The summary follows clarify.md's message
 * hierarchy: lead with the verb, then by whom, then supporting
 * context (assignee / reason / attempted transition). The verbose
 * event type and actor id remain in a secondary line below for
 * debugging — but never as JSON.
 *
 * Payload access is defensive: the schema is `Record<string, unknown>`
 * (open shape — see `@surakkha/shared/incident`). Unexpected payloads
 * fall through to a calm "no additional details" line, NOT a
 * raw-JSON dump, so the timeline never teaches the operator to
 * read JSON.
 *
 * Implementation note: per-event-type helpers are extracted so the
 * dispatcher's cyclomatic complexity stays under the `complexity: 10`
 * ESLint ceiling. Each helper closes over the `actor` string built
 * once by the dispatcher (and never has to read `event.payload`).
 */
const readStringField = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" ? value : null;
};

const formatAcknowledgeSummary = (actor: string): string => `Acknowledged by ${actor}.`;

const formatAssignSummary = (actor: string, payload: Record<string, unknown>): string => {
  const assignee = readStringField(payload, "assigneeUserId") ?? "an unassigned technician";
  return `Assigned to ${assignee} by ${actor}.`;
};

const formatSubmitResultSummary = (actor: string, payload: Record<string, unknown>): string => {
  const { outcome } = payload;
  const outcomeLabel =
    outcome === "SAFE" || outcome === "UNSAFE" || outcome === "MONITORING"
      ? OUTCOME_LABEL[outcome]
      : "Inspection result recorded";
  return `${outcomeLabel} by ${actor}.`;
};

const formatResolveSummary = (actor: string): string => `Resolved by ${actor}.`;

const formatReopenSummary = (actor: string, payload: Record<string, unknown>): string => {
  const reason = readStringField(payload, "reason");
  const reasonText = reason !== null && reason.length > 0 ? reason : "no reason given";
  return `Reopened by ${actor} — "${reasonText}".`;
};

const formatInvalidTransitionSummary = (
  actor: string,
  payload: Record<string, unknown>,
): string => {
  const fromText = readStringField(payload, "from") ?? "the current state";
  const attemptedText = readStringField(payload, "attempted") ?? "an action";
  return `Rejected: ${attemptedText} from ${fromText} is not a valid transition.`;
};

const formatTimelineEventSummary = (
  event: IncidentEventPayload,
  viewerUserId: string | null,
): string => {
  const { payload } = event;
  const actor = formatActorOrAnonymous(event.actor_user_id, event.type, viewerUserId);
  switch (event.type) {
    case "acknowledge":
      return formatAcknowledgeSummary(actor);
    case "assign":
      return formatAssignSummary(actor, payload);
    case "submit_result":
      return formatSubmitResultSummary(actor, payload);
    case "resolve":
      return formatResolveSummary(actor);
    case "reopen":
      return formatReopenSummary(actor, payload);
    case "invalid_transition_attempt":
      return formatInvalidTransitionSummary(actor, payload);
  }
};

/**
 * Render the incident row + timeline for a known id. Mounts the
 * realtime subscription (per-page lifecycle). Two TanStack
 * Queries (row + timeline); each has its own cache key so the
 * socket mutator updates the row independently of the timeline
 * fetch.
 *
 * Story 4.5 adds:
 *   - `useToasts()` — page-local toast queue mounted as
 *     `<ToastRegion />` at the page root (top of the return tree).
 *   - `useAcknowledgeMutation(id)` — TanStack mutation wrapping
 *     `POST /api/incidents/:id/acknowledge`. Success → success toast;
 *     failure → classified error toast. The mutation invalidates the
 *     row cache on success; the cache mutation IS the optimistic
 *     surface via the socket event.
 */
export const IncidentDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const viewerRole = useCurrentRole();
  // `viewerUserId` is sourced from the access token's `sub` claim
  // (mirroring how the api's `authorize` middleware reads
  // `req.user.id`). Story 4.7 needs this so the detail page can
  // pass it to `actionSlotsFor`'s third argument — the INSPECTING
  // ownership gate (`slotsForInspecting` returns `["submit-result"]`
  // only when `assignee_user_id === viewerUserId`). Synchronous
  // read so the slot gate is consistent across the first render and
  // re-renders; mirrors how `useCurrentRole` works for `viewerRole`.
  const viewerUserId = readUserIdFromStore();
  const { toasts, pushToast } = useToasts();
  const acknowledgeMutation = useAcknowledgeMutation(id ?? "");
  const assignMutation = useAssignMutation(id ?? "");
  const submitResultMutation = useSubmitResultMutation(id ?? "");
  const reopenMutation = useReopenMutation(id ?? "");

  useIncidentDetailSocket(id ?? "");

  const { rowQuery, incident, timeline } = useIncidentDetailPageQueries(id);

  // Success + error handlers for each mutation, wired through
  // a shared factory so the page-level `IncidentDetailPage`
  // stays under the lint complexity ceiling. Each handler mirrors
  // the same pattern: forward the verb-specific payload to
  // `mutate()`, surface success + error toasts via the page's
  // `pushToast` queue. Toast copy is per-verb; the factory
  // centralizes the structure.
  const { handleAcknowledge, handleAssign, handleSubmitResult, handleReopen } =
    useDetailActionHandlers({
      acknowledgeMutation,
      assignMutation,
      submitResultMutation,
      reopenMutation,
      pushToast,
    });

  return (
    <>
      <IncidentDetailDispatch
        rowQuery={rowQuery}
        incident={incident}
        timeline={timeline}
        viewerRole={viewerRole}
        viewerUserId={viewerUserId}
        isAck={acknowledgeMutation.isPending}
        isAssign={assignMutation.isPending}
        isSubmitting={submitResultMutation.isPending}
        isReopening={reopenMutation.isPending}
        onAcknowledge={handleAcknowledge}
        onAssign={handleAssign}
        onSubmitResult={handleSubmitResult}
        onReopen={handleReopen}
        onRetry={() => {
          void queryClient.invalidateQueries({
            queryKey: incidentDetailQueryKey(id ?? ""),
          });
        }}
      />
      <ToastRegion toasts={toasts} />
    </>
  );
};

/**
 * State-dispatch: pick the right render branch based on the
 * row query's error/success state. Extracted from
 * `IncidentDetailPage` to keep its cyclomatic complexity under
 * the `complexity: 10` lint ceiling.
 *
 * Story 4.5 threads `viewerRole`, `isAck`, and
 * `onAcknowledge` so the body can render `<IncidentDetailActions />`
 * (visible only when `actionSlotsFor` returns the `acknowledge`
 * slot for the current viewer).
 */
const IncidentDetailDispatch = ({
  rowQuery,
  incident,
  timeline,
  viewerRole,
  viewerUserId,
  isAck,
  isAssign,
  isSubmitting,
  isReopening,
  onAcknowledge,
  onAssign,
  onSubmitResult,
  onReopen,
  onRetry,
}: {
  readonly rowQuery: IncidentDetailRowQuery;
  readonly incident: IncidentPayload | undefined;
  readonly timeline: readonly IncidentEventPayload[];
  readonly viewerRole: Role | null;
  readonly viewerUserId: string | null;
  readonly isAck: boolean;
  readonly isAssign: boolean;
  readonly isSubmitting: boolean;
  readonly isReopening: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
  readonly onReopen: (reason: string) => void;
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
  return (
    <IncidentDetailBody
      incident={incident}
      timeline={timeline}
      viewerRole={viewerRole}
      viewerUserId={viewerUserId}
      isAck={isAck}
      isAssign={isAssign}
      isSubmitting={isSubmitting}
      isReopening={isReopening}
      onAcknowledge={onAcknowledge}
      onAssign={onAssign}
      onSubmitResult={onSubmitResult}
      onReopen={onReopen}
    />
  );
};

/**
 * The detail-page body (incident row + audit timeline). Extracted
 * from `IncidentDetailPage` so the page component stays under the
 * `max-lines-per-function: 200` lint ceiling; the body renders
 * the header (severity dot + state label), the field `<dl>`, the
 * `<IncidentDetailActions />` region (Story 4.5 — between the `<dl>`
 * and the audit timeline), and the timeline list.
 */
const IncidentDetailBody = ({
  incident,
  timeline,
  viewerRole,
  viewerUserId,
  isAck,
  isAssign,
  isSubmitting,
  isReopening,
  onAcknowledge,
  onAssign,
  onSubmitResult,
  onReopen,
}: {
  readonly incident: IncidentPayload;
  readonly timeline: readonly IncidentEventPayload[];
  readonly viewerRole: Role | null;
  readonly viewerUserId: string | null;
  readonly isAck: boolean;
  readonly isAssign: boolean;
  readonly isSubmitting: boolean;
  readonly isReopening: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
  readonly onReopen: (reason: string) => void;
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
        {formatAssigneeLabel(incident.assignee_user_id, viewerUserId)}
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

    <IncidentDetailActions
      incident={incident}
      viewerRole={viewerRole}
      viewerUserId={viewerUserId}
      isAck={isAck}
      isAssign={isAssign}
      isSubmitting={isSubmitting}
      isReopening={isReopening}
      onAcknowledge={onAcknowledge}
      onAssign={onAssign}
      onSubmitResult={onSubmitResult}
      onReopen={onReopen}
    />

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
              <div className="flex items-start justify-between gap-3">
                <p
                  data-testid={`incident-detail-event-${event.id}-summary`}
                  className="text-neutral-body"
                >
                  {formatTimelineEventSummary(event, viewerUserId)}
                </p>
                <time
                  dateTime={event.created_at}
                  data-testid={`incident-detail-event-${event.id}-at`}
                  className="shrink-0 text-xs text-neutral-secondary"
                >
                  {formatTimelineTimestamp(event.created_at)}
                </time>
              </div>
              <p className="mt-1 text-xs text-neutral-secondary">
                <span data-testid={`incident-detail-event-${event.id}-type`}>{event.type}</span>
                {" · "}
                <span>{formatActorOrAnonymous(event.actor_user_id, event.type, viewerUserId)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>

    <AttachmentsSection incidentId={incident.id} />
  </div>
);

/**
 * Re-export the page's tagged errors so the test rig can assert
 * against them by import path.
 */
export { IncidentDetailNotFoundError } from "./IncidentDetailNotFoundError";
export { IncidentDetailRbacDeniedError } from "./IncidentDetailRbacDeniedError";

export type { IncidentStateChangedEvent };
