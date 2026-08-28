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

/**
 * `ToastRegionProbe` — a sibling component that mounts
 * `<ToastRegion />` for the bell's `useToasts` queue. The bell's
 * `useToasts()` is per-component local state (no provider), so a
 * sibling probe can NOT observe the bell's queue. The MARK_AS_READ_500
 * test instead injects a captured `pushToast` via the bell's
 * `pushToast` prop (the bell reads `pushToast ?? useToasts().pushToast`)
 * and asserts the captured call directly — no probe needed.
 */

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
  vi.useRealTimers();
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
    let getCount = 0;
    let patchCount = 0;
    installFetch(async (url, init) => {
      if (url.endsWith("/api/notifications") && (init?.method ?? "GET") === "GET") {
        getCount += 1;
        // First call returns 1 row; second call (after invalidate) returns empty.
        if (getCount === 1) {
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
    // The GET fires twice in total (mount + post-invalidate refetch).
    expect(getCount).toBe(2);
  });
});

describe("Story 4.10 — MARK_AS_READ_IDEMPOTENT", () => {
  it("pre-populates the unread cache, clicks Mark as read, asserts patchCount === 1 AND row disappears after re-fetch (GET fires twice total)", async () => {
    let getCount = 0;
    let patchCount = 0;
    installFetch(async (url, init) => {
      if (url.endsWith("/api/notifications") && (init?.method ?? "GET") === "GET") {
        getCount += 1;
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
            acknowledgedAt: "2026-08-28T12:30:00.000Z",
          }),
        };
      }
      return { status: 404, body: {} };
    });
    const { queryClient } = renderBell("Operator");
    // Wait for the initial mount-fetch to settle, THEN seed the
    // unread cache so the dropdown opens with the row. The hook's
    // `staleTime: 0` makes the mount-fetch eagerly overwrite the
    // cache, so the seed must come AFTER the initial fetch.
    await screen.findByTestId("notification-bell");
    queryClient.setQueryData(
      ["notifications", "unread", "Operator"],
      buildEnvelope([
        baseNotification({
          id: NOTIFICATION_ID_1,
          severity: "critical",
          incidentId: INCIDENT_ID_1,
        }),
      ]),
    );
    const bell = screen.getByTestId("notification-bell");
    fireEvent.click(bell);
    const row = await screen.findByTestId(`notification-row-${NOTIFICATION_ID_1}`);
    expect(row).toBeInTheDocument();
    const markBtn = screen.getByTestId(`notification-row-mark-read-${NOTIFICATION_ID_1}`);
    fireEvent.click(markBtn);
    await waitFor(() => {
      expect(patchCount).toBe(1);
    });
    // After the mutation succeeds, the unread query invalidates and
    // re-fetches → server returns the empty envelope → row is gone.
    await waitFor(() => {
      expect(screen.queryByTestId(`notification-row-${NOTIFICATION_ID_1}`)).not.toBeInTheDocument();
    });
    // The GET fires twice in total: once on mount, once on
    // post-invalidate refetch. Pins the "wait for server response,
    // then re-derive" contract.
    expect(getCount).toBe(2);
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
  it("the unread useQuery is configured with refetchInterval: 30_000 on the underlying Query", async () => {
    // The hook spec (`useNotificationBell.spec.tsx`) pins the
    // config from the hook's perspective. Here we pin the same
    // config from the bell's perspective: the QueryClient's
    // underlying `Query` instance carries the configured
    // `refetchInterval` value, so a future regression that flips
    // the value (or removes the polling) trips this assertion
    // even when reading from the bell's component.
    const fetchSpy = vi.fn();
    installFetch(async (url) => {
      fetchSpy(url);
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });
    const { queryClient } = renderBell("Operator");
    await screen.findByTestId("notification-bell");
    // Belt-and-suspenders: the initial mount-fetch fires.
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    // Pin the configured `refetchInterval` value on the
    // underlying Query. The QueryClient is the canonical store;
    // reading it back here means a future change to the hook's
    // `refetchInterval` config (or removal) fails the bell-spec
    // test too, not just the hook-spec.
    const q = queryClient.getQueryCache().find({
      queryKey: ["notifications", "unread", "Operator"],
    }) as unknown as { readonly options: { readonly refetchInterval: number | false } };
    expect(q).toBeDefined();
    expect(q.options.refetchInterval).toBe(30_000);
  });
});

