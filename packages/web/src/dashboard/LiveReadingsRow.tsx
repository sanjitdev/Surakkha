/**
 * `LiveReadingsRow` — one row in the dashboard's live-readings table
 * (device, metric, severity, age). Replays the transient
 * `animate-live-pulse` glow on every `server_received_at` advancement;
 * `prefers-reduced-motion` is handled at the CSS layer. Read-only —
 * no per-row action affordances (Epic 4 territory).
 */
import {
  breachedMetric,
  type LatestReadingPayload,
  placeholderSeverity,
} from "@surakkha/shared/dashboard";
import { useEffect, useRef } from "react";

import { SEVERITY_CLASS, SEVERITY_GLYPH } from "./severityTokens";

interface LiveReadingsRowProps {
  readonly reading: LatestReadingPayload;
}

const JUST_NOW_THRESHOLD_MS = 5_000;
const MINUTES_THRESHOLD_MS = 60_000;
const MS_PER_SECOND = 1_000;
const MISSING_AGE_GLYPH = "\u2014";
const DEVICE_ID_SHORT_PREFIX_LENGTH = 8;

const formatAge = (serverReceivedAt: string, now: number): string => {
  const ts = Date.parse(serverReceivedAt);
  if (!Number.isFinite(ts)) return MISSING_AGE_GLYPH;
  // Clamp clock-skew negative deltas to zero.
  const deltaMs = Math.max(0, now - ts);
  if (deltaMs < JUST_NOW_THRESHOLD_MS) return "just now";
  if (deltaMs < MINUTES_THRESHOLD_MS) {
    return `${Math.floor(deltaMs / MS_PER_SECOND)}s ago`;
  }
  const minutes = Math.floor(deltaMs / MINUTES_THRESHOLD_MS);
  return `${minutes}m ago`;
};

// LITERAL class string — must not be built via template-literal
// interpolation (Tailwind's JIT scanner only sees complete literals).
const CRITICAL_BORDER_CLASS =
  "border-l-4 border-severity-critical-value border-r border-t border-b border-severity-critical-value shadow-elevation-row-critical";

const SEVERITY_LABEL: Record<ReturnType<typeof placeholderSeverity>, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
};

/** Per-metric display precision (WHO / BSTI / BSTI bands). */
const METRIC_PRECISION: Record<string, number> = {
  ph: 1,
  tds_ppm: 0,
  turbidity_ntu: 2,
  temp_c: 1,
  chlorine_ppm: 2,
  water_level_cm: 0,
};

const metricPrecision = (key: string): number => METRIC_PRECISION[key] ?? 1;

/** First breached metric on critical; fallback to pH otherwise. */
const formatMetricCell = (
  reading: LatestReadingPayload,
): { readonly key: string; readonly value: string } => {
  const breach = placeholderSeverity(reading) === "critical" ? breachedMetric(reading) : null;
  const metricKey = breach !== null ? breach.key : ("ph" as const);
  const rawValue = breach !== null ? breach.value : reading.metrics[metricKey];
  const valueText = Number.isFinite(rawValue)
    ? rawValue.toFixed(metricPrecision(metricKey))
    : "\u2014";
  return { key: metricKey, value: valueText };
};

export const LiveReadingsRow = ({ reading }: LiveReadingsRowProps) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const prevServerReceivedAtRef = useRef<string | null>(null);
  const firstMountRef = useRef<boolean>(true);

  const severity = placeholderSeverity(reading);

  // Replay the 1200ms pulse on every `server_received_at` advancement.
  // The keyframe is one-shot — re-adding the same class doesn't replay
  // it; we toggle remove → reflow → add to force the restart.
  useEffect(() => {
    const node = rowRef.current;
    if (node === null) return;
    if (prevServerReceivedAtRef.current === reading.server_received_at) {
      return;
    }
    prevServerReceivedAtRef.current = reading.server_received_at;
    // Skip the initial mount — a freshly-mounted row should appear
    // statically; the operator reads it before animation begins.
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }
    node.classList.remove("animate-live-pulse");
    void node.offsetWidth;
    node.classList.add("animate-live-pulse");
  }, [reading.server_received_at]);

  const ageText = formatAge(reading.server_received_at, Date.now());
  const severityClass = SEVERITY_CLASS[severity];
  const severityLabel = SEVERITY_LABEL[severity];
  const severityGlyph = SEVERITY_GLYPH[severity];
  const metricCell = formatMetricCell(reading);

  const isCritical = severity === "critical";
  const rowAriaLive = isCritical ? "polite" : undefined;

  return (
    <div
      ref={rowRef}
      role="row"
      data-testid={`dashboard-live-readings-row-${reading.device_id}`}
      data-device-id={reading.device_id}
      data-severity={severity}
      className={`flex items-center gap-4 px-3 py-2 text-sm ${
        isCritical ? CRITICAL_BORDER_CLASS : "border border-neutral-border"
      } bg-neutral-surface text-neutral-body`}
    >
      <div role="cell" className="flex-1 min-w-0">
        <p className="truncate font-semibold text-neutral-body">
          {reading.name ?? "Unnamed device"}
        </p>
        <p className="font-mono text-xs text-neutral-secondary truncate">
          {reading.device_id.slice(0, DEVICE_ID_SHORT_PREFIX_LENGTH)}
        </p>
      </div>
      <div role="cell" className="w-32 shrink-0">
        <span className="font-mono text-sm text-neutral-body">
          {metricCell.key}={metricCell.value}
        </span>
      </div>
      <div
        role="cell"
        aria-label={`${severity} severity`}
        aria-live={rowAriaLive}
        className="flex items-center gap-2 w-32 shrink-0"
      >
        <span
          aria-hidden="true"
          className={`inline-flex size-4 items-center justify-center rounded-full ${severityClass} text-[10px] font-bold leading-none text-white`}
        >
          {severityGlyph}
        </span>
        <span className="text-xs uppercase tracking-wide text-neutral-secondary">
          {severityLabel}
        </span>
      </div>
      <div
        role="cell"
        data-testid={`dashboard-live-readings-row-age-${reading.device_id}`}
        className="w-20 shrink-0 text-right text-xs text-neutral-secondary"
      >
        {ageText}
      </div>
    </div>
  );
};
