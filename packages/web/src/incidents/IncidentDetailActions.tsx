/**
 * `IncidentDetailActions` — Story 4.5 + Story 4.6.
 *
 * The action region on the detail page. Mounted by
 * `<IncidentDetailBody />` between the `<dl>` and the audit timeline.
 *
 * Visibility gate: `actionSlotsFor(incident, viewerRole)` from
 * Story 4.1's contract module (`@/components/IncidentCard.types`).
 * The gate is the SAME single source of truth that Kanban cards
 * will eventually consume for card-level affordances (out of scope
 * for 4.5/4.6). Returns:
 *
 *   - "acknowledge" in the slot list → render the Acknowledge button
 *   - "assign"      in the slot list → render the Assign inline form
 *   - otherwise                       → render nothing for that slot
 *
 * Both buttons are `disabled` while their respective mutation is in
 * flight (idempotent re-click protection; the api also rejects 409 on
 * second-call, but the disable prevents the round-trip + flash
 * entirely). On click, the mutation fires; success + error toasts
 * surface via the page's `useToasts()` queue.
 *
 * Story 4.6 adds the Assign control. The pick-a-Technician UI is an
 * inline `<select>` of seeded Technician ids (`SEEDED_TECHNICIAN_IDS`
 * from `seededTechnicians.ts`) plus an Assign button — no modal,
 * no portal, no focus trap. The button is disabled until a
 * Technician is selected from the inline form.
 *
 * Why both controls in one component (not two siblings): both share
 * the same `actionSlotsFor` gate and the same visibility matrix
 * (both Admin + Operator, both rendered inside the body between
 * `<dl>` and the audit timeline). Splitting would duplicate the
 * gate logic and force two parent components to coordinate state.
 * Per-button testids disambiguate (`incident-detail-acknowledge-button`,
 * `incident-detail-assign-button`).
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { type Role } from "@surakkha/shared/rbac";
import { useState } from "react";

import { actionSlotsFor } from "../components/IncidentCard.types";

import { SEEDED_TECHNICIAN_IDS } from "./seededTechnicians";

/**
 * Number of trailing UUID characters shown in the `<option>` label.
 * Extracted to a constant so the `no-magic-numbers` lint rule does not
 * flag `id.slice(-8)`.
 */
const TECH_LABEL_TAIL_LENGTH = 8;

/**
 * Props for `<IncidentDetailActions />`.
 *
 * The Acknowledge and Assign mutations are owned by the page; this
 * component receives the `isAck` / `isAssign` in-flight flags plus
 * the click callbacks so the component controls button-disabled +
 * click forwarding without re-creating the mutations (the page owns
 * the mutation lifecycle). Pattern mirrors ThresholdsPage's
 * `onDeactivate` / `onActivate` props threaded through
 * `<ThresholdsPopulatedView />`.
 *
 * The `Acknowledge` callback has no argument (the verb is implicit);
 * the `Assign` callback receives the selected `assigneeUserId` (the
 * page forwards it into the mutation's `variables`).
 *
 * Prop naming: `isAck` / `isAssign` instead of the more verbose
 * `isAckPending` / `isAssignPending` because the React lint rule
 * `react/boolean-prop-naming` rejects names like `isAckPending`
 * (it parses as two capitalized syllables — `isAck` + `Pending` —
 * which violates the convention). The trailing `Pending` is implied
 * by the React Query / mutation semantics; the page wires the
 * `.isPending` field straight through.
 */
interface IncidentDetailActionsProps {
  readonly incident: IncidentPayload;
  readonly viewerRole: Role | null;
  readonly isAck: boolean;
  readonly isAssign: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
}

/**
 * Render the action region (Acknowledge button + Assign inline form)
 * based on `actionSlotsFor`. Each slot renders independently:
 *
 *   - "acknowledge" slot present → render the Acknowledge button.
 *   - "assign"      slot present → render the inline form (Technician
 *                                       `<select>` + Assign button).
 *
 * Returns `null` only when NEITHER slot is available — we render
 * nothing rather than a disabled button with a tooltip, because:
 *
 *   - The detail page's header already surfaces the state pill; the
 *     "no button" affordance IS the read-only signal.
 *   - Future actions (submit-result / reopen in Stories 4.7 / 4.11)
 *     will gate the same way; rendering nothing for closed slots
 *     keeps the actions region consistent.
 *
 * Style choices mirror the ThresholdsPage palette so the operator
 * gets a consistent button affordance across the app. The button
 * copies are short imperative verbs — "Acknowledge", "Assign".
 */
