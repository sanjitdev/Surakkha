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
 * Idempotency-Key (api critique P1 #2): the request carries an
 * `Idempotency-Key: <UUIDv4>` header generated via
 * `newIdempotencyKey()` at the start of `mutationFn`. The api's
 * `Idempotency-Key` middleware
 * (`packages/api/src/middleware/idempotency.ts`) replays the cached
 * response byte-for-byte when the same `(user_id, route, key)` tuple
 * lands twice within 5 minutes — closing the persona-blocking
 * double-tap surface on a flaky uplink.
 *
 * 4xx classification:
 *
 *   - 400 `validation_error`           → first server issues[].message
 *                                       (e.g. "String must contain at least 10 character(s)")
 *                                       or a generic fallback if the body is unparseable.
 *   - 409 `invalid_state_transition`  → discriminated via the
 *                                       canonical envelope in
 *                                       `./transitionEnvelope`:
 *                                       "Cannot reopen a {state}
 *                                       incident" for a typed
 *                                       state-machine miss,
 *                                       "Modified by another
 *                                       operator — refresh and
 *                                       retry" for
 *                                       `concurrent_modification`,
 *                                       or the per-verb fallback
 *                                       "Cannot reopen — incident
 *                                       is not RESOLVED" if
 *                                       neither structured field
 *                                       is present.
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
import { newIdempotencyKey } from "../api/idempotencyKey";

import {
  invalidTransitionMessage,
  parseTransitionEnvelope,
  type TransitionVerb,
} from "./transitionEnvelope";
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
 * Verb name passed to `invalidTransitionMessage` for the
 * reopen-verb branch. Snake_case because the api emits
 * `attempted: "reopen"` (the schema validates against
 * `ActionVerbSchema` at `packages/shared/src/incident.ts`).
 */
const VERB: TransitionVerb = "reopen";

/**
 * Fallback copy for a 409 envelope whose body is missing the
 * `{ from, attempted }` fields (a future schema bump or a buggy
 * proxy). Mirrors the previous hardcoded copy so existing user
 * expectations don't regress.
 */
const REOPEN_FALLBACK = "Cannot reopen — incident is not RESOLVED";

/**
 * Classify a non-OK response into a `ReopenMutationError`. Reads
 * the response body (cloned — the original body is left for any
 * subsequent reader) so:
 *
 *   - 400 `validation_error` responses surface the first Zod
 *     issue's message verbatim.
 *   - 409 `invalid_state_transition` responses discriminate the
 *     reason via the canonical envelope in `./transitionEnvelope`
 *     — typed state-machine miss (named state) vs
 *     `concurrent_modification` vs per-verb fallback.
 *
 * The `clone()` keeps the original body intact for any other
 * reader.
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
    let envelope: ReturnType<typeof parseTransitionEnvelope> = null;
    try {
      envelope = parseTransitionEnvelope(await res.clone().json());
    } catch {
      envelope = null;
    }
    const message = envelope !== null ? invalidTransitionMessage(VERB, envelope) : REOPEN_FALLBACK;
    return new ReopenMutationError(status, message);
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
      // Fresh UUIDv4 per `mutationFn` invocation. The api's
      // idempotency middleware deduplicates the same
      // `(user_id, route, key)` tuple within the 5-minute TTL
      // window — so a single double-send from the same network
      // handler replays the cached first response. Two separate
      // `mutate()` clicks produce distinct UUIDs and pass through;
      // the `disabled={isPending}` prop on the button is what
      // protects against that path.
      const idempotencyKey = newIdempotencyKey();
      try {
        const res = await apiFetch(`/api/incidents/${id}/reopen`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
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
