/**
 * Rules engine contract — Surakkha shared (Story 3.1, 3.7).
 *
 * Closed enum literals that mirror the Prisma enums 1:1 + wire
 * schemas for the `/admin/thresholds` admin tab. The literal arrays
 * are exported as `as const` tuples so the inferred union type and
 * the runtime value set share a single source of truth.
 */

/** Closed enum of metric keys a Rule can target. Adding a new
 *  metric requires a Prisma migration that drops + recreates
 *  `RuleMetric` (Story 3.2's exhaustive switch needs a closed set). */
export const RULE_METRICS = [
  "ph",
  "tds_ppm",
  "turbidity_ntu",
  "chlorine_ppm",
  "temp_c",
  "water_level_cm",
] as const;
export type RuleMetric = (typeof RULE_METRICS)[number];

/** Closed enum of comparison operators that a Rule can apply.
 *  Story 3.2 maps these to the JS comparator via a small lookup
 *  table: gte → >=, gt → >, lte → <=, lt → <, eq → == */
export const RULE_OPERATORS = ["gte", "gt", "lte", "lt", "eq"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** Closed enum of severity levels a Rule can stamp onto a fired alert. */
export const RULE_SEVERITIES = ["info", "warning", "critical"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/** Closed enum of v1 rule types. Story 3.2's engine supports exactly
 *  these three; new rule types require a wire-contract bump. */
export const RULE_RULE_TYPES = ["instant", "rate", "absence"] as const;
export type RuleRuleType = (typeof RULE_RULE_TYPES)[number];

/**
 * Wire schemas for the `/admin/thresholds` admin tab (Story 3.7).
 *
 * The api's `thresholdsRouter` Zod-parses inbound bodies against
 * these schemas; the SPA's `useThresholds` hook also imports them
 * so the wire shape is validated at both boundaries (defence-in-
 * depth against future schema drift between api + web).
 */
import { z } from "zod";

/** Wire row for one `Rule` row. Mirrors the Prisma `Rule` model 1:1
 *  minus the timestamps (server-side only). */
export const RuleRowSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid().nullable(),
  metric: z.enum(RULE_METRICS),
  operator: z.enum(RULE_OPERATORS),
  threshold: z.number().finite(),
  severity: z.enum(RULE_SEVERITIES),
  ruleType: z.enum(RULE_RULE_TYPES),
  minDurationSeconds: z.number().int().nonnegative(),
  hysteresisSeconds: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdBy: z.string().nullable(),
  isActive: z.boolean(),
});
export type RuleRow = z.infer<typeof RuleRowSchema>;

/** Wire shape for `GET /admin/thresholds/rules?limit=50&cursor=...&activeOnly=true`.
 *  Cursor pagination: the api returns the last row's id as `nextCursor`
 *  when more rows exist; the client passes it back as `cursor`. */
export const RuleListResponseSchema = z.object({
  rules: z.array(RuleRowSchema),
  nextCursor: z.string().uuid().nullable(),
});
export type RuleListResponse = z.infer<typeof RuleListResponseSchema>;

/** Wire shape for `POST /admin/thresholds/rules`. The api creates a
 *  new `Rule` at `version: 1, isActive: true` with the body's fields.
 *  `deviceId` is optional (NULL = global rule). `createdBy` is also
 *  optional — defaults to the authenticated user's id on the api side. */
export const RuleCreateRequestSchema = z
  .object({
    deviceId: z.string().uuid().nullable().optional(),
    metric: z.enum(RULE_METRICS),
    operator: z.enum(RULE_OPERATORS),
    threshold: z.number().finite(),
    severity: z.enum(RULE_SEVERITIES),
    ruleType: z.enum(RULE_RULE_TYPES),
    minDurationSeconds: z.number().int().nonnegative(),
    hysteresisSeconds: z.number().int().nonnegative(),
    createdBy: z.string().optional(),
  })
  .strict();
export type RuleCreateRequest = z.infer<typeof RuleCreateRequestSchema>;

/** Wire shape for `PATCH /admin/thresholds/rules/:id`. Two sub-
 *  operations share the same URL:
 *   - `{ supersede: true, ...newFields }` — create a new `Rule` at
 *     `old.version + 1, isActive: true` and flip the old row's
 *     `isActive` to `false`.
 *   - `{ activate: false }` — flip the row's `isActive` to `false`
 *     without creating a new version.
 *
 *  The discriminated union + `.refine(...)` enforces "exactly one of
 *  supersede-true / activate-false is present" so an empty body or
 *  a body with both fields is rejected. */
export const RulePatchRequestSchema = z
  .union([
    z
      .object({
        supersede: z.literal(true),
        deviceId: z.string().uuid().nullable().optional(),
        metric: z.enum(RULE_METRICS).optional(),
        operator: z.enum(RULE_OPERATORS).optional(),
        threshold: z.number().finite().optional(),
        severity: z.enum(RULE_SEVERITIES).optional(),
        ruleType: z.enum(RULE_RULE_TYPES).optional(),
        minDurationSeconds: z.number().int().nonnegative().optional(),
        hysteresisSeconds: z.number().int().nonnegative().optional(),
      })
      .strict(),
    z
      .object({
        supersede: z.literal(false).optional(),
        activate: z.literal(false),
      })
      .strict(),
  ])
  .refine(
    (b) =>
      "supersede" in b && b.supersede === true ? true : "activate" in b && b.activate === false,
    {
      message: "must include supersede: true or activate: false",
    },
  );
export type RulePatchRequest = z.infer<typeof RulePatchRequestSchema>;

/** Wire shape for `PATCH /admin/thresholds/rules/:id/activate`.
 *  Empty body — the api flips `isActive` to true on the named
 *  version. Idempotent: re-flipping returns the same row. */
export const RuleActivateRequestSchema = z.object({}).strict().optional();
export type RuleActivateRequest = z.infer<typeof RuleActivateRequestSchema>;

/** Wire shape for the supersede response. Returns both the new row
 *  (the one just created at `old.version + 1`) AND the old row (with
 *  `isActive: false` flipped). The client uses both to render the
 *  history panel. */
export const RuleSupersedeResponseSchema = z.object({
  old: RuleRowSchema,
  new: RuleRowSchema,
});
export type RuleSupersedeResponse = z.infer<typeof RuleSupersedeResponseSchema>;
