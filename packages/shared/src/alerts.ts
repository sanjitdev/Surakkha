/**
 * Alert lifecycle wire schemas.
 *
 * Source-of-truth surface for `GET /api/alerts` (dashboard) +
 * `POST /api/alerts/:alert_id/acknowledge` (operator flow). `linked_alerts`
 * is on the wire so the dashboard renders "this alert is part of an
 * ongoing chain" without an extra round-trip.
 */
import { z } from "zod";

import { RULE_METRICS, RULE_SEVERITIES, type RuleMetric, type RuleSeverity } from "./rule.js";

const ISO8601 = z.string().datetime({ offset: true });

/** Severity enum on the wire. */
export const AlertSeveritySchema = z.enum(RULE_SEVERITIES);
export type AlertSeverity = RuleSeverity;

/** Metric enum on the wire. */
export const AlertMetricSchema = z.enum(RULE_METRICS);
export type AlertMetric = RuleMetric;

/** Minimal projection of a predecessor alert (closed, sharing the same `(device, metric, severity)` key). */
export const AlertLinkedSchema = z.object({
  id: z.string().uuid(),
  opened_at: ISO8601,
  cleared_at: ISO8601.nullable(),
});
export type AlertLinked = z.infer<typeof AlertLinkedSchema>;

/** Full alert row as surfaced on the wire. */
export const AlertSummarySchema = z.object({
  id: z.string().uuid(),
  device_id: z.string().uuid(),
  rule_id: z.string().uuid(),
  severity: AlertSeveritySchema,
  metric: AlertMetricSchema,
  opened_at: ISO8601,
  cleared_at: ISO8601.nullable(),
  acknowledged_at: ISO8601.nullable(),
  acknowledged_by_user_id: z.string().uuid().nullable(),
  linked_alerts: z.array(AlertLinkedSchema),
});
export type AlertSummary = z.infer<typeof AlertSummarySchema>;

/** List response wrapper. `next_cursor` is `null` on the last page; non-null pages carry an opaque base64url-encoded JSON cursor. */
export const AlertListResponseSchema = z.object({
  alerts: z.array(AlertSummarySchema),
  next_cursor: z.string().nullable(),
});
export type AlertListResponse = z.infer<typeof AlertListResponseSchema>;

/** Acknowledge response shape. Mirrors `AlertAcknowledgedEventSchema` so the REST surface and the socket surface are interchangeable. */
export const AlertAcknowledgeResponseSchema = z.object({
  alert_id: z.string().uuid(),
  acknowledged_at: ISO8601,
  actor_user_id: z.string().uuid(),
});
export type AlertAcknowledgeResponse = z.infer<typeof AlertAcknowledgeResponseSchema>;
