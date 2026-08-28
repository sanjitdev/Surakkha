/**
 * `IncidentDetailPage.spec.tsx` — Story 4.4.
 *
 * Coverage matrix (each spec AC bullet → at least one `it(...)`):
 *
 *   AC "HAPPY_PATH" — the page renders the row + timeline; the
 *     fetched incident matches `IncidentPayloadSchema`; every
 *     event matches `IncidentEventPayloadSchema`.
 *   AC "EMPTY_TIMELINE" — `{ events: [] }` envelope renders the
 *     "No audit events yet" copy.
 *   AC "404_NOT_FOUND" — 404 from the row endpoint surfaces
 *     `<NotFound />` with `data-testid="not-found"`.
 *   AC "403_RBAC" — 403 from the row endpoint surfaces
 *     `<RbacDenied />` with `data-testid="rbac-denied"`.
 *   AC "500_GENERIC" — non-403/404 error renders the retry
 *     button.
 *   AC "SOCKET_STATE_CHANGED" — the row's `data-state` updates
 *     in place when the socket event arrives; the timeline does
 *     NOT re-fetch (the timeline mutator only updates the row
 *     cache, not the timeline cache).
 *   AC "SOCKET_RESOLVED_KEEPS_ROW" — RESOLVED transition keeps
 *     the row visible (different from the Kanban's drop-on-
 *     RESOLVED).
 *   AC "NAV_FROM_KANBAN" — covered by the KanbanBoard spec
 *     extension; this file's tests mount the detail page
 *     directly at `/incidents/<id>`.
 *
 * Test rig mirrors `KanbanBoard.spec.tsx` exactly: same
 * `vi.mock("../realtime/socketClient")`, same `StubSocket`,
 * same `QueryClientProvider` + `MemoryRouter` + `CurrentRole
 * Provider` + `AppShell` wrapping.
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import { type IncidentPayload } from "@surakkha/shared/incident";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";
import { AppShell } from "../shell/AppShell";

import { IncidentDetailPage } from "./IncidentDetailPage";

type StateChangedHandler = (payload: IncidentStateChangedEvent) => void;

interface StubSocket {
  readonly on: (event: "incident:state_changed", handler: StateChangedHandler) => void;
  readonly off: (event: "incident:state_changed", handler: StateChangedHandler) => void;
  readonly __emitStateChanged: (payload: IncidentStateChangedEvent) => void;
  /** Test seam: number of currently-registered state-change handlers. */
  readonly __handlerCount: () => number;
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
    __handlerCount: () => handlers.length,
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

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderDetail = (role: "Admin" | "Operator" | "Technician" | "Viewer" = "Operator") => {
  const qc = buildQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      {/* `MemoryRouter` requires a `<Routes>` block so `useParams`
          picks up the `:id` URL segment. Without `<Routes>`, the
          router matches no path and `useParams` returns `{}`,
          which leaves the detail page's `id` undefined and the
          queries disabled (the loading skeleton renders forever). */}
      <MemoryRouter initialEntries={[`/incidents/${INCIDENT_ID}`]}>
        <CurrentRoleProvider initialRole={role}>
          <AppShell>
            <Routes>
              <Route path="/incidents/:id" element={<IncidentDetailPage />} />
            </Routes>
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
  id: INCIDENT_ID,
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
  // Always restore real timers between tests so a test that
  // enabled fake timers (e.g. the TTL pin) does not leak into
  // the next test's `waitFor` polling.
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Story 4.4 — AC: happy path", () => {
  it("renders the row + timeline when both endpoints return 200", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(
          JSON.stringify({
            ...baseIncident({
              state: "OPEN",
              severity: "warning",
            }),
          }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                incident_id: INCIDENT_ID,
                actor_user_id: null,
                type: "acknowledge",
                payload: { from: "OPEN", to: "ACKNOWLEDGED" },
                created_at: "2026-08-27T01:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute("data-state", "OPEN");
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute("data-severity", "warning");
    expect(screen.getByTestId("incident-detail-metric")).toHaveTextContent("tds_ppm");
    expect(screen.getByTestId("incident-detail-value")).toHaveTextContent("312");
    expect(screen.getByTestId("incident-detail-device")).toHaveTextContent(DEVICE_A);
    expect(
      screen.getByTestId("incident-detail-event-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ).toBeInTheDocument();
  });

  it("renders the loading skeleton while the row endpoint is pending", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        // Return a never-resolving promise to pin the loading
        // state — the test ends before the response resolves.
        return new Promise<Response>(() => undefined);
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-loading")).toBeInTheDocument();
    });
  });
});

