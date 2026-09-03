/**
 * Authenticated layout: connection + severity banner slots, TopBar,
 * fixed Sidebar (>= 1024px) or hamburger drawer (< 1024px), main
 * canvas with breakpoint-driven horizontal padding. Initial render
 * assumes `lg`; the resize effect upgrades / downgrades after
 * hydration.
 */
import { type Role } from "@surakkha/shared/rbac";
import { type PropsWithChildren, useEffect, useState } from "react";

import { useCurrentRole } from "../auth/CurrentRoleContext";
import { SeverityBanner } from "../incidents/SeverityBanner";

import { ConnectionStateBanner } from "./ConnectionStateBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export type Breakpoint = "lg" | "md" | "sm";

const MEDIA_LG = "(min-width: 1024px)";
const MEDIA_MD = "(min-width: 768px)";

const detectBreakpoint = (): Breakpoint => {
  if (typeof window === "undefined") return "lg";
  if (window.matchMedia(MEDIA_LG).matches) return "lg";
  if (window.matchMedia(MEDIA_MD).matches) return "md";
  return "sm";
};

// Horizontal canvas padding per breakpoint (DESIGN.md §Layout & Spacing).
// `lg: 24px / md: 16px / sm: 12px` — kept as Tailwind classes so the JIT
// scanner picks them up.
const CANVAS_PADDING_CLASS: Record<Breakpoint, string> = {
  lg: "px-6",
  md: "px-4",
  sm: "px-3",
};
const CANVAS_MIN_HEIGHT = "calc(100vh - 56px)";

interface AppShellProps extends PropsWithChildren {
  readonly currentRole?: Role | null;
}

export const AppShell = ({ currentRole, children }: AppShellProps) => {
  const contextRole = useCurrentRole();
  const effectiveRole = currentRole ?? contextRole;
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("lg");
  const [drawerOpen, setDrawerOpen] = useState(false);

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

      <TopBar onHamburger={() => setDrawerOpen(true)} />

      <div className="flex">
        <Sidebar
          currentRole={effectiveRole}
          mode="fixed"
          isOpen={false}
          onClose={() => undefined}
        />

        <main
          data-testid="app-canvas"
          className={`min-h-[${CANVAS_MIN_HEIGHT}] flex-1 ${CANVAS_PADDING_CLASS[breakpoint]}`}
        >
          {children}
        </main>
      </div>

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
