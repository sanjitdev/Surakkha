/**
 * `useDashboardDevices` — TanStack Query hook for `GET /api/devices`.
 * Drives the map's marker roster; the readings cache continues to drive
 * severity (the map joins the two caches). Errors fall through to the
 * map's "No devices" empty state without affecting the rest of the
 * dashboard.
 */
import { type DevicesResponse, OFFLINE_THRESHOLD_MS } from "@surakkha/shared/dashboard";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/apiClient";

import { assertWireShape } from "./useDashboardReadings";

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
      return assertWireShape(parsed, "devices");
    },
    staleTime: OFFLINE_THRESHOLD_MS,
  });
