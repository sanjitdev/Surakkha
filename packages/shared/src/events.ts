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
  /** Per-frame flags stamped by the ingest handler. Closed enum —
   *  the wire does not accept firmware-supplied flags. `.default([])`
   *  keeps an unflagged frame's payload identical to the pre-Story-2.3
   *  wire shape. */
  flags: z.array(ReadingFlagSchema).default([]).readonly(),
});
export type ReadingNewEvent = z.infer<typeof ReadingNewEventSchema>;

export const AlertOpenedEventSchema = z.object({
  alert_id: z.string().uuid(),
  device_id: z.string().uuid(),
  metric: MetricKeySchema,
  severity: z.enum(["info", "warning", "critical"]),
  opened_at: ISO8601,
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

/** Incident auto-created from an alert (Story 3.6). Distinct from
 *  `IncidentStateChangedEvent` — no `from_state` (row was just created)
 *  and `actor_user_id` is `null` (system-driven path). */
export const IncidentOpenedEventSchema = z.object({
  incident_id: z.string().uuid(),
  device_id: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  metric: z.string(),
  value: z.number(),
  opened_at: ISO8601,
  alert_id: z.string().uuid().nullable(),
  actor_user_id: z.string().uuid().nullable(),
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

/** Verb literals for the AC4 observability log line. The 5 RBAC verbs
 *  plus `auto_create` (system-driven, not in `ActionVerbSchema`). */
export const INCIDENT_TRANSITION_VERB_LITERALS = [
  "acknowledge",
  "assign",
  "submit_result",
  "resolve",
  "reopen",
  "auto_create",
] as const;

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
