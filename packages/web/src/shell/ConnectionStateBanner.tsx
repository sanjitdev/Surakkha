/**
 * `ConnectionStateBanner` — Story 2.9.
 *
 * Surfaces the realtime stream's offline state to the operator.
 * Renders only when `useConnectionState().isConnected === false`.
 * Lives in `AppShell`'s `connection-state-banner-slot` above the
 * `severity-banner-slot` (Epic 4 reserves that one for incident
 * severity; the connection signal gets operator priority).
 *
 * Visual contract:
 *   - Heading `"Reconnecting…"` (no animation; pops in / out).
 *   - Body `"Showing last-known data."`
 *   - `aria-live="polite"` on the body ONLY (UX-DR-6 noise reduction;
 *     a screen reader announces the message once without interrupting
 *     the current reading). No `role="status"` on the wrapper — that
 *     role implies `aria-live="polite"` already, so adding it to a
 *     wrapper AND a child produces a double-announcement in some
 *     screen readers. The body alone is the announcer.
 *   - `border-severity-warning-value` + `bg-severity-warning-bg`
 *     tokens. Connection-state is "warning, not critical" — degraded
 *     but the system is still alive (cache + REST still respond).
 *
 * Why no animation: the spec says the banner pops in / out instantly
 * to keep the visual change obvious. `prefers-reduced-motion` is
 * already a no-op for this surface.
 *
 * Tailwind-class constraint: every class string here is a literal.
 * Story 2.8's `VG-1` lesson — the JIT scanner matches complete
 * literals only; template-literal interpolation would silently
 * leave the class out of the bundle.
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
      <p
        aria-live="polite"
        data-testid="connection-state-banner-body"
        className="text-sm"
      >
        Showing last-known data.
      </p>
    </div>
  );
};
