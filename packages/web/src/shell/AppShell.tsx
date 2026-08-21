/**
 * AppShell — Surakkha web (Story 1.2b).
 *
 * The authenticated layout shell:
 *   - SeverityBanner slot (above TopBar; lands in Story 1.8 / Epic 4)
 *   - TopBar (sticky, 56px)
 *   - Sidebar (240px fixed at >=1024px; hamburger drawer below)
 *   - Main canvas with the documented horizontal padding per breakpoint
 *
 * Breakpoint padding (DESIGN.md §Layout & Spacing):
 *   - >= 1024px (lg): 24px
 *   - 768 - 1023px (md): 16px
 *   - < 768px (mobile): 12px
 *
 * Viewport detection uses `window.matchMedia` so the layout reacts to
 * the actual rendered width rather than a fixed prop. The initial render
 * assumes `lg` and the effect upgrades / downgrades after hydration
 * (Story 1.2b AC only applies after mount).
 */
import { type Role } from "@surakkha/shared/rbac";
import { type PropsWithChildren, useEffect, useState } from "react";

import { useCurrentRole } from "../auth/CurrentRoleContext";

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

const CANVAS_PADDING: Record<Breakpoint, string> = {
  lg: "px-6", /* 24px */
  md: "px-4", /* 16px */
  sm: "px-3", /* 12px */
};

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

  // Close drawer with Esc (EXPERIENCE.md §Tab order).
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
      {/* SeverityBanner slot — Story 1.8 / Epic 4 wires the real
          sticky banner here. Empty slot today. */}
      <div data-testid="severity-banner-slot" />

      <TopBar onHamburger={() => setDrawerOpen(true)} />

      <div className="flex">
        {/* Fixed sidebar at lg; the element exists in the DOM at all
            sizes so the test-id is queryable, but Tailwind's `lg:block`
            hides it under 1024px. */}
        <Sidebar
          currentRole={effectiveRole}
          mode="fixed"
          isOpen={false}
          onClose={() => undefined}
        />

        <main
          data-testid="app-canvas"
          className={[
            "min-h-[calc(100vh-56px)] flex-1",
            CANVAS_PADDING[breakpoint],
          ].join(" ")}
        >
          {children}
        </main>
      </div>

      {/* Drawer sidebar — present in the DOM but hidden via translate
          until the hamburger opens it. Rendered only below the lg
          breakpoint. */}
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