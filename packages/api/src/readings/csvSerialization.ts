/**
 * `csvSerialization.ts` — Story 5.2 CSV export.
 *
 * Pure helper that converts one `ReadingRow` into N CSV lines
 * (one line per metric key in the row's `metrics` object).
 * RFC 4180 quoting for values containing `"`, `,`, or `\n`.
 *
 * Wire shape (per the spec):
 *   - Header line: `device_id,ts,metric,value`
 *     (one column per axis; long format so the schema stays forward-
 *     compatible when a v2 contract adds a 7th metric)
 *   - Data lines: one row per `(reading, metric_key)` tuple
 *   - Truncation signal: NOT in the body. The truncation flag is
 *     exposed as an HTTP response header (`X-CSV-Truncated: true |
 *     false`) set BEFORE the first body byte. The trailer line that
 *     used to live in the body (`# truncated:<true|false>`) was
 *     dropped because the `#` comment marker is not part of
 *     RFC 4180 and Excel users saw a junk row in their spreadsheet.
 *     Consumers MUST inspect `X-CSV-Truncated` to detect truncation.
 *
 * Why long format (one row per metric) and not wide:
 *   - `MetricKeySchema.options` adds keys via a single tuple (see
 *     `packages/shared/src/telemetry.ts:58-65`); a wide CSV would
 *     need a schema migration to widen when a metric is added.
 *   - Long format trades row count for forward compat; the 100k
 *     cap is the existing safety belt for cardinality.
 *
 * Why a separate module:
 *   - The router stays focused on the HTTP seam + audit row; the
 *     serializer is pure and unit-testable without a real DB.
 *   - The serializer is the seam a future Story 5.x can swap for a
 *     parquet / arrow emitter without touching the router.
 */
import {
  type MetricKey,
  MetricKeySchema,
  TelemetryMetricsSchema,
} from "@surakkha/shared/telemetry";

import { type ReadingRow } from "./csvRepository.js";

/**
 * CSV header — single source of truth. Mirrors the column order
 * the data rows below emit. Exported for tests + for the router
 * (which writes the header before the data lines).
 */
export const CSV_HEADER = "device_id,ts,metric,value";

/**
 * Encode one CSV cell. RFC 4180 quoting: if the value contains
 * `"`, `,`, `\n`, or `\r`, wrap the value in `"` and double-up any
 * embedded `"`. Otherwise return the raw value unchanged.
 *
 * Accepts `string | number` — the canonical v1 metric value type
 * is `number` but the helper is permissive so a v2 schema can
 * thread string values through without a separate code path.
 */
export const encodeCsvCell = (raw: string | number): string => {
  const s = typeof raw === "number" ? String(raw) : raw;
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/**
 * Encode a metric value for the `value` column. Mirrors the v2
 * forward-compat guard: `null` and non-finite numerics render as
 * the literal string `"null"` so a malformed row never crashes
 * the stream. Extracted from `readingRowToCsvLines` so the parent
 * function stays under the `complexity` lint cap (≤10).
 */
const encodeMetricValue = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return encodeCsvCell(value as string | number);
};

/**
 * Inputs for `csvLineFor`. Bundled into a single arg so the
 * helper stays under the `max-params` lint cap (≤3).
 */
interface CsvLineForArgs {
  readonly deviceId: string;
  readonly tsIso: string;
  readonly key: string;
  readonly value: unknown;
}

/**
 * Build one CSV data line from `(deviceId, tsIso, key, value)`.
 * Extracted from `readingRowToCsvLines` so the parent function
 * stays under the `complexity` lint cap (≤10).
 */
const csvLineFor = (args: CsvLineForArgs): string => {
  const { deviceId, tsIso, key, value } = args;
  return [
    encodeCsvCell(deviceId),
    encodeCsvCell(tsIso),
    encodeCsvCell(key),
    encodeMetricValue(value),
  ].join(",");
};

/**
 * Flatten one `ReadingRow` into N CSV lines.
 *
 * Iterates `Object.entries(row.metrics)` so v2 devices with a 7th
 * (or later) metric key emit that key as a CSV line — the
 * forward-compat escape hatch ADR 0001 promises. Metric keys are
 * validated against `MetricKeySchema` so an unknown key emits as a
 * quoted CSV cell with its raw key (preserving the wire shape); the
 * canonical 6 v1 keys are emitted in `MetricKeySchema.options` order
 * first so a downstream diff stays deterministic when the row's
 * `Object.keys` order changes.
 *
 * `row.metrics` is validated via `TelemetryMetricsSchema.safeParse`
 * BEFORE iterating. If the metrics payload fails validation (the
 * row is malformed in some way — a string where a number is
 * expected, an out-of-range value, etc.), a warning is logged and
 * the row is SKIPPED ENTIRELY — the stream never crashes on a
 * bad row.
 *
 * Returns `string[]` rather than a single string so the router can
 * `res.write` each line + `\n` independently (chunked transfer-
 * encoding keeps the wire linear as the dataset scales).
 */
export const readingRowToCsvLines = (row: ReadingRow): string[] => {
  // F12 — validate the metrics payload. We then iterate the
  // RAW `row.metrics` (not the parsed object) so v2 extra keys
  // — which Zod's strict `.object()` strips — still surface as
  // CSV lines. If validation fails, the row is skipped entirely
  // (the stream never crashes on a bad row).
  const metricsObject = row.metrics as Record<string, unknown>;
  const parsed = TelemetryMetricsSchema.safeParse(metricsObject);
  if (!parsed.success) {
    console.warn(
      `csvRouter: skipping reading ${row.id} (device ${row.deviceId}, ts ${row.ts.toISOString()}): metrics failed schema validation`,
      parsed.error.issues,
    );
    return [];
  }
  const tsIso = row.ts.toISOString();
  const lines: string[] = [];
  // Emit the canonical 6 v1 keys first in `MetricKeySchema.options`
  // order so a downstream diff stays deterministic; then emit any
  // extra keys (v2 forward-compat) in their `Object.keys` order.
  const emittedKeys = new Set<MetricKey>();
  for (const key of MetricKeySchema.options) {
    const value = metricsObject[key];
    if (value === undefined) continue;
    emittedKeys.add(key);
    lines.push(csvLineFor({ deviceId: row.deviceId, tsIso, key, value }));
  }
  for (const [key, value] of Object.entries(metricsObject)) {
    if (emittedKeys.has(key as MetricKey)) continue;
    lines.push(csvLineFor({ deviceId: row.deviceId, tsIso, key, value }));
  }
  return lines;
};

/**
 * Convenience wrapper: returns the header line + N data lines for
 * one row. No trailer is appended — the truncation flag is
 * communicated via the `X-CSV-Truncated` response header set by
 * the router before the body stream starts.
 */
export const readingRowToCsvRows = (row: ReadingRow): string[] => [...readingRowToCsvLines(row)];
