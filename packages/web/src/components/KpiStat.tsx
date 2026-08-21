/**
 * KpiStat — Surakkha web (Story 1.9).
 *
 * A KPI card that renders the saturated severity palette (Story 1.2a)
 * and the motion tokens (DESIGN.md §Components, §Layout & Spacing).
 * The component is the visible proof that the design system is wired
 * to the authenticated canvas — without it, the tokens would be
 * defined but never rendered.
 *
 * Token consumption (no duplicated literals — every value is a token):
 *   - severity.<sev>.value / text / fill / bg / glow
 *   - radius.card, density.card_padding, elevation.card
 *   - fontSize.kpi-numeral (40px) / kpi-numeral-critical (44px)
 *   - motion.critical_pulse_ms (1500ms via .animate-critical-pulse)
 *
 * The component is intentionally tiny: a surface card, a left stripe,
 * a label, a numeral, and a sub-label. Every future KPI overlay (live
 * pulse, hover, etc.) extends this base without changing the token
 * contract.
 */
import { type ReactNode } from "react";

export type KpiSeverity = "healthy" | "warning" | "critical" | "offline";

export interface KpiStatProps {
  readonly severity: KpiSeverity;
  readonly label: string;
  readonly value: ReactNode;
  readonly sub?: ReactNode;
}

/**
 * Tailwind className per severity. Each entry is the exact token
 * the design mandates — no inline literals.
 *
 * - card border: 1px neutral
 * - left stripe: severity value (4px critical, 3px healthy, 2px warning, 3px offline)
 * - background: severity bg
 * - shadow: elevation.card
 * - critical pulse: animate-critical-pulse (1500ms)
 * - numeral: kpi-numeral-critical (44px) for critical, kpi-numeral (40px) otherwise
 */
const SEVERITY_CLASS: Record<
  KpiSeverity,
  { card: string; numeral: string; pulse: string }
> = {
  healthy: {
    card: [
      "border-l-3",
      "border-severity-healthy-value",
      "bg-severity-healthy-bg",
      "text-severity-healthy-text",
      "shadow-elevation-card",
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
      "shadow-elevation-card",
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
      "shadow-elevation-card",
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
      "shadow-elevation-card",
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
      <span
        data-testid="kpi-stat-label"
        className="text-sm font-medium uppercase tracking-wide"
      >
        {label}
      </span>
      <span
        data-testid="kpi-stat-numeral"
        className={`font-semibold tabular-nums ${sc.numeral}`}
      >
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
