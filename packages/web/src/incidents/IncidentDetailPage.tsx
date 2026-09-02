/**
 * `IncidentDetailPage` — the `/incidents/:id` detail view.
 *
 * Renders the parent incident row + the audit timeline. Subscribes
 * to `incident:state_changed` via `useIncidentDetailSocket`; the
 * page-level transitions (Acknowledge / Assign / Submit Result /
 * Reopen) go through per-verb `use*Mutation` hooks that wire the
 * page-local toast queue.
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

import { ErrorState } from "./ErrorState";
import {
  formatActorOrAnonymous,
  formatAssigneeLabel,
  formatDateOrDash,
  formatTimelineEventSummary,
  formatTimelineTimestamp,
} from "./format";
import { IncidentDetailActions } from "./IncidentDetailActions";
import { IncidentDetailNotFoundError } from "./IncidentDetailNotFoundError";
import { IncidentDetailRbacDeniedError } from "./IncidentDetailRbacDeniedError";
import { SEVERITY_DOT_BG, SEVERITY_LABEL, STATE_LABEL } from "./KanbanCard";
import { ToastRegion, useToasts } from "./toast";
import { useAcknowledgeMutation } from "./useAcknowledgeMutation";
import { useAssignMutation } from "./useAssignMutation";
import { useDetailActionHandlers } from "./useDetailActionHandlers";
import {
  ReadingsCsvExportRbacDeniedError,
  useDownloadReadingsCsvMutation,
} from "./useDownloadReadingsCsvMutation";
import {
  type IncidentDetailRowQuery,
  useIncidentDetailPageQueries,
} from "./useIncidentDetailPageQueries";
import { incidentDetailQueryKey, useIncidentDetailSocket } from "./useIncidentDetailSocket";
import { useReopenMutation } from "./useReopenMutation";
import { useSubmitResultMutation } from "./useSubmitResultMutation";

/**
 * Loading skeleton — page-local because no other page reuses this
 * exact surface.
 */
const IncidentDetailSkeleton = () => (
  <div data-testid="incident-detail-loading" className="flex flex-col gap-4">
    <p className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary">
      Loading incident...
    </p>
  </div>
);

const ISO_DATE_PREFIX_LENGTH = 10;

/**
 * Renders the row + audit timeline for a known id, plus the
 * page-local toast region.
 */
export const IncidentDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const viewerRole = useCurrentRole();
  // Sourced from the access token's `sub` claim; synchronous read
  // so the action-slot gate is consistent across renders.
  const viewerUserId = readUserIdFromStore();
  const { toasts, pushToast } = useToasts();
  const acknowledgeMutation = useAcknowledgeMutation(id ?? "");
  const assignMutation = useAssignMutation(id ?? "");
  const submitResultMutation = useSubmitResultMutation(id ?? "");
  const reopenMutation = useReopenMutation(id ?? "");
  // CSV export lives on the page (not in `useDetailActionHandlers`)
  // because the success path is a browser download, not a row-query
  // invalidation.
  const exportCsvMutation = useDownloadReadingsCsvMutation();

  useIncidentDetailSocket(id ?? "");

  const { rowQuery, incident, timeline } = useIncidentDetailPageQueries(id);

  // Wire each verb's success/error to the page-local toast queue.
  const { handleAcknowledge, handleAssign, handleSubmitResult, handleReopen } =
    useDetailActionHandlers({
      acknowledgeMutation,
      assignMutation,
      submitResultMutation,
      reopenMutation,
      pushToast,
    });

  // CSV export: branch on the permanent-denial error so RBAC
  // failures don't show "Try again" (the role will never gain the
  // permission).
  // rather than the classifier's generic "Try again" copy.
  const handleExportCsv = (): void => {
    if (incident === undefined) return;
    exportCsvMutation.mutate(
      { deviceId: incident.device_id },
      {
        onSuccess: () => pushToast("success", "Downloaded readings export"),
        onError: (err) => {
          if (err instanceof ReadingsCsvExportRbacDeniedError) {
            pushToast("error", "Not authorized to export readings");
            return;
          }
          pushToast("error", err.message);
        },
      },
    );
  };

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
        isExporting={exportCsvMutation.isPending}
        onAcknowledge={handleAcknowledge}
        onAssign={handleAssign}
        onSubmitResult={handleSubmitResult}
        onReopen={handleReopen}
        onExportCsv={handleExportCsv}
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
  isExporting,
  onAcknowledge,
  onAssign,
  onSubmitResult,
  onReopen,
  onExportCsv,
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
  readonly isExporting: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
  readonly onReopen: (reason: string) => void;
  readonly onExportCsv: () => void;
  readonly onRetry: () => void;
}) => {
  if (rowQuery.isError && rowQuery.error instanceof IncidentDetailNotFoundError) {
    return <NotFound />;
  }
  if (rowQuery.isError && rowQuery.error instanceof IncidentDetailRbacDeniedError) {
    // Story 6.11 — thread the role so the back-link picks the
    // role-aware destination.
    return <RbacDenied viewerRole={viewerRole} />;
  }
  if (rowQuery.isError) {
    return (
      <ErrorState
        testIdPrefix="incident-detail"
        message="Failed to load incident"
        onRetry={onRetry}
      />
    );
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
      isExporting={isExporting}
      onAcknowledge={onAcknowledge}
      onAssign={onAssign}
      onSubmitResult={onSubmitResult}
      onReopen={onReopen}
      onExportCsv={onExportCsv}
    />
  );
};

/**
 * The detail-page body (incident row + audit timeline). Extracted
 * from `IncidentDetailPage` so the page component stays under the
 * `max-lines-per-function: 200` lint ceiling; renders the row header,
 * the field `<dl>`, the action region, and the audit timeline.
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
  isExporting,
  onAcknowledge,
  onAssign,
  onSubmitResult,
  onReopen,
  onExportCsv,
}: {
  readonly incident: IncidentPayload;
  readonly timeline: readonly IncidentEventPayload[];
  readonly viewerRole: Role | null;
  readonly viewerUserId: string | null;
  readonly isAck: boolean;
  readonly isAssign: boolean;
  readonly isSubmitting: boolean;
  readonly isReopening: boolean;
  readonly isExporting: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
  readonly onReopen: (reason: string) => void;
  readonly onExportCsv: () => void;
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
          className={`inline-block size-2 rounded-full ${SEVERITY_DOT_BG[incident.severity]}`}
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
      isExporting={isExporting}
      onAcknowledge={onAcknowledge}
      onAssign={onAssign}
      onSubmitResult={onSubmitResult}
      onReopen={onReopen}
      onExportCsv={onExportCsv}
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

export type { IncidentStateChangedEvent };
