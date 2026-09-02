/**
 * `useDashboardSocket` — mounts once per `<Dashboard />`. Subscribes
 * to `reading:new` events on the shared api socket and invalidates
 * `DASHBOARD_READINGS_QUERY_KEY` so the four regions refetch in
 * lockstep. TanStack Query coalesces multiple invalidations within
 * a tick, so a burst of events produces one refetch + one re-render.
 */
import { type ReadingNewEvent } from "@surakkha/shared/events";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { connectSocket } from "../realtime/socketClient";

export const DASHBOARD_READINGS_QUERY_KEY = ["readings", "latest"] as const;

export const useDashboardSocket = (url: string = "/dashboard"): void => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const socket = connectSocket(
      { url },
      {
        onSessionLost: () => navigate("/login?next=/dashboard"),
      },
    );

    const handleReading = (_payload: ReadingNewEvent): void => {
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
