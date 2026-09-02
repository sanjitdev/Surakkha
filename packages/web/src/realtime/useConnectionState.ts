/**
 * Memoized selector over `useConnectionStateStore`. Returns
 * `{ isConnected, retryAttempt }` only — internal timestamps are
 * excluded so `Date.now()` flips don't churn consumer re-renders.
 * Each field is its own zustand subscription; the composite is
 * composed via `useMemo`.
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
  return useMemo(() => ({ isConnected, retryAttempt }), [isConnected, retryAttempt]);
};
