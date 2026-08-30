/**
 * `toast.spec.ts` — Story 4.5.
 *
 * Three test groups covering the toast primitive's three contracts:
 *
 *   1. TTL expiry — pushed toasts auto-drop after `TOAST_TTL_MS`
 *      (matches the ThresholdsPage 4_000 ms window).
 *   2. Success vs error tones — `data-tone` and `data-testid` distinguish
 *      the two; the rendered `<li>` count matches the push count.
 *   3. No `<ToastRegion />` mounted → no DOM. The hook can be used
 *      without the region, and the region renders nothing for an empty
 *      queue.
 *
 * The hook + region are tested independently of any parent
 * `IncidentDetailPage` wrapper — these are unit tests of the
 * primitive itself, not integration tests of the mutation flow
 * (those live in `IncidentDetailPage.spec.tsx`).
 */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastRegion, type ToastEntry, useToasts, TOAST_TTL_MS } from "./toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // RTL does not auto-clean between `it`s. Without explicit
  // `cleanup()` the prior test's `<ToastRegion />` DOM stays
  // mounted, polluting subsequent `getByTestId` / `queryByTestId`
  // calls with stale elements.
  cleanup();
  vi.useRealTimers();
});

describe("Story 4.5 — toast TTL expiry", () => {
  it("auto-drops a pushed toast after TOAST_TTL_MS", () => {
    // `TOAST_TTL_MS` MUST match the ThresholdsPage 4_000 ms; pin it
    // here so the two toast surfaces stay in lock-step.
    expect(TOAST_TTL_MS).toBe(4_000);

    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.pushToast("success", "Acknowledged");
    });

    // Immediately after push: toast visible.
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.tone).toBe("success");
    expect(result.current.toasts[0]?.message).toBe("Acknowledged");

    // Just before TTL: still visible.
    act(() => {
      vi.advanceTimersByTime(TOAST_TTL_MS - 1);
    });
    expect(result.current.toasts).toHaveLength(1);

    // Exactly TTL: dropped. The setTimeout fires under act(); the
    // queue collapses to empty.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("cancels pending TTL timers on unmount (no late setState)", () => {
    const { result, unmount } = renderHook(() => useToasts());
    act(() => {
      result.current.pushToast("error", "Already acknowledged");
    });
    expect(result.current.toasts).toHaveLength(1);

    // Unmount BEFORE TTL elapses. The cleanup effect runs `clearTimeout`
    // on every tracked timer. Advancing the clock should NOT fire a
    // late `setState` because the timer was cancelled. If we left a
    // dangling timer, React would warn about `setState on unmounted
    // component` (the test rig does not capture this warning, but the
    // cleanup is the contract). The check is the lack of throw.
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(TOAST_TTL_MS + 1_000);
      });
    }).not.toThrow();
  });
});

describe("Story 4.5 — toast success vs error tones", () => {
  it("renders one region <li> per toast, with the right tone testid", () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.pushToast("success", "Acknowledged");
      result.current.pushToast("error", "Failed to acknowledge. Try again.");
    });

    render(<ToastRegion toasts={result.current.toasts} />);

    const region = screen.getByTestId("toast-region");
    expect(region).toBeInTheDocument();
    // Testid prefix is neutral `toast-{tone}-{id}` so Stories 4.6 /
    // 4.7 / 4.11 can reuse this primitive without inheriting an
    // `incident-detail-` namespace.
    expect(screen.getByTestId("toast-success-1")).toHaveTextContent("Acknowledged");
    expect(screen.getByTestId("toast-error-2")).toHaveTextContent(
      "Failed to acknowledge. Try again.",
    );

    // The two entries differ by tone (data-tone attribute).
    expect(screen.getByTestId("toast-success-1")).toHaveAttribute("data-tone", "success");
    expect(screen.getByTestId("toast-error-2")).toHaveAttribute("data-tone", "error");
  });

  it("renders no <li> when the queue is empty", () => {
    render(<ToastRegion toasts={[]} />);
    const region = screen.getByTestId("toast-region");
    expect(region).toBeInTheDocument();
    expect(region.querySelectorAll("li")).toHaveLength(0);
  });
});

