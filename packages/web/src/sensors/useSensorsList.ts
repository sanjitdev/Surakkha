/**
 * `useSensorsList` — TanStack Query hook for `GET /api/devices`,
 * scoped under a separate cache key (`["sensors", "devices"]`) so the
 * sensors page and the dashboard map do not share query state. They
 * both consume the same wire contract; if one invalidates, the other
 * does not (the dashboard's `reading:new` socket invalidation
 * targets `["readings", "latest"]`, not devices).
 *
 * Errors fall through to the page's `isError` branch so the user
 * sees the canonical "Unable to load devices." copy with a Retry
 * button (vs. the dashboard's silent "No devices" fallback — the
 * sensors page is a dedicated admin surface, not a dashboard tile).
 */
import {
  type DevicesResponse,
  OFFLINE_THRESHOLD_MS,
} from "@surakkha/shared/dashboard";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/apiClient";
import { assertWireShape } from "../dashboard/useDashboardReadings";

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

/** Cache key exported so the spec can pin invalidation behaviour
 *  against the dashboard's `["devices"]` key (distinct on purpose). */
export const SENSORS_QUERY_KEY = ["sensors", "devices"] as const;

export const useSensorsList = () =>
  useQuery<DevicesResponse>({
    queryKey: SENSORS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/devices");
      if (!res.ok) {
        throw new Error(`/api/devices failed: ${res.status}`);
      }
      const parsed = DevicesResponseSchema.safeParse(await res.json());
      return assertWireShape(parsed, "sensors-devices");
    },
    staleTime: OFFLINE_THRESHOLD_MS,
  });