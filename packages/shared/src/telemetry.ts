/**
 * Telemetry wire contract — `version: 1`, frozen (NFR-14, ADR 0001).
 *
 * Every change to this file is a contract bump and must be called out in the PR
 * description with a v2-bump justification (per Story 1.10).
 *
 * Both `packages/api` and `packages/simulator` import this schema. A contract
 * bump edits only this file.
 */
import { z } from "zod";

// Time unit helpers — kept local to telemetry.ts so the magic-number
// lint rule has named handles for the stale-frame and clock-skew
// thresholds. ESLint's `no-magic-numbers` rule fires on raw numeric
// literals; these constants make the arithmetic readable AND lintable.
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

// v1 metric ranges from BRD §8.3.1 (WHO/BSTI source of truth).
export const MetricRanges = {
  ph: { min: 0, max: 14 },
  tds_ppm: { min: 0, max: 5_000 },
  turbidity_ntu: { min: 0, max: 1_000 },
  temp_c: { min: -10, max: 80 },
  chlorine_ppm: { min: 0, max: 5 },
  water_level_cm: { min: 0, max: 500 },
} as const;

/**
 * Extended observation envelope (architecture §3.2) — sensor's plausible
 * range. `turbidity_ntu 0–3000` and `chlorine_ppm 0–10` extend past the
 * hard-reject `MetricRanges` (real-world ST-102 / CL-17 probe headroom).
 * Story 3.3 reads these to seed rule thresholds.
 */
export const MetricExtendedRanges = {
  ph: { min: 0, max: 14 },
  tds_ppm: { min: 0, max: 5_000 },
  turbidity_ntu: { min: 0, max: 3_000 },
  temp_c: { min: -10, max: 80 },
  chlorine_ppm: { min: 0, max: 10 },
  water_level_cm: { min: 0, max: 500 },
} as const;

export const MetricKeySchema = z.enum([
  "ph",
  "tds_ppm",
  "turbidity_ntu",
  "temp_c",
  "chlorine_ppm",
  "water_level_cm",
]);
export type MetricKey = z.infer<typeof MetricKeySchema>;

const rangedFloat = (key: MetricKey) =>
  z.number().finite().min(MetricRanges[key].min).max(MetricRanges[key].max);

/**
 * v1 metrics object — REQUIRED keys are the full v1 metric set per ADR 0001.
 * Each enum key gets its `MetricRanges` hard-reject envelope. Adding an
 * entry to `MetricKeySchema` automatically extends this schema.
 */
export const TelemetryMetricsSchema = z.object(
  Object.fromEntries(
    MetricKeySchema.options.map((key) => [key, rangedFloat(key)]),
  ) as unknown as Record<MetricKey, z.ZodType<number>>,
);
export type TelemetryMetrics = z.infer<typeof TelemetryMetricsSchema>;

/**
 * v1 frame. `.strict()` rejects unknown TOP-LEVEL keys (firmware contract).
 * Missing required fields → 400 `bad_request` via `translateZodError`.
 */
const FW_VERSION_MAX_LENGTH = 64;
export const TelemetryFrameSchema = z
  .object({
    version: z.literal(1),
    device_id: z.string().uuid(),
    ts: z.number().int().nonnegative(),
    fw: z.string().min(1).max(FW_VERSION_MAX_LENGTH),
    seq: z.number().int().nonnegative(),
    metrics: TelemetryMetricsSchema,
  })
  .strict();
export type TelemetryFrame = z.infer<typeof TelemetryFrameSchema>;

/**
 * Server processing order (architecture §3.2, ADR 0013). The api's
 * `packages/api/src/ingest/frame.ts` handler runs these steps in this
 * exact order; reordering any adjacent pair is a contract violation.
 */
export const PROCESSING_ORDER = [
  "validate",
  "auth check",
  "rate check",
  "seq/drop check",
  "persist",
  "rule evaluation",
  "alert emission",
  "state-machine update",
  "audit append",
  "socket broadcast",
] as const;
export type ProcessingOrderStep = (typeof PROCESSING_ORDER)[number];

