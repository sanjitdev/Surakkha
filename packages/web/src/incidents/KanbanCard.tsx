/**
 * Minimal preview card for the Kanban board (severity left-stripe +
 * state label + opened_at + metric + value + assignee). Read-only;
 * the optional `onClick` slot is the detail-page navigation hook.
 *
 * DESIGN.md §Components:
 *   - radius 10px (`rounded-card`, not `rounded-input` 8px)
 *   - 20px card-internal padding (`p-density-card`, not `p-3` 12px)
 *   - severity left-stripe (4px critical / 2px warning / 3px healthy)
 *   - "id + severity + age + assignee"
 *   - critical pulse on fresh critical cards (1500ms heartbeat)
 *
 * Earlier revisions used `rounded-input` + `p-3` (Kanban density),
 * missed the left-stripe, and skipped the critical pulse — the
 * card read as a flat list row instead of a severity surface.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";

export const SEVERITY_DOT_BG: Record<IncidentPayload["severity"], string> = {
  info: "bg-severity-healthy-value",
  warning: "bg-severity-warning-value",
  critical: "bg-severity-critical-value",
};

export const SEVERITY_LABEL: Record<IncidentPayload["severity"], string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

export const STATE_LABEL: Record<IncidentPayload["state"], string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  INSPECTING: "Inspecting",
  SAFE: "Safe",
  UNSAFE: "Unsafe",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
  REOPENED: "Reopened",
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 604_800_000;
const BUCKETS_PER_MINUTE = 60;
const ISO_DATE_PREFIX_LENGTH = 10;

const RELATIVE_THRESHOLDS_MS: ReadonlyArray<readonly [number, string]> = [
  [MS_PER_MINUTE, "s"],
  [MS_PER_HOUR, "min"],
  [MS_PER_DAY, "h"],
  [MS_PER_WEEK, "d"],
];

const formatRelativeOpenedAt = (iso: string, nowMs: number): string => {
  const opened = Date.parse(iso);
  if (Number.isNaN(opened)) return iso;
  const delta = nowMs - opened;
  if (delta < 0) return iso;
  for (const [thresholdMs, suffix] of RELATIVE_THRESHOLDS_MS) {
    if (delta < thresholdMs) {
      const n = Math.max(1, Math.floor(delta / (thresholdMs / BUCKETS_PER_MINUTE)));
      return `${n}${suffix} ago`;
    }
  }
  return new Date(opened).toISOString().slice(0, ISO_DATE_PREFIX_LENGTH);
};

const SHORT_ID_LENGTH = 8;

const SEVERITY_LEFT_STRIPE: Record<IncidentPayload["severity"], string> = {
  info: "border-l-3 border-severity-healthy-value",
  warning: "border-l-2 border-severity-warning-value",
  critical: "border-l-4 border-severity-critical-value animate-critical-pulse",
};

export interface KanbanCardProps {
  readonly incident: IncidentPayload;
  /** Test seam — pin the clock for relative-time formatting. */
  readonly now?: number;
  /** Optional detail-page navigation callback. */
  readonly onClick?: (id: string) => void;
}

export const KanbanCard = ({ incident, now, onClick }: KanbanCardProps) => {
  const dot = SEVERITY_DOT_BG[incident.severity];
  const sevLabel = SEVERITY_LABEL[incident.severity];
  const stateLabel = STATE_LABEL[incident.state];
  const relative = formatRelativeOpenedAt(incident.opened_at, now ?? Date.now());
  const assignee =
    incident.assignee_user_id === null
      ? "Unassigned"
      : incident.assignee_user_id.slice(0, SHORT_ID_LENGTH);

  return (
    <article
      data-testid={`kanban-card-${incident.id}`}
      data-severity={incident.severity}
      data-state={incident.state}
      className={`metric-card rounded-card border-neutral-border p-density-card flex flex-col gap-2 text-sm text-neutral-body ${SEVERITY_LEFT_STRIPE[incident.severity]}`}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            data-testid="kanban-card-severity-dot"
            className={`inline-block size-2 rounded-full ${dot}`}
          />
          <span className="font-semibold">{sevLabel}</span>
          <span className="text-neutral-secondary">· {stateLabel}</span>
        </span>
        <time
          dateTime={incident.opened_at}
          data-testid="kanban-card-opened-at"
          className="shrink-0 text-xs text-neutral-secondary"
        >
          {relative}
        </time>
      </header>
      <p className="text-neutral-secondary">
        <span data-testid="kanban-card-metric" className="font-medium text-neutral-body">
          {incident.metric}
        </span>
        <span className="text-neutral-secondary"> · </span>
        <span data-testid="kanban-card-value">{incident.value}</span>
      </p>
      <footer className="flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-secondary">
          ID{" "}
          <span className="font-medium text-neutral-body">
            {incident.id.slice(0, SHORT_ID_LENGTH)}
          </span>
        </span>
        <span
          data-testid="kanban-card-assignee"
          className={`rounded-pill px-2 py-0.5 ${
            incident.assignee_user_id === null
              ? "bg-neutral-bg text-neutral-secondary"
              : "bg-severity-healthy-bg text-severity-healthy-text"
          }`}
        >
          {assignee}
        </span>
      </footer>
      {onClick !== undefined && (
        <button
          type="button"
          data-testid="kanban-card-detail-button"
          onClick={() => onClick(incident.id)}
          className="self-start text-xs font-medium text-primary underline"
        >
          View detail
        </button>
      )}
    </article>
  );
};
