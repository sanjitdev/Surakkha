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
 * envelope. Four of the six metrics (`ph`, `tds_ppm`, `temp_c`,
 * `water_level_cm`) match the hard reject ranges in `MetricRanges` — the v1
 * sensor envelope and the v1 wire-contract hard envelope are coincident for
 * those keys. The two that meaningfully extend (`turbidity_ntu 0–3000`,
 * `chlorine_ppm 0–10`) reflect real-world sensor headroom for ST-102 / CL-17
 * probes.
 *
 * Frames inside the extended envelope but outside the hard range are
 * observationally unusual but accepted in v1. Story 2.3 owns the soft-vs-hard
 * policy that may flag these in alerts. Story 3.3 (Default Thresholds Seed
 * Script) reads these constants to seed rule thresholds.
 *
 * Renamed from `MetricSoftRanges` (2026-08-22) — the name "soft" implied a
 * per-metric margin policy that does not yet exist. The new name tracks the
 * architectural terminology ("extended observation range") and avoids the
 * dead-fields confusion raised in code review finding [Review][Patch] F-A8.
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
  z
    .number()
    .finite()
    .min(MetricRanges[key].min)
    .max(MetricRanges[key].max);

/**
 * v1 metrics object — REQUIRED keys are the full v1 metric set per ADR 0001.
 * Derived from `MetricKeySchema.options` so adding an entry to the enum
 * automatically extends the schema (each key gets its hard-reject range).
 *
 * `TelemetryMetricsSchema` deliberately omits `.strict()` per ADR 0001
 * forward-compat rule: unknown metric keys are silently dropped, not
 * rejected. Top-level `.strict()` is on `TelemetryFrameSchema` only.
 */
export const TelemetryMetricsSchema = z.object(
  Object.fromEntries(
    MetricKeySchema.options.map((key) => [key, rangedFloat(key)]),
  ) as unknown as Record<MetricKey, z.ZodType<number>>,
);
export type TelemetryMetrics = z.infer<typeof TelemetryMetricsSchema>;

/**
 * v1 frame. `.strict()` rejects unknown TOP-LEVEL keys (firmware contract).
 * Per ADR 0001 unknown metric *keys* inside `metrics` are not added in v1
 * (the v1 metric set is fixed); `.strict()` is correct for both surfaces.
 * Missing required fields → 400 `bad_request` via `translateZodError` (Story 2.3).
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

/**
 * Canonical error envelope for failed `TelemetryFrameSchema.safeParse()`.
 *
 * `missing_fields` is the dotted-path list of every field that failed
 * validation. The name carries historical weight (firmware keys on it);
 * semantically the value covers any kind of failure (missing, out-of-range,
 * NaN, wrong-version, non-UUID). A v2 contract bump may split this into
 * `missing_fields` + `invalid_fields`; for v1 the single array is the
 * stable surface.
 */
export interface TelemetryBadRequest {
  readonly error: "bad_request";
  readonly missing_fields: string[];
}

/**
 * Translate a Zod failure into the wire error envelope the api surfaces to
 * clients. Each issue path is joined with `.` (e.g. `metrics.ph`).
 * De-duplication is by `path + issue code` so two issues on the same path
 * with different codes (e.g. `expected number, received NaN` plus
 * `min value 0`) are both surfaced — path-only de-dup silently drops
 * information. For `unrecognized_keys` issues each offending key emits a
 * SEPARATE missing-field entry (`extra_a` and `extra_b` rather than
 * `extra_a.extra_b`) so firmware can read each one without parsing. Path
 * iteration order matches Zod's.
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
      ? (issue as { keys: readonly string[] }).keys.map(
          (k) => (basePath ? `${basePath}.${k}` : k),
        )
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