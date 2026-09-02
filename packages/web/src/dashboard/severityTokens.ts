/**
 * Shared severity → Tailwind utility class + glyph lookup. The
 * dashboard paints severity-coloured surfaces in three places (map
 * markers, KPI cards, live-readings row); centralising the lookup
 * means a future token rename propagates by construction. Uses the
 * `value` slot of each severity token (the `fill` slot collides with
 * the CSS `background-color: fill` shorthand).
 */
import type { MapSeverity } from "@surakkha/shared/dashboard";

export const SEVERITY_CLASS: Record<MapSeverity, string> = {
  healthy: "bg-severity-healthy-value",
  warning: "bg-severity-warning-value",
  critical: "bg-severity-critical-value",
  offline: "bg-severity-offline-value",
};

/** Severity → glyph (a redundant non-colour cue per UX-DR-3). */
export const SEVERITY_GLYPH: Record<MapSeverity, string> = {
  healthy: "\u2713",
  warning: "\u25B2",
  critical: "\u25CF",
  offline: "\u2014",
};
