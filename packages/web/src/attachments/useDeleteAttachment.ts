/**
 * TanStack `useMutation` over `DELETE /api/attachments/:id`. On
 * success invalidates the attachments list query so the next refetch
 * drops the deleted row.
 *
 * 4xx classification maps to operator-facing toast copy:
 *   403 → "Not authorized" (cross-row RBAC denial)
 *   404 → "Attachment not found"
 *   401 → "Session expired"
 * Anything else is "Failed to delete attachment. Try again."
 * Network throws classify as status 0.
 *
 * On 403 / 404 the list query is invalidated too — the row may have
 * been a stale cache entry (another tab deleted it); the refetch
 * reconciles. 5xx / 401 / network leave the cache untouched.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { ATTACHMENTS_QUERY_KEY } from "./useAttachments";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/** Network-throw sentinel (no `Response` was returned). */
const HTTP_NETWORK_THROW = 0;

export class DeleteAttachmentMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "DeleteAttachmentMutationError";
    this.status = status;
  }
}

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
  readonly onError: (message: string) => void;
}

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
      if (err.status === HTTP_FORBIDDEN || err.status === HTTP_NOT_FOUND) {
        void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
      }
      deps.onError(err.message);
    },
  });
};
