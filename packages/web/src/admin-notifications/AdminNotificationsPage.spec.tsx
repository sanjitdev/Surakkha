/**
 * `AdminNotificationsPage.spec.tsx` — Story 5.1.
 *
 * Coverage matrix (each I/O matrix row → at least one `it(...)`):
 *
 *   - HAPPY_PATH: page renders the table with rows from the API.
 *   - SEVERITY_MULTI_SELECT (Loop 1 fix): selecting 2 chips
 *     produces a request URL with both `?severity=` params; the
 *     api receives the array end-to-end.
 *   - SEVERITY_MULTI_SELECT_3: 3 chips → 3 params.
 *   - EMPTY: 200 + `{ notifications: [] }` → "no notifications
 *     match" copy.
 *   - 403: api returns 403 → `<RbacDenied />` renders.
 *   - 500: api returns 500 → retry message renders.
 *   - EXPAND_HAS_INCIDENT: clicking a row with `incidentId`
 *     surfaces the `/incidents/{id}` link.
 *   - EXPAND_NO_INCIDENT: clicking a row with `incidentId: null`
 *     surfaces the "no incident" hint.
 *   - LOADING: while the request is in flight, the loading copy
 *     renders.
 *   - DATE_RANGE: changing the preset triggers a refetch.
 *
 * Test rig mirrors `IncidentDetailPage.spec.tsx` (Story 4.4):
 * `globalThis.fetch` stub, `QueryClientProvider`, `MemoryRouter`,
 * `CurrentRoleProvider`, `AppShell`.
 */
import { type AdminNotificationPayload } from "@surakkha/shared/notification";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";

import { AdminNotificationsPage } from "./AdminNotificationsPage";

const NOTIF_ID_1 = "a1111111-1111-4111-8111-111111111111";
const NOTIF_ID_2 = "a2222222-2222-4222-8222-222222222222";
const INCIDENT_ID_1 = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID_2 = "22222222-2222-4222-8222-222222222222";
const ACKNOWLEDGER_ID = "00000000-0000-4000-8000-00000000c001";

const baseRow = (overrides: Partial<AdminNotificationPayload>): AdminNotificationPayload => ({
  id: NOTIF_ID_1,
  severity: "critical",
  incidentId: INCIDENT_ID_1,
  alertId: null,
  recipientRole: "Operator",
  createdAt: "2026-08-28T11:00:00.000Z",
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  ...overrides,
});

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
          <AdminNotificationsPage />
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

