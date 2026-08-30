/**
 * `useKanbanBoardSocket` — Story 4.3.
 *
 * Mounts the `incident:state_changed` listener on the active socket
 * for the lifetime of the `<KanbanBoard />` page. On every event:
 *
 *   1. Look up the affected incident's current row in the
 *      `["incidents", "active"]` TanStack Query cache.
 *   2. If the new state is `RESOLVED`, REMOVE the row from the cache
 *      (spec "RESOLVED_DROP" — the card disappears from the board).
 *   3. Otherwise, mutate the row in place: update `state` so React
 *      re-derives the column on the next render. The projection
 *      (`projectKanbanColumn(state, severity)`) decides the new
 *      column; the column-keyed React element list handles the move.
 *   4. If the `incident_id` is not in the cache, drop the event
 *      (the row is already gone — likely an `incident:opened` for
 *      an unrelated incident, or a duplicate transition).
 *
 * The spec's "do not re-fetch the active list on socket events"
 * invariant is honoured here: we mutate the cache, never refetch.
 * The TanStack Query spy test asserts this contract.
 *
 * Disconnect handling mirrors `useDashboardSocket`: the underlying
 * socket is module-scoped (owned by `socketClient.ts`), so a
 * transport disconnect does NOT unmount this hook — TanStack Query
 * survives across reconnects and the next `incident:state_changed`
 * resumes in-place mutations.
 *
 * Listener scope is page-scoped (not module-scoped): the board
 * unmounts when the operator navigates away, the listener tears
 * down with it. If a future story (4.10 NotificationBell) needs
 * cross-page subscription, that story adds the module-scoped
 * listener. (See spec Design Notes.)
 */
import { type IncidentStateChangedEvent } from "@surakkha/shared/events";
import { type IncidentPayload } from "@surakkha/shared/incident";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiFetch } from "../api/apiClient";
import { useCurrentUserId } from "../auth/CurrentRoleContext";
import { connectSocket } from "../realtime/socketClient";

/**
 * The shared TanStack Query key for the active list. `useKanbanBoard`
 * uses the same key for its initial fetch; this hook mutates the
 * same cache so the board's render stays the single source of truth.
 */
export const KANBAN_ACTIVE_QUERY_KEY = ["incidents", "active"] as const;

interface ActiveCacheEnvelope {
  readonly incidents: IncidentPayload[];
}

const KANBAN_SOCKET_URL = "/dashboard";

/**
 * Mutate the active-list cache to reflect a single
 * `incident:state_changed` event. Pure helper (no React, no socket)
 * so the test rig can assert the cache transition without spinning
 * up a real socket.
 *
 * Returns the updated envelope, or the unchanged `prev` envelope on
 * any silent-drop path:
 *   - `prev === undefined` — the active list hasn't loaded yet.
 *   - `incident_id` not in the cache — the row was already removed
 *     (RESOLVED, or a duplicate event).
 *   - `RESOLVED_DROP` — the row transitioned to RESOLVED; we drop
 *     it (spec edge case).
 *   - `TECH_FILTER_DROP` (Story 4.12) — for Technician viewers,
 *     `assignee_user_id !== currentUserId`. The row belongs to
 *     another Tech, so the cache mutator drops the event silently
 *     (same shape as the `incident_id not found` branch above).
 *
 * `currentUserId` is OPTIONAL: when `undefined`, the helper falls
 * back to the original 4.3 contract (no Tech filter). The hook reads
 * `useCurrentUserId()` and threads the value through; unit tests
 * that don't care about the Tech filter pass `undefined`.
 */
export const applyStateChangeToCache = (
  prev: ActiveCacheEnvelope | undefined,
  event: IncidentStateChangedEvent,
  currentUserId?: string,
): ActiveCacheEnvelope | undefined => {
  if (prev === undefined) return prev;
  const idx = prev.incidents.findIndex((i) => i.id === event.incident_id);
  if (idx === -1) return prev;
  // RESOLVED_DROP — row transitions off the active board.
  if (event.to_state === "RESOLVED") {
    return {
      incidents: prev.incidents.filter((_, i) => i !== idx),
    };
  }
  // Story 4.12 — TECH_FILTER_DROP. The hook passes `currentUserId`
  // when the viewer is a Technician; the helper compares the row's
  // `assignee_user_id` against it and drops the event silently when
  // they differ. This mirrors the 4.3 `RESOLVED_DROP` shape: the
  // helper returns `prev` unchanged, the React tree does not
  // re-derive, and the row stays absent from the cache.
  const current = prev.incidents[idx];
  if (current === undefined) return prev;
  if (currentUserId !== undefined && current.assignee_user_id !== currentUserId) {
    return prev;
  }
  const nextIncidents = prev.incidents.slice();
  nextIncidents[idx] = {
    ...current,
    // The wire row's `state` is the only field that changes for an
    // in-place transition (the rest of the row is unchanged — the
    // server's authoritative row is what the board fetched at
    // mount time; subsequent transitions overwrite the cached
    // `state` only).
    state: event.to_state as IncidentPayload["state"],
  };
  return { incidents: nextIncidents };
};

/**
 * Mount the Kanban board's realtime subscription. Returns nothing —
 * the side-effect is the sole purpose of this hook.
 *
 * `url` defaults to `/dashboard` so the hook works in production
 * without call-site configuration. Tests pass a stub `url` (the
 * socket itself is mocked at the network layer via the
 * `connectSocket` vi.mock pattern used in `Dashboard.spec.tsx`).
 *
 * Story 4.12 — the hook reads `useCurrentUserId()` and threads it
 * into every cache mutation, so the helper's TECH_FILTER_DROP
 * guard can drop events for rows assigned to other Technicians.
 * The provider is mounted above `<KanbanBoard>` in the AppShell
 * tree (see `main.tsx`), so the hook's `useContext` call resolves
 * before the socket emits.
 */
export const useKanbanBoardSocket = (url: string = KANBAN_SOCKET_URL): void => {
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();

  useEffect(() => {
    const socket = connectSocket({ url }, { onSessionLost: () => undefined });

    const handleStateChange = (payload: IncidentStateChangedEvent): void => {
      queryClient.setQueryData<ActiveCacheEnvelope>([...KANBAN_ACTIVE_QUERY_KEY], (prev) =>
        applyStateChangeToCache(prev, payload, currentUserId ?? undefined),
      );
    };

    socket.on("incident:state_changed", handleStateChange);
    return () => {
      socket.off("incident:state_changed", handleStateChange);
    };
  }, [queryClient, url, currentUserId]);
};

/**
 * Resolve an incident's wire row by `incident_id`. Used as a fallback
 * when a socket event arrives BEFORE the active list has loaded (the
 * row is "not on the board" path). The export lets the test rig
 * exercise the re-derive path without spinning up a real socket.
 *
 * Currently unused in production — the board's initial fetch
 * completes before any socket event arrives in practice. The export
 * is here so a follow-up story that wires an
 * `incident:opened → insert` path (or a re-fetch on stale cache) has
 * a single source of truth for the helper.
 */
export const _fetchIncidentForBoard = async (id: string): Promise<IncidentPayload | null> => {
  const res = await apiFetch(`/api/incidents/${id}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { incident?: IncidentPayload } & IncidentPayload;
  // The /api/incidents/:id endpoint returns a flat IncidentPayload
  // (Story 4.2 AC1); coerce into the cache envelope shape.
  if ("incidents" in body) return null;
  return body;
};
