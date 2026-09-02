/**
 * `DisabledBanner` — calm "simulator is not configured" state.
 * Copy is pinned; the secret lives in the operator's `.env`, so
 * there is no in-product call-to-action.
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
