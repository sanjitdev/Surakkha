/**
 * `IncidentDetailActions` — Story 4.5 + Story 4.6 + Story 4.7.
 *
 * The action region on the detail page. Mounted by
 * `<IncidentDetailBody />` between the `<dl>` and the audit timeline.
 *
 * Visibility gate: `actionSlotsFor(incident, viewerRole, viewerUserId)`
 * from Story 4.1's contract module
 * (`@/components/IncidentCard.types`). The gate is the SAME single
 * source of truth that Kanban cards will eventually consume for card-
 * level affordances (out of scope for 4.5/4.6/4.7). Returns:
 *
 *   - "acknowledge"   in the slot list → render the Acknowledge button
 *   - "assign"        in the slot list → render the Assign inline form
 *   - "submit-result" in the slot list → render the Submit Result form
 *   - otherwise                         → render nothing for that slot
 *
 * Story 4.6 added the Assign inline form (Technician `<select>` of
 * seeded ids + Assign button). Story 4.7 adds the Submit Result form
 * (three radio inputs from `InspectionOutcomeSchema` + Submit button).
 * Both forms share the gate pattern: gate-first, then per-slot render.
 *
 * All buttons are `disabled` while their respective mutation is in
 * flight (idempotent re-click protection; the api also rejects 409 on
 * second-call, but the disable prevents the round-trip + flash
 * entirely). On click, the mutation fires; success + error toasts
 * surface via the page's `useToasts()` queue.
 *
 * Why all three controls in one component (not three siblings): all
 * share the same `actionSlotsFor` gate and the same visibility matrix
 * (Acknowledge + Assign for Admin/Operator, Submit-Result for the
 * assigned Technician; all rendered inside the body between `<dl>` and
 * the audit timeline). Splitting would duplicate the gate logic and
 * force three parent components to coordinate state. Per-button
 * testids disambiguate.
 */
