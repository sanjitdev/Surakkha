/**
 * Authenticated layout: connection + severity banner slots, TopBar,
 * fixed Sidebar (>= 1024px) or hamburger drawer (< 1024px), main
 * canvas with breakpoint-driven horizontal padding. Initial render
 * assumes `lg`; the resize effect upgrades / downgrades after
 * hydration.
 *
 * Layout model:
 *   - The TopBar is `position: fixed` and spans the full viewport
 *     width (56px tall, `z-30`).
 *   - The fixed Sidebar (rendered at `lg`+) is `position: fixed`,
 *     anchored to `(left: 0, top: 56px)` with `width: 240px` and
 *     `height: calc(100vh - 56px)`. It does NOT participate in the
 *     document flow, so the canvas offsets it via `lg:pl-[264px]`
 *     — that's 240px to clear the rail PLUS a 24px gutter
 *     (DESIGN.md §Layout & Spacing `lg` page gutter) so the canvas
 *     reads as "page beside rail" rather than "page flush against
 *     rail".
 *   - The `<main>` clears the TopBar with `pt-[56px]` and clears
 *     the rail with `lg:pl-[264px]`. Below `lg` the rail collapses
 *     and the canvas's `lg:pl-[264px]` flips off, so the page
 *     content reflows to full width.
 *   - The canvas provides the page gutter (DESIGN.md §Layout &
 *     Spacing: 24px / 16px / 12px per breakpoint). At `lg+` it's
 *     `pr-6` (right-only) so the `padding-left` slot stays free for
 *     the combined `lg:pl-[264px]` rail-clear + left-gutter rule —
 *     using `px-6` here would let the shorthand `padding-left`
 *     cascade-order against `lg:pl-[264px]` and leave content
 *     touching (or sliding under) the rail. At `md` / `sm` the rail
 *     is collapsed and `lg:pl-[264px]` doesn't activate, so the
 *     canvas falls back to symmetric `px-{4|3}` to keep the
 *     DESIGN.md gutter on both sides.
 *   - The banner slots stay in the document flow above the TopBar
 *     in DOM order. As the user scrolls, the banner content scrolls
 *     behind the fixed TopBar (matching the previous sticky-TopBar
 *     UX with a fixed topbar instead).
 */
import { type Role } from "@surakkha/shared/rbac";
import { type PropsWithChildren, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCurrentRole } from "../auth/CurrentRoleContext";
import { SeverityBanner } from "../incidents/SeverityBanner";

import { ConnectionStateBanner } from "./ConnectionStateBanner";
import { Sidebar } from "./Sidebar";
import { TopBar, TOPBAR_HEIGHT } from "./TopBar";

export type Breakpoint = "lg" | "md" | "sm";

const MEDIA_LG = "(min-width: 1024px)";
const MEDIA_MD = "(min-width: 768px)";

const detectBreakpoint = (): Breakpoint => {
  if (typeof window === "undefined") return "lg";
  if (window.matchMedia(MEDIA_LG).matches) return "lg";
  if (window.matchMedia(MEDIA_MD).matches) return "md";
  return "sm";
};

// Canvas horizontal padding per breakpoint (DESIGN.md §Layout &
// Spacing: 24px / 16px / 12px).
//
//   - At `lg+` we use `pr-6` (24px right gutter) + the `lg:pl-[Npx]`
//     rail-clear on the `<main>`, where `N = SIDEBAR_WIDTH_PX +
//     RAIL_GUTTER_PX` (240 + 24 = 264). The combined longhand
//     arbitrary keeps the cascade clean — there's only ever ONE
//     rule setting `padding-left` at `lg+` — AND it puts a 24px
//     gap between the rail and the page content so the canvas reads
//     as "page beside rail" rather than "page flush against rail".
//     `pr-*` is right-only so the shorthand `padding-left` from
//     `px-*` can't cascade-order against the rail-clear.
//   - At `md` / `sm` the rail is collapsed (`hidden lg:block`), so
//     the rail-clear doesn't activate and the canvas reflows to
//     full width. We restore symmetric `px-*` here so the canvas
//     keeps the DESIGN.md page gutter on BOTH sides (previous
//     `pr-*`-only variant left content hugging the left viewport
//     edge on mobile / tablet).
const CANVAS_PADDING_CLASS: Record<Breakpoint, string> = {
  lg: "pr-6",
  md: "px-4",
  sm: "px-3",
};
const SIDEBAR_WIDTH_PX = 240;
// Gap between the fixed Sidebar and the canvas content at `lg+`.
// Equals the DESIGN.md page gutter at `lg` so the left and right
// gutters read as visually equal (`lg:pl-[SIDEBAR_WIDTH_PX +
// RAIL_GUTTER_PX]` = 264px → 240px rail-clear + 24px breathing room).
const RAIL_GUTTER_PX = 24;
const CANVAS_TOP_OFFSET_PX = TOPBAR_HEIGHT;

interface AppShellProps extends PropsWithChildren {
  readonly currentRole?: Role | null;
}

export const AppShell = ({ currentRole, children }: AppShellProps) => {
  const contextRole = useCurrentRole();
  const effectiveRole = currentRole ?? contextRole;
  const navigate = useNavigate();
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("lg");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sign-out: the UserMenu clears the token store; we route back to
  // /login. Routed here (not in the UserMenu) so the TopBar stays
  // unit-testable without a router.
  const handleSignOut = useCallback((): void => {
    navigate("/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    const update = () => setBreakpoint(detectBreakpoint());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div data-testid="app-shell" className="min-h-screen bg-neutral-page">
      {/* Connection banner mounts above severity banner — realtime
          signal gets operator priority when both are visible. */}
      <div data-testid="connection-state-banner-slot">
        <ConnectionStateBanner />
      </div>
      <div data-testid="severity-banner-slot">
        <SeverityBanner />
      </div>

      <TopBar onHamburger={() => setDrawerOpen(true)} onSignOut={handleSignOut} />

      {/* Sidebar is `position: fixed` (see Sidebar.tsx) so it sits
          outside the document flow. It still needs to render in the
          tree so the `data-testid` lookup + role-aware nav rendering
          work the same way as the previous sticky variant. */}
      <Sidebar currentRole={effectiveRole} mode="fixed" isOpen={false} onClose={() => undefined} />

      <main
        data-testid="app-canvas"
        // `pt-[56px]` clears the fixed TopBar; `lg:pl-[264px]`
        // clears the fixed Sidebar (240px) AND adds a 24px gutter
        // between the rail and the canvas content (off below `lg`
        // so the canvas reflows to full width when the rail
        // collapses); the breakpoint class (`pr-6` at `lg+`,
        // `px-4` at `md`, `px-3` at `sm`) provides the DESIGN.md
        // page gutter — right-only at `lg+` to keep the
        // `padding-left` slot free for the rail-clear, symmetric at
        // `md` / `sm` so content doesn't hug the left viewport edge.
        // The arbitrary values are unavoidable because the design
        // tokens expose 4/8/12/16/24/32/48/64 only.
        className={`min-h-screen pt-[${CANVAS_TOP_OFFSET_PX}px] lg:pl-[${SIDEBAR_WIDTH_PX + RAIL_GUTTER_PX}px] ${CANVAS_PADDING_CLASS[breakpoint]}`}
      >
        {children}
      </main>

      {breakpoint !== "lg" ? (
        <Sidebar
          currentRole={effectiveRole}
          mode="drawer"
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
};
