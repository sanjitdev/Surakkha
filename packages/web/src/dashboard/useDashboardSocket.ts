/**
 * `useDashboardSocket` — Story 2.6.
 *
 * Single shared socket subscription for the operator dashboard.
 * Mounted once per `<Dashboard />` instance; multiple components that
 * all call this hook share ONE underlying socket + listener so we
 * do not fan out N subscriptions per dashboard render.
 *
 * Behaviour:
 *   - On mount: open the api socket (namespace = `"/dashboard"` —
 *     matches the server-side `SUBSCRIBER_PATH_SEGMENT` branch in
 *     `packages/api/src/index.ts`).
 *   - Subscribe to `reading:new` events from the `readings:latest`
 *     room (see `packages/api/src/ingest/frame.ts:359`, Story 2.6
 *     added the broadcast room).
 *   - On every `reading:new`, invalidate `["readings", "latest"]` on
 *     the shared TanStack Query client so the four regions refetch
 *     in lockstep within 100 ms (AC2).
 *
 * Disconnect handling (AC5):
 *   - When the socket disconnects, the React tree does NOT unmount.
 *     The hook stores no React state for connection status; the
 *     queryClient owns the realtime path, TanStack Query owns the
 *     data, React never depends on either for survival.
 *   - Reconnect uses exponential backoff via the socket's own
 *     reconnect machinery (`socketClient.ts`'s `wireAuthHandlers` +
 *     refresh-on-`401 token_expired` flow); once the socket is back,
 *     `reading:new` events resume cache invalidation without an
 *     unmount.
 *
 * Why a hook:
 *   - The Dashboard owns the socket lifecycle (mount = open, unmount
 *     = close) so navigating away tears down the subscription.
 *     Pages like `/incidents` open their own socket with different
 *     listeners.
 *   - `connectSocket` is idempotent per url (already in
 *     socketClient.ts), so multiple hook instances on the same
 *     Dashboard share the same socket — but the listener returned
 *     here is owned by this hook instance.
 */
import { type ReadingNewEvent } from "@surakkha/shared/events";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { connectSocket } from "../realtime/socketClient";

export const DASHBOARD_READINGS_QUERY_KEY = ["readings", "latest"] as const;

/**
 * Mount the dashboard's realtime subscription. Returns nothing —
 * the side-effect is the sole purpose of this hook.
 *
 * `url` defaults to the api origin so the hook does not need
 * configuration at the call site. Tests pass a stub `url` (any
 * non-empty string is acceptable — the hook only iterates over
 * events, the open socket itself is mocked at the network layer).
 */
export const useDashboardSocket = (
  url: string = "/dashboard",
): void => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const socket = connectSocket({ url }, {
      onSessionLost: () => navigate("/login?next=/dashboard"),
    });

    const handleReading = (_payload: ReadingNewEvent): void => {
      // AC2: invalidate the cache key the four regions share. TanStack
      // Query coalesces multiple invalidations within a tick so a burst
      // of `reading:new` events produces one refetch + one re-render.
      void queryClient.invalidateQueries({
        queryKey: [...DASHBOARD_READINGS_QUERY_KEY],
      });
    };

    socket.on("reading:new", handleReading);
    return () => {
      socket.off("reading:new", handleReading);
    };
  }, [queryClient, navigate, url]);
};
