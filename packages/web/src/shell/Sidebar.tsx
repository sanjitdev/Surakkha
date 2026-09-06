/**
 * `Sidebar` — 240px navigation rail. Sticky at >= 1024px (pinned to
 * the viewport so the rail stays visible while the canvas scrolls);
 * below that, `AppShell` reveals it as a drawer via the `drawerOpen`
 * prop. Items are filtered by role (see `nav.filterNav`). Visual
 * contract: DESIGN.md §Sidebar.
 *
 * Each nav row carries a 20px outline SVG icon (see `navIcons`) that
 * inherits the row's active/inactive text colour, so the glyph tints
 * in lockstep with the label. The TopBar holds the canonical brand
 * lockup — the sidebar does NOT re-render it (the rail sits flush
 * beneath the topbar, so duplicating "S" + "Surakkha" wordmark at
 * the rail head was creating two logos stacked on the same column).
 *
 * Earlier revisions rendered the sidebar as a plain flex sibling of
 * the canvas (`hidden lg:block` only), which made the rail scroll
 * away with the page. The fix: `sticky top-0 h-screen overflow-y-auto`
 * pins the rail to the viewport while the canvas scrolls behind it.
 */
import { NavLink } from "react-router-dom";

import { filterNav, NAV_GROUPS } from "./nav";
import { iconFor } from "./navIcons";

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
}) => {
  const Icon = iconFor(to);
  return (
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
          <Icon
            className={[
              "shrink-0",
              isActive ? "text-primary-active" : "text-neutral-sidebar-text",
            ].join(" ")}
          />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
};

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
      {/* `pt-2` reserves a hair of breathing room above the first
          group label so the rail's content doesn't visually touch the
          topbar's bottom edge — the brand lockup used to live here,
          now removed to avoid a duplicate with the TopBar. */}
      <div className="pt-2">
        <GroupLabel>{visible[0]?.label ?? "Menu"}</GroupLabel>
        <ul className="m-0 list-none p-0">
          {(visible[0]?.items ?? []).map((item) => (
            <li key={item.to}>
              <NavRow to={item.to} label={item.label} onNavigate={onItemClick} />
            </li>
          ))}
        </ul>
      </div>
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

const fixedStyles: React.CSSProperties = {
  width: `${SIDEBAR_WIDTH_PX}px`,
  // `position: sticky` keeps the rail pinned to the top of the
  // viewport while the canvas scrolls behind it.
  top: 0,
  height: "100vh",
};
const drawerStyles: React.CSSProperties = { width: `${SIDEBAR_WIDTH_PX}px` };

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
          style={drawerStyles}
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
      className="sticky hidden self-start lg:block"
      style={fixedStyles}
    >
      <SidebarBody currentRole={currentRole} />
    </aside>
  );
};
