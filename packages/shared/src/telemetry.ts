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