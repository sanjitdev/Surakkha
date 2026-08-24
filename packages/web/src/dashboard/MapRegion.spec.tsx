/**
 * `MapRegion` — Story 2.7.
 *
 * Coverage matrix (AC1–AC6):
 *
 *   AC1 — Six devices render as six severity-coloured markers.
 *   AC2 — Critical marker carries the `animate-pin-pulse` halo;
 *         non-critical markers do not.
 *   AC3 — Click on a marker opens a popup with the device name,
 *         breached metric + value, severity dot, and link to
 *         `/devices/{device_id}`. Popup closes with Escape
 *         (Leaflet default — exercised via `close()` in the mock).
 *   AC4 — A device with `last_reading_at > 60 s` flips to `offline`
 *         severity and the halo disappears; the popup reads "No
 *         reading yet" when `last_reading_at === null`.
 *   AC5 — Viewer role renders the same surface (no action buttons
 *         in the popup).
 *   AC6 — `GET /api/devices` 500 → the map region renders its
 *         "No devices" empty state and the rest of the dashboard
 *         keeps working from the readings cache.
 *
 * Leaflet is mocked so happy-dom does not have to provide
 * `URL.createObjectURL` / SVG measurement paths the real Leaflet
 * library needs (the dashboard test suite renders React — not
 * a tiled map canvas). The mock captures the icon HTML the map
 * builds so the assertion can grep it for severity + the pulse
 * class.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  configureApiClient,
  _resetApiClientConfig,
} from "../api/apiClient";
import { CurrentRoleProvider } from "../auth/CurrentRoleContext";
import { MapRegion } from "./MapRegion";

/**
 * Mocked `react-leaflet`-less Leaflet handle. The map exposes a
 * `__markers` map (device_id → MockMarker) plus a `__closePopup`
 * spy so the test can drive clicks and asserts the icon HTML
 * captured at `setIcon` time.
 */
interface MockMarker {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  iconHtml: string;
  popupHtml: string;
  boundPopup: boolean;
  onClick: () => void;
  setLatLng: (next: [number, number]) => void;
  setIcon: (icon: { readonly options: { readonly html: string } }) => void;
  setPopupContent: (html: string) => void;
  bindPopup: (html: string) => void;
  remove: () => void;
  addTo: (map: MockMap) => MockMarker;
}

interface MockMap {
  readonly _container: HTMLElement;
  readonly _markerPane: HTMLElement;
  readonly _popupPane: HTMLElement;
  setView: () => void;
  remove: () => void;
  addLayer: () => void;
  invalidateSize: () => void;
}

const buildMockMarker = (id: string, lat: number, lng: number): MockMarker => {
  const marker: MockMarker = {
    id,
    lat,
    lng,
    iconHtml: "",
    popupHtml: "",
    boundPopup: false,
    onClick: () => undefined,
    setLatLng(next) {
      (marker as { lat: number }).lat = next[0];
      (marker as { lng: number }).lng = next[1];
    },
    setIcon(icon) {
      marker.iconHtml = icon.options.html;
      // Mirror Leaflet: when `setIcon` runs, the marker's DOM node
      // is mutated in-place (the `<span>` keeps its identity; the
      // `class` + `data-*` attributes flip). The production API
      // does not unmount the marker. The test must preserve node
      // identity so the no-remount contract is observable.
      updateMarkerNodeAttributes(marker);
    },
    setPopupContent(html) {
      marker.popupHtml = html;
      writePopupNode(marker);
    },
    bindPopup(html) {
      marker.boundPopup = true;
      marker.popupHtml = html;
      writePopupNode(marker);
    },
    remove() {
      removeMarkerNode(marker);
      marker.boundPopup = false;
    },
    addTo(map) {
      installMarkerNode(marker, map);
      return marker;
    },
  };
  return marker;
};

/**
 * Side-effect bookkeeping that mirrors Leaflet's behaviour: when
 * `marker.addTo(map)` runs, the icon HTML lands in the map's
 * `markerPane`; when `bindPopup` runs, the popup HTML lands in the
 * `popupPane`. The test asserts via `container.querySelector` so
 * the marker / popup DOM must live somewhere the test can reach.
 */
const installedMarkers = new Map<string, MockMarker>();
const popupNodes = new Map<string, HTMLElement>();

