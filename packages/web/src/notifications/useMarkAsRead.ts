/**
 * `useMarkAsRead` — TanStack `useMutation` for the bell's "Mark as
 * read" affordance. Invalidates `UNREAD_NOTIFICATIONS_QUERY_KEY(role)`
 * on success and on the recoverable 4xx branches; no optimistic UI
 * (the server's verdict is the source of truth).
 */
import { type NotificationPayload } from "@surakkha/shared/notification";
import { type Role } from "@surakkha/shared/rbac";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { UNREAD_NOTIFICATIONS_QUERY_KEY } from "./useNotificationBell";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_NETWORK_THROW = 0;
const HTTP_4XX_MIN = 400;
const HTTP_4XX_MAX = 500;

/** Tagged error: `.message` = operator-facing toast copy, `.status` preserved. */
export class MarkAsReadMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "MarkAsReadMutationError";
    this.status = status;
  }
}

const classifyMarkAsReadError = (status: number): MarkAsReadMutationError => {
  if (status === HTTP_FORBIDDEN) {
    return new MarkAsReadMutationError(status, "Not authorized");
  }
  if (status === HTTP_NOT_FOUND) {
    return new MarkAsReadMutationError(status, "Notification not found");
  }
  if (status === HTTP_UNAUTHORIZED) {
    return new MarkAsReadMutationError(status, "Session expired — please sign in again");
  }
  return new MarkAsReadMutationError(status, "Failed to acknowledge notification. Try again.");
};

export interface UseMarkAsReadDeps {
  readonly onError: (message: string) => void;
}

export const useMarkAsRead = (viewerRole: Role, deps: UseMarkAsReadDeps) => {
  const queryClient = useQueryClient();
  const cacheKey = UNREAD_NOTIFICATIONS_QUERY_KEY(viewerRole);
  return useMutation<NotificationPayload, MarkAsReadMutationError, string>({
    mutationFn: async (id: string): Promise<NotificationPayload> => {
      try {
        const res = await apiFetch(`/api/notifications/${id}/acknowledge`, {
          method: "PATCH",
        });
        if (!res.ok) {
          throw classifyMarkAsReadError(res.status);
        }
        return (await res.json()) as NotificationPayload;
      } catch (err) {
        if (err instanceof MarkAsReadMutationError) {
          throw err;
        }
        // Network throws — classify as status 0 so `onError`'s range check stays valid.
        throw classifyMarkAsReadError(HTTP_NETWORK_THROW);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
    },
    onError: (err) => {
      // 403: re-fetch (recoverable) — no toast.
      if (err.status === HTTP_FORBIDDEN) {
        void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
        return;
      }
      // 4xx-not-403 (e.g. 404): invalidate so the next refetch drops the row.
      if (
        err.status >= HTTP_4XX_MIN &&
        err.status < HTTP_4XX_MAX &&
        err.status !== HTTP_UNAUTHORIZED
      ) {
        void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
      }
      deps.onError(err.message);
    },
  });
};
