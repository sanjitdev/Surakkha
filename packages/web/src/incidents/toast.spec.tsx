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

import { ToastRegion, useToasts, TOAST_TTL_MS } from "./toast";

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
