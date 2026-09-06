/**
 * `RecentIncidentsRegion` — dashboard's calm summary of the last 24
 * hours of incidents. No action affordances (Kanban is the action
 * surface); empty-state copy is fixed ("No incidents in the last 24
 * hours.") and never animated.
 *
 * Row treatment mirrors `LiveReadingsRow` so both severity-aware
 * dashboard tables read as the same product:
 *
 *   - severity left-stripe (4px critical / 2px warning / 3px info)
 *   - severity-coloured dot + redundant glyph (UX-DR-3)
 *   - `metric=value` line in monospaced tabular numerals
 *   - right-aligned age badge ("just now" / "<n>s ago" / "<n>m ago")
 *
 * `info` is a dashboard-only severity (the wire schema has no offline
 * bucket for incidents), so the row palette uses the three documented
 * stripes; no `offline` glyph is needed here.
 */
import { type RecentIncidentsResponse } from "@surakkha/shared/dashboard";

import { RegionCard } from "../components/RegionCard";

import { formatAge } from "./ageFormat";

interface RecentIncidentsRegionProps {
  readonly incidents: RecentIncidentsResponse["incidents"];
}

type IncidentSeverity = RecentIncidentsResponse["incidents"][number]["severity"];

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

// Incident severity has three buckets (no `offline` in the wire
// schema). The dot uses the same severity-`value` colour as the
// other dashboard surfaces for visual lockstep.
const DOT_CLASS: Record<IncidentSeverity, string> = {
  critical: "bg-severity-critical-value",
  warning: "bg-severity-warning-value",
  info: "bg-severity-healthy-value",
};

// Stripe width mirrors LiveReadingsRow: critical 4px, warning 2px,
// everything else 3px. Kept as a literal so Tailwind's JIT scanner
// sees the full class string (template-literal interpolation breaks
// the scanner).
const STRIPE_CLASS: Record<IncidentSeverity, string> = {
  critical: "border-l-4 border-severity-critical-value",
  warning: "border-l-2 border-severity-warning-value",
  info: "border-l-3 border-severity-healthy-value",
};

// Glyph per incident severity. The shared `SEVERITY_GLYPH` map in
// `severityTokens` is keyed on `MapSeverity` (which includes
// `offline` but not `info`); the incident set is a strict subset of
// three buckets, so we keep a small dedicated map here instead of
// widening the shared one.
const GLYPH: Record<IncidentSeverity, string> = {
  critical: "\u25CF",
  warning: "\u25B2",
  info: "\u2713",
};

const formatMetricValue = (metric: string, value: number): string => {
  // Same per-metric precision LiveReadingsRow uses, so the same metric
  // (pH, tds_ppm, ...) reads the same number of decimals across both
  // surfaces. Unknown metrics fall through to a sensible default.
  const PRECISION: Record<string, number> = {
    ph: 1,
    tds_ppm: 0,
    turbidity_ntu: 2,
    temp_c: 1,
    chlorine_ppm: 2,
    water_level_cm: 0,
  };
  const decimals = PRECISION[metric] ?? 1;
  return Number.isFinite(value) ? value.toFixed(decimals) : "\u2014";
};

const IncidentRow = ({
  incident,
}: {
  readonly incident: RecentIncidentsResponse["incidents"][number];
}) => {
  const ageText = formatAge(incident.opened_at, Date.now());
  return (
    <li
      data-testid={`dashboard-recent-incident-${incident.id}`}
      data-severity={incident.severity}
      className={`flex items-center gap-4 rounded-input border border-neutral-border bg-neutral-surface px-3 py-2 text-sm text-neutral-body ${STRIPE_CLASS[incident.severity]}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden
          className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full ${DOT_CLASS[incident.severity]} text-[10px] font-bold leading-none text-white`}
        >
          {GLYPH[incident.severity]}
        </span>
        <span className="font-medium uppercase tracking-wide text-xs text-neutral-body">
          {SEVERITY_LABEL[incident.severity]}
        </span>
        <span className="truncate font-mono text-sm tabular-nums text-neutral-body">
          {incident.metric}={formatMetricValue(incident.metric, incident.value)}
        </span>
      </div>
      <span
        data-testid={`dashboard-recent-incident-age-${incident.id}`}
        className="shrink-0 text-xs text-neutral-secondary"
      >
        {ageText}
      </span>
    </li>
  );
};

export const RecentIncidentsRegion = ({ incidents }: RecentIncidentsRegionProps) => {
  const isEmpty = incidents.length === 0;
  return (
    <RegionCard
      title="Recent Incidents"
      region="recent-incidents"
      testId="dashboard-recent-incidents-region"
      rightSlot={
        <span className="rounded-pill bg-neutral-page px-2 py-0.5 text-xs text-neutral-secondary">
          Last 24 hours
        </span>
      }
    >
      {isEmpty ? (
        <p
          data-testid="dashboard-recent-incidents-empty"
          className="mt-3 rounded-input border border-dashed border-neutral-border py-8 text-center text-sm text-neutral-secondary"
        >
          No incidents in the last 24 hours.
        </p>
      ) : (
        <ul data-testid="dashboard-recent-incidents-list" className="mt-3 flex flex-col gap-2">
          {incidents.map((i) => (
            <IncidentRow key={i.id} incident={i} />
          ))}
        </ul>
      )}
    </RegionCard>
  );
};
