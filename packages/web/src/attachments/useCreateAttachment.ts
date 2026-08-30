/**
 * `useCreateAttachment` — Story 4.13.
 *
 * TanStack `useMutation` over
 * `POST /api/incidents/:incidentId/attachments`. On success:
 * invalidates the attachments list query
 * (`["incidents", "detail", incidentId, "attachments"]`) so the
 * `<AttachmentList />` refetches and the new row appears.
 *
 * The mutation does NOT mutate the cache directly (no optimistic
 * insert) — the spec's `HAPPY_PATH_*` rows pin "On success, the
 * detail page refetches" as the success contract. A failed POST
 * that returned a 201-shaped response and then crashed the
 * client would leave a phantom row if we mutated optimistically;
 * the invalidation + refetch flow keeps the server's verdict as
 * the source of truth (mirrors `useMarkAsRead.ts:140-141`'s
 * invalidate-on-success pattern from 4.10).
 *
 * 4xx classification:
 *   - 400 (`invalid_payload`) → "Invalid URL or payload" toast
 *     (covers the URL scheme rejection + label length + mime
 *     regex — the api's `validateHttpUrl` + Zod body schema
 *     produce the same envelope shape).
 *   - 403 → "Not authorized" toast (Viewer attempting create;
 *     matrix `create.Attachment = N`).
 *   - 401 → "Session expired" toast (5xx-class UX).
 *
 * 5xx classification: any other status → "Failed to add
 * attachment. Try again." (retryable).
 *
 * Network throws → classified as status 0 (5xx-class UX).
 *
 * The mutation returns the new `AttachmentPayload` on success so
 * the form can `reset()` after the server acks.
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { ATTACHMENTS_QUERY_KEY } from "./useAttachments";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;

/** Network-throw sentinel (mirrors `useMarkAsRead.ts:46`). */
const HTTP_NETWORK_THROW = 0;

/** 4xx range bounds (mirrors `useMarkAsRead.ts:49-50`). */
const HTTP_4XX_MIN = 400;
const HTTP_4XX_MAX = 500;

export interface CreateAttachmentInput {
  readonly url: string;
  readonly label?: string;
  readonly mime?: string;
}

/**
 * Tagged error class for the create mutation. Mirrors
 * `MarkAsReadMutationError`'s shape so the consumer's error
 * handling is uniform across mutations. The `.message` is the
 * operator-facing toast copy; the `.status` is preserved so the
 * form can branch on the failure mode.
 */
export class CreateAttachmentMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "CreateAttachmentMutationError";
    this.status = status;
  }
}

/**
 * Classify the api's failure response into the operator-facing
 * copy. Mirrors `useMarkAsRead.ts:73-84` with copy tailored to
 * the create-attachment surface. The 400 branch lumps the URL
 * scheme rejection, label length, and mime regex into one toast
 * — the api's body `issues` array is the source of truth for the
 * granular reason; the toast is the operator's quick read.
 */
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
  /**
   * Push-toast callback. Wired by `<AttachmentsSection />` so
   * the page-scoped toast queue owns the surface (mirrors
   * `useMarkAsRead.ts:94-95`'s pattern). The mutation itself
   * does NOT push toasts; the section wires `pushToast` from its
   * `useToasts()` so the toast lives on the section's lifetime.
   */
  readonly onError: (message: string) => void;
}

/**
 * `useCreateAttachment` — TanStack `useMutation` for the
 * "Add attachment" form. On success: invalidates the attachments
 * list query so the next refetch includes the new row.
 *
 * On 4xx failure: the section surfaces the classified toast; the
 * mutation does NOT invalidate (the row wasn't created, the list
 * is unchanged).
 *
 * On 5xx / 401 / network: no invalidation; the operator may
 * retry. The toast copy classifies the failure for the operator.
 */
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

// Keep the 4xx range constants referenced so a future reader sees
// the explicit bounds — the `max-lines-per-function` lint rule
// doesn't trip on unused module-level constants, but a future
// refactor that drops the classify helper's 5xx branch would
// re-introduce the boundary at the call site. Reference kept for
// grep discoverability.
void [HTTP_4XX_MIN, HTTP_4XX_MAX];