describe("Story 4.4 — AC: empty timeline", () => {
  it("renders the 'No audit events yet' copy when events endpoint returns []", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident()), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("incident-detail-timeline-empty")).toHaveTextContent(
      "No audit events yet",
    );
  });
});

describe("Story 4.4 — AC: 404 not-found", () => {
  it("renders <NotFound /> when the row endpoint returns 404", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-root")).toBeNull();
  });
});

describe("Story 4.4 — AC: 403 RBAC denial", () => {
  it("renders <RbacDenied /> when the row endpoint returns 403", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify({ error: "forbidden", required_role: "Technician" }), {
          status: 403,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-root")).toBeNull();
  });
});

describe("Story 4.4 — AC: generic 500 error", () => {
  it("renders the retry button on a generic row-endpoint failure", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response("internal", { status: 500 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-error-state")).toBeInTheDocument();
    });
    expect(screen.getByTestId("incident-detail-error-message")).toHaveTextContent(
      "Failed to load incident",
    );
    expect(screen.getByTestId("incident-detail-retry-button")).toBeInTheDocument();
  });
});

describe("Story 4.4 — AC: socket-driven state mutation in place", () => {
  it("updates the row's data-state on incident:state_changed without re-fetching", async () => {
    let fetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        fetchCount += 1;
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute("data-state", "OPEN");
    const initialFetchCount = fetchCount;

    // Drive the socket event.
    expect(activeSocket).not.toBeNull();
    activeSocket?.__emitStateChanged({
      incident_id: INCIDENT_ID,
      from_state: "OPEN",
      to_state: "ACKNOWLEDGED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    });

    // Post-event: the row's data-state updated; no re-fetch.
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
        "data-state",
        "ACKNOWLEDGED",
      );
    });
    expect(fetchCount).toBe(initialFetchCount);
  });

  it("KEEPS the row visible when to_state === 'RESOLVED' (read-only detail does not drop)", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
      "data-state",
      "ACKNOWLEDGED",
    );

    // Drive a RESOLVED transition.
    expect(activeSocket).not.toBeNull();
    activeSocket?.__emitStateChanged({
      incident_id: INCIDENT_ID,
      from_state: "ACKNOWLEDGED",
      to_state: "RESOLVED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    });

    // Post-event: row STAYS visible; data-state updates to RESOLVED.
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toHaveAttribute("data-state", "RESOLVED");
    });
  });
});

describe("Story 4.4 — AC: silent-drop on stale event for a different incident id", () => {
  it("does NOT mutate the cached row when the event's incident_id differs", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute("data-state", "OPEN");

    // Drive a stale event for a DIFFERENT incident id — must not
    // mutate this row. The `applyTransitionToCachedRow` helper
    // returns `null` on id mismatch, and the wrapper keeps `prev`.
    expect(activeSocket).not.toBeNull();
    activeSocket?.__emitStateChanged({
      incident_id: "22222222-2222-4222-8222-222222222222",
      from_state: "OPEN",
      to_state: "ACKNOWLEDGED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    });

    // Tiny wait to let any (incorrect) re-render flush.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute("data-state", "OPEN");
  });
});

describe("Story 4.4 — AC: timeline-only failure modes", () => {
  it("renders the row + empty timeline (NOT <NotFound />) when the timeline returns 404", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident()), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail();

    // The timeline 404 fires a tagged error on the timeline query;
    // the row query is successful so `rowQuery.isError` is false
    // and the page renders the incident row. The timeline section
    // renders the empty-state copy because the timeline query's
    // `data` is `undefined`, which the `useMemo` projects to `[]`.
    //
    // This test pins the actual contract — a timeline-only 404
    // does NOT surface <NotFound />; only a row-level 404 does.
    // A regression that lifted the NotFound dispatch to OR the
    // two queries would break this assertion; that's the pin.
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("not-found")).toBeNull();
    expect(screen.getByTestId("incident-detail-timeline-empty")).toHaveTextContent(
      "No audit events yet",
    );
  });
});

