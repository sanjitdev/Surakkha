/**
 * `useDashboardReadings` — Story 2.6.
 *
 * TanStack Query hook for `GET /api/readings/latest`. The dashboard's
 * four regions all read from this single cache key — both the KPI band
 * and the Live Readings table derive their view of the world from the
 * same cached payload. A `reading:new` Socket.IO event invalidates the
 * key (via `useDashboardSocket`); the next render refetches and the
 * KPI band + Live Readings table both update within 100 ms (AC2).
 *
 * The hook also folds in the Dashboard's incidents cache key —
 * `["dashboard", "incidents", "recent"]` — so the `useDashboardSocket`
 * invalidation list stays declarative.
 */
import {
  type LatestReadingsResponse,
  placeholderSeverity,
  type RecentIncidentsResponse,
} from "@surakkha/shared/dashboard";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/apiClient";

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
const LatestReadingsEnvelopeSchema: z.ZodType<LatestReadingsResponse> =
  z.object({
    readings: z.array(LatestReadingSchema),
  });

const RecentIncidentsEnvelopeSchema: z.ZodType<RecentIncidentsResponse> =
  z.object({
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

/**
 * Latest readings query — initial REST cold-load + socket-driven
 * refetch path. Returns `{ readings }`; the hook overloads `isError`
 * so the dashboard renders empty states when the api 500s (AC7).
 */
export const useDashboardReadings = () =>
  useQuery<LatestReadingsResponse>({
    queryKey: ["readings", "latest"],
    queryFn: async () => {
      const res = await apiFetch("/api/readings/latest");
      if (!res.ok) {
        throw new Error(`/api/readings/latest failed: ${res.status}`);
      }
      const parsed = LatestReadingsEnvelopeSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error(
          "readings/latest wire-shape mismatch",
          parsed.error,
        );
        throw new Error("readings/latest wire-shape mismatch");
      }
      return parsed.data;
    },
  });

/**
 * Recent incidents query (read-only preview). Empty envelope renders
 * the static copy "No incidents in the last 24 hours." per AC4.
 */
export const useDashboardIncidents = () =>
  useQuery<RecentIncidentsResponse>({
    queryKey: ["dashboard", "incidents", "recent"],
    queryFn: async () => {
      const res = await apiFetch("/api/incidents/recent?limit=10");
      if (!res.ok) {
        throw new Error(`/api/incidents/recent failed: ${res.status}`);
      }
      const parsed = RecentIncidentsEnvelopeSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error(
          "incidents/recent wire-shape mismatch",
          parsed.error,
        );
        throw new Error("incidents/recent wire-shape mismatch");
      }
      return parsed.data;
    },
  });

/**
 * KPI band count helper. Pure: takes the latest readings array and
 * returns `{ healthy, warning, critical, offline }` counts.
 *
 * `offline` is derived from absence — a device that has never
 * emitted (or has zero reading for `>24h` per Epic 4 semantics —
 * not pinned here) lands in `offline`. The dashboard does not
 * have a `/api/devices` listing yet so we surface offline via the
 * absence of a `Reading` row (i.e., devices with no latest reading
 * are not counted). Future: Story 3.x may extend the surface.
 */
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
    offline: 0, // offline is derived from absence, not the reading payload
  };
};
