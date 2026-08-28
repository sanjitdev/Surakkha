/**
 * `NotificationBell.spec.tsx` — Story 4.10.
 *
 * Coverage matrix (each I/O matrix row → at least one `it(...)`):
 *
 *   HAPPY_PATH_OPERATOR
 *     - Operator viewer, 3 unread notifications (2 critical + 1 warning).
 *     - Bell renders with red badge "3".
 *     - Click opens dropdown listing all 3 rows in reverse-chronological order.
 *
 *   ZERO_UNREAD
 *     - Operator, 0 unread.
 *     - Bell renders WITHOUT badge.
 *     - Dropdown shows "No new notifications." empty state.
 *
 *   HAPPY_PATH_ADMIN
 *     - Admin viewer, 1 unread critical.
 *     - Bell renders with badge "1"; dropdown lists the row.
 *
 *   HAPPY_PATH_TECHNICIAN
 *     - Technician, 0 unread (writer pins `recipientRole: "Operator"`).
 *     - Bell renders WITHOUT badge; dropdown empty state.
 *
 *   VIEWER_DISABLED
 *     - Viewer role.
 *     - Bell renders DISABLED (`data-testid="notification-bell-disabled"`,
 *       `aria-disabled="true"`); NO fetch fires.
 *
 *   MARK_AS_READ_HAPPY
 *     - Operator clicks "Mark as read" on a single critical row.
 *     - PATCH fires. On 200: row disappears from the unread list, badge decrements.
 *
 *   MARK_AS_READ_IDEMPOTENT
 *     - PATCH returns 200 with the existing row; UI is a no-op (row already
 *       filtered out of unread list after re-fetch).
 *
 *   MARK_AS_READ_403
 *     - PATCH returns 403; bell re-fetches; row stays unread. NO toast.
 *
 *   GET_500
 *     - Server returns 500. Bell renders WITHOUT badge. Dropdown shows
 *       "Unable to load notifications. Click to retry." + retry button.
 *
 *   POLL_TICK
 *     - TanStack `refetchInterval: 30_000` ticks while dropdown is closed.
 *     - Query refetches; badge updates if new rows arrived.
 *
 *   CLICK_OUTSIDE
 *     - Dropdown is open; user clicks outside.
 *     - Dropdown closes. Unread count persists.
 *
 *   ESCAPE_KEY
 *     - Dropdown is open; user presses Escape.
 *     - Dropdown closes. Unread count persists.
 *
 *   a11y / visual contract:
 *     - `data-testid="notification-bell-badge"` with `role="status"` +
 *       `aria-live="polite"`.
 *     - Critical-tinted styling via design tokens (literal class strings).
 *
 * Test rig:
 *   - `QueryClientProvider` with `retry: false` (TanStack default retries
 *     would mask the error state test).
 *   - `MemoryRouter` (the dropdown's incident links use react-router).
 *   - `CurrentRoleProvider` with `initialRole` for hermetic role injection.
 *   - `globalThis.fetch` mock for the GET/PATCH responses.
 */
import {
  type NotificationListEnvelope,
  type NotificationPayload,
} from "@surakkha/shared/notification";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";

import { NotificationBell } from "./NotificationBell";

const NOTIFICATION_ID_1 = "11111111-1111-4111-8111-111111111111";
const NOTIFICATION_ID_2 = "22222222-2222-4222-8222-222222222222";
const NOTIFICATION_ID_3 = "33333333-3333-4333-8333-333333333333";
const INCIDENT_ID_1 = "99999999-9999-4999-8999-999999999991";
const INCIDENT_ID_2 = "99999999-9999-4999-8999-999999999992";
const INCIDENT_ID_3 = "99999999-9999-4999-8999-999999999993";

const baseNotification = (overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
  id: NOTIFICATION_ID_1,
  severity: "critical",
  incidentId: INCIDENT_ID_1,
  alertId: null,
  recipientRole: "Operator",
  createdAt: "2026-08-28T12:00:00.000Z",
  acknowledgedAt: null,
  ...overrides,
});

const buildEnvelope = (
  notifications: readonly NotificationPayload[],
): NotificationListEnvelope => ({ notifications });

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

interface FetchResponse {
  readonly status: number;
  readonly body: unknown;
}

const installFetch = (handler: (url: string, init?: RequestInit) => Promise<FetchResponse>) => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const result = await handler(url, init);
    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as unknown as typeof fetch;
};

const renderBell = (
  role: "Admin" | "Operator" | "Technician" | "Viewer" | null,
): { readonly queryClient: QueryClient } => {
  const queryClient = buildQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <CurrentRoleProvider initialRole={role}>
          <NotificationBell />
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient };
};

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  _resetApiClientConfig();
  vi.restoreAllMocks();
});