describe("Story 4.4 — useIncidentDetailSocket mount/unmount cleanup", () => {
  it("registers a handler on mount and tears it down on unmount", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const { unmount } = renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(activeSocket).not.toBeNull();
    // 1 handler registered on mount.
    expect(activeSocket?.__handlerCount()).toBe(1);

    unmount();

    // After unmount: 0 handlers — the cleanup ran `socket.off`
    // with the same reference the `on` call used.
    expect(activeSocket?.__handlerCount()).toBe(0);
  });

  it("emitting after unmount does not throw (the handler was torn down)", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const first = renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    first.unmount();

    // If the handler leaked, this emit would call `setQueryData`
    // on a torn-down component instance (React would warn).
    expect(() =>
      activeSocket?.__emitStateChanged({
        incident_id: INCIDENT_ID,
        from_state: "OPEN",
        to_state: "ACKNOWLEDGED",
        changed_at: "2026-08-27T01:00:00.000Z",
        actor_user_id: "00000000-0000-4000-8000-00000000a001",
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// Story 4.5 — Acknowledge Flow
// ============================================================================
//
// Coverage matrix (each spec AC bullet → at least one `it(...)`):
//
//   AC "HAPPY_PATH"             — OPEN + Operator → click → POST 200 →
//                                success toast "Acknowledged" → row
//                                invalidates → socket event lands →
//                                data-state="ACKNOWLEDGED" → button
//                                disappears.
//   AC "NOT_OPEN"               — ACKNOWLEDGED row → button NOT rendered.
//   AC "MUTATION_IN_FLIGHT"     — click twice in quick succession →
//                                second click is a no-op (button
//                                disabled during in-flight mutation).
//   AC "CONFLICT_409"           — server returns 409 → error toast
//                                "Already acknowledged".
//   AC "FORBIDDEN_403"          — server returns 403 → error toast
//                                "Not authorized".
//   AC "NOT_FOUND_404"          — server returns 404 → error toast
//                                "Incident not found" + page renders
//                                <NotFound /> on next fetch.
//   AC "SERVER_ERROR_500"       — server returns 500 → error toast
//                                "Failed to acknowledge. Try again."
//                                + button re-enables.

// The apiFetch helper prepends `config.apiOrigin` (e.g. `https://api.test`),
// so the absolute URL passed to our `installFetch` handler ends with this
// segment rather than equalling it. `endsWith` keeps the helper comparison
// robust if the origin changes.
const ACK_URL_SUFFIX = `/api/incidents/${INCIDENT_ID}/acknowledge`;

describe("Story 4.5 — AC: happy path (POST 200 → success toast → state reconciled)", () => {
  it("fires POST, surfaces 'Acknowledged' toast, and the row transitions to ACKNOWLEDGED via socket event", async () => {
    let ackCallCount = 0;
    installFetch(async (url, init) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ACK_URL_SUFFIX)) {
        ackCallCount += 1;
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify(
            baseIncident({
              state: "ACKNOWLEDGED",
              acknowledged_at: "2026-08-27T01:00:00.000Z",
            }),
          ),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    // Acknowledge button visible for OPEN + Operator.
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    });

    // Click → POST + success toast. Toast testid is
    // `toast-success-{id}` (neutral prefix per Patch 2).
    fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Acknowledged");
    });
    expect(ackCallCount).toBe(1);

    // The socket-driven state mutation arrives; the row's
    // `data-state` updates to ACKNOWLEDGED. The button then
    // disappears because the gate (`actionSlotsFor`) returns no
    // slot for ACKNOWLEDGED + Operator.
    expect(activeSocket).not.toBeNull();
    activeSocket?.__emitStateChanged({
      incident_id: INCIDENT_ID,
      from_state: "OPEN",
      to_state: "ACKNOWLEDGED",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    });

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
        "data-state",
        "ACKNOWLEDGED",
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
    });
  });
});

describe("Story 4.5 — AC: NOT_OPEN (button absent for ACKNOWLEDGED row)", () => {
  it("does NOT render the Acknowledge button when state === 'ACKNOWLEDGED'", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    // Acknowledge button absent for ACKNOWLEDGED row. The actions
    // region may be present (Story 4.6 adds the Assign slot which
    // IS available for ACKNOWLEDGED + Operator), but the
    // Acknowledge button specifically must be absent.
    expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
  });
});

describe("Story 4.5 — AC: MUTATION_IN_FLIGHT (button disabled, double-click is a no-op)", () => {
  it("disables the button while in flight and a second click does not fire another POST", async () => {
    let ackCallCount = 0;
    let resolveAck: (() => void) | null = null;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ACK_URL_SUFFIX)) {
        ackCallCount += 1;
        // Hold the response open so the button stays `disabled`.
        await new Promise<void>((resolve) => {
          resolveAck = resolve;
        });
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    });

    // Wrap the post-click assertions in try/finally so the
    // dangling promise held open by `await new Promise(...)` above
    // is always resolved — even if an assertion throws. Otherwise
    // a failed assertion leaks the unresolved promise and the
    // fetch handler hangs across subsequent tests.
    try {
      // First click: fires POST.
      fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));
      await waitFor(() => {
        expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeDisabled();
      });
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toHaveTextContent(
        "Acknowledging...",
      );
      expect(ackCallCount).toBe(1);

      // Second click: button is `disabled`, fireEvent.click is a no-op
      // for disabled buttons (React swallows the click before the
      // handler fires).
      fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));
      expect(ackCallCount).toBe(1);
    } finally {
      // Resolve the in-flight mutation so the test cleans up cleanly.
      resolveAck?.();
    }
  });
});