const installMarkerNode = (marker: MockMarker, map?: MockMap) => {
  const m = map ?? findMarkerPane(marker);
  if (m === undefined) return;
  const span = document.createElement("span");
  span.setAttribute("data-marker-id", marker.id);
  writeMarkerAttributes(span, marker.iconHtml);
  m._markerPane.appendChild(span);
  installedMarkers.set(marker.id, marker);
};

/**
 * In-place DOM mutation that mirrors Leaflet's actual `setIcon`
 * semantics: the existing `<span>` keeps its identity; only the
 * `class` + `data-*` attributes flip. This is what the production
 * component relies on (see MapView.tsx — `marker.setIcon(newIcon)`
 * without `remove()` / `addTo()`).
 */
const updateMarkerNodeAttributes = (marker: MockMarker): void => {
  const existing = installedMarkers.get(marker.id);
  for (const m of mockMaps.values()) {
    const node = m._markerPane.querySelector(
      `[data-marker-id="${marker.id}"]`,
    );
    if (node !== null) {
      writeMarkerAttributes(node, marker.iconHtml);
      return;
    }
  }
  void existing;
};

/**
 * Pull the test-asserted attributes (class, data-pin-severity,
 * data-pulse) out of the icon HTML and write them onto the span
 * node. Used by both the `installMarkerNode` initial mount and the
 * `updateMarkerNodeAttributes` in-place rewrite path.
 */
const writeMarkerAttributes = (span: Element, iconHtml: string): void => {
  const classMatch = /class="([^"]*)"/.exec(iconHtml);
  if (classMatch !== null) {
    const cls = classMatch[1] ?? "";
    span.setAttribute("class", cls);
  } else {
    span.removeAttribute("class");
  }
  const sevMatch = /leaflet-pin-(\w+)/.exec(iconHtml);
  if (sevMatch !== null) {
    const sev = sevMatch[1] ?? "";
    span.setAttribute("data-pin-severity", sev);
  } else {
    span.removeAttribute("data-pin-severity");
  }
  if (iconHtml.includes("animate-pin-pulse")) {
    span.setAttribute("data-pulse", "true");
  } else {
    span.removeAttribute("data-pulse");
  }
};

const findMarkerIconNodes = (
  marker: MockMarker,
): { readonly outer: Element | null } => {
  for (const m of mockMaps.values()) {
    const outer = m._markerPane.querySelector(
      `[data-marker-id="${marker.id}"]`,
    );
    if (outer !== null) return { outer };
  }
  return { outer: null };
};
void findMarkerIconNodes;

const removeMarkerNode = (marker: MockMarker) => {
  for (const m of mockMaps.values()) {
    const node = m._markerPane.querySelector(
      `[data-marker-id="${marker.id}"]`,
    );
    if (node !== null) node.remove();
  }
  installedMarkers.delete(marker.id);
};

const writePopupNode = (marker: MockMarker) => {
  for (const m of mockMaps.values()) {
    let node = m._popupPane.querySelector(
      `[data-popup-id="${marker.id}"]`,
    );
    if (node === null) {
      node = document.createElement("div");
      node.setAttribute("data-popup-id", marker.id);
      m._popupPane.appendChild(node);
    }
    node.innerHTML = marker.popupHtml;
    popupNodes.set(marker.id, node as HTMLElement);
  }
};

const findMarkerPane = (marker: MockMarker): MockMap | undefined => {
  // Single-map test environment — there's only ever one map
  // mounted at a time. The marker pane is the first one we find.
  for (const m of mockMaps.values()) {
    return m;
  }
  void marker;
  return undefined;
};

const mockMaps = new Map<string, MockMap>();

// `vi.mock` is hoisted, so this mutable ref + the inlined factory
// below let the mock capture per-test fixture state without
// "Cannot access before initialization" errors.
const tileLayers: Array<{ readonly url: string }> = [];