/**
 * Canonical error envelope for failed `TelemetryFrameSchema.safeParse()`.
 * `missing_fields` is the dotted-path list of every field that failed
 * validation (covers missing, out-of-range, NaN, wrong-version, non-UUID).
 */
export interface TelemetryBadRequest {
  readonly error: "bad_request";
  readonly missing_fields: string[];
}

/**
 * Canonical envelope for a frame whose device-side `ts` is older than
 * the stale-frame window (see `STALE_FRAME_THRESHOLD_MS`). The connection
 * stays open so a backlog of fresh frames behind the stale one is still
 * accepted; `age_seconds` lets the device decide whether to reset its clock.
 */
export interface TelemetryStaleFrame {
  readonly error: "stale_frame";
  readonly age_seconds: number;
}

/**
 * v1 flag set — closed enum (architecture §3.6). The server stamps every
 * flag; the wire contract does not let firmware set them. A typo fails
 * `ReadingFlagSchema.parse` at the seam so a bad row cannot silently slip
 * into ops queries.
 */
export const ReadingFlagSchema = z.enum(["out_of_order", "clock_skew_detected", "rate_limited"]);
export type ReadingFlag = z.infer<typeof ReadingFlagSchema>;

/**
 * Stale-frame window. Frames whose device-side `ts` is more than this many
 * ms in the past (relative to `serverReceivedAt`) are rejected with a
 * `stale_frame` envelope. Real devices emit every 2s; longer offline
 * periods are *lost* frames, not late frames.
 */
export const STALE_FRAME_THRESHOLD_MS = 5 * MS_PER_MINUTE;

/**
 * Clock-skew detection threshold. Frames whose `|serverReceivedAt − ts|`
 * exceeds this are persisted with `flags:["clock_skew_detected"]`. NTP-
 * disciplined devices drift <1s; undisciplined RTCs drift ~1min/month.
 */
export const CLOCK_SKEW_DETECT_MS = MS_PER_MINUTE;

/**
 * Single source of truth for flag-derivation logic from a parsed frame's
 * timestamp. Returns `["clock_skew_detected"]` when `|skew| > CLOCK_SKEW_DETECT_MS`;
 * `[]` otherwise. The `out_of_order` and `rate_limited` flags are stamped
 * by their own dedicated steps.
 */
export const classifyFlags = (
  parsed: TelemetryFrame,
  serverReceivedAt: Date,
): readonly ReadingFlag[] => {
  const skewMs = serverReceivedAt.getTime() - parsed.ts;
  if (Math.abs(skewMs) > CLOCK_SKEW_DETECT_MS) {
    return ["clock_skew_detected"];
  }
  return [];
};

/**
 * Translate a Zod failure into the wire error envelope the api surfaces to
 * clients. Each issue path is joined with `.` (e.g. `metrics.ph`).
 * De-duplication is by `path + issue code` so two issues on the same path
 * with different codes are both surfaced. For `unrecognized_keys` issues
 * each offending key emits a separate entry.
 */
export const translateZodError = (error: z.ZodError): TelemetryBadRequest => {
  const missingFields: string[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const basePath = issue.path.join(".");
    const isUnrecognized =
      issue.code === "unrecognized_keys" &&
      Array.isArray((issue as { keys?: readonly string[] }).keys) &&
      (issue as { keys: readonly string[] }).keys.length > 0;
    const pathsToEmit: string[] = isUnrecognized
      ? (issue as { keys: readonly string[] }).keys.map((k) => (basePath ? `${basePath}.${k}` : k))
      : [basePath || "(root)"];
    for (const path of pathsToEmit) {
      const dedupKey = `${path}|${issue.code}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      missingFields.push(path);
    }
  }
  return { error: "bad_request", missing_fields: missingFields };
};
