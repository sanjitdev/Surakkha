/**
 * `cacheMutators.ts` — Story 4.4.
 *
 * Shared row-update helper for the `incident:state_changed`
 * socket-driven cache mutations consumed by both the Kanban
 * (Story 4.3, `useKanbanBoardSocket`) and the detail page
 * (Story 4.4, `useIncidentDetailSocket`).
 *
 * Why extract: both hooks subscribe to the same socket event
 * and both mutate TanStack Query caches. The row-update shape —
 * find row by `incident_id`, replace `state` in place — belongs
 * in one place. The divergence (Kanban drops resolved rows;
 * detail keeps them) lives in the per-hook wrapper, not here.
 *
 * Pure function; no React, no TanStack Query, no socket.
 * Testable directly from the test rig without rendering.
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import { type IncidentPayload } from "@surakkha/shared/incident";

/**
 * Apply a single `incident:state_changed` event to a row.
 * Returns the updated row, or `null` if the row's `incident_id`
 * does not match the event's `incident_id` (caller decides
 * whether to drop, keep, or re-fetch).
 *
 * RESOLVED semantics are the caller's concern — this helper
 * only replaces the `state` field.
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
