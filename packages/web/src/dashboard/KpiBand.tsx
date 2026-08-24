/**
 * `KpiBand` — Story 2.6.
 *
 * Top row of the operator dashboard. Renders four `KpiStat` cards in the
 * same `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` pattern used by the
 * `/severity-cards` route (`main.tsx` SeverityCards, lines 102-105).
 *
 * Counts are derived from the latest reading per device using the
 * placeholder severity function (`@surakkha/shared/dashboard`). The
 * placeholder returns `healthy | warning | critical`; `offline` is
 * resolved by absence — a device with no latest reading row is not
 * represented in the count (the dashboard does not have a `/api/
 * devices` listing yet so offline cannot be derived; see
 * `useDashboardReadings.summarizeReadings` for the explicit pin).
 *
 * The four cards are always present (no conditional rendering) so the
 * DOM order and tab-navigation reach are stable from cold load through
 * realtime invalidation. The numeral reflects the count; the `sub`
 * surfaces a calm hint when the count is zero so the band never looks
 * broken.
 */
import {
  KpiStat,
  type KpiStatProps,
} from "../components/KpiStat";

import { type KpiCounts } from "./useDashboardReadings";

interface KpiBandProps {
  readonly counts: KpiCounts;
}

const SUB_TEXT: Record<keyof KpiCounts, string> = {
  healthy: "within range",
  warning: "de-bounced",
  critical: "out of range",
  offline: "no signal",
};

const buildCard = (
  severity: KpiStatProps["severity"],
  label: string,
  value: number,
): KpiStatProps => ({
  severity,
  label,
  value,
  sub: value === 0 ? "—" : SUB_TEXT[severity],
});

export const KpiBand = ({ counts }: KpiBandProps) => (
  <div
    data-testid="dashboard-kpi-band"
    data-region="kpi-band"
    className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2"
  >
    <KpiStat {...buildCard("healthy", "Healthy", counts.healthy)} />
    <KpiStat {...buildCard("warning", "Warning", counts.warning)} />
    <KpiStat {...buildCard("critical", "Critical", counts.critical)} />
    <KpiStat {...buildCard("offline", "Offline", counts.offline)} />
  </div>
);