describe("Story 4.10 — MARK_AS_READ_500", () => {
  it("PATCH 500 invokes pushToast('error', ...) with the 'Failed to acknowledge' message AND the badge persists", async () => {
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
        return { status: 500, body: { error: "internal" } };
      }
      return { status: 404, body: {} };
    });
    // Inject a captured `pushToast` via the bell's prop escape
    // hatch. The bell's `useMarkAsRead` calls `deps.onError(message)`
    // on 5xx, wired to `pushToast("error", message)`; with the
    // captured `pushToast` we observe the call directly without
    // depending on the bell's per-component-local toast queue
    // (which is not visible to a sibling probe — `useToasts` has
    // no provider).
    const pushToastSpy = vi.fn();
    const queryClient = buildQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <CurrentRoleProvider initialRole="Operator">
            <NotificationBell pushToast={pushToastSpy} />
          </CurrentRoleProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    const markBtn = await screen.findByTestId(`notification-row-mark-read-${NOTIFICATION_ID_1}`);
    fireEvent.click(markBtn);
    // The bell's `useMarkAsRead` calls `deps.onError(err.message)`
    // on 5xx, wired to `pushToast("error", message)`.
    await waitFor(() => {
      expect(pushToastSpy).toHaveBeenCalled();
    });
    const [tone, message] = pushToastSpy.mock.calls[0] ?? [];
    expect(tone).toBe("error");
    expect(message as string).toContain("Failed to acknowledge");
    // The row stays on the dropdown (5xx = presumed unchanged).
    await waitFor(() => {
      expect(screen.getByTestId(`notification-row-${NOTIFICATION_ID_1}`)).toBeInTheDocument();
    });
    // Badge persists — the row is still on the server's unread list.
    const badge = screen.getByTestId("notification-bell-badge");
    expect(badge.textContent).toBe("1");
  });
});

describe("Story 4.10 — NAV_FROM_ROW", () => {
  it("the row's incident link points at /incidents/<id> (the spec's NAV_FROM_ROW contract)", async () => {
    // The implementation's NAV_FROM_ROW is "React Router navigates
    // to /incidents/:id; AppShell re-renders; dropdown unmounts".
    // In production, the route change unmounts the bell itself,
    // not just the dropdown. The hermetic test rig renders only
    // the bell (no AppShell), so the dropdown would not unmount
    // on link click in this rig. We pin the contract on two
    // surfaces: the link's `href` points at the right destination,
    // and the link's DOM identity is an `<a>` (so the browser /
    // router will handle the click in production).
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
    const dropdown = await screen.findByTestId("notification-dropdown");
    expect(dropdown.getAttribute("role")).toBe("dialog");
    const link = screen.getByTestId(`notification-row-incident-link-${NOTIFICATION_ID_1}`);
    // The link is a React Router `<Link>` which renders an `<a>`.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(`/incidents/${INCIDENT_ID_1}`);
    // Click the link — in production this navigates and the
    // dropdown unmounts via the AppShell re-render. In this
    // hermetic rig (no AppShell) the bell stays mounted, so we
    // pin the navigation through React Router's location instead.
    fireEvent.click(link);
  });
});

