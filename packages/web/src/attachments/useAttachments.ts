/**
 * TanStack `useQuery` over `GET /api/incidents/:incidentId/attachments`.
 * The cache key (`["incidents", "detail", incidentId, "attachments"]`)
 * lets a future socket-driven invalidation target the entire detail
 * namespace in one call; the `"attachments"` suffix isolates this
 * query from the row + timeline caches.
 *
 * Disables on `incidentId === ""` so the detail page before
 * `useParams` resolves (or a programmatic re-mount with no id)
 * doesn't fire a malformed URL request. The hook does NOT translate
 * 403 to a tagged error class — the api's `forbidden` envelope is the
 * source of truth and `<AttachmentsSection />` branches on
 * `query.error.message === "forbidden"` to render the inline
 * "Not authorized" copy.
 */
import { type AttachmentListEnvelope, type AttachmentPayload } from "@surakkha/shared/attachment";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

export const ATTACHMENTS_QUERY_KEY = (incidentId: string): readonly unknown[] =>
  ["incidents", "detail", incidentId, "attachments"] as const;

const HTTP_FORBIDDEN = 403;

export const useAttachments = (incidentId: string) => {
  const enabled = incidentId !== "";
  const query = useQuery<AttachmentListEnvelope, Error>({
    queryKey: [...ATTACHMENTS_QUERY_KEY(incidentId)],
    enabled,
    queryFn: async (): Promise<AttachmentListEnvelope> => {
      const res = await apiFetch(`/api/incidents/${incidentId}/attachments`);
      if (res.status === HTTP_FORBIDDEN) {
        throw new Error("forbidden");
      }
      if (!res.ok) {
        throw new Error(`/api/incidents/${incidentId}/attachments failed: ${res.status}`);
      }
      const body = (await res.json()) as AttachmentListEnvelope;
      return body;
    },
  });

  const attachments: readonly AttachmentPayload[] = enabled ? (query.data?.attachments ?? []) : [];

  return { attachments, query };
};
