/**
 * `useMarkAsRead` — Story 4.10.
 *
 * TanStack `useMutation` over
 * `PATCH /api/notifications/:id/acknowledge`. On success:
 * invalidates the unread query (`["notifications", "unread",
 * viewerRole]`) so the bell's badge decrements on the next
 * render (TanStack Query refetches; the badge updates).
 *
 * The spec is explicit: "Wait for server response, then re-
 * derive. No optimistic UI that hides the row from the
 * dropdown on mark-as-read before the server returns — a
 * failed PATCH would leave the operator thinking they
 * acknowledged when they didn't." The mutation does NOT touch
 * the cache directly; it relies on the invalidation + refetch
 * flow so the server's verdict is the source of truth.
 *
 * 4xx classification:
 *   - 403 → "Not authorized" toast (cross-role RBAC denial)
 *   - 404 → "Notification not found" toast
 *   - 401 → "Session expired" toast (5xx-class UX)
 *
 * 5xx classification: any other status → "Failed to acknowledge.
 * Try again." (retryable).
 *
 * Network throws → classified as status 0 (5xx-class UX).
 *
 * On 403: the bell re-fetches to recover (the cross-role row
 * may have been a stale cache entry). No toast (3.5 noise
 * reduction — same rationale as the spec's
 * `MARK_AS_READ_403` matrix row).
 */
import { type NotificationPayload } from "@surakkha/shared/notification";
import { type Role } from "@surakkha/shared/rbac";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { UNREAD_NOTIFICATIONS_QUERY_KEY } from "./useNotificationBell";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/** Network-throw sentinel (mirrors `useAcknowledgeMutation.ts:77`). */
const HTTP_NETWORK_THROW = 0;

/** 4xx range bounds (mirrors `useAcknowledgeMutation.ts:90-91`). */
const HTTP_4XX_MIN = 400;
const HTTP_4XX_MAX = 500;

/**
 * Tagged error class for the mutation. The `.message` is the
 * operator-facing toast copy (already classified for tone), and
 * the `.status` is preserved so the bell can route 404 / 403 to
 * the right re-render branch when the unread cache invalidates
 * and returns the next fetch's verdict.
 */
export class MarkAsReadMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "MarkAsReadMutationError";
    this.status = status;
  }
}

/**
 * Classify the api's failure response into the operator-facing copy.
 * Mirrors `useAcknowledgeMutation.ts:118-135` with copy tailored to
 * the mark-as-read surface.
 */
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
  /**
   * Push-toast callback. Wired by the bell so the page-scoped
   * toast queue owns the surface (mirrors the
   * IncidentDetailPage's `pushToast("error", err.message)`
   * pattern from 4.5). The mutation itself does NOT push toasts
   * itself; the bell wires `pushToast` from its `useToasts()` so
   * the toast lives on the bell's lifetime, not the mutation's.
   */
  readonly onError: (message: string) => void;
}

/**
 * `useMarkAsRead` — TanStack `useMutation` for the bell's
 * "Mark as read" affordance.
 *
 * On success: invalidates the unread query so the next refetch
 * drops the row from the dropdown (TanStack Query refetches; the
 * cache mutation is the optimistic surface for the badge).
 *
 * On 4xx failure: invalidates the unread query too — a 403 means
 * the row was cross-role (re-fetch surfaces the truth); a 404
 * means the row vanished (re-fetch drops it from the dropdown).
 *
 * On 5xx / 401 / network: no invalidation (the row is presumed
 * unchanged; the operator may retry).
 *
 * The mutation does NOT push toasts on 403 — the spec's
 * `MARK_AS_READ_403` matrix row pins this as "No toast (3.5
 * noise reduction)"; the bell re-fetches to recover.
 */
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
        const body = (await res.json()) as NotificationPayload;
        return body;
      } catch (err) {
        // Rethrow tagged errors verbatim; classify network throws
        // as status 0 so the `onError` range check stays valid.
        if (err instanceof MarkAsReadMutationError) {
          throw err;
        }
        throw classifyMarkAsReadError(HTTP_NETWORK_THROW);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
    },
    onError: (err) => {
      // Spec MARK_AS_READ_403 — "No toast (3.5 noise reduction)".
      // The bell re-fetches to recover; the row stays unread.
      if (err.status === HTTP_FORBIDDEN) {
        void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
        return;
      }
      // 4xx-not-403 failures (404 + 401) and 5xx + network: emit
      // the toast. 401 is 5xx-class UX but the toast copy is the
      // "session expired" line — the operator must re-auth before
      // any retry can succeed.
      if (
        err.status >= HTTP_4XX_MIN &&
        err.status < HTTP_4XX_MAX &&
        err.status !== HTTP_UNAUTHORIZED
      ) {
        // 404 (and other non-403 4xx): invalidate the unread query
        // so the next refetch drops the row from the dropdown.
        void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
      }
      deps.onError(err.message);
    },
  });
};
