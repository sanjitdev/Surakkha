/**
 * `useConnectionState` — Story 2.9.
 *
 * Memoized selector over `useConnectionStateStore`. Returns the
 * subset the public surface needs (`isConnected`, `retryAttempt`);
 * internal fields (`lastConnectedAt`, `lastDisconnectedAt`) are
 * intentionally excluded so unrelated ticks do not churn consumers.
 *
 * Implementation pattern: two independent zustand selector
 * subscriptions (one per field), composed via `useMemo`. Each
 * selector returns a primitive, so zustand's default equality check
 * (`Object.is`) gates re-renders on value identity — a consumer
 * re-renders only when `isConnected` or `retryAttempt` changes, not
 * on every store tick (e.g., a `Date.now()` flip on `lastConnectedAt`).
 *
 * Why a hook and not direct `useConnectionStateStore` access:
 *   - Epic 4 will disable action affordances on `isConnected === false`.
 *     A page-level direct-store subscription would re-render on every
 *     `Date.now()` stamp flip; this hook's selector scopes re-renders
 *     to the contract surface (`isConnected` + `retryAttempt`).
 *   - Stable identity — the returned object shape is `{ isConnected,
 *     retryAttempt }` and only swaps when those two values change.
 */
import { useMemo } from "react";

import { useConnectionStateStore } from "./connectionStateStore";

export interface ConnectionState {
  readonly isConnected: boolean;
  readonly retryAttempt: number;
}

export const useConnectionState = (): ConnectionState => {
  const isConnected = useConnectionStateStore((s) => s.isConnected);
  const retryAttempt = useConnectionStateStore((s) => s.retryAttempt);
  return useMemo(
    () => ({ isConnected, retryAttempt }),
    [isConnected, retryAttempt],
  );
};
