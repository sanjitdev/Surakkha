/**
 * KPI card. Renders the saturated severity palette + motion tokens
 * (critical pulse on `severity === "critical"`).
 *
 * DESIGN.md §Components: "20px padding, elevation.card shadow,
 * severity stripe on the left (4px critical / 2px warning / 3px
 * healthy), label / 40px numeral / 44px for critical / sub".
 *
 * Typography: DESIGN.md §Typography pins KPI numerals at 700
 * (`font-bold`) and page titles at 700 — earlier revisions used 600
 * (`font-semibold`), which read as slightly anaemic against the
 * saturated severity palette. The base `.metric-card` class in
 * `index.css` already supplies `box-shadow: elevation.card`, so
 * adding `shadow-elevation-card` here would double the shadow stack
 * (the card would look heavier than the spec).
 */
import { type ReactNode } from "react";

export type KpiSeverity = "healthy" | "warning" | "critical" | "offline";

export interface KpiStatProps {
  readonly severity: KpiSeverity;
  readonly label: string;
  readonly value: ReactNode;
  readonly sub?: ReactNode;
}

const SEVERITY_CLASS: Record<KpiSeverity, { card: string; numeral: string; pulse: string }> = {
  healthy: {
    card: [
      "border-l-3",
      "border-severity-healthy-value",
      "bg-severity-healthy-bg",
      "text-severity-healthy-text",
    ].join(" "),
    numeral: "text-kpi-numeral",
    pulse: "",
  },
  warning: {
    card: [
      "border-l-2",
      "border-severity-warning-value",
      "bg-severity-warning-bg",
      "text-severity-warning-text",
    ].join(" "),
    numeral: "text-kpi-numeral",
    pulse: "",
  },
  critical: {
    card: [
      "border-l-4",
      "border-severity-critical-value",
      "bg-severity-critical-bg",
      "text-severity-critical-text",
      "animate-critical-pulse",
    ].join(" "),
    numeral: "text-kpi-numeral-critical",
    pulse: "animate-critical-pulse",
  },
  offline: {
    card: [
      "border-l-3",
      "border-severity-offline-value",
      "bg-severity-offline-bg",
      "text-severity-offline-text",
    ].join(" "),
    numeral: "text-kpi-numeral",
    pulse: "",
  },
};

const baseCardClass = [
  "metric-card",
  "border",
  "border-neutral-border",
  "rounded-card",
  "p-density-card",
  "flex",
  "flex-col",
  "gap-2",
].join(" ");

export const KpiStat = ({ severity, label, value, sub }: KpiStatProps) => {
  const sc = SEVERITY_CLASS[severity];
  return (
    <div data-testid="kpi-stat" className={`${baseCardClass} ${sc.card}`}>
      <span data-testid="kpi-stat-label" className="text-sm font-medium uppercase tracking-wide">
        {label}
      </span>
      <span data-testid="kpi-stat-numeral" className={`font-bold tabular-nums ${sc.numeral}`}>
        {value}
      </span>
      {sub !== undefined ? (
        <span data-testid="kpi-stat-sub" className="text-xs text-neutral-secondary">
          {sub}
        </span>
      ) : null}
    </div>
  );
};
