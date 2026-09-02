/**
 * `reading-aggregate.ts` — Story 5.4 + 5.5.
 *
 * Wire types for the `ReadingAggregate` table. Mirrors the
 * `audit.ts:1-35` preamble pattern: a dedicated sibling per
 * read/write surface so cross-cutting imports don't couple
 * the Audit / Reading / ReadingAggregate modules' wire contracts.
 *
 * Why a dedicated module (vs adding to `telemetry.ts` or
 * `audit.ts`):
 *
 *   - `telemetry.ts` houses the raw `Reading` row shape (`ts`,
 *     `metrics`, `flags`). The aggregate row carries a different
 *     shape (`bucketStart`, `mean`, `min`, `max`, `sampleCount`)
 *     and would muddle the raw reading wire envelope.
 *
 *   - `audit.ts` is the audit-log surface (resource enum,
 *     entry shape, list envelope). The aggregate module is the
 *     5.5 retention-cron write surface + the (future) admin read
 *     surface; conflating them would force a wide import fan-out.
 *
 *   - The Prisma layer keeps `metric` as a free `String` column
 *     (no Prisma enum) so adding a new metric does NOT force a
 *     Prisma migration. The Zod enum below is the closed wire
 *     contract for any future reader/writer — the same precedent
 *     as `AuditLogResourceSchema` at `audit.ts:53-67`.
 *
 * Story 5.5 adds the `floorToFiveMinutes(ts)` helper — a pure
 * UTC-floor used by the retention cron to bucket raw `Reading.ts`
 * timestamps to the nearest 5-minute boundary.
 */
import { z } from "zod";

/**
 * Closed enumeration of metric keys an `ReadingAggregate` row may
 * carry. Mirrors the `TelemetryMetrics` field set from
 * `packages/shared/src/telemetry.ts` 1:1 — the union of all
 * sensor channels the simulator emits today. Adding a new metric
 * to `TelemetryMetrics` requires ALSO extending this enum and
 * shipping a Prisma migration that backfills existing rows
 * (or accepting that historical aggregates carry the prior enum).
 *
 * `battery` and `signal` are device-health channels (not sensor
 * readings) but the retention story aggregates them identically
 * — same 5-minute bucket, same mean/min/max — so they ride the
 * same table.
 *
 * Kept separate from the Prisma `String` column (which is
 * intentionally NOT a Prisma enum) so the wire surface has a
 * closed shape while the DB stays write-flexible. Mirrors
 * `AuditLogResourceSchema` (`audit.ts:53-67`).
 */
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
 * `Reading.ts` timestamps to the nearest 5-minute boundary
 * (UTC). Pure function — no module-scoped state, no dependencies
 * beyond the standard library.
 *
 * The helper mirrors the precedent of `classifyFlags` /
 * `STALE_FRAME_THRESHOLD_MS` / `CLOCK_SKEW_DETECT_MS` in
 * `telemetry.ts:191-232` — small, named constants + a pure
 * function for the cron to reuse at the shared seam.
 *
 * Behaviour:
 *   - Input: any `Date` (UTC-relative).
 *   - Output: a new `Date` whose UTC milliseconds are exactly
 *     `floor(inputMs / 5m) * 5m`.
 *   - Aligned input (already on a 5-minute boundary) → unchanged.
 *   - Off-by-1ms → floors down.
 *   - Off-by-4m59s999ms → floors down.
 *   - Off-by-5m exactly → floors down (matches "floor" semantics;
 *     the input is now aligned to the next-lower boundary).
 *   - Naive-Date input (local-time constructor) → converted to
 *     UTC-floor; the helper does NOT consult the host timezone.
 */
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const BUCKET_MS = 5 * MS_PER_MINUTE;

export const floorToFiveMinutes = (ts: Date): Date => {
  const t = ts.getTime();
  if (!Number.isFinite(t)) {
    // Defensive: `new Date(NaN)` → NaN → `new Date(NaN).toISOString()`
    // throws RangeError, which would crash the entire batch
    // loop. The retention cron calls this per row, so a single
    // corrupt `Reading.ts` would block the whole tick
    // indefinitely. Callers must skip rows whose floor returns
    // `null` (the cron checks `Number.isNaN(row.ts.getTime())`
    // upstream); other callers will see a `TypeError` here so
    // the malformed input is not silently propagated.
    throw new TypeError("floorToFiveMinutes: input Date is not finite");
  }
  const floored = Math.floor(t / BUCKET_MS) * BUCKET_MS;
  return new Date(floored);
};
