/**
 * `useAssignMutation` — thin per-verb wrapper over the shared
 * `useIncidentTransitionMutation` factory. The wire body is
 * snake_case (`assignee_user_id`); the hook variable is camelCase.
 */
import { useIncidentTransitionMutation } from "./useIncidentTransitionMutation";

export const useAssignMutation = (id: string) =>
  useIncidentTransitionMutation<{ assigneeUserId: string }>(id, {
    verb: "assign",
    route: "assign",
    retryCopy: "Failed to assign. Try again.",
    conflictFallback: "Already assigned",
    buildBody: ({ assigneeUserId }) => ({ assignee_user_id: assigneeUserId }),
  });
