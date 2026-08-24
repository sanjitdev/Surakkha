/**
 * `AppShell` slot stacking — Story 2.9.
 *
 * Coverage:
 *   - `connection-state-banner-slot` renders ABOVE `severity-banner-slot`
 *     in DOM order (regression guard for Epic 4 stacking).
 *   - `ConnectionStateBanner` is the direct child of the slot — no
 *     wrapper elements in between.
 *   - The slot exists on initial render even when `isConnected` is
 *     `true` (the banner is hidden, but the slot wrapper is always
 *     present so Epic 4 can re-use the same mount point).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useConnectionStateStore } from "../realtime/connectionStateStore";

import { AppShell } from "./AppShell";

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

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppShell currentRole="Admin">
        <div>canvas content</div>
      </AppShell>
    </MemoryRouter>,
  );

describe("Story 2.9 — AppShell banner-slot stacking", () => {
  beforeEach(() => {
    setViewport(1280);
    useConnectionStateStore.setState({
      isConnected: true,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      retryAttempt: 0,
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders both the connection-state-banner-slot and the severity-banner-slot", () => {
    renderShell();
    expect(
      screen.getByTestId("connection-state-banner-slot"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("severity-banner-slot")).toBeInTheDocument();
  });

  it("connection-state-banner-slot is positioned ABOVE severity-banner-slot in DOM order", () => {
    renderShell();
    const connectionSlot = screen.getByTestId("connection-state-banner-slot");
    const severitySlot = screen.getByTestId("severity-banner-slot");

    // `compareDocumentPosition`: connectionSlot BEFORE severitySlot
    // → `connectionSlot.compareDocumentPosition(severitySlot)` has the
    // DOCUMENT_POSITION_FOLLOWING bit set.
    expect(
      connectionSlot.compareDocumentPosition(severitySlot) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The reverse — severitySlot is NOT before connectionSlot.
    expect(
      severitySlot.compareDocumentPosition(connectionSlot) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(0);
  });

  it("ConnectionStateBanner is the direct child of connection-state-banner-slot (no wrapper)", () => {
    // With `isConnected: true`, the banner returns null → slot has
    // 0 children but is still mounted. The wrapper-less contract
    // is "slot ↔ banner"; the slot exists at the right mount point
    // even when the banner is hidden.
    const { rerender } = renderShell();
    const slot = screen.getByTestId("connection-state-banner-slot");
    expect(slot.children).toHaveLength(0);

    // Flip the state so the banner mounts. Re-rendering the same
    // tree (no second `render`) keeps the slot element stable —
    // the banner is appended inside it, with no wrapper between.
    useConnectionStateStore.setState({ isConnected: false });
    rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell currentRole="Admin">
          <div>canvas content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const banner = screen.getByTestId("connection-state-banner");
    expect(banner).toBeInTheDocument();
    // The slot element in the DOM is the same node we grabbed
    // before the state flip — query the parent from the banner's
    // perspective instead (the slot may have been re-emitted by
    // the rerender but its identity holds within one tree).
    expect(banner.parentElement).toBe(slot);
  });
});