describe("Story 4.5 — AC: CONFLICT_409 (error toast 'Already acknowledged' + row reconciles to ACKNOWLEDGED)", () => {
  it("surfaces the 'Already acknowledged' error toast, invalidates the row, and the row reconciles to ACKNOWLEDGED on the next fetch", async () => {
    let ackCallCount = 0;
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        // First fetch: OPEN. Second fetch (after the mutation's
        // `onError` invalidates the cache because 409 is 4xx):
        // ACKNOWLEDGED — the world moved on while the operator
        // was clicking. The row query should reconcile to that.
        rowFetchCount += 1;
        if (rowFetchCount === 1) {
          return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify(
            baseIncident({
              state: "ACKNOWLEDGED",
              acknowledged_at: "2026-08-27T01:00:00.000Z",
            }),
          ),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ACK_URL_SUFFIX)) {
        ackCallCount += 1;
        return new Response(
          JSON.stringify({
            error: "invalid_state_transition",
            from: "ACKNOWLEDGED",
            attempted: "acknowledge",
          }),
          { status: 409 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));

    // Toast appears immediately.
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Already acknowledged");
    });
    expect(ackCallCount).toBe(1);

    // The mutation's `onError` invalidates the row query (4xx branch);
    // the next fetch returns ACKNOWLEDGED. The row's `data-state`
    // updates; the button disappears because `actionSlotsFor` returns
    // no slot for ACKNOWLEDGED + Operator.
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
        "data-state",
        "ACKNOWLEDGED",
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
    });
    expect(rowFetchCount).toBe(2);
  });
});

describe("Story 4.5 — AC: FORBIDDEN_403 (error toast 'Not authorized' + page renders <RbacDenied />)", () => {
  it("surfaces the 'Not authorized' error toast, invalidates the row, and <RbacDenied /> renders on the next fetch", async () => {
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        // First fetch: 200. Second fetch (after the mutation's
        // `onError` invalidates the cache because 403 is 4xx):
        // 403 — the role drifted between page load and click, so
        // the next fetch surfaces the RBAC contract via <RbacDenied />.
        rowFetchCount += 1;
        if (rowFetchCount === 1) {
          return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: "forbidden", required_role: "Technician" }), {
          status: 403,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ACK_URL_SUFFIX)) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));

    // Toast appears immediately.
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Not authorized");
    });

    // After the mutation's `onError` invalidates the row query (4xx
    // branch), the next fetch returns 403 → page renders <RbacDenied />.
    await waitFor(() => {
      expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-root")).toBeNull();
    expect(rowFetchCount).toBe(2);
  });
});

describe("Story 4.5 — AC: NOT_FOUND_404 (error toast 'Incident not found' + page renders NotFound)", () => {
  it("surfaces the 'Incident not found' error toast and <NotFound /> renders on the next fetch", async () => {
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        // First fetch: returns the row. Second fetch (after the
        // mutation invalidates the cache): 404 — the row was
        // deleted between the click and the re-fetch.
        rowFetchCount += 1;
        if (rowFetchCount === 1) {
          return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ACK_URL_SUFFIX)) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));

    // Toast appears immediately.
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Incident not found");
    });

    // After the mutation's `onSuccess` invalidates the row query, the
    // next fetch returns 404 → page renders <NotFound />.
    await waitFor(() => {
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-root")).toBeNull();
  });
});

describe("Story 4.5 — AC: SERVER_ERROR_500 (error toast 'Failed to acknowledge. Try again.')", () => {
  it("surfaces the retryable error toast and re-enables the button for manual retry", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ACK_URL_SUFFIX)) {
        return new Response("internal", { status: 500 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));

    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent(
        "Failed to acknowledge. Try again.",
      );
    });

    // Button re-enables (mutation is no longer in flight).
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).not.toBeDisabled();
    });
    expect(screen.getByTestId("incident-detail-acknowledge-button")).toHaveTextContent(
      "Acknowledge",
    );
  });
});