describe("Story 4.5 — toast region mount/unmount", () => {
  it("does NOT render any toast region when <ToastRegion /> is not mounted", () => {
    // Pairs with "with region → with DOM": absence of `<ToastRegion />`
    // means absence of `data-testid="toast-region"`. This guards
    // against a regression where the page accidentally renders a
    // fresh `<ul>` for every toast inside the body content.
    const { container } = render(<div data-testid="no-toast-here">No toasts here.</div>);
    expect(screen.queryByTestId("toast-region")).toBeNull();
    expect(container.querySelector("[data-testid='toast-region']")).toBeNull();
  });
});

describe("Epic-6 sweep — <ToastRegion /> per-page testid prefix", () => {
  // The Epic-6 sweep lets multiple pages mount their own <ToastRegion />
  // without colliding on `data-testid="toast-region"`. The testid
  // prefix is configurable, and the per-item id suffix is opt-out
  // (preserves the canonical `toast-{tone}-{id}` shape for the
  // IncidentDetailPage consumers but emits `simulator-toast-{tone}` /
  // `thresholds-toast-{tone}` for the admin pages).

  const FIXTURES: readonly ToastEntry[] = [
    { id: 1, tone: "success", message: "Saved." },
    { id: 2, tone: "error", message: "Save failed." },
  ];

  it("scopes the region testid to the supplied prefix", () => {
    render(<ToastRegion toasts={FIXTURES} testIdPrefix="simulator-toast" isId={false} />);
    expect(screen.getByTestId("simulator-toast-region")).toBeInTheDocument();
    // Canonical `toast-region` MUST NOT appear when a non-default
    // prefix is supplied (collision guard for multi-mount pages).
    expect(screen.queryByTestId("toast-region")).toBeNull();
  });

  it("emits `{prefix}-{tone}` (no id) when isId=false", () => {
    render(<ToastRegion toasts={FIXTURES} testIdPrefix="thresholds-toast" isId={false} />);
    expect(screen.getByTestId("thresholds-toast-success")).toHaveTextContent("Saved.");
    expect(screen.getByTestId("thresholds-toast-error")).toHaveTextContent("Save failed.");
    // id-suffixed testids MUST NOT be emitted in this mode.
    expect(screen.queryByTestId("thresholds-toast-success-1")).toBeNull();
    expect(screen.queryByTestId("thresholds-toast-error-2")).toBeNull();
  });

  it("emits `{prefix}-{tone}-{id}` by default (isId omitted)", () => {
    render(<ToastRegion toasts={FIXTURES} testIdPrefix="toast" />);
    expect(screen.getByTestId("toast-success-1")).toHaveTextContent("Saved.");
    expect(screen.getByTestId("toast-error-2")).toHaveTextContent("Save failed.");
  });

  it("applies Tailwind severity-token classes (design-system routing)", () => {
    // The shared primitive MUST route through the Tailwind severity
    // tokens in `tailwind.config.ts` so the toast palette stays in
    // lock-step with the rest of the app. The classes below are
    // enumerated LITERALLY in toast.tsx (Tailwind's JIT scanner
    // ignores interpolated class strings).
    const { container } = render(<ToastRegion toasts={FIXTURES} testIdPrefix="toast" />);
    const success = container.querySelector("[data-testid='toast-success-1']");
    const error = container.querySelector("[data-testid='toast-error-2']");
    expect(success?.className).toContain("bg-severity-healthy-bg");
    expect(success?.className).toContain("text-severity-healthy-text");
    expect(success?.className).toContain("border-severity-healthy-text");
    expect(error?.className).toContain("bg-severity-critical-bg");
    expect(error?.className).toContain("text-severity-critical-text");
    expect(error?.className).toContain("border-severity-critical-text");
  });
});
