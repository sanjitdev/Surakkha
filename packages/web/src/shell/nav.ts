/**
 * Information Architecture registry — pure data for nav groups,
 * items, and role gating. Source of truth: EXPERIENCE.md §Information
 * Architecture. The `Sidebar` consumes this; the route gate
 * (`RbacRoute`) uses `isPathAllowedForRole` so both layers stay in
 * lockstep on the same `roles[]` list.
 */
import type { Role } from "@surakkha/shared/rbac";

export interface NavItem {
  readonly label: string;
  readonly to: string;
  /** `null` → any authenticated role; otherwise the allowed role list. */
  readonly roles: readonly Role[] | null;
}

export interface NavGroup {
  readonly label: "Monitor" | "Operate" | "Admin";
  readonly items: readonly NavItem[];
}

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
      // Admin-only: matches the rbac.ts read × AuditLog grant so a
      // direct URL hit 403s for Operators (defense in depth).
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

/** Filter a nav group by role. `null` roles → always passes. */
export const filterNavGroup = (group: NavGroup, role: Role | null): NavGroup => {
  if (role === null) {
    return group;
  }
  const items = group.items.filter((item) => item.roles === null || item.roles.includes(role));
  return { label: group.label, items };
};

/** Filter all groups. Groups with zero visible items collapse to `items: []`. */
export const filterNav = (groups: readonly NavGroup[], role: Role | null): readonly NavGroup[] =>
  groups.map((g) => filterNavGroup(g, role));

/** Find the nav item that owns a path. `null` when not in the IA registry. */
export const findNavItemForPath = (groups: readonly NavGroup[], path: string): NavItem | null => {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.to === path) return item;
    }
  }
  return null;
};

/** True when the role can reach a nav item. `null` roles → always passes. */
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
