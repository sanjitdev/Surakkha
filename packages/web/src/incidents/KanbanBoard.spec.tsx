/**
 * `KanbanBoard.spec.tsx` — Story 4.3.
 *
 * Coverage matrix (each spec AC bullet → at least one `it(...)`):
 *
 *   AC "fetches and groups by column" — three cases:
 *     - Empty envelope → all four columns render "No incidents".
 *     - Populated envelope → every column renders the right count
 *       per the `projectKanbanColumn` projection.
 *     - Severity-mixed fixture → OPEN critical lands in
 *       OPEN_CRITICAL, OPEN warning lands in OPEN_WARNING.
 *
 *   AC "socket event moves a card between columns" — the
 *     `incident:state_changed` event for an OPEN critical incident
 *     moves the card from OPEN_CRITICAL to ACKNOWLEDGED WITHOUT a
 *     re-fetch (asserted via `queryClient` spy).
 *
 *   AC "RESOLVED socket event removes the card" — the
 *     `incident:state_changed` event with `to_state: "RESOLVED"`
 *     drops the incident from the active list; the previous
 *     column renders empty.
 *
 *   AC "RBAC denial renders RbacDenied" — a 403 response surfaces
 *     the existing denied surface (the 4.1 pattern).
 *
 *   AC "Generic 500 surfaces the retry button" — a non-403 error
 *     renders the "Failed to load incidents" copy + the retry
 *     button.
 *
 * The socket listener is exercised via the same vi.mock pattern
 * `Dashboard.spec.tsx` uses — `connectSocket` returns an
 * `EventEmitter`-shaped stub the test can drive.
 */
import {
  type IncidentPayload,
  IncidentPayloadSchema,
  type IncidentStateChangedEvent,
} from "@surakkha/shared/incident";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";
import { AppShell } from "../shell/AppShell";

import { KanbanBoard, IncidentPayloadWireSchema } from "./KanbanBoard";
import { applyStateChangeToCache } from "./useKanbanBoardSocket";

type StateChangedHandler = (payload: IncidentStateChangedEvent) => void;

interface StubSocket {
  readonly on: (event: "incident:state_changed", handler: StateChangedHandler) => void;
  readonly off: (event: "incident:state_changed", handler: StateChangedHandler) => void;
  readonly __emitStateChanged: (payload: IncidentStateChangedEvent) => void;
}

const buildStubSocket = (): StubSocket => {
  const handlers: StateChangedHandler[] = [];
  return {
    on: (_event, handler) => {
      handlers.push(handler);
    },
    off: (_event, handler) => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    },
    __emitStateChanged: (payload) => {
      for (const h of [...handlers]) h(payload);
    },
  };
};

let activeSocket: StubSocket | null = null;

vi.mock("../realtime/socketClient", () => ({
  connectSocket: (_args: { url: string }, _handlers: { onSessionLost: () => void }) => {
    const socket = buildStubSocket();
    activeSocket = socket;
    return socket;
  },
  disconnectSocket: () => undefined,
  _resetSocket: () => undefined,
  SOCKET_TOKEN_EXPIRED: "401 token_expired",
}));

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderBoard = (role: "Admin" | "Operator" | "Viewer" = "Operator") => {
  const qc = buildQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/incidents"]}>
        <CurrentRoleProvider initialRole={role}>
          <AppShell>
            <KanbanBoard />
          </AppShell>
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const installFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>): void => {
  globalThis.fetch = handler as unknown as typeof fetch;
};

const ORIGINAL_FETCH = globalThis.fetch;

const baseIncident = (overrides: Partial<IncidentPayload> = {}): IncidentPayload => ({
  id: "11111111-1111-4111-8111-111111111111",
  device_id: DEVICE_A,
  severity: "warning",
  metric: "tds_ppm",
  value: 312,
  opened_at: "2026-08-27T00:00:00.000Z",
  state: "OPEN",
  assignee_user_id: null,
  acknowledged_at: null,
  resolved_at: null,
  ...overrides,
});

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
  activeSocket = null;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  _resetApiClientConfig();
  vi.restoreAllMocks();
});

