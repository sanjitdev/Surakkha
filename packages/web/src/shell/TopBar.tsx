/**
 * TopBar — Surakkha web (Story 1.2b, 4.10).
 *
 * Visual contract: DESIGN.md §Components → `TopBar`
 * (56px tall, sticky, color.neutral.surface background, brand mark +
 * primary gradient, role pill + user avatar; elevation.topbar shadow).
 *
 * On viewports < 1024px, the AppShell reveals a hamburger button here
 * that opens the Sidebar drawer (Story 1.2b AC for < 1024px).
 *
 * Slots:
 *   - global search input (placeholder-only v1)
 *   - NotificationBell (Story 4.10 — mounts inside its own
 *     `data-testid="notification-bell-slot"` wrapper so the bell is
 *     independently swappable without disturbing the rest of the
 *     right cluster)
 *   - role pill + user avatar menu (Story 1.4)
 */
import { NotificationBell } from "../notifications/NotificationBell";

const TOPBAR_HEIGHT_PX = 56;
const TOPBAR_BG = "#FFFFFF"; /* color.neutral.surface */
const BRAND_GRADIENT =
  "linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)"; /* color.primary_gradient */

interface TopBarProps {
  readonly onHamburger: () => void;
}

export const TopBar = ({ onHamburger }: TopBarProps) => (
  <header
    data-testid="topbar"
    className="sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-6"
    style={{
      height: `${TOPBAR_HEIGHT_PX}px`,
      backgroundColor: TOPBAR_BG,
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)" /* elevation.topbar */,
    }}
  >
    {/* Hamburger — visible below 1024px (lg breakpoint). The button
        carries aria-label so screen-readers describe the toggle
        (EXPERIENCE.md §Accessibility → Tab order). */}
    <button
      type="button"
      aria-label="Open navigation"
      data-testid="topbar-hamburger"
      onClick={onHamburger}
      className="inline-flex h-9 w-9 items-center justify-center rounded-input text-neutral-body hover:bg-neutral-page lg:hidden"
    >
      <span aria-hidden className="block h-0.5 w-5 bg-current" />
      <span aria-hidden className="mt-1 block h-0.5 w-5 bg-current" />
      <span aria-hidden className="mt-1 block h-0.5 w-5 bg-current" />
    </button>

    {/* Brand mark — 32x32 rounded-8 with primary_gradient fill and a
        white "S". The mark sits next to the wordmark. */}
    <div className="flex items-center gap-2">
      <div
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-input text-white"
        style={{
          backgroundImage: BRAND_GRADIENT,
          borderRadius: "8px",
        }}
      >
        <span className="font-bold">S</span>
      </div>
      <span className="font-semibold text-md text-neutral-body">Surakkha</span>
    </div>

    {/* Search slot — placeholder-only in v1 (EXPERIENCE.md: "Receives
        a placeholder-only search input"). Filled in Story 1.7. */}
    <div className="ml-6 hidden flex-1 md:block">
      <input
        type="search"
        placeholder="Search"
        aria-label="Search"
        className="h-9 w-full max-w-md rounded-input bg-neutral-page px-3 text-md outline-none focus:ring-2 focus:ring-primary"
      />
    </div>

    {/* Right cluster — notification bell + role pill + avatar (Story 1.4
        brings the authenticated state; the bell is the first slot here
        — Story 4.10 mounts it inside its own slot wrapper for
        independent test surfacing). */}
    <div className="ml-auto flex items-center gap-3">
      {/* Story 4.10 — NotificationBell lives inside its own slot
          wrapper so the bell is independently swappable (the wrapper
          is the test seam pinned by `TopBar.spec.tsx`). NOT inside
          AppShell's slot hierarchy — TopBar is its own layout block. */}
      <div data-testid="notification-bell-slot">
        <NotificationBell />
      </div>
    </div>
  </header>
);

export const TOPBAR_HEIGHT = TOPBAR_HEIGHT_PX;
