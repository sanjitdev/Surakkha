/**
 * WebSocket event payloads (architecture §3.5, AR-11).
 *
 * Backend emitters (Epic 4) and frontend listeners (Epic 2) agree on shape by
 * construction because they import from this file.
 */
import { z } from "zod";

import { MetricKeySchema, TelemetryMetricsSchema } from "./telemetry.js";

const ISO8601 = z.string().datetime({ offset: true });

export const ReadingNewEventSchema = z.object({
  device_id: z.string().uuid(),
  ts: z.number().int().nonnegative(),
  server_received_at: ISO8601,
  metrics: TelemetryMetricsSchema,
  /**
   * Per-frame flags surfaced from the ingest handler. Today the only
   * flag is `"out_of_order"` (Story 2.2: a late frame, `seq <
   * last_seen`). Future flags (`rate_limited`, `clock_skew_detected`)
   * round-trip the same array. Defaults to `[]` so an unflagged frame
   * omits the key on the wire — the schema's `.default([])` keeps the
   * api→web contract back-compat for any consumer that hasn't read
   * this yet.
   */
  flags: z.array(z.string()).default([]),
});
export type ReadingNewEvent = z.infer<typeof ReadingNewEventSchema>;

export const AlertOpenedEventSchema = z.object({
  alert_id: z.string().uuid(),
  device_id: z.string().uuid(),
  metric: MetricKeySchema,
  severity: z.enum(["info", "warning", "critical"]),
  opened_at: ISO8601,
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

export const IncidentStateChangedEventSchema = z.object({
  incident_id: z.string().uuid(),
  from_state: z.string(),
  to_state: z.string(),
  changed_at: ISO8601,
  actor_user_id: z.string().uuid().nullable(),
});
export type IncidentStateChangedEvent = z.infer<
  typeof IncidentStateChangedEventSchema
>;

const NOTIFICATION_TITLE_MAX = 200;
const NOTIFICATION_BODY_MAX = 2_000;

export const NotificationCriticalEventSchema = z.object({
  notification_id: z.string().uuid(),
  severity: z.literal("critical"),
  title: z.string().min(1).max(NOTIFICATION_TITLE_MAX),
  body: z.string().min(1).max(NOTIFICATION_BODY_MAX),
  created_at: ISO8601,
});
export type NotificationCriticalEvent = z.infer<
  typeof NotificationCriticalEventSchema
>;