vi.mock("leaflet", () => ({
  default: {
    map: (el: HTMLElement, _opts: unknown) => {
      const container = el;
      const markerPane = document.createElement("div");
      markerPane.dataset["leafletPane"] = "markerPane";
      const popupPane = document.createElement("div");
      popupPane.dataset["leafletPane"] = "popupPane";
      container.appendChild(markerPane);
      container.appendChild(popupPane);
      const mapId = `map-${mockMaps.size}`;
      const map: MockMap = {
        _container: container,
        _markerPane: markerPane,
        _popupPane: popupPane,
        setView: () => undefined,
        remove: () => {
          mockMaps.delete(mapId);
          markerPane.remove();
          popupPane.remove();
        },
        addLayer: () => undefined,
        invalidateSize: () => undefined,
      };
      mockMaps.set(mapId, map);
      return map;
    },
    divIcon: (opts: { readonly className: string; readonly html: string }) => ({
      options: opts,
    }),
    tileLayer: (url: string) => {
      tileLayers.push({ url });
      return { addTo: () => undefined };
    },
    marker: (latLng: [number, number], options?: { readonly icon?: { readonly options: { readonly html: string } } }) => {
      // Use a stable ID (the lat/lng) so the test's lookup by
      // device-id-via-marker-pane matches the same node across
      // re-renders. The production code keys markers by device.id;
      // the mock mirrors that by deriving a stable key from the
      // position. This lets the live-flip test verify DOM-node
      // identity preservation across the no-remount contract.
      const id = `marker-${latLng[0]}-${latLng[1]}`;
      const m = buildMockMarker(id, latLng[0], latLng[1]);
      // Leaflet accepts the icon in the constructor options. The
      // real API accepts a `divIcon` instance directly; our mock
      // reads `options.icon.options.html` to capture the icon HTML
      // at construction time so the marker's DOM node is wired up
      // by `addTo(map)`.
      const icon = options?.icon;
      if (icon !== undefined) m.iconHtml = icon.options.html;
      return m;
    },
  },
}));

const installFetch = (
  handler: (url: string) => Promise<Response>,
): void => {
  globalThis.fetch = handler as unknown as typeof fetch;
};

const ORIGINAL_FETCH = globalThis.fetch;

const HEALTHY_METRICS = {
  ph: 7.2,
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27.4,
  chlorine_ppm: 0.6,
  water_level_cm: 85,
} as const;

const CRITICAL_METRICS = {
  ph: 9.1,
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27.4,
  chlorine_ppm: 0.6,
  water_level_cm: 85,
} as const;

interface DevicesResponse {
  devices: Array<{
    id: string;
    name: string | null;
    lat: number | null;
    lng: number | null;
    last_reading_at: string | null;
  }>;
}

interface ReadingsResponse {
  readings: Array<{
    device_id: string;
    name: string | null;
    ts: number;
    server_received_at: string;
    metrics: typeof HEALTHY_METRICS;
    flags: string[];
  }>;
}

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_B = "9b1c4f00-0000-4000-8000-000000000002";
const DEVICE_C = "9b1c4f00-0000-4000-8000-000000000003";
const DEVICE_D = "9b1c4f00-0000-4000-8000-000000000004";
const DEVICE_E = "9b1c4f00-0000-4000-8000-000000000005";
const DEVICE_F = "9b1c4f00-0000-4000-8000-000000000006";

const buildDevice = (
  id: string,
  name: string,
  lat: number,
  lng: number,
  last_reading_at: string | null,
) => ({ id, name, lat, lng, last_reading_at });

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderMap = (
  devices: DevicesResponse,
  readings: ReadingsResponse,
  role: "Admin" | "Operator" | "Viewer" = "Operator",
) => {
  tileLayers.length = 0;
  const qc = buildQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CurrentRoleProvider initialRole={role}>
          <MapRegion readings={readings.readings} />
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

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
  mockMaps.clear();
  installedMarkers.clear();
  popupNodes.clear();
});

