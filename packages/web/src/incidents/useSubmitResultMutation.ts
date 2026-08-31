/**
 * `useSubmitResultMutation` — Story 4.7.
 *
 * TanStack `useMutation` over `POST /api/incidents/:id/submit-result`.
 * The request body carries `{ outcome: "SAFE" | "UNSAFE" | "MONITORING" }`
 * (uppercase enum per `InspectionOutcomeSchema` at
 * `packages/shared/src/incident.ts:65-67` — also matches the radio
 * values rendered by `<SubmitResultForm />`). Wraps `apiFetch` from
 * `../api/apiClient` (handles Bearer auth + 401 refresh + offline
 * state). On success: invalidates the detail row's TanStack Query
 * cache (`["incidents", "detail", id]`) so the existing
 * `useIncidentDetailSocket` subscriber's next socket event — or a
 * re-fetch — reconciles state.
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
 * 4xx classification (the spec's "tagged" vs "retryable" toast lanes),
 * mirroring `useAssignMutation.ts` line-for-line with the verb-
 * specific copy swapped:
 *
 *   - 409 `invalid_state_transition`  → discriminated via the
 *                                       canonical envelope in
 *                                       `./transitionEnvelope`:
 *                                       "Cannot submit a result
 *                                       for a {state} incident"
 *                                       for a typed state-machine
 *                                       miss, "Modified by another
 *                                       operator — refresh and
 *                                       retry" for
 *                                       `concurrent_modification`,
 *                                       or the per-verb fallback
 *                                       "Already submitted" if
 *                                       neither structured field is
 *                                       present.
 *   - 400 (Zod body validation)        → "Invalid request"
 *   - 403                              → "Not authorized"
 *   - 404                              → "Incident not found"
 *   - 401 (token refresh failed)       → "Session expired — please sign
 *                                       in again"  (5xx-class: the row
 *                                       is presumed unchanged and the
 *                                       Technician must re-auth before
 *                                       any retry can succeed; the 4xx
 *                                       row-invalidation branch does
 *                                       NOT cover 401)
 *
 * 5xx classification (retryable toast):
 *
 *   - any other status code            → "Failed to submit result.
 *                                       Try again."
 *
 * Network throws (offline / abort / DNS failure) are caught by the
 * `mutationFn` try/catch and classified as `status: 0` so the
 * `onError` status-range check never reads `undefined`. The 0
 * sentinel is below the `HTTP_4XX_MIN` floor and falls into the
 * "do not invalidate" branch (5xx-class UX; the row is presumed
 * unchanged and the Technician may retry).
 *
 * The error object is a `SubmitResultMutationError` whose `.message`
 * is the toast copy; the detail page calls `pushToast("error",
 * err.message)` in its `onError` handler. The mutation does NOT push
 * toasts itself — the page wires `pushToast` so the page-scoped
 * toast queue owns the surface (mirrors ThresholdsPage).
 *
 * Why no optimistic UI: the spec is explicit (mirrors 4.5 + 4.6).
 * The mutation handler invalidates the row query; the socket event
 * drives the actual cache mutation; both update from the same source
 * of truth.
 *
 * Why no extraction as a generic hook: 4.7 is the third consumer
 * today (4.5 + 4.6 already have their own one-shot mutations); the
 * factory extraction is a future post-Epic-4 sweep.
 */
import { type InspectionOutcome } from "@surakkha/shared/incident";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";
import { newIdempotencyKey } from "../api/idempotencyKey";

import {
  invalidTransitionMessage,
  parseTransitionEnvelope,
  type TransitionVerb,
} from "./transitionEnvelope";
import { incidentDetailQueryKey } from "./useIncidentDetailSocket";

