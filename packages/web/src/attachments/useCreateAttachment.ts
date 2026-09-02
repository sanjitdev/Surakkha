/**
 * TanStack `useMutation` over `POST /api/incidents/:incidentId/attachments`.
 * On success invalidates the attachments list query so the next
 * refetch surfaces the new row. No optimistic insert — the server's
 * verdict is the source of truth.
 *
 * 4xx classification maps to operator-facing toast copy:
 *   400 → "Invalid URL or payload" (URL scheme + label + mime)
 *   403 → "Not authorized"
 *   401 → "Session expired"
 * Anything else is "Failed to add attachment. Try again."
 * Network throws classify as status 0.
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { ATTACHMENTS_QUERY_KEY } from "./useAttachments";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;

/** Network-throw sentinel (no `Response` was returned). */
const HTTP_NETWORK_THROW = 0;

export interface CreateAttachmentInput {
  readonly url: string;
  readonly label?: string;
  readonly mime?: string;
}

export class CreateAttachmentMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "CreateAttachmentMutationError";
    this.status = status;
  }
}

const classifyCreateError = (status: number): CreateAttachmentMutationError => {
  if (status === HTTP_BAD_REQUEST) {
    return new CreateAttachmentMutationError(status, "Invalid URL or payload");
  }
  if (status === HTTP_FORBIDDEN) {
    return new CreateAttachmentMutationError(status, "Not authorized");
  }
  if (status === HTTP_UNAUTHORIZED) {
    return new CreateAttachmentMutationError(status, "Session expired — please sign in again");
  }
  return new CreateAttachmentMutationError(status, "Failed to add attachment. Try again.");
};

export interface UseCreateAttachmentDeps {
  /** Push-toast callback. Wired by `<AttachmentsSection />` so the
   *  page-scoped toast queue owns the surface. */
  readonly onError: (message: string) => void;
}

export const useCreateAttachment = (incidentId: string, deps: UseCreateAttachmentDeps) => {
  const queryClient = useQueryClient();
  const cacheKey = ATTACHMENTS_QUERY_KEY(incidentId);
  return useMutation<AttachmentPayload, CreateAttachmentMutationError, CreateAttachmentInput>({
    mutationFn: async (input): Promise<AttachmentPayload> => {
      try {
        const res = await apiFetch(`/api/incidents/${incidentId}/attachments`, {
          method: "POST",
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          throw classifyCreateError(res.status);
        }
        const body = (await res.json()) as AttachmentPayload;
        return body;
      } catch (err) {
        if (err instanceof CreateAttachmentMutationError) {
          throw err;
        }
        throw classifyCreateError(HTTP_NETWORK_THROW);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cacheKey] });
    },
    onError: (err) => {
      deps.onError(err.message);
    },
  });
};
