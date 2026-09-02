/**
 * Sticky global banner that surfaces UNSAFE incidents to
 * operators and viewers across the app. Renders one summary
 * per page (count is the load-bearing signal); `role="alert"`
 * on the wrapper + `aria-live="polite"` on the body copy.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";

import { useSeverityBanner } from "./useSeverityBanner";

const formatHeading = (count: number): string =>
  count === 1 ? "1 unsafe incident" : `${count} unsafe incidents`;

const formatSingleBody = (incident: IncidentPayload, deviceLabel: string): string =>
  `Latest: ${deviceLabel} \u00b7 ${incident.metric} \u00b7 ${incident.value}`;

export const SeverityBanner = () => {
  const { criticalCount } = useSeverityBanner();

  if (criticalCount === 0) {
    return null;
  }

  return (
    <div
      data-testid="severity-banner"
      role="alert"
      className="border-b border-severity-critical-value bg-severity-critical-bg px-6 py-3 text-severity-critical-text"
    >
      <p data-testid="severity-banner-heading" className="text-sm font-semibold">
        {formatHeading(criticalCount)}
      </p>
      <p data-testid="severity-banner-body" aria-live="polite" className="text-sm">
        <SeverityBannerBody count={criticalCount} />
      </p>
    </div>
  );
};

const SeverityBannerBody = ({ count }: { readonly count: number }) => {
  const { unsafeIncidents, deviceNameById } = useSeverityBanner();

  if (count === 1) {
    const incident = unsafeIncidents[0];
    if (incident === undefined) return null;
    return <>{formatSingleBody(incident, deviceNameById(incident.device_id))}</>;
  }

  return (
    <a data-testid="severity-banner-view-all" href="/incidents" className="underline">
      View all
    </a>
  );
};
