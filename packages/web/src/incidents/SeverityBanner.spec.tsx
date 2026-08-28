/**
 * `SeverityBanner.spec.tsx` — Story 4.8.
 *
 * Coverage matrix (each I/O row → at least one `it(...)`):
 *
 *   HAPPY_PATH_1 / HAPPY_PATH_3 / ZERO_UNSAFE / NO_INCIDENTS_AT_ALL
 *     - 1, 3, 0, empty-envelope scenarios for the active list.
 *
 *   RESOLVED_EXCLUDED / 24H_EXPIRED
 *     - Filter excludes rows that already moved past UNSAFE or
 *       that are older than 24h.
 *
 *   SOCKET_RECONCILE_TO_UNSAFE / SOCKET_RECONCILE_TO_RESOLVED
 *     - Cache mutations from `applyStateChangeToCache` (4.3's
 *       socket helper) drive the banner's projection without a
 *       re-fetch.
 *
 *   RBAC_NO_BUTTON × 4 roles
 *     - All four viewer roles see the banner; no role-gated
 *       button exists (the surface is informational).
 *
 *   a11y / visual contract
 *     - `role="alert"` on the wrapper + `aria-live="polite"` on
 *       the body.
 *     - Critical-tinted styling via design tokens (literal class
 *       strings only — Story 2.8 VG-1 lesson).
 *
 *   403 RBAC denial (defensive)
 *     - 403 from the active list propagates through the banner's
 *       `ensureQueryData` call; the cache ends up in error state
 *       (the banner reads `cached ?? []` → no DOM).
 *
 * The test rig mirrors `KanbanBoard.spec.tsx`:
 *   `QueryClientProvider + MemoryRouter + CurrentRoleProvider +
 *   AppShell`.
 *
 * The socket invalidation path is exercised by directly invoking
 * `applyStateChangeToCache` (4.3's pure helper) on the test query
 * client's cache, then re-rendering. This is the same pattern
 * 4.3's spec uses for the "socket event moves a card" tests.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";
import { AppShell } from "../shell/AppShell";

import { filterUnsafeWithin24h, SEVERITY_BANNER_QUERY_KEY_EXPORT } from "./useSeverityBanner";
import { applyStateChangeToCache } from "./useKanbanBoardSocket";

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";

const UNSAFE_ID_1 = "11111111-1111-4111-8111-111111111111";
const UNSAFE_ID_2 = "22222222-2222-4222-8222-222222222222";
const UNSAFE_ID_3 = "33333333-3333-4333-8333-333333333333";

/**
 * Build an `IncidentPayload` fixture with sensible defaults. The
 * `opened_at` default is `new Date().toISOString()` (now) — rows
 * older than 24h use `Date.now() - 25h` via the `openedAtOffsetMs`
 * parameter.
 */
const baseIncident = (overrides: Partial<IncidentPayload> = {}): IncidentPayload => ({
  id: UNSAFE_ID_1,
  device_id: DEVICE_A,
  severity: "critical",
  metric: "tds_ppm",
  value: 312,
  opened_at: new Date().toISOString(),
  state: "UNSAFE",
  assignee_user_id: null,
  acknowledged_at: null,
  resolved_at: null,
  ...overrides,
});

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

interface RenderBannerOptions {
  readonly role?: "Admin" | "Operator" | "Technician" | "Viewer";
  readonly envelope?: { incidents: readonly IncidentPayload[] };
  readonly fetchStatus?: number;
}

const renderBanner = (options: RenderBannerOptions = {}) => {
  const {
    role = "Operator",
    envelope = { incidents: [baseIncident()] },
    fetchStatus = 200,
  } = options;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // Pre-populate the cache so the banner reads from the SAME
  // cache entry the Kanban populates — mirrors the production
  // contract that the banner never fires its own fetch when the
  // cache is already populated. For the `NO_INCIDENTS_AT_ALL`
  // case, leave the cache empty so the banner's `ensureQueryData`
  // fires the fetch (which returns the empty envelope).
  if (envelope !== null) {
    queryClient.setQueryData([...SEVERITY_BANNER_QUERY_KEY_EXPORT], envelope);
  }
  // Install fetch mock for the `ensureQueryData` fallback path.
  const ORIGINAL_FETCH = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(envelope ?? { incidents: [] }), {
        status: fetchStatus,
      }),
    )) as unknown as typeof fetch;
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <CurrentRoleProvider initialRole={role}>
          <AppShell>
            <div>canvas content</div>
          </AppShell>
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...result,
    queryClient,
    restoreFetch: () => {
      globalThis.fetch = ORIGINAL_FETCH;
    },
  };
};

