/**
 * `useDeleteAttachment` — Story 4.13.
 *
 * TanStack `useMutation` over
 * `DELETE /api/attachments/:id`. On success: invalidates the
 * attachments list query
 * (`["incidents", "detail", incidentId, "attachments"]`) so the
 * `<AttachmentList />` refetches and the deleted row disappears.
 *
 * The mutation does NOT mutate the cache directly (no optimistic
 * remove) — the server's verdict is the source of truth. A failed
 * DELETE that returned a 204-shaped response and then crashed the
 * client would leave a phantom row if we mutated optimistically;
 * the invalidation + refetch flow is the safe contract (mirrors
 * `useMarkAsRead.ts:140-141`'s invalidate-on-success pattern from
 * 4.10).
 *
 * 4xx classification:
 *   - 403 → "Not authorized" toast (cross-row RBAC denial —
 *     Operator deleting another operator's attachment; Admin
 *     bypasses via the per-row check).
 *   - 404 → "Attachment not found" toast.
 *   - 401 → "Session expired" toast (5xx-class UX).
 *
 * 5xx classification: any other status → "Failed to delete
 * attachment. Try again." (retryable).
 *
 * Network throws → classified as status 0 (5xx-class UX).
 *
 * On 403 / 404 the section invalidates the list too — the row
 * may have been a stale cache entry (e.g., another tab deleted
 * it). The next refetch drops the row from the dropdown.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { ATTACHMENTS_QUERY_KEY } from "./useAttachments";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/** Network-throw sentinel (mirrors `useMarkAsRead.ts:46`). */
const HTTP_NETWORK_THROW = 0;

/**
 * Tagged error class for the delete mutation. Mirrors
 * `MarkAsReadMutationError`'s shape so the consumer's error
 * handling is uniform across mutations. The `.message` is the
 * operator-facing toast copy; the `.status` is preserved so the
 * form can branch on the failure mode.
 */
export class DeleteAttachmentMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "DeleteAttachmentMutationError";
    this.status = status;
  }
}

/**
 * Classify the api's failure response into the operator-facing
 * copy. Mirrors `useMarkAsRead.ts:73-84` with copy tailored to
 * the delete-attachment surface.
 */
const classifyDeleteError = (status: number): DeleteAttachmentMutationError => {
  if (status === HTTP_FORBIDDEN) {
    return new DeleteAttachmentMutationError(status, "Not authorized");
  }
  if (status === HTTP_NOT_FOUND) {
    return new DeleteAttachmentMutationError(status, "Attachment not found");
  }
  if (status === HTTP_UNAUTHORIZED) {
    return new DeleteAttachmentMutationError(status, "Session expired — please sign in again");
  }
  return new DeleteAttachmentMutationError(status, "Failed to delete attachment. Try again.");
};

export interface UseDeleteAttachmentDeps {
  /**
   * Push-toast callback. Wired by `<AttachmentsSection />` so
   * the page-scoped toast queue owns the surface (mirrors
   * `useMarkAsRead.ts:94-95`'s pattern).
   *
   * `skipToastFor403` defaults to `false` (the section pushes
   * the toast for cross-row RBAC denials). Set to `true` for
   * the test rig's 403 pin if the test wants to assert the
   * invalidation without the toast surface — but the section
   * always invalidates the cache on 403 regardless of the
   * toast flag.
   */
  readonly onError: (message: string) => void;
}

/**
 * `useDeleteAttachment` — TanStack `useMutation` for the
 * per-row delete button on `<AttachmentList />`. On success:
 * invalidates the attachments list query so the next refetch
 * drops the deleted row.
 *
 * On 403: invalidates the list query (a cross-row RBAC denial
 * may indicate a stale cache; the refetch reconciles).
 *
 * On 404: invalidates the list query too (the row vanished —
 * the refetch drops it from the dropdown).
 *
 * On 5xx / 401 / network: no invalidation (the row is presumed
 * unchanged; the operator may retry).
 */
export const useDeleteAttachment = (incidentId: string, deps: UseDeleteAttachmentDeps) => {
  const queryClient = useQueryClient();
  const cacheKey = ATTACHMENTS_QUERY_KEY(incidentId);
  return useMutation<void, DeleteAttachmentMutationError, string>({
    mutationFn: async (id: string): Promise<void> => {
      try {
        const res = await apiFetch(`/api/attachments/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          throw classifyDeleteError(res.status);
        }
      } catch (err) {
        if (err instanceof DeleteAttachmentMutationError) {
          throw err;
        }
        throw classifyDeleteError(HTTP_NETWORK_THROW);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
    },
    onError: (err) => {
      // 403 / 404: invalidate the list query so the next refetch
      // reconciles the cache (drops cross-role or vanished rows).
      if (err.status === HTTP_FORBIDDEN || err.status === HTTP_NOT_FOUND) {
        void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
      }
      deps.onError(err.message);
    },
  });
};
