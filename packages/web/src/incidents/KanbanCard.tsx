/**
 * Minimal preview card for the Kanban board (severity dot +
 * state label + opened_at + metric + value). Read-only; the
 * optional `onClick` slot is the detail-page navigation hook.
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

  return (
    <article
      data-testid={`kanban-card-${incident.id}`}
      data-severity={incident.severity}
      data-state={incident.state}
      className="rounded-input border border-neutral-border bg-neutral-surface p-3 text-sm text-neutral-body"
    >
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            data-testid="kanban-card-severity-dot"
            className={`inline-block size-2 rounded-full ${dot}`}
          />
          <span className="font-medium">{sevLabel}</span>
          <span className="text-neutral-secondary">· {stateLabel}</span>
        </span>
        <time
          dateTime={incident.opened_at}
          data-testid="kanban-card-opened-at"
          className="text-xs text-neutral-secondary"
        >
          {relative}
        </time>
      </header>
      <p className="mt-2 text-neutral-secondary">
        <span data-testid="kanban-card-metric">{incident.metric}</span>
        <span className="text-neutral-secondary"> · </span>
        <span data-testid="kanban-card-value">{incident.value}</span>
      </p>
      {onClick !== undefined && (
        <button
          type="button"
          data-testid="kanban-card-detail-button"
          className="mt-2 text-xs text-primary underline"
          onClick={() => onClick(incident.id)}
        >
          View detail
        </button>
      )}
    </article>
  );
};
