# Test spec — `packages/web/src/shell` critique loop (2026-09-02)

## Scope

Regression pins for the 2026-09-02 `/impeccable critique packages/web/src/shell` loop.

Critique artifact: `.impeccable/critique/2026-09-02T19-00-00Z__packages-web-src-shell.md`. Score: **32/40**. Four P1 fixes (4 oversized narrative headers; 2 slot-comment blocks re-narrating the IA; self-critique narratives in TopBar + nav.ts; ConnectionStateBanner header re-implementing the design doc inline) and nine P2 fixes shipped in this PR.

## Behavioural pins (UI / RTL)

### AppShell

| #   | Given                                        | When                                   | Then                                                                                                                          |
| --- | -------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mount                                        | First render                           | `data-testid="app-shell"` visible                                                                                             |
| 2   | Always                                       | Render                                 | `data-testid="connection-state-banner-slot"` is the FIRST slot child of `app-shell` (above `severity-banner-slot`)            |
| 3   | Always                                       | Render                                 | `data-testid="severity-banner-slot"` is the SECOND slot child                                                                 |
| 4   | `useConnectionState().isConnected === false` | Render                                 | `data-testid="connection-state-banner"` visible inside the slot                                                               |
| 5   | `useConnectionState().isConnected === true`  | Render                                 | `connection-state-banner` NOT rendered (returns null)                                                                         |
| 6   | Always                                       | Render                                 | `data-testid="topbar"` visible                                                                                                |
| 7   | Viewport >= 1024px                           | Render                                 | `data-testid="sidebar-fixed"` visible (not hidden by `lg:block`)                                                              |
| 8   | Viewport < 1024px                            | Render                                 | `data-testid="sidebar-drawer"` mounted; `sidebar-fixed` hidden by `hidden lg:block`                                           |
| 9   | Viewport < 1024px, hamburger clicked         | Click `data-testid="topbar-hamburger"` | Drawer slides in (`translate-x-0`); `data-testid="sidebar-overlay"` visible with `opacity-100`                                |
| 10  | Drawer open, Esc pressed                     | Keydown                                | Drawer closes (`-translate-x-full`); overlay back to `pointer-events-none`                                                    |
| 11  | Drawer open, overlay clicked                 | Click `data-testid="sidebar-overlay"`  | Drawer closes                                                                                                                 |
| 12  | Breakpoint changes via resize                | Resize to width < 768                  | `data-testid="app-canvas"` has class containing `px-3` (12px)                                                                 |
| 13  | Resize to 768-1023                           | Resize                                 | Canvas has `px-4` (16px)                                                                                                      |
| 14  | Resize to >= 1024                            | Resize                                 | Canvas has `px-6` (24px)                                                                                                      |
| 15  | Always                                       | Render                                 | `data-testid="app-canvas"` is a `<main>` element                                                                              |
| 16  | Server-side render                           | First paint                            | `breakpoint` defaults to `"lg"` (no `window.matchMedia` call); hydration upgrades / downgrades to actual viewport after mount |

### TopBar

| #   | Given           | When   | Then                                                                                                      |
| --- | --------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| 17  | Always          | Render | `data-testid="topbar"` height = 56px (inline style)                                                       |
| 18  | Always          | Render | Hamburger button (`data-testid="topbar-hamburger"`) is hidden at >= 1024px (`lg:hidden`)                  |
| 19  | Always          | Render | Search input has `aria-label="Search"`, `placeholder="Search"`, no value                                  |
| 20  | Always          | Render | `data-testid="notification-bell-slot"` is the rightmost cluster child; mounts `NotificationBell` directly |
| 21  | Hamburger click | Click  | `onHamburger` callback fires; `Sidebar` drawer opens (covered by AppShell pins 9-11)                      |

### Sidebar

