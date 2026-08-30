/**
 * `useAttachments` — Story 4.13.
 *
 * TanStack `useQuery` over
 * `GET /api/incidents/:incidentId/attachments`. Cache key:
 * `["incidents", "detail", incidentId, "attachments"]` — the
 * detail-page namespace (same key the row + timeline queries use
 * as their prefix; the `"attachments"` suffix keeps this query
 * isolated from the other detail-page caches).
 *
 * Returns `{ attachments, isLoading, isError, query }`. The hook
 * is the read-only projection; the consumer is `<AttachmentList />`
 * which calls this hook internally.
 *
 * The hook is gated on `incidentId !== ""` so an empty id (the
 * detail page before `useParams` resolves, or a programmatic
 * re-mount with no id) doesn't fire a malformed URL request. The
 * disabled state surfaces `attachments: []` and `isLoading: false`
 * so consumers can branch on `attachments.length` without
 * checking the id explicitly.
 *
 * Tech-ownership RBAC fires server-side; on 403 the response is
 * the standard `forbidden` envelope and TanStack Query surfaces
 * the error. The hook does NOT translate the 403 to a separate
 * tagged error class — the parent `<AttachmentsSection />` reads
 * `query.error` directly and renders an inline "No access" copy
 * that matches the spec's `LIST_403_OTHER_INCIDENT` row.
 */
import { type AttachmentListEnvelope, type AttachmentPayload } from "@surakkha/shared/attachment";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

/**
 * TanStack Query key for the per-incident attachments list. The
 * `"incidents"` + `"detail"` + `id` prefix matches the detail
 * page's existing keys so a future socket-driven invalidation
 * can target the entire detail namespace in one `invalidateQueries`
 * call. The `"attachments"` suffix isolates this query from the
 * row + timeline caches.
 *
 * Re-exported as `ATTACHMENTS_QUERY_KEY` so test rigs can pin
 * cache identity (mirrors `UNREAD_NOTIFICATIONS_QUERY_KEY` in
 * `useNotificationBell.ts:57`).
 */
export const ATTACHMENTS_QUERY_KEY = (incidentId: string): readonly unknown[] =>
  ["incidents", "detail", incidentId, "attachments"] as const;

/** HTTP status code sentinel — RBAC denial (Tech ownership). */
const HTTP_FORBIDDEN = 403;

/**
 * `useAttachments` — TanStack `useQuery` over
 * `/api/incidents/:id/attachments`.
 *
 * The hook fires only when `incidentId !== ""` (a non-empty id
 * means the parent page mounted with a valid `:id` URL param).
 * On `incidentId === ""` the hook stays disabled and returns an
 * empty attachments list — the consumer renders the empty state
 * without checking the id.
 *
 * The hook does NOT classify 403 as a separate tagged error
 * class — the api's `forbidden` envelope is the source of truth
 * and the consumer branches on `query.error` directly. This
 * matches the spec's `LIST_403_OTHER_INCIDENT` matrix row: the
 * section renders an inline "Not authorized" copy.
 */
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

  // Project the envelope into a flat attachments array. The
  // empty-state branch falls through to `[]` when the id is
  // empty OR the query is loading OR the query errored — the
  // consumer branches on `query.isError` separately so it can
  // distinguish "loading" from "forbidden" from "empty".
  const attachments: readonly AttachmentPayload[] = enabled ? (query.data?.attachments ?? []) : [];

  return { attachments, query };
};
