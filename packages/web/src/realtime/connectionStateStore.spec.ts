/**
 * `connectionStateStore` — Story 2.9 setter contract.
 *
 * Coverage matrix:
 *   - markConnected sets isConnected: true + lastConnectedAt.
 *   - markDisconnected sets isConnected: false + lastDisconnectedAt.
 *   - incrementRetry bumps retryAttempt by 1.
 *   - resetRetry zeros retryAttempt.
 *   - Initial state matches the documented shape (isConnected: true
 *     until proven disconnected).
 *   - Setters are pure: previous state is preserved on the field the
 *     setter doesn't touch (e.g. markConnected does not zero
 *     lastDisconnectedAt).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConnectionStateStore } from "./connectionStateStore";

describe("Story 2.9 — connectionStateStore initial state", () => {
  it("starts with isConnected: true (deliberately silent)", () => {
    // Fresh store each test — beforeEach resets via `_resetStore`.
    const state = useConnectionStateStore.getState();
    expect(state.isConnected).toBe(true);
    expect(state.lastConnectedAt).toBeNull();
    expect(state.lastDisconnectedAt).toBeNull();
    expect(state.retryAttempt).toBe(0);
  });
});

describe("Story 2.9 — connectionStateStore setters", () => {
  beforeEach(() => {
    // Reset between tests so the global zustand singleton does not
    // leak between cases.
    useConnectionStateStore.setState({
      isConnected: true,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      retryAttempt: 0,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("markConnected flips isConnected: true and stamps lastConnectedAt", () => {
    useConnectionStateStore.getState().markDisconnected();
    const before = useConnectionStateStore.getState();
    expect(before.isConnected).toBe(false);
    expect(before.lastDisconnectedAt).not.toBeNull();

    const stampBefore = Date.now();
    useConnectionStateStore.getState().markConnected();
    const after = useConnectionStateStore.getState();
    const stampAfter = Date.now();

    expect(after.isConnected).toBe(true);
    expect(after.lastConnectedAt).not.toBeNull();
    expect(after.lastConnectedAt ?? 0).toBeGreaterThanOrEqual(stampBefore);
    expect(after.lastConnectedAt ?? 0).toBeLessThanOrEqual(stampAfter);
    // markConnected does not touch lastDisconnectedAt.
    expect(after.lastDisconnectedAt).toBe(before.lastDisconnectedAt);
  });

  it("markDisconnected flips isConnected: false and stamps lastDisconnectedAt", () => {
    useConnectionStateStore.getState().markConnected();
    const stampBefore = Date.now();
    useConnectionStateStore.getState().markDisconnected();
    const state = useConnectionStateStore.getState();
    const stampAfter = Date.now();

    expect(state.isConnected).toBe(false);
    expect(state.lastDisconnectedAt).not.toBeNull();
    expect(state.lastDisconnectedAt ?? 0).toBeGreaterThanOrEqual(stampBefore);
    expect(state.lastDisconnectedAt ?? 0).toBeLessThanOrEqual(stampAfter);
  });

  it("incrementRetry bumps retryAttempt by 1", () => {
    expect(useConnectionStateStore.getState().retryAttempt).toBe(0);
    useConnectionStateStore.getState().incrementRetry();
    expect(useConnectionStateStore.getState().retryAttempt).toBe(1);
    useConnectionStateStore.getState().incrementRetry();
    expect(useConnectionStateStore.getState().retryAttempt).toBe(2);
    useConnectionStateStore.getState().incrementRetry();
    expect(useConnectionStateStore.getState().retryAttempt).toBe(3);
  });

  it("resetRetry zeros retryAttempt", () => {
    useConnectionStateStore.getState().incrementRetry();
    useConnectionStateStore.getState().incrementRetry();
    expect(useConnectionStateStore.getState().retryAttempt).toBe(2);

    useConnectionStateStore.getState().resetRetry();
    expect(useConnectionStateStore.getState().retryAttempt).toBe(0);
  });

  it("markConnected preserves retryAttempt (the connect path zeros it via resetRetry, not here)", () => {
    useConnectionStateStore.getState().incrementRetry();
    useConnectionStateStore.getState().incrementRetry();
    expect(useConnectionStateStore.getState().retryAttempt).toBe(2);
    useConnectionStateStore.getState().markConnected();
    // The store does not auto-reset retryAttempt on connect — that's
    // the listener's responsibility (it calls resetRetry after
    // markConnected). Setters are atomic.
    expect(useConnectionStateStore.getState().retryAttempt).toBe(2);
  });

  it("incrementRetry preserves isConnected (counter is independent of state)", () => {
    useConnectionStateStore.setState({ isConnected: false });
    useConnectionStateStore.getState().incrementRetry();
    expect(useConnectionStateStore.getState().isConnected).toBe(false);
    expect(useConnectionStateStore.getState().retryAttempt).toBe(1);
  });
});