| #   | Given                              | When   | Then                                                                                                                                                            |
| --- | ---------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22  | `currentRole = "Admin"`            | Render | "Admin" group with 5 items (Simulator, Notifications, Thresholds, Users, Schools)                                                                               |
| 23  | `currentRole = "Operator"`         | Render | "Admin" group rendered but `items: []` (filter removes all roles-Admin items)                                                                                   |
| 24  | `currentRole = "Operator"`         | Render | "Operate" group shows Reports + Audit only if Audit is in the operator's roles; per nav.ts, Audit is `["Admin"]` only, so "Operate" group renders Reports alone |
| 25  | `currentRole = null`               | Render | All items pass the filter (`null` role = any authenticated)                                                                                                     |
| 26  | `mode = "fixed"`, `isOpen = false` | Render | `data-testid="sidebar-fixed"` mounted; no overlay; no drawer                                                                                                    |
| 27  | `mode = "drawer"`, `isOpen = true` | Render | `data-testid="sidebar-overlay"` + `data-testid="sidebar-drawer"` both visible                                                                                   |
| 28  | NavLink route matches              | Render | `aria-current="page"` (set by react-router); the active dot uses `bg-primary-active` (hidden visually since it's a 2px circle, but the className is applied)    |
| 29  | Any nav row clicked                | Click  | `NavLink` navigates; `onItemClick` (drawer mode only) closes the drawer                                                                                         |

### ConnectionStateBanner

| #   | Given                   | When   | Then                                                                                                              |
| --- | ----------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| 30  | `isConnected === true`  | Render | Component returns `null` (nothing rendered)                                                                       |
| 31  | `isConnected === false` | Render | `data-testid="connection-state-banner"` visible                                                                   |
| 32  | `isConnected === false` | Render | Banner contains heading "Reconnecting…" and body "Showing last-known data."                                       |
| 33  | `isConnected === false` | Render | `aria-live="polite"` is set on the BODY only (not the wrapper); the wrapper has NO `role="status"`                |
| 34  | `isConnected === false` | Render | Tailwind classes are LITERAL strings (no template-literal interpolation), so Tailwind's JIT scanner picks them up |
| 35  | `isConnected === false` | Render | Classes include `border-severity-warning-value` + `bg-severity-warning-bg` + `text-severity-warning-text`         |

### nav.ts (pure logic)

| #   | Given                                                               | When | Then                                                                                                                                                                      |
| --- | ------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 36  | `filterNavGroup(Monitor, null)`                                     | Call | Returns the input group unchanged                                                                                                                                         |
| 37  | `filterNavGroup(Monitor, "Admin")`                                  | Call | All 4 Monitor items pass (all `roles: null`)                                                                                                                              |
| 38  | `filterNavGroup(Operate, "Operator")`                               | Call | Returns Reports only (Audit is Admin-only)                                                                                                                                |
| 39  | `filterNavGroup(Operate, "Admin")`                                  | Call | Returns Reports + Audit                                                                                                                                                   |
| 40  | `filterNav(NAV_GROUPS, "Operator")`                                 | Call | Returns 3 groups; Admin group has `items: []` (empty group rendered, not omitted — per the comment in the original header)                                                |
| 41  | `filterNav(NAV_GROUPS, null)`                                       | Call | Returns all 11 items across 3 groups                                                                                                                                      |
| 42  | `findNavItemForPath(NAV_GROUPS, "/dashboard")`                      | Call | Returns the Dashboard item                                                                                                                                                |
| 43  | `findNavItemForPath(NAV_GROUPS, "/unknown")`                        | Call | Returns `null`                                                                                                                                                            |
| 44  | `isPathAllowedForRole(NAV_GROUPS, "/dashboard", null)`              | Call | Returns `true` (`null` roles → always passes)                                                                                                                             |
| 45  | `isPathAllowedForRole(NAV_GROUPS, "/admin/thresholds", "Operator")` | Call | Returns `false` (Admin-only)                                                                                                                                              |
| 46  | `isPathAllowedForRole(NAV_GROUPS, "/admin/thresholds", "Admin")`    | Call | Returns `true`                                                                                                                                                            |
| 47  | `isPathAllowedForRole(NAV_GROUPS, "/unknown", "Operator")`          | Call | Returns `true` (no entry → no denial, per "in which case the route gate does not deny" — kept as a non-finding in the critique but pin-tested for behaviour preservation) |

## Static / lint pins

| #   | Property                                           | Required value                                                                                                                                                         |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 48  | All 5 source files                                 | No story-internal jargon (`Story 2.9`, `VG-1`, `Story 5.3`, `Story 1.4`, `Story 1.5`, `Story 1.6`, `UX-DR-6`) in headers or comments                                   |
| 49  | Each file's opening `/** ... */` block             | ≤ 6 lines. Pre-loop: 15-32 lines                                                                                                                                       |
| 50  | `AppShell.tsx` mid-file JSX comments               | No > 2-line block comment above a `<div>` or `<aside>`. Pre-loop: 2 × 8-line blocks                                                                                    |
| 51  | `nav.ts` `spine_only` references                   | **0** (the term is unreferenced anywhere in the codebase). Pre-loop: 1                                                                                                 |
| 52  | `nav.ts` "Story 5.3 — RBAC matrix grants" block    | **Removed**. The 9-line narrative that explained why Audit was tightened to Admin-only has collapsed to 3 lines (matches the rbac.ts grant + direct-URL 403 rationale) |
| 53  | `ConnectionStateBanner.tsx` Tailwind class strings | All literal (no template interpolation). The story-2.8 `VG-1` lesson is now in the critique artifact, not the source                                                   |
| 54  | `AppShell.tsx` inline `px-6 /* 24px */` comments   | **Removed**. The `CANVAS_PADDING_CLASS` map carries Tailwind classes; a 2-line header comment points to DESIGN.md for px values                                        |
| 55  | `Sidebar.tsx` drawer-mode overlay comment          | **Removed**. The `onClick={onClose}` handler carries the meaning                                                                                                       |
| 56  | `TopBar.tsx` inline comments                       | **Removed**. The 4 inline hamburger / brand / search / right-cluster block comments are gone; the JSX carries the meaning                                              |

## Negative pins (regression guards)

| #   | Behaviour                    | Must NOT happen                                                                                                                                                                           |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57  | Header trim                  | Re-introduce a 15+ line narrative block re-telling the story                                                                                                                              |
| 58  | Slot comments                | Re-add "DOM-tree position test stays a simple slot-vs-slot comparison" or similar 8-line block above `*-slot` divs                                                                        |
| 59  | `nav.ts`                     | Re-add a "Story x.y" prefix to any inline comment in this file (the patterns in the critique `nav.ts:50-58` self-critique and `nav.ts:32-36` stale `spine_only` reference are pinned-off) |
| 60  | File headers in this surface | Contain `EXPERIENCE.md` as a 4-line quote — link the section and let the doc carry the contract                                                                                           |

## Verification commands

```bash
cd packages/web && npx tsc -b
cd packages/web && npx eslint src/shell
cd packages/web && npx vitest run src/shell
```

Existing specs: `AppShell.spec.tsx`, `TopBar.spec.tsx`, `ConnectionStateBanner.spec.tsx`, `shell.spec.tsx`. All must remain green.
