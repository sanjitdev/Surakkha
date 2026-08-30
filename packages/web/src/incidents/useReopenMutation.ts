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
 *   - 400 `validation_error`           → first server issues[].message
 *                                       (e.g. "String must contain at least 10 character(s)")
 *                                       or a generic fallback if the body is unparseable.
 *   - 409 `invalid_state_transition`  → "Cannot reopen — incident is not RESOLVED"
 *   - 403                              → "Not authorized"
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
const HTTP_BAD_REQUEST = 400;
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

/**
 * Fallback copy for a 400 `validation_error` envelope whose body
 * is missing or unparseable. The server's Zod issues array is the
 * preferred source — it surfaces the exact constraint violation
 * (min-length, max-length, missing field, extra field, wrong type)
 * so the operator can fix the input without guessing.
 */
const VALIDATION_FALLBACK = "Reason invalid — please review and resubmit";

/**
 * Extract the first human-readable message from the server's Zod
 * issues array. The shape mirrors the backend's error envelope
 * (`{ error: "validation_error", issues: [{ message, path }] }`).
 *
 * Returns `null` when the body is unparseable or has no
 * `issues[]` array — the caller falls back to a generic copy.
 */
const firstIssueMessage = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) return null;
  const { issues } = body as { issues?: unknown };
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const first = issues[0];
  if (typeof first !== "object" || first === null) return null;
  const { message } = first as { message?: unknown };
  return typeof message === "string" && message.length > 0 ? message : null;
};

/**
 * Classify a non-OK response into a `ReopenMutationError`. Reads
 * the response body (cloned — the original body is left for any
 * subsequent reader) so 400 `validation_error` responses surface
 * the first Zod issue's message verbatim. The mutationFn clones
 * the response BEFORE this classifier runs so the body's stream
 * is preserved.
 *
 * Network errors (status 0) fall through to the 5xx path.
 */
export const classifyReopenError = async (res: Response): Promise<ReopenMutationError> => {
  const { status } = res;
  // Try to surface the server's Zod issues list for 400. The
  // `clone()` keeps the original body intact for any other reader.
  if (status === HTTP_BAD_REQUEST) {
    let body: unknown = null;
    try {
      body = await res.clone().json();
    } catch {
      body = null;
    }
    const message = firstIssueMessage(body) ?? VALIDATION_FALLBACK;
    return new ReopenMutationError(status, message);
  }
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
          throw await classifyReopenError(res);
        }
      } catch (err) {
        if (err instanceof ReopenMutationError) throw err;
        // Network / parse failure — synthesize a `Response`-shaped
        // carrier so the same classifier can produce the toast copy.
        throw await classifyReopenError(new Response(null, { status: HTTP_NETWORK_THROW }));
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
