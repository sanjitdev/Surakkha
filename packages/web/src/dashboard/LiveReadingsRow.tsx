/**
 * `LiveReadingsRow` — Story 2.8.
 *
 * Single row in the dashboard's live-readings table. Receives a
 * `LatestReadingPayload` and renders four columns: device, metric,
 * severity (dot + label), and age (relative text). The row owns
 * the transient 1200ms `animate-live-pulse` glow that replays on
 * every `reading:new` for the affected device_id — the parent
 * region stays mounted across socket invalidations (Story 2.6 AC5
 * contract) and the row's `server_received_at` ref drives the
 * replay.
 *
 * Severity contract:
 *   - Computed via `placeholderSeverity(reading)` — the same helper
 *     the KPI band and the map markers consume. The row never
 *     reads `Device.name` so there is no `offline` bucket here; a
 *     device whose latest reading lapsed past `OFFLINE_THRESHOLD_MS`
 *     does not get a row (the readings cache keeps the freshest
 *     payload per device).
 *   - Critical rows carry the UX-DR-2 visual hierarchy: 4px critical
 *     left border + 3px critical inner border + 8px outer critical
 *     glow + `aria-live="polite"`.
 *   - All rows announce via screen-reader-friendly labels: severity
 *     cells carry `aria-label="{sev} severity"` so the operator's
 *     AT reports the right bucket.
 *
 * Pulse-replay contract:
 *   - `animate-live-pulse` is a one-shot keyframe at `index.css:142`
 *     (`animation: surakkha-live-pulse 1200ms ease-out 1`). The
 *     browser does NOT replay the animation when the same class is
 *     re-applied to a node that already owns it. To replay on every
 *     `server_received_at` advancement we hold a `ref<HTMLDivElement>`
 *     and toggle the class via `classList.remove → classList.add` in
 *     a `useEffect` keyed off `server_received_at`. That fires the
 *     keyframe once per render where `server_received_at` advanced.
 *   - `prefers-reduced-motion` is already handled at the CSS layer
 *     (`index.css:188`) — the row renders without the glow when the
 *     operator has the preference set, but the age reset still
 *     happens so the data surface is consistent.
 *
 * Read-only contract (Story 2.8 AC4):
 *   - The row contains no buttons. Viewer / Operator / Admin all see
 *     the same surface; severity rules apply identically across
 *     roles. Epic 4 owns the per-row action affordances.
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

/**
 * Format the relative age — pure function. "just now" within the
 * first 5 s, "<n>s ago" up to a minute, "<n>m ago" beyond. Capped
 * at the minutes granularity so a stale row never shows "2h 17m
 * ago" — the offline threshold is the more meaningful signal (Story
 * 2.7's `isOffline()`).
 */
const JUST_NOW_THRESHOLD_MS = 5_000;
const MINUTES_THRESHOLD_MS = 60_000;
const MS_PER_SECOND = 1_000;
const MISSING_AGE_GLYPH = "\u2014";
const DEVICE_ID_SHORT_PREFIX_LENGTH = 8;

const formatAge = (serverReceivedAt: string, now: number): string => {
  const ts = Date.parse(serverReceivedAt);
  if (!Number.isFinite(ts)) return MISSING_AGE_GLYPH;
  // Clock skew (api clock ahead of web clock) can produce a negative
  // delta; clamp to zero so the row still reports "just now" rather
  // than a negative-seconds string.
  const deltaMs = Math.max(0, now - ts);
  if (deltaMs < JUST_NOW_THRESHOLD_MS) return "just now";
  if (deltaMs < MINUTES_THRESHOLD_MS) {
    return `${Math.floor(deltaMs / MS_PER_SECOND)}s ago`;
  }
  const minutes = Math.floor(deltaMs / MINUTES_THRESHOLD_MS);
  return `${minutes}m ago`;
};

/**
 * Critical-row border + glow hierarchy (UX-DR-2 + DESIGN.md
 * §Components: LiveReadingRow). 4px critical left border, 1px
 * calm inner border, row-scale critical glow via the
 * `shadow-elevation-row-critical` token (8px spread — the banner
 * variant spreads 24px which is too wide for a single row's
 * bounding box).
 *
 * Note: these class strings are literal — they must not be built via
 * template-literal interpolation. Tailwind's JIT content scanner matches
 * complete string literals only; interpolated classes (e.g.,
 * `border-l-[${n}px]`) are invisible to the scanner and the
 * corresponding CSS rules never ship. See Verification-Gap
 * review VG-1.
 */
