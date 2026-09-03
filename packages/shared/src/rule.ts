/**
 * Rules engine contract — closed enum literals + wire schemas.
 *
 * The literal arrays are exported as `as const` tuples so the inferred
 * union type and the runtime value set share a single source of truth.
 */
import { z } from "zod";

/** Closed enum of metric keys a Rule can target. */
export const RULE_METRICS = [
  "ph",
  "tds_ppm",
  "turbidity_ntu",
  "chlorine_ppm",
  "temp_c",
  "water_level_cm",
] as const;
export type RuleMetric = (typeof RULE_METRICS)[number];

/** Closed enum of comparison operators. */
export const RULE_OPERATORS = ["gte", "gt", "lte", "lt", "eq"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** Closed enum of severity levels a Rule can stamp onto a fired alert. */
export const RULE_SEVERITIES = ["info", "warning", "critical"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/** Closed enum of v1 rule types. */
export const RULE_RULE_TYPES = ["instant", "rate", "absence"] as const;
export type RuleRuleType = (typeof RULE_RULE_TYPES)[number];

/** Wire row for one `Rule` row. Mirrors the Prisma `Rule` model minus the timestamps. */
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

/** Wire shape for `GET /admin/thresholds/rules` (cursor pagination). */
export const RuleListResponseSchema = z.object({
  rules: z.array(RuleRowSchema),
  nextCursor: z.string().uuid().nullable(),
});
export type RuleListResponse = z.infer<typeof RuleListResponseSchema>;

/** Wire shape for `POST /admin/thresholds/rules`. */
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

/** Wire shape for `PATCH /admin/thresholds/rules/:id`. Two sub-operations share the same URL: `{ supersede: true, ...newFields }` or `{ activate: false }`. */
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

/** Wire shape for `PATCH /admin/thresholds/rules/:id/activate`. Empty body — the api flips `isActive` to true. */
export const RuleActivateRequestSchema = z.object({}).strict().optional();
export type RuleActivateRequest = z.infer<typeof RuleActivateRequestSchema>;

/** Wire shape for the supersede response — returns both the new row and the old (now inactive) row. */
export const RuleSupersedeResponseSchema = z.object({
  old: RuleRowSchema,
  new: RuleRowSchema,
});
export type RuleSupersedeResponse = z.infer<typeof RuleSupersedeResponseSchema>;
