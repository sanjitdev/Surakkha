/**
 * `ConnectionStateBanner` — renders the "Reconnecting…" + "Showing
 * last-known data." warning ribbon when `useConnectionState().isConnected
 * === false`. Visual + a11y contract lives in DESIGN.md.
 */
import { useConnectionState } from "../realtime/useConnectionState";

export const ConnectionStateBanner = () => {
  const { isConnected } = useConnectionState();

  if (isConnected) {
    return null;
  }

  return (
    <div
      data-testid="connection-state-banner"
      className="border-b border-severity-warning-value bg-severity-warning-bg px-6 py-2 text-severity-warning-text"
    >
      <p className="text-sm font-semibold">{"Reconnecting\u2026"}</p>
      <p aria-live="polite" data-testid="connection-state-banner-body" className="text-sm">
        Showing last-known data.
      </p>
    </div>
  );
};