export const IncidentDetailActions = ({
  incident,
  viewerRole,
  isAck,
  isAssign,
  onAcknowledge,
  onAssign,
}: IncidentDetailActionsProps) => {
  const slots = actionSlotsFor(incident, viewerRole);
  const canAcknowledge = slots.includes("acknowledge");
  const canAssign = slots.includes("assign");

  if (!canAcknowledge && !canAssign) return null;

  return (
    <div data-testid="incident-detail-actions" className="flex flex-col gap-3">
      {canAcknowledge ? (
        <button
          type="button"
          data-testid="incident-detail-acknowledge-button"
          disabled={isAck}
          onClick={onAcknowledge}
          className={[
            "self-start rounded-input border px-4 py-2 text-sm font-medium text-white",
            // Slate palette: match the codebase's slate tokens
            // (`text-slate-900` body, `border-slate-300` subtle border).
            // Disabled state uses `disabled:bg-slate-400` so the
            // button reads as visibly muted while the mutation is
            // in flight — matches ThresholdsPage's deactivate affordance.
            "border-slate-900 bg-slate-900 hover:bg-slate-700",
            "disabled:bg-slate-400 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          {isAck ? "Acknowledging..." : "Acknowledge"}
        </button>
      ) : null}
      {canAssign ? <AssignForm isPending={isAssign} onAssign={onAssign} /> : null}
    </div>
  );
};

/**
 * Inline Assign form — Technician `<select>` + Assign button.
 *
 * Extracted as a sub-component (not inlined) so the form's local
 * state (the selected `assigneeUserId`) is scoped cleanly. The form
 * is intentionally minimal: the visible `<label>` covers the
 * accessible-name requirement (no bare `id` attribute on the
 * `<select>` — `react/forbid-dom-props` flags it because the
 * codebase has a default prop blocklist). Validation copy is
 * absent: the disabled-when-empty state IS the affordance.
 *
 * The Technician `<option>` values are the `SEEDED_TECHNICIAN_IDS`
 * constants; the visible labels are the trailing 8 characters of
 * the UUID (`TECH_LABEL_TAIL_LENGTH`) — enough to disambiguate the
 * two seeded Technicians without inventing a display name field. A
 * future `<TechnicianPicker />` backed by a user-management
 * endpoint can swap this for proper display names.
 *
 * Why no `confirm` dialog before firing: assignment is reversible
 * (reassign via the same button, or close out via 4.7 submit-result).
 * The minimum-friction affordance is one click after pick.
 */
interface AssignFormProps {
  readonly isPending: boolean;
  readonly onAssign: (assigneeUserId: string) => void;
}

const AssignForm = ({ isPending, onAssign }: AssignFormProps) => {
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");
  const canFire = selectedAssignee !== "" && !isPending;

  return (
    <div data-testid="incident-detail-assign-form" className="flex flex-col gap-2 self-start">
      <label
        className="text-xs font-medium text-neutral-secondary"
        htmlFor="incident-detail-assign-select"
      >
        Assign technician
      </label>
      <div className="flex items-center gap-2">
        <select
          aria-label="Assign technician"
          data-testid="incident-detail-assign-select"
          value={selectedAssignee}
          disabled={isPending}
          onChange={(e) => setSelectedAssignee(e.target.value)}
          className="rounded-input border border-neutral-border bg-neutral-surface px-3 py-2 text-sm text-neutral-body disabled:cursor-not-allowed disabled:bg-neutral-page"
        >
          <option value="" disabled>
            Select a technician...
          </option>
          {SEEDED_TECHNICIAN_IDS.map((id) => (
            <option key={id} value={id}>
              Technician {id.slice(-TECH_LABEL_TAIL_LENGTH)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="incident-detail-assign-button"
          disabled={!canFire}
          onClick={() => onAssign(selectedAssignee)}
          className={[
            "rounded-input border px-4 py-2 text-sm font-medium text-white",
            "border-slate-900 bg-slate-900 hover:bg-slate-700",
            "disabled:bg-slate-400 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          {isPending ? "Assigning..." : "Assign"}
        </button>
      </div>
    </div>
  );
};
