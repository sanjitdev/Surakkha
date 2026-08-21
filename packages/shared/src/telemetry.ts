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
 * Extended observation ranges from architecture §3.2 — the sensor's plausible
 * envelope (turbidity 0–3000 NTU, chlorine 0–10 ppm). Frames inside this
 * envelope but outside `MetricRanges` are observationally unusual but not
 * invalid; Story 2.3 owns the soft-vs-hard policy. Story 3.3 (Default
 * Thresholds Seed Script) references these constants.
 */
export const MetricSoftRanges = {
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
  z
    .number()
    .finite()
    .min(MetricRanges[key].min)
    .max(MetricRanges[key].max);

export const TelemetryMetricsSchema = z.object({
  ph: rangedFloat("ph"),
  tds_ppm: rangedFloat("tds_ppm"),
  turbidity_ntu: rangedFloat("turbidity_ntu"),
  temp_c: rangedFloat("temp_c"),
  chlorine_ppm: rangedFloat("chlorine_ppm"),
  water_level_cm: rangedFloat("water_level_cm"),
});
export type TelemetryMetrics = z.infer<typeof TelemetryMetricsSchema>;

/** v1 frame. Unknown fields are stripped by Zod's default; missing required → 400 (Story 2.3). */
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
 * Server processing order (architecture §3.2, ADR 0013). Story 2.2's
 * `packages/api/src/ingest/frame.ts` handler MUST run these steps in this
 * exact order; reordering any adjacent pair is a contract violation.
 *
 * The order is captured here so the constant and the comment block in
 * `frame.ts` stay in lockstep — adding a step requires editing one place,
 * not two.
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

/** Canonical error envelope for failed `TelemetryFrameSchema.safeParse()`. */
export interface TelemetryBadRequest {
  readonly error: "bad_request";
  readonly missing_fields: string[];
}

/**
 * Translate a Zod failure into the wire error envelope the api surfaces to
 * clients. The path of every issue is joined with `.` (e.g. `metrics.ph`)
 * and de-duplicated; missing fields come out first, then invalid ones,
 * preserving Zod's iteration order.
 */
export const translateZodError = (error: z.ZodError): TelemetryBadRequest => {
  const missingFields: string[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "(root)";
    if (seen.has(key)) continue;
    seen.add(key);
    missingFields.push(key);
  }
  return { error: "bad_request", missing_fields: missingFields };
};