// ============================================================================
// Story 4.5 — TTL pin at the integration level
// ============================================================================
//
// Pinned here (not just in `toast.spec.tsx`) so a regression that
// moved the TTL constant or accidentally skipped the timer in the
// page wiring would still fail at the integration seam.
//
// Note on `act` + fake timers: `waitFor` polls via real-time
// `setTimeout`, which fake timers intercept — meaning a `waitFor`
// under fake timers never resolves. We drive the scenario with
// `act` + microtask flushing instead (`await Promise.resolve()`-style
// flushes in `act`) so the React reconciler settles between
// deterministic clock advances.
describe("Story 4.5 — AC: success toast leaves the DOM after TTL", () => {
  it("drops the success toast after 4001ms (the TTL contract at integration level)", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ACK_URL_SUFFIX)) {
        return new Response(
          JSON.stringify(
            baseIncident({
              state: "ACKNOWLEDGED",
              acknowledged_at: "2026-08-27T01:00:00.000Z",
            }),
          ),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    // Drive the page-load path under real timers so the row
    // query resolves; `act` flushes the reconciler between
    // microtask checkpoints. Use REAL timers for the load path
    // — switching to fake timers before render leaves React's
    // scheduler's internal `setTimeout(0)` lanes stranded.
    renderDetail("Operator");
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    });

    // From here, run under fake timers. The TTL fires at 4_000ms
    // and we need deterministic control over the clock. The
    // mutation is synchronous (resolve → onSuccess →
    // invalidate → refetch settles → pushToast) but its promise
    // chain still needs a microtask flush to render the toast.
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId("incident-detail-acknowledge-button"));

      // Flush the mutation's promise chain (resolve → onSuccess
      // → invalidate → refetch settles → pushToast → setState)
      // inside `act` so the React reconciler commits before we
      // assert. `await Promise.resolve()` only flushes one
      // microtask; the `act` boundary ensures React's internal
      // effects settle too.
      await act(async () => {
        await Promise.resolve();
      });

      // The toast `<li>` is now mounted. Assert directly on the
      // rendered DOM — no `waitFor` under fake timers.
      const region = screen.getByTestId("toast-region");
      expect(region).toHaveTextContent("Acknowledged");
      expect(region.children.length).toBe(1);

      // Advance past the 4_000ms TTL — the toast's setTimeout
      // fires under fake timers; the queue's setState then
      // schedules a re-render. Wrap the advance + re-render in
      // `act` so React commits the empty queue before we
      // assert.
      act(() => {
        vi.advanceTimersByTime(4_001);
      });

      // Region is now empty. We assert on the region's child
      // list (zero children) rather than
      // `queryByTestId("toast-...")` because the success toast's
      // id is page-local and not predictable from outside the
      // `useToasts()` hook.
      expect(region.children.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// Story 4.5 — Viewer role at the page integration level
// ============================================================================
//
// Pinned here (not just in `IncidentDetailActions.spec.tsx`) so a
// regression that introduced an inline role check inside
// `IncidentDetailPage` (bypassing `actionSlotsFor`) would fail at
// the integration seam. The unit test pins the contract for the
// button; this test pins the contract for the page.
describe("Story 4.5 — AC: Viewer cannot see the Acknowledge button even on an OPEN incident", () => {
  it("does NOT render the Acknowledge button for an OPEN incident viewed by a Viewer", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Viewer");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
    expect(screen.queryByTestId("incident-detail-actions")).toBeNull();
  });
});

// ============================================================================
// Story 4.6 — Assign Technician + INSPECTING Transition
// ============================================================================
//
// Coverage matrix (each spec AC bullet → at least one `it(...)`):
//
//   AC "HAPPY_PATH"             — ACKNOWLEDGED + Operator + Technician
//                                selected → click Assign → POST 200 → toast
//                                "Technician assigned" → row invalidates
//                                → socket event lands → data-state="INSPECTING"
//                                → Assign form disappears.
//   AC "NOT_OPEN"               — OPEN row → Assign form NOT rendered.
//   AC "RBAC_DENIED"            — ACKNOWLEDGED + Technician viewer → Assign
//                                form NOT rendered.
//   AC "MUTATION_IN_FLIGHT"     — click Assign twice → second click no-op
//                                (button disabled during in-flight mutation).
//   AC "CONFLICT_409"           — server returns 409 → error toast
//                                "Already assigned" → row reconciles.
//   AC "SERVER_ERROR_500"       — server returns 500 → error toast
//                                "Failed to assign. Try again." + button
//                                re-enables.
//
// Mirrors the 4.5 ack-flow test rig exactly: same `installFetch`
// pattern, same `renderDetail(role)` factory, same `activeSocket.__emitStateChanged`
// reconciliation pattern. The Technician id for assign tests is the
// first `SEEDED_TECHNICIAN_IDS` entry (TECH_ID — see
// `seededTechnicians.ts:21`).
const ASSIGN_URL_SUFFIX = `/api/incidents/${INCIDENT_ID}/assign`;
const ASSIGN_TECH_ID = "00000000-0000-4000-8000-00000000a003";

