/**
 * `useResolveMutation` — thin per-verb wrapper over the shared
 * `useIncidentTransitionMutation` factory.
 *
 * Closes the gap between the state machine (`SAFE | UNSAFE |
 * MONITORING → RESOLVED` is a valid transition in `@surakkha/shared/
 * incident` and the api's `/api/incidents/:id/resolve` handler) and
 * the detail page UI — `actionSlotsFor` exposes a `"resolve"` slot
 * for SAFE / UNSAFE / MONITORING rows, and `IncidentDetailActions`
 * renders this button whenever the slot is present.
 *
 * The verb has no body (`POST /api/incidents/:id/resolve` accepts an
 * empty payload), so `buildBody` is omitted — the factory treats a
 * missing `buildBody` as "send no body". RBAC: Admin + Operator per
 * `RBAC_ACTION_BY_VERB.resolve`.
 */
import { useIncidentTransitionMutation } from "./useIncidentTransitionMutation";

export const useResolveMutation = (id: string) =>
  useIncidentTransitionMutation<void>(id, {
    verb: "resolve",
    route: "resolve",
    retryCopy: "Failed to resolve. Try again.",
    conflictFallback: "Cannot resolve — incident must be in SAFE, UNSAFE, or MONITORING",
  });
