/**
 * `useAcknowledgeMutation` — Story 4.5.
 *
 * TanStack `useMutation` over `POST /api/incidents/:id/acknowledge`.
 * Wraps `apiFetch` from `../api/apiClient` (handles Bearer auth +
 * 401 refresh + offline state). On success: invalidates the detail
 * row's TanStack Query cache (`["incidents", "detail", id]`) so the
 * existing `useIncidentDetailSocket` subscriber's next socket event
 * — or a re-fetch — reconciles state.
 *
 * 4xx classification (the spec's "tagged" vs "retryable" toast lanes):
 *
 *   - 409 `invalid_state_transition`  → "Already acknowledged"
 *   - 403                              → "Not authorized"
 *   - 404                              → "Incident not found"
 *
 * 5xx classification (retryable toast):
 *
 *   - any other status code            → "Failed to acknowledge. Try again."
 *
 * The error object is a `AcknowledgeMutationError` whose `.message` is
 * the toast copy; the detail page calls `pushToast("error", err.message)`
 * in its `onError` handler. The mutation does NOT push toasts itself —
 * the page wires `pushToast` so the page-scoped toast queue owns the
 * surface (mirrors ThresholdsPage).
 *
 * Why no optimistic UI: the spec is explicit ("No optimistic UI for the
 * mutation. Server is authoritative; the cache mutation IS the
 * optimistic surface via the existing `incident:state_changed`
 * subscription"). The mutation handler invalidates the row query; the
 * socket event drives the actual cache mutation; both update from the
 * same source of truth.
 *
 * Why no extraction as a generic hook: 4.5 is the only consumer today;
 * Stories 4.6 (assign), 4.7 (submit-result), 4.11 (reopen) each ship
 * their own one-shot mutation. A future post-Epic-4 sweep can refactor
 * to a `useIncidentMutation({ verb })` factory once the pattern is
 * stable across three stories.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { incidentDetailQueryKey } from "./useIncidentDetailSocket";

/**
 * HTTP status sentinels. Mirror the
 * `IncidentDetailRbacDeniedError` / `IncidentDetailNotFoundError`
 * constants at `IncidentDetailPage.tsx:60-61` so the mutation
 * classifies failures identically to the read path.
 */
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/**
 * 4xx range bounds used to decide whether a failed mutation
 * should invalidate the row query (4xx → server told us truth
 * about the row; 5xx → server is broken, leave the row alone so
 * the operator can retry).
 */
const HTTP_4XX_MIN = 400;
const HTTP_4XX_MAX = 500;

/**
 * Tagged error class for the mutation. The `.message` is the
 * operator-facing toast copy (already classified for tone), and
 * the `.status` is preserved so the page can route 404 / 403 to
 * the right re-render branch (NotFound / RbacDenied) when the row
 * cache invalidates and returns the next fetch's verdict.
 */
export class AcknowledgeMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "AcknowledgeMutationError";
    this.status = status;
  }
}

/**
 * Classify the api's failure response into the operator-facing copy.
 * 409 / 403 / 404 get pinned copy (server-rejected). All other 4xx +
 * 5xx collapse to the retryable line so the operator sees one
 * consistent prompt for unknown failures.
 */
const classifyAcknowledgeError = (status: number): AcknowledgeMutationError => {
  if (status === HTTP_CONFLICT) {
    return new AcknowledgeMutationError(status, "Already acknowledged");
  }
  if (status === HTTP_FORBIDDEN) {
    return new AcknowledgeMutationError(status, "Not authorized");
  }
  if (status === HTTP_NOT_FOUND) {
    return new AcknowledgeMutationError(status, "Incident not found");
  }
  return new AcknowledgeMutationError(status, "Failed to acknowledge. Try again.");
};

/**
 * `useAcknowledgeMutation` — TanStack `useMutation` for the
 * Acknowledge button.
 *
 * Returns `{ mutate, isPending, error, ... }` (the standard TanStack
 * shape). The page wires `onSuccess` to `pushToast("success", "Acknowledged")`
 * and `onError` to `pushToast("error", err.message)`; both calls flow
 * into the page-scoped toast queue.
 *
 * On success the row query at `["incidents", "detail", id]` is
 * invalidated so the next refetch + the existing
 * `useIncidentDetailSocket` subscriber converge on the new state.
 * The mutation itself does NOT touch the cache directly — that would
 * create an optimistic UI path the spec explicitly forbids.
 *
 * On 4xx failure (4xx-classified `AcknowledgeMutationError`) we
 * ALSO invalidate the row query: a 409 means another operator
 * acknowledged between page load and click (the row is now in a
 * non-OPEN state — re-fetch tells the truth); a 404 means the
 * row was deleted (re-fetch surfaces `<NotFound />`); a 403 means
 * a token/role drift (re-fetch surfaces `<RbacDenied />`).
 */
export const useAcknowledgeMutation = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation<void, AcknowledgeMutationError, void>({
    mutationFn: async (): Promise<void> => {
      const res = await apiFetch(`/api/incidents/${id}/acknowledge`, {
        method: "POST",
      });
      if (!res.ok) {
        throw classifyAcknowledgeError(res.status);
      }
      // The api returns 200 with a refreshed `IncidentPayload`; we
      // do NOT parse it here — the page's row query invalidation
      // is the source of truth for the next read, and the socket
      // event drives the cache mutation.
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentDetailQueryKey(id) });
    },
    // 4xx failures all invalidate the cache so the next fetch can
    // update the read-side surface (NotFound / RbacDenied / row
    // shows ACKNOWLEDGED for 409). We deliberately do NOT
    // invalidate on 5xx — the row is presumed unchanged and the
    // operator may retry against the same id.
    onError: (err) => {
      if (err.status >= HTTP_4XX_MIN && err.status < HTTP_4XX_MAX) {
        void queryClient.invalidateQueries({ queryKey: incidentDetailQueryKey(id) });
      }
    },
  });
};
