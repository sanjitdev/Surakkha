/**
 * Sidebar — Surakkha web (Story 1.2b).
 *
 * Behavioural contract: EXPERIENCE.md §Sidebar Component Pattern.
 * Visual contract: DESIGN.md §Components → `Sidebar` (240px, dark surface,
 * brand-tinted active icon, active row tint).
 *
 * The sidebar is fixed at 240px on viewports >= 1024px; on smaller widths
 * it is hidden behind a hamburger in the topbar and the AppShell reveals
 * it as a drawer via the `drawerOpen` prop.
 *
 * Role-aware item hiding: `filterNav` removes every item the role lacks
 * permission for. The RBAC denied state for direct URL hits is in
 * EXPERIENCE.md §RBAC denied.
 */
import { NavLink } from "react-router-dom";

import { filterNav, NAV_GROUPS } from "./nav";

import type { Role } from "@surakkha/shared/rbac";

const SIDEBAR_WIDTH_PX = 240;
const SIDEBAR_BG = "#0F172A"; /* color.neutral.sidebar */
const SIDEBAR_TEXT = "#CBD5E1"; /* color.neutral.sidebar_text */
const ACTIVE_ICON = "#38BDF8"; /* DESIGN.md §Components → Sidebar */
const DRAWER_OVERLAY = "rgba(15, 23, 42, 0.45)";

interface SidebarProps {
  readonly role: Role | null;
  readonly mode: "fixed" | "drawer";
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const GroupLabel = ({ children }: { readonly children: string }) => (
  <div
    className="px-3 pt-6 pb-2 text-[11px] font-semibold uppercase tracking-wider"
    style={{ color: SIDEBAR_TEXT }}
  >
    {children}
  </div>
);

const NavRow = ({
  to,
  label,
  onNavigate,
}: {
  readonly to: string;
  readonly label: string;
  readonly onNavigate?: () => void;
}) => (
  <NavLink
    to={to}
    onClick={onNavigate}
    className={({ isActive }: { isActive: boolean }) =>
      [
        "mx-3 my-px flex items-center gap-3 rounded-input px-3 py-2 text-md no-underline transition-colors",
        isActive
          ? "bg-[#1E293B] text-white"
          : `text-[${SIDEBAR_TEXT}] hover:text-white`,
      ].join(" ")
    }
  >
    {({ isActive }: { isActive: boolean }) => (
      <>
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{
            backgroundColor: isActive ? ACTIVE_ICON : SIDEBAR_TEXT,
          }}
        />
        <span>{label}</span>
      </>
    )}
  </NavLink>
);

const SidebarBody = ({
  role,
  onItemClick,
}: {
  readonly role: Role | null;
  readonly onItemClick?: () => void;
}) => {
  const visible = filterNav(NAV_GROUPS, role);
  return (
    <nav
      aria-label="Primary navigation"
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: SIDEBAR_BG }}
    >
      <GroupLabel>{visible[0]?.label ?? "Menu"}</GroupLabel>
      <ul className="m-0 list-none p-0">
        {(visible[0]?.items ?? []).map((item) => (
          <li key={item.to}>
            <NavRow to={item.to} label={item.label} onNavigate={onItemClick} />
          </li>
        ))}
      </ul>
      {visible.slice(1).map((group) => (
        <section key={group.label}>
          <GroupLabel>{group.label}</GroupLabel>
          {group.items.length === 0 ? null : (
            <ul className="m-0 list-none p-0">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavRow
                    to={item.to}
                    label={item.label}
                    onNavigate={onItemClick}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </nav>
  );
};

const styles: React.CSSProperties = { width: `${SIDEBAR_WIDTH_PX}px` };

export const Sidebar = ({
  role,
  mode,
  isOpen,
  onClose,
}: SidebarProps) => {
  if (mode === "drawer") {
    return (
      <>
        {/* Overlay — clicking it closes the drawer (EXPERIENCE.md
            §Tab order: Esc closes the drawer). */}
        <div
          aria-hidden
          data-testid="sidebar-overlay"
          onClick={onClose}
          className={[
            "fixed inset-0 z-40 transition-opacity",
            isOpen ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
          style={{ backgroundColor: DRAWER_OVERLAY }}
        />
        <aside
          data-testid="sidebar-drawer"
          aria-label="Navigation drawer"
          className={[
            "fixed inset-y-0 left-0 z-50 transition-transform",
            isOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
          style={styles}
        >
          <SidebarBody role={role} onItemClick={onClose} />
        </aside>
      </>
    );
  }

  return (
    <aside
      data-testid="sidebar-fixed"
      aria-label="Primary navigation"
      className="hidden lg:block"
      style={styles}
    >
      <SidebarBody role={role} />
    </aside>
  );
};
