/**
 * Story 1.6 — Role-Aware Nav + RBAC Denied State.
 *
 * Coverage:
 *   - The RbacDenied empty state uses semantic HTML (<main>, <h1>),
 *     announces itself via role="status", exposes the documented
 *     message, and links back to /dashboard.
 *   - The Viewer's sidebar DOM does NOT render the Operate or Admin
 *     group labels / items; the Monitor items are present.
 *   - RbacRoute lets an Admin reach /audit, but renders RbacDenied for
 *     a Viewer (and for a null role).
 *   - The shared `nav.findNavItemForPath` + `isPathAllowedForRole`
 *     helpers pin the IA so the sidebar filter and the route gate
 *     stay in lockstep.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RbacDenied, RBAC_DENIED_MESSAGE } from "./RbacDenied";
import { RbacRoute } from "./RbacRoute";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";
import { AppShell } from "../shell/AppShell";
import { Sidebar } from "../shell/Sidebar";
import { NAV_GROUPS, findNavItemForPath, isPathAllowedForRole } from "../shell/nav";

/**
 * Story 4.8 — `<AppShell />` now mounts `<SeverityBanner />`, which
 * reads `GET /api/incidents/active` via TanStack `useQuery`. The
 * access spec doesn't care about the banner; every test wraps its
 * tree in a fresh `QueryClientProvider` so the shared cache does not
 * bleed between tests. The query sits in `idle` (no fetch mock
 * needed; `data ?? []` → zero-count → null banner DOM, matching the
 * 1.6 test contract).
 */

const setViewport = (width: number) => {
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

describe("Story 1.6 — RbacDenied semantic contract", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  const renderDenied = (props: Partial<React.ComponentProps<typeof RbacDenied>> = {}) =>
    render(
      <MemoryRouter initialEntries={["/audit"]}>
        <RbacDenied {...props} />
      </MemoryRouter>,
    );

  it("renders <main> with role=status", () => {
    renderDenied();
    const main = screen.getByTestId("rbac-denied");
    expect(main.tagName).toBe("MAIN");
    expect(main.getAttribute("role")).toBe("status");
    expect(main.getAttribute("aria-live")).toBe("polite");
  });

  it("contains the documented headline + message copy", () => {
    renderDenied();
    expect(screen.getByRole("heading", { level: 1, name: "Access denied" })).toBeInTheDocument();
    expect(screen.getByText(RBAC_DENIED_MESSAGE)).toBeInTheDocument();
  });

  it("renders a link back to /dashboard", () => {
    renderDenied();
    const link = screen.getByTestId("rbac-denied-back-link");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/dashboard");
  });

  it("respects custom headline / message / backHref overrides", () => {
    renderDenied({
      headline: "Reports locked",
      message: "Talk to your Admin.",
      backHref: "/dashboard",
      backLabel: "Return",
    });
    expect(screen.getByRole("heading", { level: 1, name: "Reports locked" })).toBeInTheDocument();
    expect(screen.getByText("Talk to your Admin.")).toBeInTheDocument();
    expect(screen.getByText("Return")).toBeInTheDocument();
  });
});

describe("Story 6.11 — RbacDenied role-aware back-link (Riley persona)", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  const renderWithRole = (viewerRole: "Admin" | "Operator" | "Technician" | "Viewer" | null) =>
    render(
      <MemoryRouter initialEntries={["/audit"]}>
        <RbacDenied viewerRole={viewerRole} />
      </MemoryRouter>,
    );

  // Per EXPERIENCE.md §Personas — Technicians live on /devices; everyone
  // else lands on /dashboard. The role-aware back-link is the
  // affordance the Viewer persona lost previously when they hit
  // /admin/* and got dumped on /dashboard.
  it("routes a Technician to /devices (their key-journey surface)", () => {
    renderWithRole("Technician");
    const link = screen.getByTestId("rbac-denied-back-link");
    expect(link.getAttribute("href")).toBe("/devices");
    expect(link.textContent).toBe("Back to devices");
  });

  it.each(["Admin", "Operator", "Viewer"] as const)(
    "routes %s to /dashboard (overview surface)",
    (role) => {
      renderWithRole(role);
      const link = screen.getByTestId("rbac-denied-back-link");
      expect(link.getAttribute("href")).toBe("/dashboard");
      expect(link.textContent).toBe("Back to dashboard");
    },
  );

  it("falls back to /dashboard when viewerRole is null (legacy callers)", () => {
    renderWithRole(null);
    const link = screen.getByTestId("rbac-denied-back-link");
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(link.textContent).toBe("Back to dashboard");
  });

  it("respects explicit backHref override even when viewerRole is provided", () => {
    // Kanban / IncidentDetail overrides win over the role-aware
    // default — the seam is the explicit-prop escape hatch.
    render(
      <MemoryRouter initialEntries={["/audit"]}>
        <RbacDenied viewerRole="Technician" backHref="/incidents" backLabel="Back to incidents" />
      </MemoryRouter>,
    );
    const link = screen.getByTestId("rbac-denied-back-link");
    expect(link.getAttribute("href")).toBe("/incidents");
    expect(link.textContent).toBe("Back to incidents");
  });
});

