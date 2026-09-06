/**
 * `ApiClientProvider` wiring contract.
 *
 * The provider MUST call `configureApiClient(...)` exactly once on
 * mount with the `API_ORIGIN` constant (empty string — same-origin)
 * and a `navigate` function bound to react-router-dom's `useNavigate`.
 * Without this wiring, `apiLogin` and `apiFetch` throw
 * `"apiClient: configureApiClient() must run before use"` — the bug
 * the provider exists to fix.
 *
 * The provider must run BEFORE any route renders so:
 *   - `/login` submit → `apiLogin` is callable.
 *   - Hard reload of `/dashboard` → `apiFetch` is callable for
 *     TanStack Query hooks in Dashboard / Kanban / etc.
 *
 * `useNavigate` requires a `<BrowserRouter />` parent — this spec
 * wraps the provider in a minimal MemoryRouter.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` runs before the module-level `vi.mock` factory, so the
// spy fn reference is hoisted along with it — tests can grab it via
// `configureSpy` without a top-level await / TDZ error.
const configureSpy = vi.hoisted(() => vi.fn());

vi.mock("./apiClient", async () => {
  const actual = await vi.importActual("./apiClient");
  return {
    ...actual,
    configureApiClient: (...args: Parameters<typeof actual.configureApiClient>) =>
      configureSpy(...args),
    _resetApiClientConfig: () => undefined,
  };
});

import { API_ORIGIN } from "../apiOrigin";
import { ApiClientProvider } from "./ApiClientProvider";

describe("ApiClientProvider", () => {
  beforeEach(() => {
    configureSpy.mockClear();
  });

  afterEach(() => {
    configureSpy.mockReset();
  });

  it("calls configureApiClient exactly once on mount", () => {
    render(
      <MemoryRouter>
        <ApiClientProvider>
          <div data-testid="child" />
        </ApiClientProvider>
      </MemoryRouter>,
    );
    expect(configureSpy).toHaveBeenCalledTimes(1);
  });

  it("passes API_ORIGIN (empty string) as the apiOrigin", () => {
    render(
      <MemoryRouter>
        <ApiClientProvider>
          <div />
        </ApiClientProvider>
      </MemoryRouter>,
    );
    const call = configureSpy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call?.apiOrigin).toBe(API_ORIGIN);
    expect(call?.apiOrigin).toBe("");
  });

  it("binds navigate to react-router-dom's useNavigate (functional ref)", () => {
    render(
      <MemoryRouter>
        <ApiClientProvider>
          <div />
        </ApiClientProvider>
      </MemoryRouter>,
    );
    const call = configureSpy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(typeof call?.navigate).toBe("function");
  });

  it("provides an onOffline callback (no-op surface is acceptable)", () => {
    render(
      <MemoryRouter>
        <ApiClientProvider>
          <div />
        </ApiClientProvider>
      </MemoryRouter>,
    );
    const call = configureSpy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(typeof call?.onOffline).toBe("function");
  });

  it("renders its children unchanged", () => {
    const { container } = render(
      <MemoryRouter>
        <ApiClientProvider>
          <span data-testid="probe">hello</span>
        </ApiClientProvider>
      </MemoryRouter>,
    );
    // The probe element appears in the rendered tree (last child
    // node — earlier siblings are StrictMode's intentional double
    // render).
    const probes = container.querySelectorAll('[data-testid="probe"]');
    expect(probes.length).toBeGreaterThan(0);
    expect(probes[probes.length - 1]?.textContent).toBe("hello");
  });
});
