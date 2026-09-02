/**
 * `format.ts` — pure formatting helpers for the incident surfaces.
 *
 * No React, no fetch — every helper here is unit-testable against
 * canned input. The audit-timeline summary map (per-verb) lives
 * here because it's the same shape as the row timeline uses.
 */
import { type IncidentEventPayload, type InspectionOutcome } from "@surakkha/shared/incident";

const ISO_DATE_PREFIX_LENGTH = 10;

/** ISO 8601 timestamp → `YYYY-MM-DD` for incident-row `<dd>` cells. */
export const formatDateOrDash = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toISOString().slice(0, ISO_DATE_PREFIX_LENGTH);

/** Render an event actor as `you` / `anonymous` / a role-inferred fallback. */
const ACTOR_LABEL_BY_VERB: Readonly<Record<string, string>> = {
  acknowledge: "another operator",
  assign: "another operator",
  submit_result: "a Technician",
  resolve: "another operator",
  reopen: "another operator",
  invalid_transition_attempt: "another operator",
};

export const formatActorOrAnonymous = (
  id: string | null,
  verb: string,
  viewerUserId: string | null,
): string => {
  if (id === null) return "anonymous";
  if (id === viewerUserId) return "you";
  return ACTOR_LABEL_BY_VERB[verb] ?? "another operator";
};

/** Assignee surface — always a Technician when present. */
export const formatAssigneeLabel = (id: string | null, viewerUserId: string | null): string => {
  if (id === null) return "unassigned";
  if (id === viewerUserId) return "you";
  return "a Technician";
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 604_800_000;

/** Human-readable relative timestamp for the audit-timeline. */
export const formatTimelineTimestamp = (iso: string): string => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const delta = Date.now() - at;
  if (delta < 0) return iso;
  if (delta < MS_PER_MINUTE) return "just now";
  if (delta < MS_PER_HOUR) return `${Math.floor(delta / MS_PER_MINUTE)} min ago`;
  if (delta < MS_PER_DAY) return `${Math.floor(delta / MS_PER_HOUR)} h ago`;
  if (delta < MS_PER_WEEK) return `${Math.floor(delta / MS_PER_DAY)} d ago`;
  return new Date(at).toISOString().slice(0, ISO_DATE_PREFIX_LENGTH);
};

const OUTCOME_LABEL: Record<InspectionOutcome, string> = {
  SAFE: "Marked safe",
  UNSAFE: "Marked unsafe",
  MONITORING: "Marked for monitoring",
};

const readStringField = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" ? value : null;
};

const formatAcknowledgeSummary = (actor: string): string => `Acknowledged by ${actor}.`;

const formatAssignSummary = (actor: string, payload: Record<string, unknown>): string => {
  const assignee = readStringField(payload, "assigneeUserId") ?? "an unassigned technician";
  return `Assigned to ${assignee} by ${actor}.`;
};

const formatSubmitResultSummary = (actor: string, payload: Record<string, unknown>): string => {
  const { outcome } = payload;
  const outcomeLabel =
    outcome === "SAFE" || outcome === "UNSAFE" || outcome === "MONITORING"
      ? OUTCOME_LABEL[outcome]
      : "Inspection result recorded";
  return `${outcomeLabel} by ${actor}.`;
};

const formatResolveSummary = (actor: string): string => `Resolved by ${actor}.`;

const formatReopenSummary = (actor: string, payload: Record<string, unknown>): string => {
  const reason = readStringField(payload, "reason");
  const reasonText = reason !== null && reason.length > 0 ? reason : "no reason given";
  return `Reopened by ${actor} — "${reasonText}".`;
};

const formatInvalidTransitionSummary = (
  actor: string,
  payload: Record<string, unknown>,
): string => {
  const fromText = readStringField(payload, "from") ?? "the current state";
  const attemptedText = readStringField(payload, "attempted") ?? "an action";
  return `Rejected: ${attemptedText} from ${fromText} is not a valid transition.`;
};

/** Render the per-event summary line for the audit timeline. */
export const formatTimelineEventSummary = (
  event: IncidentEventPayload,
  viewerUserId: string | null,
): string => {
  const actor = formatActorOrAnonymous(event.actor_user_id, event.type, viewerUserId);
  switch (event.type) {
    case "acknowledge":
      return formatAcknowledgeSummary(actor);
    case "assign":
      return formatAssignSummary(actor, event.payload);
    case "submit_result":
      return formatSubmitResultSummary(actor, event.payload);
    case "resolve":
      return formatResolveSummary(actor);
    case "reopen":
      return formatReopenSummary(actor, event.payload);
    case "invalid_transition_attempt":
      return formatInvalidTransitionSummary(actor, event.payload);
  }
};
