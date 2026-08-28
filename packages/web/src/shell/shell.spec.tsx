/**
 * Story 1.2b — Responsive Layout Shell.
 *
 * The test matrix covers every breakpoint AC:
 *
 *   - viewport >= 1024px: fixed sidebar present, hamburger hidden
 *   - viewport <  1024px: hamburger visible, fixed sidebar hidden,
 *                          drawer sidebar in DOM
 *   - viewport 768 - 1023px: canvas horizontal padding is 16px (px-4)
 *   - viewport <  768px:   canvas horizontal padding is 12px (px-3)
 *   - viewport >= 1024px:  canvas horizontal padding is 24px (px-6)
 *
 * The role-aware nav filter is also pinned: a Viewer session never sees
 * the Admin group; an Operator sees Monitor + Operate but not Admin.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";
import { filterNav, NAV_GROUPS } from "./nav";

const setViewport = (width: number) => {
  // happy-dom supports matchMedia via window.matchMedia. We need to
  // override it before render so the AppShell's effect sees the right
  // breakpoint on mount.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.matchMedia = (query: string) => {
    const matches =
      (query.includes("min-width: 1024") && width >= 1024) ||
      (query.includes("min-width: 768") && width >= 768);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
};

const renderShell = (role: "Admin" | "Operator" | "Technician" | "Viewer" | null = null) => {
  // Story 4.8 — `<AppShell />` mounts `<SeverityBanner />` which
  // reads `GET /api/incidents/active` via TanStack `useQuery`. The
  // shell spec doesn't care about the banner (the 1.2b scope is
  // layout-only); a fresh `QueryClient` per render keeps the test
  // hermetic and lets the query sit in `idle` (no fetch mock
  // needed; `data ?? []` → zero-count → null banner DOM).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell currentRole={role}>
          <div>canvas content</div>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Story 1.2b — sidebar at viewport >= 1024px", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  it("renders the fixed 240px sidebar", () => {
    renderShell("Admin");
    const sidebar = screen.getByTestId("sidebar-fixed");
    expect(sidebar).toBeInTheDocument();
    expect(sidebar.style.width).toBe("240px");
  });

  it("hides the hamburger button", () => {
    renderShell("Admin");
    // The hamburger is in the topbar with `lg:hidden`; in happy-dom the
    // computed class list is queryable via className.
    const hamburger = screen.getByTestId("topbar-hamburger");
    expect(hamburger.className).toContain("lg:hidden");
  });
});

describe("Story 1.2b — sidebar at viewport < 1024px", () => {
  beforeEach(() => setViewport(900));
  afterEach(() => cleanup());

  it("fixed sidebar is visually hidden (hidden lg:block)", () => {
    renderShell("Admin");
    const sidebar = screen.getByTestId("sidebar-fixed");
    // The fixed sidebar is in the DOM at all breakpoints; Tailwind's
    // `hidden lg:block` collapses it below 1024px so the hamburger
    // owns the navigation surface there.
    expect(sidebar.className).toContain("hidden");
    expect(sidebar.className).toContain("lg:block");
  });

  it("renders the drawer sidebar in the DOM", () => {
    renderShell("Admin");
    expect(screen.getByTestId("sidebar-drawer")).toBeInTheDocument();
  });
});

describe("Story 1.2b — canvas horizontal padding per breakpoint", () => {
  afterEach(() => cleanup());

  it(">= 1024px applies px-6 (24px)", () => {
    setViewport(1280);
    renderShell("Admin");
    expect(screen.getByTestId("app-canvas").className).toContain("px-6");
  });

  it("768 - 1023px applies px-4 (16px)", () => {
    setViewport(900);
    renderShell("Admin");
    expect(screen.getByTestId("app-canvas").className).toContain("px-4");
  });

  it("< 768px applies px-3 (12px)", () => {
    setViewport(420);
    renderShell("Admin");
    expect(screen.getByTestId("app-canvas").className).toContain("px-3");
  });
});

describe("Story 1.2b — role-aware nav (EXPERIENCE.md §Information Architecture)", () => {
  it("Admin sees every group + every item", () => {
    const visible = filterNav(NAV_GROUPS, "Admin");
    expect(visible.find((g) => g.label === "Monitor")?.items.length).toBe(4);
    expect(visible.find((g) => g.label === "Operate")?.items.length).toBe(2);
    expect(visible.find((g) => g.label === "Admin")?.items.length).toBe(5);
  });

  it("Operator sees Monitor + Operate but not Admin", () => {
    const visible = filterNav(NAV_GROUPS, "Operator");
    expect(visible.find((g) => g.label === "Monitor")?.items.length).toBe(4);
    expect(visible.find((g) => g.label === "Operate")?.items.length).toBe(2);
    expect(visible.find((g) => g.label === "Admin")?.items.length).toBe(0);
  });

  it("Technician sees only the Monitor group", () => {
    const visible = filterNav(NAV_GROUPS, "Technician");
    expect(visible.find((g) => g.label === "Monitor")?.items.length).toBe(4);
    expect(visible.find((g) => g.label === "Operate")?.items.length).toBe(0);
    expect(visible.find((g) => g.label === "Admin")?.items.length).toBe(0);
  });

  it("Viewer sees only the Monitor group", () => {
    const visible = filterNav(NAV_GROUPS, "Viewer");
    expect(visible.find((g) => g.label === "Monitor")?.items.length).toBe(4);
    expect(visible.find((g) => g.label === "Operate")?.items.length).toBe(0);
    expect(visible.find((g) => g.label === "Admin")?.items.length).toBe(0);
  });
});

describe("Story 1.2b — topbar", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  it("is 56px tall with the elevation.topbar shadow", () => {
    renderShell("Admin");
    const topbar = screen.getByTestId("topbar");
    expect(topbar.style.height).toBe("56px");
    expect(topbar.style.boxShadow).toBe("0 1px 2px rgba(15, 23, 42, 0.04)");
  });

  it("renders the brand mark with the primary gradient", () => {
    renderShell("Admin");
    const mark = screen.getByText("S");
    const parent = mark.parentElement;
    expect(parent?.style.backgroundImage).toBe("linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)");
  });
});
