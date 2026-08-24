/**
 * `useDashboardDevices` — Story 2.7.
 *
 * TanStack Query hook for `GET /api/devices`. Drives the map's
 * marker roster; the existing `["readings", "latest"]` query key
 * continues to drive severity (the map joins the two caches to
 * resolve per-marker colour).
 *
 * Behaviour:
 *   - Initial REST cold-load returns the device roster (one row per
 *     Device, joined to `MAX(Reading.serverReceivedAt)`).
 *   - On `isError` the map falls back to its "No devices" empty
 *     state without affecting the rest of the dashboard (KPI band +
 *     Live Readings table keep working off the readings cache).
 *   - Does NOT refetch on `reading:new` — the readings cache update
 *     cascades through `useDashboardReadings`, and the map re-
 *     evaluates marker severities from the joined cache. Devices
 *     with no reading yet stay grey from the initial cold-load.
 */
import {
  type DevicesResponse,
  OFFLINE_THRESHOLD_MS,
} from "@surakkha/shared/dashboard";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/apiClient";

const DeviceSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  last_reading_at: z.string().nullable(),
});

const DevicesResponseSchema: z.ZodType<DevicesResponse> = z.object({
  devices: z.array(DeviceSummarySchema),
});

export const useDashboardDevices = () =>
  useQuery<DevicesResponse>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await apiFetch("/api/devices");
      if (!res.ok) {
        throw new Error(`/api/devices failed: ${res.status}`);
      }
      const parsed = DevicesResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("devices wire-shape mismatch", parsed.error);
        throw new Error("devices wire-shape mismatch");
      }
      return parsed.data;
    },
    staleTime: OFFLINE_THRESHOLD_MS,
  });
