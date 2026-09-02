/**
 * `ReadingAggregate` wire types (Story 5.4 + 5.5).
 *
 * Sibling module — keeps `telemetry.ts` (raw `Reading`) and `audit.ts`
 * (audit-log surface) free of aggregate-specific contracts. Closed
 * `metric` enum on the wire; the Prisma column is a free `String`
 * so adding a new metric does not force a Prisma migration.
 */
import { z } from "zod";

/** Closed enumeration of metric keys a `ReadingAggregate` row may
 *  carry. Mirrors `TelemetryMetrics` 1:1 plus `battery` + `signal`
 *  (device-health channels aggregated identically). */
export const ReadingAggregateMetricSchema = z.enum([
  "tds",
  "turbidity",
  "ph",
  "temperature",
  "battery",
  "signal",
]);
export type ReadingAggregateMetric = z.infer<typeof ReadingAggregateMetricSchema>;

/**
 * Bucket floor for the retention cron (Story 5.5). Buckets raw
 * `Reading.ts` timestamps to the nearest 5-minute boundary (UTC).
 *
 * Behaviour: aligned input → unchanged; off-by-N ms floors down.
 * Naive-Date input (local-time constructor) → UTC-floor; the helper
 * does NOT consult the host timezone.
 *
 * Throws `TypeError` on a non-finite `Date.getTime()` so a single
 * corrupt row cannot block the whole tick (callers must skip rows
 * whose `ts.getTime()` is NaN upstream).
 */
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const BUCKET_MS = 5 * MS_PER_MINUTE;

export const floorToFiveMinutes = (ts: Date): Date => {
  const t = ts.getTime();
  if (!Number.isFinite(t)) {
    throw new TypeError("floorToFiveMinutes: input Date is not finite");
  }
  const floored = Math.floor(t / BUCKET_MS) * BUCKET_MS;
  return new Date(floored);
};
