/**
 * `ageFormat` — shared "X seconds/minutes ago" formatter for the
 * dashboard's two time-sensitive surfaces (Live Readings row + Recent
 * Incidents row). Centralising the formatter means a future change to
 * the relative-time strings (e.g. switch to `<n> min` shorthand, add
 * hours, support locales) propagates by construction.
 *
 * The threshold ladder matches the spec: ≤5s = "just now", <60s =
 * "<n>s ago", ≥60s = "<n>m ago". Negative deltas (clock skew between
 * the device and the server) clamp to zero so the formatter never
 * emits "−1s ago".
 */

const JUST_NOW_THRESHOLD_MS = 5_000;
const MINUTES_THRESHOLD_MS = 60_000;
const MS_PER_SECOND = 1_000;
const MISSING_AGE_GLYPH = "\u2014";

export const formatAge = (serverReceivedAt: string, now: number): string => {
  const ts = Date.parse(serverReceivedAt);
  if (!Number.isFinite(ts)) return MISSING_AGE_GLYPH;
  const deltaMs = Math.max(0, now - ts);
  if (deltaMs < JUST_NOW_THRESHOLD_MS) return "just now";
  if (deltaMs < MINUTES_THRESHOLD_MS) {
    return `${Math.floor(deltaMs / MS_PER_SECOND)}s ago`;
  }
  const minutes = Math.floor(deltaMs / MINUTES_THRESHOLD_MS);
  return `${minutes}m ago`;
};
