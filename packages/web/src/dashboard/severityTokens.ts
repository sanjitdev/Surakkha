/**
 * Shared severity → Tailwind utility class lookup (Story 2.8).
 *
 * The dashboard has three places that paint a severity-coloured
 * surface:
 *   - `MapView.tsx` — the map markers (`bg-severity-{sev}-value`).
 *   - `KpiBand.tsx` — the four KPI cards' left border.
 *   - `LiveReadingsRow.tsx` — the row's severity dot.
 *
 * Keeping the literal lookup in one place means a future token
 * rename propagates by construction. The `MapSeverity` enum
 * (4-bucket: healthy | warning | critical | offline) covers every
 * call site; `LiveReadingsRow` only ever sees the three-bucket
 * subset because `placeholderSeverity` never returns `offline`,
 * but the table mirrors the same enum so the file's mental model
 * is uniform.
 *
 * Story 2.7's `MapView.tsx:76` originally owned this lookup; the
 * Story 2.8 review extracted it here so both consumers stay in
 * lockstep. (The shared export also makes future Story 2.x work
 * — e.g. the Recent Incidents preview — cheap to add.)
 */
import type { MapSeverity } from "@surakkha/shared/dashboard";

export const SEVERITY_CLASS: Record<MapSeverity, string> = {
  healthy: "bg-severity-healthy-value",
  warning: "bg-severity-warning-value",
  critical: "bg-severity-critical-value",
  offline: "bg-severity-offline-value",
};

/**
 * Severity → glyph lookup (mirrors `MapView.tsx:93`). Used by the
 * row's severity dot to add a redundant non-colour cue (UX-DR-3):
 * a coloured shape carries more than one meaning-channel.
 */
export const SEVERITY_GLYPH: Record<MapSeverity, string> = {
  healthy: "\u2713",
  warning: "\u25B2",
  critical: "\u25CF",
  offline: "\u2014",
};