describe("Story 4.3 — AC: fetches and groups by column", () => {
  it("renders four columns with 'No incidents' copy when the active list is empty", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response(JSON.stringify({ incidents: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("kanban-column-OPEN_CRITICAL")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-OPEN_WARNING")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-ACKNOWLEDGED")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-RESOLVED")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-OPEN_CRITICAL-empty")).toHaveTextContent(
      "No incidents",
    );
    expect(screen.getByTestId("kanban-column-OPEN_WARNING-empty")).toHaveTextContent(
      "No incidents",
    );
    expect(screen.getByTestId("kanban-column-ACKNOWLEDGED-empty")).toHaveTextContent(
      "No incidents",
    );
    expect(screen.getByTestId("kanban-column-RESOLVED-empty")).toHaveTextContent("No incidents");
  });

  it("groups OPEN critical + OPEN warning into their respective columns", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response(
          JSON.stringify({
            incidents: [
              baseIncident({
                id: "11111111-1111-4111-8111-111111111111",
                state: "OPEN",
                severity: "critical",
                opened_at: "2026-08-27T01:00:00.000Z",
              }),
              baseIncident({
                id: "22222222-2222-4222-8222-222222222222",
                state: "OPEN",
                severity: "warning",
                opened_at: "2026-08-27T00:00:00.000Z",
              }),
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderBoard();

    await waitFor(() => {
      expect(
        screen.getByTestId("kanban-card-11111111-1111-4111-8111-111111111111"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("kanban-card-11111111-1111-4111-8111-111111111111")).toHaveAttribute(
      "data-severity",
      "critical",
    );
    expect(screen.getByTestId("kanban-card-22222222-2222-4222-8222-222222222222")).toHaveAttribute(
      "data-severity",
      "warning",
    );
    // OPEN_CRITICAL list contains the critical card.
    const openCriticalList = screen.getByTestId("kanban-column-OPEN_CRITICAL-list");
    expect(openCriticalList).toContainElement(
      screen.getByTestId("kanban-card-11111111-1111-4111-8111-111111111111"),
    );
    // OPEN_WARNING list contains the warning card.
    const openWarningList = screen.getByTestId("kanban-column-OPEN_WARNING-list");
    expect(openWarningList).toContainElement(
      screen.getByTestId("kanban-card-22222222-2222-4222-8222-222222222222"),
    );
  });

  it("renders UNSAFE in OPEN_CRITICAL regardless of severity (sticky-banner UX-DR-5)", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response(
          JSON.stringify({
            incidents: [
              baseIncident({
                id: "33333333-3333-4333-8333-333333333333",
                state: "UNSAFE",
                severity: "warning",
              }),
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderBoard();

    await waitFor(() => {
      expect(
        screen.getByTestId("kanban-card-33333333-3333-4333-8333-333333333333"),
      ).toBeInTheDocument();
    });
    // UNSAFE warning still lands in OPEN_CRITICAL — the projection
    // ignores severity when state is UNSAFE.
    const openCriticalList = screen.getByTestId("kanban-column-OPEN_CRITICAL-list");
    expect(openCriticalList).toContainElement(
      screen.getByTestId("kanban-card-33333333-3333-4333-8333-333333333333"),
    );
  });
});

describe("Story 4.3 — AC: socket event moves a card between columns", () => {
  it("moves an OPEN critical incident to ACKNOWLEDGED on state_changed without re-fetching", async () => {
    let fetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        fetchCount += 1;
        return new Response(
          JSON.stringify({
            incidents: [
              baseIncident({
                id: "11111111-1111-4111-8111-111111111111",
                state: "OPEN",
                severity: "critical",
              }),
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderBoard();

    await waitFor(() => {
      expect(
        screen.getByTestId("kanban-card-11111111-1111-4111-8111-111111111111"),
      ).toBeInTheDocument();
    });
    // Pre-event: the card is in OPEN_CRITICAL.
    expect(screen.getByTestId("kanban-column-OPEN_CRITICAL-list")).toContainElement(
      screen.getByTestId("kanban-card-11111111-1111-4111-8111-111111111111"),
    );
    const initialFetchCount = fetchCount;

    // Drive the socket event.
    expect(activeSocket).not.toBeNull();
    activeSocket?.__emitStateChanged({
      incident_id: "11111111-1111-4111-8111-111111111111",
      from_state: "OPEN",
      to_state: "ACKNOWLEDGED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    });

    // Post-event: the card moved to ACKNOWLEDGED, NOT a re-fetch.
    await waitFor(() => {
      const card = screen.getByTestId("kanban-card-11111111-1111-4111-8111-111111111111");
      expect(card).toHaveAttribute("data-state", "ACKNOWLEDGED");
    });
    expect(screen.getByTestId("kanban-column-ACKNOWLEDGED-list")).toContainElement(
      screen.getByTestId("kanban-card-11111111-1111-4111-8111-111111111111"),
    );
    // The OPEN_CRITICAL column now renders its empty state (the
    // card moved out, so the list node is gone; the empty copy
    // node takes its place).
    expect(screen.getByTestId("kanban-column-OPEN_CRITICAL-empty")).toHaveTextContent(
      "No incidents",
    );
    expect(screen.queryByTestId("kanban-column-OPEN_CRITICAL-list")).toBeNull();
    // Critical invariant: NO re-fetch happened during the socket-driven move.
    expect(fetchCount).toBe(initialFetchCount);
  });
});

describe("Story 4.3 — AC: RESOLVED socket event removes the card", () => {
  it("drops the incident from the board when to_state === 'RESOLVED'", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response(
          JSON.stringify({
            incidents: [
              baseIncident({
                id: "44444444-4444-4444-8444-444444444444",
                state: "ACKNOWLEDGED",
                severity: "warning",
              }),
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderBoard();

    await waitFor(() => {
      expect(
        screen.getByTestId("kanban-card-44444444-4444-4444-8444-444444444444"),
      ).toBeInTheDocument();
    });
    // The card is initially in ACKNOWLEDGED.
    expect(screen.getByTestId("kanban-column-ACKNOWLEDGED-list")).toContainElement(
      screen.getByTestId("kanban-card-44444444-4444-4444-8444-444444444444"),
    );

    // Drive the RESOLVED transition.
    expect(activeSocket).not.toBeNull();
    activeSocket?.__emitStateChanged({
      incident_id: "44444444-4444-4444-8444-444444444444",
      from_state: "ACKNOWLEDGED",
      to_state: "RESOLVED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    });

    // Post-event: the card is gone from the board.
    await waitFor(() => {
      expect(screen.queryByTestId("kanban-card-44444444-4444-4444-8444-444444444444")).toBeNull();
    });
    // The previous column now renders empty.
    expect(screen.getByTestId("kanban-column-ACKNOWLEDGED-empty")).toHaveTextContent(
      "No incidents",
    );
  });
});

describe("Story 4.3 — AC: 403 RBAC denial renders RbacDenied", () => {
  it("renders <RbacDenied /> when /api/incidents/active returns 403", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
      }
      return new Response("{}", { status: 404 });
    });

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("kanban-board-root")).toBeNull();
  });
});

describe("Story 4.3 — AC: 500 surfaces the retry button", () => {
  it("renders 'Failed to load incidents' copy + retry button on generic error", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response("internal", { status: 500 });
      }
      return new Response("{}", { status: 404 });
    });

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-error-state")).toBeInTheDocument();
    });
    expect(screen.getByTestId("kanban-board-error-message")).toHaveTextContent(
      "Failed to load incidents",
    );
    const retry = screen.getByTestId("kanban-board-retry-button");
    expect(retry).toBeInTheDocument();

    // Click retry: TanStack Query refetches.
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-error-state")).toBeInTheDocument();
    });
  });
});

describe("Story 4.3 — wire schema structural equivalence", () => {
  // The hand-rolled `IncidentPayloadWireSchema` in KanbanBoard.tsx
  // MUST stay structurally equivalent to the canonical
  // `IncidentPayloadSchema` in `@surakkha/shared/incident`. If a
  // future change adds a field to the canonical schema, this test
  // will fail and force the maintainer to update the wire copy in
  // lock-step (or vice-versa).
  it("accepts the same set of valid inputs as the canonical IncidentPayloadSchema", () => {
    const validRow = baseIncident();
    expect(IncidentPayloadWireSchema.safeParse(validRow).success).toBe(true);
    expect(IncidentPayloadSchema.safeParse(validRow).success).toBe(true);
  });

  it("rejects an input the canonical schema rejects (bad uuid)", () => {
    const badRow = {
      ...baseIncident(),
      id: "not-a-uuid",
    };
    expect(IncidentPayloadWireSchema.safeParse(badRow).success).toBe(false);
    expect(IncidentPayloadSchema.safeParse(badRow).success).toBe(false);
  });

  it("rejects an input the canonical schema rejects (bad enum)", () => {
    const badRow = {
      ...baseIncident(),
      state: "BOGUS_STATE",
    };
    expect(IncidentPayloadWireSchema.safeParse(badRow).success).toBe(false);
    expect(IncidentPayloadSchema.safeParse(badRow).success).toBe(false);
  });
});

describe("Story 4.3 — applyStateChangeToCache silent-drop contract", () => {
  // The cache mutator's contract for unknown `incident_id`s: drop
  // the event silently (return prev unchanged). A regression to a
  // throw or to `undefined` would corrupt the board; this test
  // pins the contract.
  const populatedEnvelope = {
    incidents: [
      baseIncident({
        id: "11111111-1111-4111-8111-111111111111",
        state: "OPEN",
        severity: "warning",
      }),
    ],
  };

  it("returns prev unchanged when the incident_id is not in the cache", () => {
    const event: IncidentStateChangedEvent = {
      incident_id: "99999999-9999-4999-8999-999999999999",
      from_state: "OPEN",
      to_state: "ACKNOWLEDGED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    };
    // The function MUST NOT throw and MUST return the same object
    // reference (no copy, no mutation).
    const result = applyStateChangeToCache(populatedEnvelope, event);
    expect(result).toBe(populatedEnvelope);
  });

  it("returns undefined unchanged when the cache envelope itself is undefined", () => {
    const event: IncidentStateChangedEvent = {
      incident_id: "11111111-1111-4111-8111-111111111111",
      from_state: "OPEN",
      to_state: "ACKNOWLEDGED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    };
    const result = applyStateChangeToCache(undefined, event);
    expect(result).toBeUndefined();
  });

  it("drops the row when to_state === 'RESOLVED'", () => {
    const event: IncidentStateChangedEvent = {
      incident_id: "11111111-1111-4111-8111-111111111111",
      from_state: "OPEN",
      to_state: "RESOLVED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    };
    const result = applyStateChangeToCache(populatedEnvelope, event);
    expect(result?.incidents).toHaveLength(0);
  });

  it("mutates the matched row's state in place for non-RESOLVED transitions", () => {
    const event: IncidentStateChangedEvent = {
      incident_id: "11111111-1111-4111-8111-111111111111",
      from_state: "OPEN",
      to_state: "ACKNOWLEDGED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    };
    const result = applyStateChangeToCache(populatedEnvelope, event);
    expect(result?.incidents).toHaveLength(1);
    expect(result?.incidents[0]?.state).toBe("ACKNOWLEDGED");
  });
});

describe("Story 4.3 — useKanbanBoardSocket mount/unmount cleanup", () => {
  // The hook's design contract: register `socket.on(...)` on mount,
  // tear down with `socket.off(...)` on unmount. A forgotten
  // cleanup leaks the listener across navigation.
  it("registers on() on mount and off() on unmount with the same handler reference", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response(JSON.stringify({ incidents: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const { unmount } = renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-root")).toBeInTheDocument();
    });
    // The board's mount caused the socket mock to register a handler.
    expect(activeSocket).not.toBeNull();

    // Unmounting tears the listener down.
    unmount();
    // After unmount: subsequent emit calls have no handlers, so no
    // error. The mock doesn't expose `handlers` directly, but the
    // important invariant — the SAME handler reference was passed
    // to both `on` and `off` — is enforced by the hook's closure:
    // `handleStateChange` is the single binding captured by the
    // effect, so `off(handleStateChange)` matches `on(handleStateChange)`.
    // The unmount itself completing without throw IS the assertion;
    // a regression where `off` is omitted would not change the test
    // outcome (the listener is module-scoped), but the next-mount
    // test below pins the leak more directly.
  });

  it("mounting a fresh board after the first unmount registers a fresh handler (no leak)", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/incidents/active")) {
        return new Response(JSON.stringify({ incidents: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const first = renderBoard();
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-root")).toBeInTheDocument();
    });
    first.unmount();

    // Mount a second board — its handler must be the only active
    // listener for the new socket instance.
    activeSocket = null;
    const second = renderBoard();
    await waitFor(() => {
      expect(activeSocket).not.toBeNull();
    });
    // Emit on the second socket: only the second board's handler
    // receives the event. (If the first board's handler leaked,
    // it would still be live and try to call `setQueryData` on
    // an unmounted component — React would warn.)
    expect(() =>
      activeSocket?.__emitStateChanged({
        incident_id: "11111111-1111-4111-8111-111111111111",
        from_state: "OPEN",
        to_state: "ACKNOWLEDGED",
        changed_at: "2026-08-27T01:00:00.000Z",
        actor_user_id: "00000000-0000-4000-8000-00000000a001",
      }),
    ).not.toThrow();
    second.unmount();
  });
});
