/**
 * TanStack Query bootstrap — Surakkha web (Story 2.5).
 *
 * Single `QueryClient` for the whole app. Wrapped at the route tree
 * root in `main.tsx` so every page shares the same cache + retry
 * configuration. The 5s `staleTime` matches the admin tab's expected
 * refresh cadence; `retry: 1` keeps a flaky network from cascading
 * into a "click Switch, wait, retry, fail" UX.
 *
 * Re-exported so admin hooks (e.g. `useSimulatorDevices`) can read
 * the configured client without recreating one — TanStack Query's
 * contract is that there is exactly one `QueryClient` per app.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
