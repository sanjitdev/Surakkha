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
 *     document flow, so the canvas offsets it via `lg:pl-[240px]`.
 *   - The `<main>` clears the TopBar with `pt-[56px]` and clears
 *     the rail with `lg:pl-[240px]`. Below `lg` the rail collapses
 *     and the canvas's `lg:pl-[240px]` flips off, so the page
 *     content reflows to full width.
 *   - The canvas provides the page gutter (DESIGN.md §Layout &
 *     Spacing: 24px / 16px / 12px per breakpoint). At `lg+` it's
 *     `pr-6` (right-only) so the `padding-left` slot stays free for
 *     `lg:pl-[240px]` to clear the rail — using `px-6` here would
 *     let the shorthand `padding-left` cascade-order against
 *     `lg:pl-[240px]` and leave content touching (or sliding under)
 *     the rail. At `md` / `sm` the rail is collapsed and
 *     `lg:pl-[240px]` doesn't activate, so the canvas falls back to
 *     symmetric `px-{4|3}` to keep the DESIGN.md gutter on both
 *     sides.
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
//   - At `lg+` we use `pr-6` + the `lg:pl-[240px]` rail-clear declared
//     on the `<main>`. `pr-*` is right-only so the `padding-left`
//     slot stays free for the rail-clear; using `px-6` here would let
//     the shorthand `padding-left` cascade-order against
//     `lg:pl-[240px]` and leave content sitting at x=24 (behind the
//     240px rail).
//   - At `md` / `sm` the rail is collapsed (`hidden lg:block`), so
//     `lg:pl-[240px]` doesn't activate and the canvas reflows to
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
        // `pt-[56px]` clears the fixed TopBar; `lg:pl-[240px]` clears
        // the fixed Sidebar (off below `lg` so the canvas reflows to
        // full width when the rail collapses); the breakpoint class
        // (`pr-6` at `lg+`, `px-4` at `md`, `px-3` at `sm`) provides
        // the DESIGN.md page gutter — right-only at `lg+` to keep the
        // `padding-left` slot free for the rail-clear, symmetric at
        // `md` / `sm` so content doesn't hug the left viewport edge.
        // The arbitrary values are unavoidable because the design
        // tokens expose 4/8/12/16/24/32/48/64 only.
        className={`min-h-screen pt-[${CANVAS_TOP_OFFSET_PX}px] lg:pl-[${SIDEBAR_WIDTH_PX}px] ${CANVAS_PADDING_CLASS[breakpoint]}`}
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