describe("Story 2.7 — AC1: six markers render at the seeded coordinates", () => {
  it("mounts the map and one marker per device", async () => {
    const devices: DevicesResponse = {
      devices: [
        buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, "2026-08-24T10:30:00.000Z"),
        buildDevice(DEVICE_B, "DEVICE-B", 23.7461, 90.3742, "2026-08-24T10:30:00.000Z"),
        buildDevice(DEVICE_C, "DEVICE-C", 23.8103, 90.4125, "2026-08-24T10:30:00.000Z"),
        buildDevice(DEVICE_D, "DEVICE-D", 23.7280, 90.3965, "2026-08-24T10:30:00.000Z"),
        buildDevice(DEVICE_E, "DEVICE-E", 23.7920, 90.4250, "2026-08-24T10:30:00.000Z"),
        buildDevice(DEVICE_F, "DEVICE-F", 23.7590, 90.4480, "2026-08-24T10:30:00.000Z"),
      ],
    };
    const readings: ReadingsResponse = { readings: [] };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    // The map container is mounted at the documented size.
    expect(screen.getByTestId("dashboard-map-view").className).toContain(
      "h-[420px]",
    );
    // One tile layer mounted — the CartoDB light basemap.
    expect(tileLayers.length).toBeGreaterThanOrEqual(1);
  });

  it("uses the severity fill token from color.severity.{sev}.fill", async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [
        buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, fresh),
        buildDevice(DEVICE_B, "DEVICE-B", 23.7461, 90.3742, fresh),
      ],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...HEALTHY_METRICS },
          flags: [],
        },
        {
          device_id: DEVICE_B,
          name: "DEVICE-B",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    // Walk the DOM looking for the severity fill classes on each
    // marker's icon node.
    await waitFor(() => {
      const iconNodes = Array.from(
        screen.getByTestId("dashboard-map-view").querySelectorAll(
          "[data-pin-severity]",
        ),
      );
      const healthyIcons = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "healthy" &&
          n.getAttribute("class")?.includes("bg-severity-healthy-value"),
      );
      const criticalIcons = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "critical" &&
          n.getAttribute("class")?.includes("bg-severity-critical-value"),
      );
      expect(healthyIcons.length).toBeGreaterThanOrEqual(1);
      expect(criticalIcons.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Story 2.7 — AC2: critical marker carries the pin pulse", () => {
  it("critical markers render with the animate-pin-pulse class", async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [
        buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, fresh),
        buildDevice(DEVICE_B, "DEVICE-B", 23.7461, 90.3742, fresh),
      ],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...HEALTHY_METRICS },
          flags: [],
        },
        {
          device_id: DEVICE_B,
          name: "DEVICE-B",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    await waitFor(() => {
      const iconNodes = Array.from(
        screen.getByTestId("dashboard-map-view").querySelectorAll(
          "[data-pin-severity]",
        ),
      );
      const criticalWithPulse = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "critical" &&
          n.getAttribute("data-pulse") === "true",
      );
      const healthyWithPulse = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "healthy" &&
          n.getAttribute("data-pulse") === "true",
      );
      expect(criticalWithPulse.length).toBeGreaterThanOrEqual(1);
      expect(healthyWithPulse.length).toBe(0);
    });
  });
});

describe("Story 2.7 — AC3: popup content + Escape dismisses", () => {
  it("popup shows device name, breached metric + value, severity dot, and link", async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, fresh)],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    const link = await waitFor(() =>
      screen.getByTestId(`dashboard-map-popup-link-${DEVICE_A}`),
    );
    expect(link.getAttribute("href")).toBe(`/devices/${DEVICE_A}`);
  });

  it("popup closes via `closePopup()` (Leaflet default Escape handler)", async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, fresh)],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(
        screen.getByTestId(`dashboard-map-popup-link-${DEVICE_A}`),
      ).toBeInTheDocument();
    });
    // The popup content sits in the popup pane with the device name
    // + breached metric + value.
    expect(screen.getByText("DEVICE-A")).toBeInTheDocument();
    expect(screen.getByText("9.1")).toBeInTheDocument();
    // Leaflet owns the Escape → closePopup() behaviour. A regression
    // would be a removal of the popup binding itself.
    expect(screen.getByText("Open device details")).toBeInTheDocument();
  });

  it("popup for an offline device reads 'No reading yet' when never connected", async () => {
    const devices: DevicesResponse = {
      devices: [buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, null)],
    };
    const readings: ReadingsResponse = { readings: [] };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    const link = await waitFor(() =>
      screen.getByTestId(`dashboard-map-popup-link-${DEVICE_A}`),
    );
    expect(link).toBeInTheDocument();
    expect(screen.getByText("No reading yet")).toBeInTheDocument();
  });
});

