/**
 * `useDetailActionHandlers` — wire the four transition mutations
 * (Acknowledge / Assign / Submit Result / Reopen) to the
 * page-local toast queue. Each handler is a `mutate()` call +
 * per-verb success / error toast.
 */
import { type InspectionOutcome } from "@surakkha/shared/incident";
import { type UseMutationResult } from "@tanstack/react-query";

import { type TransitionMutationError } from "./useIncidentTransitionMutation";

export type ToastTone = "success" | "error";

export type PushToast = (tone: ToastTone, message: string) => void;

interface UseDetailActionHandlersInput {
  readonly acknowledgeMutation: UseMutationResult<void, TransitionMutationError, void>;
  readonly assignMutation: UseMutationResult<
    void,
    TransitionMutationError,
    { assigneeUserId: string }
  >;
  readonly submitResultMutation: UseMutationResult<
    void,
    TransitionMutationError,
    { outcome: InspectionOutcome }
  >;
  readonly reopenMutation: UseMutationResult<void, TransitionMutationError, { reason: string }>;
  readonly pushToast: PushToast;
}

interface UseDetailActionHandlersOutput {
  readonly handleAcknowledge: () => void;
  readonly handleAssign: (assigneeUserId: string) => void;
  readonly handleSubmitResult: (outcome: InspectionOutcome) => void;
  readonly handleReopen: (reason: string) => void;
}

export const useDetailActionHandlers = (
  input: UseDetailActionHandlersInput,
): UseDetailActionHandlersOutput => {
  const { acknowledgeMutation, assignMutation, submitResultMutation, reopenMutation, pushToast } =
    input;

  const handleAcknowledge = (): void => {
    acknowledgeMutation.mutate(undefined, {
      onSuccess: () => pushToast("success", "Acknowledged"),
      onError: (err: TransitionMutationError) => pushToast("error", err.message),
    });
  };

  const handleAssign = (assigneeUserId: string): void => {
    assignMutation.mutate(
      { assigneeUserId },
      {
        onSuccess: () => pushToast("success", "Technician assigned"),
        onError: (err: TransitionMutationError) => pushToast("error", err.message),
      },
    );
  };

  const handleSubmitResult = (outcome: InspectionOutcome): void => {
    submitResultMutation.mutate(
      { outcome },
      {
        onSuccess: () => pushToast("success", "Result submitted"),
        onError: (err: TransitionMutationError) => pushToast("error", err.message),
      },
    );
  };

  const handleReopen = (reason: string): void => {
    reopenMutation.mutate(
      { reason },
      {
        onSuccess: () => pushToast("success", "Incident reopened"),
        onError: (err: TransitionMutationError) => pushToast("error", err.message),
      },
    );
  };

  return { handleAcknowledge, handleAssign, handleSubmitResult, handleReopen };
};
