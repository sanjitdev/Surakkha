/**
 * `KpiBand` — top row of the dashboard. Four `KpiStat` cards, always
 * present (no conditional rendering) so DOM order + tab navigation
 * stay stable across realtime invalidations. The `sub` slot shows a
 * calm hint when the count is zero so the band never looks broken.
 */
import { KpiStat, type KpiStatProps } from "../components/KpiStat";

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