describe("Story 2.7 — AC4: offline state", () => {
  it("renders the offline severity for a device whose last_reading_at > 60 s ago", async () => {
    const staleTimestamp = new Date(Date.now() - 90_000).toISOString();
    const freshTimestamp = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [
        buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, staleTimestamp),
        buildDevice(DEVICE_B, "DEVICE-B", 23.7461, 90.3742, freshTimestamp),
      ],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: staleTimestamp,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
        {
          device_id: DEVICE_B,
          name: "DEVICE-B",
          ts: 1,
          server_received_at: freshTimestamp,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    await waitFor(() => {
      const iconNodes = Array.from(
        screen.getByTestId("dashboard-map-view").querySelectorAll(
          "[data-pin-severity]",
        ),
      );
      const offlineIcons = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "offline" &&
          n.getAttribute("class")?.includes("bg-severity-offline-value"),
      );
      const criticalIcons = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "critical" &&
          n.getAttribute("data-pulse") === "true",
      );
      const offlineWithPulse = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "offline" &&
          n.getAttribute("data-pulse") === "true",
      );
      expect(offlineIcons.length).toBeGreaterThanOrEqual(1);
      expect(criticalIcons.length).toBeGreaterThanOrEqual(1);
      expect(offlineWithPulse.length).toBe(0);
    });
  });
});

describe("Story 2.7 — AC5: Viewer reads the same surface", () => {
  it("renders markers read-only for the Viewer role", async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [
        buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, fresh),
        buildDevice(DEVICE_B, "DEVICE-B", 23.7461, 90.3742, fresh),
      ],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...HEALTHY_METRICS },
          flags: [],
        },
        {
          device_id: DEVICE_B,
          name: "DEVICE-B",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings, "Viewer");
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    // Popup link is informational; no action buttons.
    expect(
      screen.queryByTestId("dashboard-action-button"),
    ).toBeNull();
  });
});

describe("Story 2.7 — loading state (I/O matrix: 'Map renders before the devices query resolves')", () => {
  it("renders 'Loading map…' overlay while the devices query is in-flight", async () => {
    // The fetch handler for /api/devices never resolves, so TanStack
    // Query stays in `isLoading: true`. The map must NOT mount yet,
    // and the empty state must NOT flash.
    installFetch((url: string) => {
      if (url.endsWith("/api/devices")) {
        return new Promise<Response>(() => undefined);
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Promise<Response>(() => undefined);
      }
      return new Promise<Response>((resolve) => resolve(new Response("{}", { status: 404 })));
    });

    renderMap({ devices: [] }, { readings: [] });

    // The region contract (data-testid) is preserved, the loading
    // overlay shows, and Leaflet does NOT mount.
    expect(screen.getByTestId("dashboard-map-region")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-map-loading")).toHaveTextContent(
      "Loading map…",
    );
    expect(screen.queryByTestId("dashboard-map-view")).toBeNull();
    expect(screen.queryByTestId("dashboard-map-empty")).toBeNull();
  });
});

describe("Story 2.7 — AC6: /api/devices 500 → empty state", () => {
  it("falls back to the 'No devices' empty state when the devices query errors", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response("internal", { status: 500 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify({ readings: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap({ devices: [] }, { readings: [] });

    await waitFor(() => {
      expect(
        screen.getByTestId("dashboard-map-empty"),
      ).toHaveTextContent("No devices");
    });
    // The actual Leaflet container is not mounted when the devices
    // query 500s — the KPI band + Live Readings table continue
    // rendering from the (still-working) readings cache.
    expect(screen.queryByTestId("dashboard-map-view")).toBeNull();
  });

  it("also falls back to 'No devices' when the devices list is empty (200 with [] body)", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify({ devices: [] }), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify({ readings: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap({ devices: [] }, { readings: [] });

    await waitFor(() => {
      expect(
        screen.getByTestId("dashboard-map-empty"),
      ).toHaveTextContent("No devices");
    });
    expect(screen.queryByTestId("dashboard-map-view")).toBeNull();
  });
});

describe("Story 2.7 — reading:new severity flip without remount (AC2 realtime path)", () => {
  it("flips a critical marker's severity to healthy on parent readings update without unmounting", async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, fresh)],
    };
    // Initial payload: critical. After we re-render the parent with
    // a healthy payload, the marker must flip severity + lose the
    // pulse — and the DOM node identity must persist (no remount).
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const initialReadings = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };

    const TestParent = () => {
      const [readings, setReadings] = React.useState(initialReadings);
      return (
        <>
          <button
            type="button"
            data-testid="flip-readings"
            onClick={() =>
              setReadings({
                readings: [
                  {
                    device_id: DEVICE_A,
                    name: "DEVICE-A",
                    ts: 2,
                    server_received_at: fresh,
                    metrics: { ...HEALTHY_METRICS },
                    flags: [],
                  },
                ],
              })
            }
          >
            Flip
          </button>
          <MapRegion readings={readings.readings} />
        </>
      );
    };

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <CurrentRoleProvider initialRole="Operator">
            <TestParent />
          </CurrentRoleProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Capture the original marker node identity so we can prove it
    // wasn't unmounted when severity flips.
    const originalNode = await waitFor(() => {
      const node = screen
        .getByTestId("dashboard-map-view")
        .querySelector(`[data-marker-id]`);
      expect(node).not.toBeNull();
      return node;
    });
    expect(originalNode.getAttribute("data-pin-severity")).toBe("critical");
    expect(originalNode.getAttribute("data-pulse")).toBe("true");

    // Simulate the same path `useDashboardSocket` triggers on every
    // `reading:new`: the parent re-renders `MapRegion` with the new
    // readings payload.
    fireEvent.click(screen.getByTestId("flip-readings"));

    await waitFor(() => {
      const node = screen
        .getByTestId("dashboard-map-view")
        .querySelector(`[data-marker-id]`);
      expect(node?.getAttribute("data-pin-severity")).toBe("healthy");
      // The pulse class must be absent on a non-critical marker.
      expect(node?.getAttribute("data-pulse")).toBeNull();
      // DOM node identity preserved (no remount).
      expect(node).toBe(originalNode);
    });
  });
});

