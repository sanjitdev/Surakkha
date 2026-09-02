/**
 * Single source of truth for the realtime stream's connection state.
 * Subscribed by `useConnectionState()` (memoized selector) so a
 * `Date.now()` stamp flip doesn't churn consumer re-renders.
 *
 * Initial `isConnected: true` is deliberate: the banner stays
 * silent until the socket actually disconnects.
 */
import { create } from "zustand";

export interface ConnectionStateStoreState {
  readonly isConnected: boolean;
  readonly lastConnectedAt: number | null;
  readonly lastDisconnectedAt: number | null;
  readonly retryAttempt: number;
  readonly markConnected: () => void;
  readonly markDisconnected: () => void;
  readonly incrementRetry: () => void;
  readonly resetRetry: () => void;
}

export const useConnectionStateStore = create<ConnectionStateStoreState>((set) => ({
  isConnected: true,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  retryAttempt: 0,
  markConnected: () =>
    set({
      isConnected: true,
      lastConnectedAt: Date.now(),
    }),
  markDisconnected: () =>
    set({
      isConnected: false,
      lastDisconnectedAt: Date.now(),
    }),
  incrementRetry: () =>
    set((prev) => {
      // Clamp a corrupted prior value back to a known-good integer
      // so `NaN` can't propagate into `computeBackoffMs`.
      const safe = Number.isFinite(prev.retryAttempt) ? prev.retryAttempt : 0;
      return { retryAttempt: Math.max(0, Math.floor(safe) + 1) };
    }),
  resetRetry: () =>
    set({
      retryAttempt: 0,
    }),
}));
