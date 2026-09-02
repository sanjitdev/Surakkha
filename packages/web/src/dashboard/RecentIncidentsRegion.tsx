/**
 * `RecentIncidentsRegion` — dashboard's calm summary of the last 24
 * hours of incidents. No action affordances (Kanban is the action
 * surface); empty-state copy is fixed ("No incidents in the last 24
 * hours.") and never animated.
 */
import { type RecentIncidentsResponse } from "@surakkha/shared/dashboard";

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
      <header>
        <h2 className="text-md font-semibold text-neutral-body">Recent Incidents</h2>
      </header>
      {isEmpty ? (
        <p
          data-testid="dashboard-recent-incidents-empty"
          className="mt-3 rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
        >
          No incidents in the last 24 hours.
        </p>
      ) : (
        <ul data-testid="dashboard-recent-incidents-list" className="mt-3 flex flex-col gap-2">
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