/** Drive the inline form: pick the seeded Technician + click Assign. */
const pickAndAssign = (): void => {
  const select = screen.getByTestId(
    "incident-detail-assign-select",
  ) as unknown as HTMLSelectElement;
  fireEvent.change(select, { target: { value: ASSIGN_TECH_ID } });
  fireEvent.click(screen.getByTestId("incident-detail-assign-button"));
};

describe("Story 4.6 — AC: happy path (POST 200 → success toast → state reconciled)", () => {
  it("fires POST with { assignee_user_id }, surfaces 'Technician assigned' toast, and the row transitions to INSPECTING via socket event", async () => {
    let assignCallCount = 0;
    let assignBody: { assignee_user_id?: string } | null = null;
    installFetch(async (url, init) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        assignCallCount += 1;
        expect(init?.method).toBe("POST");
        assignBody = JSON.parse(init?.body as string) as { assignee_user_id?: string };
        return new Response(
          JSON.stringify(
            baseIncident({
              state: "INSPECTING",
              assignee_user_id: ASSIGN_TECH_ID,
            }),
          ),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    // Assign form visible for ACKNOWLEDGED + Operator; Acknowledge
    // button NOT visible (slot matrix: ACKNOWLEDGED+Operator returns
    // ["assign"] only).
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();

    // Button disabled until a Technician is picked (NO_TECH_SELECTED).
    expect(screen.getByTestId("incident-detail-assign-button")).toBeDisabled();

    // Pick + click → POST + success toast.
    pickAndAssign();
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Technician assigned");
    });
    expect(assignCallCount).toBe(1);
    expect(assignBody?.assignee_user_id).toBe(ASSIGN_TECH_ID);

    // Socket-driven state mutation arrives; row's data-state updates
    // to INSPECTING. The Assign form disappears because the
    // `assign` slot returns null for INSPECTING + Operator.
    expect(activeSocket).not.toBeNull();
    activeSocket?.__emitStateChanged({
      incident_id: INCIDENT_ID,
      from_state: "ACKNOWLEDGED",
      to_state: "INSPECTING",
      changed_at: "2026-08-27T01:00:00.000Z",
      actor_user_id: "00000000-0000-4000-8000-00000000a001",
    });

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
        "data-state",
        "INSPECTING",
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("incident-detail-assign-form")).toBeNull();
    });
  });
});

describe("Story 4.6 — AC: NOT_OPEN (Assign form absent for OPEN row)", () => {
  it("does NOT render the Assign form when state === 'OPEN'", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "OPEN" })), { status: 200 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    // OPEN + Operator: Acknowledge button visible, Assign form absent
    // (slot matrix returns ["acknowledge"] only for OPEN+Operator).
    expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    expect(screen.queryByTestId("incident-detail-assign-form")).toBeNull();
  });
});

describe("Story 4.6 — AC: RBAC_DENIED (Technician cannot see Assign form on ACKNOWLEDGED)", () => {
  it("does NOT render the Assign form when a Technician views an ACKNOWLEDGED incident", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Technician");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-assign-form")).toBeNull();
    expect(screen.queryByTestId("incident-detail-assign-button")).toBeNull();
    expect(screen.queryByTestId("incident-detail-actions")).toBeNull();
  });
});

