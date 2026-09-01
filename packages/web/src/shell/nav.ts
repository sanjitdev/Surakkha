/**
 * Information Architecture registry — Surakkha web (Story 1.2b).
 *
 * Pure data: nav groups + items + role gating. The `Sidebar` consumes
 * this and applies the role-aware visibility filter (EXPERIENCE.md
 * §Information Architecture: "Role-aware nav items are entirely hidden
 * when the user lacks permission").
 *
 * Source of truth: EXPERIENCE.md §Information Architecture (the 14-route
 * inventory + the three group tables).
 *
 * This list is the *visible* set. Role gating is the only filter
 * applied at the shell layer; Story 1.5's RBAC middleware enforces
 * the same matrix server-side. Items hidden here are not reachable from
 * the sidebar — direct URL hits fall through to the RBAC denied state
 * (Story 1.8 / EXPERIENCE.md §RBAC denied).
 */
import type { Role } from "@surakkha/shared/rbac";

export interface NavItem {
  readonly label: string;
  readonly to: string;
  /** Roles allowed to see this item. `null` means "any authenticated role". */
  readonly roles: readonly Role[] | null;
}

export interface NavGroup {
  readonly label: "Monitor" | "Operate" | "Admin";
  readonly items: readonly NavItem[];
}

/**
 * Group + item order matches EXPERIENCE.md §Information Architecture.
 * Items with `spine_only: true` in the inventory still need a nav slot
 * for the demo flow; we mark them with the same `to` path.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { label: "Dashboard", to: "/dashboard", roles: null },
      { label: "Sensors", to: "/sensors", roles: null },
      { label: "Incidents", to: "/incidents", roles: null },
      { label: "Alerts", to: "/alerts", roles: null },
    ],
  },
  {
    label: "Operate",
    items: [
      { label: "Reports", to: "/reports", roles: ["Operator", "Admin"] },
      // Story 5.3 — RBAC matrix grants `read × AuditLog` to Admin
      // only (`rbac.ts:115`); the previous `["Operator", "Admin"]`
      // value put the link in the sidebar for Operators who would
      // 403 on click (the matrix/UI drift the spec calls out in
      // "Why the nav fix belongs in 5.3"). Tightened to Admin only
      // so a non-Admin direct URL hit still 403s as expected
      // (defense in depth).
      { label: "Audit", to: "/audit", roles: ["Admin"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Simulator", to: "/admin/simulator", roles: ["Admin"] },
      { label: "Notifications", to: "/admin/notifications", roles: ["Admin"] },
      { label: "Thresholds", to: "/admin/thresholds", roles: ["Admin"] },
      { label: "Users", to: "/admin/users", roles: ["Admin"] },
      { label: "Schools", to: "/admin/schools", roles: ["Admin"] },
    ],
  },
];

/**
 * Filter a nav group by role. `null` roles means "any authenticated role"
 * and therefore always passes the filter.
 */
export const filterNavGroup = (group: NavGroup, role: Role | null): NavGroup => {
  if (role === null) {
    return group;
  }
  const items = group.items.filter((item) => item.roles === null || item.roles.includes(role));
  return { label: group.label, items };
};

/**
 * Filter all nav groups by role. Groups with zero visible items collapse
 * to `items: []` (the sidebar renders an empty group rather than the
 * group label alone).
 */
export const filterNav = (groups: readonly NavGroup[], role: Role | null): readonly NavGroup[] =>
  groups.map((g) => filterNavGroup(g, role));

/**
 * Look up the nav item that owns a given path. Used by the route
 * gate (Story 1.6) so the role check on a direct URL hit uses the
 * SAME `roles[]` list the sidebar hides by — keeps the two surfaces
 * in lockstep. Returns `null` when the path is not in the IA registry
 * (in which case the route gate does not deny).
 */
export const findNavItemForPath = (groups: readonly NavGroup[], path: string): NavItem | null => {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.to === path) return item;
    }
  }
  return null;
};

/**
 * True when a role is allowed to reach a nav item. `null` roles means
 * "any authenticated role" and therefore always passes. Used by the
 * RbacRoute gate (Story 1.6).
 */
export const isPathAllowedForRole = (
  groups: readonly NavGroup[],
  path: string,
  role: Role | null,
): boolean => {
  const item = findNavItemForPath(groups, path);
  if (item === null) return true;
  if (item.roles === null) return true;
  if (role === null) return false;
  return item.roles.includes(role);
};
