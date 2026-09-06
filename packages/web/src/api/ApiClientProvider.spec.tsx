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
 * The race regression test at the bottom pins that the wiring
 * happens during render (NOT in `useEffect`): a child whose own
 * `useEffect` calls `apiFetch` must see a configured client, not
 * `config === null`.
 *
 * `useNavigate` requires a `<BrowserRouter />` parent — this spec
 * wraps the provider in a minimal MemoryRouter.
 */
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` runs before the module-level `vi.mock` factory, so the
// spy fn reference is hoisted along with it — tests can grab it via
// `configureSpy` without a top-level await / TDZ error.
const configureSpy = vi.hoisted(() => vi.fn());

vi.mock("./apiClient", async () => {
  // `vi.importActual` is intentionally left un-parameterised — the
  // explicit `typeof import(...)` type annotation would trip the
  // `@typescript-eslint/consistent-type-imports` rule. TypeScript
  // infers the module shape from the `importActual` overload.
  const actual = await vi.importActual("./apiClient");
  return {
    ...actual,
    configureApiClient: (...args: Parameters<typeof actual.configureApiClient>) => {
      configureSpy(...args);
      // Forward to the real implementation so the apiClient's
      // module-scoped `config` is actually wired. The race test
      // below relies on this: the child component's `useEffect`
      // calls `apiFetch`, which checks `config` — if the wiring
      // ran in `useEffect` (parent effect) AFTER the child's
      // effect, the call would throw. With the real implementation
      // invoked synchronously here, the call succeeds and the test
      // passes.
      actual.configureApiClient(...args);
    },
    _resetApiClientConfig: () => actual._resetApiClientConfig(),
  };
});

import { API_ORIGIN } from "../apiOrigin";
import { _resetApiClientConfig, apiFetch } from "./apiClient";
import { ApiClientProvider } from "./ApiClientProvider";

describe("ApiClientProvider", () => {
  beforeEach(() => {
    configureSpy.mockClear();
    _resetApiClientConfig();
  });

  afterEach(() => {
    configureSpy.mockReset();
    _resetApiClientConfig();
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

describe("ApiClientProvider — race regression (configureApiClient runs BEFORE any child useEffect)", () => {
  beforeEach(() => {
    configureSpy.mockClear();
    _resetApiClientConfig();
  });

  afterEach(() => {
    configureSpy.mockReset();
    _resetApiClientConfig();
  });

  // Mirror the production shape of `<Routes>` mounting a child
  // component in the same commit phase as `<ApiClientProvider>`.
  // The child fires `apiFetch` from its own `useEffect`. On a
  // hard reload of `/admin/thresholds`, the page's `useQuery`
  // does the same — TanStack Query runs the `queryFn` from the
  // page's `useEffect`. If the provider wired `configureApiClient`
  // from its own `useEffect`, that effect fires AFTER the child's
  // (React runs child effects before parent effects), and the
  // first `apiFetch` throws "configureApiClient() must run before
  // use". The child below pins that contract: the call MUST
  // succeed.
  const ChildFetchesInEffect = ({
    onResult,
  }: {
    readonly onResult: (err: Error | null) => void;
  }) => {
    useEffect(() => {
      void apiFetch("/health")
        .then(() => onResult(null))
        .catch((err: Error) => onResult(err));
    }, [onResult]);
    return <div data-testid="racer-child" />;
  };

  it("a child useEffect that calls apiFetch succeeds (config was wired during render, not in useEffect)", async () => {
    let captured: Error | null = null;
    render(
      <MemoryRouter>
        <ApiClientProvider>
          <ChildFetchesInEffect
            onResult={(err) => {
              captured = err;
            }}
          />
        </ApiClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      // The child effect ran; the fetch either succeeded or threw.
      // We don't care about the fetch outcome (happy-dom has no
      // backend), only that the apiClient did NOT throw
      // "configureApiClient() must run before use".
      expect(captured).not.toBeNull();
    });
    expect(captured?.message).not.toMatch(/must run before use/);
    // Sanity: the provider still wired the config (mock forwards
    // to the real implementation, so `config` is set in the
    // apiClient module).
    expect(configureSpy).toHaveBeenCalledTimes(1);
  });
});
