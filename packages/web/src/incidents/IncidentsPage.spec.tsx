/**
 * `IncidentsPage.spec.tsx` — page-level chrome smoke test.
 *
 * `IncidentsPage` is the `/incidents` route wrapper that contributes
 * a `<PageHeader title="Incidents" />` above the `<KanbanBoard />`.
 * The board itself is exhaustively tested in `KanbanBoard.spec.tsx`
 * (column grouping, socket reconciliation, RBAC + error surfaces).
 * This spec pins only the page-level chrome so a regression that
 * drops the header (or mounts the board bare) is caught:
 *
 *   - `<h1>` with text "Incidents" is present.
 *   - The board root (`kanban-board-root`) is still rendered
 *     beneath the header — the wrapper must not hide it.
 *
 * The wrapping `<QueryClientProvider>` + `<MemoryRouter>` +
 * `<CurrentRoleProvider>` + `<AppShell>` mirrors the rig from
 * `KanbanBoard.spec.tsx` so the page renders the same as in
 * production.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";
import { AppShell } from "../shell/AppShell";

import { IncidentsPage } from "./IncidentsPage";

// `connectSocket` is invoked from `KanbanBoard` via
// `useKanbanBoardSocket`. We don't drive any socket events in this
// spec (the header smoke test doesn't need them), so a stub that
// satisfies the hook's interface is enough. The stub mirrors the
// pattern in `KanbanBoard.spec.tsx`.
vi.mock("../realtime/socketClient", () => ({
  connectSocket: () => ({
    on: () => undefined,
    off: () => undefined,
  }),
  disconnectSocket: () => undefined,
  _resetSocket: () => undefined,
  SOCKET_TOKEN_EXPIRED: "401 token_expired",
}));

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
  // Empty active list — the header smoke test doesn't care about
  // the column contents; we only need the page to mount.
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.endsWith("/api/incidents/active")) {
      return new Response(JSON.stringify({ incidents: [] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  _resetApiClientConfig();
  vi.restoreAllMocks();
});

const renderPage = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/incidents"]}>
        <CurrentRoleProvider initialRole="Admin" initialUserId={null}>
          <AppShell>
            <IncidentsPage />
          </AppShell>
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("IncidentsPage — page chrome", () => {
  it("renders an <h1> with title 'Incidents'", async () => {
    renderPage();
    // `PageHeader` renders the title as a `<h1>` with the
    // `page-header-incidents-title` testid. Wait for the board to
    // settle so the page tree is fully painted.
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-root")).toBeInTheDocument();
    });
    const heading = screen.getByTestId("page-header-incidents-title");
    expect(heading.tagName.toLowerCase()).toBe("h1");
    expect(heading).toHaveTextContent("Incidents");
  });

  it("renders the Kanban board beneath the page header", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-root")).toBeInTheDocument();
    });
    // Sanity: all four columns still render — the wrapper must
    // not interfere with the board's column layout.
    expect(screen.getByTestId("kanban-column-OPEN_CRITICAL")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-OPEN_WARNING")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-ACKNOWLEDGED")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-RESOLVED")).toBeInTheDocument();
  });
});
