/**
 * Shared row-update helper for the `incident:state_changed` socket
 * event. Both the Kanban (`useKanbanBoardSocket`) and the detail
 * page (`useIncidentDetailSocket`) mutate their TanStack Query
 * caches from this event; the row-update shape (find by id, swap
 * `state`) lives here. The Kanban-vs-detail divergence (drop vs
 * keep on RESOLVED) lives in the per-hook wrapper.
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import { type IncidentPayload } from "@surakkha/shared/incident";

/**
 * Apply a single `incident:state_changed` event to a row. Returns
 * the updated row, or `null` if the row's id does not match the
 * event's `incident_id` (caller decides whether to drop, keep, or
 * re-fetch). RESOLVED semantics are the caller's concern.
 */
export const applyTransitionToCachedRow = (
  row: IncidentPayload,
  event: IncidentStateChangedEvent,
): IncidentPayload | null => {
  if (row.id !== event.incident_id) return null;
  return {
    ...row,
    state: event.to_state as IncidentPayload["state"],
  };
};
