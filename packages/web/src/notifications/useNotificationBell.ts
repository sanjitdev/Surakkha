/**
 * `useNotificationBell` — Story 4.10. TanStack `useQuery` over
 * `GET /api/notifications`. Role-scoped cache key, 30s polling,
 * Viewer disabled at `enabled: false`. On 403 throws the tagged
 * `NotificationsRbacDeniedError` so the bell can distinguish RBAC
 * from generic failures without a separate `error` type.
 */
import {
  type NotificationListEnvelope,
  type NotificationPayload,
} from "@surakkha/shared/notification";
import { type Role } from "@surakkha/shared/rbac";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { NotificationsRbacDeniedError } from "./NotificationsRbacDeniedError";

export const UNREAD_NOTIFICATIONS_QUERY_KEY = (
  viewerRole: Role,
): readonly ["notifications", "unread", Role] => ["notifications", "unread", viewerRole] as const;

const HTTP_FORBIDDEN = 403;
const POLL_INTERVAL_MS = 30_000;

export const countUnread = (notifications: readonly NotificationPayload[]): number =>
  notifications.length;

export const useNotificationBell = (viewerRole: Role) => {
  const enabled = viewerRole !== "Viewer";
  const query = useQuery<NotificationListEnvelope, NotificationsRbacDeniedError>({
    queryKey: [...UNREAD_NOTIFICATIONS_QUERY_KEY(viewerRole)],
    queryFn: async (): Promise<NotificationListEnvelope> => {
      const res = await apiFetch("/api/notifications");
      if (res.status === HTTP_FORBIDDEN) {
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

  const notifications = query.data?.notifications ?? [];
  const unreadCount = countUnread(notifications);
  return { notifications, unreadCount, query };
};
