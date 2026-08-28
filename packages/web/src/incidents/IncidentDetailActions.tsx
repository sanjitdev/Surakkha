/**
 * `IncidentDetailActions` — Story 4.5.
 *
 * The Acknowledge button on the detail page. Mounted by
 * `<IncidentDetailBody />` between the `<dl>` and the audit timeline.
 *
 * Visibility gate: `actionSlotsFor(incident, viewerRole)` from
 * Story 4.1's contract module (`@/components/IncidentCard.types`).
 * The gate is the SAME single source of truth that Kanban cards
 * will eventually consume for card-level affordances (out of scope
 * for 4.5). Returns:
 *
 *   - "acknowledge" in the slot list → render the button
 *   - otherwise                       → render nothing
 *
 * The button is `disabled` while the mutation is in flight (idempotent
 * re-click protection; the api also rejects 409 on second-call, but
 * the disable prevents the round-trip + flash entirely). On click,
 * the mutation fires; success + error toasts surface via the
 * page's `useToasts()` queue.
 *
 * Why a dedicated component (not inline JSX in IncidentDetailBody):
 * 4.6 (assign) and 4.7 (submit-result) each ship their own action
 * region; extracting the action surface today keeps the body
 * component under the lint `max-lines-per-function: 200` ceiling
 * AND makes the per-action visibility test trivial (mount the
 * component, assert presence / absence).
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { type Role } from "@surakkha/shared/rbac";

import { actionSlotsFor } from "../components/IncidentCard.types";

/**
 * Props for `<IncidentDetailActions />`.
 *
 * `mutation` is the full `useMutation` result so the component
 * controls button-disabled + click forwarding without re-creating
 * the mutation (the page owns the mutation lifecycle). Pattern
 * mirrors ThresholdsPage's `onDeactivate` / `onActivate` props
 * threaded through `<ThresholdsPopulatedView />`.
 */
interface IncidentDetailActionsProps {
  readonly incident: IncidentPayload;
  readonly viewerRole: Role | null;
  readonly isPending: boolean;
  readonly onAcknowledge: () => void;
}

/**
 * Render the Acknowledge button, or nothing if the slot is gated.
 *
 * Returns `null` for every case where the slot is NOT available —
 * we intentionally render nothing rather than a disabled button
 * with a tooltip, because:
 *
 *   - The detail page's header already surfaces the state pill; the
 *     "no button" affordance IS the read-only signal.
 *   - Future actions (assign / submit-result / reopen in Stories
 *     4.6 / 4.7 / 4.11) will gate the same way; rendering nothing
 *     for closed slots keeps the actions region consistent.
 *
 * Style choices mirror the ThresholdsPage palette so the operator
 * gets a consistent button affordance across the app. The button
 * copy is "Acknowledge" — concise verb.
 */
export const IncidentDetailActions = ({
  incident,
  viewerRole,
  isPending,
  onAcknowledge,
}: IncidentDetailActionsProps) => {
  const slots = actionSlotsFor(incident, viewerRole);
  const canAcknowledge = slots.includes("acknowledge");
  if (!canAcknowledge) return null;

  return (
    <div data-testid="incident-detail-actions" className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="incident-detail-acknowledge-button"
        disabled={isPending}
        onClick={onAcknowledge}
        className="self-start rounded-input border px-4 py-2 text-sm font-medium text-white"
        style={{
          backgroundColor: isPending ? "#94A3B8" : "#0F172A",
          borderColor: "#0F172A",
          cursor: isPending ? "not-allowed" : "pointer",
        }}
      >
        {isPending ? "Acknowledging..." : "Acknowledge"}
      </button>
    </div>
  );
};
