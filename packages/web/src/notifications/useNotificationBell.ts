/**
 * `useNotificationBell` — Story 4.10.
 *
 * TanStack `useQuery` over `GET /api/notifications`. Cache key:
 * `["notifications", "unread", viewerRole]` so the badge count
 * is role-scoped (Operator and Admin never share a count even
 * if the data layer ever leaks across roles).
 *
 * The hook polls every 30 seconds via `refetchInterval: 30_000`
 * so the badge increments without user action. The spec's
 * Design Notes "Why polling instead of a socket subscription"
 * captures the rationale: the writer is locked from 4.9 (no
 * `notification:*` socket event ships with 4.10), and the
 * cache-key contract is the seam a future story can use to swap
 * in a socket channel.
 *
 * Returns `{ notifications, unreadCount, query }`. The hook is
 * the read-only projection; the consumer is `<NotificationBell />`
 * which calls this hook internally.
 *
 * The `Viewer` role does NOT fetch — the bell renders a disabled
 * variant (`data-testid="notification-bell-disabled"`) and the
 * hook is gated at the UI layer (`enabled: role !== "Viewer"`)
 * so no network request fires. This matches the spec's
 * `RBAC_NO_FETCH` matrix row: "Viewer role. NO network request
 * fires (UI gates the read). No data leaked via DevTools network
 * tab."
 *
 * On 403 the hook's `queryFn` throws `NotificationsRbacDeniedError`
 * (mirror of `KanbanBoard.tsx`'s pattern); the cache's error type
 * is the SAME class the bell's `queryFn` reads.
 *
 * `staleTime: 0` keeps the badge current on every poll — the
 * `refetchInterval` is the source of truth, not the cache TTL.
 */
import {
  type NotificationListEnvelope,
  type NotificationPayload,
} from "@surakkha/shared/notification";
import { type Role } from "@surakkha/shared/rbac";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { NotificationsRbacDeniedError } from "./NotificationsRbacDeniedError";

/**
 * TanStack Query key for the unread notification list. Role-
 * scoped so Admin and Operator counts never collide (defense-
 * in-depth — the api already filters by `recipientRole ===
 * viewerRole`, but the cache key is the second line).
 *
 * Re-exported as `UNREAD_NOTIFICATIONS_QUERY_KEY` so test rigs
 * can pin cache identity (mirrors `KANBAN_ACTIVE_QUERY_KEY` in
 * 4.3's `useKanbanBoardSocket.ts:48`).
 */
export const UNREAD_NOTIFICATIONS_QUERY_KEY = (
  viewerRole: Role,
): readonly ["notifications", "unread", Role] => ["notifications", "unread", viewerRole] as const;

/** HTTP status code sentinel — RBAC denial. */
const HTTP_FORBIDDEN = 403;

/** 30s polling interval per the spec ("refetchInterval: 30_000"). */
const POLL_INTERVAL_MS = 30_000;

/**
 * Pure filter — returns the count of unread notifications.
 * Exported for direct test coverage (mirrors the
 * `filterUnsafeWithin24h` helper at
 * `packages/web/src/incidents/useSeverityBanner.ts:110-122`).
 */
export const countUnread = (notifications: readonly NotificationPayload[]): number =>
  notifications.length;

/**
 * `useNotificationBell` — TanStack `useQuery` over
 * `/api/notifications`. Disabled for Viewer viewers (the bell
 * renders a disabled variant, no fetch fires).
 *
 * Returns `{ notifications, unreadCount, query }`. The hook is
 * the read-only projection; the consumer is `<NotificationBell />`.
 */
export const useNotificationBell = (viewerRole: Role) => {
  const enabled = viewerRole !== "Viewer";
  const query = useQuery<NotificationListEnvelope, NotificationsRbacDeniedError>({
    queryKey: [...UNREAD_NOTIFICATIONS_QUERY_KEY(viewerRole)],
    queryFn: async (): Promise<NotificationListEnvelope> => {
      const res = await apiFetch("/api/notifications");
      if (res.status === HTTP_FORBIDDEN) {
        // RBAC denial — throw the tagged error so the bell can
        // distinguish RBAC from generic failures without a
        // separate `error` type. The Viewer case is gated at
        // `enabled: false` above, so this branch is for the
        // race condition where a Technician's token expires mid-
        // session (the matrix grants Technician.read.Notification
        // = Y, but a token expiry → 401 is handled by `apiFetch`
        // before this branch; a 403 here means the api rejected
        // the read for some other reason — defensive).
        throw new NotificationsRbacDeniedError();
      }
      if (!res.ok) {
        throw new Error(`/api/notifications failed: ${res.status}`);
      }
      const body = (await res.json()) as NotificationListEnvelope;
      return body;
    },
    enabled,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
    staleTime: 0,
  });

  // On error (any kind — RBAC, 5xx, network), the bell falls
  // back to the zero-unread state so the badge doesn't
  // mis-render. The dropdown's "Unable to load notifications"
  // branch is gated on `query.isError` separately.
  const notifications = query.data?.notifications ?? [];
  const unreadCount = countUnread(notifications);
  return { notifications, unreadCount, query };
};
