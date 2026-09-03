/**
 * `ReadingAggregate` wire types.
 * Closed `metric` enum on the wire; the Prisma column is a free
 * `String` so adding a new metric does not force a Prisma migration.
 */
import { z } from "zod";

/** Closed enumeration of metric keys a `ReadingAggregate` row may
 *  carry. Mirrors `TelemetryMetrics` 1:1 plus `battery` + `signal`. */
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
 * Bucket floor for the retention cron. Aligns raw `Reading.ts`
 * timestamps to the nearest 5-minute UTC boundary.
 *
 * Behaviour: aligned input → unchanged; off-by-N ms floors down.
 * Naive-Date input (local-time constructor) → UTC-floor; the helper
 * does not consult the host timezone.
 *
 * Throws `TypeError` on a non-finite `Date.getTime()` so a single
 * corrupt row cannot block the whole tick.
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
