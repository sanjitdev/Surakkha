/**
 * `useDashboardReadings` — TanStack Query hooks for
 * `GET /api/readings/latest` and `GET /api/incidents/recent?limit=10`.
 * The dashboard's four regions all read from the shared readings cache
 * key; a `reading:new` event invalidates the key and the regions
 * refetch in lockstep within 100 ms.
 */
import {
  type LatestReadingsResponse,
  placeholderSeverity,
  type RecentIncidentsResponse,
} from "@surakkha/shared/dashboard";
import { useQuery } from "@tanstack/react-query";
import { type SafeParseReturnType, z } from "zod";

import { apiFetch } from "../api/apiClient";

export const assertWireShape = <T>(parsed: SafeParseReturnType<unknown, T>, label: string): T => {
  if (!parsed.success) {
    console.error(`${label} wire-shape mismatch`, parsed.error);
    throw new Error(`${label} wire-shape mismatch`);
  }
  return parsed.data;
};

const MetricSchema = z.object({
  ph: z.number(),
  tds_ppm: z.number(),
  turbidity_ntu: z.number(),
  temp_c: z.number(),
  chlorine_ppm: z.number(),
  water_level_cm: z.number(),
});

const LatestReadingSchema = z.object({
  device_id: z.string(),
  name: z.string().nullable(),
  ts: z.number(),
  server_received_at: z.string(),
  metrics: MetricSchema,
  flags: z.array(z.string()).readonly(),
});
const LatestReadingsEnvelopeSchema: z.ZodType<LatestReadingsResponse> = z.object({
  readings: z.array(LatestReadingSchema),
});

const RecentIncidentsEnvelopeSchema: z.ZodType<RecentIncidentsResponse> = z.object({
  incidents: z.array(
    z.object({
      id: z.string(),
      device_id: z.string(),
      severity: z.enum(["info", "warning", "critical"]),
      metric: z.string(),
      value: z.number(),
      opened_at: z.string(),
    }),
  ),
});

export const useDashboardReadings = () =>
  useQuery<LatestReadingsResponse>({
    queryKey: ["readings", "latest"],
    queryFn: async () => {
      const res = await apiFetch("/api/readings/latest");
      if (!res.ok) {
        throw new Error(`/api/readings/latest failed: ${res.status}`);
      }
      const parsed = LatestReadingsEnvelopeSchema.safeParse(await res.json());
      return assertWireShape(parsed, "readings/latest");
    },
  });

export const useDashboardIncidents = () =>
  useQuery<RecentIncidentsResponse>({
    queryKey: ["dashboard", "incidents", "recent"],
    queryFn: async () => {
      const res = await apiFetch("/api/incidents/recent?limit=10");
      if (!res.ok) {
        throw new Error(`/api/incidents/recent failed: ${res.status}`);
      }
      const parsed = RecentIncidentsEnvelopeSchema.safeParse(await res.json());
      return assertWireShape(parsed, "incidents/recent");
    },
  });

/** KPI counts. `offline` is derived from absence (no Reading row), so it's always 0 here. */
export interface KpiCounts {
  readonly healthy: number;
  readonly warning: number;
  readonly critical: number;
  readonly offline: number;
}

export const summarizeReadings = (
  readings: ReadonlyArray<{ readonly metrics: z.infer<typeof MetricSchema> }>,
): KpiCounts => {
  let healthy = 0;
  let warning = 0;
  let critical = 0;
  for (const r of readings) {
    const sev = placeholderSeverity({ metrics: r.metrics });
    if (sev === "healthy") healthy += 1;
    else if (sev === "warning") warning += 1;
    else critical += 1;
  }
  return {
    healthy,
    warning,
    critical,
    offline: 0,
  };
};