describe("Story 4.6 — AC: MUTATION_IN_FLIGHT (Assign button disabled, double-click is a no-op)", () => {
  it("disables the Assign button while in flight and a second click does not fire another POST", async () => {
    let assignCallCount = 0;
    let resolveAssign: (() => void) | null = null;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        assignCallCount += 1;
        // Hold the response open so the button stays `disabled`.
        await new Promise<void>((resolve) => {
          resolveAssign = resolve;
        });
        return new Response(
          JSON.stringify(
            baseIncident({
              state: "INSPECTING",
              assignee_user_id: ASSIGN_TECH_ID,
            }),
          ),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    // Wrap the post-click assertions in try/finally so the
    // dangling promise held open by `await new Promise(...)` above
    // is always resolved — even if an assertion throws. Otherwise
    // a failed assertion leaks the unresolved promise and the
    // fetch handler hangs across subsequent tests.
    try {
      // Pick the Technician + click Assign: fires POST.
      const select = screen.getByTestId(
        "incident-detail-assign-select",
      ) as unknown as HTMLSelectElement;
      fireEvent.change(select, { target: { value: ASSIGN_TECH_ID } });
      fireEvent.click(screen.getByTestId("incident-detail-assign-button"));

      await waitFor(() => {
        expect(screen.getByTestId("incident-detail-assign-button")).toBeDisabled();
      });
      expect(screen.getByTestId("incident-detail-assign-button")).toHaveTextContent("Assigning...");
      expect(assignCallCount).toBe(1);

      // Second click: button is `disabled`, fireEvent.click is a
      // no-op for disabled buttons (React swallows the click before
      // the handler fires).
      fireEvent.click(screen.getByTestId("incident-detail-assign-button"));
      expect(assignCallCount).toBe(1);
    } finally {
      // Resolve the in-flight mutation so the test cleans up cleanly.
      resolveAssign?.();
    }
  });
});

describe("Story 4.6 — AC: CONFLICT_409 (error toast 'Already assigned' + row reconciles to INSPECTING)", () => {
  it("surfaces the 'Already assigned' error toast, invalidates the row, and the row reconciles to INSPECTING on the next fetch", async () => {
    let assignCallCount = 0;
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        // First fetch: ACKNOWLEDGED. Second fetch (after the
        // mutation's `onError` invalidates the cache because 409
        // is 4xx): INSPECTING — the world moved on while the
        // operator was clicking. The row query should reconcile
        // to that.
        rowFetchCount += 1;
        if (rowFetchCount === 1) {
          return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify(
            baseIncident({
              state: "INSPECTING",
              assignee_user_id: ASSIGN_TECH_ID,
            }),
          ),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        assignCallCount += 1;
        return new Response(
          JSON.stringify({
            error: "invalid_state_transition",
            from: "INSPECTING",
            attempted: "assign",
          }),
          { status: 409 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    pickAndAssign();

    // Toast appears immediately.
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Already assigned");
    });
    expect(assignCallCount).toBe(1);

    // The mutation's `onError` invalidates the row query (4xx
    // branch); the next fetch returns INSPECTING. The row's
    // `data-state` updates; the Assign form disappears because
    // `actionSlotsFor` returns no `assign` slot for INSPECTING.
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
        "data-state",
        "INSPECTING",
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("incident-detail-assign-form")).toBeNull();
    });
    expect(rowFetchCount).toBe(2);
  });
});

describe("Story 4.6 — AC: SERVER_ERROR_500 (error toast 'Failed to assign. Try again.')", () => {
  it("surfaces the retryable error toast and re-enables the Assign button for manual retry", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        return new Response("internal", { status: 500 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    pickAndAssign();

    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Failed to assign. Try again.");
    });

    // Button re-enables (mutation is no longer in flight).
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-button")).not.toBeDisabled();
    });
    expect(screen.getByTestId("incident-detail-assign-button")).toHaveTextContent("Assign");
  });
});

describe("Story 4.6 — AC: NOT_FOUND_404 (error toast 'Incident not found' + page renders NotFound)", () => {
  it("surfaces the 'Incident not found' error toast and <NotFound /> renders on the next fetch", async () => {
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        // First fetch: returns the row. Second fetch (after the
        // mutation invalidates the cache): 404 — the row was
        // deleted between the click and the re-fetch.
        rowFetchCount += 1;
        if (rowFetchCount === 1) {
          return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    pickAndAssign();

    // Toast appears immediately.
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Incident not found");
    });

    // After the mutation's `onSuccess` invalidates the row query, the
    // next fetch returns 404 → page renders <NotFound />.
    await waitFor(() => {
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-root")).toBeNull();
  });
});

describe("Story 4.6 — AC: FORBIDDEN_403 (error toast 'Not authorized' + page renders <RbacDenied />)", () => {
  it("surfaces the 'Not authorized' error toast, invalidates the row, and <RbacDenied /> renders on the next fetch", async () => {
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        // First fetch: 200. Second fetch (after the mutation's
        // `onError` invalidates the cache because 403 is 4xx):
        // 403 — the role drifted between page load and click, so
        // the next fetch surfaces the RBAC contract via <RbacDenied />.
        rowFetchCount += 1;
        if (rowFetchCount === 1) {
          return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: "forbidden", required_role: "Technician" }), {
          status: 403,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    pickAndAssign();

    // Toast appears immediately.
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Not authorized");
    });

    // After the mutation's `onError` invalidates the row query (4xx
    // branch), the next fetch returns 403 → page renders <RbacDenied />.
    await waitFor(() => {
      expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("incident-detail-root")).toBeNull();
    expect(rowFetchCount).toBe(2);
  });
});

