/**
 * `TopBar` — sticky 56px-tall header. Hamburger (visible < 1024px),
 * brand mark + wordmark, placeholder-only search, NotificationBell
 * slot, and the UserMenu identity slot. Visual contract:
 * DESIGN.md §TopBar.
 */
import { NotificationBell } from "../notifications/NotificationBell";

import { UserMenu } from "./UserMenu";

const TOPBAR_HEIGHT_PX = 56;
const BRAND_GRADIENT =
  "linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)"; /* color.primary_gradient */

interface TopBarProps {
  readonly onHamburger: () => void;
  /**
   * Called when the user selects "Sign out" from the UserMenu.
   * The TopBar doesn't navigate directly — it signals upward — so
   * the parent (AppShell) owns the router-aware redirect to
   * `/login`. Decoupling keeps the TopBar unit-testable without a
   * `<BrowserRouter />`.
   */
  readonly onSignOut: () => void;
}

export const TopBar = ({ onHamburger, onSignOut }: TopBarProps) => (
  <header
    data-testid="topbar"
    // `fixed` (rather than `sticky`) pins the topbar to the viewport
    // for the same reason the sidebar uses fixed: predictable layout
    // that doesn't share a scroll context with the document. The
    // `<main>` clears this chrome with `pt-[56px]`.
    className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 bg-neutral-surface px-4 shadow-elevation-topbar lg:px-6"
    style={{ height: `${TOPBAR_HEIGHT_PX}px` }}
  >
    <button
      type="button"
      aria-label="Open navigation"
      data-testid="topbar-hamburger"
      onClick={onHamburger}
      className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-input text-neutral-body hover:bg-neutral-page lg:hidden"
    >
      <span aria-hidden className="block h-0.5 w-5 bg-current" />
      <span aria-hidden className="mt-1 block h-0.5 w-5 bg-current" />
      <span aria-hidden className="mt-1 block h-0.5 w-5 bg-current" />
    </button>

    <div className="flex items-center gap-2">
      <div
        aria-hidden
        className="flex size-8 items-center justify-center rounded-input text-white"
        style={{
          backgroundImage: BRAND_GRADIENT,
          borderRadius: "8px",
        }}
      >
        <span className="font-bold">S</span>
      </div>
      <span className="font-semibold text-md text-neutral-body">Surakkha</span>
    </div>

    <div className="ml-6 hidden flex-1 md:block">
      <input
        type="search"
        placeholder="Search"
        aria-label="Search"
        className="h-9 w-full max-w-md rounded-input bg-neutral-page px-3 text-md outline-none focus:ring-2 focus:ring-primary"
      />
    </div>

    <div className="ml-auto flex items-center gap-3">
      <div data-testid="notification-bell-slot">
        <NotificationBell />
      </div>
      <div data-testid="user-menu-slot" className="h-10 border-l border-neutral-border pl-3">
        <UserMenu onSignOut={onSignOut} />
      </div>
    </div>
  </header>
);

export const TOPBAR_HEIGHT = TOPBAR_HEIGHT_PX;
