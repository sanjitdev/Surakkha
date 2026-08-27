/**
 * WebSocket event payloads (architecture §3.5, AR-11).
 *
 * Backend emitters (Epic 4) and frontend listeners (Epic 2) agree on shape by
 * construction because they import from this file.
 */
import { z } from "zod";

import { MetricKeySchema, ReadingFlagSchema, TelemetryMetricsSchema } from "./telemetry.js";

const ISO8601 = z.string().datetime({ offset: true });

export const ReadingNewEventSchema = z.object({
  device_id: z.string().uuid(),
  ts: z.number().int().nonnegative(),
  server_received_at: ISO8601,
  metrics: TelemetryMetricsSchema,
  /**
   * Per-frame flags stamped by the ingest handler. Closed enum
   * (`ReadingFlagSchema`) — the wire does not accept firmware-supplied
   * flags. Story 2.3 pins the v1 set to `out_of_order | clock_skew_
   * detected | rate_limited`; a new flag is a v2 contract bump.
   * `.default([])` keeps an unflagged frame's payload identical to the
   * pre-Story-2.3 wire shape so the api→web contract is back-compat.
   * The inferred type is `readonly ReadingFlag[]` so the api's frame
   * state can flow the same array reference from classify through
   * persist to broadcast without a copy.
   */
  flags: z.array(ReadingFlagSchema).default([]).readonly(),
});
export type ReadingNewEvent = z.infer<typeof ReadingNewEventSchema>;

export const AlertOpenedEventSchema = z.object({
  alert_id: z.string().uuid(),
  device_id: z.string().uuid(),
  metric: MetricKeySchema,
  severity: z.enum(["info", "warning", "critical"]),
  opened_at: ISO8601,
  // Story 3.4 — wire fields that let the UI render the rule that
  // fired (`rule_id`) and the reading that breached (`value`).
  // `rule_id` enables the operator dashboard's "view rule" link;
  // `value` is the rendering value on the alert card (without it,
  // the dashboard must join back to the Reading row).
  rule_id: z.string().uuid(),
  value: z.number(),
});
export type AlertOpenedEvent = z.infer<typeof AlertOpenedEventSchema>;

export const AlertAcknowledgedEventSchema = z.object({
  alert_id: z.string().uuid(),
  acknowledged_at: ISO8601,
  actor_user_id: z.string().uuid(),
});
export type AlertAcknowledgedEvent = z.infer<typeof AlertAcknowledgedEventSchema>;

export const IncidentUpdatedEventSchema = z.object({
  incident_id: z.string().uuid(),
  updated_at: ISO8601,
});
export type IncidentUpdatedEvent = z.infer<typeof IncidentUpdatedEventSchema>;

/**
 * Story 4.2 — IncidentOpenedEvent (closes AI-3.3 from the Epic 3
 * retrospective). Emitted on the post-commit hook of
 * `applyTransition.ts`'s auto-create-incident path (Story 3.6),
 * once the `Incident` row is durable + the `Alert` row is durable.
 * Distinct from `IncidentStateChangedEvent` because there is no
 * `from_state` (the row was just created) and there is no
 * `actor_user_id` (the path is system-driven by the rule engine,
 * not by an operator).
 *
 * Listeners (Story 4.4 detail page, deferred) consume this to
 * populate the timeline's first row without polling
 * `/api/incidents/:id`.
 */
export const IncidentOpenedEventSchema = z.object({
  incident_id: z.string().uuid(),
  device_id: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  metric: z.string(),
  value: z.number(),
  opened_at: ISO8601,
  // The Alert that triggered the auto-create is informational;
  // listeners that don't need it can ignore the field.
  alert_id: z.string().uuid().nullable(),
});
export type IncidentOpenedEvent = z.infer<typeof IncidentOpenedEventSchema>;

export const IncidentStateChangedEventSchema = z.object({
  incident_id: z.string().uuid(),
  from_state: z.string(),
  to_state: z.string(),
  changed_at: ISO8601,
  actor_user_id: z.string().uuid().nullable(),
});
export type IncidentStateChangedEvent = z.infer<typeof IncidentStateChangedEventSchema>;

const NOTIFICATION_TITLE_MAX = 200;
const NOTIFICATION_BODY_MAX = 2_000;

export const NotificationCriticalEventSchema = z.object({
  notification_id: z.string().uuid(),
  severity: z.literal("critical"),
  title: z.string().min(1).max(NOTIFICATION_TITLE_MAX),
  body: z.string().min(1).max(NOTIFICATION_BODY_MAX),
  created_at: ISO8601,
});
export type NotificationCriticalEvent = z.infer<typeof NotificationCriticalEventSchema>;