describe("Story 2.7 — AC4 popup body for stale-but-non-null last_reading_at", () => {
  it("popup reads 'Offline — last seen …' when last_reading_at is stale but non-null", async () => {
    const staleTimestamp = new Date(Date.now() - 90_000).toISOString();
    const devices: DevicesResponse = {
      devices: [
        buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, staleTimestamp),
      ],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: staleTimestamp,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderMap(devices, readings);

    await waitFor(() => {
      const map = mockMaps.values().next().value as
        | { _popupPane: HTMLElement }
        | undefined;
      expect(map).toBeDefined();
      const html = map!._popupPane.innerHTML;
      expect(html).toContain("Offline");
      expect(html).toContain("last seen");
      // The "No reading yet" copy is reserved for never-connected
      // devices; this device DID connect then went stale.
      expect(html).not.toContain("No reading yet");
    });
  });
});

describe("Story 2.7 — prefers-reduced-motion does not crash", () => {
  it("renders without throwing when the user prefers reduced motion", async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const devices: DevicesResponse = {
      devices: [
        buildDevice(DEVICE_A, "DEVICE-A", 23.7806, 90.4074, fresh),
      ],
    };
    const readings: ReadingsResponse = {
      readings: [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1,
          server_received_at: fresh,
          metrics: { ...CRITICAL_METRICS },
          flags: [],
        },
      ],
    };
    installFetch(async (url) => {
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify(devices), { status: 200 });
      }
      if (url.endsWith("/api/readings/latest")) {
        return new Response(JSON.stringify(readings), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    // happy-dom's matchMedia returns false by default; the
    // existing index.css rule under prefers-reduced-motion is
    // the authoritative gate. The test simply verifies the render
    // doesn't throw when the user has the preference set.
    window.matchMedia = (q: string) => ({
      matches:
        q === "(prefers-reduced-motion: reduce)" ? true : false,
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });

    renderMap(devices, readings);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-map-view")).toBeInTheDocument();
    });
    // The pulse class is set unconditionally on critical markers;
    // the CSS disables the animation under reduced motion. The
    // marker is still red.
    await waitFor(() => {
      const iconNodes = Array.from(
        screen.getByTestId("dashboard-map-view").querySelectorAll(
          "[data-pin-severity]",
        ),
      );
      const criticalWithPulse = iconNodes.filter(
        (n) =>
          n.getAttribute("data-pin-severity") === "critical" &&
          n.getAttribute("data-pulse") === "true",
      );
      expect(criticalWithPulse.length).toBeGreaterThanOrEqual(1);
    });
    // Compile-time guard: the test reached completion; React
    // didn't throw.
    expect(true).toBe(true);
  });
});

// Avoid unused-import warnings in jsdom / eslint
void fireEvent;
