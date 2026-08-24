/**
 * `RecentIncidentsRegion` — Story 2.6.
 *
 * Read-only preview of the Recent Incidents feed. Story 4.4 expands
 * this into the full Epic-4 card affordance (device + severity +
 * metric + value + opened-at + primary action); this story ships the
 * static empty-state copy per AC4 plus a calm list rendering so a
 * populated feed is observable end-to-end without a workflow action.
 *
 * Per AC4 the empty-state copy is exactly "No incidents in the last
 * 24 hours." and is never animated or flashing. Per AC6 the region
 * renders no action buttons — the Recent Incidents surface is
 * read-only in Story 2.6.
 */
import {
  type RecentIncidentsResponse,
} from "@surakkha/shared/dashboard";

interface RecentIncidentsRegionProps {
  readonly incidents: RecentIncidentsResponse["incidents"];
}

const SEVERITY_LABEL: Record<RecentIncidentsResponse["incidents"][number]["severity"], string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

export const RecentIncidentsRegion = ({ incidents }: RecentIncidentsRegionProps) => {
  const isEmpty = incidents.length === 0;
  return (
    <section
      data-testid="dashboard-recent-incidents-region"
      data-region="recent-incidents"
      aria-label="Recent Incidents"
      className="rounded-card border border-neutral-border bg-neutral-surface p-density-card"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-md font-semibold text-neutral-body">Recent Incidents</h2>
        <span className="text-xs text-neutral-secondary">
          Read-only preview
        </span>
      </header>
      {isEmpty ? (
        <p
          data-testid="dashboard-recent-incidents-empty"
          className="mt-3 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
        >
          No incidents in the last 24 hours.
        </p>
      ) : (
        <ul
          data-testid="dashboard-recent-incidents-list"
          className="mt-3 flex flex-col gap-2"
        >
          {incidents.map((i) => (
            <li
              key={i.id}
              data-testid={`dashboard-recent-incident-${i.id}`}
              data-severity={i.severity}
              className="rounded-input border border-neutral-border px-3 py-2 text-sm text-neutral-body"
            >
              <span className="font-medium">{SEVERITY_LABEL[i.severity]}</span>
              <span className="text-neutral-secondary"> · {i.metric}</span>
              <span className="text-neutral-secondary"> · {i.value}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};