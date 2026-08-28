/**
 * `TopBar.spec.tsx` — Story 1.2b (layout) + Story 4.10 (bell slot).
 *
 * Coverage:
 *   - The Story 4.10 spec requires one pin: the bell mounts as a
 *     direct child of `data-testid="notification-bell-slot"` so the
 *     right-cluster layout can be evolved independently of the bell's
 *     own internals. Pinned here.
 *   - The 1.2b topbar height + elevation contract is also pinned
 *     (the bell mount must not disturb the 56px-tall row).
 *
 * Why this is a SEPARATE file (not folded into `shell.spec.tsx`):
 *   - The shell.spec rig mounts the full AppShell; the bell surface
 *     depends on the role context (Viewer → disabled, others →
 *     active). Mounting the bare `<TopBar>` here lets the bell slot
 *     test stay hermetic — the rig provides a `CurrentRoleProvider`
 *     without the rest of AppShell's stacking contract.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";

import { TopBar } from "./TopBar";

const NOOP_HAMBURGER = (): void => undefined;

const renderTopBar = (role: "Admin" | "Operator" | "Technician" | "Viewer" | null) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CurrentRoleProvider initialRole={role}>
        <TopBar onHamburger={NOOP_HAMBURGER} />
      </CurrentRoleProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  _resetApiClientConfig();
  vi.restoreAllMocks();
});

describe("Story 4.10 — NotificationBell slot wiring", () => {
  it("renders the notification-bell-slot wrapper inside the right cluster", () => {
    renderTopBar("Operator");
    const slot = screen.getByTestId("notification-bell-slot");
    expect(slot).toBeInTheDocument();
    // The slot is a direct child of the topbar (it's the only mount
    // site; the right cluster is `ml-auto flex items-center gap-3`).
    expect(slot.parentElement?.getAttribute("class") ?? "").toContain("ml-auto");
  });

  it("mounts the active bell as a DIRECT child of notification-bell-slot for Operator (firstElementChild contract)", () => {
    renderTopBar("Operator");
    const slot = screen.getByTestId("notification-bell-slot");
    // The disabled variant would render the `notification-bell-disabled`
    // testid; the active variant renders `notification-bell-wrapper` (the
    // inner-most wrapper around the bell button + badge + dropdown).
    // The spec pins the active bell's presence here as the direct child.
    //
    // Direct-child pin: `slot.firstElementChild === bellWrapper`.
    // The previous `slot.contains(...)` assertion allowed nested
    // descendants (a wrapper-of-a-wrapper would still pass); the
    // direct-child contract pins the spec requirement that the
    // bell mounts as the slot's sole child so future evolution of
    // the slot's right-cluster layout (e.g. a StatusBadge sibling)
    // does not silently nest the bell one level deeper.
    const bellWrapper = screen.getByTestId("notification-bell-wrapper");
    expect(slot.firstElementChild).toBe(bellWrapper);
  });

  it("mounts the disabled bell as a DIRECT child of notification-bell-slot for Viewer (firstElementChild contract)", () => {
    renderTopBar("Viewer");
    const slot = screen.getByTestId("notification-bell-slot");
    const disabledBell = screen.getByTestId("notification-bell-disabled");
    // Direct-child pin (same rationale as the Operator row above).
    expect(slot.firstElementChild).toBe(disabledBell);
  });
});

describe("Story 1.2b — topbar visual contract is preserved by the bell mount", () => {
  it("keeps the topbar at 56px tall with elevation.topbar shadow", () => {
    renderTopBar("Operator");
    const topbar = screen.getByTestId("topbar");
    expect(topbar.style.height).toBe("56px");
    expect(topbar.style.boxShadow).toBe("0 1px 2px rgba(15, 23, 42, 0.04)");
  });
});
