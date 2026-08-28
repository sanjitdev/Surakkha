/**
 * `AppShell` slot stacking — Story 2.9 (extended by Story 4.8).
 *
 * Coverage:
 *   - `connection-state-banner-slot` renders ABOVE `severity-banner-slot`
 *     in DOM order (regression guard for Epic 4 stacking).
 *   - `ConnectionStateBanner` is the direct child of the slot — no
 *     wrapper elements in between.
 *   - The slot exists on initial render even when `isConnected` is
 *     `true` (the banner is hidden, but the slot wrapper is always
 *     present so Epic 4 can re-use the same mount point).
 *   - `severity-banner-slot` sits BELOW `connection-state-banner-slot`
 *     AND ABOVE the `<TopBar />` in DOM order (Story 4.8 — Epic 4
 *     stacking extends 2.9 with the real `SeverityBanner`).
 *   - `SeverityBanner` is the direct child of the severity-banner-slot
 *     — no wrapper elements in between (Story 4.8 mirroring the 2.9
 *     direct-child contract).
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useConnectionStateStore } from "../realtime/connectionStateStore";
import { KANBAN_ACTIVE_QUERY_KEY } from "../incidents/useKanbanBoardSocket";

import { AppShell } from "./AppShell";

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

const renderShell = () => {
  // Story 4.8 — SeverityBanner mounts a TanStack `useQuery`; the
  // test rig supplies a fresh `QueryClient` per render so the
  // shared cache does not bleed between tests. The query stays
  // in `idle` state (no `apiFetch` is mocked here; the banner's
  // hook reads `data ?? []` and yields zero-count → null DOM,
  // matching the existing 2.9 test's "slot has 0 children when
  // banner is hidden" expectation).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell currentRole="Admin">
            <div>canvas content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
};

/**
 * Story 4.8 — render the shell with the active-list cache pre-
 * populated with a single UNSAFE row so the `SeverityBanner` mounts
 * inside its slot. Mirrors the pattern in
 * `SeverityBanner.spec.tsx:139` (the `renderBanner` helper).
 */