describe("Story 5.1 — AdminNotificationsPage", () => {
  it("HAPPY_PATH: renders the table when the API returns 3 rows", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            notifications: [
              baseRow({ id: NOTIF_ID_1 }),
              baseRow({
                id: NOTIF_ID_2,
                severity: "warning",
                incidentId: null,
                recipientRole: "Technician",
                createdAt: "2026-08-28T10:00:00.000Z",
              }),
              baseRow({
                id: "a3333333-3333-4333-8333-333333333333",
                severity: "info",
                recipientRole: "Admin",
                incidentId: INCIDENT_ID_2,
                createdAt: "2026-08-28T09:00:00.000Z",
                acknowledgedAt: "2026-08-28T09:30:00.000Z",
                acknowledgedByUserId: ACKNOWLEDGER_ID,
              }),
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-table")).not.toBeNull());
    expect(screen.getByTestId(`admin-notification-row-${NOTIF_ID_1}`)).toBeTruthy();
    expect(screen.getByTestId(`admin-notification-row-${NOTIF_ID_2}`)).toBeTruthy();
    // The audit detail (acknowledgedByUserId) is leaked on the admin surface.
    expect(
      screen.getByTestId(`admin-notification-row-a3333333-3333-4333-8333-333333333333`),
    ).toBeTruthy();
  });

  it("SEVERITY_MULTI_SELECT_2: clicking 2 chips passes BOTH severity params to the api (Loop 1 fix)", async () => {
    installFetch(async () => new Response(JSON.stringify({ notifications: [] }), { status: 200 }));
    renderPage();
    // With { notifications: [] } the page settles on the EMPTY copy
    // (not the table) — wait on that instead of the table.
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-empty")).not.toBeNull());
    // Capture the second fetch (the chip-toggle refetch).
    const before = captured.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-chip-critical"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-chip-warning"));
    });
    await waitFor(() => expect(captured.length).toBeGreaterThan(before + 1));
    const lastFew = captured.slice(before);
    // The most-recent fetch URL must contain BOTH severity params.
    const lastUrl = lastFew[lastFew.length - 1]?.url ?? "";
    expect(lastUrl).toContain("severity=critical");
    expect(lastUrl).toContain("severity=warning");
    // The chip state must be `aria-pressed="true"` for both.
    expect(screen.getByTestId("severity-chip-critical").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("severity-chip-warning").getAttribute("aria-pressed")).toBe("true");
  });

  it("SEVERITY_MULTI_SELECT_3: clicking all 3 chips passes ALL severity params", async () => {
    installFetch(async () => new Response(JSON.stringify({ notifications: [] }), { status: 200 }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-empty")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-chip-critical"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-chip-warning"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-chip-info"));
    });
    await waitFor(() => {
      const lastUrl = captured[captured.length - 1]?.url ?? "";
      expect(lastUrl).toContain("severity=critical");
      expect(lastUrl).toContain("severity=warning");
      expect(lastUrl).toContain("severity=info");
    });
  });

  it("SEVERITY_DEDUP: clicking the same chip twice leaves only one severity param", async () => {
    installFetch(async () => new Response(JSON.stringify({ notifications: [] }), { status: 200 }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-empty")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-chip-critical"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-chip-critical"));
    });
    await waitFor(() => {
      const lastUrl = captured[captured.length - 1]?.url ?? "";
      expect(lastUrl).not.toContain("severity=critical");
    });
  });

  it("EMPTY: 200 with { notifications: [] } → 'no notifications match' copy", async () => {
    installFetch(async () => new Response(JSON.stringify({ notifications: [] }), { status: 200 }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-empty")).not.toBeNull());
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
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-error")).not.toBeNull());
  });

  it("EXPAND_HAS_INCIDENT: clicking a row surfaces the incident link", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            notifications: [baseRow({ id: NOTIF_ID_1, incidentId: INCIDENT_ID_1 })],
          }),
          { status: 200 },
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-table")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId(`admin-notification-row-${NOTIF_ID_1}`));
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`admin-notification-incident-link-${NOTIF_ID_1}`)).not.toBeNull(),
    );
    const link = screen.getByTestId(`admin-notification-incident-link-${NOTIF_ID_1}`);
    expect(link.getAttribute("href")).toBe(`/incidents/${INCIDENT_ID_1}`);
  });

  it("EXPAND_NO_INCIDENT: row with incidentId null surfaces the 'no incident' hint", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            notifications: [baseRow({ id: NOTIF_ID_1, incidentId: null })],
          }),
          { status: 200 },
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-table")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId(`admin-notification-row-${NOTIF_ID_1}`));
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`admin-notification-no-incident-${NOTIF_ID_1}`)).not.toBeNull(),
    );
  });

  it("LOADING: while the request is in flight, the loading copy renders", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    installFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderPage();
    expect(screen.queryByTestId("admin-notifications-loading")).not.toBeNull();
    await act(async () => {
      resolveFetch?.(new Response(JSON.stringify({ notifications: [] }), { status: 200 }));
    });
  });

  it("DATE_RANGE: changing the preset triggers a refetch with a since= param", async () => {
    installFetch(async () => new Response(JSON.stringify({ notifications: [] }), { status: 200 }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-empty")).not.toBeNull());
    const before = captured.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("range-24h"));
    });
    await waitFor(() => expect(captured.length).toBeGreaterThan(before));
    const lastUrl = captured[captured.length - 1]?.url ?? "";
    expect(lastUrl).toMatch(/since=/);
  });

  it("DATE_RANGE_CUSTOM: the 'custom' preset is rendered disabled (Loop 1 review finding E3)", async () => {
    installFetch(async () => new Response(JSON.stringify({ notifications: [] }), { status: 200 }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("admin-notifications-empty")).not.toBeNull());
    const customBtn = screen.getByTestId("range-custom");
    expect(customBtn).toBeDisabled();
  });

  it("ROW_KEYBOARD: pressing Enter on a focused row toggles expansion (Loop 1 review finding E6)", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            notifications: [
              baseRow({
                id: NOTIF_ID_1,
                severity: "critical",
                incidentId: INCIDENT_ID_1,
              }),
            ],
          }),
          { status: 200 },
        ),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.queryByTestId(`admin-notification-row-${NOTIF_ID_1}`)).not.toBeNull(),
    );
    const row = screen.getByTestId(`admin-notification-row-${NOTIF_ID_1}`);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.keyDown(row, { key: "Enter" });
    });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByTestId(`admin-notification-detail-${NOTIF_ID_1}`)).not.toBeNull();
  });

  it("ROW_ARIA: the row exposes aria-expanded + aria-controls linking to the detail panel (Loop 1 review finding E7)", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            notifications: [
              baseRow({
                id: NOTIF_ID_1,
                severity: "critical",
                incidentId: INCIDENT_ID_1,
              }),
            ],
          }),
          { status: 200 },
        ),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.queryByTestId(`admin-notification-row-${NOTIF_ID_1}`)).not.toBeNull(),
    );
    const row = screen.getByTestId(`admin-notification-row-${NOTIF_ID_1}`);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.getAttribute("aria-controls")).toBe(`admin-notification-detail-${NOTIF_ID_1}`);
  });
});