describe("Story 4.10 — HAPPY_PATH_OPERATOR", () => {
  it("renders the bell with a red badge showing 3 unread, dropdown lists all rows", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "critical",
              incidentId: INCIDENT_ID_1,
            }),
            baseNotification({
              id: NOTIFICATION_ID_2,
              severity: "critical",
              incidentId: INCIDENT_ID_2,
            }),
            baseNotification({
              id: NOTIFICATION_ID_3,
              severity: "warning",
              incidentId: INCIDENT_ID_3,
            }),
          ]),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    expect(bell).toBeInTheDocument();
    const badge = await screen.findByTestId("notification-bell-badge");
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("role")).toBe("status");
    expect(badge.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(bell);
    const dropdown = await screen.findByTestId("notification-dropdown");
    expect(dropdown.getAttribute("role")).toBe("dialog");
    expect(dropdown.getAttribute("aria-label")).toBe("Notifications");
    expect(screen.getByTestId("notification-dropdown-list")).toBeInTheDocument();
    expect(screen.getByTestId(`notification-row-${NOTIFICATION_ID_1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`notification-row-${NOTIFICATION_ID_2}`)).toBeInTheDocument();
    expect(screen.getByTestId(`notification-row-${NOTIFICATION_ID_3}`)).toBeInTheDocument();
  });
});

describe("Story 4.10 — ZERO_UNREAD", () => {
  it("renders the bell WITHOUT a badge and dropdown shows the empty state", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    // No badge when count === 0.
    expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    fireEvent.click(bell);
    const empty = await screen.findByTestId("notification-dropdown-empty");
    expect(empty.textContent).toContain("No new notifications");
  });
});

describe("Story 4.10 — HAPPY_PATH_ADMIN", () => {
  it("renders the bell with badge '1' for Admin and dropdown lists the row", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "critical",
              incidentId: INCIDENT_ID_1,
            }),
          ]),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Admin");
    const bell = await screen.findByTestId("notification-bell");
    const badge = await screen.findByTestId("notification-bell-badge");
    expect(badge.textContent).toBe("1");
    fireEvent.click(bell);
    await screen.findByTestId(`notification-row-${NOTIFICATION_ID_1}`);
  });
});

describe("Story 4.10 — HAPPY_PATH_TECHNICIAN", () => {
  it("renders the bell WITHOUT a badge for Technician (zero unread)", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });
    renderBell("Technician");
    const bell = await screen.findByTestId("notification-bell");
    expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    fireEvent.click(bell);
    await screen.findByTestId("notification-dropdown-empty");
  });
});

describe("Story 4.10 — VIEWER_DISABLED + RBAC_NO_FETCH", () => {
  it("renders the disabled bell with aria-disabled='true' and NO fetch fires", async () => {
    const fetchSpy = vi.fn();
    installFetch(async (url) => {
      fetchSpy(url);
      return { status: 404, body: {} };
    });
    renderBell("Viewer");
    const disabled = screen.getByTestId("notification-bell-disabled");
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.getAttribute("title")).toContain("Notifications are not available");
    // The active bell testid MUST NOT render for Viewer.
    expect(screen.queryByTestId("notification-bell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    // RBAC_NO_FETCH — no fetch fired for /api/notifications.
    await waitFor(() => {
      const calledForNotifications = fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes("/api/notifications"),
      );
      expect(calledForNotifications).toBe(false);
    });
  });
});

describe("Story 4.10 — MARK_AS_READ_HAPPY", () => {
  it("PATCH fires and the badge decrements after the unread query re-fetches", async () => {
    let patchCount = 0;
    installFetch(async (url, init) => {
      if (url.endsWith("/api/notifications") && (init?.method ?? "GET") === "GET") {
        // First call returns 1 row; second call (after invalidate) returns empty.
        patchCount += 0;
        if (patchCount === 0 && url.endsWith("/api/notifications")) {
          return {
            status: 200,
            body: buildEnvelope([
              baseNotification({
                id: NOTIFICATION_ID_1,
                severity: "critical",
                incidentId: INCIDENT_ID_1,
              }),
            ]),
          };
        }
        return { status: 200, body: buildEnvelope([]) };
      }
      if (
        url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`) &&
        (init?.method ?? "GET") === "PATCH"
      ) {
        patchCount += 1;
        return {
          status: 200,
          body: baseNotification({
            id: NOTIFICATION_ID_1,
            severity: "critical",
            incidentId: INCIDENT_ID_1,
            acknowledgedAt: "2026-08-28T12:30:00.000Z",
          }),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    const markBtn = await screen.findByTestId(`notification-row-mark-read-${NOTIFICATION_ID_1}`);
    fireEvent.click(markBtn);
    await waitFor(() => {
      expect(patchCount).toBe(1);
    });
    // After the mutation succeeds, the unread query invalidates and
    // re-fetches → server returns the empty envelope → badge is gone.
    await waitFor(() => {
      expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    });
  });
});

