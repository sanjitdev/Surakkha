/**
 * `useReopenMutation` — Story 4.11.
 *
 * TanStack `useMutation` over `POST /api/incidents/:id/reopen`.
 * Mirrors `useAcknowledgeMutation`'s shape (1:1 per-verb
 * classification, page-scoped toast surface). The reopen verb
 * carries a body payload `{ reason: string }` (validated
 * server-side for ≥ 10 chars); the mutation forwards it
 * verbatim.
 *
 * 4xx classification:
 *
 *   - 409 `invalid_state_transition`  → "Cannot reopen — incident is not RESOLVED"
 *   - 403                              → "Not authorized"
 *   - 400 `validation_error`           → "Reason must be at least 10 characters" (and the
 *                                       server's issues list, if available)
 *   - 404                              → "Incident not found"
 *   - 401 (token refresh failed)       → "Session expired — please sign in again"
 *
 * 5xx classification:
 *
 *   - any other status code            → "Failed to reopen. Try again."
 *
 * On success the row query at `["incidents", "detail", id]` is
 * invalidated so the next refetch + the existing
 * `useIncidentDetailSocket` subscriber reconcile on the new
 * `state: "OPEN"`, `severity: "critical"` row. The cache mutation
 * is the source of truth; no optimistic UI per the spec.
 *
 * Why no extraction as a generic hook: 4.5/4.6/4.7 each ship
 * their own one-shot mutation; the classify-on-status surface
 * differs per verb (acknowledge has 409 = "Already acknowledged";
 * reopen has 409 = "Cannot reopen — not RESOLVED"; assign has
 * 400 = "Invalid assignee"). A future post-Epic-4 sweep can
 * refactor to a `useIncidentMutation({ verb, classify })`
 * factory once the per-verb classifiers converge.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { incidentDetailQueryKey } from "./useIncidentDetailSocket";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

const HTTP_NETWORK_THROW = 0;

const HTTP_4XX_MIN = 400;
const HTTP_4XX_MAX = 500;

/**
 * Tagged error class for the mutation. Mirrors the Acknowledge /
 * Assign / SubmitResult shape so the page's `onError` handler
 * routes 403 / 404 / 409 to the same re-render branch.
 */
export class ReopenMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "ReopenMutationError";
    this.status = status;
  }
}

const classifyReopenError = (status: number): ReopenMutationError => {
  if (status === HTTP_CONFLICT) {
    return new ReopenMutationError(status, "Cannot reopen — incident is not RESOLVED");
  }
  if (status === HTTP_FORBIDDEN) {
    return new ReopenMutationError(status, "Not authorized");
  }
  if (status === HTTP_NOT_FOUND) {
    return new ReopenMutationError(status, "Incident not found");
  }
  if (status === HTTP_UNAUTHORIZED) {
    return new ReopenMutationError(status, "Session expired — please sign in again");
  }
  return new ReopenMutationError(status, "Failed to reopen. Try again.");
};

export const useReopenMutation = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation<void, ReopenMutationError, { reason: string }>({
    mutationFn: async ({ reason }): Promise<void> => {
      try {
        const res = await apiFetch(`/api/incidents/${id}/reopen`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
          throw classifyReopenError(res.status);
        }
      } catch (err) {
        if (err instanceof ReopenMutationError) throw err;
        throw classifyReopenError(HTTP_NETWORK_THROW);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentDetailQueryKey(id) });
    },
    onError: (err) => {
      if (
        err.status >= HTTP_4XX_MIN &&
        err.status < HTTP_4XX_MAX &&
        err.status !== HTTP_UNAUTHORIZED
      ) {
        void queryClient.invalidateQueries({ queryKey: incidentDetailQueryKey(id) });
      }
    },
  });
};