const renderShellWithUnsafeBanner = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const unsafeRow: IncidentPayload = {
    id: "11111111-1111-4111-8111-111111111111",
    device_id: "9b1c4f00-0000-4000-8000-000000000001",
    severity: "critical",
    metric: "tds_ppm",
    value: 312,
    opened_at: new Date().toISOString(),
    state: "UNSAFE",
    assignee_user_id: null,
    acknowledged_at: null,
    resolved_at: null,
  };
  queryClient.setQueryData([...KANBAN_ACTIVE_QUERY_KEY], {
    incidents: [unsafeRow],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell currentRole="Admin">
          <div>canvas content</div>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Story 2.9 — AppShell banner-slot stacking", () => {
  beforeEach(() => {
    setViewport(1280);
    useConnectionStateStore.setState({
      isConnected: true,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      retryAttempt: 0,
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders both the connection-state-banner-slot and the severity-banner-slot", () => {
    renderShell();
    expect(screen.getByTestId("connection-state-banner-slot")).toBeInTheDocument();
    expect(screen.getByTestId("severity-banner-slot")).toBeInTheDocument();
  });

  it("connection-state-banner-slot is positioned ABOVE severity-banner-slot in DOM order", () => {
    renderShell();
    const connectionSlot = screen.getByTestId("connection-state-banner-slot");
    const severitySlot = screen.getByTestId("severity-banner-slot");

    // `compareDocumentPosition`: connectionSlot BEFORE severitySlot
    // → `connectionSlot.compareDocumentPosition(severitySlot)` has the
    // DOCUMENT_POSITION_FOLLOWING bit set.
    expect(
      connectionSlot.compareDocumentPosition(severitySlot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The reverse — severitySlot is NOT before connectionSlot.
    expect(
      severitySlot.compareDocumentPosition(connectionSlot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(0);
  });

  it("ConnectionStateBanner is the direct child of connection-state-banner-slot (no wrapper)", () => {
    // With `isConnected: true`, the banner returns null → slot has
    // 0 children but is still mounted. The wrapper-less contract
    // is "slot ↔ banner"; the slot exists at the right mount point
    // even when the banner is hidden.
    const { rerender, queryClient } = renderShell();
    const slot = screen.getByTestId("connection-state-banner-slot");
    expect(slot.children).toHaveLength(0);

    // Flip the state so the banner mounts. Re-rendering the same
    // tree (no second `render`) keeps the slot element stable —
    // the banner is appended inside it, with no wrapper between.
    useConnectionStateStore.setState({ isConnected: false });
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell currentRole="Admin">
            <div>canvas content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const banner = screen.getByTestId("connection-state-banner");
    expect(banner).toBeInTheDocument();
    // The slot element in the DOM is the same node we grabbed
    // before the state flip — query the parent from the banner's
    // perspective instead (the slot may have been re-emitted by
    // the rerender but its identity holds within one tree).
    expect(banner.parentElement).toBe(slot);
  });
});

describe("Story 4.8 — SeverityBanner slot stacking (Epic 4 extension of 2.9)", () => {
  beforeEach(() => {
    setViewport(1280);
    useConnectionStateStore.setState({
      isConnected: true,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      retryAttempt: 0,
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("severity-banner-slot sits BELOW connection-state-banner-slot AND ABOVE TopBar in DOM order", () => {
    renderShellWithUnsafeBanner();
    const connectionSlot = screen.getByTestId("connection-state-banner-slot");
    const severitySlot = screen.getByTestId("severity-banner-slot");
    const topBar = screen.getByTestId("topbar");

    // severitySlot follows connectionSlot in document order.
    expect(
      connectionSlot.compareDocumentPosition(severitySlot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // topBar follows severitySlot in document order — the slot
    // lives in the strip ABOVE the sticky TopBar, matching the
    // AppShell.tsx:88-95 mount order.
    expect(
      severitySlot.compareDocumentPosition(topBar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // And the reverse: connectionSlot does NOT follow severitySlot,
    // topBar does NOT follow connectionSlot through severitySlot.
    expect(
      severitySlot.compareDocumentPosition(connectionSlot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(0);
  });

  it("SeverityBanner is the direct child of severity-banner-slot (no wrapper)", () => {
    // With no UNSAFE rows in the cache, the slot has 0 children
    // (banner returns null) but the slot itself stays mounted —
    // mirrors the 2.9 ConnectionStateBanner direct-child contract
    // from the empty-state branch.
    const { rerender, queryClient } = renderShell();
    const slot = screen.getByTestId("severity-banner-slot");
    expect(slot.children).toHaveLength(0);

    // Populate the cache with a UNSAFE row → banner mounts inside
    // the slot with NO wrapper element between them. Mirrors the
    // 2.9 ConnectionStateBanner direct-child test at the top of
    // this file: the slot identity is stable across the cache
    // mutation within one tree, so we re-grab the banner and
    // assert the parent is the slot we captured before.
    queryClient.setQueryData([...KANBAN_ACTIVE_QUERY_KEY], {
      incidents: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          device_id: "9b1c4f00-0000-4000-8000-000000000001",
          severity: "critical",
          metric: "tds_ppm",
          value: 312,
          opened_at: new Date().toISOString(),
          state: "UNSAFE",
          assignee_user_id: null,
          acknowledged_at: null,
          resolved_at: null,
        },
      ],
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell currentRole="Admin">
            <div>canvas content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const banner = screen.getByTestId("severity-banner");
    expect(banner).toBeInTheDocument();
    // The banner's parentElement is the SAME slot node we grabbed
    // before the cache flip — no wrapper div crept in between.
    expect(banner.parentElement).toBe(slot);
  });
});
