/**
 * `connectionStateStore` — Story 2.9.
 *
 * Single source of truth for the realtime stream's connection state.
 * Consumed by `ConnectionStateBanner` (renders when `isConnected`
 * is `false`) and by Epic 4 action affordances (will disable API-
 * bound buttons when `isConnected` is `false`).
 *
 * Why a zustand store and not per-component `useState`:
 *   - Multiple pages (Dashboard, Kanban, Audit) need to share the
 *     same connection signal. A store is the only path that
 *     survives page navigations without per-page wiring.
 *   - The socket is module-scoped (`socketClient.ts`); the store is
 *     its mirror at the React layer. Listener wiring lives in
 *     `socketClient.ts` so this file stays pure state + setter
 *     actions with no side-effects.
 *
 * Initial state (`isConnected: true`) is deliberate: the banner
 * stays silent until the socket actually disconnects. A cold mount
 * on a known-down server renders no banner until `connect_error`
 * or `disconnect` fires — see Story 2.9 §"Always" bullet 2.
 *
 * Store shape (matches `_bmad-output/implementation-artifacts/
 * spec-2-9-connection-state-offline-ux.md` Task #1):
 *   - `isConnected: boolean`  — the public surface; banner reads it.
 *   - `lastConnectedAt: number | null`    — internal timestamp.
 *   - `lastDisconnectedAt: number | null` — internal timestamp.
 *   - `retryAttempt: number`              — backoff counter.
 *
 * Consumers should subscribe via `useConnectionState()` (the
 * memoized selector in `useConnectionState.ts`) rather than calling
 * `useConnectionStateStore` directly so internal fields don't churn
 * unrelated re-renders.
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

export const useConnectionStateStore = create<ConnectionStateStoreState>(
  (set) => ({
    // Deliberately silent until proven disconnected — mirrors
    // Story 2.6's "first render doesn't pulse" pattern.
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
        // Defensive clamp: if the prior value was corrupted to `NaN`
        // (e.g., a hostile test wrote `Number.NaN` into the store),
        // a bare `+ 1` propagates `NaN` into `retryAttempt`, which
        // then leaks into `computeBackoffMs`. The clamp restores the
        // counter to a known-good integer.
        const safe = Number.isFinite(prev.retryAttempt)
          ? prev.retryAttempt
          : 0;
        return { retryAttempt: Math.max(0, Math.floor(safe) + 1) };
      }),
    resetRetry: () =>
      set({
        retryAttempt: 0,
      }),
  }),
);