import { type IncidentPayload, type InspectionOutcome } from "@surakkha/shared/incident";
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
 * The three mutations are owned by the page; this component receives
 * the `isAck` / `isAssign` / `isSubmitting` in-flight flags plus
 * the click callbacks so the component controls button-disabled +
 * click forwarding without re-creating the mutations (the page owns
 * the mutation lifecycle). Pattern mirrors ThresholdsPage's
 * `onDeactivate` / `onActivate` props threaded through
 * `<ThresholdsPopulatedView />`.
 *
 * The `Acknowledge` callback has no argument (the verb is implicit).
 * The `Assign` callback receives the selected `assigneeUserId` (the
 * page forwards it into the mutation's `variables`). The
 * `SubmitResult` callback receives the selected `outcome` (uppercase
 * enum; passed straight into the wire body — no casing swap).
 *
 * Story 4.11 — `onReopen` carries the Admin-supplied `reason`
 * (validated server-side for ≥ 10 chars; the form enforces the
 * same length locally so the disabled-when-empty affordance stays
 * consistent with the Assign / Submit Result forms).
 *
 * `viewerUserId` is threaded through to `actionSlotsFor`'s third
 * argument — the INSPECTING ownership gate
 * (`slotsForInspecting` returns `["submit-result"]` only when
 * `assignee_user_id === viewerUserId`). Optional because the gate
 * already treats `null` as "no ownership" — 4.5 + 4.6 did not need
 * the third argument; 4.7's Submit Result slot does.
 *
 * Prop naming rationale:
 *   - `isAck` / `isAssign` — `is` + single capitalized word passes
 *     the `react/boolean-prop-naming` rule (`^is[A-Z]([A-Z0-9]?[a-z0-9]+|[A-Z])$`).
 *   - `isSubmitting` — verb-form with the `is` prefix. The full
 *     `isSubmitResult` form would parse as two capitalized syllables
 *     (`isSubmit` + `Result`) and the rule rejects it. Truncating
 *     to `isSubmitting` keeps the boolean semantics clear while
 *     passing the regex. The trailing `Pending` is implied by the
 *     React Query / mutation semantics; the page wires the
 *     `.isPending` field straight through.
 *   - `isReopening` — same verb-form pattern as `isSubmitting`;
 *     the rule rejects the canonical `isReopen` (single capitalized
 *     syllable after `is`).
 */
interface IncidentDetailActionsProps {
  readonly incident: IncidentPayload;
  readonly viewerRole: Role | null;
  readonly viewerUserId: string | null;
  readonly isAck: boolean;
  readonly isAssign: boolean;
  readonly isSubmitting: boolean;
  readonly isReopening: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
  readonly onReopen: (reason: string) => void;
}

/**
 * Render the action region (Acknowledge button + Assign inline form
 * + Submit Result form) based on `actionSlotsFor`. Each slot renders
 * independently:
 *
 *   - "acknowledge" slot present   → render the Acknowledge button.
 *   - "assign"      slot present   → render the Assign inline form
 *                                     (Technician `<select>` + button).
 *   - "submit-result" slot present → render the Submit Result form
 *                                     (three radio inputs + button).
 *
 * Returns `null` only when NEITHER slot is available — we render
 * nothing rather than a disabled button with a tooltip, because:
 *
 *   - The detail page's header already surfaces the state pill; the
 *     "no button" affordance IS the read-only signal.
 *   - All three actions share the gate; rendering nothing for closed
 *     slots keeps the actions region consistent.
 *
 * Style choices mirror the ThresholdsPage palette so the operator /
 * Technician gets a consistent button affordance across the app. The
 * button copies are short imperative verbs — "Acknowledge",
 * "Assign", "Submit result".
 */
export const IncidentDetailActions = ({
  incident,
  viewerRole,
  viewerUserId,
  isAck,
  isAssign,
  isSubmitting,
  isReopening,
  onAcknowledge,
  onAssign,
  onSubmitResult,
  onReopen,
}: IncidentDetailActionsProps) => {
  const slots = actionSlotsFor(incident, viewerRole, viewerUserId);
  const canAcknowledge = slots.includes("acknowledge");
  const canAssign = slots.includes("assign");
  const canSubmitResult = slots.includes("submit-result");
  const canReopen = slots.includes("reopen");

  if (!canAcknowledge && !canAssign && !canSubmitResult && !canReopen) return null;

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
      {canSubmitResult ? (
        <SubmitResultForm isPending={isSubmitting} onSubmitResult={onSubmitResult} />
      ) : null}
      {canReopen ? <ReopenForm isPending={isReopening} onReopen={onReopen} /> : null}
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
        {/* eslint-disable react/forbid-dom-props -- the `id` is the
            target of the sibling `<label htmlFor>` above. The rule's
            intent (avoid duplicate / colliding DOM ids) does not
            apply to a single, test-stable testid-derived value. */}
        <select
          id="incident-detail-assign-select"
          data-testid="incident-detail-assign-select"
          value={selectedAssignee}
          disabled={isPending}
          onChange={(e) => setSelectedAssignee(e.target.value)}
          className="rounded-input border border-neutral-border bg-neutral-surface px-3 py-2 text-sm text-neutral-body disabled:cursor-not-allowed disabled:bg-neutral-page"
        >
          {/* eslint-enable react/forbid-dom-props */}
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

/**
 * The closed set of inspection outcomes — mirrors `InspectionOutcomeSchema`
 * at `packages/shared/src/incident.ts:65-67`. Pinned here (not
 * imported) because:
 *
 *   - The shape is closed + tiny (three values) and the radio
 *     iteration is a stable build-time tuple.
 *   - Importing the schema in this file would force every consumer of
 *     `<IncidentDetailActions />` to re-import the zod runtime (and
 *     would couple this UI module to the wire contract in a way the
 *     spec explicitly avoids).
 *
 * The order matches the enum's canonical order (`SAFE → UNSAFE →
 * MONITORING`) so the spec's I/O matrix entries line up with the
 * rendered radio order top-to-bottom.
 */
const INSPECTION_OUTCOMES: readonly InspectionOutcome[] = ["SAFE", "UNSAFE", "MONITORING"];

/**
 * Inline Submit Result form — three radio inputs (one per outcome)
 * + a single Submit button.
 *
 * Extracted as a sub-component (not inlined) so the form's local
 * state (the selected outcome) is scoped cleanly. The form is
 * intentionally minimal: the visible `<fieldset>` / `<legend>`
 * covers the accessible-name requirement (the radio group's
 * `name` attribute ties the inputs together; the legend labels
 * the group). Validation copy is absent: the disabled-when-empty
 * state IS the affordance.
 *
 * Why a single Submit button (not three, one per outcome): three
 * buttons would let the Technician click "Submit UNSAFE" without
 * picking UNSAFE first, racing the radio's default selection with
 * the click intent. A single button + three radios forces a
 * deliberate two-click workflow: pick outcome, then submit.
 *
 * Why no `confirm` dialog before firing: submit-result is the
 * Technician's authoritative verb (the operator workflow assumes
 * the Technician inspected the device before submitting). The 4.11
 * reopen path is the rewind for genuine mistakes.
 *
 * The radio `value` attribute is the uppercase enum string itself
 * (`"SAFE"`, `"UNSAFE"`, `"MONITORING"`) — the wire shape matches
 * the form shape exactly. No camelCase/snake_case swap (unlike
 * 4.6's `assignee_user_id`).
 */
interface SubmitResultFormProps {
  readonly isPending: boolean;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
}

const SubmitResultForm = ({ isPending, onSubmitResult }: SubmitResultFormProps) => {
  const [selectedOutcome, setSelectedOutcome] = useState<InspectionOutcome | null>(null);
  const canFire = selectedOutcome !== null && !isPending;

  return (
    <fieldset
      data-testid="incident-detail-submit-result-form"
      disabled={isPending}
      className="flex flex-col gap-2 self-start rounded-input border border-neutral-border bg-neutral-surface p-3"
    >
      <legend className="text-xs font-medium text-neutral-secondary">Inspection result</legend>
      <div className="flex flex-col gap-1">
        {INSPECTION_OUTCOMES.map((outcome) => (
          <label
            key={outcome}
            className="flex items-center gap-2 text-sm text-neutral-body disabled:cursor-not-allowed"
          >
            <input
              type="radio"
              name="incident-detail-submit-result-outcome"
              value={outcome}
              data-testid={`incident-detail-submit-result-radio-${outcome}`}
              checked={selectedOutcome === outcome}
              disabled={isPending}
              onChange={() => setSelectedOutcome(outcome)}
              className="h-4 w-4 disabled:cursor-not-allowed"
            />
            <span>{outcome}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        data-testid="incident-detail-submit-result-button"
        disabled={!canFire}
        onClick={() => {
          if (selectedOutcome !== null) onSubmitResult(selectedOutcome);
        }}
        className={[
          "self-start rounded-input border px-4 py-2 text-sm font-medium text-white",
          "border-slate-900 bg-slate-900 hover:bg-slate-700",
          "disabled:bg-slate-400 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {isPending ? "Submitting..." : "Submit result"}
      </button>
    </fieldset>
  );
};

/**
 * Story 4.11 — Inline Reopen form (Admin-only when state is RESOLVED).
 *
 * Mirrors the Assign / Submit Result form patterns:
 *
 *   - Local state for the typed `reason` text.
 *   - Disabled-when-empty affordance (the canFire guard).
 *   - Inline `<fieldset>` / `<legend>` for the accessible name.
 *   - Single Submit button (no per-row confirmation modal — the
 *     `useReopenMutation`'s toast surface handles the success /
 *     error feedback).
 *
 * Why a textarea (not an `<input type="text">`): the spec requires
 * `reason ≥ 10 chars` and the comment is naturally multi-line
 * (operator writes "Misclassified — device still failing. Reviewed
 * the inspection log and the SAFE submit was incorrect."). A
 * textarea handles both 10-char and multi-paragraph reasons without
 * an artificial cap.
 *
 * Why no `confirm` dialog before firing: reopen is the Admin's
 * authoritative verb (the Admin reviewed the audit timeline and
 * decided the original resolve was wrong). The mutation's toast
 * surface is the feedback loop; a confirm dialog would add a click
 * with no information gain.
 *
 * Length validation lives on the server (Zod `reopenPayloadSchema`
 * — `min(10).max(2000).trim()`). The form mirrors BOTH bounds
 * locally so the disabled-when-empty affordance stays consistent
 * with the Assign form AND an operator who pastes a 5 KB PR
 * description cannot submit a payload the server will reject with
 * a misleading "too short" toast. The `maxLength` attribute is the
 * standard browser-level affordance; the submit-button guard is the
 * source of truth (so future Story 4.x changes can bump the bound
 * without a layout-level migration).
 *
 * Visible only when `actionSlotsFor` returns `"reopen"` in the
 * slot list — i.e. viewer is Admin AND state is RESOLVED. The
 * orchestrator above already gates the mount.
 */
const REOPEN_REASON_MIN_LENGTH = 10;
const REOPEN_REASON_MAX_LENGTH = 2000;

interface ReopenFormProps {
  readonly isPending: boolean;
  readonly onReopen: (reason: string) => void;
}

const ReopenForm = ({ isPending, onReopen }: ReopenFormProps) => {
  const [reason, setReason] = useState<string>("");
  const canFire = reason.trim().length >= REOPEN_REASON_MIN_LENGTH && !isPending;

  return (
    <fieldset
      data-testid="incident-detail-reopen-form"
      disabled={isPending}
      className="flex flex-col gap-2 self-start rounded-input border border-neutral-border bg-neutral-surface p-3"
    >
      <legend className="text-xs font-medium text-neutral-secondary">Reopen incident</legend>
      <label className="text-xs text-neutral-secondary" htmlFor="incident-detail-reopen-reason">
        Reason (required, between 10 and 2000 characters)
      </label>
      {/* eslint-disable react/forbid-dom-props -- the `id` is the
          target of the sibling `<label htmlFor>` above. The rule's
          intent (avoid duplicate / colliding DOM ids) does not
          apply to a single, test-stable testid-derived value. */}
      <textarea
        id="incident-detail-reopen-reason"
        data-testid="incident-detail-reopen-reason"
        value={reason}
        disabled={isPending}
        // `required` + `aria-required` mirror the label copy
        // ("required, between 10 and 2000 characters") at the
        // HTML level so screen-reader users hear the constraint.
        required
        aria-required="true"
        // `maxLength` mirrors the server's Zod `max(2000)` cap so
        // the browser refuses keys past the limit — preventing a
        // misleading "too short" toast for a too-long input.
        maxLength={REOPEN_REASON_MAX_LENGTH}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="rounded-input border border-neutral-border bg-neutral-page px-3 py-2 text-sm text-neutral-body disabled:cursor-not-allowed disabled:bg-neutral-page"
      />
      {/* eslint-enable react/forbid-dom-props */}
      <button
        type="button"
        data-testid="incident-detail-reopen-button"
        disabled={!canFire}
        onClick={() => {
          if (canFire) onReopen(reason.trim());
        }}
        className={[
          "self-start rounded-input border px-4 py-2 text-sm font-medium text-white",
          "border-slate-900 bg-slate-900 hover:bg-slate-700",
          "disabled:bg-slate-400 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {isPending ? "Reopening..." : "Reopen"}
      </button>
    </fieldset>
  );
};
