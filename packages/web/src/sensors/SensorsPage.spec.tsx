/**
 * `SensorsPage.spec.tsx` — Story: build `/sensors` device roster.
 *
 * Coverage matrix (each I/O matrix row → at least one `it(...)`):
 *
 *   - LOADING: deferred-resolve fetch → `sensors-loading` renders.
 *   - HAPPY_PATH: 200 + populated roster → `sensors-table` renders,
 *     one `sensors-row-{id}` per row.
 *   - EMPTY: 200 + `{ devices: [] }` → `sensors-empty` renders with
 *     "No devices registered".
 *   - ERROR_500: 500 → `sensors-error` renders; clicking Retry
 *     triggers a refetch.
 *   - SEVERITY_RESOLVED_OFFLINE: device with `last_reading_at: null`
 *     → row shows the offline severity token.
 *   - SEVERITY_RESOLVED_HEALTHY: device with current healthy reading
 *     in the readings cache → row shows the healthy severity token.
 *   - NAME_NULL_DASH: device with `name: null` → row's Name cell
 *     textContent is "—".
 *   - COLUMN_HEADERS: all five `<th>`s present with the expected
 *     text.
 *   - PAGE_HEADER_TITLE: `<h1>` reads "Sensors".
 *
 * The page mounts two queries — `useSensorsList()` (GET /api/devices)
 * and `useDashboardReadings()` (GET /api/readings/latest). The fetch
 * stub differentiates by URL so a test can pin a critical reading for
 * a device while keeping the roster fixture independent.
 */
import {
  type DeviceSummary,
  type LatestReadingPayload,
} from "@surakkha/shared/dashboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { configureApiClient, _resetApiClientConfig } from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";

import { SensorsPage } from "./SensorsPage";

const DEVICE_OK = "a1111111-0000-4000-8000-000000000001";
const DEVICE_OFFLINE_NULL = "a1111111-0000-4000-8000-000000000002";
const DEVICE_NAMED = "a1111111-0000-4000-8000-000000000003";
const DEVICE_NO_LOCATION = "a1111111-0000-4000-8000-000000000004";

const FIXED_NOW = Date.parse("2026-09-06T12:00:00.000Z");
const HEALTHY_METRICS = {
  ph: 7.2,
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27.4,
  chlorine_ppm: 0.6,
  water_level_cm: 85,
} as const;

const baseDevice = (overrides: Partial<DeviceSummary> & { id: string }): DeviceSummary => ({
  id: overrides.id,
  name: null,
  lat: 27.7172,
  lng: 85.3239,
  last_reading_at: "2026-09-06T11:59:30.000Z",
  ...overrides,
});

const healthyReading = (device_id: string): LatestReadingPayload => ({
  device_id,
  name: null,
  ts: FIXED_NOW,
  server_received_at: new Date(FIXED_NOW).toISOString(),
  metrics: { ...HEALTHY_METRICS },
  flags: [],
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
          <SensorsPage />
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

/**
 * URL-aware fetch stub. `devicesHandler` and `readingsHandler`
 * default to "empty" responses so a test only has to wire what it
 * actually exercises.
 */
const installFetch = (options: {
  readonly devicesResponse?: Response | (() => Response);
  readonly readingsResponse?: Response | (() => Response);
  readonly deferDevices?: boolean;
}): { readonly resolveDevices: (res: Response) => void } => {
  let resolveDevices: ((res: Response) => void) | null = null;
  let deferred: Promise<Response> | null = null;
  if (options.deferDevices === true) {
    deferred = new Promise<Response>((resolve) => {
      resolveDevices = resolve;
    });
  }
  const { devicesResponse, readingsResponse } = options;
  globalThis.fetch = ((url: unknown, init?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : (url as URL).toString();
    captured.push({ url: u, method: init?.method ?? "GET" });
    if (deferred !== null && u.includes("/api/devices")) {
      return deferred;
    }
    if (u.includes("/api/devices")) {
      return Promise.resolve(
        typeof devicesResponse === "function" ? devicesResponse() : (devicesResponse as Response),
      );
    }
    if (u.includes("/api/readings/latest")) {
      return Promise.resolve(
        typeof readingsResponse === "function"
          ? readingsResponse()
          : (readingsResponse as Response),
      );
    }
    return Promise.reject(new Error(`Unhandled fetch in spec: ${u}`));
  }) as unknown as typeof fetch;
  return { resolveDevices: (res) => resolveDevices?.(res) };
};

const ORIGINAL_FETCH = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  configureApiClient({
    apiOrigin: "https://api.test",
    navigate: () => undefined,
    onOffline: () => undefined,
  });
  captured = [];
  // Pin `Date.now` so the page's `now` injection + `isOffline`
  // resolve deterministically (the roster uses `last_reading_at` to
  // flag offline devices against this clock). A spy preserves the
  // fake-timer-free environment that `waitFor` relies on.
  vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  _resetApiClientConfig();
  vi.restoreAllMocks();
});