/**
 * HTTP status sentinels. Mirror the
 * `IncidentDetailRbacDeniedError` / `IncidentDetailNotFoundError`
 * constants at `IncidentDetailPage.tsx:60-61` so the mutation
 * classifies failures identically to the read path. 400 (Bad
 * Request) is added because the submit-result endpoint validates
 * the request body via Zod and returns 400 on schema failure
 * (defense in depth — the client should not produce this).
 */
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/**
 * Network-throw sentinel. `apiFetch` throws a bare `Error` (no
 * `.status`) on connection failures / aborts / DNS errors. The
 * `mutationFn` try/catch rethrows as `SubmitResultMutationError`
 * with this status so `onError`'s range check stays valid.
 */
const HTTP_NETWORK_THROW = 0;

/**
 * 4xx range bounds used to decide whether a failed mutation should
 * invalidate the row query (4xx → server told us truth about the row;
 * 5xx → server is broken, leave the row alone so the Technician can
 * retry).
 *
 * 401 is classified separately and explicitly EXCLUDED from the
 * row-invalidation branch — see `onError` below. A 401 means the
 * refresh token is exhausted and the Technician must re-auth before
 * any retry can succeed; the row is presumed unchanged.
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
export class SubmitResultMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "SubmitResultMutationError";
    this.status = status;
  }
}

/**
 * Verb name passed to `invalidTransitionMessage` for the
 * submit-result-verb branch. Snake_case because the api emits
 * `attempted: "submit_result"` (the schema validates against
 * `ActionVerbSchema` at `packages/shared/src/incident.ts`).
 */
const VERB: TransitionVerb = "submit_result";

/**
 * Classify the api's failure response into the operator-facing copy.
 * 400 / 401 / 409 / 403 / 404 get pinned copy (server-rejected). 401
 * is its own branch because the toast must reflect "session expired"
 * (a retry without re-auth can never succeed) instead of the generic
 * retryable line. All other 4xx + 5xx collapse to the retryable line
 * so the Technician sees one consistent prompt for unknown failures.
 *
 * 409 is async because we have to read the response body (cloned)
 * to feed `parseTransitionEnvelope` — the discriminator needs the
 * `{ from, attempted, reason }` fields to name the actual reason
 * (typed state-machine miss vs concurrent-modification race).
 */
const classifySubmitResultError = async (res: Response): Promise<SubmitResultMutationError> => {
  if (res.status === HTTP_CONFLICT) {
    let envelope: ReturnType<typeof parseTransitionEnvelope> = null;
    try {
      envelope = parseTransitionEnvelope(await res.clone().json());
    } catch {
      envelope = null;
    }
    const message =
      envelope !== null ? invalidTransitionMessage(VERB, envelope) : "Already submitted";
    return new SubmitResultMutationError(res.status, message);
  }
  if (res.status === HTTP_BAD_REQUEST) {
    return new SubmitResultMutationError(res.status, "Invalid request");
  }
  if (res.status === HTTP_FORBIDDEN) {
    return new SubmitResultMutationError(res.status, "Not authorized");
  }
  if (res.status === HTTP_NOT_FOUND) {
    return new SubmitResultMutationError(res.status, "Incident not found");
  }
  if (res.status === HTTP_UNAUTHORIZED) {
    // 5xx-class UX: the row is presumed unchanged; the Technician must
    // re-auth before any retry can succeed. The 4xx row-invalidation
    // branch in `onError` explicitly excludes 401.
    return new SubmitResultMutationError(res.status, "Session expired — please sign in again");
  }
  return new SubmitResultMutationError(res.status, "Failed to submit result. Try again.");
};