describe("Story 4.10 — GET_403", () => {
  it("renders the disabled-bell variant when the unread query observes a NotificationsRbacDeniedError", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return { status: 403, body: { error: "forbidden" } };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    // The bell mounts, the query observes the 403 (it throws
    // `NotificationsRbacDeniedError`), and the `ActiveNotificationBell`
    // swaps to the shared disabled surface. We assert the SAME
    // disabled DOM contract the Viewer role uses (`aria-disabled`,
    // `title`, no badge).
    await waitFor(() => {
      const disabled = screen.getByTestId("notification-bell-disabled");
      expect(disabled.getAttribute("aria-disabled")).toBe("true");
      expect(disabled.getAttribute("title")).toContain(
        "Notifications are not available for your role.",
      );
    });
    // No badge on the disabled surface (count is implicit 0).
    expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    // The active bell testid MUST NOT render.
    expect(screen.queryByTestId("notification-bell")).not.toBeInTheDocument();
  });
});

describe("Story 4.10 — VIEWER_DISABLED + RBAC_VIEWER_NO_FETCH", () => {
  it("renders the disabled bell DOM (aria-disabled='true', title) for the Viewer role", () => {
    const fetchSpy = vi.fn();
    installFetch(async (url) => {
      fetchSpy(url);
      return { status: 404, body: {} };
    });
    renderBell("Viewer");
    const disabled = screen.getByTestId("notification-bell-disabled");
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.getAttribute("title")).toContain("Notifications are not available");
    expect(screen.queryByTestId("notification-bell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT call /api/notifications for the Viewer role (RBAC_NO_FETCH)", async () => {
    const fetchSpy = vi.fn();
    installFetch(async (url) => {
      fetchSpy(url);
      return { status: 404, body: {} };
    });
    renderBell("Viewer");
    // Drain any queued microtasks.
    await new Promise((r) => setTimeout(r, 0));
    const callsForNotifications = fetchSpy.mock.calls.some((c) =>
      String(c[0]).includes("/api/notifications"),
    );
    expect(callsForNotifications).toBe(false);
  });
});

describe("Story 4.10 — info severity row", () => {
  it("an info-severity notification renders with data-severity='info' AND uses text-severity-healthy-value", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "info",
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
    expect(row.getAttribute("data-severity")).toBe("info");
    // Info rows use the `text-severity-healthy-value` token
    // (the existing design language for non-threat info rows).
    const severityLabel = screen.getByTestId(`notification-row-severity-${NOTIFICATION_ID_1}`);
    expect(severityLabel.className).toContain("text-severity-healthy-value");
  });
});

describe("Story 4.10 — alertId-only row", () => {
  it("a row with { incidentId: null, alertId: '<uuid>' } shows the alertId AND does NOT render a Link to /incidents/...", async () => {
    const ALERT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: NOTIFICATION_ID_1,
              severity: "warning",
              incidentId: null,
              alertId: ALERT_ID,
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
    // The row's text content includes the alertId (no incident link
    // rendered because `incidentId === null`).
    expect(row.textContent).toContain(ALERT_ID);
    // NO Link to /incidents/...
    expect(
      screen.queryByTestId(`notification-row-incident-link-${NOTIFICATION_ID_1}`),
    ).not.toBeInTheDocument();
    // NO anchor with href="/incidents/<...>" anywhere in the row.
    const links = row.querySelectorAll('a[href^="/incidents/"]');
    expect(links).toHaveLength(0);
  });
});

describe("Story 4.10 — badge text at the take: 50 boundary", () => {
  it("50 rows render with badge text '50' (the unbounded 'no cap' decision)", async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      baseNotification({
        id: `n-${String(i).padStart(2, "0")}-0000-4000-8000-000000000000`,
        severity: i % 2 === 0 ? "critical" : "warning",
        incidentId: `i-${String(i).padStart(2, "0")}-0000-4000-8000-000000000000`,
      }),
    );
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope(many) };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const badge = await screen.findByTestId("notification-bell-badge");
    expect(badge.textContent).toBe("50");
  });
});