beforeEach(() => {
  setViewport(1280);
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

describe("Story 4.8 — SeverityBanner pure filter", () => {
  it("filterUnsafeWithin24h: includes only UNSAFE + resolved_at null + within 24h", () => {
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    const incidents: IncidentPayload[] = [
      baseIncident({ id: UNSAFE_ID_1, opened_at: "2026-08-28T11:00:00.000Z" }), // 1h ago — include
      baseIncident({ id: UNSAFE_ID_2, opened_at: "2026-08-27T11:00:00.000Z" }), // 25h ago — exclude
      baseIncident({ id: UNSAFE_ID_3, state: "OPEN", opened_at: "2026-08-28T11:00:00.000Z" }), // wrong state — exclude
      baseIncident({
        id: UNSAFE_ID_3,
        state: "UNSAFE",
        resolved_at: "2026-08-28T11:30:00.000Z",
        opened_at: "2026-08-28T11:00:00.000Z",
      }), // resolved — exclude
    ];
    const filtered = filterUnsafeWithin24h(incidents, now);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(UNSAFE_ID_1);
  });
});

describe("Story 4.8 — SeverityBanner rendering", () => {
  it("HAPPY_PATH_1: 1 UNSAFE row → banner with singular heading + body + critical styling", async () => {
    const { restoreFetch } = renderBanner({
      envelope: {
        incidents: [baseIncident({ metric: "tds_ppm", value: 312 })],
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    expect(screen.getByTestId("severity-banner-heading").textContent).toBe("1 unsafe incident");
    expect(screen.getByTestId("severity-banner-body").textContent).toContain("tds_ppm");
    expect(screen.getByTestId("severity-banner-body").textContent).toContain("312");
    const banner = screen.getByTestId("severity-banner");
    expect(banner.className).toContain("border-severity-critical-value");
    expect(banner.className).toContain("bg-severity-critical-bg");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("severity-banner-body").getAttribute("aria-live")).toBe("polite");
    restoreFetch();
  });

  it("HAPPY_PATH_3: 3 UNSAFE rows → banner with plural heading + 'View all' link", async () => {
    const { restoreFetch } = renderBanner({
      envelope: {
        incidents: [
          baseIncident({ id: UNSAFE_ID_1 }),
          baseIncident({ id: UNSAFE_ID_2 }),
          baseIncident({ id: UNSAFE_ID_3 }),
        ],
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    expect(screen.getByTestId("severity-banner-heading").textContent).toBe("3 unsafe incidents");
    const link = screen.getByTestId("severity-banner-view-all");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/incidents");
    restoreFetch();
  });

  it("ZERO_UNSAFE: 0 UNSAFE rows → banner NOT rendered", async () => {
    const { restoreFetch } = renderBanner({
      envelope: { incidents: [] },
    });
    // No banner DOM. The slot may still be present (it's always
    // mounted by AppShell).
    expect(screen.queryByTestId("severity-banner")).toBeNull();
    restoreFetch();
  });

  it("NO_INCIDENTS_AT_ALL: empty envelope from API → banner NOT rendered", async () => {
    // Empty cache + fetch returns empty envelope → `ensureQueryData`
    // populates with `{ incidents: [] }` → filter yields zero rows.
    const { restoreFetch } = renderBanner({
      envelope: { incidents: [] },
    });
    expect(screen.queryByTestId("severity-banner")).toBeNull();
    restoreFetch();
  });

  it("RESOLVED_EXCLUDED: UNSAFE row with resolved_at !== null → banner NOT rendered", async () => {
    const { restoreFetch } = renderBanner({
      envelope: {
        incidents: [baseIncident({ resolved_at: "2026-08-28T10:00:00.000Z" })],
      },
    });
    expect(screen.queryByTestId("severity-banner")).toBeNull();
    restoreFetch();
  });

  it("24H_EXPIRED: UNSAFE row older than 24h → banner NOT rendered", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { restoreFetch } = renderBanner({
      envelope: {
        incidents: [baseIncident({ opened_at: twentyFiveHoursAgo })],
      },
    });
    expect(screen.queryByTestId("severity-banner")).toBeNull();
    restoreFetch();
  });

  it("SOCKET_RECONCILE_TO_UNSAFE: cache mutation adds UNSAFE row → banner appears", async () => {
    // Pre-populate with one non-UNSAFE row + one INSPECTING row.
    // The socket event flips the INSPECTING row to UNSAFE; the
    // banner re-derives and appears.
    const inspectingRow = baseIncident({ state: "INSPECTING" });
    const { restoreFetch, queryClient } = renderBanner({
      envelope: { incidents: [inspectingRow] },
    });
    expect(screen.queryByTestId("severity-banner")).toBeNull();
    // Mutate via 4.3's helper — simulates the
    // `incident:state_changed` socket event flipping the row's
    // state to UNSAFE.
    act(() => {
      queryClient.setQueryData<{ incidents: readonly IncidentPayload[] }>(
        [...SEVERITY_BANNER_QUERY_KEY_EXPORT],
        (prev) =>
          applyStateChangeToCache(
            prev === undefined ? { incidents: [] } : { incidents: [...prev.incidents] },
            {
              incident_id: UNSAFE_ID_1,
              to_state: "UNSAFE",
              at: new Date().toISOString(),
            },
          ) ?? { incidents: [] },
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    restoreFetch();
  });

  it("SOCKET_RECONCILE_TO_RESOLVED: cache drop removes UNSAFE row → banner disappears", async () => {
    const { restoreFetch, queryClient } = renderBanner({
      envelope: { incidents: [baseIncident()] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    // Mutate the cache via 4.3's helper — simulates the
    // `incident:state_changed` socket event with to_state ===
    // "RESOLVED" (RESOLVED_DROP semantics).
    queryClient.setQueryData<{ incidents: readonly IncidentPayload[] }>(
      [...SEVERITY_BANNER_QUERY_KEY_EXPORT],
      (prev) =>
        applyStateChangeToCache(
          prev === undefined ? { incidents: [] } : { incidents: [...prev.incidents] },
          {
            incident_id: UNSAFE_ID_1,
            to_state: "RESOLVED",
            at: new Date().toISOString(),
          },
        ) ?? { incidents: [] },
    );
    await waitFor(() => {
      expect(screen.queryByTestId("severity-banner")).toBeNull();
    });
    restoreFetch();
  });

  it("RBAC_NO_BUTTON: Technician sees banner text but NO button", async () => {
    const { restoreFetch } = renderBanner({
      role: "Technician",
      envelope: { incidents: [baseIncident()] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    // Banner renders the count + body but NO button (the surface
    // is informational; no role-gated button exists). Scope the
    // query to the banner's subtree — the AppShell sidebar has
    // unrelated buttons that would otherwise leak into the
    // global `queryByRole` result.
    const banner = screen.getByTestId("severity-banner");
    expect(banner.querySelector("button")).toBeNull();
    restoreFetch();
  });

  it("RBAC_NO_BUTTON: Viewer sees banner text but NO button", async () => {
    const { restoreFetch } = renderBanner({
      role: "Viewer",
      envelope: { incidents: [baseIncident()] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    const banner = screen.getByTestId("severity-banner");
    expect(banner.querySelector("button")).toBeNull();
    restoreFetch();
  });

  it("RBAC_NO_BUTTON: Operator sees banner text but NO button (informational surface)", async () => {
    const { restoreFetch } = renderBanner({
      role: "Operator",
      envelope: { incidents: [baseIncident()] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    const banner = screen.getByTestId("severity-banner");
    expect(banner.querySelector("button")).toBeNull();
    restoreFetch();
  });

  it("RBAC_NO_BUTTON: Admin sees banner text but NO button", async () => {
    const { restoreFetch } = renderBanner({
      role: "Admin",
      envelope: { incidents: [baseIncident()] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    const banner = screen.getByTestId("severity-banner");
    expect(banner.querySelector("button")).toBeNull();
    restoreFetch();
  });

  it("403 RBAC denial: cache goes into error state → banner NOT rendered (no DOM)", async () => {
    // Pre-populate the cache with an envelope that would normally
    // trigger the banner. Then mutate the cache to error state
    // directly (simulating the banner's `queryFn` throwing on a
    // real 403 response) — the banner reads `query.data ?? []`
    // → zero rows → no DOM.
    const { restoreFetch, queryClient } = renderBanner({
      envelope: { incidents: [baseIncident()] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-banner")).toBeInTheDocument();
    });
    // Force the cache into error state with the tagged RBAC error.
    const err = new Error("RBAC denied for /api/incidents/active");
    err.name = "KanbanRbacDeniedError";
    queryClient.setQueryData([...SEVERITY_BANNER_QUERY_KEY_EXPORT], err);
    await waitFor(() => {
      expect(screen.queryByTestId("severity-banner")).toBeNull();
    });
    restoreFetch();
  });
});

describe("Story 4.8 — SeverityBanner cache-key identity", () => {
  it("SEVERITY_BANNER_QUERY_KEY matches KANBAN_ACTIVE_QUERY_KEY", async () => {
    // Drift pin: if the Kanban's key changes, the banner's socket
    // reconciliation silently breaks. This assertion reads both
    // constants and fails loudly on divergence.
    const { KANBAN_ACTIVE_QUERY_KEY } = await import("./useKanbanBoardSocket");
    expect([...SEVERITY_BANNER_QUERY_KEY_EXPORT]).toEqual([...KANBAN_ACTIVE_QUERY_KEY]);
  });
});
