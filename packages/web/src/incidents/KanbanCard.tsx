/**
 * `KanbanCard` — Story 4.3.
 *
 * Minimal preview card for the Kanban board. Renders the same shape
 * Epic 2's `RecentIncidentsRegion` uses (severity dot + state label
 * + opened_at + metric + value) so Story 4.4's eventual
 * `<IncidentCard />` swap is mechanical — the column container stays;
 * only the per-card component changes.
 *
 * Read-only: NO action affordances (deferred to Story 4.4). The
 * `onClick` callback is the future detail-page navigation hook;
 * 4.3 wires the slot but does not implement the route.
 *
 * Why this component is not `<IncidentCard />`: Story 4.1's
 * contract defines `<IncidentCard />` as a typed primitive that
 * renders action affordances derived from `state + role`. Story
 * 4.4 ships the actual component. 4.3 ships the static preview
 * that 4.4 will replace in-place.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";

/**
 * Severity dot palette — Story 4.4 re-exports these so the detail
 * page reuses the SAME palette without duplication. The values
 * match `tailwind.config.js` semantic tokens (primary, warning,
 * critical) so a future token rename propagates cleanly.
 */
export const SEVERITY_DOT_BG: Record<IncidentPayload["severity"], string> = {
  info: "#1E5BB8" /* primary */,
  warning: "#D97706" /* warning */,
  critical: "#DC2626" /* critical */,
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

// Named constants for the relative-time buckets (eslint
// `no-magic-numbers`). One minute / hour / day / week in ms;
// `BUCKETS_PER_MINUTE` is the per-bucket divisor (60_000 ms in
// a minute → `delta / (thresholdMs / 60)` converts the bucket
// size to a per-minute count).
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

/**
 * Best-effort relative-time formatter. Pure function; no Intl
 * dependency so the test rig (which mocks Date.now) can pin the
 * exact string.
 */
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
  /**
   * Test seam: pin the clock for relative-time formatting. Defaults
   * to `Date.now()` in production. The board passes this through
   * from the test rig when it needs to assert the exact string.
   */
  readonly now?: number;
  /**
   * Future detail-page navigation. Wired here so 4.4 can add an
   * `onClick={() => navigate(`/incidents/${incident.id}`)}` prop
   * without changing the column layout.
   */
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
      // The column React-key (set by the parent) drives React's
      // per-cell identity, not this DOM id. This card moves between
      // columns when its `projectKanbanColumn(state, severity)`
      // resolves to a new column.
      className="rounded-input border border-neutral-border bg-neutral-surface p-3 text-sm text-neutral-body"
    >
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            data-testid="kanban-card-severity-dot"
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: dot }}
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