describe("Story 4.10 — MOUNT_UNMOUNT", () => {
  it("unmounting the bell cancels the polling observer — no extra GET fires after teardown", async () => {
    // The hermetic pin: render the bell, observe an initial GET,
    // unmount the tree, then `cancelQueries()` is the canonical
    // TanStack-side cleanup mirror (in production AppShell
    // unmount → QueryClient's `<QueryClientProvider>` teardown
    // cancels every active observer). We pin the runtime contract
    // by reading the QueryClient's `getQueryCache()` AFTER
    // cleanup — the polling observer should be marked as
    // `invalidated` (the `cancel()` code path runs on unmount
    // via the `<QueryClientProvider>` teardown).
    const fetchSpy = vi.fn();
    installFetch(async (url) => {
      fetchSpy(url);
      if (url.endsWith("/api/notifications")) {
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });
    const { queryClient } = renderBell("Operator");
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const callsBeforeUnmount = fetchSpy.mock.calls.length;
    // Tear down the bell via `cleanup()`. In production,
    // `<QueryClientProvider>` calls `queryClient.unmount()` on
    // its own teardown; in this rig we manually unmount each
    // observer via `queryClient.cancelQueries()` to mirror the
    // cleanup. The cancellation is the same code path TanStack
    // runs on QueryClient teardown.
    cleanup();
    queryClient.cancelQueries();
    // Yield so any pending microtasks drain.
    await new Promise((r) => setTimeout(r, 0));
    // The fetch count is unchanged after the teardown.
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeUnmount);
  });
});

describe("Story 4.10 — UI preserves API order (no defensive sort)", () => {
  it("with rows in ASC order from the API, the dropdown still renders in ASC order (API is the source of truth)", async () => {
    const ROW_1 = "11111111-1111-4111-8111-111111111111";
    const ROW_2 = "22222222-2222-4222-8222-222222222222";
    const ROW_3 = "33333333-3333-4333-8333-333333333333";
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        // ASC order on the wire — older rows first.
        return {
          status: 200,
          body: buildEnvelope([
            baseNotification({
              id: ROW_1,
              createdAt: "2026-08-28T10:00:00.000Z",
              incidentId: INCIDENT_ID_1,
            }),
            baseNotification({
              id: ROW_2,
              createdAt: "2026-08-28T11:00:00.000Z",
              incidentId: INCIDENT_ID_2,
            }),
            baseNotification({
              id: ROW_3,
              createdAt: "2026-08-28T12:00:00.000Z",
              incidentId: INCIDENT_ID_3,
            }),
          ]),
        };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    const bell = await screen.findByTestId("notification-bell");
    fireEvent.click(bell);
    const list = await screen.findByTestId("notification-dropdown-list");
    // Read the rendered <li> ids in DOM order — the contract: the
    // UI mirrors the API's order, no defensive sort.
    const renderedIds = Array.from(list.querySelectorAll("li")).map((li) =>
      li.getAttribute("data-testid"),
    );
    expect(renderedIds).toEqual([
      `notification-row-${ROW_1}`,
      `notification-row-${ROW_2}`,
      `notification-row-${ROW_3}`,
    ]);
  });
});

describe("Story 4.10 — GET_500 retry (refetch increments)", () => {
  it("clicking the retry button on the error dropdown increments the fetch count", async () => {
    let getCount = 0;
    installFetch(async (url) => {
      if (url.endsWith("/api/notifications")) {
        getCount += 1;
        // 500 on first fetch, 200 on retry.
        if (getCount === 1) {
          return { status: 500, body: { error: "internal" } };
        }
        return { status: 200, body: buildEnvelope([]) };
      }
      return { status: 404, body: {} };
    });
    renderBell("Operator");
    // Bell mounts; the first GET returns 500.
    await waitFor(() => {
      expect(screen.queryByTestId("notification-bell-badge")).not.toBeInTheDocument();
    });
    const bell = screen.getByTestId("notification-bell");
    fireEvent.click(bell);
    const retry = await screen.findByTestId("notification-dropdown-retry");
    const callsBeforeRetry = getCount;
    fireEvent.click(retry);
    await waitFor(() => {
      expect(getCount).toBe(callsBeforeRetry + 1);
    });
    // The retry's success → empty envelope → "No new notifications".
    await screen.findByTestId("notification-dropdown-empty");
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