const CRITICAL_BORDER_CLASS =
  "border-l-4 border-severity-critical-value border-r border-t border-b border-severity-critical-value shadow-elevation-row-critical";

/**
 * Map severity → severity label. Mirrors the Epic 2 §UX label
 * surface. `warning` is reserved (Epic 3 rule engine) but rendered
 * here so the contract is forward-compatible.
 */
const SEVERITY_LABEL: Record<ReturnType<typeof placeholderSeverity>, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
};

/**
 * Format the metric cell. Per Story 2.8's I/O matrix default
 * (the "Ask First" question resolved to "first breached metric
 * on critical, fallback to pH when healthy / warning"):
 *
 *   - `severity === "critical"` → first metric outside its
 *     `PLACEHOLDER_HEALTHY_RANGES` (from `breachedMetric()`,
 *     shared with the map's popup per Story 2.7).
 *   - `severity !== "critical"` → `ph` (the first metric in the
 *     wire surface, always present). Operators scan the live-
 *     readings table for out-of-range values; ph is the canonical
 *     "what is the water doing" signal.
 *
 * Falls back to "—" when the value is non-finite (NaN / ±Infinity)
 * or the metric key is missing from the payload.
 */
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

/**
 * Per-metric display precision. The wire surface floats; the
 * displayed value rounds to whatever makes the column legible.
 *   - ph: 1dp (canonical WHO band is 6.5–8.5)
 *   - tds_ppm: 0dp (canonical BSTI ceiling is 500)
 *   - turbidity_ntu: 2dp (low values, sub-NTU precision matters)
 *   - temp_c: 1dp
 *   - chlorine_ppm: 2dp (low values, sub-ppm precision matters)
 *   - water_level_cm: 0dp (centimetre resolution)
 */
const METRIC_PRECISION: Record<string, number> = {
  ph: 1,
  tds_ppm: 0,
  turbidity_ntu: 2,
  temp_c: 1,
  chlorine_ppm: 2,
  water_level_cm: 0,
};

const metricPrecision = (key: string): number => METRIC_PRECISION[key] ?? 1;

export const LiveReadingsRow = ({ reading }: LiveReadingsRowProps) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const prevServerReceivedAtRef = useRef<string | null>(null);
  const firstMountRef = useRef<boolean>(true);

  // Severity is the row's severity bucket. The `placeholderSeverity`
  // helper returns the three-bucket enum (no `offline`); a row is
  // `critical` when ANY metric is outside its healthy band, including
  // non-finite values (e.g., `NaN` — the random-failure scenario).
  const severity = placeholderSeverity(reading);

  // Replay the transient 1200ms pulse on every `server_received_at`
  // advancement. The keyframe lives in `index.css:133` and a fresh
  // `classList.add` is required (a no-op add does NOT replay a
  // one-shot CSS animation). The two-tick toggle guarantees the
  // browser sees the keyframe restart even if the value rapid-fires.
  useEffect(() => {
    const node = rowRef.current;
    if (node === null) return;
    if (prevServerReceivedAtRef.current === reading.server_received_at) {
      return;
    }
    prevServerReceivedAtRef.current = reading.server_received_at;
    // Skip the very first render — the row should not pulse on
    // initial mount (Story 2.6 AC3: empty state never animates, and
    // a fresh row arriving from the REST cold-load is its own
    // "first render" event the operator needs to see statically).
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }
    node.classList.remove("animate-live-pulse");
    // Force a reflow so the next add restarts the animation.
    void node.offsetWidth;
    node.classList.add("animate-live-pulse");
  }, [reading.server_received_at]);

  const ageText = formatAge(reading.server_received_at, Date.now());
  const severityClass = SEVERITY_CLASS[severity];
  const severityLabel = SEVERITY_LABEL[severity];
  const severityGlyph = SEVERITY_GLYPH[severity];
  const metricCell = formatMetricCell(reading);

  // Aria-live only fires for critical rows so screen-reader users
  // hear about an escalation but do not get a noise stream of
  // healthy refreshes.
  const isCritical = severity === "critical";
  const rowAriaLive = isCritical ? "polite" : undefined;

  // The row's outer surface is a flex container with the four
  // columns side by side; the cell borders stack so the critical
  // 4px-left border sits outside the 3px inner border instead of
  // replacing it. The `bg` slot stays on `neutral-surface` per the
  // existing card surface pattern (LiveReadingsRow reuses the same
  // metric-card surface family).
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
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${severityClass} text-[10px] font-bold leading-none text-white`}
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
