/**
 * `SeverityBanner` — Story 4.8.
 *
 * The sticky banner that surfaces UNSAFE incidents to operators and
 * viewers across the app. Mounts inside `<div data-testid="severity-banner-slot" />`
 * in `AppShell.tsx:89` — the slot was reserved since Story 1.2b
 * for Epic 4 to fill.
 *
 * Read-only surface. Renders ONLY when `useSeverityBanner().criticalCount > 0`.
 * One summary banner per page (not one per incident) — the count is
 * the load-bearing signal; the detail page is one click away for
 * per-incident context.
 *
 * Visual contract:
 *   - Critical-tinted bar (`border-severity-critical-value` + `bg-severity-critical-bg`
 *     + `text-severity-critical-text`).
 *   - Heading `"1 unsafe incident"` (singular) or `"N unsafe incidents"` (plural).
 *   - Body: when count === 1, a short preview line `"Latest: <device> · <metric> · <value>"`.
 *     When count > 1, a "View all" `<a href="/incidents">` link.
 *   - `role="alert"` on the wrapper + `aria-live="polite"` on the
 *     body copy. Matches the 2.9 `ConnectionStateBanner` a11y pattern.
 *
 * NO motion (no fade-in, no pulse). `prefers-reduced-motion` compliance
 * matches the 2.9 banner (Epic 6.3 retro covered it).
 *
 * NO button — the state machine does NOT allow `UNSAFE → acknowledge`
 * (`transitions.ts:92` + `transitions.spec.ts:127` pin the cell as
 * INVALID). An inline Acknowledge button would always 409 from the
 * UNSAFE state — a broken-UX surface. The operator dismisses the
 * banner by resolving the incident from the Kanban (the only valid
 * verb from UNSAFE). See spec Design Notes for the full rationale.
 *
 * Tailwind-class constraint: every class string here is a literal.
 * Story 2.8's `VG-1` lesson — the JIT scanner matches complete
 * literals only; template-literal interpolation would silently
 * leave the class out of the bundle.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";

import { useSeverityBanner } from "./useSeverityBanner";

/** Pluralization helper — "1 unsafe incident" vs "N unsafe incidents". */
const formatHeading = (count: number): string =>
  count === 1 ? "1 unsafe incident" : `${count} unsafe incidents`;

/** Body line for a single-incident banner — device preview.
 *  `deviceLabel` is the device's human name (joined from the
 *  device roster cache, falls back to `Unnamed device` when the
 *  cache hasn't loaded — see `useSeverityBanner.deviceNameById`).
 *  UUID fallback would still surface the noise this fix removed.
 */
const formatSingleBody = (incident: IncidentPayload, deviceLabel: string): string =>
  `Latest: ${deviceLabel} \u00b7 ${incident.metric} \u00b7 ${incident.value}`;

export const SeverityBanner = () => {
  const { criticalCount } = useSeverityBanner();

  // Zero-count → no DOM. The slot in AppShell stays mounted; the
  // banner itself returns null. Matches 2.9's ConnectionStateBanner
  // contract: banner shape is conditional, slot is unconditional.
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

/**
 * `SeverityBannerBody` — the body copy + optional "View all" link.
 * Extracted as a sub-component so the heading + body each get a
 * stable `data-testid` (tests assert the body separately from the
 * heading) and the conditional link rendering stays out of the
 * main banner's JSX.
 */
const SeverityBannerBody = ({ count }: { readonly count: number }) => {
  // `unsafeIncidents` is sourced via a second call to the same hook
  // — this is fine because TanStack Query deduplicates by key, and
  // both calls hit the same cached projection. We re-read here so
  // the body can show the most-recent incident's preview without
  // threading it through props from the parent.
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