/**
 * `useSubmitResultMutation` — TanStack `useMutation` for the Submit
 * Result button.
 *
 * Returns `{ mutate, isPending, error, ... }` (the standard TanStack
 * shape). The page wires `onSuccess` to `pushToast("success", "Result submitted")`
 * and `onError` to `pushToast("error", err.message)`; both calls flow
 * into the page-scoped toast queue.
 *
 * The mutation accepts a `variables` argument of
 * `{ outcome: InspectionOutcome }` (uppercase enum, passed straight
 * from the radio's `value` attribute into the wire body — no
 * casing swap because the wire shape is already uppercase).
 *
 * On success the row query at `["incidents", "detail", id]` is
 * invalidated so the next refetch + the existing
 * `useIncidentDetailSocket` subscriber converge on the new state.
 * The mutation itself does NOT touch the cache directly — that
 * would create an optimistic UI path the spec explicitly forbids.
 *
 * On 4xx failure (4xx-classified `SubmitResultMutationError`) we
 * ALSO invalidate the row query: a 409 means another path advanced
 * the row between page load and click (the row is now in a non-
 * INSPECTING state — re-fetch tells the truth); a 404 means the
 * row was deleted (re-fetch surfaces `<NotFound />`); a 403 means
 * a token/role drift (re-fetch surfaces `<RbacDenied />`); a 400
 * means the request body was malformed (re-fetch surfaces the
 * unchanged row).
 *
 * 401 is 5xx-class: `apiFetch`'s internal refresh has already
 * failed, the Technician is effectively signed out, and re-trying
 * the call will never succeed until re-auth. We deliberately do
 * NOT invalidate the row query for 401 (a re-fetch against the
 * same expired token would 401 too and surface a second toast).
 * The `onError` status-range check explicitly excludes 401.
 *
 * Network throws (offline / abort / DNS) are caught inside
 * `mutationFn` and rethrown as `SubmitResultMutationError` with
 * `status: 0` so `onError`'s `err.status >= HTTP_4XX_MIN` check
 * never reads `undefined`. Status 0 falls into the "do not
 * invalidate" branch (5xx-class UX; the Technician may retry).
 */
export const useSubmitResultMutation = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation<void, SubmitResultMutationError, { outcome: InspectionOutcome }>({
    mutationFn: async ({ outcome }): Promise<void> => {
      // Fresh UUIDv4 per `mutationFn` invocation. The api's
      // idempotency middleware deduplicates the same
      // `(user_id, route, key)` tuple within the 5-minute TTL
      // window — so a single double-send from the same network
      // handler replays the cached first response. Two separate
      // `mutate()` clicks produce distinct UUIDs and pass through;
      // the `disabled={isPending}` prop on the button is what
      // protects against that path.
      const idempotencyKey = newIdempotencyKey();
      // Catch synchronous throws from `apiFetch` (network errors
      // surface as a bare `Error` with no `.status`). Without this
      // guard, `onError`'s `err.status >= HTTP_4XX_MIN` check would
      // read `undefined >= 400` → false → no invalidation, and the
      // toast copy would be the raw thrown message (not classified).
      try {
        const res = await apiFetch(`/api/incidents/${id}/submit-result`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ outcome }),
        });
        if (!res.ok) {
          throw await classifySubmitResultError(res);
        }
      } catch (err) {
        // If the thrown value is already a tagged
        // `SubmitResultMutationError` (status-classified by
        // `classifySubmitResultError` above), rethrow as-is.
        if (err instanceof SubmitResultMutationError) {
          throw err;
        }
        // Network throw / DNS failure / abort — synthesize a
        // network-status Response so the same classifier can produce
        // the toast copy. Status 0 falls into the "do not
        // invalidate" branch in `onError` (5xx-class UX).
        throw await classifySubmitResultError(new Response(null, { status: HTTP_NETWORK_THROW }));
      }
      // The api returns 200 with a refreshed `IncidentPayload`; we
      // do NOT parse it here — the page's row query invalidation
      // is the source of truth for the next read, and the socket
      // event drives the cache mutation.
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentDetailQueryKey(id) });
    },
    // 4xx failures invalidate the cache so the next fetch can
    // update the read-side surface (NotFound / RbacDenied / row
    // shows SAFE / UNSAFE / MONITORING for 409). We deliberately
    // do NOT invalidate on:
    //   - 5xx               — row presumed unchanged; manual retry.
    //   - 401               — token refresh exhausted (5xx-class UX);
    //                         Technician must re-auth before any
    //                         retry can succeed; invalidating would
    //                         trigger a redundant refetch that would
    //                         also 401.
    //   - status 0 (network throw) — same reasoning as 5xx.
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
