/**
 * `useSubmitResultMutation` — thin per-verb wrapper over the shared
 * `useIncidentTransitionMutation` factory. The wire body uses the
 * uppercase `InspectionOutcome` enum directly.
 */
import { type InspectionOutcome } from "@surakkha/shared/incident";

import { useIncidentTransitionMutation } from "./useIncidentTransitionMutation";

export const useSubmitResultMutation = (id: string) =>
  useIncidentTransitionMutation<{ outcome: InspectionOutcome }>(id, {
    verb: "submit_result",
    route: "submit-result",
    retryCopy: "Failed to submit result. Try again.",
    conflictFallback: "Already submitted",
    buildBody: ({ outcome }) => ({ outcome }),
  });