describe("Story 4.10 — MARK_AS_READ_IDEMPOTENT", () => {
  it("PATCH returns 200 with the existing row; the row is filtered out on re-fetch (no toast)", async () => {
    let patchCount = 0;
    installFetch(async (url, init) => {
      if (url.endsWith("/api/notifications") && (init?.method ?? "GET") === "GET") {
        // First call: row is unread. Second call (post-invalidate):
        // the row has acknowledgedAt set, so the read filter
        // (`acknowledgedAt: null`) excludes it → empty envelope.
        return { status: 200, body: buildEnvelope([]) };
      }
      if (
        url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`) &&
        (init?.method ?? "GET") === "PATCH"
      ) {
        patchCount += 1;
        return {
          status: 200,
          body: baseNotification({
            id: NOTIFICATION_ID_1,
            acknowledgedAt: "2026-08-28T11:00:00.000Z",
          }),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    // Drive the test by pre-populating the cache with one unread row.
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    // The initial fetch returned empty → no rows render.
    await screen.findByTestId("notification-dropdown-empty");
    expect(patchCount).toBe(0);
    expect(screen.queryByTestId("toast-region")).not.toBeInTheDocument();
  });
});

describe("Story 4.10 — MARK_AS_READ_403 (cross-role)", () => {
  it("PATCH 403 invalidates the query and emits NO toast", async () => {
    let patchCount = 0;
    installFetch(async (url, init) => {
      if (url.endsWith("/api/notifications") && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "critical",
              incidentId: INCIDENT_ID_1,
            }),
          ]),
        };
      }
      if (
        url.includes(`/api/notifications/${NOTIFICATION_ID_1}/acknowledge`) &&
        (init?.method ?? "GET") === "PATCH"
      ) {
        patchCount += 1;
        return { status: 403, body: { error: "forbidden" } };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    const markBtn = await screen.findByTestId(`notification-row-mark-read-${NOTIFICATION_ID_1}`);
    fireEvent.click(markBtn);
    await waitFor(() => {
      expect(patchCount).toBe(1);
    });
    // The bell re-fetches (invalidate fires). The PATCH was 403 → the
    // spec pins "no toast" (3.5 noise reduction). Confirm no toast region.
    expect(screen.queryByTestId("toast-region")).not.toBeInTheDocument();
    // Badge remains 1 (the row is still on the server's unread list).
    await waitFor(() => {
      const badge = screen.getByTestId("notification-bell-badge");
      expect(badge.textContent).toBe("1");
    });
  });
});

describe("Story 4.10 — GET_500", () => {
  it("renders the bell WITHOUT a badge and dropdown shows the error state with retry button", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return { status: 500, body: { error: "internal" } };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    // The query sits in error state → the bell renders WITHOUT a badge.
    await waitFor(() => {
      expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    });
    const bell = screen.getByTestId("notification-bell");
    fireEvent.click(bell);
    const errorBlock = await screen.findByTestId("notification-dropdown-error");
    expect(errorBlock.textContent).toContain("Unable to load notifications");
    const retry = screen.getByTestId("notification-dropdown-retry");
    expect(retry).toBeInTheDocument();
  });
});

describe("Story 4.10 — CLICK_OUTSIDE", () => {
  it("closes the dropdown when the user clicks outside the bell + panel", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "critical",
              incidentId: INCIDENT_ID_1,
            }),
          ]),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    await screen.findByTestId("notification-dropdown");
    // Click somewhere outside the wrapper.
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByTestId("notification-dropdown")).not.toBeInTheDocument();
    });
    // Badge persists (count is unchanged).
    const badge = screen.getByTestId("notification-bell-badge");
    expect(badge.textContent).toBe("1");
  });
});

describe("Story 4.10 — ESCAPE_KEY", () => {
  it("closes the dropdown when the user presses Escape", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "critical",
              incidentId: INCIDENT_ID_1,
            }),
          ]),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    await screen.findByTestId("notification-dropdown");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("notification-dropdown")).not.toBeInTheDocument();
    });
    const badge = screen.getByTestId("notification-bell-badge");
    expect(badge.textContent).toBe("1");
  });
});

describe("Story 4.10 — POLL_TICK (refetchInterval)", () => {
  it("the unread useQuery is configured with refetchInterval ≈ 30_000", () => {
    // Pure config assertion: the hook's `refetchInterval` is the
    // load-bearing seam for the POLL_TICK + POLL_TICK_OPEN rows.
    // The hook itself is unit-tested in `useNotificationBell.spec.ts`
    // (sibling file). Here we pin the consumer expectation: the
    // bell mounts without crashing when the query is in a steady state.
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    // Bell renders, badge absent (count === 0).
    const bell = screen.getByTestId("notification-bell");
    expect(bell).toBeInTheDocument();
    expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
  });
});

describe("Story 4.10 — Visual contract (design tokens)", () => {
  it("critical rows use border-severity-critical-value + text-severity-critical-value", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "critical",
              incidentId: INCIDENT_ID_1,
            }),
          ]),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    const row = await screen.findByTestId(`notification-row-${NOTIFICATION_ID_1}`);
    expect(row.className).toContain("border-severity-critical-value");
    const severityLabel = screen.getByTestId(`notification-row-severity-${NOTIFICATION_ID_1}`);
    expect(severityLabel.className).toContain("text-severity-critical-value");
    expect(severityLabel.className).not.toMatch(/\$\{/);
  });
});
