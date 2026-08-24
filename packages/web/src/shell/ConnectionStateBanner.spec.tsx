/**
 * `ConnectionStateBanner` — Story 2.9.
 *
 * Coverage matrix:
 *   - isConnected: true → banner returns null (does not render).
 *   - isConnected: false → banner renders documented copy.
 *   - The body element has `aria-live="polite"`; the heading does not.
 *   - data-testid="connection-state-banner" is present.
 *   - Severity-warning tokens are used (border + bg).
 *   - The banner does NOT animate (no animate-* class on the wrapper).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useConnectionStateStore } from "../realtime/connectionStateStore";

import { ConnectionStateBanner } from "./ConnectionStateBanner";

const setConnected = (value: boolean): void => {
  useConnectionStateStore.setState({ isConnected: value });
};

describe("Story 2.9 — ConnectionStateBanner conditional render", () => {
  beforeEach(() => {
    setConnected(true);
  });
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when isConnected: true (no banner element)", () => {
    render(<ConnectionStateBanner />);
    expect(screen.queryByTestId("connection-state-banner")).toBeNull();
    expect(screen.queryByText(/Reconnecting/i)).toBeNull();
    expect(screen.queryByText(/Showing last-known data/i)).toBeNull();
  });

  it("renders the banner with documented copy when isConnected: false", () => {
    setConnected(false);
    render(<ConnectionStateBanner />);

    const banner = screen.getByTestId("connection-state-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Reconnecting\u2026");
    expect(banner).toHaveTextContent("Showing last-known data.");
  });

  it("applies aria-live=\"polite\" on the body element (NOT on the heading)", () => {
    setConnected(false);
    render(<ConnectionStateBanner />);

    const body = screen.getByTestId("connection-state-banner-body");
    expect(body).toHaveAttribute("aria-live", "polite");

    // The wrapper has no aria-live attribute (and no role="status"
    // either — see banner source). aria-live lives on the body only.
    // The document says: "aria-live=\"polite\" on the body only
    // (UX-DR-6 noise reduction)".
    const banner = screen.getByTestId("connection-state-banner");
    expect(banner).not.toHaveAttribute("aria-live");
    expect(banner).not.toHaveAttribute("role");
  });

  it("uses the documented severity-warning tokens", () => {
    setConnected(false);
    render(<ConnectionStateBanner />);

    const banner = screen.getByTestId("connection-state-banner");
    expect(banner.className).toContain("border-severity-warning-value");
    expect(banner.className).toContain("bg-severity-warning-bg");
    expect(banner.className).toContain("text-severity-warning-text");
  });

  it("does not animate the banner (no motion classes on the wrapper)", () => {
    setConnected(false);
    render(<ConnectionStateBanner />);

    const banner = screen.getByTestId("connection-state-banner");
    // Spec: "It pops in / out instantly. No animation."
    // Matches Tailwind's full motion-class vocabulary: animate-*,
    // transition-*, duration-*, ease-*. The banner must not
    // introduce motion in any form.
    expect(banner.className).not.toMatch(
      /\b(animate-|transition-|duration-|ease-)/,
    );
  });
});

describe("Story 2.9 — ConnectionStateBanner re-render on state flip", () => {
  beforeEach(() => {
    setConnected(true);
  });
  afterEach(() => {
    cleanup();
  });

  it("mounts → unmounts when isConnected flips true → false → true", () => {
    const { rerender } = render(<ConnectionStateBanner />);
    expect(screen.queryByTestId("connection-state-banner")).toBeNull();

    setConnected(false);
    rerender(<ConnectionStateBanner />);
    expect(screen.getByTestId("connection-state-banner")).toBeInTheDocument();

    setConnected(true);
    rerender(<ConnectionStateBanner />);
    expect(screen.queryByTestId("connection-state-banner")).toBeNull();
  });
});
