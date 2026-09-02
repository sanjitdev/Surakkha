/**
 * `useIncidentTransitionMutation` — the factory for the four
 * incident-transition POST mutations.
 *
 * The four verbs (acknowledge / assign / submit-result / reopen)
 * share the same shape: fire a `POST /api/incidents/:id/{verb}` with
 * an `Idempotency-Key` header, classify non-OK responses into a
 * `TransitionMutationError`, invalidate the detail row cache on 4xx
 * (so the next fetch + socket event reconcile), and let the page wire
 * the success / error toast.
 *
 * Per-verb variation lives in the `TransitionMutationConfig` input:
 *
 *   - `verb` — for the canonical-envelope discriminator
 *   - `route` — the URL suffix (`acknowledge`, `assign`, …)
 *   - `retryCopy` — the generic 5xx "Failed to X. Try again." line
 *   - `conflictFallback` — the per-verb 409 copy when the envelope
 *     body is missing (typed state-machine miss with no `{ from,
 *     attempted }` payload)
 *   - `validationFallback` (optional) — used by `reopen` to surface
 *     the first Zod-issue message instead of "Invalid request"
 *
 * Why this factory: before this refactor each verb shipped its own
 * 80-line `use*Mutation` + `classify*Error` + tagged error class —
 * ~300 lines of structurally identical code. The factory cuts that
 * to ~30 lines of per-verb config + one shared mutation body.
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

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_4XX_MIN = 400;
const HTTP_4XX_MAX = 500;
const HTTP_NETWORK_THROW = 0;

/** Status-only static copy. Extracted to keep `classifyTransitionError`
 *  under the `complexity: 10` lint cap (5 branches would otherwise push
 *  the surrounding switch over the ceiling). */
const STATIC_STATUS_MESSAGE: Readonly<Record<number, string>> = {
  [HTTP_UNAUTHORIZED]: "Session expired — please sign in again",
  [HTTP_FORBIDDEN]: "Not authorized",
  [HTTP_NOT_FOUND]: "Incident not found",
};

interface TransitionMutationConfig<TVariables> {
  readonly verb: TransitionVerb;
  readonly route: string;
  readonly retryCopy: string;
  readonly conflictFallback: string;
  readonly validationFallback?: string;
  readonly buildBody?: (variables: TVariables) => Record<string, unknown>;
}

export class TransitionMutationError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "TransitionMutationError";
    this.status = status;
  }
}

const firstIssueMessage = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) return null;
  const { issues } = body as { issues?: unknown };
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const first = issues[0];
  if (typeof first !== "object" || first === null) return null;
  const { message } = first as { message?: unknown };
  return typeof message === "string" && message.length > 0 ? message : null;
};

const safeJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
};

const messageForConflict = async (
  res: Response,
  config: TransitionMutationConfig<unknown>,
): Promise<string> => {
  const envelope = parseTransitionEnvelope(await safeJson(res));
  return envelope !== null
    ? invalidTransitionMessage(config.verb, envelope)
    : config.conflictFallback;
};

const messageForBadRequest = async (
  res: Response,
  config: TransitionMutationConfig<unknown>,
): Promise<string> => {
  if (config.validationFallback === undefined) return "Invalid request";
  return firstIssueMessage(await safeJson(res)) ?? config.validationFallback;
};

const classifyTransitionError = async (
  res: Response,
  config: TransitionMutationConfig<unknown>,
): Promise<TransitionMutationError> => {
  const { status } = res;
  if (status === HTTP_CONFLICT) {
    return new TransitionMutationError(status, await messageForConflict(res, config));
  }
  if (status === HTTP_BAD_REQUEST) {
    return new TransitionMutationError(status, await messageForBadRequest(res, config));
  }
  if (status in STATIC_STATUS_MESSAGE) {
    // Cast through `unknown` because `Record<number, string>` lets TS
    // widen the keyspace; the `in` guard narrows the index type.
    return new TransitionMutationError(
      status,
      (STATIC_STATUS_MESSAGE as Record<number, string>)[status],
    );
  }
  return new TransitionMutationError(status, config.retryCopy);
};

export const useIncidentTransitionMutation = <TVariables>(
  id: string,
  config: TransitionMutationConfig<TVariables>,
) => {
  const queryClient = useQueryClient();
  return useMutation<void, TransitionMutationError, TVariables>({
    mutationFn: async (variables: TVariables): Promise<void> => {
      const idempotencyKey = newIdempotencyKey();
      const body =
        config.buildBody !== undefined ? JSON.stringify(config.buildBody(variables)) : undefined;
      try {
        const res = await apiFetch(`/api/incidents/${id}/${config.route}`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          ...(body !== undefined ? { body } : {}),
        });
        if (!res.ok) {
          throw await classifyTransitionError(res, config);
        }
      } catch (err) {
        if (err instanceof TransitionMutationError) throw err;
        // Network / DNS / abort — synthesize a `Response`-shaped
        // carrier so the same classifier can produce the toast copy.
        throw await classifyTransitionError(
          new Response(null, { status: HTTP_NETWORK_THROW }),
          config,
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentDetailQueryKey(id) });
    },
    onError: (err) => {
      // 4xx → invalidate (server told us truth about the row); 5xx +
      // network throw → row presumed unchanged, manual retry; 401 →
      // token refresh exhausted, also no invalidate (re-fetch would
      // 401 again).
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
