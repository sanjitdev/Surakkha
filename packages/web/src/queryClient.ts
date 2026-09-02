/**
 * App-wide `QueryClient`. The 5s `staleTime` matches the admin tab's
 * expected refresh cadence; `retry: 1` keeps a flaky network from
 * cascading into a "click Switch, wait, retry, fail" UX.
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
