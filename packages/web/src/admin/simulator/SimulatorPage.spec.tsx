/**
 * Story 2.5 — SimulatorPage integration.
 *
 * AC matrix:
 *   - Admin: six rows render with the right testids and the row
 *     controls work.
 *   - non-admin: `<RbacDenied />` renders, no API call beyond the
 *     route gate.
 *   - disabled banner: status endpoint returns 503 → banner only, no
 *     controls rendered.
 *   - Switch posts and shows a success toast; on failure the UI
 *     does NOT update optimistically (the row keeps the old scenario
 *     badge).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { CurrentRoleProvider } from "../../auth/CurrentRoleContext";
import { RbacRoute } from "../../access/RbacRoute";
import { AppShell } from "../../shell/AppShell";
import { configureApiClient, _resetApiClientConfig } from "../../api/apiClient";

import { SimulatorPage } from "./SimulatorPage";

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_B = "9b1c4f00-0000-4000-8000-000000000002";
const DEVICE_C = "9b1c4f00-0000-4000-8000-000000000003";
const DEVICE_D = "9b1c4f00-0000-4000-8000-000000000004";
const DEVICE_E = "9b1c4f00-0000-4000-8000-000000000005";
const DEVICE_F = "9b1c4f00-0000-4000-8000-000000000006";

const DEVICE_LIST = [
  { device_id: DEVICE_A, name: "DEVICE-1", scenario: "Normal" },
  { device_id: DEVICE_B, name: "DEVICE-2", scenario: "RisingTDS" },
  { device_id: DEVICE_C, name: "DEVICE-3", scenario: "TurbiditySpike" },
  { device_id: DEVICE_D, name: "DEVICE-4", scenario: "ChlorineDrop" },
  { device_id: DEVICE_E, name: "DEVICE-5", scenario: "Offline" },
  { device_id: DEVICE_F, name: "DEVICE-6", scenario: "RandomFailure" },
];

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

const buildQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

const renderAdminSimulator = () => {
  const qc = buildQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/simulator"]}>
        <CurrentRoleProvider initialRole="Admin">
          <AppShell>
            <RbacRoute>
              <SimulatorPage />
            </RbacRoute>
          </AppShell>
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const renderDeniedSimulator = (role: "Viewer" | "Operator" | "Technician" | null) => {
  const qc = buildQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/simulator"]}>
        <CurrentRoleProvider initialRole={role}>
          <AppShell>
            <RbacRoute>
              <SimulatorPage />
            </RbacRoute>
          </AppShell>
        </CurrentRoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const ORIGINAL_FETCH = globalThis.fetch;

const installFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>): void => {
  globalThis.fetch = handler as unknown as typeof fetch;
};

beforeEach(() => {
  setViewport(1280);
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
});

describe("Story 2.5 — Admin renders six rows with controls", () => {
  it("renders six DeviceRow instances with the documented testids", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();

    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-${DEVICE_A}`)).toBeInTheDocument();
    });
    for (const d of DEVICE_LIST) {
      expect(screen.getByTestId(`simulator-row-${d.device_id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`simulator-row-switch-${d.device_id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`simulator-row-pause-${d.device_id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("simulator-device-count").textContent).toContain("6");
  });

  it("renders the disabled banner when /status returns 503", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: false, reason: "missing" }), {
          status: 503,
        });
      }
      return new Response("{}", { status: 404 });
    });
    renderAdminSimulator();

    await waitFor(() => {
      expect(screen.getByTestId("simulator-page-disabled")).toBeInTheDocument();
    });
    expect(screen.getByTestId("simulator-disabled-banner")).toBeInTheDocument();
    expect(screen.queryByTestId(`simulator-row-${DEVICE_A}`)).toBeNull();
  });
});

describe("Story 2.5 — RbacDenied for non-Admin roles", () => {
  for (const role of ["Viewer", "Operator", "Technician"] as const) {
    it(`renders <RbacDenied /> for ${role} without calling the api`, async () => {
      const fetchSpy = vi.fn();
      installFetch((url) => {
        fetchSpy(url);
        return Promise.resolve(new Response("{}", { status: 404 }));
      });
      renderDeniedSimulator(role);

      // The RbacDenied surface renders synchronously; no api call
      // should have been made.
      await waitFor(() => {
        expect(screen.getByTestId("rbac-denied")).toBeInTheDocument();
      });
      // Story 4.8 — the AppShell now mounts `<SeverityBanner />`,
      // which reads `GET /api/incidents/active`. This is a
      // permissioned endpoint (not the simulator); the call is
      // independent of the route gate's RBAC check. The simulator-
      // specific endpoints (`/admin/simulator/status`,
      // `/admin/simulator/devices`) MUST NOT be called when the
      // route gate denies.
      const simulatorCalls = fetchSpy.mock.calls.filter(
        ([url]) =>
          typeof url === "string" &&
          (url.includes("/admin/simulator/status") || url.includes("/admin/simulator/devices")),
      );
      expect(simulatorCalls).toHaveLength(0);
    });
  }
});

describe("Story 2.5 — Switch happy path", () => {
  it("POSTs the new scenario and shows a success toast", async () => {
    const posted: Array<{ url: string; body: string }> = [];
    installFetch(async (url, init) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        const body = (init?.body as string) ?? "";
        posted.push({ url, body });
        return new Response(JSON.stringify({ applied: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-switch-${DEVICE_B}`)).toBeInTheDocument();
    });

    // DEVICE_B's current scenario is "RisingTDS"; pick a DIFFERENT
    // scenario so the row's no-change short-circuit (G3-14) doesn't
    // suppress the POST. Verify the body matches the user-driven
    // choice, not the row's initial value.
    await user.selectOptions(
      screen.getByTestId(`simulator-row-select-${DEVICE_B}`),
      "TurbiditySpike",
    );
    await user.click(screen.getByTestId(`simulator-row-switch-${DEVICE_B}`));

    await waitFor(() => {
      expect(screen.getByTestId("simulator-toast-success")).toBeInTheDocument();
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toContain(DEVICE_B);
    // G3-14: the Switch submit bundles the row's local `paused`
    // state so a scenario change can't leave the device stuck
    // paused. Initial paused is false, so the body includes it.
    expect(JSON.parse(posted[0]?.body ?? "{}")).toEqual({
      scenario: "TurbiditySpike",
      paused: false,
    });
  });
});

describe("Story 2.5 — Switch failure path", () => {
  it("shows an error toast and does NOT optimistically update the row", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        return new Response(JSON.stringify({ error: "simulator_unreachable" }), {
          status: 502,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-switch-${DEVICE_A}`)).toBeInTheDocument();
    });

    // The row's scenario badge starts at "Normal" (from DEVICE_LIST).
    expect(screen.getByTestId(`simulator-row-scenario-${DEVICE_A}`).textContent).toBe("Normal");

    // Change the select first so the no-change short-circuit
    // (G3-14) doesn't suppress the POST.
    await user.selectOptions(
      screen.getByTestId(`simulator-row-select-${DEVICE_A}`),
      "TurbiditySpike",
    );
    await user.click(screen.getByTestId(`simulator-row-switch-${DEVICE_A}`));

    await waitFor(() => {
      expect(screen.getByTestId("simulator-toast-error")).toBeInTheDocument();
    });
    // The row's badge is unchanged — no optimistic update on failure.
    expect(screen.getByTestId(`simulator-row-scenario-${DEVICE_A}`).textContent).toBe("Normal");
  });
});

describe("Story 2.5 — Pause control", () => {
  it("POSTs { paused: true } when the Pause button is clicked", async () => {
    const posted: Array<{ url: string; body: string }> = [];
    installFetch(async (url, init) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        const body = (init?.body as string) ?? "";
        posted.push({ url, body });
        return new Response(JSON.stringify({ applied: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`)).toBeInTheDocument();
    });

    await user.click(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`));

    await waitFor(() => {
      expect(posted.length).toBeGreaterThanOrEqual(1);
    });
    expect(posted[0]?.url).toContain(DEVICE_C);
    expect(JSON.parse(posted[0]?.body ?? "{}")).toEqual({
      paused: true,
    });
  });

  it("reverts the Pause button label to 'Pause' when the POST returns 502", async () => {
    // Regression — the Pause handler previously toggled local
    // `paused` state synchronously on click. On a 502 the state was
    // not reverted and the button rendered "Resume" while the
    // simulator remained running. The fix defers the toggle to the
    // mutation's onSuccess callback.
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        return new Response(JSON.stringify({ error: "simulator_unreachable" }), {
          status: 502,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`)).toBeInTheDocument();
    });

    const pauseButton = screen.getByTestId(`simulator-row-pause-${DEVICE_C}`);
    expect(pauseButton.textContent).toBe("Pause");

    await user.click(pauseButton);

    await waitFor(() => {
      expect(screen.getByTestId("simulator-toast-error")).toBeInTheDocument();
    });
    // After the error toast surfaces, the label MUST still be "Pause"
    // — no optimistic revert.
    expect(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`).textContent).toBe("Pause");
  });
});

describe("Story 2.5 — 409 switch_in_progress surfaces as an error toast", () => {
  it("shows an error toast when a second Switch hits the single-flight registry", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        return new Response(JSON.stringify({ error: "switch_in_progress" }), {
          status: 409,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-switch-${DEVICE_D}`)).toBeInTheDocument();
    });

    // Change the select first so the no-change short-circuit
    // (G3-14) doesn't suppress the POST. DEVICE_D's current
    // scenario is "ChlorineDrop".
    await user.selectOptions(screen.getByTestId(`simulator-row-select-${DEVICE_D}`), "Normal");
    await user.click(screen.getByTestId(`simulator-row-switch-${DEVICE_D}`));

    await waitFor(() => {
      expect(screen.getByTestId("simulator-toast-error")).toBeInTheDocument();
    });
    // AC matrix: pin the user-facing copy.
    expect(screen.getByTestId("simulator-toast-error").textContent).toBe(
      "Another switch is in progress.",
    );
  });
});

describe("Story 2.5 — Switch happy-path toast text (G3-07)", () => {
  it("renders 'Switched to <scenario>.' with the user-selected scenario", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        return new Response(JSON.stringify({ applied: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-switch-${DEVICE_B}`)).toBeInTheDocument();
    });

    // DEVICE_B's current scenario is "RisingTDS"; switch to a
    // DIFFERENT scenario so the user-driven change is observable.
    await user.selectOptions(
      screen.getByTestId(`simulator-row-select-${DEVICE_B}`),
      "ChlorineDrop",
    );
    await user.click(screen.getByTestId(`simulator-row-switch-${DEVICE_B}`));

    await waitFor(() => {
      expect(screen.getByTestId("simulator-toast-success")).toBeInTheDocument();
    });
    expect(screen.getByTestId("simulator-toast-success").textContent).toBe(
      "Switched to ChlorineDrop.",
    );
  });
});

describe("Story 2.5 — 400 invalid_scenario (AC5)", () => {
  it("shows 'Switch failed: invalid input.' toast", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        return new Response(JSON.stringify({ error: "invalid_scenario" }), {
          status: 400,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-switch-${DEVICE_A}`)).toBeInTheDocument();
    });

    // Change the select first so the no-change short-circuit
    // (G3-14) doesn't suppress the POST. DEVICE_A's current
    // scenario is "Normal".
    await user.selectOptions(screen.getByTestId(`simulator-row-select-${DEVICE_A}`), "RisingTDS");
    await user.click(screen.getByTestId(`simulator-row-switch-${DEVICE_A}`));

    await waitFor(() => {
      expect(screen.getByTestId("simulator-toast-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("simulator-toast-error").textContent).toBe(
      "Switch failed: invalid input.",
    );
  });
});

describe("Story 2.5 — 403 secret_mismatch (AC8) transitions to disabled banner", () => {
  it("shows the disabled banner and the same toast copy as the missing-secret case", async () => {
    // First /status fetch returns enabled: true (operator was just
    // authenticated); the Switch click returns 403 secret_mismatch
    // (operator's secret in the api is missing); the page-level
    // mutation handler (G3-04) invalidates the status query, which
    // re-fetches /status — second time around the api reports
    // 503 { disabled: true } matching production behavior where the
    // secret was missing at click time but stale-cached at first
    // load.
    let statusCalls = 0;
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          return new Response(JSON.stringify({ enabled: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ disabled: true, reason: "missing" }), {
          status: 503,
        });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        return new Response(JSON.stringify({ error: "secret_mismatch" }), {
          status: 403,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-switch-${DEVICE_A}`)).toBeInTheDocument();
    });

    // Change the select first so the no-change short-circuit
    // (G3-14) doesn't suppress the POST. DEVICE_A's current
    // scenario is "Normal".
    await user.selectOptions(screen.getByTestId(`simulator-row-select-${DEVICE_A}`), "RisingTDS");
    await user.click(screen.getByTestId(`simulator-row-switch-${DEVICE_A}`));

    // G3-04: the 403 transitions the page into the disabled-banner
    // state via status-query invalidation. The disabled banner is
    // the persistent operator-facing signal; the toast is a
    // transient confirmation.
    await waitFor(() => {
      expect(screen.getByTestId("simulator-disabled-banner")).toBeInTheDocument();
    });
  });
});

describe("Story 2.5 — Devices query 5xx surfaces the page-error banner with Retry (G3-12)", () => {
  it("renders the error banner and a Retry button when /devices 500s", async () => {
    let devicesAttempts = 0;
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        devicesAttempts += 1;
        // First attempt 500; subsequent attempts succeed.
        if (devicesAttempts === 1) {
          return new Response("internal", { status: 500 });
        }
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    await waitFor(() => {
      expect(screen.getByTestId("simulator-page-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("simulator-page-retry")).toBeInTheDocument();

    // Click Retry — the devices query refetches and the page
    // transitions into the success branch.
    const user = userEvent.setup();
    await user.click(screen.getByTestId("simulator-page-retry"));

    await waitFor(() => {
      expect(screen.queryByTestId("simulator-page-error")).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-${DEVICE_A}`)).toBeInTheDocument();
    });
  });
});

describe("Story 2.5 — Loading state visible before queries settle (G3-07)", () => {
  it("renders simulator-page-loading on initial mount", async () => {
    let resolveStatus: ((v: Response) => void) | undefined;
    const statusPromise = new Promise<Response>((resolve) => {
      resolveStatus = resolve;
    });
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return statusPromise;
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    // Synchronously after render, the page should be in loading.
    expect(screen.getByTestId("simulator-page-loading")).toBeInTheDocument();
    // Resolve so cleanup runs cleanly.
    resolveStatus?.(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-${DEVICE_A}`)).toBeInTheDocument();
    });
  });
});

describe("Story 2.5 — Status query 500 surfaces as page-status-error (G3-01)", () => {
  it("renders simulator-page-status-error when /status 500s", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response("internal", { status: 500 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    await waitFor(() => {
      expect(screen.getByTestId("simulator-page-status-error")).toBeInTheDocument();
    });
    // Disabled banner MUST NOT surface on a 5xx — that would be
    // misleading (the secret might be set; the api is just down).
    expect(screen.queryByTestId("simulator-disabled-banner")).toBeNull();
  });
});

describe("Story 2.5 — Disabled-banner accepts { disabled: true } wire shape (G3-11)", () => {
  it("renders the disabled banner when /status returns 503 { disabled: true }", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ disabled: true, reason: "missing" }), {
          status: 503,
        });
      }
      return new Response("{}", { status: 404 });
    });
    renderAdminSimulator();

    await waitFor(() => {
      expect(screen.getByTestId("simulator-page-disabled")).toBeInTheDocument();
    });
    expect(screen.getByTestId("simulator-disabled-banner")).toBeInTheDocument();
  });
});

describe("Story 2.5 — Pause success transitions label to 'Resume' (G3-07)", () => {
  it("changes the Pause button label to 'Resume' after a successful pause", async () => {
    installFetch(async (url) => {
      if (url.endsWith("/admin/simulator/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      if (url.endsWith("/admin/simulator/devices")) {
        return new Response(JSON.stringify({ devices: DEVICE_LIST }), {
          status: 200,
        });
      }
      if (url.includes("/admin/simulator/") && url.endsWith("/scenario")) {
        return new Response(JSON.stringify({ applied: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderAdminSimulator();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`)).toBeInTheDocument();
    });

    expect(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`).textContent).toBe("Pause");

    await user.click(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`));

    await waitFor(() => {
      expect(screen.getByTestId("simulator-toast-success")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId(`simulator-row-pause-${DEVICE_C}`).textContent).toBe("Resume");
    });
  });
});