describe("SensorsPage — device roster", () => {
  it("LOADING: while the request is in flight, the loading copy renders", async () => {
    const { resolveDevices } = installFetch({
      deferDevices: true,
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    expect(screen.queryByTestId("sensors-loading")).not.toBeNull();
    expect(screen.getByText("Loading devices…")).toBeTruthy();
    await act(async () => {
      resolveDevices(jsonResponse({ devices: [] }));
    });
  });

  it("HAPPY_PATH: renders the table when the API returns devices", async () => {
    installFetch({
      devicesResponse: jsonResponse({
        devices: [baseDevice({ id: DEVICE_OK, name: "Lab Sensor" })],
      }),
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
    expect(screen.getByTestId(`sensors-row-${DEVICE_OK}`)).toBeTruthy();
    expect(screen.queryByTestId("sensors-loading")).toBeNull();
    expect(screen.queryByTestId("sensors-error")).toBeNull();
    expect(screen.queryByTestId("sensors-empty")).toBeNull();
  });

  it("EMPTY: empty devices array → 'No devices registered.' renders", async () => {
    installFetch({
      devicesResponse: jsonResponse({ devices: [] }),
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-empty")).not.toBeNull());
    expect(screen.getByTestId("sensors-empty").textContent).toContain("No devices registered");
  });

  it("ERROR_500: 500 → 'sensors-error' renders; clicking Retry refetches", async () => {
    let devicesCallCount = 0;
    installFetch({
      devicesResponse: () => {
        devicesCallCount += 1;
        if (devicesCallCount === 1) {
          return jsonResponse({ error: "internal_error" }, 500);
        }
        return jsonResponse({
          devices: [baseDevice({ id: DEVICE_OK, name: "Recovered" })],
        });
      },
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-error")).not.toBeNull());
    const before = captured.filter((c) => c.url.includes("/api/devices")).length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("sensors-retry"));
    });
    await waitFor(() =>
      expect(
        captured.filter((c) => c.url.includes("/api/devices")).length,
      ).toBeGreaterThan(before),
    );
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
  });

  it("SEVERITY_RESOLVED_OFFLINE: last_reading_at null → row carries the offline token", async () => {
    installFetch({
      devicesResponse: jsonResponse({
        devices: [baseDevice({ id: DEVICE_OFFLINE_NULL, name: "Offline", last_reading_at: null })],
      }),
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
    const row = screen.getByTestId(`sensors-row-${DEVICE_OFFLINE_NULL}`);
    expect(row.getAttribute("data-severity")).toBe("offline");
    const pill = screen.getByTestId(`sensors-severity-${DEVICE_OFFLINE_NULL}`);
    expect(pill.className).toContain("bg-severity-offline-value");
    expect((pill.textContent ?? "").toLowerCase()).toContain("offline");
  });

  it("SEVERITY_RESOLVED_HEALTHY: readings cache supplies a healthy reading → row is healthy", async () => {
    installFetch({
      devicesResponse: jsonResponse({
        devices: [baseDevice({ id: DEVICE_OK, name: "Healthy" })],
      }),
      readingsResponse: jsonResponse({ readings: [healthyReading(DEVICE_OK)] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
    const row = screen.getByTestId(`sensors-row-${DEVICE_OK}`);
    expect(row.getAttribute("data-severity")).toBe("healthy");
    const pill = screen.getByTestId(`sensors-severity-${DEVICE_OK}`);
    expect(pill.className).toContain("bg-severity-healthy-value");
    expect((pill.textContent ?? "").toLowerCase()).toContain("healthy");
  });

  it("NAME_NULL_DASH: device with name null → Name cell textContent is '—'", async () => {
    installFetch({
      devicesResponse: jsonResponse({
        devices: [baseDevice({ id: DEVICE_OK, name: null })],
      }),
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
    const row = screen.getByTestId(`sensors-row-${DEVICE_OK}`);
    const cells = row.querySelectorAll("td");
    expect(cells.length).toBe(5);
    expect(cells[1]?.textContent).toBe("—");
  });

  it("LOCATION_NULL_DASH: device with lat/lng null → Location cell textContent is '—'", async () => {
    installFetch({
      devicesResponse: jsonResponse({
        devices: [baseDevice({ id: DEVICE_NO_LOCATION, lat: null, lng: null })],
      }),
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
    const row = screen.getByTestId(`sensors-row-${DEVICE_NO_LOCATION}`);
    const cells = row.querySelectorAll("td");
    expect(cells[2]?.textContent).toBe("—");
  });

  it("COLUMN_HEADERS: all five <th>s render with the expected text", async () => {
    installFetch({
      devicesResponse: jsonResponse({ devices: [baseDevice({ id: DEVICE_OK })] }),
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
    const headers = screen.getByTestId("sensors-table").querySelectorAll("thead th");
    expect(headers.length).toBe(5);
    const texts = Array.from(headers).map((h) => h.textContent ?? "");
    expect(texts[0]).toBe("Device");
    expect(texts[1]).toBe("Name");
    expect(texts[2]).toBe("Location");
    expect(texts[3]).toBe("Severity");
    expect(texts[4]).toBe("Last Seen");
  });

  it("PAGE_HEADER_TITLE: <h1> reads 'Sensors'", async () => {
    installFetch({
      devicesResponse: jsonResponse({
        devices: [baseDevice({ id: DEVICE_NAMED, name: "Front Lab" })],
      }),
      readingsResponse: jsonResponse({ readings: [] }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("sensors-table")).not.toBeNull());
    expect(screen.getByText("Sensors")).toBeTruthy();
    expect(screen.queryByTestId("page-header-sensors-title")).not.toBeNull();
  });
});
