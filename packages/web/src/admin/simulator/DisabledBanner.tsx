/**
 * DisabledBanner — Story 2.5.
 *
 * Calm "simulator is not configured" state for the admin tab. The
 * banner copy is pinned: "Simulator disabled. Set SIMULATOR_SECRET."
 * No call-to-action button (the secret lives in the operator's
 * `.env`, not the SPA).
 *
 * Styling uses the severity-warning token triplet
 * (`severity.warning.{bg, value, text}`) — the same surface as
 * `ConnectionStateBanner` for the "Reconnecting…" semantic, so a
 * reader who has seen one banner recognises the other. Critique
 * `/impeccable critique packages/web` (2026-08-31) P2 finding:
 * this banner was previously keyed off an ad-hoc orange palette
 * (#FFF7ED/#FDBA74/#7C2D12) — now collapsed to the project tokens.
 */
export const DISABLED_BANNER_COPY = "Simulator disabled. Set SIMULATOR_SECRET.";

export const DisabledBanner = () => (
  <div
    data-testid="simulator-disabled-banner"
    role="status"
    aria-live="polite"
    className="rounded-card border border-severity-warning-value bg-severity-warning-bg p-4 text-md text-severity-warning-text"
  >
    {DISABLED_BANNER_COPY}
  </div>
);
