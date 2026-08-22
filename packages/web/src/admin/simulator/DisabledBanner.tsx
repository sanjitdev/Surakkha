/**
 * DisabledBanner — Story 2.5.
 *
 * Calm "simulator is not configured" state for the admin tab. The
 * banner copy is pinned: "Simulator disabled. Set SIMULATOR_SECRET."
 * No call-to-action button (the secret lives in the operator's
 * `.env`, not the SPA).
 */
const BANNER_BG = "#FFF7ED"; /* warm-warning surface */
const BANNER_BORDER = "#FDBA74";
const BANNER_TEXT = "#7C2D12";

export const DISABLED_BANNER_COPY =
  "Simulator disabled. Set SIMULATOR_SECRET.";

export const DisabledBanner = () => (
  <div
    data-testid="simulator-disabled-banner"
    role="status"
    aria-live="polite"
    className="rounded-card border p-4 text-md"
    style={{
      backgroundColor: BANNER_BG,
      borderColor: BANNER_BORDER,
      color: BANNER_TEXT,
    }}
  >
    {DISABLED_BANNER_COPY}
  </div>
);