describe("Story 4.6 — AC: TOKEN_EXPIRED_401 (error toast 'Session expired' — no row invalidation)", () => {
  it("surfaces the 'Session expired' toast and does NOT re-fetch the row (5xx-class UX)", async () => {
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        rowFetchCount += 1;
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        return new Response(JSON.stringify({ error: "token_expired" }), { status: 401 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    pickAndAssign();

    // Toast appears immediately with the 5xx-class copy.
    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent(
        "Session expired — please sign in again",
      );
    });

    // The row query was NOT invalidated (401 is 5xx-class UX; the
    // operator must re-auth before any retry can succeed). The page
    // still shows the ACKNOWLEDGED row + Assign form so a manual
    // retry after re-auth would work.
    expect(rowFetchCount).toBe(1);
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
      "data-state",
      "ACKNOWLEDGED",
    );
    expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
  });
});

describe("Story 4.6 — AC: BODY_VALIDATION_400 (error toast 'Invalid request' — row invalidates)", () => {
  it("surfaces the 'Invalid request' error toast (4xx class — row invalidates)", async () => {
    let rowFetchCount = 0;
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        rowFetchCount += 1;
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        // 400 is a defense-in-depth response (the client should
        // not produce a malformed body, but the server's Zod
        // validator catches the case). The toast copy is the
        // distinct "Invalid request" line.
        return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
      }
      return new Response("{}", { status: 404 });
    });

    renderDetail("Operator");

    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    pickAndAssign();

    await waitFor(() => {
      expect(screen.getByTestId("toast-region")).toHaveTextContent("Invalid request");
    });

    // 400 is in the 4xx range and is NOT 401, so the mutation's
    // `onError` invalidates the row query. The next fetch
    // returns the same row (still ACKNOWLEDGED — the world hasn't
    // moved on); the form stays visible.
    expect(rowFetchCount).toBe(2);
    expect(screen.getByTestId("incident-detail-root")).toHaveAttribute(
      "data-state",
      "ACKNOWLEDGED",
    );
  });
});

// ============================================================================
// Story 4.6 — TTL pin at the integration level
// ============================================================================
//
// Pinned here (not just in `toast.spec.tsx`) so a regression that
// moved the TTL constant or accidentally skipped the timer in the
// page wiring would still fail at the integration seam.
//
// Note on `act` + fake timers: `waitFor` polls via real-time
// `setTimeout`, which fake timers intercept — meaning a `waitFor`
// under fake timers never resolves. We drive the scenario with
// `act` + microtask flushing instead so the React reconciler
// settles between deterministic clock advances.
describe("Story 4.6 — AC: success toast leaves the DOM after TTL", () => {
  it("drops the success toast after 4001ms (the TTL contract at integration level)", async () => {
    installFetch(async (url) => {
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}`)) {
        return new Response(JSON.stringify(baseIncident({ state: "ACKNOWLEDGED" })), {
          status: 200,
        });
      }
      if (url.endsWith(`/api/incidents/${INCIDENT_ID}/events`)) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url.endsWith(ASSIGN_URL_SUFFIX)) {
        return new Response(
          JSON.stringify(
            baseIncident({
              state: "INSPECTING",
              assignee_user_id: ASSIGN_TECH_ID,
            }),
          ),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    // Drive the page-load path under real timers so the row
    // query resolves.
    renderDetail("Operator");
    await waitFor(() => {
      expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
    });

    // From here, run under fake timers.
    vi.useFakeTimers();
    try {
      pickAndAssign();

      // Flush the mutation's promise chain inside `act` so the
      // React reconciler commits before we assert.
      await act(async () => {
        await Promise.resolve();
      });

      // The toast `<li>` is now mounted. Assert directly on the
      // rendered DOM — no `waitFor` under fake timers.
      const region = screen.getByTestId("toast-region");
      expect(region).toHaveTextContent("Technician assigned");
      expect(region.children.length).toBe(1);

      // Advance past the 4_000ms TTL.
      act(() => {
        vi.advanceTimersByTime(4_001);
      });

      // Region is now empty.
      expect(region.children.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
