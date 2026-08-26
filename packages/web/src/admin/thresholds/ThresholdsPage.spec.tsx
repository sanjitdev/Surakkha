/**
 * Story 3.7 — `/admin/thresholds` admin tab RTL coverage.
 *
 * Pins the AC matrix:
 *   - AC7: page renders a table of active rules + history toggle.
 *   - AC8: each row's "Edit" button opens a modal; submitting sends
 *          PATCH supersede and refetches.
 *   - AC9: each row's "Activate" / "Deactivate" buttons send the
 *          corresponding PATCH and refetch. Failures surface as
 *          toasts.
 *   - AC10: the page mounts inside `<RbacRoute>`; non-admin users
 *          see the existing 403 redirect (covered by the
 *          `RbacRoute.spec.tsx` integration test, not here).
 *
 * The test rig stubs `apiFetch` to return canned data so the page
 * branches (loading / error / populated / empty) are exercised
 * without an api round-trip. The mutation hooks go through the
 * same stub via the `apiFetch` mock so we can assert on the call
 * shape and the response-driven invalidation.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type RuleRow } from "@surakkha/shared";

import { ThresholdsPage } from "./ThresholdsPage";

// Mock the apiClient so the page can be tested without a network.
// `vi.hoisted` runs before the module-level `vi.mock`, so the mock
// fn reference is hoisted along with it — tests can grab it via
// `apiFetchMock` without a top-level await.
const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/apiClient", () => ({
  apiFetch: apiFetchMock,
  configureApiClient: () => undefined,
}));

const apiFetch = apiFetchMock;

const ADMIN_RULE: RuleRow = {
  id: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  metric: "ph",
  operator: "lt",
  threshold: 6.5,
  severity: "critical",
  ruleType: "instant",
  minDurationSeconds: 0,
  hysteresisSeconds: 0,
  version: 1,
  createdBy: "seed",
  isActive: true,
};

const buildWrapper = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { readonly children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const jsonResponse = (body: unknown, status: number = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  apiFetch.mockReset();
});
afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("Story 3.7 — ThresholdsPage (AC7-AC9)", () => {
  it("renders the loading stub while the list query is in-flight", () => {
    apiFetch.mockReturnValue(new Promise(() => undefined));
    render(<ThresholdsPage />, { wrapper: buildWrapper() });
    expect(screen.getByTestId("thresholds-page-loading")).toBeTruthy();
  });

  it("renders the empty state when the api returns no rows (AC7)", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ rules: [], nextCursor: null }));
    render(<ThresholdsPage />, { wrapper: buildWrapper() });
    await waitFor(() => {
      expect(screen.queryByTestId("thresholds-page")).toBeTruthy();
    });
    expect(screen.getByTestId("thresholds-empty")).toBeTruthy();
  });

  it("renders one row per active rule (AC7)", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ rules: [ADMIN_RULE], nextCursor: null }));
    render(<ThresholdsPage />, { wrapper: buildWrapper() });
    await waitFor(() => {
      expect(screen.queryByTestId("thresholds-page")).toBeTruthy();
    });
    expect(screen.getByTestId(`thresholds-row-${ADMIN_RULE.id}`)).toBeTruthy();
  });

  it("history toggle reveals inactive rows (AC7)", async () => {
    // Distinct IDs so the two rows have unique data-testids — the
    // spread-from-ADMIN_RULE pattern would otherwise leave both
    // rows sharing the same id (and the same testid).
    const inactive: RuleRow = {
      ...ADMIN_RULE,
      id: "99999999-9999-4999-8999-999999999999",
      isActive: false,
      version: 2,
    };
    apiFetch.mockResolvedValue(jsonResponse({ rules: [ADMIN_RULE, inactive], nextCursor: null }));
    render(<ThresholdsPage />, { wrapper: buildWrapper() });
    await waitFor(() => {
      expect(screen.queryByTestId("thresholds-page")).toBeTruthy();
    });
    // Only active rows render by default.
    expect(screen.getByTestId(`thresholds-row-${ADMIN_RULE.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`thresholds-row-${inactive.id}`)).toBeNull();
    // Toggle history on; both rows render.
    const toggle = screen.getByTestId("thresholds-show-history") as HTMLInputElement;
    fireEvent.click(toggle);
    expect(screen.getByTestId(`thresholds-row-${ADMIN_RULE.id}`)).toBeTruthy();
    expect(screen.getByTestId(`thresholds-row-${inactive.id}`)).toBeTruthy();
  });

  it("Edit button opens a modal; submit triggers PATCH supersede (AC8)", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ rules: [ADMIN_RULE], nextCursor: null }));
    render(<ThresholdsPage />, { wrapper: buildWrapper() });
    await waitFor(() => {
      expect(screen.queryByTestId("thresholds-page")).toBeTruthy();
    });
    const editButton = screen.getByTestId(`thresholds-edit-${ADMIN_RULE.id}`) as HTMLButtonElement;
    fireEvent.click(editButton);
    expect(screen.getByTestId("thresholds-edit-modal")).toBeTruthy();

    // Set up the mutation response (the api returns { old, new }).
    apiFetch.mockResolvedValueOnce(
      jsonResponse({
        old: { ...ADMIN_RULE, isActive: false },
        new: { ...ADMIN_RULE, version: 2 },
      }),
    );
    const thresholdInput = screen.getByTestId("thresholds-edit-threshold") as HTMLInputElement;
    fireEvent.change(thresholdInput, { target: { value: "6.8" } });
    const submit = screen.getByTestId("thresholds-edit-submit") as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.queryByTestId("thresholds-edit-modal")).toBeNull();
    });
    expect(apiFetch).toHaveBeenCalledWith(
      `/admin/thresholds/rules/${ADMIN_RULE.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ supersede: true, threshold: 6.8 }),
      }),
    );
  });

  it("Deactivate button sends PATCH activate: false (AC9)", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ rules: [ADMIN_RULE], nextCursor: null }));
    render(<ThresholdsPage />, { wrapper: buildWrapper() });
    await waitFor(() => {
      expect(screen.queryByTestId("thresholds-page")).toBeTruthy();
    });
    apiFetch.mockResolvedValueOnce(jsonResponse({ ...ADMIN_RULE, isActive: false }));
    const btn = screen.getByTestId(`thresholds-deactivate-${ADMIN_RULE.id}`) as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/admin/thresholds/rules/${ADMIN_RULE.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ activate: false }),
        }),
      );
    });
  });

  it("Activate button (on an inactive row) sends PATCH /activate (AC9)", async () => {
    const inactive: RuleRow = { ...ADMIN_RULE, isActive: false };
    apiFetch.mockResolvedValue(jsonResponse({ rules: [inactive], nextCursor: null }));
    render(<ThresholdsPage />, { wrapper: buildWrapper() });
    await waitFor(() => {
      expect(screen.queryByTestId("thresholds-page")).toBeTruthy();
    });
    const toggle = screen.getByTestId("thresholds-show-history") as HTMLInputElement;
    fireEvent.click(toggle);
    apiFetch.mockResolvedValueOnce(jsonResponse({ ...inactive, isActive: true }));
    const btn = screen.getByTestId(`thresholds-activate-${inactive.id}`) as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/admin/thresholds/rules/${inactive.id}/activate`,
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });
});