describe("Story 1.6 — Viewer sidebar DOM (AC1)", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  const renderViewerSidebar = () =>
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <CurrentRoleProvider initialRole="Viewer">
          <Sidebar currentRole="Viewer" mode="fixed" isOpen={false} onClose={() => undefined} />
        </CurrentRoleProvider>
      </MemoryRouter>,
    );

  it("does not render Operate items (Reports / Audit) in the DOM", () => {
    renderViewerSidebar();
    expect(screen.queryByText("Reports")).toBeNull();
    expect(screen.queryByText("Audit")).toBeNull();
  });

  it("does not render Admin items (Simulator / Thresholds / Users / Schools / Notifications) in the DOM", () => {
    renderViewerSidebar();
    expect(screen.queryByText("Simulator")).toBeNull();
    expect(screen.queryByText("Thresholds")).toBeNull();
    expect(screen.queryByText("Users")).toBeNull();
    expect(screen.queryByText("Schools")).toBeNull();
    expect(screen.queryByText("Notifications")).toBeNull();
  });

  it("renders Monitor items (Dashboard / Sensors / Incidents / Alerts) for the Viewer", () => {
    renderViewerSidebar();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sensors")).toBeInTheDocument();
    expect(screen.getByText("Incidents")).toBeInTheDocument();
    expect(screen.getByText("Alerts")).toBeInTheDocument();
  });
});

describe("Story 1.6 — RbacRoute gate (AC2)", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  const renderAuditRoute = (initialRole: "Admin" | "Viewer" | null) => (
    <MemoryRouter initialEntries={["/audit"]}>
      <QueryClientProvider client={new QueryClient()}>
        <CurrentRoleProvider initialRole={initialRole}>
          <AppShell>
            <RbacRoute>
              <div data-testid="audit-content">audit content</div>
            </RbacRoute>
          </AppShell>
        </CurrentRoleProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

  it("renders the gated content for an Admin", () => {
    render(renderAuditRoute("Admin"));
    expect(screen.getByTestId("audit-content")).toBeInTheDocument();
    expect(screen.queryByTestId("rbac-denied")).toBeNull();
  });

  it("renders RbacDenied for a Viewer on /audit", () => {
    render(renderAuditRoute("Viewer"));
    expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-content")).toBeNull();
  });

  it("renders RbacDenied for an unauthenticated (null) role on /audit", () => {
    render(renderAuditRoute(null));
    expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
  });

  it("renders the content for any role on /dashboard (Monitor, roles: null)", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <QueryClientProvider client={new QueryClient()}>
          <CurrentRoleProvider initialRole="Viewer">
            <AppShell>
              <RbacRoute>
                <div data-testid="dashboard-content">dashboard content</div>
              </RbacRoute>
            </AppShell>
          </CurrentRoleProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument();
  });
});

describe("Story 1.6 — nav registry helpers (IA single source of truth)", () => {
  it("finds /audit under Operate → Operator, Admin", () => {
    const item = findNavItemForPath(NAV_GROUPS, "/audit");
    expect(item).not.toBeNull();
    expect(item?.roles).toEqual(["Operator", "Admin"]);
  });

  it("returns null for a path not in the IA (gate does not deny)", () => {
    expect(findNavItemForPath(NAV_GROUPS, "/somewhere/else")).toBeNull();
  });

  it("isPathAllowedForRole mirrors the sidebar filter", () => {
    // /audit → Operator / Admin
    expect(isPathAllowedForRole(NAV_GROUPS, "/audit", "Admin")).toBe(true);
    expect(isPathAllowedForRole(NAV_GROUPS, "/audit", "Operator")).toBe(true);
    expect(isPathAllowedForRole(NAV_GROUPS, "/audit", "Viewer")).toBe(false);
    expect(isPathAllowedForRole(NAV_GROUPS, "/audit", "Technician")).toBe(false);
    // /dashboard → any role (roles: null)
    expect(isPathAllowedForRole(NAV_GROUPS, "/dashboard", "Viewer")).toBe(true);
    expect(isPathAllowedForRole(NAV_GROUPS, "/dashboard", null)).toBe(true);
    // gated route + null role → deny
    expect(isPathAllowedForRole(NAV_GROUPS, "/audit", null)).toBe(false);
  });
});

describe("Story 1.6 — RbacRoute integrates with React Router", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  it("renders RbacDenied when the user navigates to /audit as a Viewer", () => {
    render(
      <MemoryRouter initialEntries={["/audit"]}>
        <QueryClientProvider client={new QueryClient()}>
          <CurrentRoleProvider initialRole="Viewer">
            <Routes>
              <Route
                path="/audit"
                element={
                  <AppShell>
                    <RbacRoute>
                      <div data-testid="audit-content">audit content</div>
                    </RbacRoute>
                  </AppShell>
                }
              />
            </Routes>
          </CurrentRoleProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-content")).toBeNull();
  });
});
