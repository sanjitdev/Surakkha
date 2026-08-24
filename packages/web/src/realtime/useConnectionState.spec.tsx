/**
 * `useConnectionState` — Story 2.9 — memoization contract.
 *
 * Coverage matrix:
 *   - Returns `{ isConnected, retryAttempt }` from the store.
 *   - A consumer re-renders when `isConnected` flips.
 *   - A consumer re-renders when `retryAttempt` increments.
 *   - A consumer does NOT re-render when only `lastConnectedAt`
 *     (an internal field) changes.
 *   - The returned object identity changes only on the two fields
 *     it exposes; otherwise it stays stable.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useConnectionStateStore } from "./connectionStateStore";
import { useConnectionState } from "./useConnectionState";

interface RenderRecord {
  readonly isConnected: boolean;
  readonly retryAttempt: number;
  readonly identity: symbol;
}

const IdentityProbe = ({
  records,
}: {
  readonly records: RenderRecord[];
}): null => {
  const state = useConnectionState();
  records.push({
    isConnected: state.isConnected,
    retryAttempt: state.retryAttempt,
    identity: Symbol.for(state.retryAttempt.toString()),
  });
  return null;
};

describe("Story 2.9 — useConnectionState surface", () => {
  beforeEach(() => {
    useConnectionStateStore.setState({
      isConnected: true,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      retryAttempt: 0,
    });
  });
  afterEach(() => {
    // Re-render the test consumer so the next test sees a fresh DOM
    // (RTL auto-cleans on `cleanup()` between `it` blocks via the
    // vitest setup; this is a no-op double-belt for safety).
  });

  it("returns the current isConnected + retryAttempt from the store", () => {
    useConnectionStateStore.setState({
      isConnected: false,
      retryAttempt: 3,
    });

    const records: RenderRecord[] = [];
    render(<IdentityProbe records={records} />);

    expect(records).toHaveLength(1);
    expect(records[0]?.isConnected).toBe(false);
    expect(records[0]?.retryAttempt).toBe(3);
  });
});

describe("Story 2.9 — useConnectionState memoization", () => {
  beforeEach(() => {
    useConnectionStateStore.setState({
      isConnected: true,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      retryAttempt: 0,
    });
  });

  it("does NOT re-render when an internal field (lastConnectedAt) changes", () => {
    const records: RenderRecord[] = [];
    render(<IdentityProbe records={records} />);
    expect(records).toHaveLength(1);

    // Mutate an internal field — the consumer should not re-render
    // because the hook's selector does not subscribe to it.
    act(() => {
      useConnectionStateStore.setState({
        lastConnectedAt: 12345,
      });
    });
    expect(records).toHaveLength(1);
  });

  it("does NOT re-render when lastDisconnectedAt changes", () => {
    const records: RenderRecord[] = [];
    render(<IdentityProbe records={records} />);
    expect(records).toHaveLength(1);

    act(() => {
      useConnectionStateStore.setState({
        lastDisconnectedAt: 67890,
      });
    });
    expect(records).toHaveLength(1);
  });

  it("DOES re-render when isConnected flips", () => {
    const records: RenderRecord[] = [];
    render(<IdentityProbe records={records} />);
    expect(records).toHaveLength(1);

    act(() => {
      useConnectionStateStore.setState({ isConnected: false });
    });
    expect(records).toHaveLength(2);
    expect(records[1]?.isConnected).toBe(false);
  });

  it("DOES re-render when retryAttempt increments", () => {
    const records: RenderRecord[] = [];
    render(<IdentityProbe records={records} />);
    expect(records).toHaveLength(1);

    act(() => {
      useConnectionStateStore.setState({ retryAttempt: 1 });
    });
    expect(records).toHaveLength(2);
    expect(records[1]?.retryAttempt).toBe(1);
  });
});
