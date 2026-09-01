/**
 * `AuditLogPage.spec.tsx` — Story 5.3.
 *
 * Coverage matrix (each I/O matrix row → at least one `it(...)`):
 *
 *   - LOADING: while the request is in flight, the loading copy
 *     renders.
 *   - HAPPY_PATH: 200 + `{ rows, total, truncated }` renders the
 *     table.
 *   - EMPTY_DEFAULT_FILTER: 200 + empty + default 30d → "No
 *     audit events yet."
 *   - EMPTY_NARROWED_FILTER: 200 + empty + active filter → "No
 *     audit events match the current filters."
 *   - 403: api returns 403 → `<RbacDenied />` renders.
 *   - 500: api returns 500 → retry message renders.
 *   - EXPAND_HAS_ENTITY: clicking a row with `resourceId` +
 *     `resource: "Incident"` surfaces the `/incidents/{id}` link.
 *   - EXPAND_NO_ENTITY: clicking a row with `resourceId: null`
 *     surfaces the "no entity" hint.
 *   - FILTER_CHIP_TOGGLE: toggling a resource chip refetches with
 *     the chip in the URL.
 *   - DATE_RANGE: changing the preset triggers a refetch.
 *
 * Test rig mirrors `AdminNotificationsPage.spec.tsx`:
 * `globalThis.fetch` stub, `QueryClientProvider`, `MemoryRouter`,
 * `CurrentRoleProvider`.
 */
import { type AuditLogEntry, type AuditLogListEnvelope } from "@surakkha/shared/audit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";

import { AuditLogPage } from "./AuditLogPage";

const AUDIT_ID_1 = "c1111111-1111-4111-8111-111111111111";
const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const INCIDENT_ID_1 = "11111111-1111-4111-8111-111111111111";
const RULE_ID_1 = "22222222-2222-4222-8222-222222222222";

const baseRow = (overrides: Partial<AuditLogEntry> & { id: string }): AuditLogEntry => ({
  id: overrides.id,
  actorUserId: ADMIN_ID,
  auditAction: "incident_state_changed",
  resource: "Incident",
  resourceId: INCIDENT_ID_1,
  payload: { from: "OPEN", to: "ACKNOWLEDGED" },
  outcome: "success",
  createdAt: "2026-08-28T11:00:00.000Z",
  ...overrides,
});

const buildEnvelope = (
  rows: readonly AuditLogEntry[],
  total = rows.length,
  truncated = false,
): AuditLogListEnvelope => ({ rows: [...rows], total, truncated });

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderPage = () => {
  const qc = buildQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CurrentRoleProvider initialRole="Admin">
          <AuditLogPage />
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
}

let captured: CapturedRequest[] = [];

const installFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>): void => {
  globalThis.fetch = ((url: unknown, init?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : (url as URL).toString();
    captured.push({ url: u, method: init?.method ?? "GET" });
    return handler(u, init);
  }) as unknown as typeof fetch;
};

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
  captured = [];
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  _resetApiClientConfig();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Story 5.3 — AuditLogPage", () => {
  it("LOADING: while the request is in flight, the loading copy renders", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    installFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderPage();
    expect(screen.queryByTestId("audit-log-loading")).not.toBeNull();
    await act(async () => {
      resolveFetch?.(
        new Response(JSON.stringify(buildEnvelope([])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  });

  it("HAPPY_PATH: renders the table when the API returns rows", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([baseRow({ id: AUDIT_ID_1 })])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-table")).not.toBeNull());
    expect(screen.getByTestId(`audit-log-row-${AUDIT_ID_1}`)).toBeTruthy();
    expect(screen.queryByTestId("audit-log-summary")).not.toBeNull();
  });

  it("EMPTY_DEFAULT_FILTER: empty + default 30d → 'No audit events yet.'", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([], 0, false)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-empty")).not.toBeNull());
    expect(screen.getByTestId("audit-log-empty").textContent).toContain("No audit events yet");
  });

  it("EMPTY_NARROWED_FILTER: empty + active event filter → 'No audit events match the current filters.'", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([], 0, false)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-empty")).not.toBeNull());
    // Apply a narrowing filter.
    await act(async () => {
      fireEvent.change(screen.getByTestId("event-input"), { target: { value: "incident" } });
    });
    await waitFor(() =>
      expect(screen.getByTestId("audit-log-empty").textContent).toContain(
        "No audit events match the current filters",
      ),
    );
  });

  it("403: api returns 403 → <RbacDenied /> renders (defense in depth)", async () => {
    installFetch(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("rbac-denied")).not.toBeNull());
  });

  it("500: api returns 500 → retry message renders", async () => {
    installFetch(
      async () => new Response(JSON.stringify({ error: "internal_error" }), { status: 500 }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-error")).not.toBeNull());
  });

  it("EXPAND_HAS_INCIDENT: clicking a row surfaces the incident link", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify(buildEnvelope([baseRow({ id: AUDIT_ID_1, resource: "Incident" })])),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-table")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId(`audit-log-row-${AUDIT_ID_1}`));
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`audit-log-entity-link-${AUDIT_ID_1}`)).not.toBeNull(),
    );
    const link = screen.getByTestId(`audit-log-entity-link-${AUDIT_ID_1}`);
    expect(link.getAttribute("href")).toBe(`/incidents/${INCIDENT_ID_1}`);
  });

  it("EXPAND_HAS_RULE: clicking a Rule row surfaces the admin/thresholds link", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify(
            buildEnvelope([
              baseRow({
                id: AUDIT_ID_1,
                auditAction: "rule_created",
                resource: "Rule",
                resourceId: RULE_ID_1,
              }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-table")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId(`audit-log-row-${AUDIT_ID_1}`));
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`audit-log-entity-link-${AUDIT_ID_1}`)).not.toBeNull(),
    );
    const link = screen.getByTestId(`audit-log-entity-link-${AUDIT_ID_1}`);
    expect(link.getAttribute("href")).toBe(`/admin/thresholds?rule_id=${RULE_ID_1}`);
  });

  it("EXPAND_NO_ENTITY: row with resourceId null surfaces the 'no entity' hint", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify(
            buildEnvelope([
              baseRow({
                id: AUDIT_ID_1,
                auditAction: "logout",
                resource: "Session",
                resourceId: null,
              }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-table")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId(`audit-log-row-${AUDIT_ID_1}`));
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`audit-log-no-entity-${AUDIT_ID_1}`)).not.toBeNull(),
    );
  });

  it("FILTER_RESOURCE_TOGGLE: toggling the Incident chip passes the resource param to the api", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-empty")).not.toBeNull());
    const before = captured.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("resource-chip-Incident"));
    });
    await waitFor(() => expect(captured.length).toBeGreaterThan(before));
    const lastUrl = captured[captured.length - 1]?.url ?? "";
    expect(lastUrl).toContain("resource=Incident");
  });

  it("FILTER_EVENT_TOGGLE: typing in the event input passes the event param", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-empty")).not.toBeNull());
    const before = captured.length;
    await act(async () => {
      fireEvent.change(screen.getByTestId("event-input"), { target: { value: "incident" } });
    });
    await waitFor(() => expect(captured.length).toBeGreaterThan(before));
    const lastUrl = captured[captured.length - 1]?.url ?? "";
    expect(lastUrl).toContain("event=incident");
  });

  it("FILTER_ACTOR_TOGGLE: adding an actor id passes the actorIds param", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-empty")).not.toBeNull());
    await act(async () => {
      fireEvent.change(screen.getByTestId("actor-input"), { target: { value: ADMIN_ID } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("actor-add"));
    });
    await waitFor(() => {
      const lastUrl = captured[captured.length - 1]?.url ?? "";
      expect(lastUrl).toContain(`actorIds=${ADMIN_ID}`);
    });
  });

  it("DATE_RANGE: changing the preset triggers a refetch with a since= param", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-empty")).not.toBeNull());
    const before = captured.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("range-24h"));
    });
    await waitFor(() => expect(captured.length).toBeGreaterThan(before));
    const lastUrl = captured[captured.length - 1]?.url ?? "";
    expect(lastUrl).toMatch(/since=/);
  });

  it("DATE_RANGE_CUSTOM: the 'custom' preset is rendered disabled", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-empty")).not.toBeNull());
    const customBtn = screen.getByTestId("range-custom");
    expect(customBtn).toBeDisabled();
  });

  it("ROW_KEYBOARD: pressing Enter on a focused row toggles expansion", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify(buildEnvelope([baseRow({ id: AUDIT_ID_1, resource: "Incident" })])),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId(`audit-log-row-${AUDIT_ID_1}`)).not.toBeNull());
    const row = screen.getByTestId(`audit-log-row-${AUDIT_ID_1}`);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.keyDown(row, { key: "Enter" });
    });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByTestId(`audit-log-detail-${AUDIT_ID_1}`)).not.toBeNull();
  });

  it("SUMMARY_TRUNCATED: when truncated is true, the summary copy says 'Showing X of Y+'", async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify(buildEnvelope([baseRow({ id: AUDIT_ID_1 })], 250, true)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("audit-log-summary")).not.toBeNull());
    const summary = screen.getByTestId("audit-log-summary").textContent ?? "";
    expect(summary).toContain("Showing 1 of 250+");
  });
});
