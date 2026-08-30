/**
 * `useDetailActionHandlers` — extract the four mutation success/error
 * handlers (Acknowledge / Assign / Submit Result / Reopen) from
 * `<IncidentDetailPage />` so the page-level function stays under
 * the `complexity: 10` lint ceiling.
 *
 * All four handlers share the same shape: forward the verb-specific
 * payload to `mutate()`, surface success + error toasts via the
 * page's `pushToast` queue. The factory centralizes the boilerplate;
 * the toast copy is per-verb.
 *
 * Pure hook (no side-effects beyond calling `mutate()`); no JSX,
 * no socket, no TanStack Query. The `pushToast` function comes
 * from the page-level `useToasts()` queue. The four `UseMutationResult`
 * values come from the page's mutation hooks — passed through as
 * parameters so the helper stays decoupled from the hook instances.
 *
 * Why a custom hook (not a plain factory function): the four
 * handlers all close over the same `pushToast` reference, and a
 * hook makes the call-site read cleanly without leaking a deep
 * callback tree into the page's render path.
 */
import { type InspectionOutcome } from "@surakkha/shared/incident";
import { type UseMutationResult } from "@tanstack/react-query";

import { type AcknowledgeMutationError } from "./useAcknowledgeMutation";
import { type AssignMutationError } from "./useAssignMutation";
import { type ReopenMutationError } from "./useReopenMutation";
import { type SubmitResultMutationError } from "./useSubmitResultMutation";

export type ToastTone = "success" | "error";

export type PushToast = (tone: ToastTone, message: string) => void;

interface UseDetailActionHandlersInput {
  readonly acknowledgeMutation: UseMutationResult<void, AcknowledgeMutationError, void>;
  readonly assignMutation: UseMutationResult<void, AssignMutationError, { assigneeUserId: string }>;
  readonly submitResultMutation: UseMutationResult<
    void,
    SubmitResultMutationError,
    { outcome: InspectionOutcome }
  >;
  readonly reopenMutation: UseMutationResult<void, ReopenMutationError, { reason: string }>;
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

  // Acknowledge handler — no payload; the verb is implicit.
  const handleAcknowledge = (): void => {
    acknowledgeMutation.mutate(undefined, {
      onSuccess: () => pushToast("success", "Acknowledged"),
      // The mutation classifier pinned the toast copy. The `status`
      // is preserved on the error for any future routing logic
      // that wants to switch on it.
      onError: (err: AcknowledgeMutationError) => pushToast("error", err.message),
    });
  };

  // Assign handler — carries the assignee user id.
  const handleAssign = (assigneeUserId: string): void => {
    assignMutation.mutate(
      { assigneeUserId },
      {
        onSuccess: () => pushToast("success", "Technician assigned"),
        onError: (err: AssignMutationError) => pushToast("error", err.message),
      },
    );
  };

  // Submit Result handler — carries the uppercase InspectionOutcome enum.
  // The radio's `value` attribute is already uppercase, and the wire
  // body uses the same uppercase enum per `InspectionOutcomeSchema`.
  const handleSubmitResult = (outcome: InspectionOutcome): void => {
    submitResultMutation.mutate(
      { outcome },
      {
        onSuccess: () => pushToast("success", "Result submitted"),
        onError: (err: SubmitResultMutationError) => pushToast("error", err.message),
      },
    );
  };

  // Story 4.11 — Reopen handler. Carries `{ reason }` (validated
  // server-side for ≥ 10 chars); the form enforces the same length
  // locally so the disabled-when-empty affordance matches.
  const handleReopen = (reason: string): void => {
    reopenMutation.mutate(
      { reason },
      {
        onSuccess: () => pushToast("success", "Incident reopened"),
        onError: (err: ReopenMutationError) => pushToast("error", err.message),
      },
    );
  };

  return { handleAcknowledge, handleAssign, handleSubmitResult, handleReopen };
};
