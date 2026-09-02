/**
 * `useReopenMutation` — thin per-verb wrapper over the shared
 * `useIncidentTransitionMutation` factory.
 *
 * `validationFallback` enables the server's first-Zod-issue message
 * for 400 responses (the only verb that surfaces validation copy
 * verbatim — the others fall back to "Invalid request").
 */
import { useIncidentTransitionMutation } from "./useIncidentTransitionMutation";

export const useReopenMutation = (id: string) =>
  useIncidentTransitionMutation<{ reason: string }>(id, {
    verb: "reopen",
    route: "reopen",
    retryCopy: "Failed to reopen. Try again.",
    conflictFallback: "Cannot reopen — incident is not RESOLVED",
    validationFallback: "Reason invalid — please review and resubmit",
    buildBody: ({ reason }) => ({ reason }),
  });
