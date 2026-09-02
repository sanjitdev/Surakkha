/**
 * `Sidebar` — 240px navigation rail. Fixed at >= 1024px; below that,
 * `AppShell` reveals it as a drawer via the `drawerOpen` prop. Items
 * are filtered by role (see `nav.filterNav`). Visual contract:
 * DESIGN.md §Sidebar.
 */
import { NavLink } from "react-router-dom";

import { filterNav, NAV_GROUPS } from "./nav";

import type { Role } from "@surakkha/shared/rbac";

const SIDEBAR_WIDTH_PX = 240;

interface SidebarProps {
  readonly currentRole: Role | null;
  readonly mode: "fixed" | "drawer";
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const GroupLabel = ({ children }: { readonly children: string }) => (
  <div className="px-3 pt-6 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-sidebar-text">
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
          ? "bg-neutral-sidebar-active text-neutral-sidebar-text-active"
          : "text-neutral-sidebar-text hover:text-neutral-sidebar-text-active",
      ].join(" ")
    }
  >
    {({ isActive }: { isActive: boolean }) => (
      <>
        <span
          aria-hidden
          className={[
            "inline-block h-2 w-2 rounded-full",
            isActive ? "bg-primary-active" : "bg-neutral-sidebar-text",
          ].join(" ")}
        />
        <span>{label}</span>
      </>
    )}
  </NavLink>
);

const SidebarBody = ({
  currentRole,
  onItemClick,
}: {
  readonly currentRole: Role | null;
  readonly onItemClick?: () => void;
}) => {
  const visible = filterNav(NAV_GROUPS, currentRole);
  return (
    <nav
      aria-label="Primary navigation"
      className="flex h-full flex-col overflow-y-auto bg-neutral-sidebar"
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
                  <NavRow to={item.to} label={item.label} onNavigate={onItemClick} />
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

export const Sidebar = ({ currentRole, mode, isOpen, onClose }: SidebarProps) => {
  if (mode === "drawer") {
    return (
      <>
        <div
          aria-hidden
          data-testid="sidebar-overlay"
          onClick={onClose}
          className={[
            "fixed inset-0 z-40 bg-neutral-sidebar/45 transition-opacity",
            isOpen ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
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
          <SidebarBody currentRole={currentRole} onItemClick={onClose} />
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
      <SidebarBody currentRole={currentRole} />
    </aside>
  );
};
