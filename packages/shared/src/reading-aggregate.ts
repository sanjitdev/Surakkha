/**
 * `reading-aggregate.ts` — Story 5.4.
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
 * This story ships ONLY the metric enum (the writer from Story
 * 5.5 needs it; the spec explicitly defers a row schema because
 * no UI consumer exists in v1 — see spec Boundaries & Constraints:
 * "No UI surface").
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
