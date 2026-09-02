/**
 * `useAcknowledgeMutation` — thin per-verb wrapper over the shared
 * `useIncidentTransitionMutation` factory.
 */
import { useIncidentTransitionMutation } from "./useIncidentTransitionMutation";

export const useAcknowledgeMutation = (id: string) =>
  useIncidentTransitionMutation<void>(id, {
    verb: "acknowledge",
    route: "acknowledge",
    retryCopy: "Failed to acknowledge. Try again.",
    conflictFallback: "Already acknowledged",
  });
