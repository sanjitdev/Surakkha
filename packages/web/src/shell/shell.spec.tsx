/**
 * Story 1.2b — Responsive Layout Shell.
 *
 * The test matrix covers every breakpoint AC:
 *
 *   - viewport >= 1024px: fixed sidebar present, hamburger hidden
 *   - viewport <  1024px:  hamburger visible, fixed sidebar hidden,
 *                          drawer sidebar in DOM
 *   - viewport >= 1024px:  canvas right gutter is 24px (pr-6) and
 *                          the rail-clear is `lg:pl-[264px]`
 *                          (= 240px rail-clear + 24px gutter, so
 *                          the canvas reads as "page beside rail"
 *                          rather than "page flush against rail").
 *                          The left side uses a single longhand
 *                          arbitrary (not `px-6`) so the cascade
 *                          doesn't push content back to x=24.
 *   - viewport 768 - 1023px: canvas horizontal padding is symmetric
 *                          16px (px-4) — the rail is collapsed at
 *                          `md` so the canvas is full-width.
 *   - viewport <  768px:    canvas horizontal padding is symmetric
 *                          12px (px-3) — same reason as `md`.
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

  // The canvas horizontal padding has two regimes:
  //
  //   - At `lg+` the rail is fixed and the canvas uses `pr-6` for
  //     the right gutter + `lg:pl-[264px]` to clear the rail AND
  //     add a 24px gutter on the left. The combined longhand
  //     arbitrary keeps the cascade clean — there's only ever ONE
  //     rule setting `padding-left` at `lg+`. Right-only padding
  //     (`pr-6` vs `px-6`) keeps the shorthand `padding-left` from
  //     cascade-ordering against `lg:pl-[264px]` and leaving
  //     content at x=24 (behind the rail).
  //   - At `md` / `sm` the rail is collapsed (`hidden lg:block`) and
  //     `lg:pl-[264px]` doesn't activate, so the canvas falls back
  //     to symmetric `px-{4|3}` to keep the DESIGN.md gutter on
  //     BOTH sides. (Earlier `pr-*`-only variants left content
  //     hugging the left viewport edge on mobile / tablet.)
  //
  // The `lg:` prefix governs CSS application only — the literal
  // `pl-[264px]` substring is present in the className at every
  // breakpoint, so we can't pin "absence" via a substring check.

  it(">= 1024px applies pr-6 (24px right gutter) + lg:pl-[264px] rail clear + left gutter", () => {
    setViewport(1280);
    renderShell("Admin");
    const cls = screen.getByTestId("app-canvas").className;
    expect(cls).toContain("pr-6");
    expect(cls).toContain("lg:pl-[264px]");
  });

  it("768 - 1023px applies px-4 (16px symmetric gutter)", () => {
    setViewport(900);
    renderShell("Admin");
    const cls = screen.getByTestId("app-canvas").className;
    expect(cls).toContain("px-4");
    // Symmetric padding is intentional — the rail is collapsed at
    // `md`, so the canvas is full-width and the left edge needs the
    // same 16px gutter as the right.
  });

  it("< 768px applies px-3 (12px symmetric gutter)", () => {
    setViewport(420);
    renderShell("Admin");
    const cls = screen.getByTestId("app-canvas").className;
    expect(cls).toContain("px-3");
    // Symmetric padding at `sm` for the same reason as `md` —
    // content should not hug the left viewport edge.
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
    // Story 5.3 — Audit is Admin-only; Operator's Operate group
    // narrows to Reports only. The pre-5.3 count of 2 included
    // /audit which now belongs to the Admin group.
    expect(visible.find((g) => g.label === "Operate")?.items.length).toBe(1);
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
    // Shadow flows through `shadow-elevation-topbar` Tailwind token
    // (`tailwind.config.ts:153`) rather than inline style — same
    // rationale as `TopBar.spec.tsx`'s shadow pin.
    expect(topbar.className).toContain("shadow-elevation-topbar");
  });

  it("renders the brand mark with the primary gradient", () => {
    renderShell("Admin");
    // Both the TopBar and the Sidebar (Story 5.x sidebar lockup) carry
    // an "S" mark; the test pins the TopBar's gradient specifically so
    // a future lockup variant doesn't silently satisfy the assertion
    // against the wrong element. Filter to the spans carrying the "S"
    // glyph (the hamburger's three decorative spans are empty).
    const topbar = screen.getByTestId("topbar");
    const marks = Array.from(topbar.querySelectorAll("span")).filter(
      (s) => (s.textContent ?? "").trim() === "S",
    );
    expect(marks.length).toBeGreaterThan(0);
    const parent = marks[0]?.parentElement;
    expect(parent?.style.backgroundImage).toBe("linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)");
  });
});
